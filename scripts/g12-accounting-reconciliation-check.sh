#!/usr/bin/env bash
# G12 real-endpoint accounting reconciliation check.
#
# Drives the REAL Fastify API (not mocked) against a REAL Postgres through
# the PostgREST-compatible gateway, exercising the FULL standalone
# leave-encashment chain end to end: request -> approve -> assign to a
# payroll run -> real payroll computation (POST /payroll/runs) -> finalize
# (builds the immutable snapshot + flips the request to 'paid') -> GL
# ledger build -> post -> accounting summary/gl-summary -> export -> ledger
# reversal -> payroll-run rollback -> encashment request reversal (leave
# balance credited back). Every assertion re-reads the PERSISTED row
# directly from Postgres, not just trusting the API response.
#
# This is the "supplement the eight unit tests with persisted
# reconciliation from request -> payroll recomputation -> finalized slip
# -> GL -> export -> reversal" evidence: payroll-engine.test.ts and
# payroll-accounting-engine.test.ts prove the PURE functions
# (applyEncashmentPayout, computeLopAmount, generateLedgerEntries) in
# isolation; this script proves the real DB-backed pipeline that calls
# them produces the same result when driven exactly the way a real HR
# admin would, through the real HTTP routes, against a real Postgres.
#
# KNOWN LIMITATION: the gateway (/tmp/supabase-gateway.mjs) is a
# from-scratch reimplementation of PostgREST's wire behavior, not real
# Supabase/PostgREST — same standing disclosure as every other real-stack
# check in this repo (g13-reconciliation-check.sh, pagination-scale-check.sh,
# g02-lop-exceeds-working-days-check.sh).
#
# Requirements: psql, curl, jq, python3. Needs a running Postgres
# (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE), the gateway (GATEWAY_URL),
# and the real API (API_URL) — started with PAYROLL_FINALIZE_DUAL_CONTROL=false
# so finalize doesn't need a second maker-checker identity (that control is
# proven separately elsewhere; this script's purpose is G12 accounting).
#
# Usage:
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/g12-accounting-reconciliation-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH1="2026-07"   # baseline month — establishes a "normal" gross_pay to compute the encashment rate from
MONTH2="2026-08"   # encashment month — the one under test
MONTH3="2026-09"   # rollback-guard check: posted GL ledger must block rollback
MONTH4="2026-06"   # rollback-guard check: filed statutory closure must block rollback; unposted ledger must be cleaned up
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
EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
COMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
BASIC_COMPONENT_ID=$(psqlc -c "SELECT gen_random_uuid();")
LEAVE_TYPE_ID=$(psqlc -c "SELECT gen_random_uuid();")
TS=$(date +%s)
HR_EMAIL="g12-recon-$TS@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM statutory_filing_closures WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_ledger_entries WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_cost_allocations WHERE ledger_id IN (SELECT id FROM payroll_financial_ledgers WHERE tenant_id='$TENANT_ID');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_financial_ledgers WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_balance_ledger WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_accrual_ledger WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_encashment_requests WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_leave_balance WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_accrual_rules WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_types WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM maker_checker_log WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_validation_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM attendance_period_locks WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_run_blockers WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_employee_snapshots WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_run_snapshots WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_slips WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_compensation_components WHERE compensation_id = '$COMP_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_compensations WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM salary_components WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$HR_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$HR_EMAIL';" > /dev/null 2>&1 || true

  local tenant_del_err left profiles_left emp_left
  tenant_del_err=$(psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" 2>&1 1>/dev/null)
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  if [ "$left" = "0" ]; then
    echo "tenant $TENANT_ID confirmed removed."
    exit "$exit_code"
  fi
  profiles_left=$(psqlc -c "SELECT count(*) FROM profiles WHERE tenant_id = '$TENANT_ID';")
  emp_left=$(psqlc -c "SELECT count(*) FROM employees WHERE tenant_id = '$TENANT_ID';")
  if echo "$tenant_del_err" | grep -q "append-only" && [ "$profiles_left" = "0" ] && [ "$emp_left" = "0" ]; then
    echo "⚠ CLEANUP INCOMPLETE (not a defect): only the tenant stub + its immutable platform_events audit row remain (trg_platform_events_no_delete, same as G02/G13's documented behavior). Every functional table is confirmed empty."
    exit "$exit_code"
  fi
  echo "  ✗ cleanup FAILED: tenant_left=$left (profiles=$profiles_left employees=$emp_left) — $tenant_del_err" >&2
  exit 1
}
[ -z "${SKIP_CLEANUP:-}" ] && trap cleanup EXIT

