-- =============================================================================
-- ShiftHub — Phase D5: Notifications, push outbox, reminders, audit log
--
-- Notifications are written by triggers in the same transaction as the event
-- that causes them. Each row is also a push "outbox" entry (push_status) that
-- the job runner delivers to Expo. Jobs (reminders, expiry, push) are plain
-- functions so any scheduler can call them: pg_cron, Vercel Cron, EventBridge.
-- =============================================================================

create table app.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references app.organizations (id),
  user_id          uuid not null references app.profiles (id) on delete cascade,
  type             text not null check (type in (
                     'schedule_published', 'shift_assigned', 'shift_removed', 'shift_cancelled', 'shift_reminder',
                     'shift_available', 'pickup_requested', 'pickup_approved', 'pickup_rejected', 'shift_picked_up',
                     'swap_requested', 'swap_accepted', 'swap_declined', 'swap_waiting_approval',
                     'swap_approved', 'swap_rejected')),
  title            text not null,
  body             text not null,
  data             jsonb not null default '{}',
  read_at          timestamptz,
  push_status      text not null default 'pending' check (push_status in ('pending', 'sent', 'skipped', 'failed')),
  push_attempts    int not null default 0,
  pushed_at        timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_user_idx on app.notifications (user_id, created_at desc);
create index notifications_unread_idx on app.notifications (user_id) where read_at is null;
create index notifications_push_idx on app.notifications (created_at) where push_status = 'pending';

create table app.push_tokens (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references app.profiles (id) on delete cascade,
  token            text not null unique check (length(token) between 10 and 300),
  platform         text not null check (platform in ('ios', 'android', 'web')),
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index push_tokens_user_idx on app.push_tokens (user_id);

create table app.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  user_id          uuid,
  action           text not null,          -- insert | update | delete
  entity_type      text not null,          -- table name
  entity_id        uuid,
  details          jsonb not null default '{}',
  created_at       timestamptz not null default now()
);
create index audit_logs_org_idx on app.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on app.audit_logs (entity_type, entity_id);

alter table app.shifts add column reminder_sent_at timestamptz;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table app.notifications enable row level security;
alter table app.push_tokens   enable row level security;
alter table app.audit_logs    enable row level security;

create policy notifications_select on app.notifications for select to authenticated
  using (user_id = app.current_user_id());
create policy notifications_update on app.notifications for update to authenticated
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy push_tokens_all on app.push_tokens for all to authenticated
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy audit_select on app.audit_logs for select to authenticated
  using (organization_id = app.current_org_id() and app.is_manager());

grant select on app.notifications, app.audit_logs to authenticated;
grant update (read_at) on app.notifications to authenticated;
grant select, insert, update, delete on app.push_tokens to authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- "Thu Nov 12, 07:00–15:00 · Birch Unit" in the area's local time
create or replace function app.describe_shift(p_shift_id uuid)
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select to_char(s.starts_at at time zone z.tz, 'Dy Mon FMDD, HH24:MI') || '–' ||
         to_char(s.ends_at at time zone z.tz, 'HH24:MI') || ' · ' || a.name
  from app.shifts s
  join app.areas a on a.id = s.area_id
  cross join lateral (select app.area_timezone(s.area_id) as tz) z
  where s.id = p_shift_id
$$;

