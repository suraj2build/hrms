-- ============================================================
-- 077_payroll_explainability_ledger.sql
--
-- Payroll Explainability Ledger — Phase 3 Payroll Traceability
--
-- Every payroll-impacting event generates a human-readable
-- ledger entry that explains what changed and why.
-- Sources: leave approvals, correction approvals, recomputes,
--          payroll finalization, policy changes, retro adjustments.
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_explainability_ledger (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id         UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Month this entry applies to (YYYY-MM)
  month               CHAR(7)       NOT NULL,

  -- What happened
  event_type          TEXT          NOT NULL CHECK (event_type IN (
    'attendance_recomputed',
    'correction_approved',
    'leave_deducted',
    'ot_added',
    'policy_changed',
    'retro_adjustment',
    'payable_days_changed',
    'lop_applied',
    'payroll_computed',
    'payroll_finalized',
    'anomaly_resolved',
    'manual_note'
  )),

  -- Human-readable explanation shown to HR/employee
  event_description   TEXT          NOT NULL,

  -- Financial / operational impact
  impact_type         TEXT,                     -- 'lop' | 'deduction' | 'gross_change' | 'ot' | 'net_change'
  impact_amount       DECIMAL(10,2),            -- monetary impact (negative = reduction)
  before_value        TEXT,                     -- state before event (e.g. "12 payable days")
  after_value         TEXT,                     -- state after event  (e.g. "10 payable days")

  -- Traceability back to the source entity
  source_entity_type  TEXT,                     -- 'leave_application' | 'attendance_regularisation' | 'payroll_run' | ...
  source_entity_id    UUID,                     -- FK-ish reference (not enforced — entities may be deleted)

  -- Audit
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by          UUID          REFERENCES profiles(id) ON DELETE SET NULL
);

-- Fast lookups for investigation workspace
CREATE INDEX IF NOT EXISTS idx_pel_employee_month
  ON payroll_explainability_ledger (tenant_id, employee_id, month, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pel_event_type
  ON payroll_explainability_ledger (tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pel_source
  ON payroll_explainability_ledger (source_entity_type, source_entity_id)
  WHERE source_entity_id IS NOT NULL;

-- RLS
ALTER TABLE payroll_explainability_ledger ENABLE ROW LEVEL SECURITY;

-- HR can read all entries for their tenant
CREATE POLICY "pel_hr_read" ON payroll_explainability_ledger FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Employees can read their own entries (ESS transparency)
CREATE POLICY "pel_employee_read" ON payroll_explainability_ledger FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND employee_id IN (
      SELECT employee_id FROM profiles
      WHERE id = auth.uid() AND employee_id IS NOT NULL
    )
  );

-- HR can insert (system also writes via service role)
CREATE POLICY "pel_hr_insert" ON payroll_explainability_ledger FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
