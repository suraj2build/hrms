#!/usr/bin/env bash
# Real-endpoint reproduction for audit finding G06: GET /reports/statutory
# computed PF/ESI figures as a formula approximation from
# employee_compensations.ctc_monthly ("~50% of CTC as basic, capped at
# 15,000, times 12%" for PF; "0.75%/3.25% of CTC if <= 21,000" for ESI)
# instead of reading the REAL contribution amounts the statutory engine
# already computed and persisted in epf_contributions / esi_contributions
# (the same tables filing-pack.ts reads for actual EPFO/ESIC filing).
#
# This report feeds actual compliance decisions — showing an estimate
# instead of the real filed-or-filing numbers is a genuine correctness bug,
# not a cosmetic one.
#
# Fix (apps/api/src/routes/analytics/reports.ts, "4. Statutory Compliance
# Register" / "G06"): the endpoint now requires a `month` query param and
# reads epf_contributions/esi_contributions for that month, keyed by
# employee_id, instead of approximating from ctc_monthly.
#
# This script seeds an employee whose CTC would produce one set of numbers
# under the OLD formula, and a REAL epf_contributions/esi_contributions row
# for the report month with DELIBERATELY DIFFERENT numbers (as if arrears,
# LOP, or a statutory override made the real computation diverge from the
# naive formula) — then asserts GET /reports/statutory?month=... returns
# the REAL numbers, not the formula's.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/g06-statutory-report-real-contributions-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-07"
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
HR_EMAIL="g06-stat-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM epf_contributions WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM esi_contributions WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_bank_statutory WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_compensations WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM job_history WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
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

echo "=== 0. Fixtures: tenant, employee, CTC=50000/mo (OLD formula would give PF=1800/1800, ESI=n/a), REAL contributions deliberately different ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G06 Statutory Report Test', 'g06-stat-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES ('$EMP_ID', '$TENANT_ID', 'G06-1', 'Stat', 'Employee', 'g06-stat-emp@example.test', '2024-01-01', 'active');

INSERT INTO job_history (tenant_id, employee_id, employment_type, effective_from, is_current)
VALUES ('$TENANT_ID', '$EMP_ID', 'permanent', '2024-01-01', true);

-- CTC chosen so the OLD formula (~50% basic capped 15000, *12%) would give
-- PF employee/employer = round(min(50000*0.5,15000)*0.12) = 1800 each, and
-- ESI would be inapplicable (50000 > 21000 threshold).
INSERT INTO employee_compensations (id, tenant_id, employee_id, effective_from, is_active, ctc_annual)
VALUES (gen_random_uuid(), '$TENANT_ID', '$EMP_ID', '2024-01-01', true, 600000.00);

INSERT INTO employee_bank_statutory (tenant_id, employee_id, uan_number, pf_number, esi_number)
VALUES ('$TENANT_ID', '$EMP_ID', 'UAN123456', 'PF123456', 'ESI123456');

-- REAL persisted contribution for $MONTH, deliberately different from what
-- the old ctc-based formula would have produced (simulating a statutory
-- override / arrears / voluntary PF the formula could never account for).
INSERT INTO epf_contributions (tenant_id, employee_id, contribution_month, pf_wages, employee_contribution, employer_pf, employer_eps, edli_contribution, voluntary_pf)
VALUES ('$TENANT_ID', '$EMP_ID', '$MONTH', 15000.00, 2500.00, 1300.00, 541.00, 75.00, 700.00);
-- employee_contribution=2500 (1800+700 voluntary), employer_pf+eps+edli = 1300+541+75 = 1916 (total_employer_contribution, generated)

-- ESI: even though CTC (50000) is above the naive 21000 threshold, suppose
-- the real engine determined eligibility from actual gross wages for the
-- month (e.g. a large unpaid-leave month dropped gross below the ESI
-- ceiling) — is_eligible=true with real wages/contributions the formula
-- would never have produced (formula said 'not applicable' outright).
INSERT INTO esi_contributions (tenant_id, employee_id, contribution_month, esi_wages, employee_contribution, employer_contribution, is_eligible)
VALUES ('$TENANT_ID', '$EMP_ID', '$MONTH', 18000.00, 135.00, 585.00, true);
"
echo "fixtures created under tenant $TENANT_ID"

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"G06-Stat-$(date +%s)!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')
if [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: $HR_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', 'G06 Stat Hr', true, '$HR_EMAIL');
"

echo
echo "=== 1. GET /reports/statutory without month — must be rejected, not silently default ==="
NO_MONTH_RESP=$(curl -sS -w '\n%{http_code}' "$API_URL/reports/statutory" \
  -H "authorization: Bearer $HR_TOKEN")
NO_MONTH_STATUS=$(echo "$NO_MONTH_RESP" | tail -1)
assert_eq "missing month is rejected (400)" "$NO_MONTH_STATUS" "400"

echo
echo "=== 2. GET /reports/statutory?month=$MONTH through the REAL endpoint ==="
REPORT_RESP=$(curl -sS -X GET "$API_URL/reports/statutory?month=$MONTH" \
  -H "authorization: Bearer $HR_TOKEN")
echo "  report response: $REPORT_RESP"

ROW=$(echo "$REPORT_RESP" | jq -c '.rows[] | select(.employee_code == "G06-1")')
PF_EMP=$(echo "$ROW" | jq -r '.pf_employee_monthly')
PF_EMPLOYER=$(echo "$ROW" | jq -r '.pf_employer_monthly')
ESI_APPLICABLE=$(echo "$ROW" | jq -r '.esi_applicable')
ESI_EMP=$(echo "$ROW" | jq -r '.esi_employee_monthly')
ESI_EMPLOYER=$(echo "$ROW" | jq -r '.esi_employer_monthly')

echo
echo "=== 3. Report must show the REAL persisted contributions, not the CTC-formula estimate ==="
assert_eq "pf_employee_monthly = REAL 2500 (NOT the formula's 1800)" "$PF_EMP" "2500"
assert_eq "pf_employer_monthly = REAL 1916 total employer (1300+541+75) (NOT the formula's 1800)" "$PF_EMPLOYER" "1916"
assert_eq "esi_applicable = true (REAL is_eligible, even though CTC is above the naive 21000 cutoff the formula used)" "$ESI_APPLICABLE" "true"
assert_eq "esi_employee_monthly = REAL 135 (the formula would have said ESI does not apply at all)" "$ESI_EMP" "135"
assert_eq "esi_employer_monthly = REAL 585 (the formula would have said ESI does not apply at all)" "$ESI_EMPLOYER" "585"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