echo "=== 0. Fixtures: tenant, employee, compensation (basic=50000/mo), encashable Earned Leave (balance=10), HR admin ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G12 Recon Test', 'g12-recon-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$EMP_ID', '$TENANT_ID', 'G12-1', 'Recon', 'Employee', 'g12-recon-emp@example.test', '2024-01-01', 'active');

INSERT INTO salary_components (id, tenant_id, name, code, component_type, is_basic)
VALUES ('$BASIC_COMPONENT_ID', '$TENANT_ID', 'Basic', 'BASIC', 'earning', true);

INSERT INTO employee_compensations (id, tenant_id, employee_id, effective_from, is_active, ctc_annual)
VALUES ('$COMP_ID', '$TENANT_ID', '$EMP_ID', '2024-01-01', true, 600000.00);

INSERT INTO employee_compensation_components (tenant_id, compensation_id, salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence)
VALUES ('$TENANT_ID', '$COMP_ID', '$BASIC_COMPONENT_ID', 'fixed', 50000.00, 50000.00, 600000.00, 1);

INSERT INTO leave_types (id, tenant_id, name, is_paid)
VALUES ('$LEAVE_TYPE_ID', '$TENANT_ID', 'Earned Leave', true);

INSERT INTO leave_accrual_rules (tenant_id, leave_type_id, encashable, max_encashable_per_year)
VALUES ('$TENANT_ID', '$LEAVE_TYPE_ID', true, 30);

INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance)
VALUES ('$TENANT_ID', '$EMP_ID', '$LEAVE_TYPE_ID', EXTRACT(YEAR FROM now())::int, 10);

INSERT INTO attendance_period_locks (tenant_id, period_month, state, locked_at)
VALUES ('$TENANT_ID', '$MONTH1', 'LOCKED', now()),
       ('$TENANT_ID', '$MONTH2', 'LOCKED', now()),
       ('$TENANT_ID', '$MONTH3', 'LOCKED', now()),
       ('$TENANT_ID', '$MONTH4', 'LOCKED', now());
"
echo "fixtures created under tenant $TENANT_ID"

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"G12-Recon-$TS!\"}")
TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
# super_admin (so force_finalize works without a separate checker identity —
# dual control is disabled for this run via PAYROLL_FINALIZE_DUAL_CONTROL=false,
# but force_finalize's own role gate still checks req.userRole), employee_id
# linked to EMP_ID so this same identity can submit the standalone request as
# "itself" (an HR admin who is also an employee is realistic, and the approve
# route doesn't check approver != requester).
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email, employee_id)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'super_admin', 'G12 Recon Hr', true, '$HR_EMAIL', '$EMP_ID');
"

echo
echo "=== 1. Baseline month ($MONTH1): run + finalize payroll with NO encashment, establishing a normal gross_pay ==="
RUN1_RESP=$(http POST "$API_URL/payroll/runs" "{\"month\":\"$MONTH1\"}") || exit 1
RUN1_ID=$(echo "$RUN1_RESP" | jq -r '.run_id // .data.run_id // empty')
if [ -z "$RUN1_ID" ]; then echo "✗ could not extract run_id: $RUN1_RESP" >&2; exit 1; fi
for i in $(seq 1 30); do
  RUN1_STATUS=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN1_ID';")
  case "$RUN1_STATUS" in queued|processing) sleep 1 ;; *) break ;; esac
