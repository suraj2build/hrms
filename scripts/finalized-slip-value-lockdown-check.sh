#!/usr/bin/env bash
# Real-database proof for migration 438 (payroll_slip_finalized_value_lockdown).
#
# Context: fetchAllRowsByKeyset() prevents a multi-page read from skipping or
# duplicating ROWS under concurrent insert/delete, but it is NOT a snapshot —
# if a row already read on an earlier page gets a financial column changed
# by a concurrent UPDATE before a later page is read, the total mixes pre-
# and post-update values. For the specific reads this round migrated to
# keyset (ESI/EPF/PTax wage base, TDS actual-TDS, statutory-recon payable
# queries), all of which filter payroll_slips to status = 'finalized', this
# migration makes that filtered set genuinely immutable at the DB level —
# closing the value-mutation gap keyset pagination itself does not close.
#
# This script proves three things against REAL Postgres, not a mock:
#   1. UPDATE of a financial column on an already-finalized slip is REJECTED.
#   2. The legitimate status-only transition (draft -> finalized) still works.
#   3. The legitimate rollback path (run -> draft, then DELETE slips) still
#      works — i.e. this migration does not regress 263's break-glass model.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   ./scripts/finalized-slip-value-lockdown-check.sh

set -uo pipefail

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
EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
SLIP_ID=$(psqlc -c "SELECT gen_random_uuid();")

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE id = '$RUN_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_slips WHERE id = '$SLIP_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE id = '$RUN_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE id = '$EMP_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
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

echo "=== 0. Fixtures ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'Lockdown Test', 'lockdown-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$EMP_ID', '$TENANT_ID', 'LOCK-1', 'Lockdown', 'Employee', 'lockdown-emp@example.test', '2025-01-01', 'active');

INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count)
VALUES ('$RUN_ID', '$TENANT_ID', '2026-11', 'draft', 1);

INSERT INTO payroll_slips (id, tenant_id, run_id, employee_id, month, status, gross_pay, net_pay, total_deductions, component_breakdown)
VALUES ('$SLIP_ID', '$TENANT_ID', '$RUN_ID', '$EMP_ID', '2026-11', 'draft', 50000.00, 45000.00, 5000.00, '[]'::jsonb);
"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. Legitimate: finalize the slip (status-only transition, draft -> finalized) ==="
FINALIZE_ERR=$(psqlc -c "UPDATE payroll_slips SET status = 'finalized' WHERE id = '$SLIP_ID';" 2>&1)
STATUS_AFTER=$(psqlc -c "SELECT status FROM payroll_slips WHERE id = '$SLIP_ID';")
assert_eq "slip finalized without error" "$STATUS_AFTER" "finalized"

echo
echo "=== 2. BLOCKED: direct UPDATE of a financial column on a finalized slip ==="
BAD_UPDATE_ERR=$(psqlc -c "UPDATE payroll_slips SET gross_pay = 999999.00 WHERE id = '$SLIP_ID';" 2>&1)
GROSS_AFTER_ATTEMPT=$(psqlc -c "SELECT gross_pay FROM payroll_slips WHERE id = '$SLIP_ID';")
if echo "$BAD_UPDATE_ERR" | grep -q "PAYROLL_FINALIZED"; then
  echo "  ✓ UPDATE correctly rejected: $(echo "$BAD_UPDATE_ERR" | grep PAYROLL_FINALIZED)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  ✗ UPDATE was NOT rejected (expected PAYROLL_FINALIZED exception): $BAD_UPDATE_ERR"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
assert_eq "gross_pay unchanged after the blocked UPDATE (value-mutation gap closed)" "$GROSS_AFTER_ATTEMPT" "50000.00"

echo
echo "=== 3. BLOCKED: UPDATE of component_breakdown (jsonb) on a finalized slip ==="
BAD_JSON_ERR=$(psqlc -c "UPDATE payroll_slips SET component_breakdown = '[{\"code\":\"HACK\"}]'::jsonb WHERE id = '$SLIP_ID';" 2>&1)
if echo "$BAD_JSON_ERR" | grep -q "PAYROLL_FINALIZED"; then
  echo "  ✓ jsonb UPDATE correctly rejected"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  ✗ jsonb UPDATE was NOT rejected: $BAD_JSON_ERR"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo
echo "=== 4. Legitimate: rollback path (run -> draft, then DELETE slip) still works ==="
psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE id = '$RUN_ID';"
ROLLBACK_DELETE_ERR=$(psqlc -c "DELETE FROM payroll_slips WHERE id = '$SLIP_ID';" 2>&1)
SLIP_LEFT=$(psqlc -c "SELECT count(*) FROM payroll_slips WHERE id = '$SLIP_ID';")
assert_eq "finalized-looking slip deletable after its run rolls back to draft (break-glass path intact)" "$SLIP_LEFT" "0"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
