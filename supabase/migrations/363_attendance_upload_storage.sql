-- ================================================================
-- 363_attendance_upload_storage.sql
--
-- Create the 'attendance-uploads' Supabase Storage bucket used by
-- the async attendance upload flow.
--
-- Why: sending a 25 MB+ CSV as a JSON request body via Railway
-- triggers ERR_HTTP2_PING_FAILED before the server can respond,
-- because Railway's proxy drops connections whose body upload exceeds
-- its timeout.  The fix: the browser uploads the CSV directly to
-- Supabase Storage (bypassing Railway), then sends only the storage
-- path (a tiny JSON body) to the API.
--
-- Policies:
--   - Authenticated tenant members may upload files.
--   - Authenticated tenant members may read/delete files in their
--     own tenant folder (path prefix = tenant_id).
--   - Service role bypasses RLS and can read any path.
-- ================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-uploads',
  'attendance-uploads',
  false,
  104857600,      -- 100 MB max per file
  ARRAY['text/csv', 'text/plain', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload into their own tenant folder.
CREATE POLICY "attendance_upload_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attendance-uploads'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

-- Allow authenticated users to read files in their own tenant folder.
CREATE POLICY "attendance_upload_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attendance-uploads'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

-- Allow authenticated users to delete their own files (cleanup after job).
CREATE POLICY "attendance_upload_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'attendance-uploads'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

-- Add storage_path to jobs table so the background worker knows where the file lives.
ALTER TABLE attendance_upload_jobs
  ADD COLUMN IF NOT EXISTS storage_path TEXT;
