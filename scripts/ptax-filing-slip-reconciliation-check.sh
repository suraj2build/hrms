#!/usr/bin/env bash
# Real-endpoint reproduction for a financial-chain reconciliation gap found
# while tracing leave -> payroll -> TDS/EPF/ESI/PTax -> filing for this
# engagement's broader "reconcile every financial output" task.
#
# EPF (epf.ts) and ESI (esi.ts) both explicitly take their employee-deduction
# amount straight from the finalized payroll slip's PF_EMPLOYEE/ESI_EMPLOYEE
# line when one exists ("SLIP IS THE SOURCE OF TRUTH" — see their own
# comments), specifically so the statutory filing tables can never diverge
# from what the employee's actual payslip deducted and net_pay reflects.
#
# PTax (ptax.ts /contributions/compute) did NOT have this guard: it reused
# the slip's gross wages but then RECOMPUTED ptax_amount fresh against
# whatever ptax_slabs/ptax_state_settings are configured AT COMPUTE TIME —
# a separate, later admin action from payroll finalize. If a tenant edits
# its PT slabs between finalizing a month's payroll and running this compute
# step, the ptax_contributions row used for the actual government filing and
# bank deposit would show a DIFFERENT amount than what the employee's
# payslip deducted — the deposit and the filing would not match the payslip,
# which is the same class of bug EPF/ESI were already hardened against.
#
# Fix (apps/api/src/routes/payroll/statutory/ptax.ts): mirror EPF/ESI — read
# the finalized slip's own PTAX line when present, instead of recomputing.
#
# This script seeds a FINALIZED slip with a PTAX line of 200 (as if it was
# finalized under an older, lower slab), then reconfigures ptax_slabs to a
# HIGHER rate (500) — simulating the tenant editing PT config afterward —
# and asserts the real POST /contributions/compute endpoint still reports
# the slip's original 200, not the new slab's 500.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/ptax-filing-slip-reconciliation-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-06"
FY="2026-27"
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
SITE_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
HR_EMAIL="ptax-recon-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM ptax_contributions WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM ptax_slabs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_slips WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM sites WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
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

echo "=== 0. Fixtures: tenant, Karnataka site, employee, FINALIZED slip with PTAX=200 ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'PTax Recon Test', 'ptax-recon-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO sites (id, tenant_id, name, state_code, status)
VALUES ('$SITE_ID', '$TENANT_ID', 'HQ', 'KA', 'active');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, site_id)
VALUES ('$EMP_ID', '$TENANT_ID', 'PTX-1', 'Ptax', 'Employee', 'ptax-recon-emp@example.test', '2020-01-01', 'active', '$SITE_ID');

INSERT INTO payroll_runs (id, tenant_id, month, status)
VALUES ('$RUN_ID', '$TENANT_ID', '$MONTH', 'finalized');

-- Finalized slip computed (hypothetically) under an OLDER, LOWER PT slab —
-- PTAX=200 is the amount actually deducted and reflected in net_pay.
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, component_breakdown, status)
VALUES ('$TENANT_ID', '$RUN_ID', '$EMP_ID', '$MONTH', 30000.00,
  '[{\"code\":\"BASIC\",\"name\":\"Basic\",\"component_type\":\"earning\",\"monthly_amount\":15000},
    {\"code\":\"PTAX\",\"name\":\"Professional Tax\",\"component_type\":\"deduction\",\"monthly_amount\":200}]'::jsonb,
  'finalized');

-- Tenant's CURRENT PT slab (as if edited AFTER the above slip was finalized)
-- — any gross in this band now resolves to 500, not the slip's 200.
INSERT INTO ptax_slabs (tenant_id, state_code, financial_year, gender, monthly_income_from, monthly_income_to, monthly_ptax, frequency)
VALUES ('$TENANT_ID', 'KA', '$FY', 'all', 0, NULL, 500, 'monthly');
"
echo "fixtures created under tenant $TENANT_ID"

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"Ptax-Recon-$(date +%s)!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', 'Ptax Recon Hr', true, '$HR_EMAIL');
"

echo
echo "=== 1. Sanity: the slip itself really does show PTAX=200 (the actual deduction/deposit) ==="
SLIP_PTAX=$(psqlc -c "SELECT (c->>'monthly_amount') FROM payroll_slips, jsonb_array_elements(component_breakdown) c WHERE tenant_id = '$TENANT_ID' AND c->>'code' = 'PTAX';")
assert_eq "finalized slip's PTAX line is 200 (what was actually deducted from this employee)" "$SLIP_PTAX" "200"

echo
echo "=== 2. THE FIX: real POST /contributions/compute must file the SLIP's 200, not the edited slab's 500 ==="
COMPUTE_RESP=$(curl -sS -X POST "$API_URL/payroll/statutory/ptax/contributions/compute" \
  -H "authorization: Bearer $HR_TOKEN" -H 'content-type: application/json' \
  -d "{\"month\":\"$MONTH\",\"financial_year\":\"$FY\"}")
echo "  compute response: $COMPUTE_RESP"

FILED_AMOUNT=$(psqlc -c "SELECT ptax_amount FROM ptax_contributions WHERE tenant_id = '$TENANT_ID' AND employee_id = '$EMP_ID' AND contribution_month = '$MONTH';")
assert_eq "ptax_contributions (what gets FILED/deposited) = 200, matching the slip — NOT 500, what the edited slab alone would say" "$FILED_AMOUNT" "200"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
[ "$FAIL_COUNT" -eq 0 ]
