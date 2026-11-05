# ShiftHub — MVP Master Plan

## 1. Goal

Ship a working multi-tenant shift scheduling app that lets managers **build and publish schedules** and lets employees **see, give away, pick up, and swap shifts** from their phone. Everything runs on free tiers.

**MVP success test:** Both pilot types run their schedules in ShiftHub for 4 weeks without falling back to spreadsheets or group chats.

### Pilot customers
| Pilot | Profile | What matters most |
|---|---|---|
| **A. Long-term care facility** | ~100 employees (RN / RPN / PSW / support staff), 24/7 coverage, 1 site, several units | Manager-built schedules, approvals, coverage on every shift, role-qualified pickups |
| **B. Worker group** | Self-organized coworkers who create an org just to share schedules and trade shifts | Fast self-signup, no manager bottleneck, opt-in schedule sharing |

Both use the same app and data model; the difference is the **organization mode** set at signup (`facility` or `group`).

---

## 2. MVP Scope

### In
| Area | What ships |
|---|---|
| Auth | Email/password + magic link (Supabase Auth), invite employees by email |
| Org setup | Organization, sites, areas, assignments (positions) |
| People | Employee list, roles, job position (RN/RPN/PSW…), which sites/areas they can work |
| Org modes | **Facility** (managers schedule + approve) or **Group** (members add own shifts, trades auto-approve, invite by link/code) |
| Schedule sharing | Each employee chooses whether coworkers can see their schedule (see §6) |
| Shift templates | Day 7–3, Evening 3–11, Night 11–7 seeded by default, editable |
| Scheduling | Weekly calendar, create/edit/delete shifts, assign employees, copy last week, publish |
| Marketplace | Employee posts a shift → others request it → manager approves (or auto-approve setting) |
| Swaps | Employee requests swap with a coworker → coworker accepts → manager approves |
| Availability | Employee sets weekly unavailable times |
| Notifications | Push + in-app: schedule published, shift available, swap request, approval result, shift reminder (12h before) |
| Audit | Log create/update/delete/approve actions |

### Out (post-MVP)
Teams, rotating schedule templates, priority engine/scoring, reports & analytics, announcements, AI scheduling, drag-and-drop, platform-admin UI (use Supabase dashboard), SSO, AWS migration.

---

## 3. Roles (simplified to 3)

| Role | Can |
|---|---|
| **Employee** | View own schedule, post/request shifts, request/accept swaps, set availability |
| **Manager** | Everything Employee can + manage sites/areas/assignments/templates, build & publish schedules, approve requests (Supervisor = Manager for MVP) |
| **Org Admin** | Everything Manager can + manage users, roles, org settings |

Platform Admin = Supabase service role / dashboard only.

---

## 4. Tech Stack

| Layer | Choice |
|---|---|
| Mobile (employees) | Expo + React Native + TypeScript, Expo Router, TanStack Query, Zustand, React Hook Form, Expo Notifications |
| Web (managers/admins) | Next.js (App Router) + TypeScript, Tailwind, shadcn/ui, TanStack Table, FullCalendar |
| Backend | Supabase: Postgres, Auth, RLS, Realtime, Edge Functions, pg_cron |
| Hosting | Vercel (web), Expo EAS (mobile), Supabase (backend) |
| Repo / CI | GitHub monorepo, GitHub Actions |

### Repo layout
```
shifthub/
  apps/
    web/          # Next.js admin portal
    mobile/       # Expo employee app
  packages/
    api/          # Typed data-access layer (the ONLY place that talks to Supabase)
    types/        # Shared TS types (generated from DB)
    validation/   # Zod schemas shared by web + mobile
  supabase/
    migrations/   # SQL schema + RLS
    functions/    # Edge Functions
    seed.sql
```

> **AWS-ready rule:** apps never import `supabase-js` directly — they call `packages/api`. Swapping to AWS later means rewriting that one package, not the apps.

---

## 5. Data Model (MVP)

Every tenant table has `organization_id`, `created_at`, `updated_at`; key tables also have `created_by`, `deleted_at` (soft delete).

```
organizations        id, name, timezone, logo_url, status
org_settings         organization_id, mode (facility|group), require_approval (bool), allow_swaps (bool),
                     allow_pickup (bool), allow_self_scheduling (bool), invite_code
profiles             id (= auth.users.id), organization_id, name, email, phone, role, position,
                     share_schedule (bool, default false), status
sites                id, organization_id, name, address, timezone, status
areas                id, organization_id, site_id, name, status
assignments          id, organization_id, area_id, name, code, required_position (nullable), display_order, status
employee_areas       id, organization_id, employee_id, area_id          -- where they can work
availability         id, organization_id, employee_id, weekday, start_time, end_time
shift_templates      id, organization_id, name, start_time, end_time, color, is_default
shifts               id, organization_id, site_id, area_id, assignment_id, employee_id (nullable),
                     shift_template_id, starts_at, ends_at, status (draft|published|cancelled), notes
shift_offers         id, organization_id, shift_id, offered_by, status (open|pending|filled|cancelled|expired),
                     reason, expires_at
shift_offer_requests id, organization_id, offer_id, employee_id, status (pending|approved|rejected), decided_by, decided_at
shift_swaps          id, organization_id, requester_id, target_id, requester_shift_id, target_shift_id,
                     status (pending_peer|pending_manager|approved|rejected|cancelled), decided_by, decided_at
notifications        id, organization_id, user_id, type, title, body, data (jsonb), read_at
push_tokens          id, user_id, token, platform
audit_logs           id, organization_id, user_id, action, entity_type, entity_id, details (jsonb)
```

