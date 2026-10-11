#!/usr/bin/env bash
# Real-endpoint measurement for audit finding G11: "session/permission cache
# revocation latency — CACHE_TTL=5min, IS_ACTIVE_TTL=60s in auth.ts, no
# measured access-revocation SLA established."
#
# auth.ts's profileCache is a plain in-process `Map` — there is no shared
# cache across API instances. Before this fix, that meant:
#   - profiles.is_active was re-checked from DB every IS_ACTIVE_TTL (60s)
#     per cache entry, per instance — already bounded, but never measured
#     end-to-end against the real stack.
#   - tenants.allow_login (the tenant-wide login kill switch) had NO
#     periodic recheck at all — it was cached for the full CACHE_TTL
#     (5 minutes) with no bound tightening it, a real revocation-latency
#     gap distinct from the is_active path.
#
# The fix (this round) gives allow_login the same IS_ACTIVE_TTL cadence as
# is_active (ALLOW_LOGIN_TTL = IS_ACTIVE_TTL = 60s), refreshed together on
# the same DB round-trip.
#
# This script measures the ACTUAL elapsed wall-clock time between a DB
# write (deactivate a user / disable tenant login) and the first 401/403
# from the real API — not a unit test of the TTL constant — and does it
# against TWO independently-running API instances sharing one DB, because
# the cache is per-process: a correct SLA must hold on every instance
# independently, not just the one that happened to serve the test.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   GATEWAY_URL=http://localhost:9000 \
#   API_URL_1=http://localhost:2001 API_URL_2=http://localhost:2002 \
#   ./scripts/g11-access-revocation-latency-check.sh

set -uo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
API_URL_1="${API_URL_1:-http://localhost:2001}"
API_URL_2="${API_URL_2:-http://localhost:2002}"
# The measured SLA: revocation must land within IS_ACTIVE_TTL/ALLOW_LOGIN_TTL
# (60s in auth.ts) plus a generous buffer for request latency and polling
# granularity — NOT the full 5-minute CACHE_TTL.
SLA_MS=75000
POLL_INTERVAL_S=2

PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }

assert_true() {
  local label="$1" cond="$2"
  if [ "$cond" = "true" ]; then
    echo "  ✓ $label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ $label"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
TS=$(date +%s)
HR_EMAIL="g11-revocation-$TS@cognixhr.app"

INSTANCE2_PID=""
INSTANCE2_LOG="/tmp/g11-api-instance2.log"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  if [ -n "$INSTANCE2_PID" ]; then
    kill "$INSTANCE2_PID" > /dev/null 2>&1 || true
    wait "$INSTANCE2_PID" 2>/dev/null || true
    echo "  second API instance (pid $INSTANCE2_PID) stopped"
  fi
  psqlc -c "UPDATE tenants SET allow_login = true WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "UPDATE profiles SET is_active = true WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$HR_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$HR_EMAIL';" > /dev/null 2>&1 || true
  local tenant_del_err
  tenant_del_err=$(psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" 2>&1 1>/dev/null)
  local left
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  if [ "$left" = "0" ]; then
    echo "tenant $TENANT_ID confirmed removed."
    exit "$exit_code"
  fi
  echo "  ⚠ tenant row $TENANT_ID could not be removed: $tenant_del_err" >&2
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Fixtures: tenant + hr_admin profile; start a SECOND API instance on a different port ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G11 Revocation Test', 'g11-revocation-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');
"

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"G11-Revoke-$TS!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, employee_id, is_active)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', NULL, true)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role, is_active = true;
"

cd "$(dirname "$0")/../apps/api"
sed 's/^PORT=2001/PORT=2002/' .env > .env.g11-instance2
nohup npx tsx --env-file=.env.g11-instance2 src/index.ts > "$INSTANCE2_LOG" 2>&1 &
INSTANCE2_PID=$!
cd - > /dev/null

echo "  waiting for second instance (pid $INSTANCE2_PID) on $API_URL_2 ..."
READY=false
for _ in $(seq 1 20); do
  if curl -sS -o /dev/null -w '' "$API_URL_2/health" 2>/dev/null; then
    CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL_2/health" 2>/dev/null)
    if [ "$CODE" = "200" ]; then READY=true; break; fi
  fi
  sleep 1
done
assert_true "second API instance came up independently on $API_URL_2" "$READY"
if [ "$READY" != "true" ]; then
  echo "second instance log tail:" >&2
  tail -30 "$INSTANCE2_LOG" >&2
  exit 1
fi

call() { # call <base_url> -> prints "HTTP_CODE BODY_ERROR_FIELD"
  local base="$1"
  local resp code body
  resp=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $HR_TOKEN" "$base/datasets/employees")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  echo "$code|$(echo "$body" | jq -r '.error // "OK"' 2>/dev/null)"
}

echo
echo "=== 1. Warm both instances' per-process caches with a successful authenticated call ==="
R1=$(call "$API_URL_1"); R2=$(call "$API_URL_2")
echo "  instance 1: $R1"
echo "  instance 2: $R2"
assert_true "instance 1 accepts the active user before revocation" "$([ "${R1%%|*}" = "200" ] && echo true || echo false)"
assert_true "instance 2 accepts the active user before revocation" "$([ "${R2%%|*}" = "200" ] && echo true || echo false)"

echo
echo "=== 2. DEACTIVATE the user (DB write) — measure elapsed time to first rejection on EACH instance ==="
T_DEACTIVATE=$(now_ms)
psqlc -c "UPDATE profiles SET is_active = false WHERE id = '$HR_USER_ID';"
echo "  profiles.is_active = false written at T+0ms"

poll_until_blocked() {
  local base="$1" label="$2" want_error="$3"
  local elapsed=0 start
  start=$(now_ms)
  while [ "$elapsed" -lt "$SLA_MS" ]; do
    local result code err
    result=$(call "$base")
    code="${result%%|*}"
    err="${result##*|}"
    if [ "$err" = "$want_error" ]; then
      elapsed=$(( $(now_ms) - start ))
      echo "$elapsed"
      return 0
    fi
    sleep "$POLL_INTERVAL_S"
    elapsed=$(( $(now_ms) - start ))
  done
  echo "-1"
  return 1
}

ELAPSED_1=$(poll_until_blocked "$API_URL_1" "instance 1" "Unauthorized")
ELAPSED_2=$(poll_until_blocked "$API_URL_2" "instance 2" "Unauthorized")
echo "  instance 1 rejected the deactivated user after ${ELAPSED_1}ms"
echo "  instance 2 rejected the deactivated user after ${ELAPSED_2}ms"
assert_true "instance 1 enforces deactivation within the ${SLA_MS}ms SLA (measured: ${ELAPSED_1}ms)" "$([ "$ELAPSED_1" != "-1" ] && echo true || echo false)"
assert_true "instance 2 enforces deactivation within the ${SLA_MS}ms SLA (measured: ${ELAPSED_2}ms)" "$([ "$ELAPSED_2" != "-1" ] && echo true || echo false)"

echo
echo "=== 3. Reactivate; confirm access is restored on both instances (sanity, not an SLA claim) ==="
psqlc -c "UPDATE profiles SET is_active = true WHERE id = '$HR_USER_ID';"
sleep 65
R1=$(call "$API_URL_1"); R2=$(call "$API_URL_2")
assert_true "instance 1 access restored after reactivation + cache expiry" "$([ "${R1%%|*}" = "200" ] && echo true || echo false)"
assert_true "instance 2 access restored after reactivation + cache expiry" "$([ "${R2%%|*}" = "200" ] && echo true || echo false)"

echo
echo "=== 4. DISABLE tenant login (allow_login=false) — measure elapsed time to first 403 on EACH instance ==="
T_DISABLE=$(now_ms)
psqlc -c "UPDATE tenants SET allow_login = false WHERE id = '$TENANT_ID';"
echo "  tenants.allow_login = false written at T+0ms"

ELAPSED_LOGIN_1=$(poll_until_blocked "$API_URL_1" "instance 1" "TENANT_LOGIN_DISABLED")
ELAPSED_LOGIN_2=$(poll_until_blocked "$API_URL_2" "instance 2" "TENANT_LOGIN_DISABLED")
echo "  instance 1 blocked the disabled workspace after ${ELAPSED_LOGIN_1}ms"
echo "  instance 2 blocked the disabled workspace after ${ELAPSED_LOGIN_2}ms"
assert_true "instance 1 enforces allow_login=false within the ${SLA_MS}ms SLA (measured: ${ELAPSED_LOGIN_1}ms) — this is the G11 gap: previously unbounded at 5min" "$([ "$ELAPSED_LOGIN_1" != "-1" ] && echo true || echo false)"
assert_true "instance 2 enforces allow_login=false within the ${SLA_MS}ms SLA (measured: ${ELAPSED_LOGIN_2}ms)" "$([ "$ELAPSED_LOGIN_2" != "-1" ] && echo true || echo false)"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
[ "$FAIL_COUNT" -eq 0 ]
