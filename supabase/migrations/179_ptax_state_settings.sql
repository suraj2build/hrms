-- ---------------------------------------------------------------------------
-- Migration 179: P-Tax per-tenant state enable/disable settings
--
-- Adds a lightweight table that tracks which states are "enabled" for a
-- tenant's P-Tax computation, independently of whether slabs have been
-- configured.  One row per (tenant, state_code).
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
