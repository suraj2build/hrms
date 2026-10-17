#!/usr/bin/env bash
# Real-database concurrency + retry/idempotency check for payroll compute.
#
# Drives the REAL Fastify API against REAL Postgres (same stack as
# g13-reconciliation-check.sh / pagination-scale-check.sh). Fires the SAME
# ESI compute request twice CONCURRENTLY for the same tenant+month, then a
# third time serially, and verifies via independent SQL that the result is
# correct and idempotent in all cases — not duplicated, not corrupted by the
# race. This is local, enterprise-qualification-style testing (concurrent
# jobs, retries) that does not need a staging environment — only real
# Postgres, which this sandbox has.
#
# KNOWN LIMITATION: same as the other real-DB scripts in this directory —
# local Postgres + the from-scratch gateway reimplementation, not real
# Supabase/PostgREST. Concurrency behavior against THIS Postgres instance is
# real; whether Supabase's managed Postgres/PostgREST layer serializes
# requests identically is not something this script can prove.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/concurrency-retry-check.sh
#
# Exit code 0 only if every assertion below passed.

set -uo pipefail  # NOT -e: concurrent background jobs' exit codes are checked explicitly below

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-12"
N_EMPLOYEES=50
PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if python3 -c "
import sys
a, e = '''$actual''', '''$expected'''
try:
    sys.exit(0 if abs(float(a) - float(e)) < 0.005 else 1)
except ValueError:
    sys.exit(0 if a.strip() == e.strip() else 1)
"; then
    echo "  ✓ $label = $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ $label: expected $expected, got $actual"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

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

TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
TEST_EMAIL="concurrency-retry-$(date +%s)@cognixhr.app"
USER_ID=""

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$TEST_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$TEST_EMAIL';" > /dev/null 2>&1 || true

  local tenant_left users_left
  tenant_left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  users_left=$(psqlc -c "SELECT count(*) FROM auth.users WHERE email = '$TEST_EMAIL';")
  if [ "$tenant_left" != "0" ] || [ "$users_left" != "0" ]; then
    echo "  ✗ cleanup FAILED: tenant_left=$tenant_left users_left=$users_left" >&2
    exit 1
  fi
  echo "tenant $TENANT_ID and $N_EMPLOYEES employees confirmed removed."
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Fixtures: $N_EMPLOYEES employees + finalized slips ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'Concurrency Retry Test', 'concurrency-retry-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');
"
SIGNUP_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Concurrency-Retry-$(date +%s)!\"}")
TOKEN=$(echo "$SIGNUP_RESP" | jq -r '.access_token')
USER_ID=$(echo "$SIGNUP_RESP" | jq -r '.user.id')
if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "✗ signup failed: $SIGNUP_RESP" >&2
  exit 1
fi

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$USER_ID', '$TENANT_ID', 'hr_admin', 'Concurrency Retry Test User', true, '$TEST_EMAIL');

INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count, finalized_at)
VALUES ('$RUN_ID', '$TENANT_ID', '$MONTH', 'finalized', $N_EMPLOYEES, now());

INSERT INTO esi_config (tenant_id, employee_contribution_pct, employer_contribution_pct, wage_ceiling, effective_from)
VALUES ('$TENANT_ID', 0.75, 3.25, 21000.00, '2026-01-01');

WITH gen AS (
  SELECT gen_random_uuid() AS id, i FROM generate_series(1, $N_EMPLOYEES) AS i
),
ins_emp AS (
  INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
  SELECT id, '$TENANT_ID', 'CONC-' || i, 'Conc', 'Employee' || i, 'conc-emp-' || i || '@example.test', '2025-01-01', 'active'
  FROM gen
  RETURNING id
)
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, status, tds_deducted, component_breakdown)
SELECT '$TENANT_ID', '$RUN_ID', gen.id, '$MONTH', 9500.00, 'finalized', 0.00,
  '[{\"code\":\"ESI_EMPLOYEE\",\"monthly_amount\":71.25},{\"code\":\"ESI_EMPLOYER\",\"monthly_amount\":308.75}]'::jsonb
