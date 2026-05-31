-- ============================================================
-- Migration 177: Tax Governance Hardening
-- Extends proof states, adds payroll lock columns, adds
-- tax_projection_reconciliation and tds_bulk_operation_log tables.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- A. Extend declaration_proofs.document_state CHECK constraint
-- ────────────────────────────────────────────────────────────

ALTER TABLE declaration_proofs
  DROP CONSTRAINT IF EXISTS declaration_proofs_document_state_check;

ALTER TABLE declaration_proofs
  ADD CONSTRAINT declaration_proofs_document_state_check
    CHECK (document_state IN (
      'draft',
      'uploaded',
      'under_review',
      'verified',
      'rejected',
      'revision_requested',
      'superseded',
      'payroll_locked',
      'archived'
    ));

-- ────────────────────────────────────────────────────────────
-- B. Add new columns to declaration_proofs
-- ────────────────────────────────────────────────────────────

ALTER TABLE declaration_proofs
  ADD COLUMN IF NOT EXISTS superseded_by            UUID REFERENCES declaration_proofs(id),
  ADD COLUMN IF NOT EXISTS supersedes_document_id   UUID REFERENCES declaration_proofs(id),
  ADD COLUMN IF NOT EXISTS locked_by_payroll_run_id UUID,
  ADD COLUMN IF NOT EXISTS payroll_locked_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_reason           TEXT,
  ADD COLUMN IF NOT EXISTS checksum_hash             TEXT;

-- ────────────────────────────────────────────────────────────
-- C. Add new columns to tax_declarations
-- ────────────────────────────────────────────────────────────

ALTER TABLE tax_declarations
  ADD COLUMN IF NOT EXISTS locked_by_payroll_run_id UUID,
  ADD COLUMN IF NOT EXISTS payroll_locked_at         TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────
-- D. Add new columns to tax_declaration_components
-- ────────────────────────────────────────────────────────────

ALTER TABLE tax_declaration_components
  ADD COLUMN IF NOT EXISTS component_scope       TEXT NOT NULL DEFAULT 'global'
    CHECK (component_scope IN ('global', 'country', 'state', 'company')),
  ADD COLUMN IF NOT EXISTS visibility_scope      TEXT NOT NULL DEFAULT 'all'
    CHECK (visibility_scope IN ('all', 'admin_only', 'employee')),
  ADD COLUMN IF NOT EXISTS requires_verification BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_override        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_negative_value  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS carry_forward_supported BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_applicability BOOLEAN NOT NULL DEFAULT true;

-- ────────────────────────────────────────────────────────────
-- E. Create tax_projection_reconciliation table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_projection_reconciliation (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  financial_year        TEXT NOT NULL,
  period_month          TEXT,  -- YYYY-MM; NULL = annual reconciliation
  projected_tax         DECIMAL(14,2) NOT NULL DEFAULT 0,
  actual_tax            DECIMAL(14,2) NOT NULL DEFAULT 0,
  variance_amount       DECIMAL(14,2) GENERATED ALWAYS AS (actual_tax - projected_tax) STORED,
  variance_reason       TEXT[],
  reconciliation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending', 'matched', 'variance_reviewed', 'adjusted')),
  risk_flag             TEXT
    CHECK (risk_flag IN ('over_deduction', 'under_deduction', 'negative_recovery', 'replay_drift')),
  payroll_run_id        UUID,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, financial_year, period_month, payroll_run_id)
);

CREATE INDEX IF NOT EXISTS idx_tpr_tenant_fy
  ON tax_projection_reconciliation (tenant_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tpr_risk
  ON tax_projection_reconciliation (tenant_id, risk_flag)
  WHERE risk_flag IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tpr_status
  ON tax_projection_reconciliation (tenant_id, reconciliation_status)
  WHERE reconciliation_status != 'matched';

-- RLS: tenant-scoped SELECT for all authenticated
ALTER TABLE tax_projection_reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpr_select ON tax_projection_reconciliation;
CREATE POLICY tpr_select ON tax_projection_reconciliation
  FOR SELECT TO authenticated
  USING (tenant_id = (
    SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));

DROP POLICY IF EXISTS tpr_insert_admin ON tax_projection_reconciliation;
CREATE POLICY tpr_insert_admin ON tax_projection_reconciliation
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    AND (
      SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1
    ) IN ('hr_admin', 'super_admin')
  );

DROP POLICY IF EXISTS tpr_update_admin ON tax_projection_reconciliation;
CREATE POLICY tpr_update_admin ON tax_projection_reconciliation
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    AND (
      SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1
    ) IN ('hr_admin', 'super_admin')
  );

-- ────────────────────────────────────────────────────────────
-- F. Create tds_bulk_operation_log table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tds_bulk_operation_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  actor_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  affected_ids   UUID[] NOT NULL,
  affected_count INT NOT NULL,
  reason         TEXT,
  financial_year TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tbol_tenant_op
  ON tds_bulk_operation_log (tenant_id, operation_type, created_at DESC);
