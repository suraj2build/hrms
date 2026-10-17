#!/usr/bin/env bash
# Real-database proof that this round's attendance/survey/widget fixes
# actually prevent truncation and ownership-bypass, not just "pass tsc".
#
# Directly answers three review points:
#   1. Single-employee date-range queries (UNB-010/UNB-042) are bounded by
#      employee scope ALONE only if the date span can't exceed ~1,000 days.
#      Nothing capped the span before this round's fix — this script proves
#      it with a real >1,000-row single-employee history.
#   2. The missing-punches-today widget (UNB-044): a bounded 50-row display
#      is fine, but the `count` field must reflect the TRUE total, not
#      employees.length.
#   3. Fails-closed ownership validation (surveys ownership check) must
#      still reject a foreign-tenant id even when it falls in a LATER
#      chunk (past the first 100), not just the first.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/attendance-survey-truncation-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [ "$(echo "$actual" | xargs)" = "$(echo "$expected" | xargs)" ]; then
    echo "  ✓ $label = $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ $label: expected '$expected', got '$actual'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

TENANT_A=$(psqlc -c "SELECT gen_random_uuid();")
TENANT_B=$(psqlc -c "SELECT gen_random_uuid();")
LONG_TENURE_EMP=$(psqlc -c "SELECT gen_random_uuid();")
FOREIGN_EMP=$(psqlc -c "SELECT gen_random_uuid();")
HR_EMAIL="trunc-hr-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM attendance_daily WHERE tenant_id IN ('$TENANT_A','$TENANT_B');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM attendance_logs WHERE tenant_id = '$TENANT_A';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_A';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id IN ('$TENANT_A','$TENANT_B');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id IN ('$TENANT_A','$TENANT_B');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$HR_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$HR_EMAIL';" > /dev/null 2>&1 || true
  local left
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id IN ('$TENANT_A','$TENANT_B');")
  if [ "$left" != "0" ]; then
    echo "  ✗ cleanup FAILED: tenants_left=$left" >&2
    exit 1
  fi
  echo "both tenants confirmed removed."
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Fixtures ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at) VALUES
  ('$TENANT_A', 'Truncation Test A', 'trunc-test-a-${TENANT_A:0:8}', 'active', true, now() + interval '1 day'),
  ('$TENANT_B', 'Truncation Test B', 'trunc-test-b-${TENANT_B:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$LONG_TENURE_EMP', '$TENANT_A', 'LT-1', 'LongTenure', 'Employee', 'lt-emp@example.test', '2021-01-01', 'active');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$FOREIGN_EMP', '$TENANT_B', 'FOR-1', 'Foreign', 'Employee', 'foreign-emp@example.test', '2025-01-01', 'active');
"
HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"Trunc-Hr-$(date +%s)!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$HR_USER_ID', '$TENANT_A', 'hr_admin', 'Trunc Hr', true, '$HR_EMAIL');
"
echo "fixtures created under tenant A=$TENANT_A, tenant B=$TENANT_B"

echo
echo "=== 1. UNB-042 fix: single-employee date-range query must not truncate at 1,000 rows ==="
# 1,200 days of attendance_daily history for ONE employee (2021-06-01 .. ~2024-10-13),
# well past PostgREST's 1,000-row response cap the gateway enforces, with a
# wide-enough from/to window that the OLD code (no fetchAllRows) would have
# silently truncated total_days/critical_days at 1,000.
psqlc -c "
INSERT INTO attendance_daily (tenant_id, employee_id, date, status, confidence_score, confidence_level, work_hours)
SELECT '$TENANT_A', '$LONG_TENURE_EMP',
       ('2021-06-01'::date + (n || ' days')::interval)::date,
       'present',
       50,
       CASE WHEN n % 10 = 0 THEN 'critical' ELSE 'high' END,
       8.0
FROM generate_series(0, 1199) AS n
ON CONFLICT (tenant_id, employee_id, date) DO NOTHING;
"
SEEDED_COUNT=$(psqlc -c "SELECT count(*) FROM attendance_daily WHERE tenant_id = '$TENANT_A' AND employee_id = '$LONG_TENURE_EMP';")
assert_eq "seeded 1,200 attendance_daily rows for one employee" "$SEEDED_COUNT" "1200"

CONF_RESP=$(curl -sS "$API_URL/attendance/confidence/employee/$LONG_TENURE_EMP?from=2021-06-01&to=2024-10-13" \
  -H "authorization: Bearer $HR_TOKEN")
