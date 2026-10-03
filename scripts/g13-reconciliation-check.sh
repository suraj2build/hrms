#!/usr/bin/env bash
# G13 real-database reconciliation check.
#
# Drives the REAL Fastify API (not a mocked Supabase client) against a REAL
# Postgres, through a PostgREST-compatible gateway that serves NUMERIC/
# DECIMAL columns as JSON strings exactly as real PostgREST/Supabase do, for
# the three route areas flagged in the G13 closure review: ESI eligibility +
# contribution amounts, payroll accounting (summary + gl-summary), and the
# filing-pack challan (EPF/ESI/PTax/TDS).
#
# This script creates its own throwaway tenant + employees + fixtures,
# asserts every number the API returns against a hand-computed expectation,
# re-reads the persisted rows directly from Postgres (not just the API
# response) to confirm the write actually landed, and deletes everything it
# created on exit — success or failure (see the `cleanup` trap below).
#
# KNOWN LIMITATION: the gateway (/tmp/supabase-gateway.mjs in dev sessions,
# or whatever REST_URL points at) is a from-scratch reimplementation of
# PostgREST's NUMERIC-as-string wire behavior, not real Supabase/PostgREST.
# This proves the fix against that behavior faithfully reproduced; it does
# not substitute for a run against a real Supabase/PostgREST project.
#
# Requirements: psql, curl, jq, python3 on PATH. Needs a running Postgres
# (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — standard libpq env vars),
# a running instance of the REST gateway (GATEWAY_URL) and a running
# instance of the real API on this branch (API_URL).
#
# Usage:
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/g13-reconciliation-check.sh
#
# Exit code 0 only if every assertion below passed.

set -euo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-12"
MONTH_PREV="2026-11"   # payroll_runs/payroll_financial_ledgers both enforce one row per (tenant_id, month)/(tenant_id, run_id, ledger_type) — the second ledger needs its own month+run, same as two real payroll cycles
PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }

# ── numeric/string assertion helper ─────────────────────────────────────────
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

# curl wrapper that fails the SCRIPT (not just a soft counter) on a non-2xx
# response, instead of treating the response body as valid JSON to parse.
#
# Every call site below is a plain top-level assignment — e.g.
# `ESI_RESP=$(http POST ...)` — never `local x=$(http ...)`. That distinction
# matters: under `set -e`, a plain `VAR=$(cmd)` assignment DOES abort the
# script when `cmd` returns nonzero, but `local VAR=$(cmd)` famously does
# NOT (bash reports the exit status of the `local` builtin itself, not the
# substitution). Returning 1 here only reliably fails the script because
# nothing below assigns through `local`. (An earlier version of this script
# incremented a FAIL_COUNT global from inside here and `return 0`-ed — the
# increment was silently lost because this function's body runs in the
# subshell `$(...)` forks for command substitution, and `return 0` meant a
# failed request was never distinguishable from a successful empty one.)
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

