-- ============================================================
-- 143_payroll_validation_rules.sql
--
-- Platform-level payroll validation rule registry.
--
-- Each rule defines:
--   • code             — machine-readable identifier used in payroll_run_blockers
--   • severity         — critical | warning | info
--   • blocking         — whether a rule's failure blocks retry / finalization
--   • stage            — which computation stage this rule covers
--   • remediation_route — deep-link into the platform to fix the root cause
--
-- Rules can be toggled on/off by hr_admin via the Validation Center.
-- The payroll engine uses these rules to classify per-employee failures.
--
-- Seeded with 11 default platform rules below.
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_validation_rules (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT    UNIQUE NOT NULL,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  severity          TEXT    NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  blocking          BOOLEAN NOT NULL DEFAULT true,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  stage             TEXT    NOT NULL,
  remediation_route TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- This table was originally tenant-scoped; redesigned as platform-level (no tenant).
-- Make tenant_id nullable so platform-wide seed rows can be inserted without it.
ALTER TABLE payroll_validation_rules
  ALTER COLUMN tenant_id DROP NOT NULL;

-- The old payroll_validation_rules table has unknown NOT NULL columns from an earlier schema.
-- Dynamically drop NOT NULL on every non-PK column so the new INSERT can succeed.
-- The new INSERT only provides (code, name, description, severity, blocking, enabled, stage, remediation_route).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'payroll_validation_rules'
      AND column_name  <> 'id'
      AND is_nullable  = 'NO'
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE payroll_validation_rules ALTER COLUMN %I DROP NOT NULL',
        r.column_name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END$$;

-- Ensure all columns exist (table may have been created earlier with a different schema)
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS code              TEXT        DEFAULT NULL;
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS name              TEXT        NOT NULL DEFAULT '';
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS description       TEXT        NOT NULL DEFAULT '';
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS severity          TEXT        NOT NULL DEFAULT 'warning';
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS blocking          BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS enabled           BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS stage             TEXT        NOT NULL DEFAULT '';
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS remediation_route TEXT        DEFAULT NULL;
ALTER TABLE payroll_validation_rules
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add unique constraint on code if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'payroll_validation_rules'::regclass
      AND contype = 'u'
      AND conname = 'payroll_validation_rules_code_key'
  ) THEN
    ALTER TABLE payroll_validation_rules ADD CONSTRAINT payroll_validation_rules_code_key UNIQUE (code);
  END IF;
END$$;

-- Replace any existing severity CHECK constraint with the canonical values.
-- The old schema may have used ('HIGH','MEDIUM','LOW') or similar.
DO $$
DECLARE r record;
BEGIN
  -- Drop all CHECK constraints on severity (could be named anything)
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'payroll_validation_rules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%severity%'
  LOOP
    EXECUTE format('ALTER TABLE payroll_validation_rules DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  -- Add the canonical severity constraint
  ALTER TABLE payroll_validation_rules
    ADD CONSTRAINT payroll_validation_rules_severity_check
      CHECK (severity IN ('critical', 'warning', 'info'));
END$$;

COMMENT ON TABLE payroll_validation_rules IS
  'Registry of payroll validation rules. '
  'Consumed by payroll-blocker-engine.ts at run time and by the Validation Center UI.';

COMMENT ON COLUMN payroll_validation_rules.blocking IS
  'When true, open blockers for this rule prevent retry and finalization.';

COMMENT ON COLUMN payroll_validation_rules.enabled IS
  'When false, the rule is skipped during blocker classification. '
  'Disabling does not retroactively resolve existing open blockers.';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_validation_rules ENABLE ROW LEVEL SECURITY;

-- All authenticated admins can read rules
CREATE POLICY "pvr_hr_read" ON payroll_validation_rules FOR SELECT
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- Only super_admin can mutate rules (hr_admin can toggle via API with permission check)
CREATE POLICY "pvr_super_admin_write" ON payroll_validation_rules FOR ALL
  USING (get_user_role() = 'super_admin');

-- ── Seed — 11 platform default rules ─────────────────────────────────────────

INSERT INTO payroll_validation_rules
  (code, name, description, severity, blocking, enabled, stage, remediation_route)
VALUES
  (
    'COMP_MISSING',
    'Compensation Missing',
    'No active compensation record found for this employee as of the payroll period end date. '
    'Employee cannot be included in payroll until a compensation is configured.',
    'critical', true, true,
    'compensation_validation',
    '/admin/payroll/compensation'
  ),
  (
    'COMP_INVALID',
    'Compensation Invalid',
    'Active compensation has invalid values — negative CTC, NaN, Infinity, or effective_from '
    'is after the period end date (future-dated). Check the compensation record.',
    'critical', true, true,
    'compensation_validation',
    '/admin/payroll/compensation'
  ),
  (
    'BANK_MISSING',
    'Bank Account Missing',
    'Employee has no verified bank account on file for salary disbursement. '
    'Payroll cannot be released to this employee until a bank account is added.',
    'critical', true, true,
    'data_fetch',
    '/admin/workforce/employees'
  ),
  (
    'ATTENDANCE_EMPTY',
    'No Attendance Data',
    'No attendance records found for this employee in the payroll month. '
    'Employee will receive full pay (0 LOP assumed). Operator must verify before finalizing.',
    'warning', false, true,
    'data_fetch',
    '/admin/attendance/muster-roll'
  ),
  (
    'NEGATIVE_NET',
    'Negative Net Pay',
    'Computed net pay is negative after all deductions. '
    'This usually indicates deduction components exceed earning components. Check the compensation setup.',
    'critical', true, true,
    'slip_validation',
    '/admin/payroll/simulation'
  ),
  (
    'INVALID_FORMULA',
    'Invalid Component Formula',
    'A salary component formula produced an invalid value (NaN or Infinity). '
    'Check the component configuration in Salary Components.',
    'critical', true, true,
    'slip_validation',
    '/admin/payroll/salary-components'
  ),
  (
    'LOP_EXCESSIVE',
    'Excessive LOP Days',
    'Loss-of-Pay days exceed total working days for the period. '
    'This may indicate duplicate attendance records or a data entry error.',
    'warning', false, true,
    'slip_validation',
    '/admin/attendance/muster-roll'
  ),
  (
    'PAYROLL_NAN',
    'Payroll NaN Value',
    'One or more payroll numeric fields (gross_pay, net_pay, etc.) computed as NaN. '
    'Usually caused by division by zero in working-day calculations or a corrupt component amount.',
    'critical', true, true,
    'slip_validation',
    '/admin/payroll/simulation'
  ),
  (
    'TDS_INVALID',
    'Invalid TDS Calculation',
    'TDS computation returned a value outside valid statutory bounds. '
    'Review the TDS configuration in Statutory → TDS Management.',
    'warning', false, true,
    'slip_validation',
    '/admin/payroll/statutory/tds'
  ),
  (
    'ESI_INVALID',
    'Invalid ESI Contribution',
    'ESI contribution was computed outside the statutory rate range (currently 0.75% employee, 3.25% employer). '
    'Review ESI configuration.',
    'warning', false, true,
    'slip_validation',
    '/admin/payroll/statutory/esi'
  ),
  (
    'PF_INVALID',
    'Invalid PF Contribution',
    'Provident Fund contribution is outside statutory limits. '
    'Basic salary must be ≥ 0 and PF rate must be within EPF Act bounds.',
    'warning', false, true,
    'slip_validation',
    '/admin/payroll/statutory/epf'
  )
ON CONFLICT (code) DO NOTHING;
