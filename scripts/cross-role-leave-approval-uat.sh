#!/usr/bin/env bash
# Cross-role UAT #2: the leave-request manager-approval workflow, extending
# Phase 5's journey matrix beyond the single ESS-payslip-isolation script
# (cross-role-ess-payslip-uat.sh covers hr_admin + employee self-service
# isolation; this one covers employee + manager + a DIFFERENT manager +
# hr_admin — 4 distinct real identities, exercising a genuine authorization
# boundary the payslip journey never touches).
#
# Real Postgres + the real API + the real auth gateway, driven entirely
# through the real HTTP endpoints (POST /leave-requests, POST /leave-
# requests/:id/approve, GET /leave-requests, GET /attendance/leave/balance),
# not direct DB manipulation of the workflow itself (fixtures only).
#
# Journey:
#   1. Employee A (reports to Manager M) submits a 1-day leave request via
#      the real POST /leave-requests endpoint.
#   2. A DIFFERENT manager (N, not A's manager) attempts to approve it ->
#      must be rejected 403 FORBIDDEN. This is the authorization boundary
#      validateApprover() enforces (apps/api/src/lib/approval-service.ts) —
#      a manager may only approve their OWN direct reports' requests.
#   3. A's real manager M approves it -> succeeds, status flips to APPROVED.
#   4. Employee A's own balance (checked via the real GET endpoint, as A's
#      own token) is correctly decremented by the approved day count.
#   5. hr_admin can see the approved request in the tenant-wide list — HR
#      retains full visibility regardless of the manager chain.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/cross-role-leave-approval-uat.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
LEAVE_DATE="2026-11-10"   # a future Tuesday — avoids weekly-off ambiguity and past-dated rejection
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
MGR_M_EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
MGR_N_EMP_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_A_ID=$(psqlc -c "SELECT gen_random_uuid();")
LEAVE_TYPE_ID=$(psqlc -c "SELECT gen_random_uuid();")
TS=$(date +%s)
MGR_M_EMAIL="crl-mgrm-$TS@cognixhr.app"
MGR_N_EMAIL="crl-mgrn-$TS@cognixhr.app"
EMP_A_EMAIL="crl-empa-$TS@cognixhr.app"
HR_EMAIL="crl-hr-$TS@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM leave_requests WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employee_leave_balance WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM leave_types WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "UPDATE employees SET manager_id = NULL WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email IN ('$MGR_M_EMAIL','$MGR_N_EMAIL','$EMP_A_EMAIL','$HR_EMAIL'));" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email IN ('$MGR_M_EMAIL','$MGR_N_EMAIL','$EMP_A_EMAIL','$HR_EMAIL');" > /dev/null 2>&1 || true

  # LEAVE_REQUESTED/LEAVE_APPROVED both publish through fastify.eventPublisher,
  # which writes an immutable platform_events row (trg_platform_events_no_delete
  # blocks ANY delete of it, even one cascading from DELETE FROM tenants) — the
  # same by-design append-only audit log already documented for G04's finalize
  # event. Accept it as the expected terminal state when nothing else is left.
  local tenant_del_err
  tenant_del_err=$(psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" 2>&1 1>/dev/null)
  local left profiles_left emp_left
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  if [ "$left" = "0" ]; then
    echo "tenant $TENANT_ID confirmed removed."
    exit "$exit_code"
  fi
  profiles_left=$(psqlc -c "SELECT count(*) FROM profiles WHERE tenant_id = '$TENANT_ID';")
  emp_left=$(psqlc -c "SELECT count(*) FROM employees WHERE tenant_id = '$TENANT_ID';")
  if echo "$tenant_del_err" | grep -q "platform_events is append-only" && \
     [ "$profiles_left" = "0" ] && [ "$emp_left" = "0" ]; then
    echo "tenant $TENANT_ID: all functional data removed; the tenant stub and its"
    echo "  immutable platform_events audit rows (LEAVE_REQUESTED/LEAVE_APPROVED)"
    echo "  remain by design (append-only log — not a test defect)."
    exit "$exit_code"
  fi
  echo "  ✗ cleanup FAILED: tenant_left=$left (profiles=$profiles_left employees=$emp_left) — $tenant_del_err" >&2
  exit 1
}
trap cleanup EXIT

