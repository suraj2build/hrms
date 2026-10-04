#!/usr/bin/env bash
# Real-endpoint reproduction for audit finding G03: the Full & Final
# settlement engine's "salary basis" query had no status filter, so a DRAFT
# payroll slip (unreviewed, possibly mid-correction) could outrank an older
# FINALIZED slip purely by month and get used as the gratuity/notice-pay
# basis instead of the actual finalized number.
#
# Root cause (apps/api/src/lib/fnf-settlement-engine.ts, "4. Salary basis"):
# the query selected payroll_slips ordered by month desc, limit 1, with NO
# .eq('status', 'finalized') filter — despite the adjacent comment literally
# saying "last finalized payroll slip". Fixed by adding that filter.
#
# This script:
#   1. Seeds an OLDER finalized slip (month 2026-06, gross_pay=50000) and a
#      NEWER draft slip (month 2026-07, gross_pay=99999) for the same
#      employee.
#   2. Initiates a separation record directly (last_working_date set,
#      notice waived to keep the scenario isolated to the salary-basis bug).
#   3. Drives the REAL POST /employees/:id/separation-ff/compute endpoint.
#   4. Asserts the returned breakdown.salary_basis_gross/basic reflect the
#      OLDER FINALIZED slip (50000/25000), not the NEWER DRAFT slip
#      (99999/77777) that would win pre-fix by month ordering alone.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/g03-fnf-settlement-last-finalized-slip-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if python3 -c "
import sys
a, e = '''$actual''', '''$expected'''
try:
    sys.exit(0 if abs(float(a) - float(e)) < 0.01 else 1)
except ValueError:
    sys.exit(0 if a.strip() == e.strip() else 1)
"; then
    echo "  ✓ $label = $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ $label: expected '$expected', got '$actual'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_OLD_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_NEW_ID=$(psqlc -c "SELECT gen_random_uuid();")
HR_EMAIL="g03-fnf-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM separation_ff_summary WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_separation WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  # fn_block_finalized_payroll_slip_delete checks the PARENT RUN's status, not
  # the slip's own status — roll the run back to draft first (same pattern as
  # finalized-slip-value-lockdown-check.sh's "rollback path").
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_slips WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$HR_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$HR_EMAIL';" > /dev/null 2>&1 || true
  local left
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  if [ "$left" != "0" ]; then
    echo "  ✗ cleanup FAILED: tenant_left=$left" >&2
    exit 1
  fi
  echo "tenant $TENANT_ID confirmed removed."
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Fixtures: tenant, employee, separation record, two payroll runs/slips ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G03 FnF Test', 'g03-fnf-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$EMP_ID', '$TENANT_ID', 'G03-1', 'Fnf', 'Employee', 'g03-fnf-emp@example.test', '2015-01-01', 'active');

INSERT INTO employee_separation (tenant_id, employee_id, separation_type, initiated_by, last_working_date, notice_waived)
VALUES ('$TENANT_ID', '$EMP_ID', 'resignation', 'employee', '2026-07-31', true);

INSERT INTO payroll_runs (id, tenant_id, month, status)
VALUES ('$RUN_OLD_ID', '$TENANT_ID', '2026-06', 'finalized'),
       ('$RUN_NEW_ID', '$TENANT_ID', '2026-07', 'draft');

-- OLDER slip, FINALIZED: gross=50000, BASIC=25000 — this must win post-fix.
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, component_breakdown, status)
VALUES ('$TENANT_ID', '$RUN_OLD_ID', '$EMP_ID', '2026-06', 50000.00,
  '[{\"code\":\"BASIC\",\"monthly_amount\":25000}]'::jsonb, 'finalized');

-- NEWER slip, still DRAFT: gross=99999, BASIC=77777 — must NOT win despite
-- being the more recent month; it has not been reviewed/finalized.
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, component_breakdown, status)
VALUES ('$TENANT_ID', '$RUN_NEW_ID', '$EMP_ID', '2026-07', 99999.00,
  '[{\"code\":\"BASIC\",\"monthly_amount\":77777}]'::jsonb, 'draft');
"
echo "fixtures created under tenant $TENANT_ID"

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"G03-Fnf-$(date +%s)!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', 'G03 Fnf Hr', true, '$HR_EMAIL');
"

echo
echo "=== 1. Compute F&F settlement through the REAL POST /employees/:id/separation-ff/compute endpoint ==="
COMPUTE_RESP=$(curl -sS -X POST "$API_URL/employees/$EMP_ID/separation-ff/compute" \
  -H "authorization: Bearer $HR_TOKEN" -H 'content-type: application/json' -d '{}')
echo "  compute response: $COMPUTE_RESP"

SALARY_BASIS_GROSS=$(echo "$COMPUTE_RESP" | jq -r '.breakdown.salary_basis_gross // empty')
SALARY_BASIS_BASIC=$(echo "$COMPUTE_RESP" | jq -r '.breakdown.salary_basis_basic // empty')

echo
echo "=== 2. Salary basis must come from the OLDER FINALIZED slip, not the NEWER DRAFT slip ==="
assert_eq "salary_basis_gross reflects the finalized slip (50000), not the newer draft (99999)" "$SALARY_BASIS_GROSS" "50000"
assert_eq "salary_basis_basic reflects the finalized slip's BASIC (25000), not the newer draft's (77777)" "$SALARY_BASIS_BASIC" "25000"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
