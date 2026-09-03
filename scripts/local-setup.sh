#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CognixHR — Local Development Setup
#
# Boots the full local stack: Supabase (PostgreSQL + PostgREST + GoTrue +
# Studio) + API (Fastify) + Web (Vite).
#
# Run ONCE after cloning the repo. After the first setup, use:
#   npm run dev          ← start API + web (supabase must already be running)
#   supabase start       ← start Supabase only (already running? no-op)
#   supabase stop        ← stop Supabase containers
#
# Works on macOS, Linux, and Windows WSL2.
# Windows users: run this inside WSL2 (not PowerShell).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
step()  { echo -e "\n${B}━━ $1 ${N}"; }
ok()    { echo -e "${G}  ✓ $1${N}"; }
warn()  { echo -e "${Y}  ⚠ $1${N}"; }
fail()  { echo -e "${R}  ✗ $1${N}"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo -e "${B}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   CognixHR — Local Setup              ║"
echo "  ║   Supabase + Fastify API + Vite web   ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${N}"

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
step "Checking prerequisites"

# Docker
if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running. Start Docker Desktop and try again."
fi
ok "Docker is running"

# Node.js ≥ 22
NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 22 ]; then
  fail "Node.js 22+ is required. Current: $(node -v 2>/dev/null || echo 'not found')"
fi
ok "Node.js $(node -v)"

# Supabase CLI
if ! command -v supabase >/dev/null 2>&1; then
  step "Installing Supabase CLI"
  # Try npm first (works everywhere); homebrew as fallback on macOS
  npm install -g supabase 2>/dev/null || {
    if command -v brew >/dev/null 2>&1; then
      brew install supabase/tap/supabase
    else
      fail "Could not install Supabase CLI. Install manually: https://supabase.com/docs/guides/local-development/cli/getting-started"
    fi
  }
fi
ok "Supabase CLI $(supabase --version)"

# ── 2. Node dependencies ─────────────────────────────────────────────────────
step "Installing Node dependencies"
npm install
ok "node_modules installed"

# ── 3. Start Supabase local stack ────────────────────────────────────────────
step "Starting Supabase local stack"
echo "  (Pulling Docker images on first run — may take a few minutes)"

# supabase start is idempotent — safe to run if already running
supabase start || {
  warn "supabase start exited non-zero. Checking if it's already running..."
  supabase status >/dev/null 2>&1 || fail "Supabase failed to start. Check Docker Desktop has enough memory (4 GB+)."
}
ok "Supabase is running"

# ── 4. Read credentials from running stack ────────────────────────────────────
step "Reading local credentials"

# `supabase status`'s human-readable table has changed shape across CLI
# versions (older: "anon key"/"service_role key"/"API URL"/"DB URL" rows;
# newer: "Publishable"/"Secret" — a different, non-JWT key format — under an
# "Authentication Keys" heading, no JWT secret row printed at all). Grepping
# that table broke silently (empty vars, no error) the moment someone's CLI
# updated. `-o json` keeps stable legacy field names (ANON_KEY,
# SERVICE_ROLE_KEY, JWT_SECRET, API_URL, DB_URL) regardless of CLI version —
# parse that instead.
STATUS_JSON=$(supabase status -o json 2>/dev/null) || fail "Could not read 'supabase status -o json'. Run 'supabase status' manually and check it's running."

parse_json() {
  node -e "
    try {
      const v = JSON.parse(process.argv[1])['$1'];
      if (v) process.stdout.write(v);
    } catch {}
  " "$STATUS_JSON"
}

LOCAL_API_URL=$(parse_json "API_URL")
LOCAL_ANON_KEY=$(parse_json "ANON_KEY")
LOCAL_SERVICE_KEY=$(parse_json "SERVICE_ROLE_KEY")
LOCAL_JWT_SECRET=$(parse_json "JWT_SECRET")
LOCAL_DB_URL=$(parse_json "DB_URL")

# Validate we got something
if [ -z "$LOCAL_API_URL" ] || [ -z "$LOCAL_SERVICE_KEY" ]; then
  fail "Could not parse Supabase credentials from 'supabase status -o json'. Run it manually and check the output has API_URL / SERVICE_ROLE_KEY fields."
fi

ok "API URL:           $LOCAL_API_URL"
ok "DB URL:            $LOCAL_DB_URL"
ok "Studio:            http://localhost:54323"

