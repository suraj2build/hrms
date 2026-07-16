#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/local-start.sh
# Start the full CognixHR local dev stack WITHOUT Docker/Supabase CLI.
#
# Prerequisites (already satisfied after running local-db-setup.sh):
#   - PostgreSQL 16+ running on localhost:5432, database "hrms" created
#   - npm packages installed (npm install at repo root)
#
# Services started:
#   1. local-server.mjs  — PostgREST + GoTrue proxy   → port 54321
#   2. apps/api          — Fastify API                 → port 2001
#   3. apps/web          — Vite dev server             → port 2000
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

G='\033[0;32m'; B='\033[0;34m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}  ✓ $1${N}"; }
step() { echo -e "\n${B}━━ $1${N}"; }
fail() { echo -e "${R}  ✗ $1${N}"; exit 1; }

echo -e "${B}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   CognixHR — Local Dev Stack          ║"
echo "  ║   PostgreSQL + local-server + API     ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${N}"

# ── Verify PostgreSQL ─────────────────────────────────────────────────────────
step "Checking PostgreSQL"
if ! pg_isready -q -h localhost -p 5432; then
  fail "PostgreSQL not running on localhost:5432. Start it with: sudo pg_ctlcluster 16 main start"
fi
ok "PostgreSQL is running"

# ── Verify hrms database ──────────────────────────────────────────────────────
if ! psql -U postgres -h localhost -d hrms -c "SELECT 1" >/dev/null 2>&1 && \
   ! sudo -u postgres psql hrms -c "SELECT 1" >/dev/null 2>&1; then
  fail "Database 'hrms' not found. Run: node scripts/local-db-setup.mjs"
fi
ok "Database 'hrms' exists"

# ── Kill stale processes ───────────────────────────────────────────────────────
step "Cleaning up stale processes"
pkill -f "local-server.mjs" 2>/dev/null || true
pkill -f "apps/api"         2>/dev/null || true
pkill -f "vite"             2>/dev/null || true
sleep 0.5
ok "Ports cleared"

# ── Start local-server (PostgREST + GoTrue) ───────────────────────────────────
step "Starting local-server (port 54321)"
JWT_SECRET=local-dev-jwt-secret-hrms-cognixhr-2024-min32chars \
DATABASE_URL=postgresql://postgres@localhost:5432/hrms \
  node scripts/local-server.mjs > /tmp/local-server.log 2>&1 &
PGRST_PID=$!

sleep 1
if ! kill -0 "$PGRST_PID" 2>/dev/null; then
  cat /tmp/local-server.log
  fail "local-server failed to start"
fi
ok "local-server running (PID $PGRST_PID)"

# ── Start Fastify API ─────────────────────────────────────────────────────────
step "Starting Fastify API (port 2001)"
cd apps/api
npm run dev > /tmp/api.log 2>&1 &
API_PID=$!
cd "$REPO"

sleep 2
if ! kill -0 "$API_PID" 2>/dev/null; then
  cat /tmp/api.log
  fail "Fastify API failed to start"
fi
ok "Fastify API running (PID $API_PID)"

# ── Start Vite web ────────────────────────────────────────────────────────────
step "Starting Vite web server (port 2000)"
cd apps/web
npm run dev > /tmp/web.log 2>&1 &
WEB_PID=$!
cd "$REPO"

sleep 2
if ! kill -0 "$WEB_PID" 2>/dev/null; then
  cat /tmp/web.log
  fail "Vite web server failed to start"
fi
ok "Vite web server running (PID $WEB_PID)"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${G}  All services running!${N}"
echo ""
echo "  CognixHR web:        http://localhost:2000"
echo "  Fastify API:         http://localhost:2001"
echo "  Local Supabase API:  http://localhost:54321"
echo ""
echo "  Logs:"
echo "    tail -f /tmp/local-server.log"
echo "    tail -f /tmp/api.log"
echo "    tail -f /tmp/web.log"
echo ""
echo "  To stop all: pkill -f 'local-server.mjs|tsx|vite'"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"

# Keep running and trap SIGINT to stop all
trap "echo 'Stopping...'; kill $PGRST_PID $API_PID $WEB_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
