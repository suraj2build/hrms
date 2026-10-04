#!/usr/bin/env bash
# Real-endpoint reproduction for audit finding G02: "An impossible LOP count
# can reduce an employee's pay to zero and still produce a finalizable
# slip; payroll warns but does not block."
#
# Traced the ACTUAL calculation path (not the dead buildPayrollSlipPreview()
# code the audit cited): fetchAttendanceSummary() in payroll-engine.ts sums
# max(0, 1 - day_fraction) over EVERY attendance_daily row in the month,
# including weekends/holidays, with no filter excluding non-working days —
# so an employee whose attendance was (wrongly) marked absent on every
# calendar day, weekends included, gets lop_days = calendar days in the
# month, which can exceed total_working_days (which DOES exclude weekends).
#
# This script:
#   1. Reproduces the condition through the REAL POST /payroll/runs endpoint
#      (not a unit test) — seeds "absent" attendance_daily for EVERY
#      calendar day of the month, including weekends.
#   2. Reconciles the persisted slip's deductions/net_pay: confirms
#      computePayrollSlip's existing safety net (finalizeDeductionsAndNet)
#      correctly caps total_deductions at gross_pay and floors net_pay at 0
#      — NOT corrupted, NOT negative, NOT NaN.
#   3. Confirms the NEW fix: a non-blocking LOP_EXCESSIVE payroll_run_blocker
#      is now created for this employee (previously nothing — the only
#      check for this condition was dead code with zero callers), without
#      excluding them from the run or blocking retry/finalize eligibility.
#
# Two MORE real bugs found and fixed while building this real-endpoint
# reproduction (not assumed — each confirmed by running into it, then
# re-confirmed fixed):
#   a. statutory-payroll.ts's grossWages/pfWages (the wage base fed into
#      EPF/ESI/PTax/LWF) were computed as `gross_pay - lop_amount` with NO
#      floor at 0. Once lop_amount can exceed gross_pay (this exact G02
#      scenario), that wage base goes NEGATIVE, producing a genuinely
#      negative employer_contributions (-354 observed on this fixture) —
#      the slip then failed validatePayrollSlipPayload and the run silently
#      failed, which is a much more visible failure than the audit's
#      original "net_pay silently to 0" framing, but still wrong. Fixed
#      with Math.max(0, ...) at both wage-base computations.
#   b. payroll-blocker-engine.ts's LOP_EXCESSIVE classification pattern
#      (/lop_days.*exceed/i) required a literal underscore and never
#      matched the actual human-readable warning text ("LOP days (X)
#      exceed...") — this rule had apparently never been exercised by a
#      real caller before. Without the fix, the new blocker above was
#      misclassified as PAYROLL_NAN (critical, BLOCKING) instead of
#      LOP_EXCESSIVE (warning, non-blocking) — the opposite of the
#      intended "warn but don't block" behavior.
#
# Also: /tmp/supabase-gateway.mjs (this sandbox's local PostgREST stand-in,
# not part of the product) had its own bug in RPC handling that blocked
# this real-endpoint test from running at all — it returned a scalar-
# returning function's result wrapped as [{fnName: value}] instead of
# unwrapping it the way real PostgREST does, so get_active_employees_for_
# payroll's result came back with every employee's `id` undefined. Fixed
# in the gateway only (not committed — it's test infrastructure); flagged
# here because it reveals POST /payroll/runs — the main per-employee
# payroll engine — had never actually been exercised end to end through
# the real API by any script in this engagement before this one; every
# earlier script drove the statutory sub-endpoints or inserted slips
# directly via SQL.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/g02-lop-exceeds-working-days-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-09"   # 30 calendar days, includes weekends
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
EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
COMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
BASIC_COMPONENT_ID=$(psqlc -c "SELECT gen_random_uuid();")
HR_EMAIL="g02-lop-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_run_blockers WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_slips WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_compensation_components WHERE compensation_id = '$COMP_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_compensations WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM salary_components WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM attendance_daily WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
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

