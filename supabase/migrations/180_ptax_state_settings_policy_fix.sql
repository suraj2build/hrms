-- ---------------------------------------------------------------------------
-- Migration 180: Fix RLS policies for ptax_state_settings
--
-- Migration 179 may have partially applied (table created, but one or both
-- policies already existed from a prior attempt).  This migration drops and
-- recreates them idempotently.
-- ---------------------------------------------------------------------------

ALTER TABLE ptax_state_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ptax_state_settings_tenant_read" ON ptax_state_settings;
DROP POLICY IF EXISTS "ptax_state_settings_hr_write"    ON ptax_state_settings;

CREATE POLICY "ptax_state_settings_tenant_read" ON ptax_state_settings
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ptax_state_settings_hr_write" ON ptax_state_settings
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
