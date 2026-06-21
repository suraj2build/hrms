# HRMS Correctness Audit — Leave · Attendance · Compliance

_Read-only audit, 2026-06. Same methodology as the prior payroll audit. P0 = data
corruption / wrong pay / legal-filing / security._

## Cross-cutting root causes
Two families recur across all three modules (the same ones fixed in payroll):
1. **Timezone (UTC vs tenant-local)** — date boundaries taken from raw UTC instead of
   the tenant timezone, misfiling punches/leave near local midnight.
2. **SSOT / idempotency drift** — ledger vs cache, stale rows, missing dedupe.

---

## LEAVE

### P0-1 — Canonical approval writes no ledger debit + silent-clamp deduct
`apps/api/src/lib/approval-service.ts:206-219` → RPC `approve_leave_request_atomic`
(`supabase/migrations/042_approval_transactions.sql:77-85`) deducts via
`GREATEST(0, balance - days)` and writes no `leave_accrual_ledger` consumption row.
Hardened sibling path exists only on legacy `leave_applications`
(`routes/attendance/leave.ts:376-393`, `:498-511`, using `checked_deduct_leave_balance`
from migration 269). Migration 280 made `leave_requests` canonical → every modern-UI
approval drifts ledger≠cache and can silently over-draw.
**Fix:** point approval at `checked_deduct_leave_balance` + dual-write `consumption`
row (onConflict `tenant_id,accrual_type,source_request_id`), atomic with status update.

### P0-2 — Monthly/quarterly accrual double-credits the cache (non-idempotent)
`leave-jobs.ts:369-380` calls `creditEmployeeDays` then `writeLedgerEntry`.
`leave-entitlement-service.ts:257-298` is read-add-write with no cycle guard; ledger
write is idempotent on `cycle_key` but the cache write is not. Re-run → extra paid leave.
**Fix:** gate `creditEmployeeDays` on the ledger row actually inserting, or derive cache
from ledger via `recompute_leave_balance`.

### P1
- No balance-restore path when an approved `leave_requests` is reversed
  (`leave-request-service.ts:601-653`, `approval-service.ts:297`).
- ESS recomputes duration from raw dates (`EssLeaveBalance.tsx:234-238`).
- Overlap check not scoped to leave type/session (`leave-request-service.ts:382-401`).
- Weekend detection hard-coded Sat/Sun UTC (`leave-request-service.ts:425-430`).
- `count_only` filters non-existent `start_date`/`end_date` (`leave-requests.ts:215-216`).

---

## ATTENDANCE

### P0-1 — Corrections silently overwrite LOCKED/FINALIZED periods
`routes/attendance/corrections.ts:488-594` (approve), `:603-723` (retry),
`correction-processor.ts:47-49,276-300` — no `assertRangeOpen`/lock check. DB trigger
`262_attendance_period_lock_enforcement.sql:57-62` covers only `attendance_daily` +
`PAYROLL_FINALIZED`. **Fix:** add lock guard in route + worker; extend 262 trigger to
`attendance_punch_logs` and to `LOCKED`/`PAYROLL_PROCESSING`.

### P0-2 — Manual punch derives wrong calendar date (UTC not tenant-local)
`routes/attendance/punch.ts:98,153` — `new Date(punchedAt).toISOString().slice(0,10)`.
**Fix:** resolve `tenants.timezone`, use `utcToLocalDate` (mirror `upload.ts`).

### P0-3 — Batch processor uses UTC day boundaries
`lib/attendance-processor.ts:486-487` — `${date}T00:00:00.000Z`. **Fix:** `localToUtc`.

### P0-4 — No unique constraint on `attendance_raw_logs`; api-sources upsert broken
`019_attendance.sql:32-48` (no unique idx); `ingest.ts:61-63` plain insert;
`api-sources.ts:240-257` upsert references non-existent `source_id` col / index.
**Fix:** add unique index `(tenant_id, employee_code, timestamp, direction)`; dedupe ingest.

### P1
- Two divergent `attendance_daily` writers (engine vs processor).
- Anomaly resolve marks fixed even when recompute failed (`anomalies.ts:524-548`).
- Reconcile auto-resolves with no confidence gate (`anomaly-reconcile.ts:146-203`).
- TOCTOU/advisory races in correction apply.
- `inference.ts:56,122` selects non-existent columns → 500.
- UTC "today"/month in real-time read endpoints (`context.ts`, `who-is-in.ts`).

---

## COMPLIANCE / STATUTORY

### P0-1 — Stale contribution rows on re-finalize → over-remit (ESI/PTax/LWF)
`esi.ts:429-480`, `ptax.ts:542-593`, `lwf.ts:324-367` — upsert filtered eligible set,
no delete. Employee turned exempt keeps phantom liability. EPF safer (writes zero-rows).
**Fix:** delete-then-insert for the month (or full-set upsert with zeros).

### P0-2 — TDS recovery writes columns the reader never reads
`tds-recovery.ts:367,371` (write `tax_deducted_prior`/`monthly_recovery_amount`) vs
`:84,88` (read `tax_already_deducted`/`monthly_recovery`). **Fix:** align names.

### P0-3 — TDS recovery default FY uses calendar year (Jan–Mar mislabeled)
`tds-recovery.ts:216,254`. **Fix:** reuse `currentFinancialYear()`.

### P0-4 — IT statement vs recovery disagree on slip-status set
`it-statement.ts:79` (`finalized`) vs `tds-recovery.ts:318` (`processed/finalized/paid`).

### P0-5 — `remainingMonthsInFY` ignores requested FY (historical FY dumps into one month)
`it-statement.ts:34-42`, `tax-computation-engine.ts:414`.

### P1
- `payroll_run_id` never populated on contribution rows.
- PTax ignores `ptax_state_settings.enabled` (`ptax.ts:507-528`).
- ESI continuation differs slip vs filing (`esi.ts:444-471` vs `statutory-payroll.ts:135`).
- ESI rounds 2dp, not round-up-to-rupee (`esi-engine.ts:80-86`).
- TDS recovery slip-fallback no status filter (`tds-recovery.ts:122-130`).
- No negative-amount CHECK on contribution tables.

---

## Recommended fix order
1. Leave P0-1, P0-2 — live integrity hole on every approval.
2. Attendance P0-1, P0-2/3, P0-4 — wrong pay + sealed-month protection.
3. Compliance P0-1, TDS/IT cluster — filing/legal correctness.
