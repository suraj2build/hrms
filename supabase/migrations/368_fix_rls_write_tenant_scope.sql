-- 368_fix_rls_write_tenant_scope.sql
--
-- Defence-in-depth: add tenant_id scoping to HR write policies that previously
-- only checked the user's role.  Without this an hr_admin or super_admin from
-- a different tenant could write cross-tenant rows if they had direct Supabase
-- (non-API) access — e.g. via the Supabase Studio or a direct PostgREST call
-- with their own JWT.
--
-- The application API routes always filter by req.tenantId, so normal product
-- usage is safe.  These fixes harden the database layer as a second barrier.
--
-- Pattern: USING (role_check) → USING (tenant_id = get_user_tenant_id() AND role_check)

-- ── attendance_logs ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "hr_write_al" ON attendance_logs;
CREATE POLICY "hr_write_al" ON attendance_logs
  FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── attendance_daily ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "hr_write_ad" ON attendance_daily;
CREATE POLICY "hr_write_ad" ON attendance_daily
  FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── attendance_devices ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "hr_write_adev" ON attendance_devices;
CREATE POLICY "hr_write_adev" ON attendance_devices
  FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── attendance_anomalies ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aa_hr_write" ON attendance_anomalies;
CREATE POLICY "aa_hr_write" ON attendance_anomalies
  FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── job_history ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "jh_hr_all" ON job_history;
CREATE POLICY "jh_hr_all" ON job_history
  FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── profiles (UPDATE) ────────────────────────────────────────────────────────
-- The hr_admin/super_admin branch previously had no tenant_id check, allowing
-- cross-tenant profile edits.  Own-user update (id = auth.uid()) stays open
-- because the JWT already scopes it to one identity.
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING (
    id = auth.uid()
    OR (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'))
  );

-- ── attendance_raw_logs (INSERT) ─────────────────────────────────────────────
-- Original policy used WITH CHECK (true) — any authenticated user could insert
-- rows for any tenant.  The service role (used by the ingest API) bypasses RLS
-- entirely, so it is unaffected.  Regular authenticated users are now limited to
-- inserting rows for their own tenant only.
DROP POLICY IF EXISTS "service_insert_arl" ON attendance_raw_logs;
CREATE POLICY "service_insert_arl" ON attendance_raw_logs
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