FROM gen;
"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. Two concurrent compute requests for the same tenant+month ==="
RESP_A_FILE=$(mktemp)
RESP_B_FILE=$(mktemp)
STATUS_A_FILE=$(mktemp)
STATUS_B_FILE=$(mktemp)

(
  resp=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/statutory/esi/contributions/compute" \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"month\":\"$MONTH\"}")
  echo "$resp" | sed '$d' > "$RESP_A_FILE"
  echo "$resp" | tail -1 > "$STATUS_A_FILE"
) &
PID_A=$!

(
  resp=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/statutory/esi/contributions/compute" \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"month\":\"$MONTH\"}")
  echo "$resp" | sed '$d' > "$RESP_B_FILE"
  echo "$resp" | tail -1 > "$STATUS_B_FILE"
) &
PID_B=$!

wait "$PID_A"
wait "$PID_B"

STATUS_A=$(cat "$STATUS_A_FILE")
STATUS_B=$(cat "$STATUS_B_FILE")
echo "  concurrent call A: HTTP $STATUS_A — $(cat "$RESP_A_FILE")"
echo "  concurrent call B: HTTP $STATUS_B — $(cat "$RESP_B_FILE")"

# Both succeeding is the ideal outcome; one failing cleanly (e.g. a
# serialization conflict) while the other succeeds is an acceptable,
# non-corrupting outcome. Both failing, or either returning a non-4xx/5xx
# malformed response, is not.
BOTH_VALID_HTTP="false"
if [[ "$STATUS_A" =~ ^[0-9]+$ ]] && [[ "$STATUS_B" =~ ^[0-9]+$ ]]; then
  if { [ "$STATUS_A" -eq 200 ] || [ "$STATUS_B" -eq 200 ]; }; then
    BOTH_VALID_HTTP="true"
  fi
fi
assert_true "at least one concurrent call succeeded with a well-formed HTTP status" "$BOTH_VALID_HTTP"

rm -f "$RESP_A_FILE" "$RESP_B_FILE" "$STATUS_A_FILE" "$STATUS_B_FILE"

echo
echo "=== 2. Post-concurrency database state (no duplication, no corruption) ==="
POST_CONCURRENT_COUNT=$(psqlc -c "SELECT count(*) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "persisted row count after concurrent calls (must equal employee count exactly — never 2x)" "$POST_CONCURRENT_COUNT" "$N_EMPLOYEES"

DUPLICATE_ROWS=$(psqlc -c "SELECT count(*) FROM (SELECT employee_id FROM esi_contributions WHERE tenant_id = '$TENANT_ID' AND contribution_month = '$MONTH' GROUP BY employee_id HAVING count(*) > 1) d;")
assert_eq "employees with more than one esi_contributions row for the month (the race-condition duplicate signature)" "$DUPLICATE_ROWS" "0"

SUM_AFTER_CONCURRENT=$(psqlc -c "SELECT sum(employee_contribution) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
EXPECTED_SUM=$(python3 -c "print(71.25 * $N_EMPLOYEES)")
assert_eq "sum(employee_contribution) still correct after the race" "$SUM_AFTER_CONCURRENT" "$EXPECTED_SUM"

echo
echo "=== 3. Serial retry (idempotency) — re-running compute must not change the result ==="
RETRY_RESP=$(curl -sS -X POST "$API_URL/payroll/statutory/esi/contributions/compute" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"month\":\"$MONTH\"}")
echo "  retry response: $RETRY_RESP"
RETRY_COMPUTED_COUNT=$(echo "$RETRY_RESP" | jq -r '.computed_count')
assert_eq "retry computed_count" "$RETRY_COMPUTED_COUNT" "$N_EMPLOYEES"

POST_RETRY_COUNT=$(psqlc -c "SELECT count(*) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "persisted row count after retry (unchanged — upsert, not insert)" "$POST_RETRY_COUNT" "$N_EMPLOYEES"

POST_RETRY_SUM=$(psqlc -c "SELECT sum(employee_contribution) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "sum(employee_contribution) unchanged after retry" "$POST_RETRY_SUM" "$EXPECTED_SUM"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
