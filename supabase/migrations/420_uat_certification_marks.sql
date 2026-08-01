-- ============================================================
-- 420_uat_certification_marks.sql
--
-- PEND-88: UATCertification.tsx persisted sign-off state entirely in
-- localStorage — per-browser, no backend record, no reviewer-identity
-- requirement, and no audit trail. A user could mark every checklist item
-- "N/A" in seconds and get a green "CERTIFIED" badge with zero
-- substantiation, and the marks vanished on a cleared browser or a
-- different device.
--
-- Persist marks server-side, one row per (tenant, checklist item), with the
-- reviewer identity captured from the authenticated write itself
-- (updated_by) rather than a free-text field the reviewer could type
-- anything into.
-- ============================================================

CREATE TABLE IF NOT EXISTS uat_certification_marks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pass','fail','na')),
    note        TEXT,
    updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_uat_certification_marks_tenant ON uat_certification_marks(tenant_id);

ALTER TABLE uat_certification_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucm_hr_read" ON uat_certification_marks
    FOR SELECT
    USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ucm_hr_write" ON uat_certification_marks
    FOR ALL
    USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
