-- =============================================================================
-- ShiftHub seed data (local / staging only)
--   Org A: Maple Grove Care Home — facility mode, 100 people
--   Org B: Night Owls Crew       — group mode, 6 people
-- All names are fictional. Profile ids are deterministic so dev tokens can
-- be minted for them (see apps/api/scripts/dev-token.ts).
-- =============================================================================

begin;

-- seed data should not notify anyone
select set_config('app.bulk_publish', 'on', true);
select set_config('app.skip_audit', 'on', true);

insert into app.organizations (id, name, timezone) values
  ('00000000-0000-4000-a000-000000000001', 'Maple Grove Care Home', 'America/Toronto'),
  ('00000000-0000-4000-a000-000000000002', 'Night Owls Crew',       'America/Toronto');

insert into app.org_settings (organization_id, mode, require_approval, allow_self_scheduling, invite_code) values
  ('00000000-0000-4000-a000-000000000001', 'facility', true,  false, 'MAPLE00001'),
  ('00000000-0000-4000-a000-000000000002', 'group',    false, true,  'OWLS000002');

-- Org A: 1 admin, 4 managers, 95 staff (15 RN, 25 RPN, 50 PSW, 5 support)
insert into app.profiles (id, organization_id, email, name, role, position, share_schedule)
values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
   'admin@maplegrove.test', 'Avery Admin', 'org_admin', 'Administrator', false);

