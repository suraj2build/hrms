-- =============================================================================
-- 165_tds_governance.sql
-- TDS Declaration Lifecycle Governance
--
-- Adds:
--   1. Extended lifecycle states to tax_declarations.status
--   2. Document state machine columns to declaration_proofs
--   3. tds_declaration_snapshots — immutable payroll-applied records
--   4. tds_declaration_audit_log — full state transition log
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend tax_declarations.status CHECK constraint
--    Current: declared | submitted | under_review | approved | rejected | revision_requested
--    Added:   draft | locked | payroll_applied | archived
-- ---------------------------------------------------------------------------
ALTER TABLE tax_declarations
  DROP CONSTRAINT IF EXISTS tax_declarations_status_check;

ALTER TABLE tax_declarations
  ADD CONSTRAINT tax_declarations_status_check
  CHECK (status IN (
    'draft',
    'declared',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'revision_requested',
    'locked',
    'payroll_applied',
    'archived'
  ));

-- ---------------------------------------------------------------------------
-- 2. Document state machine columns for declaration_proofs
--    Replaces the single is_verified BOOLEAN with a proper state machine.
--    is_verified kept for backward compatibility (default false).
-- ---------------------------------------------------------------------------
ALTER TABLE declaration_proofs
  ADD COLUMN IF NOT EXISTS document_state    TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (document_state IN ('uploaded','under_review','verified','rejected')),
  ADD COLUMN IF NOT EXISTS verified_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS document_version  INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_superseded     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- Keep is_verified in sync with document_state for backward compat
-- (updated by the application layer when state transitions occur)

-- ---------------------------------------------------------------------------
-- 3. TABLE: tds_declaration_snapshots
-- Immutable payroll-applied snapshot of a employee's approved declarations
-- for a financial year. Written once when payroll is finalized.
-- Payroll engine must read ONLY from this table — never from tax_declarations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tds_declaration_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    financial_year      TEXT NOT NULL,
    payroll_run_id      UUID,  -- nullable; set when snapshot is bound to a payroll run
    snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    regime              TEXT NOT NULL CHECK (regime IN ('old', 'new')),
    total_declared      DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_approved      DECIMAL(14,2) NOT NULL DEFAULT 0,
    -- JSONB array of approved declarations at snapshot time:
    -- [{ id, declaration_category, section, description, declared_amount, approved_amount }]
    declaration_items   JSONB NOT NULL DEFAULT '[]',
    snapshot_integrity_hash TEXT,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, financial_year, payroll_run_id)
);

-- Write-once guard: prevent updates to immutable snapshots
CREATE OR REPLACE FUNCTION tds_snapshot_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TDS declaration snapshots are immutable — create a new snapshot instead.';
END;
$$;

DROP TRIGGER IF EXISTS trg_tds_snapshot_immutable ON tds_declaration_snapshots;
CREATE TRIGGER trg_tds_snapshot_immutable
  BEFORE UPDATE ON tds_declaration_snapshots
  FOR EACH ROW EXECUTE FUNCTION tds_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- 4. TABLE: tds_declaration_audit_log
-- Full audit trail of every state transition on tax_declarations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tds_declaration_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    declaration_id  UUID NOT NULL REFERENCES tax_declarations(id) ON DELETE CASCADE,
    changed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    notes           TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tds_snapshots_tenant_employee_fy
    ON tds_declaration_snapshots (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tds_snapshots_payroll_run
    ON tds_declaration_snapshots (payroll_run_id)
    WHERE payroll_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tds_audit_declaration
    ON tds_declaration_audit_log (declaration_id);

CREATE INDEX IF NOT EXISTS idx_tds_audit_tenant_changed_at
    ON tds_declaration_audit_log (tenant_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dp_document_state
    ON declaration_proofs (tenant_id, document_state)
    WHERE document_state != 'verified';

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: tds_declaration_snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE tds_declaration_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tds_snap_tenant_read" ON tds_declaration_snapshots
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tds_snap_hr_write" ON tds_declaration_snapshots
    FOR INSERT
    WITH CHECK (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: tds_declaration_audit_log
-- ---------------------------------------------------------------------------
ALTER TABLE tds_declaration_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tds_audit_tenant_read" ON tds_declaration_audit_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tds_audit_insert" ON tds_declaration_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());