# ── 5. Apply all database migrations ─────────────────────────────────────────
step "Applying database migrations (378 files)"
echo "  Running supabase db reset — this drops + recreates the schema and"
echo "  applies every migration file from supabase/migrations/ in order."
echo "  Takes ~30–60 seconds."

supabase db reset --no-seed
ok "All migrations applied"

# ── 6. Write environment files ───────────────────────────────────────────────
step "Writing .env files"

# API env
cat > apps/api/.env <<ENV
# Generated by scripts/local-setup.sh — do not commit (gitignored)
# Re-run setup to regenerate with updated keys.
NODE_ENV=development
PORT=2001

# Supabase local stack
SUPABASE_URL=${LOCAL_API_URL}
SUPABASE_SERVICE_ROLE_KEY=${LOCAL_SERVICE_KEY}
SUPABASE_JWT_SECRET=${LOCAL_JWT_SECRET}
JWT_SECRET=${LOCAL_JWT_SECRET}

# Web URL for CORS + redirect links
WEB_URL=http://localhost:2000
APP_PUBLIC_URL=http://localhost:2000
OWNER_APP_URL=http://localhost:2000

# ── Optional — add your keys to enable these features locally ────────────────
# Email (Resend)
# RESEND_API_KEY=

# AI assistant
# AI_PROVIDER=anthropic
# ANTHROPIC_API_KEY=

# Razorpay billing
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=
ENV
ok "apps/api/.env written"

# Web env
cat > apps/web/.env <<ENV
# Generated by scripts/local-setup.sh — do not commit (gitignored)
VITE_SUPABASE_URL=${LOCAL_API_URL}
VITE_SUPABASE_ANON_KEY=${LOCAL_ANON_KEY}
# Do NOT set VITE_API_URL in development — Vite proxy handles it automatically
ENV
ok "apps/web/.env written"

# ── 7. Optional: seed demo data ───────────────────────────────────────────────
step "Demo data"
echo ""
echo "  Would you like to seed the database with demo data?"
echo "  This creates a demo tenant with employees, payroll history, attendance, etc."
echo "  (Recommended for development — takes ~20 seconds)"
echo ""
read -r -p "  Seed demo data? [y/N]: " SEED_CHOICE
echo ""

if [[ "${SEED_CHOICE,,}" == "y" ]]; then
  step "Seeding demo data"

  PGPASSWORD=postgres
  export PGPASSWORD
  PSQL_CMD="psql $LOCAL_DB_URL"

  SEED_FILES=(
    "supabase/seed-demo.sql"
    "supabase/seed-demo-extra.sql"
    "supabase/seed-demo-extra-2.sql"
    "supabase/seed-demo-extra-3.sql"
    "supabase/seed-demo-extra-4.sql"
    "supabase/seed-demo-extra-5.sql"
    "supabase/seed-demo-extra-6.sql"
    "supabase/seed-demo-extra-7.sql"
    "supabase/seed-demo-extra-8.sql"
    "supabase/seed-demo-extra-9.sql"
    "supabase/seed-demo-extra-10.sql"
    "supabase/seed-demo-extra-11.sql"
    "supabase/seed-demo-extra-12.sql"
    "supabase/seed-demo-extra-13.sql"
  )

  for f in "${SEED_FILES[@]}"; do
    if [ -f "$f" ]; then
      echo "  Seeding: $f"
      $PSQL_CMD -f "$f" -q 2>&1 | grep -v "^$" | sed 's/^/    /' || warn "$f had some errors (may be non-fatal)"
    fi
  done
  ok "Demo data seeded"
else
  echo "  Skipped. Run './scripts/seed-local.sh' any time to seed later."
fi

# ── 8. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${G}  Setup complete!${N}"
echo ""
echo "  Local services running:"
echo "    Supabase Studio:   http://localhost:54323"
echo "    Supabase API:      $LOCAL_API_URL"
echo "    Inbucket (email):  http://localhost:54324"
echo ""
echo "  Next:"
echo -e "    ${B}npm run dev${N}   ← starts API (2001) + web (2000)"
echo ""
echo "  Each time you restart your machine:"
echo -e "    ${B}supabase start && npm run dev${N}"
echo ""
echo "  Check PostgREST max_rows (must be 1000+):"
echo -e "    ${B}supabase db execute --sql \"SELECT current_setting('pgrst.max_rows')\"${N}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
