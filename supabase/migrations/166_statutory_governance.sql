-- =============================================================================
-- 166_statutory_governance.sql
-- Enterprise Statutory Governance — EPF / ESI / PTax
--
-- Adds:
--   1.  state_code on sites (Employee → Site → State chain for PTax)
--   2.  statutory_registrations — site-level registration numbers
--   3.  payroll_statutory_settings — enabled flags (replaces missing payroll_configs)
--   4.  ptax_slabs.frequency & deduction_month — half-yearly / annual support
--   5.  epf_config: effective_to + multi-row versioning support
--   6.  epf_eligibility_overrides: effective_to, approved_by, audit fields
--   7.  employee_statutory_overrides — unified ESI/PTax exemption table
--   8.  statutory_audit_log — all override/config change events
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.  state_code on sites
-- ---------------------------------------------------------------------------
ALTER TABLE sites ADD COLUMN IF NOT EXISTS state_code TEXT;

COMMENT ON COLUMN sites.state_code IS
  'ISO 3166-2 state code (e.g. MH, KA, TG, DL). '
  'Used to auto-derive Professional Tax jurisdiction for employees at this site.';

-- ---------------------------------------------------------------------------
-- 2.  statutory_registrations
-- Site-level registration numbers for EPF, ESI, and Professional Tax.
-- A company with branches in MH, KA, TG maintains separate registrations.
-- One row per (tenant, site, statutory_type, effective_from).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id             UUID REFERENCES sites(id) ON DELETE SET NULL,
                        -- NULL = applies at tenant level (fallback when no site match)
    statutory_type      TEXT NOT NULL CHECK (statutory_type IN ('epf', 'esi', 'ptax')),
    registration_number TEXT NOT NULL,
    state_code          TEXT,           -- required for ptax, optional for epf/esi
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    notes               TEXT,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, site_id, statutory_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_stat_reg_tenant_site_type
    ON statutory_registrations (tenant_id, site_id, statutory_type)
    WHERE is_active = true;