CONF_TOTAL_DAYS=$(echo "$CONF_RESP" | jq -r '.stats.total_days')
CONF_CRITICAL_DAYS=$(echo "$CONF_RESP" | jq -r '.stats.critical_days')
assert_eq "GET .../confidence/employee total_days reflects the TRUE count, not the 1,000-row cap" "$CONF_TOTAL_DAYS" "1200"
assert_eq "critical_days (1 in 10 of 1,200) is computed from the full set" "$CONF_CRITICAL_DAYS" "120"

echo
echo "=== 2. UNB-044 fix: missing-punches-today widget — count must be the TRUE total, not the capped display length ==="
# 60 qualifying check-in-no-check-out rows today — more than the widget's .limit(50) display cap.
psqlc -c "
INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
SELECT gen_random_uuid(), '$TENANT_A', 'MP-' || n, 'Missing', 'Punch' || n, 'missing-punch-' || n || '@example.test', '2024-01-01', 'active'
FROM generate_series(1, 60) AS n;
INSERT INTO attendance_logs (tenant_id, employee_id, check_in, check_out, is_complete)
SELECT '$TENANT_A', e.id, now() - interval '2 hours', NULL, false
FROM employees e WHERE e.tenant_id = '$TENANT_A' AND e.employee_code LIKE 'MP-%';
"
MP_RESP=$(curl -sS "$API_URL/attendance/missing-punches/today" -H "authorization: Bearer $HR_TOKEN")
MP_COUNT=$(echo "$MP_RESP" | jq -r '.data.count')
MP_DISPLAY_LEN=$(echo "$MP_RESP" | jq -r '.data.employees | length')
MP_TRUNCATED=$(echo "$MP_RESP" | jq -r '.data.truncated')
assert_eq "missing-punches-today: display list capped at 50 (intentional, bounded widget)" "$MP_DISPLAY_LEN" "50"
assert_eq "missing-punches-today: count reflects the TRUE total (60), not the capped display length" "$MP_COUNT" "60"
assert_eq "missing-punches-today: truncated flag correctly set when count > displayed" "$MP_TRUNCATED" "true"

echo
echo "=== 3. Fails-closed ownership validation: a foreign-tenant id in a LATER chunk must still be rejected ==="
# 105 ids: 104 real tenant-A employees (we only have 2 fixtures + 60 missing-punch
# ones = 62; pad with the same real id repeated isn't valid for Set dedup, so
# generate 104 distinct real employees) + 1 foreign-tenant id placed at position
# 101 — past the first 100-id chunk boundary. If chunking silently dropped the
# error-check on a later chunk, this foreign id could slip through.
psqlc -c "
INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
SELECT gen_random_uuid(), '$TENANT_A', 'BULK-' || n, 'Bulk', 'Emp' || n, 'bulk-emp-' || n || '@example.test', '2024-01-01', 'active'
FROM generate_series(1, 104) AS n;
"
REAL_IDS=$(psqlc -c "SELECT id FROM employees WHERE tenant_id = '$TENANT_A' AND employee_code LIKE 'BULK-%' ORDER BY employee_code;")
REAL_IDS_JSON=$(echo "$REAL_IDS" | jq -R -s 'split("\n") | map(select(length > 0))')
# Build a 105-element array: 104 real ids then the foreign id (position 105,
# in the SECOND chunk since chunks are 100-wide).
PAYLOAD=$(jq -n --argjson real "$REAL_IDS_JSON" --arg foreign "$FOREIGN_EMP" \
  '{employee_ids: ($real + [$foreign])}')
SURVEY_ID=$(psqlc -c "SELECT gen_random_uuid();")
psqlc -c "
INSERT INTO surveys (id, tenant_id, title, survey_type, status, created_by)
VALUES ('$SURVEY_ID', '$TENANT_A', 'Truncation Test 360', 'feedback_360', 'draft', '$HR_USER_ID');
" 2>&1 | grep -v "INSERT 0 1" || true

SETUP_RESP=$(curl -sS -X POST "$API_URL/surveys/admin/$SURVEY_ID/360/setup" \
  -H "authorization: Bearer $HR_TOKEN" -H 'content-type: application/json' \
  -d "$PAYLOAD")
SETUP_ERROR=$(echo "$SETUP_RESP" | jq -r '.error // "NONE"')
assert_eq "360 setup REJECTS a foreign-tenant id placed past the first 100-id chunk boundary" "$SETUP_ERROR" "INVALID_EMPLOYEES"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
