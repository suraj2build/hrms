-- ISSUE-019: security_alerts and verification_records write policies
-- lacked tenant_id scope, allowing an hr_admin from any tenant to
-- write to another tenant's rows when the row ID is known.
--
-- Both write policies previously checked only the caller's role:
--   USING (get_user_role() IN ('super_admin', 'hr_admin'))
--
-- Fix: drop and recreate each write policy adding the tenant constraint.
-- Read policies already include tenant_id = get_user_tenant_id() and are
-- left unchanged.

-- ── security_alerts ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "sa_hr_write" ON security_alerts;

CREATE POLICY "sa_hr_write" ON security_alerts
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- ── verification_records ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "vr_hr_write" ON verification_records;

CREATE POLICY "vr_hr_write" ON verification_records
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );
