-- =============================================================================
-- ShiftHub — Phase D4: Shift marketplace (give away / pick up) and swaps
--
-- All state changes go through security-definer RPCs that re-validate
-- everything at decision time (ownership, eligibility, overlaps, settings).
-- Tables are read-only for clients (SELECT via RLS).
-- =============================================================================

create type app.offer_status   as enum ('open', 'filled', 'cancelled', 'expired');
create type app.request_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type app.swap_status    as enum ('pending_peer', 'pending_manager', 'approved', 'rejected', 'declined', 'cancelled');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table app.shift_offers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references app.organizations (id),
  shift_id         uuid not null,
  offered_by       uuid,                       -- null = posted by a manager (open slot)
  status           app.offer_status not null default 'open',
  reason           text check (length(reason) <= 300),
  expires_at       timestamptz not null,       -- defaults to the shift start
  filled_by        uuid,
  filled_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  unique (id, organization_id),
  foreign key (shift_id, organization_id) references app.shifts (id, organization_id),
  foreign key (offered_by, organization_id) references app.profiles (id, organization_id),
  foreign key (filled_by, organization_id) references app.profiles (id, organization_id)
);
create unique index shift_offers_one_open_idx on app.shift_offers (shift_id) where status = 'open';
create index shift_offers_org_open_idx on app.shift_offers (organization_id, expires_at) where status = 'open';

create table app.shift_offer_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references app.organizations (id),
  offer_id         uuid not null,
  employee_id      uuid not null,
  status           app.request_status not null default 'pending',
  note             text check (length(note) <= 300),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  foreign key (offer_id, organization_id) references app.shift_offers (id, organization_id),
  foreign key (employee_id, organization_id) references app.profiles (id, organization_id)
);
create unique index offer_requests_one_active_idx on app.shift_offer_requests (offer_id, employee_id)
  where status in ('pending', 'approved');
create index offer_requests_offer_idx on app.shift_offer_requests (offer_id, created_at);

create table app.shift_swaps (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references app.organizations (id),
  requester_id        uuid not null,
  target_id           uuid not null,
  requester_shift_id  uuid not null,
  target_shift_id     uuid not null,
  status              app.swap_status not null default 'pending_peer',
  note                text check (length(note) <= 300),
  peer_responded_at   timestamptz,
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  check (requester_id <> target_id and requester_shift_id <> target_shift_id),
  foreign key (requester_id, organization_id) references app.profiles (id, organization_id),
  foreign key (target_id, organization_id) references app.profiles (id, organization_id),
  foreign key (requester_shift_id, organization_id) references app.shifts (id, organization_id),
  foreign key (target_shift_id, organization_id) references app.shifts (id, organization_id)
);
create index shift_swaps_requester_idx on app.shift_swaps (requester_id, created_at desc);
create index shift_swaps_target_idx on app.shift_swaps (target_id, created_at desc);
create index shift_swaps_active_idx on app.shift_swaps (organization_id)
  where status in ('pending_peer', 'pending_manager');

create trigger touch before insert or update on app.shift_offers         for each row execute function app.tg_touch();
create trigger touch before insert or update on app.shift_offer_requests for each row execute function app.tg_touch();
create trigger touch before insert or update on app.shift_swaps          for each row execute function app.tg_touch();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function app.org_setting(p_name text)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select (to_jsonb(s) ->> p_name)::boolean from app.org_settings s where s.organization_id = app.current_org_id()
$$;

-- Does p_employee have a non-cancelled shift overlapping [p_start, p_end), other than p_ignore?
create or replace function app.has_overlap(p_employee uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid[] default '{}')
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
    select 1 from app.shifts s
    where s.employee_id = p_employee and s.deleted_at is null and s.status <> 'cancelled'
      and not (s.id = any(p_ignore))
      and tstzrange(s.starts_at, s.ends_at) && tstzrange(p_start, p_end)
  )
$$;

-- Is this shift on the marketplace, in an offer the caller made/filled, or in a swap involving the caller?
create or replace function app.shift_visible_via_trade(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
      select 1 from app.shift_offers o
      where o.shift_id = p_shift_id and o.organization_id = app.current_org_id()
        and (o.status = 'open' or app.current_user_id() in (o.offered_by, o.filled_by))
    )
    or exists (
      select 1 from app.shift_swaps w
      where (w.requester_shift_id = p_shift_id or w.target_shift_id = p_shift_id)
        and app.current_user_id() in (w.requester_id, w.target_id)
    )
