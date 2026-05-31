-- =============================================================================
-- 183_statutory_multi_code.sql
-- Multi-code support for EPF, ESI, and PTax registrations.
--
-- EPF / ESI: Extend statutory_registrations with:
--   - code_label   (display name like "Mumbai HO", "Pune Factory")
--   - is_default   (flag: which code is the primary one per type per tenant)
--   - pf_sub_code  (EPF-specific 3-digit sub-establishment suffix)
--
-- PTax: Extend ptax_state_settings with:
--   - registration_number  (PTRC or PT registration number issued by the state)
--   - registration_date    (date of registration certificate)
--
-- NOTE: statutory_registrations was defined in migration 166 but may not exist
-- in all deployments.  This migration creates it (IF NOT EXISTS) before altering.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ensure statutory_registrations exists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id             UUID REFERENCES sites(id) ON DELETE SET NULL,
    statutory_type      TEXT NOT NULL CHECK (statutory_type IN ('epf', 'esi', 'ptax')),
    registration_number TEXT NOT NULL,
    state_code          TEXT,
    effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
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

DROP POLICY IF EXISTS "statreg_tenant_read" ON statutory_registrations;
DROP POLICY IF EXISTS "statreg_hr_write"    ON statutory_registrations;

CREATE POLICY "statreg_tenant_read" ON statutory_registrations
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "statreg_hr_write" ON statutory_registrations
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 2. Add multi-code columns to statutory_registrations
-- ---------------------------------------------------------------------------
ALTER TABLE statutory_registrations
    ADD COLUMN IF NOT EXISTS code_label  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_default  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pf_sub_code VARCHAR(3);

COMMENT ON COLUMN statutory_registrations.code_label  IS 'Human-readable label for this registration (e.g. "Mumbai HO", "Pune Factory")';
COMMENT ON COLUMN statutory_registrations.is_default  IS 'True for the primary/default registration code used when no site-level override exists';
COMMENT ON COLUMN statutory_registrations.pf_sub_code IS 'EPF-specific 3-digit sub-establishment code appended to the main PF account number';

-- One default active registration per (tenant, statutory_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stat_reg_default_per_tenant_type
    ON statutory_registrations (tenant_id, statutory_type)
    WHERE is_default = true AND is_active = true;

-- ---------------------------------------------------------------------------
-- 3. Ensure ptax_state_settings exists (migration 179 may not have run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ptax_state_settings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    state_code  TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
    CONSTRAINT ptax_state_settings_tenant_state_uk UNIQUE (tenant_id, state_code)
);

CREATE INDEX IF NOT EXISTS idx_ptax_state_settings_tenant
    ON ptax_state_settings (tenant_id);

ALTER TABLE ptax_state_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ptax_state_settings_tenant_read" ON ptax_state_settings;
DROP POLICY IF EXISTS "ptax_state_settings_hr_write"    ON ptax_state_settings;

CREATE POLICY "ptax_state_settings_tenant_read" ON ptax_state_settings
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ptax_state_settings_hr_write" ON ptax_state_settings
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 4. Add registration columns to ptax_state_settings
-- ---------------------------------------------------------------------------
ALTER TABLE ptax_state_settings
    ADD COLUMN IF NOT EXISTS registration_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS registration_date   DATE;

COMMENT ON COLUMN ptax_state_settings.registration_number IS 'State-issued PT registration number (PTRC in Maharashtra, etc.)';
COMMENT ON COLUMN ptax_state_settings.registration_date   IS 'Date of issue of the PT registration certificate';
