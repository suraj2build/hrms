#!/usr/bin/env bash
# Cross-role UAT #3: the reimbursement-claim approval workflow — a
# DIFFERENT authorization mechanism from the leave-approval journey
# (cross-role-leave-approval-uat.sh tests validateApprover()'s direct
# manager_id scoping). Reimbursement approval is gated by gateApprove()
# (apps/api/src/lib/approval-orchestrator.ts), which for a tenant with no
# configured approval chain falls back to a legacy "HR admin only" rule —
# plus an independent self-approval guard (isSelfApproval()) and a
# server-side cap preventing an approver from approving MORE than the
# employee actually claimed.
#
# Real Postgres + the real API + the real auth gateway, driven through the
# real HTTP endpoints (POST /payroll/reimbursements/my,
# .../my/:id/submit, .../claims/:id/approve), not direct DB manipulation
# of the claim's workflow state (fixtures only: tenant/employees/category).
#
# Journey (5 distinct real identities: 2 in tenant A sharing one claim,
# 1 unauthorized role, 1 cross-tenant HR admin, 1 authorized HR admin):
#   1. An HR admin (Employee H, tenant A) submits their OWN expense claim
#      via the real POST /my + POST /my/:id/submit endpoints.
#   2. A `manager`-role user (tenant A, not HR) attempts to approve it ->
#      403 FORBIDDEN. No approval chain is configured for this tenant, so
#      gateApprove() falls back to legacy HR-only — a plain `manager` role
#      is not HR and must be rejected regardless of reporting structure.
#   3. H (the claimant) attempts to approve their OWN claim, using H's own
#      hr_admin role -> 403 SELF_APPROVAL_FORBIDDEN. Being HR does not
#      exempt you from the self-approval guard.
#   4. An HR admin from a DIFFERENT tenant (cross-tenant) attempts to
#      approve -> 404 NOT_FOUND. The claim is correctly invisible outside
#      its own tenant, not merely unauthorized.
#   5. A real HR admin in tenant A attempts to approve for MORE than was
#      claimed -> 400 VALIDATION_ERROR (server-side over-approval cap).
#   6. The same HR admin approves for the full claimed amount -> 200,
#      status flips to 'approved', reviewed_by is correctly recorded.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/cross-role-reimbursement-approval-uat.sh

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

TS=$(date +%s)
TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
TENANT_B_ID=$(psqlc -c "SELECT gen_random_uuid();")
CATEGORY_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_H_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_M_ID=$(psqlc -c "SELECT gen_random_uuid();")
EMP_H2_ID=$(psqlc -c "SELECT gen_random_uuid();")
H_EMAIL="reimb-hr-claimant-$TS@cognixhr.app"
MGR_EMAIL="reimb-manager-$TS@cognixhr.app"
HR2_EMAIL="reimb-hr-approver-$TS@cognixhr.app"
CROSS_EMAIL="reimb-cross-tenant-hr-$TS@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM reimbursement_claims WHERE tenant_id IN ('$TENANT_ID','$TENANT_B_ID');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM reimbursement_categories WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id IN ('$TENANT_ID','$TENANT_B_ID');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM employees WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email IN ('$H_EMAIL','$MGR_EMAIL','$HR2_EMAIL','$CROSS_EMAIL'));" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email IN ('$H_EMAIL','$MGR_EMAIL','$HR2_EMAIL','$CROSS_EMAIL');" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id IN ('$TENANT_ID','$TENANT_B_ID');" > /dev/null 2>&1 || true
  local left
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id IN ('$TENANT_ID','$TENANT_B_ID');")
  if [ "$left" = "0" ]; then
    echo "tenants confirmed removed."
    exit "$exit_code"
  fi
  echo "  ✗ cleanup FAILED: tenants_left=$left" >&2
  exit 1
}
trap cleanup EXIT