done
echo "  run1 status: $RUN1_STATUS"
psqlc -c "INSERT INTO payroll_validation_runs (tenant_id, payroll_run_id, validation_month, status, is_payroll_blocked, error_count, completed_at) VALUES ('$TENANT_ID', '$RUN1_ID', '$MONTH1', 'completed', false, 0, now());"

FIN1_RESP=$(http POST "$API_URL/payroll/runs/$RUN1_ID/finalize" '{"force_finalize":true,"override_reason":"G12 accounting reconciliation baseline month"}') || exit 1
echo "  finalize1: $FIN1_RESP"
BASELINE_GROSS=$(psqlc -c "SELECT gross_pay FROM payroll_slips WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_ID' AND run_id='$RUN1_ID';")
assert_eq "baseline month slip gross_pay (no encashment yet)" "$BASELINE_GROSS" "50000.00"

echo
echo "=== 2. Standalone encashment request (10 days), approved — rate derived from the baseline slip ==="
REQ_RESP=$(http POST "$API_URL/leave/encashment/request" "{\"leave_type_id\":\"$LEAVE_TYPE_ID\",\"days\":10}") || exit 1
echo "  request: $REQ_RESP"
REQ_ID=$(psqlc -c "SELECT id FROM leave_encashment_requests WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_ID' AND status='pending' ORDER BY created_at DESC LIMIT 1;")
if [ -z "$REQ_ID" ]; then echo "✗ could not find the created request" >&2; exit 1; fi

APPROVE_RESP=$(http POST "$API_URL/leave/encashment/$REQ_ID/approve" '{}') || exit 1
echo "  approve: $APPROVE_RESP"
REQ_ROW=$(psqlc -c "SELECT status||'|'||rate_per_day||'|'||gross_amount||'|'||tds_amount||'|'||net_amount FROM leave_encashment_requests WHERE id = '$REQ_ID';")
echo "  persisted request after approval: $REQ_ROW"
REQ_STATUS=$(echo "$REQ_ROW" | cut -d'|' -f1)
RATE=$(echo "$REQ_ROW" | cut -d'|' -f2)
GROSS=$(echo "$REQ_ROW" | cut -d'|' -f3)
assert_eq "request status is 'approved'" "$REQ_STATUS" "approved"
assert_eq "rate_per_day = baseline gross_pay (50000) / 26 — the CLEAN basis (no prior encashment to exclude yet)" "$RATE" "1923.08"
assert_eq "gross_amount = 10 days x rate_per_day" "$GROSS" "19230.80"

BAL_AFTER_APPROVE=$(psqlc -c "SELECT balance FROM employee_leave_balance WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_ID' AND leave_type_id='$LEAVE_TYPE_ID';")
assert_eq "leave balance deducted at APPROVAL time (10 -> 0), not later" "$BAL_AFTER_APPROVE" "0"

echo
echo "=== 3. Assign to month 2's draft payroll run ==="
RUN2_RESP=$(http POST "$API_URL/payroll/runs" "{\"month\":\"$MONTH2\"}") || exit 1
RUN2_ID=$(echo "$RUN2_RESP" | jq -r '.run_id // .data.run_id // empty')
if [ -z "$RUN2_ID" ]; then echo "✗ could not extract run2_id: $RUN2_RESP" >&2; exit 1; fi
for i in $(seq 1 30); do
  RUN2_STATUS=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN2_ID';")
  case "$RUN2_STATUS" in queued|processing) sleep 1 ;; *) break ;; esac
done
echo "  run2 status (before assignment): $RUN2_STATUS"

ASSIGN_RESP=$(http POST "$API_URL/leave/encashment/$REQ_ID/assign-payroll-run" "{\"payroll_run_id\":\"$RUN2_ID\"}") || exit 1
echo "  assign: $ASSIGN_RESP"
ASSIGN_ROW=$(psqlc -c "SELECT status||'|'||coalesce(payroll_run_id::text,'') FROM leave_encashment_requests WHERE id='$REQ_ID';")
assert_eq "status stays 'approved' after assignment — not yet paid" "$(echo "$ASSIGN_ROW" | cut -d'|' -f1)" "approved"
assert_eq "payroll_run_id is set to run2" "$(echo "$ASSIGN_ROW" | cut -d'|' -f2)" "$RUN2_ID"

