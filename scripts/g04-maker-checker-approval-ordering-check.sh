#!/usr/bin/env bash
# Real-endpoint reproduction for audit finding G04: POST /payroll/runs/:id/
# finalize recorded the maker-checker ("four-eyes") approval in
# maker_checker_log BEFORE the attendance-closure, attendance-completeness,
# open-blockers, and validation-run gates ran — any of which can still
# reject the finalize request. That left a maker_checker_log row claiming
# "approved" (or "auto_approved") for a finalize that never actually
# happened, with no rollback.
#
# Fix (apps/api/src/routes/payroll/runs.ts, "PI-1 maker-checker / four-eyes
# finalize"): the maker-checker block still VALIDATES early (reject fast when
# there's nothing to approve yet, or the wrong person is trying to approve),
# but the actual commit of the approval/auto-approval row is deferred into a
# closure (commitMakerCheckerApproval) that is only invoked right before
# Step 1 (the real slip/run mutation), after every other gate has passed.
#
# This script drives the REAL HTTP endpoint through the exact failure mode
# the audit described:
#   1. Maker (hr_admin A) proposes finalize on a run whose month's attendance
#      is NOT locked yet → 202 PENDING_CHECKER, maker_checker_log is
#      'pending'.
#   2. Checker (hr_admin B, distinct from the maker and from the run's
#      creator) approves → but the attendance-closure gate rejects with
#      423 ATTENDANCE_NOT_LOCKED (attendance hasn't been closed for the
#      month). Pre-fix, the maker_checker_log row would already have been
#      flipped to 'approved' by this point even though finalize failed.
#      Post-fix, it must still read 'pending' — nothing was actually
#      approved, because nothing was actually finalized.
#   3. Lock attendance for the month and seed a completed, non-blocking
#      validation run (satisfying the remaining gates), then have the SAME
#      checker call finalize again → this time it actually succeeds (200),
#      the run is really finalized, and ONLY NOW does maker_checker_log
#      flip to 'approved' with the correct checker_id.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
#   ./scripts/g04-maker-checker-approval-ordering-check.sh

set -uo pipefail

API_URL="${API_URL:-http://localhost:2001}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:9000}"
MONTH="2026-08"
PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $label = $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ $label: expected '$expected', got '$actual'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

TENANT_ID=$(psqlc -c "SELECT gen_random_uuid();")
RUN_ID=$(psqlc -c "SELECT gen_random_uuid();")
MAKER_EMAIL="g04-maker-$(date +%s)@cognixhr.app"
CHECKER_EMAIL="g04-checker-$(date +%s)@cognixhr.app"

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  psqlc -c "DELETE FROM maker_checker_log WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_validation_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM attendance_period_locks WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  # trg_block_finalized_payroll_run_mutation blocks DELETE on a finalized run —
  # roll it back to draft first (same pattern as the slip-level lockdown
  # trigger's rollback path elsewhere in this engagement's scripts).
  psqlc -c "UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM payroll_runs WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM profiles WHERE tenant_id = '$TENANT_ID';" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.identities WHERE provider_id IN (SELECT id::text FROM auth.users WHERE email IN ('$MAKER_EMAIL', '$CHECKER_EMAIL'));" > /dev/null 2>&1 || true
  psqlc -c "DELETE FROM auth.users WHERE email IN ('$MAKER_EMAIL', '$CHECKER_EMAIL');" > /dev/null 2>&1 || true

  # The real finalize success path in step 5 calls fastify.eventPublisher,
  # which writes an immutable platform_events row (trg_platform_events_no_delete
  # blocks ANY delete of it, even one cascading from DELETE FROM tenants via
  # platform_events_tenant_fk's ON DELETE CASCADE) — a genuine, by-design
  # append-only audit log, not a test defect. So a tenant that reached a real
  # finalize cannot be hard-deleted here; that is an existing, separate
  # architectural property of hard-delete-tenant vs. the audit trail, out of
  # scope for G04. Try the delete; if platform_events is the only thing left
  # for this tenant, accept it as the expected terminal state instead of
  # failing cleanup.
  local tenant_del_err
  tenant_del_err=$(psqlc -c "DELETE FROM tenants WHERE id = '$TENANT_ID';" 2>&1 1>/dev/null)
  local left profiles_left runs_left mc_left
  left=$(psqlc -c "SELECT count(*) FROM tenants WHERE id = '$TENANT_ID';")
  if [ "$left" = "0" ]; then
    echo "tenant $TENANT_ID confirmed removed."
    exit "$exit_code"
  fi
  profiles_left=$(psqlc -c "SELECT count(*) FROM profiles WHERE tenant_id = '$TENANT_ID';")
  runs_left=$(psqlc -c "SELECT count(*) FROM payroll_runs WHERE tenant_id = '$TENANT_ID';")
  mc_left=$(psqlc -c "SELECT count(*) FROM maker_checker_log WHERE tenant_id = '$TENANT_ID';")
  if echo "$tenant_del_err" | grep -q "platform_events is append-only" && \
     [ "$profiles_left" = "0" ] && [ "$runs_left" = "0" ] && [ "$mc_left" = "0" ]; then
    echo "tenant $TENANT_ID: all functional data removed; the tenant stub and its"
    echo "  immutable platform_events audit row remain by design (append-only log —"
    echo "  not a test defect; same reason production never hard-deletes a tenant"
    echo "  that has ever actually finalized a payroll run)."
    exit "$exit_code"
  fi
  echo "  ✗ cleanup FAILED: tenant_left=$left (profiles=$profiles_left runs=$runs_left maker_checker_log=$mc_left) — $tenant_del_err" >&2
  exit 1
}
trap cleanup EXIT

