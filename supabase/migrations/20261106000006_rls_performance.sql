-- =============================================================================
-- ShiftHub — Phase D6: RLS performance
--
-- Per-user helper calls in policies (current_org_id(), is_manager(), …) are
-- wrapped as (select app.fn()) so Postgres evaluates them once per query
-- (an InitPlan) instead of once per row. Measured on 10k shifts: the weekly
-- schedule query went from ~300 ms to a few ms together with the API fix that
-- passes timestamptz bounds (which lets the time-range index be used under RLS).
--
-- Convention for future migrations: write policies with (select app.fn()).
-- =============================================================================

do $$
declare
  p record;
  v_using text;
  v_check text;
  fn text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'app' loop
    v_using := p.qual;
    v_check := p.with_check;
    foreach fn in array array['current_org_id', 'current_user_id', 'current_user_role', 'is_manager',
                              'is_org_admin', 'self_scheduling_enabled'] loop
      -- wrap bare calls only (skip ones already inside "(select …)")
      v_using := regexp_replace(v_using, '(?<!select )app\.' || fn || '\(\)', '(select app.' || fn || '())', 'g');
      v_check := regexp_replace(v_check, '(?<!select )app\.' || fn || '\(\)', '(select app.' || fn || '())', 'g');
    end loop;
    if v_using is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, v_using);
    end if;
    if v_check is not null then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, v_check);
    end if;
  end loop;
end
$$;

-- Lookups used by RLS helpers and trade checks
create index if not exists employee_areas_employee_idx on app.employee_areas (employee_id);
create index if not exists shift_offers_shift_idx on app.shift_offers (shift_id);
create index if not exists shift_swaps_requester_shift_idx on app.shift_swaps (requester_shift_id);
create index if not exists shift_swaps_target_shift_idx on app.shift_swaps (target_shift_id);
create index if not exists offer_requests_employee_idx on app.shift_offer_requests (employee_id, created_at desc);
