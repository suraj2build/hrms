-- ============================================================
-- Migration 168: Tax Declaration Components (Master Table)
-- Provides DB-driven master for all IT declaration sections.
-- No hardcoded sections required in application code.
-- ============================================================

CREATE TABLE IF NOT EXISTS tax_declaration_components (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = system-level template
  section_code      TEXT NOT NULL,
  section_name      TEXT NOT NULL,
  sub_section       TEXT,
  display_name      TEXT NOT NULL,
  description       TEXT,
  parent_group      TEXT NOT NULL
    CHECK (parent_group IN (
      'chapter_via', 'hra', 'house_property', 'lta',
      'other_income', 'tds_tcs', 'previous_employment',
      'perquisites', 'exemptions'
    )),
  display_order     INT NOT NULL DEFAULT 0,
  regime_eligibility TEXT NOT NULL DEFAULT 'old'
    CHECK (regime_eligibility IN ('old', 'new', 'both')),
  declaration_type  TEXT NOT NULL DEFAULT 'amount'
    CHECK (declaration_type IN ('amount', 'percentage', 'text', 'property', 'hra', 'deduction', 'exemption')),
  max_limit         DECIMAL(14,2),
  soft_limit        DECIMAL(14,2),
  proof_required    BOOLEAN NOT NULL DEFAULT false,
  validation_rules  JSONB NOT NULL DEFAULT '{}',
  is_system         BOOLEAN NOT NULL DEFAULT true,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  effective_from    DATE,
  effective_to      DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tax_decl_components_section_code
  ON tax_declaration_components (section_code);

CREATE INDEX IF NOT EXISTS idx_tax_decl_components_group_order
  ON tax_declaration_components (parent_group, display_order);

CREATE INDEX IF NOT EXISTS idx_tax_decl_components_active
  ON tax_declaration_components (is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_tax_decl_components_tenant
  ON tax_declaration_components (tenant_id);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE tax_declaration_components ENABLE ROW LEVEL SECURITY;

-- All authenticated tenant users can read system components and their own tenant components
CREATE POLICY "tax_decl_components_select"
  ON tax_declaration_components FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = get_user_tenant_id());

-- Only hr_admin / super_admin can insert new components
CREATE POLICY "tax_decl_components_insert"
  ON tax_declaration_components FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  );

-- Only hr_admin / super_admin can update (system records should be guarded in app layer)
CREATE POLICY "tax_decl_components_update"
  ON tax_declaration_components FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  );

-- Only hr_admin / super_admin can delete non-system records
CREATE POLICY "tax_decl_components_delete"
  ON tax_declaration_components FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
    AND is_system = false
  );

-- ── updated_at trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at_tax_decl_components()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_tax_decl_components ON tax_declaration_components;
CREATE TRIGGER set_updated_at_tax_decl_components
  BEFORE UPDATE ON tax_declaration_components
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_tax_decl_components();

-- ============================================================
-- SEED DATA — System-level master components (tenant_id = NULL)
-- ============================================================

-- ── Group: chapter_via ─────────────────────────────────────

-- 80C umbrella sub-items (all share section_code '80C', parent_group 'chapter_via')
INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, '80C', 'Section 80C', NULL,
   'Life Insurance Premium', 'Premium paid for self/spouse/children',
   'chapter_via', 10, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'PPF Contribution', 'Public Provident Fund',
   'chapter_via', 20, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'ELSS Mutual Fund', 'Equity Linked Saving Scheme',
   'chapter_via', 30, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'NSC Investment', 'National Savings Certificate',
   'chapter_via', 40, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'Home Loan Principal', 'Repayment of housing loan principal',
   'chapter_via', 50, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'Tuition Fees', 'Children tuition fees (max 2 children)',
   'chapter_via', 60, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'Tax Saver FD', '5-year bank/post office FD',
   'chapter_via', 70, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'ULIP Premium', 'Unit Linked Insurance Plan',
   'chapter_via', 80, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'Sukanya Samriddhi', 'Sukanya Samriddhi Yojana contribution',
   'chapter_via', 90, 'old', 'amount', 150000, true, true, true),

  (NULL, '80C', 'Section 80C', NULL,
   'NPS Employee Contribution', 'Sec 80CCD(1) - NPS employee contribution',
   'chapter_via', 100, 'old', 'amount', 150000, true, true, true),

  -- 80CCC
  (NULL, '80CCC', 'Section 80CCC', NULL,
   'Pension Fund Premium', 'Pension fund premium (combined limit with 80C)',
   'chapter_via', 110, 'old', 'amount', 150000, true, true, true),

  -- 80CCD(1B) — eligible under both regimes
  (NULL, '80CCD', 'Section 80CCD', '80CCD(1B)',
   'NPS Additional Contribution', 'Additional NPS contribution over and above 80CCD(1)',
   'chapter_via', 120, 'both', 'amount', 50000, true, true, true),

  -- 80D Self
  (NULL, '80D', 'Section 80D', NULL,
   'Medical Insurance - Self/Family', 'Health insurance for self, spouse, children',
   'chapter_via', 130, 'old', 'amount', 25000, true, true, true),

  -- 80D Parents
  (NULL, '80D', 'Section 80D', NULL,
   'Medical Insurance - Parents', 'Health insurance premium for parents (senior citizen limit: 50000)',
   'chapter_via', 140, 'old', 'amount', 25000, true, true, true),

  -- 80DD
  (NULL, '80DD', 'Section 80DD', NULL,
   'Disabled Dependent', 'Deduction for maintenance of disabled dependent',
   'chapter_via', 150, 'old', 'amount', 75000, true, true, true),

  -- 80DDB
  (NULL, '80DDB', 'Section 80DDB', NULL,
   'Medical Treatment - Specified Disease', 'Deduction for treatment of specified diseases',
   'chapter_via', 160, 'old', 'amount', 40000, true, true, true),

  -- 80E
  (NULL, '80E', 'Section 80E', NULL,
   'Education Loan Interest', 'Interest on loan for higher education - no limit',
   'chapter_via', 170, 'old', 'amount', NULL, true, true, true),

  -- 80EE
  (NULL, '80EE', 'Section 80EE', NULL,
   'Home Loan Interest (First Home)', 'Additional interest deduction for first-time homebuyers',
   'chapter_via', 180, 'old', 'amount', 50000, true, true, true),

  -- 80EEA
  (NULL, '80EEA', 'Section 80EEA', NULL,
   'Home Loan Interest (Affordable Housing)', 'Interest deduction for affordable housing loans',
   'chapter_via', 190, 'old', 'amount', 150000, true, true, true),

  -- 80G
  (NULL, '80G', 'Section 80G', NULL,
   'Donations to Charitable Institutions', '100% or 50% eligible donations to approved funds',
   'chapter_via', 200, 'old', 'amount', NULL, true, true, true),

  -- 80GGA
  (NULL, '80GGA', 'Section 80GGA', NULL,
   'Donations for Scientific Research', 'Donations for scientific research or rural development',
   'chapter_via', 210, 'old', 'amount', NULL, true, true, true),

  -- 80TTA
  (NULL, '80TTA', 'Section 80TTA', NULL,
   'Savings Account Interest', 'Interest income from savings accounts',
   'chapter_via', 220, 'old', 'amount', 10000, false, true, true),

  -- 80TTB
  (NULL, '80TTB', 'Section 80TTB', NULL,
   'Interest Income - Senior Citizens', 'Interest income deduction for senior citizens',
   'chapter_via', 230, 'old', 'amount', 50000, false, true, true);