echo
echo "=== 4. Real payroll RECOMPUTATION (re-run month 2) folds the payout into the slip fresh ==="
# Re-running (not just running once) proves regeneration-survival for real,
# not just at the DB-function level already covered by verify-g12-
# encashment-atomic.mjs's [C] section.
RERUN_RESP=$(http POST "$API_URL/payroll/runs" "{\"month\":\"$MONTH2\"}") || exit 1
echo "  re-run response: $RERUN_RESP"
for i in $(seq 1 30); do
  RUN2_STATUS=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN2_ID';")
  case "$RUN2_STATUS" in queued|processing) sleep 1 ;; *) break ;; esac
done
echo "  run2 status (after re-run): $RUN2_STATUS"

SLIP2_ROW=$(psqlc -c "SELECT gross_pay||'|'||total_deductions||'|'||net_pay||'|'||tds_deducted FROM payroll_slips WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_ID' AND run_id='$RUN2_ID';")
echo "  persisted month-2 slip after recomputation: $SLIP2_ROW"
SLIP2_GROSS=$(echo "$SLIP2_ROW" | cut -d'|' -f1)
assert_eq "month-2 gross_pay = baseline (50000) + encashment gross (19230.80)" "$SLIP2_GROSS" "69230.80"

COMPONENT_CHECK=$(psqlc -c "SELECT count(*) FROM payroll_slips, jsonb_array_elements(component_breakdown) AS c WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_ID' AND run_id='$RUN2_ID' AND c->>'code' = 'LEAVE_ENCASHMENT';")
assert_eq "slip's component_breakdown has a LEAVE_ENCASHMENT line (survived the re-run)" "$COMPONENT_CHECK" "1"

echo
echo "=== 5. Finalize month 2 — snapshot built, request flips to 'paid' ==="
psqlc -c "INSERT INTO payroll_validation_runs (tenant_id, payroll_run_id, validation_month, status, is_payroll_blocked, error_count, completed_at) VALUES ('$TENANT_ID', '$RUN2_ID', '$MONTH2', 'completed', false, 0, now());"
FIN2_RESP=$(http POST "$API_URL/payroll/runs/$RUN2_ID/finalize" '{"force_finalize":true,"override_reason":"G12 accounting reconciliation encashment month"}') || exit 1
echo "  finalize2: $FIN2_RESP"

REQ_AFTER_FINALIZE=$(psqlc -c "SELECT status FROM leave_encashment_requests WHERE id = '$REQ_ID';")
assert_eq "request flipped to 'paid' by finalize (fn_finalize_leave_encashments_for_run)" "$REQ_AFTER_FINALIZE" "paid"