echo "=== 0. Fixtures: tenant A (+ a second tenant B for cross-tenant check), category, 3 employees in A ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES
  ('$TENANT_ID',   'Reimb UAT Tenant A', 'reimb-uat-a-${TENANT_ID:0:8}',   'active', true, now() + interval '1 day'),
  ('$TENANT_B_ID', 'Reimb UAT Tenant B', 'reimb-uat-b-${TENANT_B_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO reimbursement_categories (id, tenant_id, name, code, category_type, is_active)
VALUES ('$CATEGORY_ID', '$TENANT_ID', 'Travel', 'TRAVEL-UAT-${TS}', 'travel', true);

INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
VALUES
  ('$EMP_H_ID',  '$TENANT_ID', 'RMB-H-${TS: -4}',  'Hr', 'Claimant',  'reimb-h-${TS}@example.test',  '2022-01-01', 'active'),
  ('$EMP_M_ID',  '$TENANT_ID', 'RMB-M-${TS: -4}',  'Manager', 'Role', 'reimb-m-${TS}@example.test',  '2022-01-01', 'active'),
  ('$EMP_H2_ID', '$TENANT_ID', 'RMB-H2-${TS: -4}', 'Hr', 'Approver',  'reimb-h2-${TS}@example.test', '2022-01-01', 'active');
"
echo "fixtures created under tenant A=$TENANT_ID, tenant B=$TENANT_B_ID"

signup() {
  local email="$1" pass="$2"
  curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}"
}

H_RESP=$(signup "$H_EMAIL" "Reimb-H-$TS!")
H_TOKEN=$(echo "$H_RESP" | jq -r '.access_token'); H_USER_ID=$(echo "$H_RESP" | jq -r '.user.id')
MGR_RESP=$(signup "$MGR_EMAIL" "Reimb-Mgr-$TS!")
MGR_TOKEN=$(echo "$MGR_RESP" | jq -r '.access_token'); MGR_USER_ID=$(echo "$MGR_RESP" | jq -r '.user.id')
HR2_RESP=$(signup "$HR2_EMAIL" "Reimb-Hr2-$TS!")
HR2_TOKEN=$(echo "$HR2_RESP" | jq -r '.access_token'); HR2_USER_ID=$(echo "$HR2_RESP" | jq -r '.user.id')
CROSS_RESP=$(signup "$CROSS_EMAIL" "Reimb-Cross-$TS!")
CROSS_TOKEN=$(echo "$CROSS_RESP" | jq -r '.access_token'); CROSS_USER_ID=$(echo "$CROSS_RESP" | jq -r '.user.id')

for t in "$H_TOKEN" "$MGR_TOKEN" "$HR2_TOKEN" "$CROSS_TOKEN"; do
  if [ "$t" = "null" ] || [ -z "$t" ]; then
    echo "✗ a signup failed: H=$H_RESP MGR=$MGR_RESP HR2=$HR2_RESP CROSS=$CROSS_RESP" >&2
    exit 1
  fi
done

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, employee_id, is_active, email)
VALUES
  ('$H_USER_ID',   '$TENANT_ID', 'hr_admin', '$EMP_H_ID',  true, '$H_EMAIL'),
  ('$MGR_USER_ID', '$TENANT_ID', 'manager',  '$EMP_M_ID',  true, '$MGR_EMAIL'),
  ('$HR2_USER_ID', '$TENANT_ID', 'hr_admin', '$EMP_H2_ID', true, '$HR2_EMAIL'),
  ('$CROSS_USER_ID', '$TENANT_B_ID', 'hr_admin', NULL, true, '$CROSS_EMAIL');
"

echo
echo "=== 1. H (hr_admin) submits their OWN claim via the real endpoints ==="
CREATE_RESP=$(curl -sS -X POST "$API_URL/payroll/reimbursements/my" \
  -H "authorization: Bearer $H_TOKEN" -H 'content-type: application/json' \
  -d "{\"category_id\":\"$CATEGORY_ID\",\"expense_date\":\"2026-06-01\",\"claimed_amount\":2000,\"description\":\"UAT travel claim\"}")
CLAIM_ID=$(echo "$CREATE_RESP" | jq -r '.data.id // empty')
echo "  create response: $CREATE_RESP"
assert_eq "claim created in 'draft' status" "$(echo "$CREATE_RESP" | jq -r '.data.status')" "draft"

SUBMIT_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/reimbursements/my/$CLAIM_ID/submit" \
  -H "authorization: Bearer $H_TOKEN")
SUBMIT_STATUS=$(echo "$SUBMIT_RESP" | tail -1)
assert_eq "claim submitted (200)" "$SUBMIT_STATUS" "200"

echo
echo "=== 2. A 'manager'-role user attempts approve — no chain configured, legacy HR-only applies ==="
MGR_APPROVE_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/reimbursements/claims/$CLAIM_ID/approve" \
  -H "authorization: Bearer $MGR_TOKEN" -H 'content-type: application/json' -d '{"approved_amount":2000}')