echo "=== 0. Fixtures: tenant, a draft payroll run with NO creator (avoids PREPARER_CANNOT_APPROVE), attendance left OPEN ==="
psqlc -c "
INSERT INTO tenants (id, name, slug, status, allow_login, trial_ends_at)
VALUES ('$TENANT_ID', 'G04 MakerChecker Test', 'g04-mc-test-${TENANT_ID:0:8}', 'active', true, now() + interval '1 day');

INSERT INTO payroll_runs (id, tenant_id, month, status, created_by)
VALUES ('$RUN_ID', '$TENANT_ID', '$MONTH', 'draft', NULL);
"
echo "fixtures created under tenant $TENANT_ID, run $RUN_ID (month=$MONTH, attendance NOT locked)"

MAKER_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$MAKER_EMAIL\",\"password\":\"G04-Maker-$(date +%s)!\"}")
MAKER_TOKEN=$(echo "$MAKER_RESP" | jq -r '.access_token')
MAKER_USER_ID=$(echo "$MAKER_RESP" | jq -r '.user.id')
CHECKER_RESP=$(curl -sS -X POST "$GATEWAY_URL/auth/v1/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$CHECKER_EMAIL\",\"password\":\"G04-Checker-$(date +%s)!\"}")
CHECKER_TOKEN=$(echo "$CHECKER_RESP" | jq -r '.access_token')
CHECKER_USER_ID=$(echo "$CHECKER_RESP" | jq -r '.user.id')
if [ "$MAKER_TOKEN" = "null" ] || [ -z "$MAKER_TOKEN" ] || [ "$CHECKER_TOKEN" = "null" ] || [ -z "$CHECKER_TOKEN" ]; then
  echo "✗ signup failed: maker=$MAKER_RESP checker=$CHECKER_RESP" >&2
  exit 1
fi
psqlc -c "
INSERT INTO profiles (id, tenant_id, role, full_name, is_active, email)
VALUES ('$MAKER_USER_ID', '$TENANT_ID', 'hr_admin', 'G04 Maker', true, '$MAKER_EMAIL'),
       ('$CHECKER_USER_ID', '$TENANT_ID', 'hr_admin', 'G04 Checker', true, '$CHECKER_EMAIL');
"

echo
echo "=== 1. Maker proposes finalize through the REAL endpoint ==="
MAKER_CALL_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/runs/$RUN_ID/finalize" \
  -H "authorization: Bearer $MAKER_TOKEN" -H 'content-type: application/json' -d '{}')
MAKER_CALL_STATUS=$(echo "$MAKER_CALL_RESP" | tail -1)
MAKER_CALL_BODY=$(echo "$MAKER_CALL_RESP" | sed '$d')
echo "  maker call: HTTP $MAKER_CALL_STATUS — $MAKER_CALL_BODY"
assert_eq "maker proposal returns 202 PENDING_CHECKER" "$MAKER_CALL_STATUS" "202"

MC_STATUS_AFTER_PROPOSE=$(psqlc -c "SELECT status FROM maker_checker_log WHERE tenant_id = '$TENANT_ID' AND entity_id = '$RUN_ID' AND action = 'finalize';")
assert_eq "maker_checker_log is 'pending' after the proposal" "$MC_STATUS_AFTER_PROPOSE" "pending"