SNAPSHOT_ADHOC=$(psqlc -c "
SELECT count(*) FROM payroll_employee_snapshots pes
JOIN payroll_run_snapshots prs ON prs.id = pes.snapshot_id
WHERE prs.run_id = '$RUN2_ID' AND pes.employee_id = '$EMP_ID'
  AND pes.adhoc_components @> '[{\"code\":\"LEAVE_ENCASHMENT\"}]'::jsonb;
")
assert_eq "the immutable snapshot's adhoc_components captured the LEAVE_ENCASHMENT line (migration 449)" "$SNAPSHOT_ADHOC" "1"

echo
echo "=== 6. Build + post the GL ledger — the encashment is NOT silently dropped, NOT misclassified as LOP ==="
LEDGER_RESP=$(http POST "$API_URL/payroll/runs/$RUN2_ID/ledger" '{}') || exit 1
echo "  ledger build: $LEDGER_RESP"
LEDGER_ID=$(echo "$LEDGER_RESP" | jq -r '.data.ledger_id')
if [ -z "$LEDGER_ID" ] || [ "$LEDGER_ID" = "null" ]; then echo "✗ could not extract ledger_id: $LEDGER_RESP" >&2; exit 1; fi

LEDGER_STATUS=$(psqlc -c "SELECT ledger_status FROM payroll_financial_ledgers WHERE id = '$LEDGER_ID';")
assert_eq "ledger balanced (sum debit = sum credit) — migration 449's fix didn't break the double-entry invariant" "$LEDGER_STATUS" "balanced"

ENCASHMENT_EARNING_POSTED=$(psqlc -c "SELECT count(*) FROM payroll_ledger_entries WHERE ledger_id='$LEDGER_ID' AND source_component_code='LEAVE_ENCASHMENT' AND debit_amount > 0;")
assert_true "a Dr Salary Expense (or mapped) entry exists for the LEAVE_ENCASHMENT component — not silently dropped" "$([ "$ENCASHMENT_EARNING_POSTED" -ge 1 ] && echo true || echo false)"

LOP_ENTRIES=$(psqlc -c "SELECT count(*) FROM payroll_ledger_entries WHERE ledger_id='$LEDGER_ID' AND source_component_code='LOP';")
assert_eq "no LOP entry was fabricated for this employee — the encashment's gross/TDS were never misclassified into the LOP bucket" "$LOP_ENTRIES" "0"

GL_SALARY_EXPENSE_DEBIT=$(psqlc -c "SELECT coalesce(sum(debit_amount),0) FROM payroll_ledger_entries WHERE ledger_id='$LEDGER_ID' AND gl_account_code='5000';")
assert_eq "Salary Expense (5000) total debit includes the full 69230.80 (50000 basic + 19230.80 encashment)" "$GL_SALARY_EXPENSE_DEBIT" "69230.80"

POST_RESP=$(http POST "$API_URL/payroll/ledgers/$LEDGER_ID/post" '{}') || exit 1
echo "  posted: $POST_RESP"

echo
echo "=== 7. Accounting summary/gl-summary reflect the encashment ==="
SUMMARY=$(http GET "$API_URL/payroll/accounting/summary") || exit 1
SUMMARY_LIABILITY=$(echo "$SUMMARY" | jq -r '.data.total_payroll_liability')
assert_true "total_payroll_liability includes the encashment-inflated run (>= 69230.80)" "$(python3 -c "print('true' if float('$SUMMARY_LIABILITY') >= 69230.79 else 'false')")"

GLSUM=$(http GET "$API_URL/payroll/accounting/gl-summary") || exit 1
GL_5000=$(echo "$GLSUM" | jq -r '.data[] | select(.code=="5000") | .totalDebit')
assert_true "gl-summary's Salary Expense total debit includes this run's 69230.80" "$(python3 -c "print('true' if float('$GL_5000') >= 69230.79 else 'false')")"

echo
echo "=== 8. Export includes the encashment line ==="
EXPORT_CSV=$(curl -sS "$API_URL/payroll/ledgers/$LEDGER_ID/export?format=csv" -H "authorization: Bearer $TOKEN")
EXPORT_HAS_ENCASHMENT=$(echo "$EXPORT_CSV" | grep -c "LEAVE_ENCASHMENT" || true)
assert_true "the exported general ledger CSV contains a LEAVE_ENCASHMENT line" "$([ "$EXPORT_HAS_ENCASHMENT" -ge 1 ] && echo true || echo false)"

echo
echo "=== 9. Reversal: GL ledger reversal (accounting) ==="
REV_LEDGER_RESP=$(http POST "$API_URL/payroll/ledgers/$LEDGER_ID/reverse" '{"reason":"G12 accounting reconciliation test — reversal proof"}') || exit 1
echo "  ledger reverse: $REV_LEDGER_RESP"
REVERSAL_LEDGER_ID=$(echo "$REV_LEDGER_RESP" | jq -r '.reversal_ledger_id')
REV_ENTRY_SUM=$(psqlc -c "SELECT coalesce(sum(debit_amount),0) - coalesce(sum(credit_amount),0) FROM payroll_ledger_entries WHERE ledger_id = '$REVERSAL_LEDGER_ID';")
echo "  reversal ledger net (should mirror/cancel the original): $REV_ENTRY_SUM"
ORIGINAL_LEDGER_STATUS_AFTER=$(psqlc -c "SELECT ledger_status FROM payroll_financial_ledgers WHERE id = '$LEDGER_ID';")
assert_eq "original ledger's own entries are NOT deleted (never-delete-posted-entries invariant) — still has its rows" "$(psqlc -c "SELECT count(*) FROM payroll_ledger_entries WHERE ledger_id='$LEDGER_ID';" | python3 -c "import sys; print('nonzero' if int(sys.stdin.read().strip()) > 0 else '0')")" "nonzero"

echo
echo "=== 10. Reversal: encashment request itself (leave balance credited back) ==="
ROLLBACK_RESP=$(http POST "$API_URL/payroll/runs/$RUN2_ID/rollback" '{"reason":"G12 accounting reconciliation test — need draft status to reverse the encashment"}') || exit 1
echo "  run rollback: $ROLLBACK_RESP"
REQ_AFTER_ROLLBACK=$(psqlc -c "SELECT status FROM leave_encashment_requests WHERE id = '$REQ_ID';")
assert_eq "rollback reverted the request from 'paid' back to 'approved' (fn_revert_leave_encashments_for_rollback)" "$REQ_AFTER_ROLLBACK" "approved"

REVERSE_REQ_RESP=$(http POST "$API_URL/leave/encashment/$REQ_ID/reverse" '{"reason":"G12 accounting reconciliation test"}') || exit 1
echo "  encashment reverse: $REVERSE_REQ_RESP"
REQ_FINAL=$(psqlc -c "SELECT status||'|'||coalesce(payroll_run_id::text,'') FROM leave_encashment_requests WHERE id = '$REQ_ID';")
assert_eq "request status is 'reversed'" "$(echo "$REQ_FINAL" | cut -d'|' -f1)" "reversed"
assert_eq "payroll_run_id cleared" "$(echo "$REQ_FINAL" | cut -d'|' -f2)" ""

BAL_FINAL=$(psqlc -c "SELECT balance FROM employee_leave_balance WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_ID' AND leave_type_id='$LEAVE_TYPE_ID';")
assert_eq "leave balance credited back (0 -> 10) — the full round trip nets out exactly, no residue" "$BAL_FINAL" "10"

echo
echo "=== 11. Rollback guard: a POSTED GL ledger must block rollback, not be left standing against deleted slips ==="
RUN3_RESP=$(http POST "$API_URL/payroll/runs" "{\"month\":\"$MONTH3\"}") || exit 1
RUN3_ID=$(echo "$RUN3_RESP" | jq -r '.run_id // .data.run_id // empty')
if [ -z "$RUN3_ID" ]; then echo "✗ could not extract run3_id: $RUN3_RESP" >&2; exit 1; fi
for i in $(seq 1 30); do
  RUN3_STATUS=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN3_ID';")
  case "$RUN3_STATUS" in queued|processing) sleep 1 ;; *) break ;; esac