$$;

-- Shifts on the marketplace or in my swaps become visible to me
drop policy shifts_select on app.shifts;
create policy shifts_select on app.shifts for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (
      app.is_manager()
      or (employee_id = app.current_user_id() and (status <> 'draft' or created_by = app.current_user_id()))
      or (status = 'published' and employee_id is not null and app.shares_schedule(employee_id))
      or (status = 'published' and app.shift_visible_via_trade(id))
    )
  );

-- When a shift changes hands, is cancelled or deleted outside of a trade,
-- any open offer / live swap on it is no longer valid.
create or replace function app.tg_shifts_cancel_trades()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if new.employee_id is distinct from old.employee_id
     or new.status = 'cancelled' or new.deleted_at is not null
     or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    update app.shift_offers set status = 'cancelled'
     where shift_id = new.id and status = 'open';
    update app.shift_offer_requests r set status = 'rejected', decided_at = now()
      from app.shift_offers o
     where r.offer_id = o.id and o.shift_id = new.id and r.status = 'pending' and o.status = 'cancelled';
    update app.shift_swaps set status = 'cancelled'
     where (requester_shift_id = new.id or target_shift_id = new.id)
       and status in ('pending_peer', 'pending_manager');
  end if;
  return null;
end
$$;

create trigger cancel_trades after update on app.shifts
  for each row execute function app.tg_shifts_cancel_trades();

-- Mark offers whose shift has started (or whose expiry passed) as expired. For a cron job.
create or replace function app.expire_offers()
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_count int;
begin
  update app.shift_offers set status = 'expired' where status = 'open' and expires_at <= now();
  get diagnostics v_count = row_count;
  update app.shift_offer_requests r set status = 'rejected', decided_at = now()
    from app.shift_offers o
   where r.offer_id = o.id and o.status = 'expired' and r.status = 'pending';
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- RLS (read-only for clients)
-- -----------------------------------------------------------------------------
alter table app.shift_offers         enable row level security;
alter table app.shift_offer_requests enable row level security;
alter table app.shift_swaps          enable row level security;

create policy offers_select on app.shift_offers for select to authenticated
  using (organization_id = app.current_org_id());

-- requesters see their own requests; managers and the offerer see all requests on an offer
create policy offer_requests_select on app.shift_offer_requests for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (
      employee_id = app.current_user_id()
      or app.is_manager()
      or exists (select 1 from app.shift_offers o where o.id = offer_id and o.offered_by = app.current_user_id())
    )
  );

create policy swaps_select on app.shift_swaps for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (app.current_user_id() in (requester_id, target_id) or app.is_manager())
  );

grant select on app.shift_offers, app.shift_offer_requests, app.shift_swaps to authenticated;

-- -----------------------------------------------------------------------------
-- Marketplace RPCs
-- -----------------------------------------------------------------------------

-- Put a shift on the marketplace. Employees: their own future published shift.
-- Managers: any future published shift, including open (unassigned) slots.
create or replace function app.offer_shift(p_shift_id uuid, p_reason text default null)
returns app.shift_offers
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_shift app.shifts;
  v_row app.shift_offers;
begin
  if not coalesce(app.org_setting('allow_pickup'), false) then
    raise exception 'shift pickups are turned off for this organization' using errcode = '42501';
  end if;

  select * into v_shift from app.shifts
   where id = p_shift_id and organization_id = app.current_org_id() and deleted_at is null
   for update;
  if not found then
    raise exception 'shift not found' using errcode = 'P0002';
  end if;
  if v_shift.employee_id is distinct from v_uid and not app.is_manager() then
    raise exception 'you can only offer your own shifts' using errcode = '42501';
  end if;
  if v_shift.status <> 'published' then
    raise exception 'only published shifts can be offered' using errcode = '55000';
  end if;
  if v_shift.starts_at <= now() then
    raise exception 'this shift has already started' using errcode = '55000';
  end if;
  if exists (select 1 from app.shift_swaps where (requester_shift_id = p_shift_id or target_shift_id = p_shift_id)
               and status in ('pending_peer', 'pending_manager')) then
    raise exception 'this shift is part of a pending swap' using errcode = '55000';
  end if;
  if exists (select 1 from app.shift_offers where shift_id = p_shift_id and status = 'open') then
    raise exception 'this shift is already on the marketplace' using errcode = '55000';
  end if;

  insert into app.shift_offers (organization_id, shift_id, offered_by, reason, expires_at, created_by)
  values (v_shift.organization_id, p_shift_id,
          case when v_shift.employee_id = v_uid then v_uid else v_shift.employee_id end,
          nullif(trim(p_reason), ''), v_shift.starts_at, v_uid)
  returning * into v_row;
  return v_row;