ALTER TABLE statutory_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "statreg_tenant_read" ON statutory_registrations
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "statreg_hr_write" ON statutory_registrations
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 3.  payroll_statutory_settings
-- Enabled flags and TDS defaults for the tenant.
-- This replaces the previously referenced but never-created `payroll_configs`
-- table.  The payroll snapshot engine will read from this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_statutory_settings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    pf_enabled          BOOLEAN NOT NULL DEFAULT true,
    esi_enabled         BOOLEAN NOT NULL DEFAULT true,
    pt_enabled          BOOLEAN NOT NULL DEFAULT false,
    tds_enabled         BOOLEAN NOT NULL DEFAULT false,
    tds_default_rate    DECIMAL(5,2) NOT NULL DEFAULT 0,
    tds_default_regime  TEXT NOT NULL DEFAULT 'new' CHECK (tds_default_regime IN ('old','new')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE payroll_statutory_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "statset_tenant_read" ON payroll_statutory_settings
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "statset_hr_write" ON payroll_statutory_settings
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 4.  PTax slab: frequency + deduction_month
-- frequency controls WHEN the deduction fires within a year.
-- deduction_month is the calendar month (1-12) for first/only deduction.
-- half_yearly fires at deduction_month AND (deduction_month + 6).
-- ---------------------------------------------------------------------------
ALTER TABLE ptax_slabs
    ADD COLUMN IF NOT EXISTS frequency       TEXT NOT NULL DEFAULT 'monthly'
        CHECK (frequency IN ('monthly','half_yearly','annual')),
    ADD COLUMN IF NOT EXISTS deduction_month INT CHECK (deduction_month BETWEEN 1 AND 12);
    -- deduction_month NULL = use month 3 (March) for annual, month 9 + 3 for half_yearly

COMMENT ON COLUMN ptax_slabs.frequency IS
  'monthly: deduct every month. '
  'half_yearly: deduct in deduction_month and deduction_month+6. '
  'annual: deduct only in deduction_month (default March=3).';

-- ---------------------------------------------------------------------------
-- 5.  epf_config: effective_to for version history + configurable EDLI/admin
-- Drop the UNIQUE constraint on tenant_id to allow multiple dated versions.
-- The active version is effective_from <= :month AND (effective_to IS NULL OR effective_to >= :month).
-- ---------------------------------------------------------------------------
ALTER TABLE epf_config DROP CONSTRAINT IF EXISTS epf_config_tenant_id_key;

ALTER TABLE epf_config
    ADD COLUMN IF NOT EXISTS effective_to       DATE,
    ADD COLUMN IF NOT EXISTS edli_rate_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0.50,
    ADD COLUMN IF NOT EXISTS edli_cap           DECIMAL(10,2) NOT NULL DEFAULT 75.00,
    ADD COLUMN IF NOT EXISTS edli_floor         DECIMAL(10,2) NOT NULL DEFAULT 25.00,
    ADD COLUMN IF NOT EXISTS admin_charges_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0.50;

COMMENT ON COLUMN epf_config.edli_rate_pct     IS 'EDLI contribution rate (%) — statutory default 0.5%';
COMMENT ON COLUMN epf_config.edli_cap          IS 'EDLI monthly cap in INR — statutory default ₹75';
COMMENT ON COLUMN epf_config.edli_floor        IS 'EDLI/admin charge floor in INR — statutory default ₹25; set 0 to disable';
COMMENT ON COLUMN epf_config.admin_charges_pct IS 'EPF admin charges on employer side (%) — statutory default 0.5%';

-- Unique: one open-ended (effective_to IS NULL) config per tenant at any time.
-- Partial unique index: allows many closed versions, only one open-ended.
CREATE UNIQUE INDEX IF NOT EXISTS idx_epf_config_active_per_tenant
    ON epf_config (tenant_id)
    WHERE effective_to IS NULL;

-- Same for ESI config
ALTER TABLE esi_config DROP CONSTRAINT IF EXISTS esi_config_tenant_id_key;

ALTER TABLE esi_config
    ADD COLUMN IF NOT EXISTS effective_to DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_esi_config_active_per_tenant
    ON esi_config (tenant_id)
    WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- 6.  epf_eligibility_overrides: add effective_to + governance fields
-- ---------------------------------------------------------------------------
ALTER TABLE epf_eligibility_overrides
    ADD COLUMN IF NOT EXISTS effective_to    DATE,
    ADD COLUMN IF NOT EXISTS approved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_international_worker BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS higher_pf_opted         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS higher_pf_pct           DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS uan                     TEXT;
    -- UAN: Universal Account Number — stored here to link to ECR export

-- ---------------------------------------------------------------------------
-- 7.  employee_statutory_overrides
-- Unified ESI and PTax exemption tracking with full audit trail.
-- Covers cases: disability exemption, trainee, contract worker, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_statutory_overrides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    statutory_type      TEXT NOT NULL CHECK (statutory_type IN ('esi','ptax')),
    is_exempt           BOOLEAN NOT NULL DEFAULT true,
    exemption_reason    TEXT NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- No UNIQUE — allow multiple time-range entries per employee per type
    CONSTRAINT eso_eff_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_eso_tenant_emp_type
    ON employee_statutory_overrides (tenant_id, employee_id, statutory_type);

ALTER TABLE employee_statutory_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eso_tenant_read" ON employee_statutory_overrides
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "eso_hr_write" ON employee_statutory_overrides
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 8.  statutory_audit_log
-- Immutable append-only log for all statutory config and override changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
                    -- 'epf_config_updated' | 'esi_config_updated'
                    -- | 'ptax_slab_added' | 'registration_added'
                    -- | 'epf_override_set' | 'statutory_override_set'
    entity_type     TEXT NOT NULL,   -- 'epf_config' | 'esi_config' | 'ptax_slab' | etc.
    entity_id       UUID,
    employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
    changed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    before_value    JSONB,           -- snapshot before change
    after_value     JSONB NOT NULL,  -- snapshot after change
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_stat_audit_tenant_changed_at
    ON statutory_audit_log (tenant_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stat_audit_employee
    ON statutory_audit_log (tenant_id, employee_id)
    WHERE employee_id IS NOT NULL;

ALTER TABLE statutory_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stataudit_tenant_read" ON statutory_audit_log
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "stataudit_insert" ON statutory_audit_log
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