# ── fixture IDs (generated, not hardcoded, so repeated runs never collide) ──
TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_A=$(psqlc -c "SELECT gen_random_uuid();")
EMP_B=$(psqlc -c "SELECT gen_random_uuid();")
EMP_C=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID_B=$(psqlc -c "SELECT gen_random_uuid();")   # a second run, so the two ledgers below don't collide on (tenant_id, run_id, ledger_type)
LEDGER_A=$(psqlc -c "SELECT gen_random_uuid();")
LEDGER_B=$(psqlc -c "SELECT gen_random_uuid();")
TEST_EMAIL="g13-recon-$(date +%s)@cognixhr.app"
USER_ID=""   # set once signup below succeeds; pre-declared so `set -u` doesn't choke in cleanup() if the script fails before signup runs

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  # fn_block_finalized_payroll_run_mutation blocks DELETE on a finalized run.
  # This is an intentional production safeguard, not something to work
  # around quietly — step the fixture runs off 'finalized' first so the
  # tenant cascade-delete below can actually remove them.
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  # Observed behavior, not yet root-caused: deleting the tenant directly
  # (relying on ON DELETE CASCADE to remove employees) trips
  # log_employee_changes()'s AFTER DELETE trigger, which inserts into
  # audit_logs with tenant_id = OLD.tenant_id; audit_logs_tenant_id_fkey is
  # NOT deferrable, and the insert can run after the parent tenant row is
  # already gone, failing the whole DELETE. Deleting employees explicitly
  # first (tenant row, and the FK it satisfies, still present) avoids it.
  # Whether this is a real gap in how tenant offboarding deletes employees
  # in production, or specific to this fixture shape, hasn't been
  # investigated — flagging it here rather than asserting a verdict.
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email = '$TEST_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email = '$TEST_EMAIL';" > /dev/null 2>&1 || true

  local tenant_left users_left identities_left
  tenant_left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  users_left=$(psqlc -c "SELECT count(*) FROM auth.users WHERE email = '$TEST_EMAIL';")
  # identities are keyed by provider_id = the auth.users id (see
  # findOrCreateUser() in the gateway) — if signup never completed, USER_ID
  # is still "" and there's nothing to have left behind.
  if [ -n "$USER_ID" ]; then
    identities_left=$(psqlc -c "SELECT count(*) FROM auth.identities WHERE provider_id = '$USER_ID';")
  else
    identities_left=0
  fi
  if [ "$tenant_left" != "0" ] || [ "$users_left" != "0" ] || [ "$identities_left" != "0" ]; then
    echo "  ✗ cleanup FAILED: tenant_left=$tenant_left users_left=$users_left identities_left=$identities_left" >&2
    exit 1
  fi
  echo "tenant $TENANT_ID, auth user $USER_ID ($TEST_EMAIL) and its identity row all confirmed removed (cascade covers slips/runs/ledgers/contributions)."
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Fixtures ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G13 Reconciliation Test', 'g13-recon-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');
"

SIGNUP_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"G13-Recon-$(date +%s)!\"}")
TOKEN=$(echo "$SIGNUP_RESP" | jq -r '.access_token')
USER_ID=$(echo "$SIGNUP_RESP" | jq -r '.user.id')
if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "✗ signup failed: $SIGNUP_RESP" >&2
  exit 1
fi

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$USER_ID', '$TENANT_ID', 'hr_admin', 'G13 Recon Test User', true, '$TEST_EMAIL');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES
  ('$EMP_A', '$TENANT_ID', 'RECON-A', 'Recon', 'EmployeeA', 'recon-a@example.test', '2025-01-01', 'active'),
  ('$EMP_B', '$TENANT_ID', 'RECON-B', 'Recon', 'EmployeeB', 'recon-b@example.test', '2025-01-01', 'active'),
  ('$EMP_C', '$TENANT_ID', 'RECON-C', 'Recon', 'EmployeeC', 'recon-c@example.test', '2025-01-01', 'active');

INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count, finalized_at)
VALUES
  ('$RUN_ID',   '$TENANT_ID', '$MONTH',      'finalized', 2, now()),
  ('$RUN_ID_B', '$TENANT_ID', '$MONTH_PREV', 'finalized', 2, now());

-- Employee A: gross 9500 (ESI employee 0.75% / employer 3.25% = 71.25 / 308.75)
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, status, tds_deducted, component_breakdown)
VALUES ('$TENANT_ID', '$RUN_ID', '$EMP_A', '$MONTH', 9500.00, 'finalized', 5000.00,
  '[{\"code\":\"ESI_EMPLOYEE\",\"monthly_amount\":71.25},{\"code\":\"ESI_EMPLOYER\",\"monthly_amount\":308.75}]'::jsonb);

-- Employee B: gross 4900 (ESI employee 0.75% / employer 3.25% = 36.75 / 159.25)
INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, status, tds_deducted, component_breakdown)
VALUES ('$TENANT_ID', '$RUN_ID', '$EMP_B', '$MONTH', 4900.00, 'finalized', 7500.50,
  '[{\"code\":\"ESI_EMPLOYEE\",\"monthly_amount\":36.75},{\"code\":\"ESI_EMPLOYER\",\"monthly_amount\":159.25}]'::jsonb);

INSERT INTO esi_config (tenant_id, employee_contribution_pct, employer_contribution_pct, wage_ceiling, effective_from)
VALUES ('$TENANT_ID', 0.75, 3.25, 21000.00, '2026-01-01');