echo
echo "=== 2. Checker attempts finalize — attendance is NOT locked, so the gate rejects it ==="
CHECKER_CALL_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/runs/$RUN_ID/finalize" \
  -H "authorization: Bearer $CHECKER_TOKEN" -H 'content-type: application/json' -d '{}')
CHECKER_CALL_STATUS=$(echo "$CHECKER_CALL_RESP" | tail -1)
CHECKER_CALL_BODY=$(echo "$CHECKER_CALL_RESP" | sed '$d')
echo "  checker call (attendance open): HTTP $CHECKER_CALL_STATUS — $CHECKER_CALL_BODY"
assert_eq "checker call is rejected by the attendance-closure gate (423)" "$CHECKER_CALL_STATUS" "423"

echo
echo "=== 3. THE FIX: maker_checker_log must still be 'pending' — nothing was actually approved ==="
MC_ROW_AFTER_REJECTED_CHECK=$(psqlc -c "SELECT status || '|' || coalesce(checker_id::text,'') FROM maker_checker_log WHERE tenant_id = '$TENANT_ID' AND entity_id = '$RUN_ID' AND action = 'finalize';")
MC_STATUS_AFTER_REJECT=$(echo "$MC_ROW_AFTER_REJECTED_CHECK" | cut -d'|' -f1)
MC_CHECKER_AFTER_REJECT=$(echo "$MC_ROW_AFTER_REJECTED_CHECK" | cut -d'|' -f2)
assert_eq "maker_checker_log is STILL 'pending' (not falsely flipped to approved by a finalize that failed)" "$MC_STATUS_AFTER_REJECT" "pending"
assert_eq "checker_id is still unset (no approval was committed)" "$MC_CHECKER_AFTER_REJECT" ""
RUN_STATUS_AFTER_REJECT=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN_ID';")
assert_eq "the run itself is still 'draft' (finalize genuinely did not happen)" "$RUN_STATUS_AFTER_REJECT" "draft"

echo
echo "=== 4. Clear the remaining gates: lock attendance, seed a completed validation run ==="
psqlc -c "
INSERT INTO attendance_period_locks (tenant_id, period_month, state, locked_by, locked_at)
VALUES ('$TENANT_ID', '$MONTH', 'LOCKED', '$MAKER_USER_ID', now());

INSERT INTO payroll_validation_runs (tenant_id, payroll_run_id, validation_month, status, is_payroll_blocked, error_count, completed_at)
VALUES ('$TENANT_ID', '$RUN_ID', '$MONTH', 'completed', false, 0, now());
"

echo
echo "=== 5. Checker retries finalize — every gate now passes, so it genuinely succeeds ==="
CHECKER_RETRY_RESP=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/payroll/runs/$RUN_ID/finalize" \
  -H "authorization: Bearer $CHECKER_TOKEN" -H 'content-type: application/json' -d '{}')
CHECKER_RETRY_STATUS=$(echo "$CHECKER_RETRY_RESP" | tail -1)
CHECKER_RETRY_BODY=$(echo "$CHECKER_RETRY_RESP" | sed '$d')
echo "  checker retry (attendance locked, validation cleared): HTTP $CHECKER_RETRY_STATUS — $CHECKER_RETRY_BODY"
assert_eq "checker retry succeeds (200) once every gate actually passes" "$CHECKER_RETRY_STATUS" "200"

RUN_STATUS_FINAL=$(psqlc -c "SELECT status FROM payroll_runs WHERE id = '$RUN_ID';")
assert_eq "the run is now genuinely finalized" "$RUN_STATUS_FINAL" "finalized"

MC_ROW_FINAL=$(psqlc -c "SELECT status || '|' || coalesce(checker_id::text,'') FROM maker_checker_log WHERE tenant_id = '$TENANT_ID' AND entity_id = '$RUN_ID' AND action = 'finalize';")
assert_eq "ONLY NOW does maker_checker_log flip to 'approved' — committed together with the real finalize" "$(echo "$MC_ROW_FINAL" | cut -d'|' -f1)" "approved"
assert_eq "checker_id correctly records the checker who actually caused the finalize to succeed" "$(echo "$MC_ROW_FINAL" | cut -d'|' -f2)" "$CHECKER_USER_ID"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