create or replace function app.notify(p_user uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  insert into app.notifications (organization_id, user_id, type, title, body, data)
  select p.organization_id, p.id, p_type, p_title, p_body, coalesce(p_data, '{}')
  from app.profiles p
  where p.id = p_user and p.organization_id is not null and p.status = 'active' and p.deleted_at is null
$$;

create or replace function app.notify_managers(p_org uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  select app.notify(p.id, p_type, p_title, p_body, p_data)
  from app.profiles p
  where p.organization_id = p_org and p.role in ('manager', 'org_admin')
    and p.status = 'active' and p.deleted_at is null
$$;

create or replace function app.person_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select coalesce((select name from app.profiles where id = p_id), 'A coworker')
$$;

-- -----------------------------------------------------------------------------
-- Shift notifications (assignment changes, cancellations, single publishes)
-- Trades set app.in_trade and bulk publish sets app.bulk_publish, so those
-- send their own, clearer notifications instead.
-- -----------------------------------------------------------------------------
create or replace function app.tg_shifts_notify()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_actor uuid := app.current_user_id();
  v_desc text;
  v_data jsonb := jsonb_build_object('shiftId', new.id);
begin
  if coalesce(current_setting('app.in_trade', true), '') = 'on'
     or coalesce(current_setting('app.bulk_publish', true), '') = 'on'
     or new.deleted_at is not null then
    return null;
  end if;
  v_desc := app.describe_shift(new.id);

  if tg_op = 'INSERT' then
    if new.status = 'published' and new.employee_id is not null and new.employee_id is distinct from v_actor then
      perform app.notify(new.employee_id, 'shift_assigned', 'New shift', 'You have a new shift: ' || v_desc, v_data);
    end if;
    return null;
  end if;

  -- draft -> published (single shift)
  if old.status = 'draft' and new.status = 'published' and new.employee_id is not null then
    perform app.notify(new.employee_id, 'shift_assigned', 'New shift', 'You have a new shift: ' || v_desc, v_data);
  -- published -> cancelled
  elsif old.status = 'published' and new.status = 'cancelled' and old.employee_id is not null then
    perform app.notify(old.employee_id, 'shift_cancelled', 'Shift cancelled', 'Your shift was cancelled: ' || v_desc, v_data);
  -- reassigned while published
  elsif new.status = 'published' and old.status = 'published' and new.employee_id is distinct from old.employee_id then
    if new.employee_id is not null and new.employee_id is distinct from v_actor then
      perform app.notify(new.employee_id, 'shift_assigned', 'New shift', 'You have a new shift: ' || v_desc, v_data);
    end if;
    if old.employee_id is not null and old.employee_id is distinct from v_actor then
      perform app.notify(old.employee_id, 'shift_removed', 'Shift removed', 'You are no longer scheduled for ' || v_desc, v_data);
    end if;
  -- time changed on a published shift
  elsif new.status = 'published' and new.employee_id is not null
        and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at) and new.employee_id is distinct from v_actor then
    perform app.notify(new.employee_id, 'shift_assigned', 'Shift changed', 'Your shift moved to ' || v_desc, v_data);
  end if;
  return null;
end
$$;

create trigger notify after insert or update on app.shifts
  for each row execute function app.tg_shifts_notify();

-- Bulk publish: one notification per person instead of one per shift
create or replace function app.publish_shifts(p_from date, p_to date, p_area_id uuid default null)
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_count int;
  r record;
begin
  if not app.is_manager() then
    raise exception 'only managers can publish schedules' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  perform set_config('app.bulk_publish', 'on', true);
  create temp table if not exists _published (id uuid, employee_id uuid) on commit drop;
  truncate _published;

  with updated as (
    update app.shifts s
       set status = 'published'
     where s.organization_id = app.current_org_id()
       and s.status = 'draft'
       and s.deleted_at is null
       and (p_area_id is null or s.area_id = p_area_id)
       and (s.starts_at at time zone app.area_timezone(s.area_id))::date between p_from and p_to
    returning s.id, s.employee_id
  )
  insert into _published select * from updated;
  get diagnostics v_count = row_count;
  perform set_config('app.bulk_publish', '', true);

  for r in select employee_id, count(*) as n from _published where employee_id is not null group by employee_id loop
    perform app.notify(r.employee_id, 'schedule_published', 'New schedule',
      format('Your schedule for %s – %s is out: %s shift%s.', to_char(p_from, 'Mon FMDD'), to_char(p_to, 'Mon FMDD'),
             r.n, case when r.n = 1 then '' else 's' end),
      jsonb_build_object('from', p_from, 'to', p_to));
  end loop;
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- Trade notifications
-- -----------------------------------------------------------------------------

-- Mark trade execution so shift triggers stay quiet (the trade explains itself)
create or replace function app.begin_trade() returns void
language sql as $$ select set_config('app.in_trade', 'on', true) $$;
create or replace function app.end_trade() returns void
language sql as $$ select set_config('app.in_trade', '', true) $$;

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

  update app.shift_offers set status = 'filled', filled_by = v_req.employee_id, filled_at = now() where id = v_offer.id;
  update app.shift_offer_requests set status = 'approved', decided_at = now(), decided_by = app.current_user_id()
   where id = v_req.id;
  update app.shift_offer_requests set status = 'rejected', decided_at = now(), decided_by = app.current_user_id()
   where offer_id = v_offer.id and id <> v_req.id and status = 'pending';
  perform app.begin_trade();
  update app.shifts set employee_id = v_req.employee_id where id = v_shift.id;
  perform app.end_trade();
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
  perform app.begin_trade();
  update app.shifts set employee_id = null where id = w.target_shift_id;
  update app.shifts set employee_id = w.target_id where id = w.requester_shift_id;
  update app.shifts set employee_id = w.requester_id where id = w.target_shift_id;
  perform app.end_trade();
end
$$;

-- New offer → eligible, free coworkers. Filled → the person who gave it away.
create or replace function app.tg_offers_notify()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_shift app.shifts;
  v_desc text;
begin
  select * into v_shift from app.shifts where id = new.shift_id;
  v_desc := app.describe_shift(new.shift_id);

  if tg_op = 'INSERT' then
    perform app.notify(p.id, 'shift_available', 'Shift available',
             coalesce(app.person_name(new.offered_by) || ' is giving away ', 'Open shift: ') || v_desc,
             jsonb_build_object('offerId', new.id, 'shiftId', new.shift_id))
    from app.profiles p
    where p.organization_id = new.organization_id
      and p.status = 'active' and p.deleted_at is null
      and p.id is distinct from new.offered_by
      and app.is_eligible(p.id, v_shift.area_id, v_shift.assignment_id)
      and not app.has_overlap(p.id, v_shift.starts_at, v_shift.ends_at)
    limit 500;
  elsif old.status = 'open' and new.status = 'filled' and new.offered_by is not null then
    perform app.notify(new.offered_by, 'shift_picked_up', 'Shift picked up',
             app.person_name(new.filled_by) || ' is taking your shift: ' || v_desc,
             jsonb_build_object('offerId', new.id, 'shiftId', new.shift_id));
  end if;
  return null;
end
$$;

create trigger notify after insert or update of status on app.shift_offers
  for each row execute function app.tg_offers_notify();

-- Request waiting → managers (when approval is required). Decided → requester.
create or replace function app.tg_offer_requests_notify()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_offer app.shift_offers;
  v_desc text;
  v_needs_approval boolean;
begin
  select * into v_offer from app.shift_offers where id = new.offer_id;
  v_desc := app.describe_shift(v_offer.shift_id);

  if tg_op = 'INSERT' then
    select require_approval into v_needs_approval from app.org_settings where organization_id = new.organization_id;
    if v_needs_approval then
      perform app.notify_managers(new.organization_id, 'pickup_requested', 'Pickup request',
        app.person_name(new.employee_id) || ' wants ' || v_desc,
        jsonb_build_object('requestId', new.id, 'offerId', new.offer_id, 'shiftId', v_offer.shift_id));
    end if;
  elsif old.status = 'pending' and new.status = 'approved' then
    perform app.notify(new.employee_id, 'pickup_approved', 'It’s yours',
      'You picked up ' || v_desc, jsonb_build_object('requestId', new.id, 'shiftId', v_offer.shift_id));
  elsif old.status = 'pending' and new.status = 'rejected' then
    perform app.notify(new.employee_id, 'pickup_rejected', 'Pickup not approved',
      'Your request for ' || v_desc || ' was not approved', jsonb_build_object('requestId', new.id, 'shiftId', v_offer.shift_id));
  end if;
  return null;
end
$$;

create trigger notify after insert or update of status on app.shift_offer_requests
  for each row execute function app.tg_offer_requests_notify();

create or replace function app.tg_swaps_notify()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_data jsonb := jsonb_build_object('swapId', new.id);
  v_req text := app.person_name(new.requester_id);
  v_tgt text := app.person_name(new.target_id);
  v_give text := app.describe_shift(new.requester_shift_id);
  v_get text := app.describe_shift(new.target_shift_id);
begin
  if tg_op = 'INSERT' then
    perform app.notify(new.target_id, 'swap_requested', 'Swap request',
      format('%s wants to swap: you’d work %s instead of %s', v_req, v_give, v_get), v_data);
    return null;
  end if;
  if new.status = old.status then
    return null;
  end if;

  if new.status = 'pending_manager' then
    perform app.notify(new.requester_id, 'swap_accepted', 'Swap accepted',
      v_tgt || ' accepted your swap. Waiting for a manager.', v_data);
    perform app.notify_managers(new.organization_id, 'swap_waiting_approval', 'Swap to approve',
      format('%s and %s want to swap %s ↔ %s', v_req, v_tgt, v_give, v_get), v_data);
  elsif new.status = 'declined' then
    perform app.notify(new.requester_id, 'swap_declined', 'Swap declined', v_tgt || ' declined your swap.', v_data);
  elsif new.status = 'approved' then
    perform app.notify(new.requester_id, 'swap_approved', 'Swap done', 'You now work ' || v_get, v_data);
    perform app.notify(new.target_id, 'swap_approved', 'Swap done', 'You now work ' || v_give, v_data);
  elsif new.status = 'rejected' then
    perform app.notify(new.requester_id, 'swap_rejected', 'Swap not approved', 'Your swap with ' || v_tgt || ' was not approved.', v_data);
    perform app.notify(new.target_id, 'swap_rejected', 'Swap not approved', 'Your swap with ' || v_req || ' was not approved.', v_data);
  end if;
  return null;
end
$$;

create trigger notify after insert or update of status on app.shift_swaps
  for each row execute function app.tg_swaps_notify();

-- -----------------------------------------------------------------------------
-- Jobs (owner-only; called by the scheduler / job runner)
-- -----------------------------------------------------------------------------

-- Remind people ~12h before their published shifts. Idempotent via reminder_sent_at.
create or replace function app.send_shift_reminders(p_hours int default 12)
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, employee_id from app.shifts
    where status = 'published' and deleted_at is null and employee_id is not null
      and reminder_sent_at is null
      and starts_at > now() and starts_at <= now() + make_interval(hours => p_hours)
    for update skip locked
  loop
    perform app.notify(r.employee_id, 'shift_reminder', 'Upcoming shift', 'Reminder: ' || app.describe_shift(r.id),
                       jsonb_build_object('shiftId', r.id));
    update app.shifts set reminder_sent_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- Client RPCs
-- -----------------------------------------------------------------------------
create or replace function app.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_count int;
begin
  update app.notifications set read_at = now()
   where user_id = app.current_user_id() and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function app.register_push_token(p_token text, p_platform text)
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  insert into app.push_tokens (user_id, token, platform)
  values (app.current_user_id(), p_token, p_platform)
  on conflict (token) do update
     set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now()
$$;

-- -----------------------------------------------------------------------------
-- Audit log (generic; records who changed what)
-- -----------------------------------------------------------------------------
create or replace function app.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_details jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k)), '{}')
      into v_details
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at', 'updated_by', 'push_status', 'push_attempts', 'pushed_at')
       and v_new -> k is distinct from v_old -> k;
    if v_details = '{}' then
      return null;
    end if;
  else
    v_details := v_row - 'created_at' - 'updated_at' - 'created_by' - 'updated_by';
  end if;

  insert into app.audit_logs (organization_id, user_id, action, entity_type, entity_id, details)
  values (
    coalesce((v_row ->> 'organization_id')::uuid, (v_row ->> 'id')::uuid),
    app.current_user_id(),
    lower(tg_op),
    tg_table_name,
    coalesce((v_row ->> 'id')::uuid, (v_row ->> 'organization_id')::uuid),
    v_details
  );
  return null;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['shifts', 'shift_offers', 'shift_offer_requests', 'shift_swaps', 'org_settings',
                           'organizations', 'profiles', 'invitations', 'sites', 'areas', 'assignments',
                           'shift_templates', 'employee_areas'] loop
    execute format('create trigger audit after insert or update or delete on app.%I
                    for each row execute function app.tg_audit()', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on function app.send_shift_reminders(int), app.notify(uuid, text, text, text, jsonb),
  app.notify_managers(uuid, text, text, text, jsonb), app.begin_trade(), app.end_trade() from public;

grant execute on function
  app.describe_shift(uuid),
  app.person_name(uuid),
  app.mark_notifications_read(uuid[]),
  app.register_push_token(text, text),
  app.tg_shifts_notify(),
  app.tg_offers_notify(),
  app.tg_offer_requests_notify(),
  app.tg_swaps_notify(),
  app.tg_audit()
to authenticated;
