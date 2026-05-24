-- ============================================================
-- 038_storage_buckets.sql
-- Supabase Storage bucket for employee files (photos, documents,
-- contracts, identity docs, passport/visa scans).
-- Max file size: 10 MB. Private (no public access).
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-files',
  'employee-files',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users in the tenant can read their own files
CREATE POLICY "emp_files_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'employee-files' AND auth.role() = 'authenticated');

-- Authenticated users can upload files
CREATE POLICY "emp_files_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'employee-files' AND auth.role() = 'authenticated');

-- Authenticated users can delete files
CREATE POLICY "emp_files_delete" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'employee-files' AND auth.role() = 'authenticated');
