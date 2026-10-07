#!/usr/bin/env bash
# Real-database pagination scale check — proves the A1 statutory wage-base
# fetchAllRows()/fetchAllRowsByKeyset() fixes against an ACTUAL max-rows=1000
# cap, not a vitest mock. Covers ESI, EPF, and PTax compute — all three share
# the identical payroll_slips-wage-base-plus-fallback pattern this cluster
# fixed.
#
# Drives the REAL Fastify API against a REAL Postgres, through the same
# PostgREST-compatible gateway as g13-reconciliation-check.sh (which also
# enforces MAX_ROWS=1000 — see /tmp/supabase-gateway.mjs — faithfully
# reproducing the exact silent-truncation behavior this whole remediation
# pass exists to fix). Seeds 2,200 employees (> the 1,000-row cap, and past
# the originally-tested 1,200) with finalized payroll slips, computes ESI +
# EPF + PTax contributions for real, and verifies — via independent SQL
# aggregates, not just the API's own response — that all 2,200 are present
# and correct, not silently truncated to 1,000.
#
# KNOWN LIMITATION: same as g13-reconciliation-check.sh — this is a local
# Postgres + a from-scratch gateway reimplementation of PostgREST's
# NUMERIC-as-string and max-rows behavior, not a real Supabase/PostgREST
# project. It proves the fix against that faithfully-reproduced behavior; it
# does not substitute for the real-staging 2,000+ employee validation gate,
# which needs a genuine Supabase/PostgREST project this sandbox has no access
# to.
#
# Requirements: psql, curl, jq, python3 on PATH. Needs a running Postgres,
# gateway (GATEWAY_URL), and API (API_URL) — see g13-reconciliation-check.sh
# for how to start them in this sandbox.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/pagination-scale-check.sh
#
# Exit code 0 only if every assertion below passed.

set -euo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-12"
FY="2026-27"
N_EMPLOYEES=2200   # > PostgREST's max-rows=1000, and past the originally-tested 1,200
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

# Same http() contract as g13-reconciliation-check.sh: non-2xx returns 1 and
# — because every call site below is a plain top-level assignment, never
# `local x=$(http ...)` — actually aborts the script under `set -e`.
http() {
  local method="$1" url="$2" data="${3:-}"
  local resp status body
  if [ -n "$data" ]; then
    resp=$(curl -sS -w '\n%{http_code}' -X "$method" "$url" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$data")
  else
    resp=$(curl -sS -w '\n%{http_code}' -X "$method" "$url" -H "authorization: Bearer $TOKEN")
  fi
  status=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  echo "$body"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "  ✗ HTTP $status from $method $url" >&2
    echo "    body: $body" >&2
    return 1
  fi
  return 0
}

TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
TEST_EMAIL="pagination-scale-$(date +%s)@cognixhr.app"
USER_ID=""

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  # Same FK-ordering note as g13-reconciliation-check.sh: delete employees
  # before the tenant row so log_employee_changes()'s non-deferrable
  # audit_logs_tenant_id_fkey insert still has a parent tenant to satisfy.
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$TEST_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$TEST_EMAIL';" > /dev/null 2>&1 || true

  local tenant_left users_left identities_left
  tenant_left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  users_left=$(psqlc -c "SELECT count(*) FROM auth.users WHERE email = '$TEST_EMAIL';")
  if [ -n "$USER_ID" ]; then
    identities_left=$(psqlc -c "SELECT count(*) FROM auth.identities WHERE provider_id = '$USER_ID';")
  else
    identities_left=0
  fi
  if [ "$tenant_left" != "0" ] || [ "$users_left" != "0" ] || [ "$identities_left" != "0" ]; then
    echo "  ✗ cleanup FAILED: tenant_left=$tenant_left users_left=$users_left identities_left=$identities_left" >&2
    exit 1
  fi
  echo "tenant $TENANT_ID, $N_EMPLOYEES employees, auth user $USER_ID and its identity row all confirmed removed."
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Fixtures: $N_EMPLOYEES employees + finalized slips ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'Pagination Scale Test', 'pagination-scale-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');
"

SIGNUP_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Pagination-Scale-$(date +%s)!\"}")
TOKEN=$(echo "$SIGNUP_RESP" | jq -r '.access_token')
USER_ID=$(echo "$SIGNUP_RESP" | jq -r '.user.id')
if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "✗ signup failed: $SIGNUP_RESP" >&2
  exit 1