echo "=== 0. Fixtures: tenant, employee, compensation (gross_pay=30000), hr_admin ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G02 LOP Test', 'g02-lop-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$EMP_ID', '$TENANT_ID', 'G02-1', 'LOP', 'Employee', 'g02-lop-emp@example.test', '2024-01-01', 'active');

INSERT INTO salary_components (id, tenant_id, name, code, component_type, is_basic)
VALUES ('$BASIC_COMPONENT_ID', '$TENANT_ID', 'Basic', 'BASIC', 'earning', true);

INSERT INTO employee_compensations (id, tenant_id, employee_id, effective_from, is_active, ctc_annual)
VALUES ('$COMP_ID', '$TENANT_ID', '$EMP_ID', '2024-01-01', true, 360000.00);

INSERT INTO employee_compensation_components (tenant_id, compensation_id, salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence)
VALUES ('$TENANT_ID', '$COMP_ID', '$BASIC_COMPONENT_ID', 'fixed', 30000.00, 30000.00, 360000.00, 1);

-- Mark EVERY calendar day of $MONTH (weekends included) as absent —
-- reproduces the real root cause: fetchAttendanceSummary() sums LOP over
-- every row with no working-day filter.
INSERT INTO attendance_daily (tenant_id, employee_id, date, status, day_fraction, is_payable)
SELECT '$TENANT_ID', '$EMP_ID', d::date, 'absent', 0, false
FROM generate_series('${MONTH}-01'::date, (date_trunc('month', '${MONTH}-01'::date) + interval '1 month' - interval '1 day')::date, interval '1 day') AS d;
"
SEEDED_DAYS=$(psqlc -c "SELECT count(*) FROM attendance_daily WHERE tenant_id = '$TENANT_ID';")
echo "fixtures created under tenant $TENANT_ID — seeded $SEEDED_DAYS absent days for $MONTH"

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"G02-Lop-$(date +%s)!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', 'G02 Lop Hr', true, '$HR_EMAIL');
"

echo
echo "=== 1. Run payroll for $MONTH through the REAL POST /payroll/runs endpoint ==="
RUN_RESP=$(curl -sS -X POST "$API_URL/payroll/runs" \
  -H "authorization: Bearer $HR_TOKEN" -H 'content-type: application/json' \
  -d "{\"month\":\"$MONTH\"}")
echo "  run response: $RUN_RESP"
RUN_ID=$(echo "$RUN_RESP" | jq -r '.run_id // .data.run_id // empty')
if [ -z "$RUN_ID" ]; then
  echo "✗ could not extract run_id from response: $RUN_RESP" >&2
  exit 1
fi

# POST /payroll/runs queues an async durable-queue job (202 Accepted) —
# poll until it leaves 'processing'.
echo "  polling payroll_runs.status until the async job completes..."
for i in $(seq 1 30); do
  RUN_STATUS=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN_ID';")
  case "$RUN_STATUS" in
    queued|processing) sleep 1 ;;
    *) break ;;
  esac
done
echo "  final run status: $RUN_STATUS"

echo
echo "=== 2. Reproduced via the real endpoint: lop_days really does exceed total_working_days ==="
SLIP_ROW=$(psqlc -c "SELECT lop_days || '|' || total_working_days || '|' || gross_pay || '|' || total_deductions || '|' || net_pay || '|' || employer_contributions || '|' || coalesce(warning,'') FROM payroll_slips WHERE tenant_id = '$TENANT_ID' AND employee_id = '$EMP_ID';")
LOP_DAYS=$(echo "$SLIP_ROW" | cut -d'|' -f1)
TOTAL_WD=$(echo "$SLIP_ROW" | cut -d'|' -f2)
GROSS_PAY=$(echo "$SLIP_ROW" | cut -d'|' -f3)
TOTAL_DEDUCTIONS=$(echo "$SLIP_ROW" | cut -d'|' -f4)
NET_PAY=$(echo "$SLIP_ROW" | cut -d'|' -f5)
EMPLOYER_CONTRIB=$(echo "$SLIP_ROW" | cut -d'|' -f6)
WARNING=$(echo "$SLIP_ROW" | cut -d'|' -f7-)
echo "  persisted slip: lop_days=$LOP_DAYS total_working_days=$TOTAL_WD gross_pay=$GROSS_PAY total_deductions=$TOTAL_DEDUCTIONS net_pay=$NET_PAY employer_contributions=$EMPLOYER_CONTRIB"
echo "  warning: $WARNING"
LOP_EXCEEDS=$(python3 -c "print('true' if float('$LOP_DAYS') > float('$TOTAL_WD') else 'false')")
assert_true "lop_days ($LOP_DAYS) > total_working_days ($TOTAL_WD) — the impossible state, reproduced via the real endpoint" "$LOP_EXCEEDS"

