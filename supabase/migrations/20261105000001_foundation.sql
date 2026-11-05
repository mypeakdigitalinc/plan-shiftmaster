-- =============================================================================
-- ShiftHub — Phase D1: Foundation
-- organizations, org_settings, profiles, invitations, auth helpers, RLS, RPCs
--
-- Portability notes
--   * The current user is read from `request.jwt.claims` (set by Supabase's
--     PostgREST *and* by the ShiftHub API per transaction), so the same SQL works
--     on Supabase and on AWS RDS.
--   * No dependency on the Supabase `auth` schema. profiles.id = JWT `sub`.
--   * Tables live in the `app` schema, which is not exposed through PostgREST.
--     Clients go through the ShiftHub API only.
-- =============================================================================

create schema if not exists app;

-- Random helpers built on core gen_random_uuid() (no pgcrypto: its schema differs between Supabase and RDS)
create or replace function app.random_code(p_len int default 10)
returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, p_len))
$$;

create or replace function app.random_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- -----------------------------------------------------------------------------
-- Roles (exist on Supabase already; created here for local / RDS)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type app.user_role     as enum ('employee', 'manager', 'org_admin');
create type app.org_mode      as enum ('facility', 'group');
create type app.record_status as enum ('active', 'inactive');

-- -----------------------------------------------------------------------------
-- Auth helpers
-- -----------------------------------------------------------------------------
create or replace function app.current_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(app.current_claims() ->> 'sub', '')::uuid
$$;

create or replace function app.current_user_email()
returns text
language sql
stable
as $$
  select lower(nullif(app.current_claims() ->> 'email', ''))
$$;

-- -----------------------------------------------------------------------------
-- Generic timestamp / actor trigger
-- -----------------------------------------------------------------------------
create or replace function app.tg_touch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_strip_nulls(jsonb_build_object(
      'created_at', now(),
      'updated_at', now(),
      'created_by', coalesce(to_jsonb(new) ->> 'created_by', app.current_user_id()::text),
      'updated_by', app.current_user_id()
    )));
  else
    new := jsonb_populate_record(new, jsonb_build_object(
      'created_at', old.created_at,
      'updated_at', now(),
      'updated_by', app.current_user_id()
    ));
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table app.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 120),
  logo_url    text,
  timezone    text not null default 'America/Toronto',
  status      app.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz
);

create table app.org_settings (
  organization_id        uuid primary key references app.organizations (id) on delete cascade,
  mode                   app.org_mode not null default 'facility',
  require_approval       boolean not null default true,
  allow_swaps            boolean not null default true,
  allow_pickup           boolean not null default true,
  allow_self_scheduling  boolean not null default false,
  invite_code            text not null unique default app.random_code(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid
);

create table app.profiles (
  id               uuid primary key,                     -- = auth provider user id (JWT sub)
  organization_id  uuid references app.organizations (id),
  email            text not null unique check (email = lower(email)),
  name             text not null default '',
  phone            text,
  photo_url        text,
  role             app.user_role not null default 'employee',
  position         text,                                 -- e.g. RN, RPN, PSW
  share_schedule   boolean not null default false,
  status           app.record_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz
);
create index profiles_org_idx on app.profiles (organization_id) where deleted_at is null;

create table app.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references app.organizations (id) on delete cascade,
  email            text not null check (email = lower(email)),
  role             app.user_role not null default 'employee',
  position         text,
  token            text not null unique default app.random_token(),
  expires_at       timestamptz not null default now() + interval '14 days',
  accepted_at      timestamptz,
  accepted_by      uuid references app.profiles (id),
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid
);
create index invitations_org_idx on app.invitations (organization_id);
create unique index invitations_open_email_idx
  on app.invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create trigger touch before insert or update on app.organizations for each row execute function app.tg_touch();
create trigger touch before insert or update on app.org_settings  for each row execute function app.tg_touch();
create trigger touch before insert or update on app.profiles      for each row execute function app.tg_touch();
create trigger touch before insert or update on app.invitations   for each row execute function app.tg_touch();

-- -----------------------------------------------------------------------------
-- Tenant helpers (security definer so RLS policies can call them cheaply)
-- -----------------------------------------------------------------------------
create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select organization_id
  from app.profiles
  where id = app.current_user_id()
    and status = 'active'
    and deleted_at is null
$$;

create or replace function app.current_user_role()
returns app.user_role
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select role
  from app.profiles
  where id = app.current_user_id()
    and organization_id is not null
    and status = 'active'
    and deleted_at is null
$$;