fi

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$USER_ID', '$TENANT_ID', 'hr_admin', 'Pagination Scale Test User', true, '$TEST_EMAIL');

INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count, finalized_at)
VALUES ('$RUN_ID', '$TENANT_ID', '$MONTH', 'finalized', $N_EMPLOYEES, now());

INSERT INTO esi_config (tenant_id, employee_contribution_pct, employer_contribution_pct, wage_ceiling, effective_from)
VALUES ('$TENANT_ID', 0.75, 3.25, 21000.00, '2026-01-01');

INSERT INTO epf_config (tenant_id, employee_contribution_pct, employer_pf_pct, employer_eps_pct, wage_ceiling, is_wage_ceiling_applicable, effective_from)
VALUES ('$TENANT_ID', 12.00, 3.67, 8.33, 15000.00, true, '2026-01-01');

INSERT INTO ptax_slabs (tenant_id, financial_year, state_code, monthly_income_from, monthly_income_to, monthly_ptax, frequency, is_active)
VALUES ('$TENANT_ID', '$FY', 'KA', 0, NULL, 200.00, 'monthly', true);

-- Bulk-generate \$N_EMPLOYEES employees, each with exactly one finalized
-- slip at gross 9500 (under the ESI 21000 ceiling) and explicit ESI_EMPLOYEE/
-- ESI_EMPLOYER/PF_EMPLOYEE/PF_EMPLOYER lines in component_breakdown — the
-- slip IS the source of truth per esi.ts/epf.ts, so every employee's
-- persisted contribution must equal these exact figures, not a recomputed
-- or (if truncated) a zero/default. A manual ptax_state_config override
-- (KA) means PTax doesn't need a site/site_id round-trip.
WITH gen AS (
  SELECT gen_random_uuid() AS id, i FROM generate_series(1, $N_EMPLOYEES) AS i
),
ins_emp AS (
  INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
  SELECT id, '$TENANT_ID', 'SCALE-' || i, 'Scale', 'Employee' || i, 'scale-emp-' || i || '@example.test', '2025-01-01', 'active'
  FROM gen
  RETURNING id
),
ins_slips AS (
  INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, status, tds_deducted, component_breakdown)
  SELECT '$TENANT_ID', '$RUN_ID', gen.id, '$MONTH', 9500.00, 'finalized', 0.00,
    '[{\"code\":\"ESI_EMPLOYEE\",\"monthly_amount\":71.25},{\"code\":\"ESI_EMPLOYER\",\"monthly_amount\":308.75},{\"code\":\"PF_EMPLOYEE\",\"monthly_amount\":1140.00},{\"code\":\"PF_EMPLOYER\",\"monthly_amount\":1140.00},{\"component_type\":\"earning\",\"is_pf_applicable\":true,\"code\":\"BASIC\",\"monthly_amount\":9500}]'::jsonb
  FROM gen
  RETURNING 1
)
INSERT INTO ptax_state_config (tenant_id, employee_id, state_code, effective_from)
SELECT '$TENANT_ID', gen.id, 'KA', '2025-01-01'
FROM gen;
"
ACTUAL_EMP_COUNT=$(psqlc -c "SELECT count(*) FROM employees WHERE tenant_id = '$TENANT_ID';")
assert_eq "fixture employee count" "$ACTUAL_EMP_COUNT" "$N_EMPLOYEES"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. ESI compute against $N_EMPLOYEES employees (> the 1,000-row cap) ==="
ESI_RESP=$(http POST "$API_URL/payroll/statutory/esi/contributions/compute" "{\"month\":\"$MONTH\"}")
echo "  compute response: $ESI_RESP"
COMPUTED_COUNT=$(echo "$ESI_RESP" | jq -r '.computed_count')
assert_eq "computed_count (API response)" "$COMPUTED_COUNT" "$N_EMPLOYEES"

