-- =============================================================================
-- 050_leave_accrual_ledger.sql
--
-- Adds:
--   1. expiry_days column on leave_policies (CO expiry window in days)
--   2. leave_accrual_ledger — per-grant audit trail + CO expiry tracking
--   3. leave_job_log        — execution history for scheduled leave jobs
-- =============================================================================

-- ── 1. expiry_days on leave_policies ────────────────────────────────────────
-- NULL = grants for this leave type never expire (CL, EL, SL…)
-- e.g.  60 = each CO grant expires 60 days after it was credited

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS expiry_days INT DEFAULT NULL
    CONSTRAINT chk_leave_policy_expiry_days CHECK (expiry_days IS NULL OR expiry_days > 0);

-- ── 2. leave_accrual_ledger ──────────────────────────────────────────────────
-- Tracks individual accrual / adjustment entries per employee per leave type.
-- Used for:
--   • Audit trail (what was credited, when, why)
--   • CO expiry: rows with expires_on != NULL are checked by the daily job
--   • Policy recalculate: adjustment rows reconcile old vs new totals

CREATE TABLE IF NOT EXISTS leave_accrual_ledger (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  employee_id     UUID         NOT NULL REFERENCES employees(id)      ON DELETE CASCADE,
  leave_type_id   UUID         NOT NULL REFERENCES leave_types(id)    ON DELETE CASCADE,
  year            INT          NOT NULL,
  accrual_type    TEXT         NOT NULL
    CHECK (accrual_type IN (
      'monthly',        -- regular monthly credit
      'yearly',         -- full-year credit at year start
      'upfront',        -- upfront full credit (no proration)
      'carry_forward',  -- balance moved from prior year
      'co_grant',       -- compensatory-off grant (has expiry)
      'manual',         -- admin-issued credit
      'adjustment'      -- policy-change reconciliation (may be negative)
    )),
  days            DECIMAL(5,1) NOT NULL,        -- +credit / -debit
  accrued_on      DATE         NOT NULL DEFAULT CURRENT_DATE,
  expires_on      DATE                  DEFAULT NULL,  -- NULL = never expires
  is_expired      BOOLEAN      NOT NULL DEFAULT false,
  expired_on      TIMESTAMPTZ           DEFAULT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accrual_ledger_employee
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year);

-- Partial index — only rows that still need expiry checking
CREATE INDEX IF NOT EXISTS idx_accrual_ledger_pending_expiry
  ON leave_accrual_ledger (tenant_id, expires_on)
  WHERE is_expired = false AND expires_on IS NOT NULL;

ALTER TABLE leave_accrual_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lal_tenant_read" ON leave_accrual_ledger FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lal_hr_write"    ON leave_accrual_ledger FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── 3. leave_job_log ─────────────────────────────────────────────────────────
-- One row per scheduled-job execution. Written by the API process.
-- tenant_id = NULL means the job ran across all tenants.

CREATE TABLE IF NOT EXISTS leave_job_log (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         REFERENCES tenants(id) ON DELETE CASCADE,
  job_type     TEXT         NOT NULL
    CHECK (job_type IN (
      'monthly_accrual',
      'co_expiry',
      'carry_forward',
      'policy_recalculate'
    )),
  status       TEXT         NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms  INT,
  params       JSONB,       -- input params (year, month, leave_type_id, …)
  result       JSONB,       -- employees_processed, total_days_credited, errors[]
  error_msg    TEXT,
  triggered_by UUID         REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_job_log_tenant_type
  ON leave_job_log (tenant_id, job_type, started_at DESC);

ALTER TABLE leave_job_log ENABLE ROW LEVEL SECURITY;

-- Admins can read and write job log; scheduler writes via service-role key (bypasses RLS)
CREATE POLICY "ljl_hr_read"   ON leave_job_log FOR SELECT
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "ljl_hr_write"  ON leave_job_log FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
