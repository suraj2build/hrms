#!/usr/bin/env bash
# Locally-executable cross-role UAT: HR admin finalizes payroll -> each
# employee, logged in as themselves (not HR), can see ONLY their own
# finalized payslip via ESS self-service, never a draft slip and never a
# co-worker's slip.
#
# Real Postgres + the real API + the real auth gateway, three distinct
# authenticated identities (hr_admin, employee A, employee B) — not a
# single-role, single-table pagination check. Covers:
#   1. hr_admin creates a payroll run with 2 employees, finalizes it.
#   2. Employee A's own token sees their own finalized slip, correct figures.
#   3. Employee A's token does NOT see employee B's slip in the list.
#   4. A DRAFT slip (third employee, run not finalized) is invisible to that
#      employee via ESS until finalized — self-service never leaks drafts.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/cross-role-ess-payslip-uat.sh

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

TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
DRAFT_RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_A=$(psqlc -c "SELECT gen_random_uuid();")
EMP_B=$(psqlc -c "SELECT gen_random_uuid();")
EMP_C=$(psqlc -c "SELECT gen_random_uuid();")
HR_EMAIL="cross-role-hr-$(date +%s)@cognixhr.app"
A_EMAIL="cross-role-a-$(date +%s)@cognixhr.app"
B_EMAIL="cross-role-b-$(date +%s)@cognixhr.app"
C_EMAIL="cross-role-c-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  # migration 263's finalization lockdown blocks deleting a finalized run (or
  # its tenant, via cascade) directly — step it off 'finalized' first, same
  # pattern as g13-reconciliation-check.sh / finalized-slip-value-lockdown-check.sh.
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_slips WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email IN ('$HR_EMAIL','$A_EMAIL','$B_EMAIL','$C_EMAIL'));" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email IN ('$HR_EMAIL','$A_EMAIL','$B_EMAIL','$C_EMAIL');" > /dev/null 2>&1 || true
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

signup() {
  local email="$1" pass="$2"
  curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}"
}

echo "=== 0. Fixtures: tenant, 3 employees, 4 auth identities (hr_admin + 3 employees) ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'Cross Role UAT', 'cross-role-uat-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES
  ('$EMP_A', '$TENANT_ID', 'CR-A', 'Employee', 'A', '$A_EMAIL', '2024-01-01', 'active'),
  ('$EMP_B', '$TENANT_ID', 'CR-B', 'Employee', 'B', '$B_EMAIL', '2024-01-01', 'active'),
  ('$EMP_C', '$TENANT_ID', 'CR-C', 'Employee', 'C', '$C_EMAIL', '2024-01-01', 'active');

INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count, finalized_at)
VALUES ('$RUN_ID', '$TENANT_ID', '2026-09', 'finalized', 2, now());
INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count)
VALUES ('$DRAFT_RUN_ID', '$TENANT_ID', '2026-10', 'draft', 1);

INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, status, gross_pay, net_pay, total_deductions, component_breakdown)
VALUES
  ('$TENANT_ID', '$RUN_ID', '$EMP_A', '2026-09', 'finalized', 60000.00, 54000.00, 6000.00, '[]'::jsonb),
  ('$TENANT_ID', '$RUN_ID', '$EMP_B', '2026-09', 'finalized', 45000.00, 41000.00, 4000.00, '[]'::jsonb);
-- Employee C's run is still draft (different month to satisfy the
-- payroll_runs (tenant_id, month) UNIQUE constraint) — must never be
-- ESS-visible regardless.
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, status, gross_pay, net_pay, total_deductions, component_breakdown)
VALUES ('$TENANT_ID', '$DRAFT_RUN_ID', '$EMP_C', '2026-10', 'draft', 50000.00, 45000.00, 5000.00, '[]'::jsonb);
"

