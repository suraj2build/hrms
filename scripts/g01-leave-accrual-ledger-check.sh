#!/usr/bin/env bash
# Real-database proof for migration 440 (leave_accrual_ledger_policy_rule_id),
# closing audit finding G01: "Leave accrual can report success while
# crediting nobody."
#
# monthlyAccrualJob() (leave-jobs.ts) has no manual HTTP trigger route — it
# is only reachable via the internal leave-scheduler tick or the durable-
# queue job handler. To drive the REAL production function against the
# REAL stack (not a mock), this script seeds fixtures via SQL, then invokes
# monthlyAccrualJob() directly through a one-shot tsx script using the same
# @supabase/supabase-js client construction as apps/api/src/plugins/supabase.ts,
# against the same real Postgres + gateway everything else in this suite uses.
#
# Mutation-tested: run once against the pre-440 schema state (column
# dropped) to confirm RED (employees_processed: 0, ledger write error),
# then against the real current state to confirm GREEN.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   ./scripts/g01-leave-accrual-ledger-check.sh [--simulate-missing-column]

set -uo pipefail

SIMULATE_MISSING="${1:-}"
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
EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
LEAVE_TYPE_ID=$(psqlc -c "SELECT gen_random_uuid();")
YEAR=2026
MONTH=11

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  if [ "$SIMULATE_MISSING" = "--simulate-missing-column" ]; then
    psqlc -c "ALTER TABLE leave_accrual_ledger ADD COLUMN IF NOT EXISTS policy_rule_id UUID REFERENCES leave_policy_rules(id) ON DELETE SET NULL;" > /dev/null 2>&1 || true
  fi
  psqlc -c "DELETE FROM leave_accrual_ledger WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_leave_balance WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_job_log WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_policies WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_types WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
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

if [ "$SIMULATE_MISSING" = "--simulate-missing-column" ]; then
  echo "=== MUTATION MODE: temporarily dropping policy_rule_id to reproduce the pre-440 bug ==="
  psqlc -c "ALTER TABLE leave_accrual_ledger DROP COLUMN IF EXISTS policy_rule_id;"
fi

echo "=== 0. Fixtures: tenant, employee (joined 2020, long eligible), monthly leave_policy ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G01 Accrual Test', 'g01-accrual-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$EMP_ID', '$TENANT_ID', 'G01-1', 'Accrual', 'Employee', 'g01-accrual-emp@example.test', '2020-01-01', 'active');

INSERT INTO leave_types (id, tenant_id, name, is_paid)
VALUES ('$LEAVE_TYPE_ID', '$TENANT_ID', 'Earned Leave', true);

INSERT INTO leave_policies (tenant_id, leave_type_id, accrual_type, accrual_days_per_year, eligibility_days, prorate_on_joining)
VALUES ('$TENANT_ID', '$LEAVE_TYPE_ID', 'monthly', 24, 0, false);
"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. Invoke the REAL monthlyAccrualJob() against the real stack (not a mock) ==="
cd "$(dirname "$0")/../apps/api"
RUNNER_SCRIPT="./.g01-runner-tmp.mts"
cat > "$RUNNER_SCRIPT" <<EOF
import { monthlyAccrualJob } from './src/lib/leave-jobs.js'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const result = await monthlyAccrualJob(supabase, '$TENANT_ID', $YEAR, $MONTH, 'g01-check-script')
console.log(JSON.stringify(result))
EOF
RESULT_JSON=$(npx tsx --env-file=.env "$RUNNER_SCRIPT" 2>/tmp/g01-check-stderr.log)
rm -f "$RUNNER_SCRIPT"
echo "  job result: $RESULT_JSON"
if [ -s /tmp/g01-check-stderr.log ]; then
  echo "  (stderr, informational — the job itself catches and reports errors in its result rather than throwing):"
  sed 's/^/    /' /tmp/g01-check-stderr.log | head -5
fi

EMPLOYEES_PROCESSED=$(echo "$RESULT_JSON" | jq -r '.employees_processed')
TOTAL_DAYS_CREDITED=$(echo "$RESULT_JSON" | jq -r '.total_days_credited')

if [ "$SIMULATE_MISSING" = "--simulate-missing-column" ]; then
  echo
  echo "=== 2. MUTATION-MODE assertions: expect the pre-440 bug (0 processed despite a real eligible employee) ==="
  assert_eq "employees_processed is silently 0 (the bug)" "$EMPLOYEES_PROCESSED" "0"
  assert_eq "total_days_credited is silently 0 (the bug)" "$TOTAL_DAYS_CREDITED" "0"
  LEDGER_ROWS=$(psqlc -c "SELECT count(*) FROM leave_accrual_ledger WHERE tenant_id = '$TENANT_ID';")
  assert_eq "zero leave_accrual_ledger rows written (nobody credited)" "$LEDGER_ROWS" "0"
else
  echo
  echo "=== 2. GREEN assertions: the employee is actually credited ==="
  assert_eq "employees_processed = 1 (the real eligible employee)" "$EMPLOYEES_PROCESSED" "1"
  assert_eq "total_days_credited = 2 (24 days/year / 12 months)" "$TOTAL_DAYS_CREDITED" "2"

  LEDGER_ROW=$(psqlc -c "SELECT days FROM leave_accrual_ledger WHERE tenant_id = '$TENANT_ID' AND employee_id = '$EMP_ID';")
  assert_eq "leave_accrual_ledger has exactly one row crediting 2 days" "$LEDGER_ROW" "2.0"

  BALANCE_ROW=$(psqlc -c "SELECT balance FROM employee_leave_balance WHERE tenant_id = '$TENANT_ID' AND employee_id = '$EMP_ID' AND leave_type_id = '$LEAVE_TYPE_ID';")
  assert_eq "employee_leave_balance reflects the credited 2 days" "$BALANCE_ROW" "2.0"
fi

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
