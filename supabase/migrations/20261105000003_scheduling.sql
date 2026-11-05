-- =============================================================================
-- ShiftHub — Phase D3: Scheduling
-- shifts (draft → published), visibility rules, double-booking guard,
-- publish_shifts() and copy_week() RPCs
--
-- One row = one person (or an open slot) in one assignment for one time range.
-- Times are timestamptz; "local" dates use the site timezone (or the org's).
-- =============================================================================

create type app.shift_status as enum ('draft', 'published', 'cancelled');

create table app.shifts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default app.current_org_id() references app.organizations (id),
  site_id            uuid not null,                 -- derived from area by trigger
  area_id            uuid not null,
  assignment_id      uuid,
  employee_id        uuid,                          -- null = unassigned / open slot
  shift_template_id  uuid,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  status             app.shift_status not null default 'draft',
  notes              text check (length(notes) <= 500),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  unique (id, organization_id),
  foreign key (site_id, organization_id) references app.sites (id, organization_id),
  foreign key (area_id, organization_id) references app.areas (id, organization_id),
  foreign key (assignment_id, organization_id) references app.assignments (id, organization_id),
  foreign key (employee_id, organization_id) references app.profiles (id, organization_id),
  foreign key (shift_template_id, organization_id) references app.shift_templates (id, organization_id)
);
create index shifts_org_time_idx on app.shifts (organization_id, starts_at) where deleted_at is null;
create index shifts_employee_time_idx on app.shifts (employee_id, starts_at) where deleted_at is null;
create index shifts_area_time_idx on app.shifts (area_id, starts_at) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Timezone used for an area's local dates
create or replace function app.area_timezone(p_area_id uuid)
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select coalesce(s.timezone, o.timezone)
  from app.areas a
  join app.sites s on s.id = a.site_id
  join app.organizations o on o.id = a.organization_id
  where a.id = p_area_id
$$;

-- Local date + start/end time → timestamptz range (end <= start means next day)
create or replace function app.local_range(p_date date, p_start time, p_end time, p_tz text,
                                           out starts_at timestamptz, out ends_at timestamptz)
