-- =============================================================================
-- ShiftHub — Phase D2: Org structure & people
-- sites, areas, assignments, employee_areas, availability, shift_templates
--
-- Tenant integrity: child rows reference parents with composite foreign keys
-- (id, organization_id), so an area can never point at another org's site, etc.
-- organization_id defaults to the caller's org, and RLS WITH CHECK enforces it.
-- Soft delete: deleted_at is set by the API; RLS does not filter it (queries do).
-- =============================================================================

-- composite-key targets
alter table app.profiles add constraint profiles_id_org_key unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- Sites
-- -----------------------------------------------------------------------------
create table app.sites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.current_org_id() references app.organizations (id),
  name             text not null check (length(trim(name)) between 1 and 120),
  code             text check (length(code) <= 20),
  address          text,
  phone            text,
  timezone         text,                          -- null = organization timezone
  status           app.record_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  unique (id, organization_id)
);
create unique index sites_name_idx on app.sites (organization_id, lower(name)) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Areas (units / departments inside a site)
-- -----------------------------------------------------------------------------
create table app.areas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.current_org_id() references app.organizations (id),
  site_id          uuid not null,
  name             text not null check (length(trim(name)) between 1 and 120),
  description      text,
  status           app.record_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  unique (id, organization_id),
  foreign key (site_id, organization_id) references app.sites (id, organization_id)
);
create index areas_site_idx on app.areas (site_id);
create unique index areas_name_idx on app.areas (site_id, lower(name)) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Assignments (positions / workstations inside an area)
-- -----------------------------------------------------------------------------
create table app.assignments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default app.current_org_id() references app.organizations (id),
  area_id            uuid not null,
  name               text not null check (length(trim(name)) between 1 and 120),
  code               text check (length(code) <= 20),
  required_position  text,                         -- e.g. RN: only RNs can fill / pick up
  display_order      int not null default 0,
  status             app.record_status not null default 'active',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  unique (id, organization_id),
  foreign key (area_id, organization_id) references app.areas (id, organization_id)
);
create index assignments_area_idx on app.assignments (area_id, display_order);

-- -----------------------------------------------------------------------------
-- Employee areas (where someone may work)
-- -----------------------------------------------------------------------------
create table app.employee_areas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.current_org_id() references app.organizations (id),
  employee_id      uuid not null,
  area_id          uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique (employee_id, area_id),
  foreign key (employee_id, organization_id) references app.profiles (id, organization_id) on delete cascade,
  foreign key (area_id, organization_id) references app.areas (id, organization_id) on delete cascade
);
create index employee_areas_area_idx on app.employee_areas (area_id);

-- -----------------------------------------------------------------------------
-- Availability (weekly times an employee can NOT work)
-- -----------------------------------------------------------------------------
create table app.availability (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.current_org_id() references app.organizations (id),
  employee_id      uuid not null default app.current_user_id(),
  weekday          smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time       time not null,
  end_time         time not null,                                       -- '24:00' = end of day
  note             text check (length(note) <= 200),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  check (start_time < end_time),
  foreign key (employee_id, organization_id) references app.profiles (id, organization_id) on delete cascade
);
create index availability_employee_idx on app.availability (employee_id, weekday);

-- -----------------------------------------------------------------------------
-- Shift templates (Day / Evening / Night …)
-- -----------------------------------------------------------------------------
create table app.shift_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.current_org_id() references app.organizations (id),
  name             text not null check (length(trim(name)) between 1 and 60),
  start_time       time not null,
  end_time         time not null,                                       -- end < start = overnight
  color            text not null default '#0f766e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_default       boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz,
  check (start_time <> end_time),
  unique (id, organization_id)
);
create unique index shift_templates_name_idx on app.shift_templates (organization_id, lower(name)) where deleted_at is null;

-- Every new organization gets the three standard templates
create or replace function app.tg_default_shift_templates()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  insert into app.shift_templates (organization_id, name, start_time, end_time, color, is_default, created_by)
  values
    (new.id, 'Day',     '07:00', '15:00', '#f59e0b', true, new.created_by),
    (new.id, 'Evening', '15:00', '23:00', '#6366f1', true, new.created_by),
    (new.id, 'Night',   '23:00', '07:00', '#1e293b', true, new.created_by);
  return new;
