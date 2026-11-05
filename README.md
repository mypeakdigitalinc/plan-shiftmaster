# ShiftHub

Multi-tenant shift scheduling for care facilities and self-organized worker groups.
See **[Shifthub Master Plan.md](./Shifthub%20Master%20Plan.md)** for scope, data model and roadmap.

**Status:** Database phases D1–D4 done with API endpoints: organizations & onboarding; sites, areas, assignments, shift templates, availability; shifts with draft/publish, copy week, schedule sharing; shift marketplace (give away / pick up) and swaps with manager approval or auto-approve. Web portal W1–W3 done: login, onboarding, invite accept, dashboard, employees, locations, shift templates, settings, the weekly schedule (assign, copy last week, publish, post to marketplace) and the approvals queue. Mobile M1 done: login, join by code / invitation / start a group, My Schedule, shift details, profile with schedule-sharing toggle, availability, add-my-shift (groups).

## Structure

| Path | What |
|---|---|
| `supabase/` | SQL migrations, RLS policies, RPCs, seed data, database tests |
| `apps/api` | Hono API — OpenAPI spec at `/openapi.json`, Scalar docs at `/docs` |
| `apps/web` | Next.js admin portal (scaffold) |
| `apps/mobile` | Expo employee app (scaffold) |
| `packages/shared` | Zod schemas + types shared everywhere |
| `packages/api-client` | Typed API client for web + mobile |
| `packages/auth` | Auth interface + Supabase implementation |

## Local setup

Requires Node 22, pnpm 10, PostgreSQL 16 (local install, or `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`).

```bash
pnpm install
pnpm db:reset shifthub --seed          # create local DB, apply migrations + seed

cp apps/api/.env.example apps/api/.env
pnpm dev:api                           # http://localhost:8787/docs

# get a dev token for a seeded user and call the API
TOKEN=$(pnpm -s --filter @shifthub/api token admin@maplegrove.test)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/me

pnpm dev:web                           # http://localhost:3000 — sign in with any seed email (dev login)
pnpm dev:mobile                        # Expo (press w for web, or scan with Expo Go; set EXPO_PUBLIC_API_URL to your LAN IP on a phone)
```

### Dev login (local only)
With `DEV_LOGIN=true` in `apps/api/.env` and `NEXT_PUBLIC_AUTH_MODE=dev` (the default) in the web app, you sign in with
just an email — no password, no Supabase project needed. The API refuses to enable this when `NODE_ENV=production`.

### Seed users (local only)
| Email | Org | Role |
|---|---|---|
| `admin@maplegrove.test` | Maple Grove Care Home (facility, 100 people) | org_admin |
| `manager1@maplegrove.test` … `manager4@` | Maple Grove | manager |
| `staff1@maplegrove.test` … `staff95@` | Maple Grove | employee (RN / RPN / PSW / Support) |
| `owl1@nightowls.test` … `owl6@` | Night Owls Crew (group, invite code `OWLS000002`) | owl1 = org_admin |

Maple Grove has 1 site with 3 units (Birch, Cedar, Willow), each with 7 positions (Charge Nurse RN, 2 × Med Pass RPN, 4 × PSW). Every org starts with Day 07–15, Evening 15–23, Night 23–07 templates. The seed publishes **the current week's** schedule (441 shifts, Night PSW 3/4 left open) relative to when you run it.

Invite token for the accept flow: `dev-invite-token-newhire` (for `newhire@maplegrove.test`).

## Tests

```bash
pnpm typecheck
pnpm test        # needs Postgres; override with TEST_DATABASE_URL=postgresql://user:pass@host:5432
```

- `supabase/tests` — tenant isolation, role permissions, onboarding RPCs (RLS against real Postgres)
- `packages/shared` — date/timezone/availability helpers
- `apps/mobile/e2e-web.cjs` — mobile smoke test against the web build at iPhone size
- `apps/web/e2e` — browser smoke tests (run against a local seeded stack; see file headers)
- `apps/api/test` — API integration tests (auth, onboarding, members, settings, locations, templates, availability, shifts)

## Deploying (when accounts exist)

1. **Supabase:** create `shifthub-staging` and `shifthub-prod` projects. Apply migrations with
   `supabase link --project-ref <ref> && supabase db push` (or `psql $DIRECT_URL -f supabase/migrations/*.sql`).
2. **API:** set `DATABASE_URL` (Supabase pooler, port 6543), `AUTH_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`,
   `AUTH_ISSUER=https://<ref>.supabase.co/auth/v1`, `CORS_ORIGINS`, `APP_URL`. Deploy target is decided in phase W1 (Vercel function or Lambda).
3. **Web:** Vercel project rooted at `apps/web` with `NEXT_PUBLIC_*` vars from `apps/web/.env.example`.
4. **Mobile:** `eas build` with `EXPO_PUBLIC_*` vars from `apps/mobile/.env.example`.
