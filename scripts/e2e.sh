#!/usr/bin/env bash
# Browser smoke tests for the web portal and the mobile app (web build), against a seeded local stack.
#   bash scripts/e2e.sh            # build + run everything
#   SKIP_BUILD=1 bash scripts/e2e.sh
# Needs: Postgres (DATABASE_URL base, default postgres:postgres@localhost:5432), Node, and `require('playwright')`
# resolvable (set NODE_PATH to a global install if it is not a local dependency).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432}"
DB=shifthub_e2e
OUT="${E2E_OUT:-$ROOT/e2e-results}"
SECRET=e2e-dev-secret-e2e-dev-secret-e2e-dev-secret
mkdir -p "$OUT"
export DATABASE_URL="$BASE_URL"

if [[ -z "${SKIP_BUILD:-}" ]]; then
  pnpm --filter @shifthub/web build >"$OUT/web-build.log" 2>&1 || { echo "web build failed"; tail -30 "$OUT/web-build.log"; exit 1; }
  (cd apps/mobile && rm -rf dist && CI=1 npx expo export --platform web >"$OUT/mobile-build.log" 2>&1) || { echo "mobile build failed"; tail -30 "$OUT/mobile-build.log"; exit 1; }
fi

for port in 8787 3000 8081; do
  if curl -s -o /dev/null "http://localhost:$port/"; then echo "port $port is already in use; stop that server first"; exit 1; fi
done

reset() { bash supabase/scripts/reset-local-db.sh "$DB" --seed >/dev/null; }
reset

pids=()
# each server runs in its own process group so the whole tree (npx → node) can be stopped
cleanup() { for p in "${pids[@]}"; do kill -TERM -- "-$p" 2>/dev/null; done; wait 2>/dev/null; }
trap cleanup EXIT

setsid bash -c "cd apps/api && DATABASE_URL='$BASE_URL/$DB' AUTH_JWT_SECRET='$SECRET' DEV_LOGIN=true JOBS_SECRET=e2e \
  CORS_ORIGINS=http://localhost:3000,http://localhost:8081 PORT=8787 exec npx tsx src/server.ts" >"$OUT/api.log" 2>&1 & pids+=($!)
setsid bash -c "cd apps/web && exec npx next start -p 3000" >"$OUT/web.log" 2>&1 & pids+=($!)
setsid node scripts/serve-static.cjs apps/mobile/dist 8081 >"$OUT/mobile.log" 2>&1 & pids+=($!)

for url in http://localhost:8787/health http://localhost:3000/login http://localhost:8081/; do
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$url" && break; sleep 1; done
  curl -sf -o /dev/null "$url" || { echo "not ready: $url"; cat "$OUT"/*.log | tail -40; exit 1; }
done

failed=0
for t in apps/web/e2e/setup-screens.cjs apps/web/e2e/schedule.cjs apps/web/e2e/approvals.cjs \
         apps/mobile/e2e-web.cjs apps/mobile/e2e-web-trades.cjs; do
  reset
  echo "== $t"
  node "$t" "$OUT" || failed=1
done
exit $failed