signup() {
  local email="$1"
  curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Crl-$TS-$RANDOM!\"}"
}

echo "=== 0. Fixtures: tenant, Manager M, Manager N, Employee A (reports to M), leave type + balance ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'CrossRole Leave Test', 'crl-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES
  ('$MGR_M_EMP_ID', '$TENANT_ID', 'CRL-MGR-M', 'Manager', 'M', 'crl-mgrm-emp@example.test', '2020-01-01', 'active'),
  ('$MGR_N_EMP_ID', '$TENANT_ID', 'CRL-MGR-N', 'Manager', 'N', 'crl-mgrn-emp@example.test', '2020-01-01', 'active'),
  ('$EMP_A_ID',     '$TENANT_ID', 'CRL-EMP-A', 'Employee', 'A', 'crl-empa-emp@example.test', '2023-01-01', 'active');

UPDATE employees SET manager_id = '$MGR_M_EMP_ID' WHERE id = '$EMP_A_ID';

INSERT INTO leave_types (id, tenant_id, name, is_paid, is_active)
VALUES ('$LEAVE_TYPE_ID', '$TENANT_ID', 'CRL Earned Leave', true, true);

INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, balance, year)
VALUES ('$TENANT_ID', '$EMP_A_ID', '$LEAVE_TYPE_ID', 10.0, EXTRACT(year FROM '$LEAVE_DATE'::date)::integer);
"
echo "fixtures created under tenant $TENANT_ID — Employee A reports to Manager M; Manager N is unrelated"

MGR_M_RESP=$(signup "$MGR_M_EMAIL"); MGR_M_TOKEN=$(echo "$MGR_M_RESP" | jq -r '.access_token'); MGR_M_UID=$(echo "$MGR_M_RESP" | jq -r '.user.id')
MGR_N_RESP=$(signup "$MGR_N_EMAIL"); MGR_N_TOKEN=$(echo "$MGR_N_RESP" | jq -r '.access_token'); MGR_N_UID=$(echo "$MGR_N_RESP" | jq -r '.user.id')
EMP_A_RESP=$(signup "$EMP_A_EMAIL"); EMP_A_TOKEN=$(echo "$EMP_A_RESP" | jq -r '.access_token'); EMP_A_UID=$(echo "$EMP_A_RESP" | jq -r '.user.id')
HR_RESP=$(signup "$HR_EMAIL");       HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token');       HR_UID=$(echo "$HR_RESP" | jq -r '.user.id')
for pair in "MGR_M:$MGR_M_TOKEN" "MGR_N:$MGR_N_TOKEN" "EMP_A:$EMP_A_TOKEN" "HR:$HR_TOKEN"; do
  name="${pair%%:*}"; tok="${pair##*:}"
  if [ "$tok" = "null" ] || [ -z "$tok" ]; then echo "✗ signup failed for $name" >&2; exit 1; fi
done

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email, employee_id)
VALUES
  ('$MGR_M_UID', '$TENANT_ID', 'manager',  'Manager M', true, '$MGR_M_EMAIL', '$MGR_M_EMP_ID'),
  ('$MGR_N_UID', '$TENANT_ID', 'manager',  'Manager N', true, '$MGR_N_EMAIL', '$MGR_N_EMP_ID'),
  ('$EMP_A_UID', '$TENANT_ID', 'employee', 'Employee A', true, '$EMP_A_EMAIL', '$EMP_A_ID'),
  ('$HR_UID',    '$TENANT_ID', 'hr_admin', 'CRL Hr', true, '$HR_EMAIL', NULL);
"

echo
echo "=== 1. Employee A submits a leave request through the REAL POST /leave-requests endpoint ==="
SUBMIT_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/leave-requests" \
  -H "authorization: Bearer $EMP_A_TOKEN" -H 'content-type: application/json' \
  -d "{\"leave_type_id\":\"$LEAVE_TYPE_ID\",\"from_date\":\"$LEAVE_DATE\",\"to_date\":\"$LEAVE_DATE\",\"reason\":\"cross-role UAT\"}")
