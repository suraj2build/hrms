-- ============================================================
-- 385_employee_files_storage_tenant_scope.sql
--
-- SECURITY FIX (CRITICAL, ISSUE-125): the 'employee-files' Storage
-- bucket's RLS policies (038_storage_buckets.sql) checked only
-- `auth.role() = 'authenticated'` — no tenant scoping at all. Any
-- authenticated user of ANY tenant could call the Supabase client
-- already shipped in the frontend bundle (apps/web/src/lib/
-- supabase-storage.ts) to list() another tenant's folder (a UUID),
-- then download()/upload()/remove() their Aadhaar/PAN scans,
-- contracts, offer letters, and onboarding docs.
--
-- Every writer of this bucket uses the path convention
-- `{tenantId}/...` (uploadEmployeeFile, uploadCompanyLogo in
-- supabase-storage.ts; confirmed against owner/index.ts's own
-- purgeTenantStorage doc comment: "All uploaded files ... live in
-- the 'employee-files' bucket under the path `{tenantId}/...`").
-- Server-side writers (documents/index.ts, education.ts, etc.) use
-- the service-role key and bypass RLS regardless, so are unaffected
-- by this change. The candidate-facing pre-onboarding upload flow
-- (pre-joinee.ts) uses server-issued signed upload/download URLs
-- under a separate `pre-onboarding/{tenantId}/{invitationId}/...`
-- prefix and its own explicit prefix check — also unaffected, since
-- signed-URL tokens carry their own authorization independent of
-- these `auth.role()='authenticated'` policies.
--
-- This mirrors the correct pattern already in use for the
-- 'attendance-uploads' bucket (363_attendance_upload_storage.sql).
-- ============================================================

DROP POLICY IF EXISTS "emp_files_read"   ON storage.objects;
DROP POLICY IF EXISTS "emp_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "emp_files_delete" ON storage.objects;

CREATE POLICY "emp_files_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'employee-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

CREATE POLICY "emp_files_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

CREATE POLICY "emp_files_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'employee-files'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );
