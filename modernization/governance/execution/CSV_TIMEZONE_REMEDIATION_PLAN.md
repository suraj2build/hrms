# CSV Timezone Bug — Historical Data Remediation Plan

**Document type:** Pre-execution remediation plan  
**Status:** PLANNING ONLY — no migration to be executed without explicit sign-off  
**Bug reference:** ATTENDANCE_MODULE_AUDIT.md → Section 3.1 (Critical Runtime Issue #2)  
**Fix deployed:** `upload.ts` — `buildTimestamp()` replaced with `localToUtc()` (see git history)  
**Date:** 2026-05-11  
**Author:** Engineering  

---

## Background

`buildTimestamp()` in `upload.ts` appended `.000Z` directly to CSV date+time values, treating
tenant-local times as UTC. For a tenant with timezone `Asia/Kolkata` (UTC+5:30), every punch
stored via CSV upload was timestamped **5 hours 30 minutes later** than the actual event.

**Concrete impact for a 09:00–18:00 IST shift:**

| Value | Correct UTC | Stored UTC (wrong) |
|---|---|---|
| IN punch at 09:00 IST | 03:30 | **09:00** |
| OUT punch at 18:00 IST | 12:30 | **18:00** |
| Engine query window | 01:30 – 16:30 | same |
| OUT punch found by engine? | ✅ yes | ❌ no — 18:00 outside window |
| Computed duration | 9 h | **3.5 h** (fallback to shift-end) |
| Status | present | **half\_day or absent** |
| Late minutes | 0 | **315 min** |

Employees with CSV-imported attendance may have been incorrectly marked absent/half-day, incurring
wrong LOP deductions and wrong payroll payable-days.

---

## Critical Pre-condition: Source Constraint Verification

**Before any correction work begins, the following must be verified first.**

The `attendance_punch_logs.source` column has a CHECK constraint (migration `043_attendance_punch_logs.sql`):

```sql
CHECK (source IN ('device', 'manual', 'mobile', 'web', 'kiosk', 'regularisation'))
```

`csv_upload` is **not in this list**. No later migration adds it (verified by grep across all
112 migration files).

PostgreSQL enforces CHECK constraints regardless of role, including the Supabase service role.
If this constraint was never relaxed, every CSV upload attempt would have returned HTTP 500
(`INSERT_FAILED`) and **zero rows would have been inserted** — meaning historical data impact
may be zero.

**This must be confirmed before scheduling any correction work.**

### Verification query (run in Supabase SQL editor, read-only):

```sql
-- Step 0a: Check if csv_upload source rows exist at all
SELECT
  source,
  COUNT(*)           AS row_count,
  MIN(created_at)    AS earliest,
  MAX(created_at)    AS latest
FROM attendance_punch_logs
WHERE source = 'csv_upload'
GROUP BY source;

-- Step 0b: Check what source values actually exist in the table
SELECT source, COUNT(*) AS row_count
FROM attendance_punch_logs
GROUP BY source
ORDER BY row_count DESC;

-- Step 0c: Check the current constraint definition
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'attendance_punch_logs'::regclass
  AND contype = 'c';
```

**Outcomes:**

| Result | Meaning | Action |
|---|---|---|
| Zero rows with `source = 'csv_upload'` | CSV uploads were blocked by constraint — no historical data to correct | Deploy constraint migration only (see Section 2, Phase 0). Historical correction skipped. |
| Rows exist with `source = 'csv_upload'` | Constraint was relaxed or bypassed at some point | Proceed with full remediation plan. |
| Constraint shows `csv_upload` already present | A migration exists that was not found | Update constraint fix to match existing definition. |

---

## Scope of Impact

Before executing any correction, establish the full scope using the following read-only queries.

### Scope query 1: Affected tenants

```sql
-- Tenants with non-UTC timezone that have csv_upload punches
SELECT
  t.id                    AS tenant_id,
  t.name                  AS tenant_name,
  t.timezone,
  COUNT(p.id)             AS affected_punch_count,
  COUNT(DISTINCT p.employee_id) AS affected_employees,
  MIN(p.punched_at)       AS earliest_affected_punch,
  MAX(p.punched_at)       AS latest_affected_punch
FROM tenants t
JOIN attendance_punch_logs p ON p.tenant_id = t.id
WHERE p.source = 'csv_upload'
  AND t.timezone != 'UTC'
  AND t.timezone != ''
GROUP BY t.id, t.name, t.timezone
ORDER BY affected_punch_count DESC;
```

### Scope query 2: Affected months per tenant

```sql
-- Which calendar months are affected, and are any payroll-finalised?
SELECT
  p.tenant_id,
  t.timezone,
  TO_CHAR(DATE_TRUNC('month',
    (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
  ), 'YYYY-MM')              AS local_month,
  apl.state                  AS period_lock_state,
  COUNT(p.id)                AS punch_count,
  COUNT(DISTINCT p.employee_id) AS employee_count
FROM attendance_punch_logs p
JOIN tenants t ON t.id = p.tenant_id
LEFT JOIN attendance_period_locks apl
  ON apl.tenant_id = p.tenant_id
  AND apl.period_month = TO_CHAR(DATE_TRUNC('month',
    (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
  ), 'YYYY-MM')
WHERE p.source = 'csv_upload'
  AND t.timezone != 'UTC'
GROUP BY p.tenant_id, t.timezone, local_month, apl.state
ORDER BY p.tenant_id, local_month;
```

### Scope query 3: Status-level damage assessment

```sql
-- For affected employees and dates, compare current attendance_daily status
-- against what it should be (use as a decision input, not for automated correction)
SELECT
  p.tenant_id,
  p.employee_id,
  -- Corrected date in tenant local time
  DATE(
    (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
  )                                           AS correct_local_date,
  -- Current stored date (the wrong date, if offset causes a midnight crossing)
  DATE(p.punched_at AT TIME ZONE 'UTC')       AS stored_utc_date,
  p.direction,
  p.punched_at                                AS stored_punched_at,
  -- What the timestamp SHOULD be
  (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone AS corrected_punched_at,
  ad.status                                   AS current_daily_status
FROM attendance_punch_logs p
JOIN tenants t ON t.id = p.tenant_id
LEFT JOIN attendance_daily ad
  ON ad.tenant_id  = p.tenant_id
  AND ad.employee_id = p.employee_id
  AND ad.date = DATE(
    (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
  )
WHERE p.source = 'csv_upload'
  AND t.timezone != 'UTC'
ORDER BY p.tenant_id, p.employee_id, stored_punched_at;
```

---

## 1. Impacted Data Identification Strategy

### 1.1 Primary identification

Affected rows are those satisfying ALL of:
- `attendance_punch_logs.source = 'csv_upload'`
- Tenant's `tenants.timezone != 'UTC'` (UTC tenants stored correctly)
- `created_at >= [date upload.ts was first deployed]` (upper-bound verification)

### 1.2 Correct UTC timestamp formula

The stored `punched_at` is the local wall-clock time mislabelled as UTC. The correct UTC
timestamp is derived by:

```sql
-- Reinterpret the stored timestamp as local time and convert to real UTC
corrected_at = (punched_at AT TIME ZONE 'UTC') AT TIME ZONE tenant_timezone
```

This uses PostgreSQL's double-AT TIME ZONE pattern:
1. `AT TIME ZONE 'UTC'` strips the UTC offset, returning a naive timestamp (the wall clock reading)
2. `AT TIME ZONE tenant_timezone` interprets that naive timestamp as a local time and returns
   the correct UTC TIMESTAMPTZ

**This formula is DST-aware.** For non-DST timezones (IST, SGT, etc.) the offset is constant.
For DST-affected zones, PostgreSQL uses the DST rules in effect at the time of the punch.

### 1.3 Date-crossing detection

After correction, some punches will land on a different calendar date. This must be identified
because the affected `attendance_daily` rows differ from the currently-affected rows.

```sql
-- Punches whose corrected timestamp crosses a calendar day boundary
SELECT
  p.id,
  p.employee_id,
  p.punched_at,
  DATE(p.punched_at AT TIME ZONE 'UTC')                              AS stored_date,
  DATE((p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)   AS corrected_date
FROM attendance_punch_logs p
JOIN tenants t ON t.id = p.tenant_id
WHERE p.source = 'csv_upload'
  AND t.timezone != 'UTC'
  AND DATE(p.punched_at AT TIME ZONE 'UTC')
   != DATE((p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone);
```

### 1.4 Collision detection

After correction, the new `(tenant_id, employee_id, corrected_at, direction)` must be checked
against the unique index. A collision means a device/manual punch already exists at the corrected
timestamp. This is rare but must be handled explicitly.

```sql
-- Detect collisions: corrected timestamp would collide with an existing punch
SELECT
  p.id                    AS csv_punch_id,
  p.employee_id,
  p.punched_at            AS stored_wrong,
  (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone AS corrected_at,
  existing.id             AS colliding_punch_id,
  existing.source         AS colliding_source
FROM attendance_punch_logs p
JOIN tenants t ON t.id = p.tenant_id
JOIN attendance_punch_logs existing
  ON  existing.tenant_id   = p.tenant_id
  AND existing.employee_id = p.employee_id
  AND existing.direction   = p.direction
  AND existing.punched_at  =
      (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
  AND existing.id != p.id
WHERE p.source = 'csv_upload'
  AND t.timezone != 'UTC';
```

### 1.5 Period-lock classification

Every affected punch must be classified by the lock state of its period:

| Period state | Correction allowed? | Action |
|---|---|---|
| `OPEN` | Yes | Correct in Phase 2 |
| `LOCKED` | Yes, with HR approval | Correct in Phase 3 |
| `PAYROLL_PROCESSING` | No — wait | Hold until processing completes |
| `PAYROLL_FINALIZED` | No — requires executive decision | Defer to Phase 4 |
| No lock row (null) | Same as `OPEN` | Correct in Phase 2 |

---

## 2. Safe Migration Sequence

### Phase 0 — Prerequisites (no data changes)

**P0.1 — Add `csv_upload` to the source CHECK constraint.**

If the constraint does not already include `csv_upload`, deploy this migration first. Without it,
no CSV upload has ever inserted a row, and the correction phases are a no-op. Deploy the
constraint fix regardless — it is required for the upload feature to function.

```sql
-- supabase/migrations/113_punch_logs_csv_source.sql
-- Add 'csv_upload' to attendance_punch_logs source constraint.
-- Required before CSV upload feature can insert any rows.

ALTER TABLE attendance_punch_logs
  DROP CONSTRAINT IF EXISTS attendance_punch_logs_source_check;

ALTER TABLE attendance_punch_logs
  ADD CONSTRAINT attendance_punch_logs_source_check
  CHECK (source IN (
    'device', 'manual', 'mobile', 'web',
    'kiosk', 'regularisation', 'csv_upload'
  ));
```

**P0.2 — Create the correction tracking table.**

This table is the audit backbone for all correction phases. It records every intended correction
before any punch is modified. It is additive (never deleted from) and serves as the rollback
source of truth.

```sql
-- supabase/migrations/114_punch_tz_correction_log.sql
-- Immutable correction log for the CSV timezone remediation.
-- One row per punch that requires correction.
-- Never updated after insert — status progression is append-only via correction_events.

CREATE TABLE IF NOT EXISTS punch_tz_correction_log (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id       UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punch_id          UUID          NOT NULL REFERENCES attendance_punch_logs(id) ON DELETE CASCADE,

  -- Timestamps
  original_punched_at   TIMESTAMPTZ NOT NULL,   -- what was stored (wrong)
  corrected_punched_at  TIMESTAMPTZ NOT NULL,   -- what it should be

  -- Date impact
  original_local_date   DATE        NOT NULL,   -- date in tenant TZ using original ts
  corrected_local_date  DATE        NOT NULL,   -- date in tenant TZ using corrected ts
  date_crosses_midnight BOOLEAN     NOT NULL DEFAULT false,

  -- Period classification at time of planning
  period_month          TEXT        NOT NULL,   -- YYYY-MM of the corrected date
  period_lock_state     TEXT        NOT NULL DEFAULT 'OPEN',

  -- Correction lifecycle
  -- planned    = recorded but not yet applied
  -- dry_run    = validated in dry run, no changes made
  -- applied    = punched_at updated in punch_logs
  -- rolled_back = correction reversed
  -- skipped    = collision detected — not applied (existing punch takes precedence)
  -- deferred   = period is PAYROLL_FINALIZED — requires executive approval
  correction_status     TEXT        NOT NULL DEFAULT 'planned'
    CHECK (correction_status IN (
      'planned', 'dry_run', 'applied', 'rolled_back', 'skipped', 'deferred'
    )),

  -- Collision: a non-csv punch already exists at corrected_punched_at
  has_collision         BOOLEAN     NOT NULL DEFAULT false,
  collision_punch_id    UUID        NULL,

  -- Recompute tracking
  recompute_queued      BOOLEAN     NOT NULL DEFAULT false,
  recompute_completed   BOOLEAN     NOT NULL DEFAULT false,
  recompute_completed_at TIMESTAMPTZ NULL,

  -- Audit
  planned_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at            TIMESTAMPTZ NULL,
  applied_by            TEXT        NOT NULL DEFAULT 'system',  -- 'system' or user email
  notes                 TEXT        NULL,

  UNIQUE (punch_id)  -- one correction plan row per punch, ever
);

CREATE INDEX IF NOT EXISTS idx_ptcl_tenant_status
  ON punch_tz_correction_log (tenant_id, correction_status);

CREATE INDEX IF NOT EXISTS idx_ptcl_period
  ON punch_tz_correction_log (tenant_id, period_month, correction_status);

CREATE INDEX IF NOT EXISTS idx_ptcl_employee
  ON punch_tz_correction_log (employee_id, corrected_local_date);

ALTER TABLE punch_tz_correction_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ptcl_hr_all ON punch_tz_correction_log FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
```

**P0.3 — Populate the correction log (dry run, no punch changes).**

This statement scans all affected punches and inserts planned corrections. It is idempotent
(uses `ON CONFLICT DO NOTHING`) and safe to re-run.

```sql
INSERT INTO punch_tz_correction_log (
  tenant_id, employee_id, punch_id,
  original_punched_at, corrected_punched_at,
  original_local_date, corrected_local_date, date_crosses_midnight,
  period_month, period_lock_state,
  correction_status, has_collision, collision_punch_id
)
SELECT
  p.tenant_id,
  p.employee_id,
  p.id                                                                   AS punch_id,
  p.punched_at                                                           AS original_punched_at,
  (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone              AS corrected_punched_at,
  DATE(p.punched_at AT TIME ZONE 'UTC')                                  AS original_local_date,
  DATE((p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)        AS corrected_local_date,
  DATE(p.punched_at AT TIME ZONE 'UTC')
    != DATE((p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone)   AS date_crosses_midnight,
  TO_CHAR(
    DATE_TRUNC('month',
      (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
    ), 'YYYY-MM'
  )                                                                       AS period_month,
  COALESCE(apl.state, 'OPEN')                                            AS period_lock_state,
  CASE
    WHEN COALESCE(apl.state, 'OPEN') = 'PAYROLL_FINALIZED' THEN 'deferred'
    ELSE 'planned'
  END                                                                     AS correction_status,
  (collision.id IS NOT NULL)                                             AS has_collision,
  collision.id                                                           AS collision_punch_id
FROM attendance_punch_logs p
JOIN tenants t
  ON t.id = p.tenant_id
LEFT JOIN attendance_period_locks apl
  ON  apl.tenant_id    = p.tenant_id
  AND apl.period_month = TO_CHAR(
        DATE_TRUNC('month',
          (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
        ), 'YYYY-MM'
      )
LEFT JOIN attendance_punch_logs collision
  ON  collision.tenant_id   = p.tenant_id
  AND collision.employee_id = p.employee_id
  AND collision.direction   = p.direction
  AND collision.punched_at  =
      (p.punched_at AT TIME ZONE 'UTC') AT TIME ZONE t.timezone
  AND collision.id != p.id
WHERE p.source   = 'csv_upload'
  AND t.timezone != 'UTC'
ON CONFLICT (punch_id) DO NOTHING;
```

After running, inspect the plan before proceeding:

```sql
-- Review correction plan summary before touching any punch
SELECT
  correction_status,
  period_lock_state,
  has_collision,
  date_crosses_midnight,
  COUNT(*)          AS punch_count,
  COUNT(DISTINCT employee_id) AS employees
FROM punch_tz_correction_log
GROUP BY correction_status, period_lock_state, has_collision, date_crosses_midnight
ORDER BY correction_status, period_lock_state;
```

**Do not proceed to Phase 1 until this summary has been reviewed and signed off by the
engineering lead and an HR admin.**

---

### Phase 1 — Dry Run Validation (no data changes)

Mark all `planned` corrections as `dry_run` and validate the expected outcome against
`attendance_daily` without touching any rows.

```sql
-- Update status to dry_run (still no punch changes)
UPDATE punch_tz_correction_log
SET correction_status = 'dry_run'
WHERE correction_status = 'planned';
```

Then run the impact preview:

```sql
-- Show before/after status for every affected employee-date
SELECT
  c.tenant_id,
  c.employee_id,
  c.corrected_local_date          AS date_to_recompute,
  c.period_month,
  c.period_lock_state,
  ad_current.status               AS current_status,
  ad_current.work_hours           AS current_work_hours,
  ad_current.late_minutes         AS current_late_minutes,
  ad_current.is_payable           AS current_is_payable,
  ad_current.day_fraction         AS current_day_fraction,
  -- What status will be after recompute cannot be determined here without running
  -- the engine. Flag these employee-dates for post-correction validation.
  c.has_collision,
  c.date_crosses_midnight,
  COUNT(c.id)                     AS affected_punches
FROM punch_tz_correction_log c
LEFT JOIN attendance_daily ad_current
  ON  ad_current.tenant_id  = c.tenant_id
  AND ad_current.employee_id = c.employee_id
  AND ad_current.date        = c.corrected_local_date
WHERE c.correction_status = 'dry_run'
GROUP BY
  c.tenant_id, c.employee_id, c.corrected_local_date,
  c.period_month, c.period_lock_state,
  ad_current.status, ad_current.work_hours, ad_current.late_minutes,
  ad_current.is_payable, ad_current.day_fraction,
  c.has_collision, c.date_crosses_midnight
ORDER BY c.tenant_id, c.employee_id, c.corrected_local_date;
```

**Dry run pass/fail criteria:**

| Check | Expected | Action if Fails |
|---|---|---|
| `correction_status = 'dry_run'` count matches Phase 0 `planned` count | Equal | Investigate discrepancy before proceeding |
| `has_collision = true` rows | Known and reviewed | Decide on collision resolution for each (see Section 3) |
| `date_crosses_midnight = true` rows | Known and reviewed | Confirm next-day recompute is in scope |
| `period_lock_state = 'PAYROLL_FINALIZED'` rows | All have `correction_status = 'deferred'` | Confirm deferred rows excluded from Phases 2–3 |
| Affected employee count | Matches business expectation | If count is unexpected (too high or too low), STOP and investigate |

---

### Phase 2 — Apply Corrections to OPEN Periods

**Applies to:** `correction_status = 'dry_run'` AND `period_lock_state IN ('OPEN', null)`
AND `has_collision = false`

Execute as a single transaction. If the transaction fails for any reason, it rolls back
atomically — no partial state.

```sql
BEGIN;

-- Step 1: Apply timestamp corrections
UPDATE attendance_punch_logs apl
SET   punched_at = c.corrected_punched_at
FROM  punch_tz_correction_log c
WHERE apl.id               = c.punch_id
  AND c.correction_status  = 'dry_run'
  AND c.period_lock_state  IN ('OPEN')
  AND c.has_collision      = false;

-- Step 2: Mark corrections as applied
UPDATE punch_tz_correction_log
SET   correction_status = 'applied',
      applied_at        = now(),
      applied_by        = 'system:phase2_open'
WHERE correction_status  = 'dry_run'
  AND period_lock_state  IN ('OPEN')
  AND has_collision      = false;

-- Step 3: Handle collisions — the csv punch is the wrong one; delete it
-- (the device/manual punch at the corrected time is the authoritative record)
DELETE FROM attendance_punch_logs
WHERE id IN (
  SELECT punch_id FROM punch_tz_correction_log
  WHERE correction_status = 'dry_run'
    AND period_lock_state IN ('OPEN')
    AND has_collision = true
);

UPDATE punch_tz_correction_log
SET   correction_status = 'skipped',
      notes             = 'Collision: authoritative punch exists at corrected timestamp; csv punch deleted',
      applied_at        = now(),
      applied_by        = 'system:phase2_open'
WHERE correction_status = 'dry_run'
  AND period_lock_state IN ('OPEN')
  AND has_collision = true;

-- Verify row counts before committing
-- Run this SELECT inside the transaction and inspect results:
SELECT correction_status, COUNT(*) FROM punch_tz_correction_log
WHERE period_lock_state IN ('OPEN')
GROUP BY correction_status;

-- If counts look correct: COMMIT
-- If anything is wrong:   ROLLBACK
COMMIT;
```

**After commit:** proceed to Section 6 (Recompute Strategy) for all `applied` rows.

---

### Phase 3 — Apply Corrections to LOCKED Periods

**Gate:** Requires written approval from HR admin before executing.
**Reason:** Locked periods have completed attendance review but payroll has not run.
Correcting punches here is safe but may change attendance status that HR already reviewed.

The HR admin must confirm:
- They have reviewed the dry-run impact preview for LOCKED periods
- They accept that attendance status for affected employees may change
- They will re-review attendance for affected employees after recompute

The execution is identical to Phase 2, substituting `period_lock_state = 'LOCKED'`.

After recompute (Section 6), if any employee's status changed from `present` to `absent` or
vice versa, HR must re-approve before the period progresses to `PAYROLL_PROCESSING`.

---

### Phase 4 — Deferred: PAYROLL_FINALIZED Periods

**Do not execute Phase 4 without explicit executive sign-off.**

Rows with `correction_status = 'deferred'` represent punches in periods where payroll has
already been finalized and paid. Correcting these requires:

1. **Payroll impact assessment** — Run Section 5 queries to determine which employees would
   have different LOP days, payable days, and net pay.
2. **Executive decision** — Confirm whether arrear adjustments will be issued.
3. **Arrear engine coordination** — If corrections result in underpayment (employee was wrongly
   marked absent), the arrear engine must generate catch-up payments.
4. **Regulatory consideration** — Statutory deductions (PF, ESI, TDS, PT) based on wrong
   attendance may need amended filings.
5. **Period unlock** — HR admin must unlock the period (`PAYROLL_FINALIZED → OPEN`), which
   requires logging the unlock reason.

**The correction SQL for Phase 4 is the same as Phase 2**, but must only run after
the above governance steps are complete and documented.

---

## 3. Rollback Approach

### Rollback scope

Because `punch_tz_correction_log` records `original_punched_at` before any change, rollback is
straightforward for all phases.

### Phase 2 / Phase 3 rollback

```sql
BEGIN;

-- Restore original timestamps
UPDATE attendance_punch_logs apl
SET   punched_at = c.original_punched_at
FROM  punch_tz_correction_log c
WHERE apl.id              = c.punch_id
  AND c.correction_status = 'applied'
  AND c.period_lock_state IN ('OPEN', 'LOCKED');  -- scope to the phase being rolled back

-- Mark as rolled back
UPDATE punch_tz_correction_log
SET   correction_status = 'rolled_back',
      notes             = COALESCE(notes, '') || ' | Rolled back at ' || now()::text
WHERE correction_status = 'applied'
  AND period_lock_state IN ('OPEN', 'LOCKED');

COMMIT;
```

After rollback, re-run recomputes for the affected dates (Section 6) to restore
`attendance_daily` to its pre-correction state.

### Collision-deleted rows

If `has_collision = true` rows had their CSV punch deleted in Phase 2, those deletions
**cannot be automatically reversed** — the row is gone. These are tracked in
`punch_tz_correction_log` with `correction_status = 'skipped'` and `notes` describing
the collision. If needed, the correct punch (same employee, direction, corrected timestamp)
already exists in the table (the collision punch), so attendance recompute is unaffected.

### What rollback does NOT restore

- `attendance_daily` rows — these are always recomputed and have no memory of pre-correction state.
  Recompute after rollback restores them.
- `attendance_audit_log` rows written during recompute — these are immutable.
  Pre-correction entries are preserved; post-correction entries are additive.
- `punch_tz_correction_log` rows — intentionally immutable. The log is always preserved for audit.

---

## 4. Validation Steps

### 4.1 Pre-execution validation (before Phase 2)

Run all queries in Section 1 and confirm:
- [ ] Total affected punch count is non-zero (if zero, no correction needed)
- [ ] All `deferred` rows (PAYROLL_FINALIZED) are excluded from Phase 2 scope
- [ ] Collision count is known and reviewed
- [ ] Date-crossing count is known and recompute scope includes next-day dates
- [ ] No punch in `PAYROLL_PROCESSING` state is in scope (wait for processing to complete first)

### 4.2 Post-Phase 2 validation

```sql
-- 1. Confirm all OPEN-period corrections are applied (no dry_run rows remain for OPEN)
SELECT correction_status, COUNT(*)
FROM punch_tz_correction_log
WHERE period_lock_state = 'OPEN'
GROUP BY correction_status;
-- Expected: only 'applied' and 'skipped'

-- 2. Confirm no punch still has the wrong timestamp
-- (This should return 0 rows after correction)
SELECT COUNT(*) AS remaining_wrong_punches
FROM attendance_punch_logs p
JOIN tenants t ON t.id = p.tenant_id
WHERE p.source = 'csv_upload'
  AND t.timezone != 'UTC'
  AND p.punched_at NOT IN (
    SELECT corrected_punched_at FROM punch_tz_correction_log
    WHERE punch_id = p.id
      AND correction_status = 'applied'
  );

-- 3. Confirm unique constraint is intact (no duplicate punches)
SELECT tenant_id, employee_id, punched_at, direction, COUNT(*)
FROM attendance_punch_logs
GROUP BY tenant_id, employee_id, punched_at, direction
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 4. Confirm attendance_daily recompute completed
SELECT
  c.tenant_id,
  c.corrected_local_date,
  COUNT(c.id)                      AS corrected_punch_count,
  SUM(CASE WHEN c.recompute_completed THEN 1 ELSE 0 END) AS recompute_done_count
FROM punch_tz_correction_log c
WHERE c.correction_status = 'applied'
GROUP BY c.tenant_id, c.corrected_local_date
HAVING COUNT(c.id) != SUM(CASE WHEN c.recompute_completed THEN 1 ELSE 0 END);
-- Expected: 0 rows (all recomputes completed)
```

### 4.3 Attendance outcome validation (sample check)

For a sample of affected employees, manually verify that:
1. `attendance_daily.status` for corrected dates is `present` or `late` (not `absent` or `half_day`)
2. `late_minutes` is ≤ policy grace period for on-time employees
3. `work_hours` reflects the actual shift duration (e.g., ~9h for a 9h shift)

```sql
-- Sample: 10 affected employees, compare before and after
-- (Run before Phase 2 and save results; run again after recompute and compare)
SELECT
  e.employee_code,
  ad.date,
  ad.status,
  ad.work_hours,
  ad.late_minutes,
  ad.is_payable,
  ad.day_fraction
FROM attendance_daily ad
JOIN employees e ON e.id = ad.employee_id
WHERE ad.employee_id IN (
  SELECT DISTINCT employee_id FROM punch_tz_correction_log
  WHERE correction_status = 'applied'
  LIMIT 10
)
ORDER BY e.employee_code, ad.date;
```

### 4.4 Retroactive impact record

Insert rows into `attendance_retroactive_impacts` for every employee-date corrected,
so downstream systems (payroll variance, leave balance reconciliation) have a signal:

```sql
INSERT INTO attendance_retroactive_impacts (
  tenant_id, employee_id, affected_date,
  trigger_source, trigger_id,
  impact_types,
  before_status, after_status,
  impact_explanation,
  propagation_status
)
SELECT DISTINCT ON (c.tenant_id, c.employee_id, c.corrected_local_date)
  c.tenant_id,
  c.employee_id,
  c.corrected_local_date,
  'attendance_recompute',
  'csv_timezone_remediation',
  ARRAY['payroll', 'variance']::TEXT[],
  ad_before.status,
  ad_after.status,
  'CSV timezone bug remediation: punch timestamps corrected from UTC to tenant local time',
  'detected'
FROM punch_tz_correction_log c
LEFT JOIN attendance_daily ad_before
  ON  ad_before.tenant_id  = c.tenant_id
  AND ad_before.employee_id = c.employee_id
  AND ad_before.date        = c.corrected_local_date
LEFT JOIN attendance_daily ad_after
  ON  ad_after.tenant_id  = c.tenant_id
  AND ad_after.employee_id = c.employee_id
  AND ad_after.date        = c.corrected_local_date
WHERE c.correction_status = 'applied'
ON CONFLICT DO NOTHING;
```

---

## 5. Payroll Coordination Requirements

### 5.1 Month classification by payroll risk

```sql
-- Classify affected months by payroll exposure
SELECT
  c.tenant_id,
  c.period_month,
  c.period_lock_state,
  pr.status                         AS payroll_run_status,
  pr.id                             AS payroll_run_id,
  COUNT(DISTINCT c.employee_id)     AS affected_employees,
  SUM(
    CASE WHEN ad.status = 'absent' AND ad.is_payable = false THEN 1 ELSE 0 END
  )                                 AS current_absent_days,  -- may have been wrong
  pr.total_lop_amount               AS payroll_total_lop_amount
FROM punch_tz_correction_log c
JOIN attendance_daily ad
  ON  ad.tenant_id  = c.tenant_id
  AND ad.employee_id = c.employee_id
  AND ad.date        = c.corrected_local_date
LEFT JOIN payroll_runs pr
  ON  pr.tenant_id = c.tenant_id
  AND pr.month     = c.period_month
GROUP BY c.tenant_id, c.period_month, c.period_lock_state, pr.status, pr.id, pr.total_lop_amount
ORDER BY c.tenant_id, c.period_month;
```

### 5.2 LOP delta estimate

Before running payroll recomputation for corrected months, estimate the LOP change per employee:

```sql
-- Estimated LOP reduction per employee per month
-- (employees who were wrongly marked absent and will now be marked present)
SELECT
  c.tenant_id,
  c.employee_id,
  c.period_month,
  COUNT(DISTINCT c.corrected_local_date)       AS dates_affected,
  SUM(
    CASE WHEN ad.status IN ('absent') AND ad.is_payable = false
    THEN 1 ELSE 0 END
  )                                            AS current_lop_days_from_csv_dates,
  -- After correction, these days should become present → LOP reduction
  -- Exact value determined after recompute
  'recompute required'                         AS corrected_lop_days
FROM punch_tz_correction_log c
JOIN attendance_daily ad
  ON  ad.tenant_id  = c.tenant_id
  AND ad.employee_id = c.employee_id
  AND ad.date        = c.corrected_local_date
WHERE c.correction_status IN ('applied', 'dry_run')
GROUP BY c.tenant_id, c.employee_id, c.period_month
HAVING SUM(CASE WHEN ad.status IN ('absent') AND ad.is_payable = false THEN 1 ELSE 0 END) > 0
ORDER BY c.tenant_id, c.period_month, c.employee_id;
```

### 5.3 Deployment timing constraints

| Period state | Correction timing |
|---|---|
| OPEN months | Any time — no payroll dependency |
| LOCKED months (HR approval obtained) | Must complete **before** period advances to PAYROLL_PROCESSING |
| PAYROLL_PROCESSING | **Block correction** — wait for payroll run to complete or fail before modifying punches |
| PAYROLL_FINALIZED | Requires executive sign-off + arrear engine planning (Phase 4) |

### 5.4 Payroll re-run requirement

For any month where correction changes `lop_days` or `payable_days` for an employee:
- If payroll status is `draft`: re-run payroll normally — it will pick up corrected attendance
- If payroll status is `finalized`: Phase 4 applies — arrear adjustments required
- Statutory filings (PF, ESI, TDS) based on wrong LOP must be flagged for amended filings

**Do not re-run payroll for a finalized month without the arrear engine plan in place.**

### 5.5 Blackout windows

Do not execute Phases 2 or 3 during:
- Active payroll processing run for any affected month
- Within 48 hours of a statutory filing deadline if affected months are in scope
- End-of-month (last 3 working days) when attendance is being reviewed by HR
- Any period where `attendance_period_locks.state = 'PAYROLL_PROCESSING'`

---

## 6. Recompute Strategy

### 6.1 What needs to be recomputed

After punch timestamps are corrected, `attendance_daily` rows are stale. Every
`(employee_id, date)` pair where at least one punch was corrected must be recomputed.

The recompute must cover **both** the `original_local_date` and the `corrected_local_date`
for each punch, because:
- The old wrong date might now have no punches → should become `absent`
- The corrected date now has the right punches → should become `present`

For cross-midnight corrections, this means up to three dates per employee: the original wrong
date, the corrected in-date, and the corrected out-date (next calendar day).

### 6.2 Recompute set query

```sql
-- All (employee_id, date) pairs requiring recompute
-- Union of original dates (may now be punchless) and corrected dates
SELECT DISTINCT tenant_id, employee_id, original_local_date AS recompute_date
FROM punch_tz_correction_log
WHERE correction_status = 'applied'

UNION

SELECT DISTINCT tenant_id, employee_id, corrected_local_date
FROM punch_tz_correction_log
WHERE correction_status = 'applied'

ORDER BY tenant_id, employee_id, recompute_date;
```

### 6.3 Execution method

Recomputes must use `recomputeRange()` from `attendance-engine.ts` — the canonical engine.
**Do not use `attendance-processor.ts`** for this operation. The processor reads from
`attendance_raw_logs` (biometric device logs) and would ignore the corrected punch_logs entries.

Call via an internal admin API endpoint or a controlled script. Do not use fire-and-forget
(`setImmediate`) for this remediation — each recompute must be awaited and its success
confirmed before marking `recompute_completed = true` in `punch_tz_correction_log`.

```typescript
// Pseudocode — execute via internal admin route, not production upload path
for (const { tenant_id, employee_id, recompute_date } of recomputeSet) {
  try {
    await recomputeRange(supabase, {
      tenant_id,
      employee_id,
      from_date:  recompute_date,
      to_date:    recompute_date,
      changed_by: REMEDIATION_USER_ID,
    })
    await markRecomputeComplete(punch_id, recompute_date)
  } catch (err) {
    log.error({ err, tenant_id, employee_id, recompute_date }, 'remediation recompute failed')
    // Do not swallow — record failure and halt batch
    throw err
  }
}
```

### 6.4 Batch size and rate

- Recompute one date at a time per employee (the engine fetches all required data per call)
- Do not parallelize across employees for the same date — the advisory lock in the engine
  already serializes at the date level
- Maximum batch: 100 employee-dates per minute to avoid advisory lock contention
- Run during off-peak hours (before 08:00 local time or after 20:00 local time)

### 6.5 Audit trail

Every `recomputeRange()` call writes to `attendance_audit_log` with `source = 'system'` and
`metadata.reason = 'csv_timezone_remediation'`. No additional audit writing is needed —
the engine handles it.

---

## 7. Risk Assessment

### 7.1 Residual risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Source CHECK constraint blocks all CSV inserts → zero historical impact | Medium | None (good outcome) | Verify with Step 0a query before planning any correction work |
| Correction of PAYROLL_FINALIZED months reveals material payroll errors requiring statutory amendments | Medium | High | Phase 4 gate with executive sign-off; arrear engine must be ready |
| Recompute produces unexpected status for a corrected date (e.g., due to leave overlap or shift change) | Low | Medium | Post-recompute validation (Section 4.3); human review of exceptions |
| Collision-deleted CSV punch was the only record for that employee on that date (device punch was a false dedup) | Low | Medium | Collision query (Section 1.4) must be reviewed manually before any deletion |
| Advisory lock contention during batch recompute causes timeout or partial recompute | Low | Low | Batch rate limit (Section 6.4); retry logic in recompute loop |
| Cross-midnight correction shifts punch to a date that is in a different (already-corrected) period-lock state | Low | Low | Recompute set (Section 6.2) uses `corrected_local_date`; period-lock check covers both dates |
| Rollback of Phase 2 not executed before Phase 3 runs → rollback scope ambiguity | Low | Medium | `punch_tz_correction_log.applied_by` records the phase; rollback query filters by phase tag |
| Tenants with `timezone = 'UTC'` accidentally included in correction | None | High | All queries gate on `t.timezone != 'UTC'`; correction formula is a no-op for UTC anyway |

### 7.2 What this plan does NOT address

| Item | Reason excluded | Separate action required |
|---|---|---|
| Fixing `lop_days` calculation in `payroll-summary.ts` (counts absent rows, ignores `day_fraction`) | Separate bug, separate fix | See ATTENDANCE_MODULE_AUDIT.md §3.1 — schedule as Phase 1 stabilization item |
| Correcting `attendance_processor.ts` short-session status bug (marks absent as present) | Separate bug, processor vs engine divergence | Phase 1 stabilization — requires dual-engine remediation plan |
| Regularisation frequency limit bug (checks `created_at` month not `date` month) | Separate bug | Phase 1 stabilization |
| Night-shift date derivation bug in `punch.ts` | Separate bug | Phase 1 stabilization |
| Biometric device punches (source != csv_upload) | Not affected by timezone bug — device pushes UTC timestamps directly | No action needed |

### 7.3 Go / No-Go criteria

**Go (proceed to Phase 2):**
- [ ] Step 0a verification query confirms rows exist with `source = 'csv_upload'`
- [ ] Correction log populated and summary reviewed
- [ ] Zero `PAYROLL_PROCESSING` periods in scope
- [ ] Collision list reviewed and decision recorded for each collision
- [ ] Engineering lead sign-off on correction log row count
- [ ] HR admin sign-off on employee impact scope
- [ ] Off-peak execution window confirmed
- [ ] Rollback procedure tested in staging environment

**No-Go (stop and escalate):**
- [ ] Affected employee count is unexpectedly high (>10% of active employees) without explanation
- [ ] Any `PAYROLL_FINALIZED` period has affected employees whose LOP delta exceeds 2 days
- [ ] Collision detection shows >5% of csv punches have collisions
- [ ] Staging dry-run produces attendance status different from expected for >2% of affected employee-dates
- [ ] `tenants.timezone` is NULL or empty for any tenant with csv_upload punches

---

## Sign-off Required Before Phase 2 Execution

| Role | Name | Sign-off Date | Notes |
|---|---|---|---|
| Engineering Lead | | | Confirms correction SQL reviewed and tested in staging |
| HR Admin | | | Confirms employee scope reviewed and impact is expected |
| Payroll Lead | | | Confirms no PAYROLL_PROCESSING periods in scope |
| Executive (Phase 4 only) | | | Confirms arrear plan approved before deferred corrections |

---

*This document is planning-only. No data modification will occur until each phase's
go/no-go criteria are met and the relevant sign-offs are in place.*
