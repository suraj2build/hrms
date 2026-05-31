-- =============================================================================
-- 094_payroll_ledger.sql
-- Payroll explainability ledger: every payroll-impacting event
-- Provides a full audit trail of every event that affected an employee's
-- payslip, enabling transparent payroll explainability for employees and HR.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: payroll_explainability_ledger
-- One row per payroll-impacting event per employee, keyed to the payroll run.
-- The generated column `delta` captures the net monetary impact.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_explainability_ledger (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id          UUID,
    ledger_date             DATE NOT NULL,
    event_type              TEXT NOT NULL CHECK (event_type IN (
                                'attendance_impact','leave_deduction','salary_revision',
                                'ot_credit','incentive','reimbursement','advance_recovery',
                                'loan_emi','statutory_deduction','arrear_credit',
                                'tds_deduction','adjustment','lop_deduction')),
    source_module           TEXT NOT NULL CHECK (source_module IN (
                                'attendance','leave','compensation','statutory','advance',
                                'loan','reimbursement','variable_pay','arrear','tds','manual')),
    component_code          TEXT,
    component_name          TEXT,
    before_value            DECIMAL(14,2),
    after_value             DECIMAL(14,2) NOT NULL,
    delta                   DECIMAL(14,2) GENERATED ALWAYS AS
                                (after_value - COALESCE(before_value, 0)) STORED,
    reason                  TEXT NOT NULL,
    is_payroll_impacting    BOOLEAN NOT NULL DEFAULT true,
    correlation_id          TEXT,
    causation_event_id      TEXT,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
-- Note: indexes on payroll_explainability_ledger are already created by migration 077.
-- The indexes below are skipped to avoid conflicts with the existing table structure
-- (077 uses month/created_at columns; no payroll_run_id or correlation_id columns exist).

-- idx_pel_tenant_employee  → already exists as idx_pel_employee_month  (077)
-- idx_pel_tenant_event_type → already exists as idx_pel_event_type     (077)
-- idx_pel_tenant_payroll_run → skipped (no payroll_run_id column)
-- idx_pel_correlation        → skipped (no correlation_id column)

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_explainability_ledger
-- RLS and policies already enabled by migration 077 — skipping duplicates.
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_explainability_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'payroll_explainability_ledger' AND policyname = 'pel_hr_write'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "pel_hr_write" ON payroll_explainability_ledger
        FOR ALL
        USING (get_user_role() IN ('super_admin','hr_admin'))
    $policy$;
  END IF;
END $$;