done
echo "  run3 status: $RUN3_STATUS"
psqlc -c "INSERT INTO payroll_validation_runs (tenant_id, payroll_run_id, validation_month, status, is_payroll_blocked, error_count, completed_at) VALUES ('$TENANT_ID', '$RUN3_ID', '$MONTH3', 'completed', false, 0, now());"
FIN3_RESP=$(http POST "$API_URL/payroll/runs/$RUN3_ID/finalize" '{"force_finalize":true,"override_reason":"G12 rollback-guard test month 3"}') || exit 1
echo "  finalize3: $FIN3_RESP"
SNAPSHOT3_ID=$(psqlc -c "SELECT snapshot_id FROM payroll_runs WHERE id='$RUN3_ID';")

LEDGER3_RESP=$(http POST "$API_URL/payroll/runs/$RUN3_ID/ledger" '{}') || exit 1
LEDGER3_ID=$(echo "$LEDGER3_RESP" | jq -r '.data.ledger_id')
http POST "$API_URL/payroll/ledgers/$LEDGER3_ID/post" '{}' > /dev/null || exit 1
LEDGER3_STATUS=$(psqlc -c "SELECT ledger_status FROM payroll_financial_ledgers WHERE id='$LEDGER3_ID';")
assert_eq "precondition: ledger3 is posted" "$LEDGER3_STATUS" "posted"

