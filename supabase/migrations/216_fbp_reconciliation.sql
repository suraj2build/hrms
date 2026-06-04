-- ============================================================
-- 216_fbp_reconciliation.sql
--
-- Flexible Benefit Plan (FBP) quarterly reconciliation.
--
-- Some allowances (fuel, mobile, meal, driver, professional development) are
-- PAID every month as part of salary, then reconciled each quarter against the
-- bills the employee submits. The substantiated portion (bills, up to an
-- exemption limit) is tax-exempt; the rest (paid − bills) becomes taxable and
-- is added to taxable income for TDS.
--
-- This migration adds:
--   1. salary_components.is_reimbursement + exemption_limit_annual  (config)
--   2. fbp_bill_submissions    — employee bill submissions (ESS)
--   3. fbp_bill_attachments    — the uploaded bills
--   4. fbp_reconciliations     — system-computed paid / proof / taxable per
--                                employee · component · FY · quarter
--
-- All additive. Existing rows unaffected.
-- ============================================================

-- ── 1. Component config flags ───────────────────────────────────────────────
ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS is_reimbursement BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS exemption_limit_annual NUMERIC(14, 2)
    CHECK (exemption_limit_annual IS NULL OR exemption_limit_annual >= 0);

COMMENT ON COLUMN salary_components.is_reimbursement IS
  'When true, this allowance is paid monthly but reconciled quarterly against '
  'submitted bills; the unsubstantiated portion becomes taxable.';
COMMENT ON COLUMN salary_components.exemption_limit_annual IS
  'Optional annual cap on the tax-exempt (bill-backed) amount. NULL = no cap '
  '(fully exempt up to the amount proven).';

-- ── 2. Employee bill submissions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fbp_bill_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES employees(id)         ON DELETE CASCADE,
  salary_component_id UUID NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
  financial_year      TEXT     NOT NULL,                       -- e.g. '2026-27'
  quarter             SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  approved_amount     NUMERIC(14, 2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at        TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fbp_sub_emp
  ON fbp_bill_submissions (tenant_id, employee_id, financial_year, quarter);
CREATE INDEX IF NOT EXISTS idx_fbp_sub_pending
  ON fbp_bill_submissions (tenant_id, status) WHERE status = 'submitted';

-- ── 3. Bill attachments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fbp_bill_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id   UUID NOT NULL REFERENCES fbp_bill_submissions(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  mime_type       TEXT,
  file_size_bytes INT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by     UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fbp_att_submission
  ON fbp_bill_attachments (submission_id);

-- ── 4. Quarterly reconciliation (system-computed) ───────────────────────────
CREATE TABLE IF NOT EXISTS fbp_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES employees(id)         ON DELETE CASCADE,
  salary_component_id UUID NOT NULL REFERENCES salary_components(id) ON DELETE CASCADE,
  financial_year      TEXT     NOT NULL,
  quarter             SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  paid_amount         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  proof_amount        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  exemption_limit     NUMERIC(14, 2),
  taxable_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'locked')),
  reconciled_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reconciled_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, salary_component_id, financial_year, quarter)
);

CREATE INDEX IF NOT EXISTS idx_fbp_recon_emp_fy
  ON fbp_reconciliations (tenant_id, employee_id, financial_year);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE fbp_bill_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fbp_bill_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fbp_reconciliations   ENABLE ROW LEVEL SECURITY;

-- Submissions: tenant-scoped read; HR full write; employees can insert (own tenant)
CREATE POLICY "fbp_sub_read"    ON fbp_bill_submissions FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "fbp_sub_hr"      ON fbp_bill_submissions FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "fbp_sub_emp_ins" ON fbp_bill_submissions FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "fbp_att_read" ON fbp_bill_attachments FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "fbp_att_hr"   ON fbp_bill_attachments FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "fbp_att_ins"  ON fbp_bill_attachments FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "fbp_recon_read" ON fbp_reconciliations FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "fbp_recon_hr"   ON fbp_reconciliations FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
