-- =============================================================================
-- ShiftHub seed data (local / staging only)
--   Org A: Maple Grove Care Home — facility mode, 100 people
--   Org B: Night Owls Crew       — group mode, 6 people
-- All names are fictional. Profile ids are deterministic so dev tokens can
-- be minted for them (see apps/api/scripts/dev-token.ts).
-- =============================================================================

begin;

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

commit;