ROLLBACK3_RAW=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/runs/$RUN3_ID/rollback" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"reason":"should be blocked"}')
ROLLBACK3_CODE=$(echo "$ROLLBACK3_RAW" | tail -1)
ROLLBACK3_BODY=$(echo "$ROLLBACK3_RAW" | sed '$d')
echo "  blocked rollback attempt: HTTP $ROLLBACK3_CODE $ROLLBACK3_BODY"
assert_eq "rollback is BLOCKED with 409 while a posted GL ledger exists for this run" "$ROLLBACK3_CODE" "409"
assert_eq "error code is LEDGER_POSTED" "$(echo "$ROLLBACK3_BODY" | jq -r '.error')" "LEDGER_POSTED"

RUN3_UNCHANGED=$(psqlc -c "SELECT status FROM payroll_runs WHERE id='$RUN3_ID';")
assert_eq "the blocked rollback made no partial changes — run3 is still finalized" "$RUN3_UNCHANGED" "finalized"
SLIPS3_STILL_THERE=$(psqlc -c "SELECT count(*) FROM payroll_slips WHERE run_id='$RUN3_ID';")
assert_eq "slips were NOT deleted by the blocked attempt" "$SLIPS3_STILL_THERE" "1"

REV3_RESP=$(http POST "$API_URL/payroll/ledgers/$LEDGER3_ID/reverse" '{"reason":"clearing the block for the next check"}') || exit 1
echo "  ledger3 reversed: $REV3_RESP"

ROLLBACK3_OK=$(http POST "$API_URL/payroll/runs/$RUN3_ID/rollback" '{"reason":"ledger now reversed, rollback should proceed"}') || exit 1
echo "  rollback3 (after reversing the ledger): $ROLLBACK3_OK"
RUN3_AFTER=$(psqlc -c "SELECT status||'|'||coalesce(snapshot_id::text,'') FROM payroll_runs WHERE id='$RUN3_ID';")
assert_eq "run3 is now draft" "$(echo "$RUN3_AFTER" | cut -d'|' -f1)" "draft"
assert_eq "run3's snapshot_id reference is cleared" "$(echo "$RUN3_AFTER" | cut -d'|' -f2)" ""
SNAPSHOT3_REPLAYABLE=$(psqlc -c "SELECT replayable FROM payroll_run_snapshots WHERE id='$SNAPSHOT3_ID';")
assert_eq "the pre-rollback finalized snapshot is archived (replayable=false), not left dangling as valid" "$SNAPSHOT3_REPLAYABLE" "f"
LEDGER3_UNTOUCHED=$(psqlc -c "SELECT ledger_status FROM payroll_financial_ledgers WHERE id='$LEDGER3_ID';")
assert_eq "the already-reversed ledger itself is untouched by rollback (historical record kept)" "$LEDGER3_UNTOUCHED" "reversed"

echo
echo "=== 12. Rollback guard: a FILED statutory closure must block rollback; an unposted (never-posted) ledger is cleaned up ==="
RUN4_RESP=$(http POST "$API_URL/payroll/runs" "{\"month\":\"$MONTH4\"}") || exit 1
RUN4_ID=$(echo "$RUN4_RESP" | jq -r '.run_id // .data.run_id // empty')
if [ -z "$RUN4_ID" ]; then echo "✗ could not extract run4_id: $RUN4_RESP" >&2; exit 1; fi
for i in $(seq 1 30); do
  RUN4_STATUS=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN4_ID';")
  case "$RUN4_STATUS" in queued|processing) sleep 1 ;; *) break ;; esac
