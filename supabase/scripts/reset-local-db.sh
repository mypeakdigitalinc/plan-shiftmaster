#!/usr/bin/env bash
# Recreate a local database and apply all migrations (+ optional seed).
# Usage: DATABASE_URL=postgres://postgres:postgres@localhost:5432 bash supabase/scripts/reset-local-db.sh [dbname] [--seed]
set -euo pipefail
BASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432}"
DB="${1:-shifthub}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

psql "$BASE_URL/postgres" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force);" -c "create database \"$DB\";"
for f in "$DIR"/migrations/*.sql; do
  psql "$BASE_URL/$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
if [[ "${2:-}" == "--seed" ]]; then
  psql "$BASE_URL/$DB" -v ON_ERROR_STOP=1 -q -f "$DIR/seed.sql"
fi
echo "Database $DB ready."