language sql
immutable
as $$
  select (p_date + p_start) at time zone p_tz,
         (p_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0' end) at time zone p_tz
$$;

create or replace function app.shares_schedule(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select coalesce((select share_schedule from app.profiles where id = p_profile_id), false)
$$;

create or replace function app.self_scheduling_enabled()
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select coalesce((select allow_self_scheduling from app.org_settings
                   where organization_id = app.current_org_id()), false)
$$;

-- Can this employee work this area/assignment? (approved area + required position)
create or replace function app.is_eligible(p_employee_id uuid, p_area_id uuid, p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (select 1 from app.employee_areas where employee_id = p_employee_id and area_id = p_area_id)
     and coalesce((
       select x.required_position is null or x.required_position = p.position
       from app.assignments x, app.profiles p
       where x.id = p_assignment_id and p.id = p_employee_id
     ), true)
$$;

-- -----------------------------------------------------------------------------
-- Integrity trigger: derive site, check assignment/area, eligibility, overlaps
-- -----------------------------------------------------------------------------
create or replace function app.tg_shifts_validate()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_area app.areas;
  v_required text;
  v_assignment_area uuid;
  v_actor uuid := app.current_user_id();
begin
  -- soft delete / cancel never needs validation
  if tg_op = 'UPDATE' and (new.deleted_at is not null or new.status = 'cancelled') then
    return new;
  end if;

  select * into v_area from app.areas where id = new.area_id and organization_id = new.organization_id;
  if not found or (v_area.deleted_at is not null and (tg_op = 'INSERT' or new.area_id is distinct from old.area_id)) then
    raise exception 'area not found' using errcode = '23503';
  end if;
  new.site_id := v_area.site_id;

  if new.assignment_id is not null then
    select area_id, required_position into v_assignment_area, v_required
    from app.assignments where id = new.assignment_id;
    if v_assignment_area is distinct from new.area_id then
      raise exception 'assignment does not belong to this area' using errcode = '22023';
    end if;
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := now();
  end if;

  if new.employee_id is null or new.status = 'cancelled' or new.deleted_at is not null then
    return new;
  end if;

  -- Eligibility applies when someone else assigns the employee (not self-scheduling)
  if new.employee_id is distinct from v_actor
     and (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id
          or new.area_id is distinct from old.area_id or new.assignment_id is distinct from old.assignment_id) then
    if not exists (select 1 from app.employee_areas where employee_id = new.employee_id and area_id = new.area_id) then
      raise exception 'employee is not approved to work in this area' using errcode = '22023';
    end if;
    if not app.is_eligible(new.employee_id, new.area_id, new.assignment_id) then
      raise exception 'this assignment requires position %', v_required using errcode = '22023';
    end if;
  end if;

  -- No double booking (serialized per employee)
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text, 0));
  if exists (
    select 1 from app.shifts s
    where s.employee_id = new.employee_id
      and s.id <> new.id
      and s.deleted_at is null
      and s.status <> 'cancelled'
      and tstzrange(s.starts_at, s.ends_at) && tstzrange(new.starts_at, new.ends_at)
  ) then
    raise exception 'employee already has a shift that overlaps this time' using errcode = '23P01';
  end if;

  return new;
end
$$;

-- Permission guard, fired first. NOT security definer: current_user is
-- 'authenticated' for direct client writes and the function owner inside trusted
-- RPCs (copy_week, approvals), which therefore bypass it.
-- Needed because BEFORE triggers run before RLS WITH CHECK, and the overlap
-- check must not reveal coworkers' schedules to employees.
create or replace function app.tg_shifts_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and not app.is_manager()
     and (new.employee_id is distinct from app.current_user_id() or not app.self_scheduling_enabled()
          or (tg_op = 'UPDATE' and old.employee_id is distinct from app.current_user_id())) then
    raise exception 'not allowed to schedule this shift' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger a_guard before insert or update on app.shifts
  for each row execute function app.tg_shifts_guard();
create trigger validate before insert or update on app.shifts
  for each row execute function app.tg_shifts_validate();
create trigger touch before insert or update on app.shifts
  for each row execute function app.tg_touch();
create trigger immutable_org before update on app.shifts
  for each row execute function app.tg_immutable_org();

-- -----------------------------------------------------------------------------
-- RLS
--   Managers: everything in the org.
--   Employees: their own published/cancelled shifts (drafts stay hidden until
--   the manager publishes); coworkers' PUBLISHED shifts only
--   if that coworker opted in to share_schedule.
--   Self-scheduling (group mode): employees create/edit their own shifts.
-- -----------------------------------------------------------------------------
alter table app.shifts enable row level security;

create policy shifts_select on app.shifts for select to authenticated
  using (
    organization_id = app.current_org_id()
    and (
      app.is_manager()
      or (employee_id = app.current_user_id() and (status <> 'draft' or created_by = app.current_user_id()))
      or (status = 'published' and employee_id is not null and app.shares_schedule(employee_id))
    )
  );

create policy shifts_insert on app.shifts for insert to authenticated
  with check (
    organization_id = app.current_org_id()
    and (
      app.is_manager()
      or (employee_id = app.current_user_id() and app.self_scheduling_enabled())
    )
  );

create policy shifts_update on app.shifts for update to authenticated
  using (
    organization_id = app.current_org_id()
    and (
      app.is_manager()
      or (employee_id = app.current_user_id() and app.self_scheduling_enabled())
    )
  )
  with check (
    organization_id = app.current_org_id()
    and (
      app.is_manager()
      or (employee_id = app.current_user_id() and app.self_scheduling_enabled())
    )
  );

grant select, insert, update on app.shifts to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Publish drafts whose local start date is within [p_from, p_to]
create or replace function app.publish_shifts(p_from date, p_to date, p_area_id uuid default null)
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_count int;
begin
  if not app.is_manager() then
    raise exception 'only managers can publish schedules' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  update app.shifts s
     set status = 'published'
   where s.organization_id = app.current_org_id()
     and s.status = 'draft'
     and s.deleted_at is null
     and (p_area_id is null or s.area_id = p_area_id)
     and (s.starts_at at time zone app.area_timezone(s.area_id))::date between p_from and p_to;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Copy one week of shifts to another week as drafts.
-- Keeps local wall-clock times (DST-safe). If an employee would be double-booked,
-- the copy is created unassigned instead.
create or replace function app.copy_week(
  p_source_week_start date,
  p_target_week_start date,
  p_area_id uuid default null,
  p_include_employees boolean default true,
  out copied int,
  out unassigned int
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  r record;
  v_tz text;
  v_offset int := p_target_week_start - p_source_week_start;
  v_emp uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not app.is_manager() then
    raise exception 'only managers can copy schedules' using errcode = '42501';
  end if;
  if v_offset = 0 or v_offset % 7 <> 0 then
    raise exception 'target week must be a different week, a multiple of 7 days away' using errcode = '22023';
  end if;

  copied := 0;
  unassigned := 0;

  for r in
    select s.* from app.shifts s
    where s.organization_id = app.current_org_id()
      and s.deleted_at is null
      and s.status <> 'cancelled'
      and (p_area_id is null or s.area_id = p_area_id)
      and (s.starts_at at time zone app.area_timezone(s.area_id))::date
          between p_source_week_start and p_source_week_start + 6
    order by s.starts_at
  loop
    v_tz := app.area_timezone(r.area_id);
    v_start := ((r.starts_at at time zone v_tz) + make_interval(days => v_offset)) at time zone v_tz;
    v_end := ((r.ends_at at time zone v_tz) + make_interval(days => v_offset)) at time zone v_tz;
    v_emp := case when p_include_employees then r.employee_id end;

    if v_emp is not null and (
      exists (
        select 1 from app.shifts s
        where s.employee_id = v_emp and s.deleted_at is null and s.status <> 'cancelled'
          and tstzrange(s.starts_at, s.ends_at) && tstzrange(v_start, v_end)
      )
      or not app.is_eligible(v_emp, r.area_id, r.assignment_id)
    ) then
      v_emp := null;
      unassigned := unassigned + 1;
    end if;

    insert into app.shifts (organization_id, area_id, assignment_id, employee_id, shift_template_id,
                            starts_at, ends_at, status, notes, created_by)
    values (r.organization_id, r.area_id, r.assignment_id, v_emp, r.shift_template_id,
            v_start, v_end, 'draft', r.notes, app.current_user_id());
    copied := copied + 1;
  end loop;
end
$$;

grant execute on function
  app.area_timezone(uuid),
  app.local_range(date, time, time, text),
  app.shares_schedule(uuid),
  app.is_eligible(uuid, uuid, uuid),
  app.self_scheduling_enabled(),
  app.publish_shifts(date, date, uuid),
  app.copy_week(date, date, uuid, boolean),
  app.tg_shifts_validate(),
  app.tg_shifts_guard()
to authenticated;