-- EPF — two employees, exercising the 2+-row sum bug.
INSERT INTO epf_contributions (tenant_id, employee_id, contribution_month, pf_wages, employee_contribution, employer_pf, employer_eps, edli_contribution, voluntary_pf)
VALUES
  ('$TENANT_ID', '$EMP_A', '$MONTH', 15000.00, 1800.00, 1800.00, 1250.00, 75.00, 0.00),
  ('$TENANT_ID', '$EMP_B', '$MONTH', 15000.00, 1800.00, 1800.00, 1250.00, 75.00, 500.00);

-- PTax — two states, exercising both the sum and the by-state grouping.
INSERT INTO ptax_contributions (tenant_id, employee_id, contribution_month, state_code, gross_salary, ptax_amount, financial_year)
VALUES
  ('$TENANT_ID', '$EMP_A', '$MONTH', 'KA', 9500.00, 200.00, '2026-27'),
  ('$TENANT_ID', '$EMP_B', '$MONTH', 'KA', 4900.00, 200.00, '2026-27'),
  ('$TENANT_ID', '$EMP_C', '$MONTH', 'MH', 20000.00, 208.00, '2026-27');

-- Accounting: two ledgers, same month, exercising the 2+-row sum bug.
INSERT INTO payroll_financial_ledgers (id, tenant_id, run_id, ledger_month, ledger_type, ledger_status, total_debit, total_credit)
VALUES
  ('$LEDGER_A', '$TENANT_ID', '$RUN_ID',   '$MONTH',      'payroll', 'posted', 600000.00, 600000.00),
  ('$LEDGER_B', '$TENANT_ID', '$RUN_ID_B', '$MONTH_PREV', 'payroll', 'posted', 700000.00, 700000.00);

INSERT INTO payroll_payout_reconciliation (tenant_id, run_id, employee_id, expected_amount, paid_amount, payment_status)
VALUES
  ('$TENANT_ID', '$RUN_ID',   '$EMP_A', 600000.00, 600000.00, 'paid'),
  ('$TENANT_ID', '$RUN_ID_B', '$EMP_B', 700000.00, 0.00, 'pending');

-- GL entries: two debit rows on the same account (sum bug), one balancing credit row.
INSERT INTO payroll_ledger_entries (ledger_id, tenant_id, entry_type, entry_category, gl_account_code, gl_account_name, debit_amount, credit_amount)
VALUES
  ('$LEDGER_A', '$TENANT_ID', 'salary_expense', 'expense',   '5000', 'Salary Expense', 600000.00,       0.00),
  ('$LEDGER_B', '$TENANT_ID', 'salary_expense', 'expense',   '5000', 'Salary Expense', 700000.00,       0.00),
  ('$LEDGER_A', '$TENANT_ID', 'net_payable',    'liability', '2100', 'Net Payable',          0.00, 1300000.00);
"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. ESI eligibility + contribution amounts ==="
ESI_RESP=$(http POST "$API_URL/payroll/statutory/esi/contributions/compute" "{\"month\":\"$MONTH\"}")
echo "  compute response: $ESI_RESP"

# Read back the PERSISTED rows from Postgres, not the API response.
EMP_A_ESI=$(psqlc -c "SELECT esi_wages||'|'||is_eligible||'|'||employee_contribution||'|'||employer_contribution FROM esi_contributions WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_A' AND contribution_month='$MONTH';")
EMP_B_ESI=$(psqlc -c "SELECT esi_wages||'|'||is_eligible||'|'||employee_contribution||'|'||employer_contribution FROM esi_contributions WHERE tenant_id='$TENANT_ID' AND employee_id='$EMP_B' AND contribution_month='$MONTH';")
assert_eq "employee A persisted esi_wages|is_eligible|employee_contribution|employer_contribution" "$EMP_A_ESI" "9500.00|true|71.25|308.75"
assert_eq "employee B persisted esi_wages|is_eligible|employee_contribution|employer_contribution" "$EMP_B_ESI" "4900.00|true|36.75|159.25"