MGR_APPROVE_STATUS=$(echo "$MGR_APPROVE_RESP" | tail -1)
MGR_APPROVE_BODY=$(echo "$MGR_APPROVE_RESP" | sed '$d')
echo "  manager approve attempt: HTTP $MGR_APPROVE_STATUS — $MGR_APPROVE_BODY"
assert_eq "manager (non-HR, no chain) is REJECTED (403 FORBIDDEN)" "$MGR_APPROVE_STATUS" "403"
assert_eq "error is FORBIDDEN, not a false success" "$(echo "$MGR_APPROVE_BODY" | jq -r '.error')" "FORBIDDEN"

echo
echo "=== 3. H attempts to approve THEIR OWN claim — self-approval guard applies even to HR ==="
SELF_APPROVE_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/reimbursements/claims/$CLAIM_ID/approve" \
  -H "authorization: Bearer $H_TOKEN" -H 'content-type: application/json' -d '{"approved_amount":2000}')
SELF_APPROVE_STATUS=$(echo "$SELF_APPROVE_RESP" | tail -1)
SELF_APPROVE_BODY=$(echo "$SELF_APPROVE_RESP" | sed '$d')
echo "  self-approve attempt: HTTP $SELF_APPROVE_STATUS — $SELF_APPROVE_BODY"
assert_eq "self-approval is REJECTED (403) even for an hr_admin approving their own claim" "$SELF_APPROVE_STATUS" "403"
assert_eq "error is SELF_APPROVAL_FORBIDDEN specifically" "$(echo "$SELF_APPROVE_BODY" | jq -r '.error')" "SELF_APPROVAL_FORBIDDEN"

echo
echo "=== 4. A cross-tenant hr_admin (tenant B) attempts approve — must not even see this claim ==="
CROSS_APPROVE_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/reimbursements/claims/$CLAIM_ID/approve" \
  -H "authorization: Bearer $CROSS_TOKEN" -H 'content-type: application/json' -d '{"approved_amount":2000}')
CROSS_APPROVE_STATUS=$(echo "$CROSS_APPROVE_RESP" | tail -1)
echo "  cross-tenant approve attempt: HTTP $CROSS_APPROVE_STATUS"
assert_eq "cross-tenant hr_admin gets 404 NOT_FOUND, not 403 — the claim is invisible outside its tenant" "$CROSS_APPROVE_STATUS" "404"

CLAIM_STATUS_AFTER_REJECTIONS=$(psqlc -c "SELECT status FROM reimbursement_claims WHERE id = '$CLAIM_ID';")
assert_eq "claim is STILL 'submitted' — none of the 3 rejected attempts changed anything" "$CLAIM_STATUS_AFTER_REJECTIONS" "submitted"

echo
echo "=== 5. The correct HR approver (H2) attempts to approve for MORE than claimed — server-side cap ==="
OVERCAP_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/reimbursements/claims/$CLAIM_ID/approve" \
  -H "authorization: Bearer $HR2_TOKEN" -H 'content-type: application/json' -d '{"approved_amount":5000}')
OVERCAP_STATUS=$(echo "$OVERCAP_RESP" | tail -1)
echo "  over-cap approve attempt (claimed=2000, approved_amount=5000): HTTP $OVERCAP_STATUS"
assert_eq "approving MORE than claimed is REJECTED (400 VALIDATION_ERROR)" "$OVERCAP_STATUS" "400"

echo
echo "=== 6. H2 approves for the real claimed amount — genuinely succeeds ==="
REAL_APPROVE_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/reimbursements/claims/$CLAIM_ID/approve" \
  -H "authorization: Bearer $HR2_TOKEN" -H 'content-type: application/json' -d '{"approved_amount":2000}')
REAL_APPROVE_STATUS=$(echo "$REAL_APPROVE_RESP" | tail -1)
echo "  real approve attempt: HTTP $REAL_APPROVE_STATUS"
assert_eq "genuine approval succeeds (200)" "$REAL_APPROVE_STATUS" "200"

FINAL_ROW=$(psqlc -c "SELECT status || '|' || approved_amount || '|' || reviewed_by::text FROM reimbursement_claims WHERE id = '$CLAIM_ID';")
assert_eq "claim status is now 'approved'" "$(echo "$FINAL_ROW" | cut -d'|' -f1)" "approved"
assert_eq "approved_amount correctly recorded as 2000.00" "$(echo "$FINAL_ROW" | cut -d'|' -f2)" "2000.00"
assert_eq "reviewed_by correctly records H2, the real approver" "$(echo "$FINAL_ROW" | cut -d'|' -f3)" "$HR2_USER_ID"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
[ "$FAIL_COUNT" -eq 0 ]
