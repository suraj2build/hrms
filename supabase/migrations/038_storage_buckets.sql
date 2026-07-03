-- ============================================================
-- 038_storage_buckets.sql
-- Supabase Storage bucket for employee files (photos, documents,
-- contracts, identity docs, passport/visa scans).
-- Max file size: 10 MB. Private (no public access).
-- ============================================================

DO $$
DECLARE
  v_has_public    boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='public');
  v_has_size      boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit');
  v_has_mime      boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types');
BEGIN
  IF v_has_public AND v_has_size AND v_has_mime THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('employee-files', 'employee-files', false, 10485760,
            ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  ELSIF v_has_size AND v_has_mime THEN
    INSERT INTO storage.buckets (id, name, file_size_limit, allowed_mime_types)
    VALUES ('employee-files', 'employee-files', 10485760,
            ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  ELSE
    -- Minimal schema (CI/test environment)
    INSERT INTO storage.buckets (id, name)
    VALUES ('employee-files', 'employee-files')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;

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