**Simplifications vs. full spec**
- One `shifts` row = one person in one assignment (no separate `shift_assignments` table yet).
- `starts_at/ends_at` as `timestamptz` handles overnight shifts and timezones cleanly.
- `users` + `employees` merged into `profiles`.

---

## 6. Security (Multi-Tenant)

1. On signup/invite, a trigger writes `organization_id` + `role` into the user's JWT custom claims.
2. Helper SQL functions: `auth_org_id()`, `auth_role()`.
3. RLS on **every** table:
   - Read: `organization_id = auth_org_id()`
   - Employees: write only their own availability, offers, requests, swaps (and own shifts when `allow_self_scheduling`).
   - **Schedule visibility (shifts table):** an employee can see a shift if it is theirs, OR it is posted on the marketplace, OR its owner has `share_schedule = true`. Managers/Admins always see all shifts in their org.
   - Managers/Admins: write org data.
4. Pickups and swaps check `required_position` so, e.g., a PSW can't pick up an RN shift.
5. Approvals and shift reassignment happen in **Postgres functions (RPC)** marked `security definer`, so the swap/hand-off is atomic and validated (no double-booking, same org, shift not in past).
6. **Test:** automated RLS test suite proving Org A user cannot read/write Org B data.

---

## 7. Key Flows

**Publish schedule**
Manager builds week (draft) → clicks Publish → shifts flip to `published` → Edge Function notifies affected employees.

**Give away / pick up a shift**
Employee posts shift → org members eligible for that area get "Shift available" → they request → manager approves one (first request shown on top) → RPC reassigns shift, closes offer, rejects others → notifications sent.
If `require_approval = false`, first request auto-wins.

**Swap**
Employee A picks own shift + B's shift → B accepts/rejects → manager approves → RPC swaps `employee_id` on both shifts → notify both.

**Schedule sharing preference**
Profile → "Share my schedule with coworkers" toggle (off by default). When on, coworkers see the employee's shifts in a **Team Schedule** view; when off, only their open/offered shifts are visible. Defaults: off for facility mode, on for group mode (user can change).

**Group mode setup**
Worker signs up → "Create group" → gets invite code/link → coworkers join as members → members add their own shifts, post and swap with no manager approval (`require_approval = false`, `allow_self_scheduling = true`). Creator is Org Admin.

**Reminders**
pg_cron runs every 15 min → finds shifts starting in ~12h → push notification.

---

## 8. Screens

**Mobile (Employee)**
1. Login / accept invite
2. My Schedule (list + week view)
3. Shift detail → *Give away* / *Swap*
4. Open Shifts (marketplace) → *Request*
5. Requests (my offers, pickups, swaps + status)
6. Notifications
7. Team Schedule (coworkers who share)
8. Add My Shift (group mode)
9. Profile, Availability & Share-schedule toggle

**Web (Manager / Admin)**
1. Login
2. Dashboard (today's coverage, pending approvals count)
3. Schedule (week calendar by site/area, copy week, publish)
4. Approvals (pickups + swaps queue)
5. Employees (invite, role, allowed areas)
6. Locations (sites → areas → assignments)
7. Shift Templates
8. Settings (org rules)

---

## 9. Build Plan (≈ 8 weeks, 1–2 devs)

| Week | Milestone |
|---|---|
| 1 | Monorepo, Supabase project, CI, schema + RLS for orgs/profiles/sites/areas/assignments, auth + invite flow |
| 2 | Web: Locations, Employees, Shift Templates CRUD; org modes + invite code; seed data (LTC facility with 100 staff, sample group) |
| 3 | Web: Schedule calendar, create/edit shifts, copy week, publish |
| 4 | Mobile: login/join group, My Schedule, Add My Shift, availability, share toggle + Team Schedule |
| 5 | Marketplace: offers + requests (mobile) and approvals (web), approval RPC |
| 6 | Swaps end-to-end; notifications (in-app + Expo push), reminders cron |
| 7 | Audit logs, RLS test suite, E2E tests on core flows, bug fixing |
| 8 | Pilot with LTC facility + 1–2 worker groups: TestFlight/Play internal track, Vercel prod, feedback fixes |

**Definition of done for each feature:** migration + RLS + API function + UI + test.

---

## 10. Testing & Deployment

- **DB/RLS:** pgTAP or Vitest against local Supabase (`supabase start`).
- **Unit:** Vitest for `packages/api` and validation.
- **E2E:** Playwright (web) on publish, approve pickup, approve swap.
- **CI (GitHub Actions):** lint → typecheck → unit → RLS tests on every PR; on `main`: `supabase db push`, Vercel deploy, EAS build on tag.
- **Environments:** `local` → `staging` (free Supabase project #1) → `prod` (free project #2).

---

## 11. After MVP (roadmap)

1. **Phase 2:** Teams, rotating schedule templates, auto-generate from templates, drag-and-drop
2. **Phase 3:** Priority engine (seniority, hours, qualifications, fairness), announcements
3. **Phase 4:** Reports & analytics (Recharts), platform-admin portal, AI scheduling suggestions
4. **Scale:** Paid Supabase tier, then optional AWS migration via `packages/api`

---

## 12. Open Questions

- ~~Pilot org~~ → LTC facility (~100 staff) + self-organized worker groups.
- ~~Coworker visibility~~ → per-employee opt-in toggle.
- Should pickups be limited to employees approved for that area? *(Plan assumes yes, plus matching position.)*
- Should facility admins be able to force schedule sharing on/off org-wide?
- Can a worker belong to more than one org (e.g. their facility *and* a group)? *(MVP assumes one org per account.)*
- Overtime / max-hours limits needed in MVP?
