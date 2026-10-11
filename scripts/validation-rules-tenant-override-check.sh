#!/usr/bin/env bash
# Real-database proof for migration 439 (payroll_validation_rules_tenant_override)
# and the GET/PATCH /payroll/validation-rules rewrite.
#
# Verifies, against the real API + real Postgres (not mocks):
#   1. GET returns the resolved set including the platform defaults (11 +
#      the newly-seeded UNKNOWN_FAILURE = 12), none tagged is_override.
#   2. PATCH by super_admin creates a TENANT override — it does NOT touch
#      the global row.
#   3. GET after the PATCH shows the override values with is_override=true,
#      and the global row is independently confirmed unchanged in the DB.
#   4. hr_admin (non-super_admin) PATCH is rejected with 403.
#   5. PATCH for a code with no global rule 404s.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/validation-rules-tenant-override-check.sh

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
SUPER_EMAIL="pvr-super-$(date +%s)@cognixhr.app"
HR_EMAIL="pvr-hr-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM payroll_validation_rules WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email IN ('$SUPER_EMAIL','$HR_EMAIL'));" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email IN ('$SUPER_EMAIL','$HR_EMAIL');" > /dev/null 2>&1 || true
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

echo "=== 0. Fixtures: tenant + super_admin + hr_admin ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'PVR Override Test', 'pvr-override-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');
"
SUPER_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$SUPER_EMAIL\",\"password\":\"Pvr-Super-$(date +%s)!\"}")
SUPER_TOKEN=$(echo "$SUPER_RESP" | jq -r '.access_token')
SUPER_USER_ID=$(echo "$SUPER_RESP" | jq -r '.user.id')

HR_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$HR_EMAIL\",\"password\":\"Pvr-Hr-$(date +%s)!\"}")
HR_TOKEN=$(echo "$HR_RESP" | jq -r '.access_token')
HR_USER_ID=$(echo "$HR_RESP" | jq -r '.user.id')

if [ "$SUPER_TOKEN" = "null" ] || [ -z "$SUPER_TOKEN" ] || [ "$HR_TOKEN" = "null" ] || [ -z "$HR_TOKEN" ]; then
  echo "✗ signup failed: super=$SUPER_RESP hr=$HR_RESP" >&2
  exit 1
fi

psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$SUPER_USER_ID', '$TENANT_ID', 'super_admin', 'PVR Super', true, '$SUPER_EMAIL');
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$HR_USER_ID', '$TENANT_ID', 'hr_admin', 'PVR HR', true, '$HR_EMAIL');
"
echo "fixtures created under tenant $TENANT_ID"

echo
echo "=== 1. GET returns platform defaults, none overridden ==="
GET1=$(curl -sS "$API_URL/payroll/validation-rules" -H "authorization: Bearer $SUPER_TOKEN")
GET1_COUNT=$(echo "$GET1" | jq '.data | length')
GET1_UNKNOWN=$(echo "$GET1" | jq -r '.data[] | select(.code=="UNKNOWN_FAILURE") | .code')
GET1_ANY_OVERRIDE=$(echo "$GET1" | jq '[.data[] | select(.is_override == true)] | length')
assert_eq "GET returns at least 12 resolved rules (11 original + seeded UNKNOWN_FAILURE)" "$([ "$GET1_COUNT" -ge 12 ] && echo yes || echo no)" "yes"
assert_eq "UNKNOWN_FAILURE is present (previously-missing seed, migration 439)" "$GET1_UNKNOWN" "UNKNOWN_FAILURE"
assert_eq "no rule is tagged is_override before any PATCH" "$GET1_ANY_OVERRIDE" "0"

echo
echo "=== 2. hr_admin PATCH is rejected (403) ==="
HR_PATCH_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/payroll/validation-rules/COMP_MISSING" \
  -H "authorization: Bearer $HR_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}')
assert_eq "hr_admin PATCH rejected" "$HR_PATCH_STATUS" "403"

echo
echo "=== 3. super_admin PATCH creates a TENANT override, not a global edit ==="
PATCH_RESP=$(curl -sS -X PATCH "$API_URL/payroll/validation-rules/COMP_MISSING" \
  -H "authorization: Bearer $SUPER_TOKEN" -H 'content-type: application/json' -d '{"enabled":false,"severity":"warning"}')
PATCH_IS_OVERRIDE=$(echo "$PATCH_RESP" | jq -r '.data.is_override')
PATCH_TENANT_ID=$(echo "$PATCH_RESP" | jq -r '.data.tenant_id // "null"')
assert_eq "PATCH response is tagged is_override=true" "$PATCH_IS_OVERRIDE" "true"

GLOBAL_ROW_SEVERITY=$(psqlc -c "SELECT severity FROM payroll_validation_rules WHERE code='COMP_MISSING' AND tenant_id IS NULL;")
GLOBAL_ROW_ENABLED=$(psqlc -c "SELECT enabled FROM payroll_validation_rules WHERE code='COMP_MISSING' AND tenant_id IS NULL;")
assert_eq "global COMP_MISSING row severity UNTOUCHED (still critical)" "$GLOBAL_ROW_SEVERITY" "critical"
assert_eq "global COMP_MISSING row enabled UNTOUCHED (still true)" "$GLOBAL_ROW_ENABLED" "t"

TENANT_ROW_COUNT=$(psqlc -c "SELECT count(*) FROM payroll_validation_rules WHERE code='COMP_MISSING' AND tenant_id = '$TENANT_ID';")
assert_eq "exactly one tenant override row now exists for COMP_MISSING" "$TENANT_ROW_COUNT" "1"

echo
echo "=== 4. GET after PATCH shows the override, not the global default ==="
GET2=$(curl -sS "$API_URL/payroll/validation-rules" -H "authorization: Bearer $SUPER_TOKEN")
GET2_COMP_MISSING=$(echo "$GET2" | jq '.data[] | select(.code=="COMP_MISSING")')
GET2_ENABLED=$(echo "$GET2_COMP_MISSING" | jq -r '.enabled')
GET2_SEVERITY=$(echo "$GET2_COMP_MISSING" | jq -r '.severity')
GET2_IS_OVERRIDE=$(echo "$GET2_COMP_MISSING" | jq -r '.is_override')
GET2_OTHER_COUNT=$(echo "$GET2" | jq '[.data[] | select(.code=="COMP_MISSING")] | length')
assert_eq "exactly one COMP_MISSING row in the resolved list (override shadows global, not both)" "$GET2_OTHER_COUNT" "1"
assert_eq "resolved COMP_MISSING.enabled reflects the override (false)" "$GET2_ENABLED" "false"
assert_eq "resolved COMP_MISSING.severity reflects the override (warning)" "$GET2_SEVERITY" "warning"
assert_eq "resolved COMP_MISSING.is_override = true" "$GET2_IS_OVERRIDE" "true"

echo
echo "=== 5. PATCH for a nonexistent code 404s ==="
NOTFOUND_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/payroll/validation-rules/NO_SUCH_RULE_CODE" \
  -H "authorization: Bearer $SUPER_TOKEN" -H 'content-type: application/json' -d '{"enabled":false}')
assert_eq "PATCH for unknown code returns 404" "$NOTFOUND_STATUS" "404"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