create or replace function app.is_manager()
returns boolean
language sql
stable
as $$
  select coalesce(app.current_user_role() in ('manager', 'org_admin'), false)
$$;

create or replace function app.is_org_admin()
returns boolean
language sql
stable
as $$
  select coalesce(app.current_user_role() = 'org_admin', false)
$$;

-- -----------------------------------------------------------------------------
-- Profile guard: plain (non-RPC) updates may not move a user between orgs or
-- escalate privileges. RPCs run as the function owner and bypass this check.
-- -----------------------------------------------------------------------------
create or replace function app.tg_profiles_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.organization_id is distinct from old.organization_id then
    raise exception 'id, email and organization cannot be changed directly' using errcode = '42501';
  end if;

  if (new.role is distinct from old.role or new.status is distinct from old.status
      or new.deleted_at is distinct from old.deleted_at) then
    if not app.is_org_admin() then
      raise exception 'only an org admin can change role or status' using errcode = '42501';
    end if;
    if old.id = app.current_user_id() then
      raise exception 'admins cannot change their own role or status' using errcode = '42501';
    end if;
  end if;

  if new.share_schedule is distinct from old.share_schedule and old.id <> app.current_user_id() then
    raise exception 'only the employee can change their schedule sharing preference' using errcode = '42501';
  end if;

  if (new.position is distinct from old.position) and not app.is_manager() then
    raise exception 'only managers can change position' using errcode = '42501';
  end if;

  return new;
end
$$;

create trigger profiles_guard before update on app.profiles
  for each row execute function app.tg_profiles_guard();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table app.organizations enable row level security;
alter table app.org_settings  enable row level security;
alter table app.profiles      enable row level security;
alter table app.invitations   enable row level security;

-- organizations
create policy org_select on app.organizations for select to authenticated
  using (id = app.current_org_id() and deleted_at is null);
create policy org_update on app.organizations for update to authenticated
  using (id = app.current_org_id() and app.is_org_admin())
  with check (id = app.current_org_id());

-- org_settings
create policy settings_select on app.org_settings for select to authenticated
  using (organization_id = app.current_org_id());
create policy settings_update on app.org_settings for update to authenticated
  using (organization_id = app.current_org_id() and app.is_org_admin())
  with check (organization_id = app.current_org_id());

-- profiles: see yourself + members of your org; edit yourself, or anyone in org as admin/manager
create policy profiles_select on app.profiles for select to authenticated
  using (
    id = app.current_user_id()
    or (organization_id = app.current_org_id() and deleted_at is null)
  );
create policy profiles_update on app.profiles for update to authenticated
  using (
    id = app.current_user_id()
    or (organization_id = app.current_org_id() and app.is_manager())
  )
  with check (
    id = app.current_user_id()
    or (organization_id = app.current_org_id() and app.is_manager())
  );

-- invitations: managers of the org only (creation goes through RPC)
create policy invitations_select on app.invitations for select to authenticated
  using (organization_id = app.current_org_id() and app.is_manager());

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant usage on schema app to authenticated;
grant select, update on app.organizations, app.org_settings, app.profiles to authenticated;
grant select on app.invitations to authenticated;

-- Column-level restriction: employees can never write these via plain UPDATE
revoke update on app.org_settings from authenticated;
grant update (require_approval, allow_swaps, allow_pickup, allow_self_scheduling)
  on app.org_settings to authenticated;
revoke update on app.organizations from authenticated;
grant update (name, logo_url, timezone) on app.organizations to authenticated;
revoke update on app.profiles from authenticated;
grant update (name, phone, photo_url, share_schedule, position, role, status)
  on app.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Create (or fetch) the caller's profile from their verified token.
create or replace function app.ensure_profile(p_name text default null)
returns app.profiles
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid   uuid := app.current_user_id();
  v_email text := app.current_user_email();
  v_row   app.profiles;
begin
  if v_uid is null or v_email is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into app.profiles (id, email, name, created_by)
  values (v_uid, v_email, coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1)), v_uid)
  on conflict (id) do nothing;

  select * into v_row from app.profiles where id = v_uid;
  return v_row;
end
$$;

