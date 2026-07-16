#!/usr/bin/env bash
# scripts/setup-env.sh
# Writes all local .env files needed for offline development.
# Run once after cloning: bash scripts/setup-env.sh
# No keys need to be pasted — everything is the local dev secret.

set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODQyMDIxODksImV4cCI6MjA5OTU2MjE4OX0.dc59Uf4pE9DsxIct1ozih5VYKXRvHAWyRvST8Txo8JY"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0MjAyMTg5LCJleHAiOjIwOTk1NjIxODl9.vWU6XjeQ62P59vBk1ry0SeoMjny6Pyi0Yk5tPfwSE0g"
JWT_SECRET="local-dev-jwt-secret-hrms-cognixhr-2024-min32chars"
DB_URL="postgresql://hrms_local:hrms_dev_2024@127.0.0.1:5432/hrms"

# ── apps/api/.env ─────────────────────────────────────────────────────────────
cat > "$REPO/apps/api/.env" <<APIENV
NODE_ENV=development
PORT=2001
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
JWT_SECRET=$JWT_SECRET
DATABASE_URL=$DB_URL
WEB_URL=http://localhost:2000
APIENV
echo "  ✓  apps/api/.env"

# ── apps/web/.env ─────────────────────────────────────────────────────────────
cat > "$REPO/apps/web/.env" <<WEBENV
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=$ANON_KEY
WEBENV
echo "  ✓  apps/web/.env"

# ── .env.local-seed (used by seed-enterprise.mjs + seed-punch-logs.mjs) ───────
cat > "$REPO/.env.local-seed" <<SEEDENV
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
DATABASE_URL=$DB_URL
SEED_TENANT_ID=b0000000-0000-0000-0000-000000000001
SEED_COUNT=2877
SEED_ATTENDANCE_MONTHS=3
SEEDENV
echo "  ✓  .env.local-seed"

echo ""
echo "Done. Next:"
echo "  node scripts/local-db-setup.mjs       # first-time DB setup"
echo "  bash scripts/local-start.sh           # start the stack"