echo
echo "=== 3. Reconcile persisted deductions and net pay: capped/floored correctly, not corrupted ==="
assert_eq "total_deductions is capped at gross_pay (not an uncapped, larger number)" "$TOTAL_DEDUCTIONS" "$GROSS_PAY"
assert_eq "net_pay is floored at 0 (not negative)" "$NET_PAY" "0.00"
NET_IS_NUMBER=$(python3 -c "print('true' if '$NET_PAY'.replace('.','',1).isdigit() else 'false')")
assert_true "net_pay is a real finite number, not NaN/corrupted" "$NET_IS_NUMBER"
assert_eq "employer_contributions wage base is floored at 0 (not the negative value reproduced pre-fix)" "$EMPLOYER_CONTRIB" "0.00"

echo
echo "=== 4. NEW fix: a non-blocking LOP_EXCESSIVE blocker is now created and visible ==="
BLOCKER_ROW=$(psqlc -c "SELECT rule_code || '|' || severity || '|' || blocking || '|' || status FROM payroll_run_blockers WHERE tenant_id = '$TENANT_ID' AND employee_id = '$EMP_ID' AND rule_code = 'LOP_EXCESSIVE';")
assert_eq "payroll_run_blockers has a LOP_EXCESSIVE row for this employee" "$(echo "$BLOCKER_ROW" | cut -d'|' -f1)" "LOP_EXCESSIVE"
assert_eq "blocker is non-blocking (blocking=false, matches the existing rule definition)" "$(echo "$BLOCKER_ROW" | cut -d'|' -f3)" "false"
assert_eq "blocker status is open (visible for HR to act on)" "$(echo "$BLOCKER_ROW" | cut -d'|' -f4)" "open"

echo
echo "=== 5. The employee still HAS a slip despite the blocker — not silently excluded from the run ==="
SLIP_EXISTS=$(psqlc -c "SELECT count(*) FROM payroll_slips WHERE tenant_id = '$TENANT_ID' AND employee_id = '$EMP_ID';")
assert_eq "a slip was created for this employee (warn, not exclude)" "$SLIP_EXISTS" "1"

echo
echo "=== 6. The open LOP_EXCESSIVE blocker is non-blocking: run still reaches a finalize-eligible state ==="
# blocking=false rules must not stop finalize — HR is warned, not locked out.
# The real gate finalize applies (runs.ts's "Open-blockers gate", ~line 2325)
# rejects with 422 OPEN_BLOCKERS ONLY when a row matches
# status='open' AND blocking=true for this run_id. We query that exact
# predicate directly rather than driving the HTTP /finalize endpoint, which
# would also hit unrelated gates (attendance-period-lock 423, dual-control
# maker/checker 403) that have nothing to do with G02 and would make a
# pass/fail here about those gates instead of about the LOP_EXCESSIVE
# blocker's blocking=false classification.
RUN_STATUS_FINAL=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN_ID';")
assert_true "payroll run reached a terminal, non-failed status ('$RUN_STATUS_FINAL')" "$(python3 -c "print('true' if '$RUN_STATUS_FINAL' not in ('queued','processing','failed') else 'false')")"
OPEN_BLOCKING_COUNT=$(psqlc -c "SELECT count(*) FROM payroll_run_blockers WHERE tenant_id = '$TENANT_ID' AND run_id = '$RUN_ID' AND status = 'open' AND blocking = true;")
assert_eq "no OPEN blocking=true blockers remain for this run — finalize's Open-blockers gate would NOT reject it (LOP_EXCESSIVE is warning-only)" "$OPEN_BLOCKING_COUNT" "0"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
