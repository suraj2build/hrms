#!/usr/bin/env bash
# Seed local Supabase database with demo data.
# Run after `supabase start` and `supabase db reset`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB_URL=$(supabase status 2>/dev/null | grep "DB URL" | awk '{print $NF}')
if [ -z "$DB_URL" ]; then
  echo "Error: Supabase is not running. Run 'supabase start' first."
  exit 1
fi

echo "Seeding demo data into: $DB_URL"
export PGPASSWORD=postgres

SEED_FILES=(
  supabase/seed-demo.sql
  supabase/seed-demo-extra.sql
  supabase/seed-demo-extra-2.sql
  supabase/seed-demo-extra-3.sql
  supabase/seed-demo-extra-4.sql
  supabase/seed-demo-extra-5.sql
  supabase/seed-demo-extra-6.sql
  supabase/seed-demo-extra-7.sql
  supabase/seed-demo-extra-8.sql
  supabase/seed-demo-extra-9.sql
  supabase/seed-demo-extra-10.sql
  supabase/seed-demo-extra-11.sql
  supabase/seed-demo-extra-12.sql
  supabase/seed-demo-extra-13.sql
)

for f in "${SEED_FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  → $f"
    psql "$DB_URL" -f "$f" -q 2>&1 | grep -v "^$" | sed 's/^/    /' || echo "  ⚠ $f had some warnings (may be non-fatal)"
  fi
done

echo "Done. Open http://localhost:54323 to explore the data in Supabase Studio."