insert into app.profiles (id, organization_id, email, name, role, position, share_schedule)
select
  ('00000000-0000-4000-b000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-4000-a000-000000000001',
  'manager' || (n - 1) || '@maplegrove.test',
  'Manager ' || (n - 1),
  'manager',
  'Unit Manager',
  false
from generate_series(2, 5) as n;

insert into app.profiles (id, organization_id, email, name, role, position, share_schedule)
select
  ('00000000-0000-4000-b000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-4000-a000-000000000001',
  'staff' || (n - 5) || '@maplegrove.test',
  'Staff ' || (n - 5),
  'employee',
  case
    when n <= 20 then 'RN'
    when n <= 45 then 'RPN'
    when n <= 95 then 'PSW'
    else 'Support'
  end,
  n % 3 = 0           -- roughly a third opt in to sharing
from generate_series(6, 100) as n;

-- Org B: group mode, everyone shares by default
insert into app.profiles (id, organization_id, email, name, role, position, share_schedule)
select
  ('00000000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-4000-a000-000000000002',
  'owl' || n || '@nightowls.test',
  'Owl ' || n,
  case when n = 1 then 'org_admin'::app.user_role else 'employee' end,
  'PSW',
  true
from generate_series(1, 6) as n;

-- An open invitation for local testing of the accept flow
insert into app.invitations (organization_id, email, role, position, token) values
  ('00000000-0000-4000-a000-000000000001', 'newhire@maplegrove.test', 'employee', 'PSW',
   'dev-invite-token-newhire');

-- ---------------------------------------------------------------------------
-- D2: structure. Maple Grove: 1 site, 3 units, 7 positions per unit.
-- ---------------------------------------------------------------------------
insert into app.sites (id, organization_id, name, code, address, phone) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Maple Grove — Main Building', 'MG', '100 Example Ave, Toronto, ON', '555-0100'),
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-a000-000000000002',
   'Lakeside Hospital', 'LH', null, null);

insert into app.areas (id, organization_id, site_id, name, description) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-d000-000000000001', 'Birch Unit', 'Long-term care, 32 beds'),
  ('00000000-0000-4000-e000-000000000002', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-d000-000000000001', 'Cedar Unit', 'Memory care, 24 beds'),
  ('00000000-0000-4000-e000-000000000003', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-d000-000000000001', 'Willow Unit', 'Convalescent care, 20 beds'),
  ('00000000-0000-4000-e000-000000000004', '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-d000-000000000002', 'Night Float', 'Shared night shifts');

insert into app.assignments (organization_id, area_id, name, code, required_position, display_order)
select a.organization_id, a.id, p.name, p.code, p.req, p.ord
from app.areas a
cross join (values
  ('Charge Nurse', 'RN',   'RN',  1),
  ('Med Pass 1',   'MED1', 'RPN', 2),
  ('Med Pass 2',   'MED2', 'RPN', 3),
  ('PSW 1',        'PSW1', 'PSW', 4),
  ('PSW 2',        'PSW2', 'PSW', 5),
  ('PSW 3',        'PSW3', 'PSW', 6),
  ('PSW 4',        'PSW4', 'PSW', 7)
) as p(name, code, req, ord)
where a.organization_id = '00000000-0000-4000-a000-000000000001';

insert into app.assignments (organization_id, area_id, name, code, required_position, display_order) values
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-e000-000000000004', 'Float PSW 1', 'F1', 'PSW', 1),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-e000-000000000004', 'Float PSW 2', 'F2', 'PSW', 2);

-- Staff spread across units round-robin; managers + admin cover every unit
insert into app.employee_areas (organization_id, employee_id, area_id)
select p.organization_id, p.id,
       ('00000000-0000-4000-e000-' || lpad((1 + (row_number() over (order by p.id)) % 3)::text, 12, '0'))::uuid
from app.profiles p
where p.organization_id = '00000000-0000-4000-a000-000000000001' and p.role = 'employee';

insert into app.employee_areas (organization_id, employee_id, area_id)
select p.organization_id, p.id, a.id
from app.profiles p
join app.areas a on a.organization_id = p.organization_id
where p.organization_id = '00000000-0000-4000-a000-000000000001' and p.role in ('manager', 'org_admin');

insert into app.employee_areas (organization_id, employee_id, area_id)
select organization_id, id, '00000000-0000-4000-e000-000000000004'
from app.profiles where organization_id = '00000000-0000-4000-a000-000000000002';

-- Sample availability: staff1 can't work Sundays or Wednesday evenings
insert into app.availability (organization_id, employee_id, weekday, start_time, end_time, note) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000006', 0, '00:00', '24:00', 'Family day'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000006', 3, '15:00', '24:00', 'Class');

-- ---------------------------------------------------------------------------
-- D3: this week's schedule for Maple Grove (published) — relative to "now".
-- Staff rotate round-robin per unit + position; Night PSW 3/4 left unassigned.
-- ---------------------------------------------------------------------------
with week as (
  select date_trunc('week', (now() at time zone 'America/Toronto'))::date as monday
),
slots as (
  select a.id as area_id, x.id as assignment_id, x.required_position as pos, x.display_order,
         t.id as template_id, t.name as template_name, t.start_time, t.end_time, d.day,
         row_number() over (partition by a.id, x.required_position
                            order by d.day, t.start_time, x.display_order) - 1 as k
  from app.areas a
  join app.assignments x on x.area_id = a.id
  join app.shift_templates t on t.organization_id = a.organization_id and t.is_default
  cross join generate_series(0, 6) as d(day)
  where a.organization_id = '00000000-0000-4000-a000-000000000001'
),
eligible as (
  select ea.area_id, p.position, p.id as employee_id,
         row_number() over (partition by ea.area_id, p.position order by p.id) - 1 as i,
         count(*) over (partition by ea.area_id, p.position) as n
  from app.employee_areas ea
  join app.profiles p on p.id = ea.employee_id
  where p.role = 'employee' and p.organization_id = '00000000-0000-4000-a000-000000000001'
)
insert into app.shifts (organization_id, area_id, assignment_id, employee_id, shift_template_id,
                        starts_at, ends_at, status)
select '00000000-0000-4000-a000-000000000001', s.area_id, s.assignment_id,
       case when s.template_name = 'Night' and s.display_order >= 6 then null else e.employee_id end,
       s.template_id, r.starts_at, r.ends_at, 'published'
from slots s
cross join week w
cross join lateral app.local_range(w.monday + s.day, s.start_time, s.end_time, 'America/Toronto') r
left join eligible e on e.area_id = s.area_id and e.position = s.pos and e.i = s.k % e.n
order by r.starts_at;

-- Night Owls: a few self-scheduled shifts this week
insert into app.shifts (organization_id, area_id, assignment_id, employee_id, starts_at, ends_at, status)
select '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-e000-000000000004', null,
       ('00000000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid, r.starts_at, r.ends_at, 'published'
from generate_series(1, 6) as n
cross join lateral app.local_range(
  date_trunc('week', (now() at time zone 'America/Toronto'))::date + (n % 7), '19:00', '07:00', 'America/Toronto') r;

commit;