done
psqlc -c "INSERT INTO payroll_validation_runs (tenant_id, payroll_run_id, validation_month, status, is_payroll_blocked, error_count, completed_at) VALUES ('$TENANT_ID', '$RUN4_ID', '$MONTH4', 'completed', false, 0, now());"
FIN4_RESP=$(http POST "$API_URL/payroll/runs/$RUN4_ID/finalize" '{"force_finalize":true,"override_reason":"G12 rollback-guard test month 4"}') || exit 1
echo "  finalize4: $FIN4_RESP"

LEDGER4_RESP=$(http POST "$API_URL/payroll/runs/$RUN4_ID/ledger" '{}') || exit 1
LEDGER4_ID=$(echo "$LEDGER4_RESP" | jq -r '.data.ledger_id')
LEDGER4_STATUS=$(psqlc -c "SELECT ledger_status FROM payroll_financial_ledgers WHERE id='$LEDGER4_ID';")
echo "  precondition: ledger4 built but never posted (status=$LEDGER4_STATUS)"

# Directly seeding the filed closure (not going through the full statutory
# compute/reconcile workflow — that path is proven separately; this section
# tests rollback's OWN guard against whatever statutory_filing_closures
# already holds for the month).
psqlc -c "
INSERT INTO statutory_filing_closures (tenant_id, month, statutory_type, status, run_id, computed_amount, payable_amount, variance)
VALUES ('$TENANT_ID', '$MONTH4', 'tds', 'filed', '$RUN4_ID', 0, 0, 0);
"

ROLLBACK4_RAW=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/runs/$RUN4_ID/rollback" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"reason":"should be blocked"}')
ROLLBACK4_CODE=$(echo "$ROLLBACK4_RAW" | tail -1)
ROLLBACK4_BODY=$(echo "$ROLLBACK4_RAW" | sed '$d')
echo "  blocked rollback attempt: HTTP $ROLLBACK4_CODE $ROLLBACK4_BODY"
assert_eq "rollback is BLOCKED with 409 while a filed statutory closure exists for this month" "$ROLLBACK4_CODE" "409"
assert_eq "error code is STATUTORY_FILING_EXISTS" "$(echo "$ROLLBACK4_BODY" | jq -r '.error')" "STATUTORY_FILING_EXISTS"

REOPEN4_RESP=$(http POST "$API_URL/payroll/statutory-reconciliation/reopen" "{\"month\":\"$MONTH4\",\"statutes\":[\"tds\"],\"reason\":\"clearing the block for the next check\"}") || exit 1
echo "  statutory reopen: $REOPEN4_RESP"

ROLLBACK4_OK=$(http POST "$API_URL/payroll/runs/$RUN4_ID/rollback" '{"reason":"filing reopened, rollback should proceed"}') || exit 1
echo "  rollback4 (after reopening the filing): $ROLLBACK4_OK"
RUN4_AFTER=$(psqlc -c "SELECT status FROM payroll_runs WHERE id='$RUN4_ID';")
assert_eq "run4 is now draft" "$RUN4_AFTER" "draft"
LEDGER4_GONE=$(psqlc -c "SELECT count(*) FROM payroll_financial_ledgers WHERE id='$LEDGER4_ID';")
assert_eq "the never-posted ledger was cleaned up by rollback (not left orphaned, counting toward the liability dashboard for a run no longer in that state)" "$LEDGER4_GONE" "0"
LEDGER4_ENTRIES_GONE=$(psqlc -c "SELECT count(*) FROM payroll_ledger_entries WHERE ledger_id='$LEDGER4_ID';")
assert_eq "its entries were cleaned up too" "$LEDGER4_ENTRIES_GONE" "0"

echo
echo "=== RESULTS: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then exit 1; fi
