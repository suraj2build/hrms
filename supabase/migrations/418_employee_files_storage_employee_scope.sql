-- ============================================================
-- 418_employee_files_storage_employee_scope.sql
--
-- PEND-30 (AUDIT_CONSTITUTION.md §14.6): 385_employee_files_storage_tenant_scope.sql
-- (ISSUE-125) fixed the 'employee-files' bucket's RLS to check the tenant
-- path segment ((storage.foldername(name))[1]) but never checked the
-- second segment ({employeeId}). Every writer uses the path convention
-- `{tenantId}/{employeeId}/...` (uploadEmployeeFile in
-- apps/web/src/lib/supabase-storage.ts), so any authenticated employee in
-- the same tenant could call the Supabase client shipped in the frontend
-- bundle to list()/createSignedUrl()/upload()/remove() on another
-- employee's folder — reading, overwriting, or deleting their Aadhaar,
-- PAN, contracts, offer letters, and photos.
--
-- Confirmed via repo-wide grep that every legitimate direct-storage caller
-- in apps/web either uploads under the caller's own employee_id
-- (EssDocuments.tsx, EssFBP.tsx, TaxDeclarations.tsx, TaxPlanner.tsx — all
-- self-service, gated to the employee's own record) or is an HR-admin-tier
-- page uploading/reading on an employee's behalf (EmployeeProfile.tsx,
-- Documents.tsx, HRReviewWorkspace.tsx — all gated inline to
-- ['super_admin','hr_admin'], matching apps/api/src/lib/rbac.ts's
-- HR_ADMIN_ROLES). No manager-tier direct-storage caller exists today, so
-- the policy only needs two cases: the caller's own employee_id, or an
-- HR-admin-tier role.
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS "emp_files_read"   ON storage.objects;
DROP POLICY IF EXISTS "emp_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "emp_files_delete" ON storage.objects;

CREATE POLICY "emp_files_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'employee-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
    AND (
      get_user_role() IN ('super_admin', 'hr_admin')
      OR (storage.foldername(name))[2] = get_user_employee_id()::text
    )
  );

CREATE POLICY "emp_files_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
    AND (
      get_user_role() IN ('super_admin', 'hr_admin')
      OR (storage.foldername(name))[2] = get_user_employee_id()::text
    )
  );

CREATE POLICY "emp_files_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'employee-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
    AND (
      get_user_role() IN ('super_admin', 'hr_admin')
      OR (storage.foldername(name))[2] = get_user_employee_id()::text
    )
  );