SUBMIT_STATUS=$(echo "$SUBMIT_RESP" | tail -1)
SUBMIT_BODY=$(echo "$SUBMIT_RESP" | sed '$d')
echo "  submit response: HTTP $SUBMIT_STATUS — $SUBMIT_BODY"
assert_eq "leave request submitted (201)" "$SUBMIT_STATUS" "201"
REQUEST_ID=$(echo "$SUBMIT_BODY" | jq -r '.data.id // empty')
if [ -z "$REQUEST_ID" ]; then echo "✗ could not extract request id: $SUBMIT_BODY" >&2; exit 1; fi

echo
echo "=== 2. Manager N (NOT Employee A's manager) tries to approve — must be rejected ==="
WRONG_MGR_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/leave-requests/$REQUEST_ID/approve" \
  -H "authorization: Bearer $MGR_N_TOKEN" -H 'content-type: application/json' -d '{}')
WRONG_MGR_STATUS=$(echo "$WRONG_MGR_RESP" | tail -1)
WRONG_MGR_BODY=$(echo "$WRONG_MGR_RESP" | sed '$d')
echo "  Manager N's attempt: HTTP $WRONG_MGR_STATUS — $WRONG_MGR_BODY"
assert_eq "an unrelated manager is rejected (403 FORBIDDEN)" "$WRONG_MGR_STATUS" "403"

STATUS_AFTER_WRONG=$(psqlc -c "SELECT status FROM leave_requests WHERE id = '$REQUEST_ID';")
assert_eq "request is still PENDING after the rejected attempt" "$STATUS_AFTER_WRONG" "PENDING"

echo
echo "=== 3. Employee A's REAL manager M approves — must succeed ==="
RIGHT_MGR_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/leave-requests/$REQUEST_ID/approve" \
  -H "authorization: Bearer $MGR_M_TOKEN" -H 'content-type: application/json' -d '{}')
RIGHT_MGR_STATUS=$(echo "$RIGHT_MGR_RESP" | tail -1)
RIGHT_MGR_BODY=$(echo "$RIGHT_MGR_RESP" | sed '$d')
echo "  Manager M's attempt: HTTP $RIGHT_MGR_STATUS — $RIGHT_MGR_BODY"
assert_eq "Employee A's real manager succeeds (200)" "$RIGHT_MGR_STATUS" "200"
assert_eq "response reports status=APPROVED" "$(echo "$RIGHT_MGR_BODY" | jq -r '.data.status')" "APPROVED"

echo
echo "=== 4. Employee A's own balance (her own token) reflects the deduction ==="
BALANCE_RESP=$(curl -sS "$API_URL/attendance/leave/balance/$EMP_A_ID" -H "authorization: Bearer $EMP_A_TOKEN")
echo "  balance response: $BALANCE_RESP"
EARNED_BALANCE=$(echo "$BALANCE_RESP" | jq -r --arg lt "$LEAVE_TYPE_ID" '
  (.data // .) | (if type=="array" then . else [.] end) | map(select(.leave_type_id == $lt)) | .[0].balance // empty')
assert_eq "Employee A's CRL Earned Leave balance is 9.0 (10.0 - 1 day approved)" "$EARNED_BALANCE" "9.0"

echo
echo "=== 5. hr_admin sees the approved request in the tenant-wide list ==="
HR_LIST_RESP=$(curl -sS "$API_URL/leave-requests?employee_id=$EMP_A_ID" -H "authorization: Bearer $HR_TOKEN")
HR_SEES_STATUS=$(echo "$HR_LIST_RESP" | jq -r --arg id "$REQUEST_ID" '(.data // .) | map(select(.id == $id)) | .[0].status // empty')
assert_eq "hr_admin sees the request, status=APPROVED" "$HR_SEES_STATUS" "APPROVED"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
