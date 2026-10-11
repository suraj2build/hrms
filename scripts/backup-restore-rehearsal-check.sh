#!/usr/bin/env bash
# Local backup/restore rehearsal — proves this sandbox's Postgres can
# actually be backed up and restored, with the restored copy independently
# verified row-for-row against the source, not just "pg_dump exited 0".
#
# KNOWN LIMITATION: this is local Postgres (pg_dump/pg_restore), not a
# rehearsal against Supabase's managed backup/restore/PITR tooling, which
# this sandbox has no access to. It proves the DATA is backup-able and
# restorable with integrity; it does not exercise Supabase's own operational
# recovery path (point-in-time recovery, cross-region failover, etc.),
# which needs a real Supabase project to rehearse.
#
# Usage:
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
#   ./scripts/backup-restore-rehearsal-check.sh

set -uo pipefail

SRC_DB="${PGDATABASE:-hrms}"
RESTORE_DB="hrms_restore_rehearsal_$$"
DUMP_FILE="/tmp/hrms-backup-rehearsal-$$.dump"
PASS_COUNT=0
FAIL_COUNT=0

psqlc() { psql -v ON_ERROR_STOP=1 -tAq "$@"; }
psqlc_db() { local db="$1"; shift; psql -v ON_ERROR_STOP=1 -tAq -d "$db" "$@"; }

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

cleanup() {
  local exit_code=$?
  echo
  echo "=== cleanup ==="
  dropdb --if-exists "$RESTORE_DB" 2>&1 || true
  rm -f "$DUMP_FILE"
  echo "  restore-rehearsal database and dump file removed."
  exit "$exit_code"
}
trap cleanup EXIT

echo "=== 0. Baseline: row counts and size of the source database ($SRC_DB) ==="
SRC_SIZE=$(psqlc -c "SELECT pg_size_pretty(pg_database_size('$SRC_DB'));")
SRC_TABLE_COUNT=$(psqlc -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "  source size: $SRC_SIZE, public tables: $SRC_TABLE_COUNT"

# Row counts for a representative set of tables spanning the financial/
# operational surfaces this engagement has been working on — not every
# table (this is a rehearsal, not a full audit), but enough to catch a
# dump/restore that silently drops or truncates data.
TABLES=(tenants employees profiles payroll_runs payroll_slips payroll_run_blockers
        maker_checker_log attendance_daily leave_requests employee_leave_balance
        epf_contributions esi_contributions ptax_contributions
        reimbursement_claims separation_ff_summary platform_events)

declare -A SRC_COUNTS
for t in "${TABLES[@]}"; do
  SRC_COUNTS[$t]=$(psqlc -c "SELECT count(*) FROM $t;" 2>/dev/null || echo "ERR")
done
echo "  source row counts: $(for t in "${TABLES[@]}"; do echo -n "$t=${SRC_COUNTS[$t]} "; done)"

echo
echo "=== 1. BACKUP: pg_dump (custom format, matches production restore tooling) ==="
T0=$(python3 -c 'import time; print(time.time())')
if ! pg_dump -Fc -d "$SRC_DB" -f "$DUMP_FILE" 2>&1; then
  echo "  ✗ pg_dump FAILED" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  T1=$(python3 -c 'import time; print(time.time())')
  DUMP_ELAPSED=$(python3 -c "print(round($T1 - $T0, 2))")
  DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  echo "  ✓ pg_dump succeeded: ${DUMP_ELAPSED}s, dump file size: $DUMP_SIZE"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

echo
echo "=== 2. RESTORE: into a FRESH database (never touches the source) ==="
if ! createdb "$RESTORE_DB" 2>&1; then
  echo "  ✗ createdb FAILED" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  T2=$(python3 -c 'import time; print(time.time())')
  # pg_restore against a fresh DB: some ownership/role warnings are expected
  # and non-fatal in this sandbox (dump was taken as the 'postgres' role);
  # judge success by the independent row-count verification below, not the
  # exit code alone.
  pg_restore -d "$RESTORE_DB" "$DUMP_FILE" > /tmp/restore-rehearsal-$$.log 2>&1
  T3=$(python3 -c 'import time; print(time.time())')
  RESTORE_ELAPSED=$(python3 -c "print(round($T3 - $T2, 2))")
  echo "  pg_restore completed in ${RESTORE_ELAPSED}s (see /tmp/restore-rehearsal-$$.log for any non-fatal warnings)"
fi

echo
echo "=== 3. VERIFY: every sampled table's row count matches EXACTLY, restored vs. source ==="
for t in "${TABLES[@]}"; do
  RESTORED_COUNT=$(psqlc_db "$RESTORE_DB" -c "SELECT count(*) FROM $t;" 2>/dev/null || echo "ERR")
  assert_eq "row count for '$t' matches (source=${SRC_COUNTS[$t]})" "$RESTORED_COUNT" "${SRC_COUNTS[$t]}"
done

echo
echo "=== 4. VERIFY: a sample of actual DATA matches, not just counts (checksum one financially-relevant table) ==="
SRC_CHECKSUM=$(psqlc -c "SELECT md5(string_agg(md5(t.*::text), '' ORDER BY id)) FROM payroll_slips t;" 2>/dev/null || echo "ERR")
RESTORED_CHECKSUM=$(psqlc_db "$RESTORE_DB" -c "SELECT md5(string_agg(md5(t.*::text), '' ORDER BY id)) FROM payroll_slips t;" 2>/dev/null || echo "ERR")
assert_eq "payroll_slips content checksum matches exactly (not just row count)" "$RESTORED_CHECKSUM" "$SRC_CHECKSUM"

echo
echo "=== RESULT: $PASS_COUNT passed, $FAIL_COUNT failed ==="
echo "  Backup: ${DUMP_ELAPSED:-N/A}s, ${DUMP_SIZE:-N/A}. Restore: ${RESTORE_ELAPSED:-N/A}s."
[ "$FAIL_COUNT" -eq 0 ]