end
$$;

create trigger default_shift_templates after insert on app.organizations
  for each row execute function app.tg_default_shift_templates();

-- backfill for organizations created before this migration
insert into app.shift_templates (organization_id, name, start_time, end_time, color, is_default)
select o.id, t.name, t.s::time, t.e::time, t.c, true
from app.organizations o
cross join (values ('Day', '07:00', '15:00', '#f59e0b'),
                   ('Evening', '15:00', '23:00', '#6366f1'),
                   ('Night', '23:00', '07:00', '#1e293b')) as t(name, s, e, c)
where not exists (select 1 from app.shift_templates st where st.organization_id = o.id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger touch before insert or update on app.sites           for each row execute function app.tg_touch();
create trigger touch before insert or update on app.areas           for each row execute function app.tg_touch();
create trigger touch before insert or update on app.assignments     for each row execute function app.tg_touch();
create trigger touch before insert or update on app.employee_areas  for each row execute function app.tg_touch();
create trigger touch before insert or update on app.availability    for each row execute function app.tg_touch();
create trigger touch before insert or update on app.shift_templates for each row execute function app.tg_touch();

-- organization_id is immutable on all of these
create or replace function app.tg_immutable_org()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization cannot be changed' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger immutable_org before update on app.sites           for each row execute function app.tg_immutable_org();
create trigger immutable_org before update on app.areas           for each row execute function app.tg_immutable_org();
create trigger immutable_org before update on app.assignments     for each row execute function app.tg_immutable_org();
create trigger immutable_org before update on app.employee_areas  for each row execute function app.tg_immutable_org();
create trigger immutable_org before update on app.availability    for each row execute function app.tg_immutable_org();
create trigger immutable_org before update on app.shift_templates for each row execute function app.tg_immutable_org();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table app.sites           enable row level security;
alter table app.areas           enable row level security;
alter table app.assignments     enable row level security;
alter table app.employee_areas  enable row level security;
alter table app.availability    enable row level security;
alter table app.shift_templates enable row level security;

-- Structure tables: everyone in the org reads, managers write
do $$
declare
  t text;
begin
  foreach t in array array['sites', 'areas', 'assignments', 'shift_templates', 'employee_areas'] loop
    execute format(
      'create policy %1$s_select on app.%1$s for select to authenticated
         using (organization_id = app.current_org_id())', t);
    execute format(
      'create policy %1$s_insert on app.%1$s for insert to authenticated
         with check (organization_id = app.current_org_id() and app.is_manager())', t);
    execute format(
      'create policy %1$s_update on app.%1$s for update to authenticated
         using (organization_id = app.current_org_id() and app.is_manager())
         with check (organization_id = app.current_org_id() and app.is_manager())', t);
  end loop;
end
$$;

create policy employee_areas_delete on app.employee_areas for delete to authenticated
  using (organization_id = app.current_org_id() and app.is_manager());

-- Availability: employees manage their own; managers read everyone's in the org
create policy availability_select on app.availability for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (employee_id = app.current_user_id() or app.is_manager())
  );
create policy availability_insert on app.availability for insert to authenticated
  with check (organization_id = app.current_org_id() and employee_id = app.current_user_id());
create policy availability_update on app.availability for update to authenticated
  using (organization_id = app.current_org_id() and employee_id = app.current_user_id())
  with check (organization_id = app.current_org_id() and employee_id = app.current_user_id());
create policy availability_delete on app.availability for delete to authenticated
  using (organization_id = app.current_org_id() and employee_id = app.current_user_id());

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant select, insert, update on app.sites, app.areas, app.assignments, app.shift_templates to authenticated;
grant select, insert, update, delete on app.employee_areas, app.availability to authenticated;
grant execute on function app.tg_default_shift_templates(), app.tg_immutable_org() to authenticated;