-- ── Group: hra ─────────────────────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, 'HRA', 'Section 10(13A)', NULL,
   'HRA Exemption', 'House Rent Allowance exemption u/s 10(13A)',
   'hra', 10, 'old', 'hra', NULL, true, true, true);

-- ── Group: house_property ──────────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, '24B', 'Section 24(b)', NULL,
   'Home Loan Interest', 'Interest on housing loan u/s 24(b) - self occupied',
   'house_property', 10, 'old', 'amount', 200000, true, true, true),

  (NULL, '24B', 'Section 24(b)', NULL,
   'Home Loan Interest (Let Out)', 'Interest on housing loan - let out property',
   'house_property', 20, 'old', 'amount', NULL, true, true, true),

  (NULL, '24B', 'Section 24(b)', NULL,
   'Pre-construction Interest', '1/5th of pre-construction interest u/s 24(b)',
   'house_property', 30, 'old', 'amount', NULL, true, true, true);

-- ── Group: lta ─────────────────────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, 'LTA', 'Section 10(5)', NULL,
   'LTA Exemption', 'Leave Travel Allowance exemption u/s 10(5)',
   'lta', 10, 'old', 'exemption', NULL, true, true, true);

-- ── Group: other_income ────────────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, 'other_income', 'Other Income', NULL,
   'Interest Income - Savings', 'Savings/FD interest not covered under 80TTA',
   'other_income', 10, 'both', 'amount', NULL, false, true, true),

  (NULL, 'rental_income', 'Rental Income', NULL,
   'Rental Income', 'Net rental income (after standard deduction of 30%)',
   'other_income', 20, 'both', 'amount', NULL, false, true, true),

  (NULL, 'agri_income', 'Agricultural Income', NULL,
   'Agricultural Income', 'Agricultural income (exempt but considered for rate purposes)',
   'other_income', 30, 'both', 'amount', NULL, false, true, true);

-- ── Group: tds_tcs ─────────────────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, 'tds_others', 'TDS - Others', NULL,
   'TDS Deducted by Bank/Others', 'TDS as per Form 26AS - not employer TDS',
   'tds_tcs', 10, 'both', 'amount', NULL, true, true, true),

  (NULL, 'tcs_credit', 'TCS Credit', NULL,
   'TCS Credit', 'Tax Collected at Source',
   'tds_tcs', 20, 'both', 'amount', NULL, true, true, true);

-- ── Group: previous_employment ─────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, 'prev_salary', 'Previous Employment', NULL,
   'Previous Employer Salary', 'Salary received from previous employer in same FY',
   'previous_employment', 10, 'both', 'amount', NULL, true, true, true),

  (NULL, 'prev_tds', 'Previous Employment', NULL,
   'TDS by Previous Employer', 'TDS deducted by previous employer',
   'previous_employment', 20, 'both', 'amount', NULL, true, true, true),

  (NULL, 'prev_pt', 'Previous Employment', NULL,
   'Professional Tax - Previous Employer', 'Professional tax paid to previous employer in same FY',
   'previous_employment', 30, 'both', 'amount', NULL, false, true, true);

-- ── Group: exemptions ──────────────────────────────────────

INSERT INTO tax_declaration_components
  (tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active)
VALUES
  (NULL, 'standard_deduction', 'Standard Deduction', NULL,
   'Standard Deduction', 'Flat standard deduction from salary income',
   'exemptions', 10, 'old', 'deduction', 50000, false, true, true),

  (NULL, 'professional_tax', 'Professional Tax', NULL,
   'Professional Tax', 'Professional tax paid (u/s 16(iii))',
   'exemptions', 20, 'old', 'deduction', NULL, false, true, true);