echo
echo "=== 2. Independent SQL read-back (not just the API's own claim) ==="
PERSISTED_COUNT=$(psqlc -c "SELECT count(*) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "persisted esi_contributions row count" "$PERSISTED_COUNT" "$N_EMPLOYEES"

PERSISTED_EMP_SUM=$(psqlc -c "SELECT sum(employee_contribution) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
EXPECTED_EMP_SUM=$(python3 -c "print(71.25 * $N_EMPLOYEES)")
assert_eq "sum(employee_contribution) across all $N_EMPLOYEES rows" "$PERSISTED_EMP_SUM" "$EXPECTED_EMP_SUM"

ZERO_WAGE_COUNT=$(psqlc -c "SELECT count(*) FROM esi_contributions WHERE tenant_id = '$TENANT_ID' AND esi_wages = 0;")
assert_eq "employees with esi_wages=0 (the pre-fix truncation signature)" "$ZERO_WAGE_COUNT" "0"

DISTINCT_WAGE_VALUES=$(psqlc -c "SELECT count(DISTINCT esi_wages) FROM esi_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "distinct esi_wages value (every employee has the same real 9500, not a mix of real + fallback-zero)" "$DISTINCT_WAGE_VALUES" "1"

echo
echo "=== 3. EPF compute against $N_EMPLOYEES employees (same payroll_slips keyset read as ESI) ==="
EPF_RESP=$(http POST "$API_URL/payroll/statutory/epf/contributions/compute" "{\"month\":\"$MONTH\"}")
echo "  compute response: $EPF_RESP"
EPF_COMPUTED_COUNT=$(echo "$EPF_RESP" | jq -r '.computed_count')
assert_eq "EPF computed_count (API response)" "$EPF_COMPUTED_COUNT" "$N_EMPLOYEES"

echo
echo "=== 4. EPF independent SQL read-back ==="
EPF_PERSISTED_COUNT=$(psqlc -c "SELECT count(*) FROM epf_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "persisted epf_contributions row count" "$EPF_PERSISTED_COUNT" "$N_EMPLOYEES"

EPF_EMP_SUM=$(psqlc -c "SELECT sum(employee_contribution) FROM epf_contributions WHERE tenant_id = '$TENANT_ID';")
EPF_EXPECTED_EMP_SUM=$(python3 -c "print(1140.00 * $N_EMPLOYEES)")
assert_eq "sum(epf employee_contribution) across all $N_EMPLOYEES rows" "$EPF_EMP_SUM" "$EPF_EXPECTED_EMP_SUM"

EPF_ZERO_WAGE_COUNT=$(psqlc -c "SELECT count(*) FROM epf_contributions WHERE tenant_id = '$TENANT_ID' AND pf_wages = 0;")
assert_eq "employees with pf_wages=0 (the pre-fix truncation signature)" "$EPF_ZERO_WAGE_COUNT" "0"

EPF_DISTINCT_WAGES=$(psqlc -c "SELECT count(DISTINCT pf_wages) FROM epf_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "distinct pf_wages value (no silent fallback-to-ceiling mixed in)" "$EPF_DISTINCT_WAGES" "1"

echo
echo "=== 5. PTax compute against $N_EMPLOYEES employees (same payroll_slips keyset read) ==="
PTAX_RESP=$(http POST "$API_URL/payroll/statutory/ptax/contributions/compute" "{\"month\":\"$MONTH\",\"financial_year\":\"$FY\"}")
echo "  compute response: $PTAX_RESP"
PTAX_COMPUTED_COUNT=$(echo "$PTAX_RESP" | jq -r '.computed_count')
assert_eq "PTax computed_count (API response)" "$PTAX_COMPUTED_COUNT" "$N_EMPLOYEES"

echo
echo "=== 6. PTax independent SQL read-back ==="
PTAX_PERSISTED_COUNT=$(psqlc -c "SELECT count(*) FROM ptax_contributions WHERE tenant_id = '$TENANT_ID';")
assert_eq "persisted ptax_contributions row count" "$PTAX_PERSISTED_COUNT" "$N_EMPLOYEES"

PTAX_AMOUNT_SUM=$(psqlc -c "SELECT sum(ptax_amount) FROM ptax_contributions WHERE tenant_id = '$TENANT_ID';")
PTAX_EXPECTED_SUM=$(python3 -c "print(200.00 * $N_EMPLOYEES)")
assert_eq "sum(ptax_amount) across all $N_EMPLOYEES rows" "$PTAX_AMOUNT_SUM" "$PTAX_EXPECTED_SUM"

PTAX_ZERO_GROSS_COUNT=$(psqlc -c "SELECT count(*) FROM ptax_contributions WHERE tenant_id = '$TENANT_ID' AND gross_salary = 0;")
assert_eq "employees with gross_salary=0 (the pre-fix truncation signature)" "$PTAX_ZERO_GROSS_COUNT" "0"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