echo
echo "=== 2. Accounting summary + GL summary ==="
SUMMARY=$(http GET "$API_URL/payroll/accounting/summary")
assert_eq "total_payroll_liability"  "$(echo "$SUMMARY" | jq -r '.data.total_payroll_liability')"  "1300000"
assert_eq "pending_payout_amount"    "$(echo "$SUMMARY" | jq -r '.data.pending_payout_amount')"    "700000"
assert_eq "payout_completion_pct"    "$(echo "$SUMMARY" | jq -r '.data.payout_completion_pct')"    "46"

GLSUM=$(http GET "$API_URL/payroll/accounting/gl-summary")
GL_5000_DEBIT=$(echo "$GLSUM" | jq -r '.data[] | select(.code=="5000") | .totalDebit')
GL_2100_CREDIT=$(echo "$GLSUM" | jq -r '.data[] | select(.code=="2100") | .totalCredit')
assert_eq "gl-summary 5000.totalDebit"  "$GL_5000_DEBIT"  "1300000"
assert_eq "gl-summary 2100.totalCredit" "$GL_2100_CREDIT" "1300000"

# Real payout source rows, read back directly (not the API response) —
# proves the summary's totals trace to genuinely persisted rows.
PAYOUT_ROWS=$(psqlc -c "SELECT expected_amount||'|'||paid_amount||'|'||payment_status FROM payroll_payout_reconciliation WHERE tenant_id='$TENANT_ID' ORDER BY expected_amount;")
echo "  real payroll_payout_reconciliation rows:"
echo "$PAYOUT_ROWS" | sed 's/^/    /'

echo
echo "=== 3. Filing-pack challan (EPF + ESI + PTax + TDS, one call) ==="
CHALLAN=$(http GET "$API_URL/payroll/filing-pack/challan?month=$MONTH")

assert_eq "epf.employee_contribution" "$(echo "$CHALLAN" | jq -r '.data.epf.employee_contribution')" "3600"
assert_eq "epf.voluntary_pf"          "$(echo "$CHALLAN" | jq -r '.data.epf.voluntary_pf')"          "500"
assert_eq "epf.employer_pf"           "$(echo "$CHALLAN" | jq -r '.data.epf.employer_pf')"           "3600"
assert_eq "epf.employer_eps"          "$(echo "$CHALLAN" | jq -r '.data.epf.employer_eps')"          "2500"
assert_eq "epf.edli"                  "$(echo "$CHALLAN" | jq -r '.data.epf.edli')"                  "150"
assert_eq "epf.total_remittance"      "$(echo "$CHALLAN" | jq -r '.data.epf.total_remittance')"      "10500"

assert_eq "esi.employee_contribution" "$(echo "$CHALLAN" | jq -r '.data.esi.employee_contribution')" "108.00"
assert_eq "esi.employer_contribution" "$(echo "$CHALLAN" | jq -r '.data.esi.employer_contribution')" "468.00"
assert_eq "esi.total_remittance"      "$(echo "$CHALLAN" | jq -r '.data.esi.total_remittance')"      "576.00"

PTAX_KA=$(echo "$CHALLAN" | jq -r '.data.ptax.by_state[] | select(.state_code=="KA") | .amount')
PTAX_MH=$(echo "$CHALLAN" | jq -r '.data.ptax.by_state[] | select(.state_code=="MH") | .amount')
assert_eq "ptax.by_state.KA"       "$PTAX_KA" "400"
assert_eq "ptax.by_state.MH"       "$PTAX_MH" "208"
assert_eq "ptax.total_remittance"  "$(echo "$CHALLAN" | jq -r '.data.ptax.total_remittance')" "608"

assert_eq "tds.total_deducted" "$(echo "$CHALLAN" | jq -r '.data.tds.total_deducted')" "12500.5"
assert_eq "grand_total_remittance" "$(echo "$CHALLAN" | jq -r '.data.grand_total_remittance')" "24184.5"

# Real TDS source rows, read back directly — backs the 12500.50 figure.
TDS_ROWS=$(psqlc -c "SELECT employee_id||'|'||tds_deducted FROM payroll_slips WHERE tenant_id='$TENANT_ID' AND month='$MONTH' ORDER BY tds_deducted;")
echo "  real payroll_slips.tds_deducted rows:"
echo "$TDS_ROWS" | sed 's/^/    /'

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