end
$$;

create or replace function app.cancel_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_offer app.shift_offers;
begin
  select * into v_offer from app.shift_offers
   where id = p_offer_id and organization_id = app.current_org_id() for update;
  if not found then
    raise exception 'offer not found' using errcode = 'P0002';
  end if;
  if v_offer.offered_by is distinct from app.current_user_id() and not app.is_manager() then
    raise exception 'only the person who offered the shift or a manager can cancel it' using errcode = '42501';
  end if;
  if v_offer.status <> 'open' then
    raise exception 'offer is no longer open' using errcode = '55000';
  end if;
  update app.shift_offers set status = 'cancelled' where id = p_offer_id;
  update app.shift_offer_requests set status = 'rejected', decided_at = now(), decided_by = app.current_user_id()
   where offer_id = p_offer_id and status = 'pending';
end
$$;

-- Hand the offered shift to the requester. Internal: callers check permissions.
create or replace function app._fill_offer(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.shift_offer_requests;
  v_offer app.shift_offers;
  v_shift app.shifts;
begin
  select * into v_req from app.shift_offer_requests where id = p_request_id for update;
  select * into v_offer from app.shift_offers where id = v_req.offer_id for update;
  select * into v_shift from app.shifts where id = v_offer.shift_id for update;

  if v_req.status <> 'pending' then
    raise exception 'request is no longer pending' using errcode = '55000';
  end if;
  if v_offer.status <> 'open' or v_offer.expires_at <= now() then
    raise exception 'offer is no longer open' using errcode = '55000';
  end if;
  if v_shift.deleted_at is not null or v_shift.status <> 'published'
     or v_shift.employee_id is distinct from v_offer.offered_by then
    raise exception 'the shift changed since it was offered' using errcode = '55000';
  end if;
  if not app.is_eligible(v_req.employee_id, v_shift.area_id, v_shift.assignment_id) then
    raise exception 'requester is not eligible for this shift' using errcode = '22023';
  end if;
  if app.has_overlap(v_req.employee_id, v_shift.starts_at, v_shift.ends_at) then
    raise exception 'requester already has a shift at that time' using errcode = '23P01';
  end if;

  -- mark the trade first so the shift trigger doesn't cancel it
  update app.shift_offers set status = 'filled', filled_by = v_req.employee_id, filled_at = now() where id = v_offer.id;
  update app.shift_offer_requests set status = 'approved', decided_at = now(), decided_by = app.current_user_id()
   where id = v_req.id;
  update app.shift_offer_requests set status = 'rejected', decided_at = now(), decided_by = app.current_user_id()
   where offer_id = v_offer.id and id <> v_req.id and status = 'pending';
  update app.shifts set employee_id = v_req.employee_id where id = v_shift.id;
end
$$;

-- Ask for an offered shift. Auto-approves when the org doesn't require approval.
create or replace function app.request_offer(p_offer_id uuid, p_note text default null)
returns app.shift_offer_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_offer app.shift_offers;
  v_shift app.shifts;
  v_row app.shift_offer_requests;
begin
  select * into v_offer from app.shift_offers
   where id = p_offer_id and organization_id = app.current_org_id() for update;
  if not found then
    raise exception 'offer not found' using errcode = 'P0002';
  end if;
  if v_offer.status <> 'open' or v_offer.expires_at <= now() then
    raise exception 'offer is no longer open' using errcode = '55000';
  end if;
  if v_offer.offered_by = v_uid then
    raise exception 'you cannot pick up your own shift' using errcode = '22023';
  end if;
  select * into v_shift from app.shifts where id = v_offer.shift_id;
  if not app.is_eligible(v_uid, v_shift.area_id, v_shift.assignment_id) then
    raise exception 'you are not eligible for this shift (area or position)' using errcode = '22023';
  end if;
  if app.has_overlap(v_uid, v_shift.starts_at, v_shift.ends_at) then
    raise exception 'you already have a shift at that time' using errcode = '23P01';
  end if;
  if exists (select 1 from app.shift_offer_requests where offer_id = p_offer_id and employee_id = v_uid and status = 'pending') then
    raise exception 'you already requested this shift' using errcode = '55000';
  end if;

  insert into app.shift_offer_requests (organization_id, offer_id, employee_id, note, created_by)
  values (v_offer.organization_id, p_offer_id, v_uid, nullif(trim(p_note), ''), v_uid)
  returning * into v_row;

  if not coalesce(app.org_setting('require_approval'), true) then
    perform app._fill_offer(v_row.id);
    select * into v_row from app.shift_offer_requests where id = v_row.id;
  end if;
  return v_row;
end
$$;

create or replace function app.withdraw_offer_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  update app.shift_offer_requests set status = 'withdrawn'
   where id = p_request_id and employee_id = app.current_user_id() and status = 'pending';
  if not found then
    raise exception 'request not found or no longer pending' using errcode = 'P0002';
  end if;
end
$$;

-- Manager decision on a pickup request
create or replace function app.decide_offer_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  if not app.is_manager() then
    raise exception 'only managers can approve requests' using errcode = '42501';
  end if;
  if not exists (select 1 from app.shift_offer_requests
                 where id = p_request_id and organization_id = app.current_org_id()) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if p_approve then
    perform app._fill_offer(p_request_id);
  else
    update app.shift_offer_requests set status = 'rejected', decided_at = now(), decided_by = app.current_user_id()
     where id = p_request_id and status = 'pending';
    if not found then
      raise exception 'request is no longer pending' using errcode = '55000';
    end if;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Swap RPCs
-- -----------------------------------------------------------------------------

-- Validate a swap is still possible; raises if not.
create or replace function app._check_swap(p_swap app.shift_swaps)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  a app.shifts;   -- requester's shift (goes to target)
  b app.shifts;   -- target's shift (goes to requester)
begin
  select * into a from app.shifts where id = p_swap.requester_shift_id for update;
  select * into b from app.shifts where id = p_swap.target_shift_id for update;
  if a.deleted_at is not null or b.deleted_at is not null or a.status <> 'published' or b.status <> 'published' then
    raise exception 'both shifts must be published' using errcode = '55000';
  end if;
  if a.employee_id is distinct from p_swap.requester_id or b.employee_id is distinct from p_swap.target_id then
    raise exception 'one of the shifts changed hands' using errcode = '55000';
  end if;
  if a.starts_at <= now() or b.starts_at <= now() then
    raise exception 'one of the shifts has already started' using errcode = '55000';
  end if;
  if not app.is_eligible(p_swap.target_id, a.area_id, a.assignment_id) then
    raise exception 'your coworker is not eligible for your shift' using errcode = '22023';
  end if;
  if not app.is_eligible(p_swap.requester_id, b.area_id, b.assignment_id) then
    raise exception 'you are not eligible for your coworker''s shift' using errcode = '22023';
  end if;
  if app.has_overlap(p_swap.target_id, a.starts_at, a.ends_at, array[b.id]) then
    raise exception 'your coworker already works at that time' using errcode = '23P01';
  end if;
  if app.has_overlap(p_swap.requester_id, b.starts_at, b.ends_at, array[a.id]) then
    raise exception 'you already work at that time' using errcode = '23P01';
  end if;
end
$$;

create or replace function app._execute_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  w app.shift_swaps;
begin
  select * into w from app.shift_swaps where id = p_swap_id for update;
  perform app._check_swap(w);
  update app.shift_swaps set status = 'approved', decided_at = now(), decided_by = app.current_user_id()
   where id = p_swap_id;
  -- free one side first so the overlap trigger never sees both people on both shifts
  update app.shifts set employee_id = null where id = w.target_shift_id;
  update app.shifts set employee_id = w.target_id where id = w.requester_shift_id;
  update app.shifts set employee_id = w.requester_id where id = w.target_shift_id;
end
$$;

create or replace function app.request_swap(p_my_shift_id uuid, p_their_shift_id uuid, p_note text default null)
returns app.shift_swaps
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_target uuid;
  v_row app.shift_swaps;
begin
  if not coalesce(app.org_setting('allow_swaps'), false) then
    raise exception 'shift swaps are turned off for this organization' using errcode = '42501';
  end if;
  if not exists (select 1 from app.shifts where id = p_my_shift_id and employee_id = v_uid
                 and organization_id = app.current_org_id()) then
    raise exception 'you can only swap your own shifts' using errcode = '42501';
  end if;
  select employee_id into v_target from app.shifts
   where id = p_their_shift_id and organization_id = app.current_org_id() and deleted_at is null;
  if v_target is null or v_target = v_uid then
    raise exception 'pick a coworker''s shift to swap with' using errcode = '22023';
  end if;
  if exists (select 1 from app.shift_swaps
             where status in ('pending_peer', 'pending_manager')
               and (requester_shift_id in (p_my_shift_id, p_their_shift_id) or target_shift_id in (p_my_shift_id, p_their_shift_id))) then
    raise exception 'one of these shifts is already in a pending swap' using errcode = '55000';
  end if;
  if exists (select 1 from app.shift_offers where shift_id in (p_my_shift_id, p_their_shift_id) and status = 'open') then
    raise exception 'one of these shifts is on the marketplace' using errcode = '55000';
  end if;

  v_row := row(gen_random_uuid(), app.current_org_id(), v_uid, v_target, p_my_shift_id, p_their_shift_id,
               'pending_peer', nullif(trim(p_note), ''), null, null, null, now(), now(), v_uid, v_uid)::app.shift_swaps;
  perform app._check_swap(v_row);
  insert into app.shift_swaps select v_row.*;
  return v_row;
end
$$;

-- Coworker accepts or declines. Accepting executes immediately unless approval is required.
create or replace function app.respond_swap(p_swap_id uuid, p_accept boolean)
returns app.swap_status
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  w app.shift_swaps;
begin
  select * into w from app.shift_swaps
   where id = p_swap_id and organization_id = app.current_org_id() for update;
  if not found or w.target_id <> app.current_user_id() then
    raise exception 'swap not found' using errcode = 'P0002';
  end if;
  if w.status <> 'pending_peer' then
    raise exception 'swap is no longer waiting for you' using errcode = '55000';
  end if;

  if not p_accept then
    update app.shift_swaps set status = 'declined', peer_responded_at = now() where id = p_swap_id;
    return 'declined';
  end if;

  perform app._check_swap(w);
  update app.shift_swaps set peer_responded_at = now(), status = 'pending_manager' where id = p_swap_id;
  if not coalesce(app.org_setting('require_approval'), true) then
    perform app._execute_swap(p_swap_id);
    return 'approved';
  end if;
  return 'pending_manager';
end
$$;

create or replace function app.decide_swap(p_swap_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  w app.shift_swaps;
begin
  if not app.is_manager() then
    raise exception 'only managers can approve swaps' using errcode = '42501';
  end if;
  select * into w from app.shift_swaps
   where id = p_swap_id and organization_id = app.current_org_id() for update;
  if not found then
    raise exception 'swap not found' using errcode = 'P0002';
  end if;
  if w.status <> 'pending_manager' then
    raise exception 'swap is not waiting for a manager' using errcode = '55000';
  end if;
  if p_approve then
    perform app._execute_swap(p_swap_id);
  else
    update app.shift_swaps set status = 'rejected', decided_at = now(), decided_by = app.current_user_id()
     where id = p_swap_id;
  end if;
end
$$;

create or replace function app.cancel_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  update app.shift_swaps set status = 'cancelled'
   where id = p_swap_id and requester_id = app.current_user_id()
     and status in ('pending_peer', 'pending_manager');
  if not found then
    raise exception 'swap not found or no longer pending' using errcode = 'P0002';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Function privileges: public RPCs callable, internals not
-- -----------------------------------------------------------------------------
revoke execute on function app._fill_offer(uuid), app._check_swap(app.shift_swaps), app._execute_swap(uuid),
  app.expire_offers() from public;

grant execute on function
  app.org_setting(text),
  app.has_overlap(uuid, timestamptz, timestamptz, uuid[]),
  app.shift_visible_via_trade(uuid),
  app.offer_shift(uuid, text),
  app.cancel_offer(uuid),
  app.request_offer(uuid, text),
  app.withdraw_offer_request(uuid),
  app.decide_offer_request(uuid, boolean),
  app.request_swap(uuid, uuid, text),
  app.respond_swap(uuid, boolean),
  app.decide_swap(uuid, boolean),
  app.cancel_swap(uuid),
  app.tg_shifts_cancel_trades()
to authenticated;