-- Create an organization; caller becomes its org_admin.
create or replace function app.create_organization(
  p_name text,
  p_mode app.org_mode default 'facility',
  p_timezone text default 'America/Toronto'
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_org uuid;
  v_profile app.profiles;
begin
  select * into v_profile from app.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_profile.organization_id is not null then
    raise exception 'you already belong to an organization' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;

  insert into app.organizations (name, timezone, created_by)
  values (trim(p_name), p_timezone, v_uid)
  returning id into v_org;

  insert into app.org_settings (organization_id, mode, require_approval, allow_self_scheduling, created_by)
  values (v_org, p_mode, p_mode = 'facility', p_mode = 'group', v_uid);

  update app.profiles
     set organization_id = v_org,
         role = 'org_admin',
         share_schedule = (p_mode = 'group')
   where id = v_uid;

  return v_org;
end
$$;

-- Join with an org invite code (mainly group mode). Joins as employee.
create or replace function app.join_organization(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_settings app.org_settings;
  v_profile app.profiles;
begin
  select * into v_profile from app.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_profile.organization_id is not null then
    raise exception 'you already belong to an organization' using errcode = '55000';
  end if;

  select s.* into v_settings
  from app.org_settings s
  join app.organizations o on o.id = s.organization_id
  where s.invite_code = upper(trim(p_invite_code))
    and o.status = 'active' and o.deleted_at is null;
  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;

  update app.profiles
     set organization_id = v_settings.organization_id,
         role = 'employee',
         share_schedule = (v_settings.mode = 'group')
   where id = v_uid;

  return v_settings.organization_id;
end
$$;

-- Invite someone by email. Managers may invite employees; admins any role.
create or replace function app.create_invitation(
  p_email text,
  p_role app.user_role default 'employee',
  p_position text default null
)
returns app.invitations
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_org uuid := app.current_org_id();
  v_row app.invitations;
  v_email text := lower(trim(p_email));
begin
  if not app.is_manager() then
    raise exception 'only managers can invite' using errcode = '42501';
  end if;
  if p_role <> 'employee' and not app.is_org_admin() then
    raise exception 'only org admins can invite managers or admins' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if exists (select 1 from app.profiles where email = v_email and organization_id is not null) then
    raise exception 'this person already belongs to an organization' using errcode = '55000';
  end if;

  -- replace any open invite for the same email
  update app.invitations set revoked_at = now()
   where organization_id = v_org and email = v_email
     and accepted_at is null and revoked_at is null;

  insert into app.invitations (organization_id, email, role, position, created_by)
  values (v_org, v_email, p_role, nullif(trim(p_position), ''), app.current_user_id())
  returning * into v_row;

  return v_row;
end
$$;

create or replace function app.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.is_manager() then
    raise exception 'only managers can revoke invitations' using errcode = '42501';
  end if;
  update app.invitations set revoked_at = now()
   where id = p_invitation_id and organization_id = app.current_org_id()
     and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
end
$$;

-- Accept an email invitation. The token's email must match the caller's email.
create or replace function app.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_inv app.invitations;
  v_profile app.profiles;
  v_mode app.org_mode;
begin
  select * into v_profile from app.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  select * into v_inv from app.invitations where token = p_token for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already used' using errcode = '55000';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = '55000';
  end if;
  if v_inv.email <> v_profile.email then
    raise exception 'invitation was sent to a different email' using errcode = '42501';
  end if;
  if v_profile.organization_id is not null then
    raise exception 'you already belong to an organization' using errcode = '55000';
  end if;

  select mode into v_mode from app.org_settings where organization_id = v_inv.organization_id;

  update app.profiles
     set organization_id = v_inv.organization_id,
         role = v_inv.role,
         position = coalesce(v_inv.position, position),
         share_schedule = (v_mode = 'group')
   where id = v_uid;

  update app.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  return v_inv.organization_id;
end
$$;

create or replace function app.rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_code text;
begin
  if not app.is_org_admin() then
    raise exception 'only org admins can rotate the invite code' using errcode = '42501';
  end if;
  update app.org_settings
     set invite_code = app.random_code()
   where organization_id = app.current_org_id()
  returning invite_code into v_code;
  return v_code;
end
$$;

-- Function privileges: nothing for PUBLIC, explicit grants for authenticated
revoke execute on all functions in schema app from public;
grant execute on function
  app.current_claims(), app.current_user_id(), app.current_user_email(),
  app.current_org_id(), app.current_user_role(), app.is_manager(), app.is_org_admin(),
  app.ensure_profile(text),
  app.create_organization(text, app.org_mode, text),
  app.join_organization(text),
  app.create_invitation(text, app.user_role, text),
  app.revoke_invitation(uuid),
  app.accept_invitation(text),
  app.rotate_invite_code()
to authenticated;
-- trigger functions must stay callable by the table writer
grant execute on function app.tg_touch(), app.tg_profiles_guard(), app.random_code(int), app.random_token() to authenticated;