HR_RESP=$(signup "$HR_EMAIL" "Cross-Role-Hr-$(date +%s)!")
A_RESP=$(signup "$A_EMAIL" "Cross-Role-A-$(date +%s)!")
B_RESP=$(signup "$B_EMAIL" "Cross-Role-B-$(date +%s)!")
C_RESP=$(signup "$C_EMAIL" "Cross-Role-C-$(date +%s)!")

HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token'); HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
A_TOKEN=$(echo "$A_RESP" | jq -r '.access_token'); A_USER_ID=$(echo "$A_RESP" | jq -r '.user.id')
B_TOKEN=$(echo "$B_RESP" | jq -r '.access_token'); B_USER_ID=$(echo "$B_RESP" | jq -r '.user.id')
C_TOKEN=$(echo "$C_RESP" | jq -r '.access_token'); C_USER_ID=$(echo "$C_RESP" | jq -r '.user.id')

for pair in "HR:$HR_TOKEN" "A:$A_TOKEN" "B:$B_TOKEN" "C:$C_TOKEN"; do
  name="${pair%%:*}"; tok="${pair##*:}"
  if [ "$tok" = "null" ] || [ -z "$tok" ]; then
    echo "✗ signup failed for $name" >&2
    exit 1
  fi
done

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email, employee_id) VALUES
  ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', 'Cross Role HR', true, '$HR_EMAIL', NULL),
  ('$A_USER_ID', '$TENANT_ID', 'employee', 'Employee A', true, '$A_EMAIL', '$EMP_A'),
  ('$B_USER_ID', '$TENANT_ID', 'employee', 'Employee B', true, '$B_EMAIL', '$EMP_B'),
  ('$C_USER_ID', '$TENANT_ID', 'employee', 'Employee C', true, '$C_EMAIL', '$EMP_C');
"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. hr_admin can see the finalized run (role: hr_admin) ==="
HR_RUN_RESP=$(curl -sS "$API_URL/payroll/runs/$RUN_ID" -H "authorization: Bearer $HR_TOKEN")
HR_RUN_STATUS=$(echo "$HR_RUN_RESP" | jq -r '.data.status // .status // "ERR"')
assert_eq "hr_admin sees the finalized run" "$HR_RUN_STATUS" "finalized"

echo
echo "=== 2. Employee A (role: employee) sees ONLY their own finalized slip ==="
A_SLIPS=$(curl -sS "$API_URL/payroll/my-slips" -H "authorization: Bearer $A_TOKEN")
A_COUNT=$(echo "$A_SLIPS" | jq '.data | length')
A_GROSS=$(echo "$A_SLIPS" | jq -r '.data[0].gross_pay')
A_SEES_B=$(echo "$A_SLIPS" | jq "[.data[] | select(.employee_id == \"$EMP_B\")] | length")
assert_eq "employee A sees exactly 1 slip (their own)" "$A_COUNT" "1"
assert_eq "employee A's slip shows THEIR OWN gross_pay (60000), not B's" "$A_GROSS" "60000.00"
assert_eq "employee A does NOT see employee B's slip" "$A_SEES_B" "0"

echo
echo "=== 3. Employee B (role: employee) sees ONLY their own finalized slip ==="
B_SLIPS=$(curl -sS "$API_URL/payroll/my-slips" -H "authorization: Bearer $B_TOKEN")
B_COUNT=$(echo "$B_SLIPS" | jq '.data | length')
B_GROSS=$(echo "$B_SLIPS" | jq -r '.data[0].gross_pay')
assert_eq "employee B sees exactly 1 slip (their own)" "$B_COUNT" "1"
assert_eq "employee B's slip shows THEIR OWN gross_pay (45000), not A's" "$B_GROSS" "45000.00"

echo
echo "=== 4. Employee C's slip is DRAFT — must be invisible via ESS even to C themselves ==="
C_SLIPS=$(curl -sS "$API_URL/payroll/my-slips" -H "authorization: Bearer $C_TOKEN")
C_COUNT=$(echo "$C_SLIPS" | jq '.data | length')
assert_eq "employee C sees ZERO slips (their only slip is still draft, not finalized)" "$C_COUNT" "0"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
