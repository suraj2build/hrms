-- ============================================================
-- 128_upload_sessions.sql
-- Upload lifecycle tracking table.
--
-- Tracks every file upload attempt from initiation through
-- completion, failure, or expiry. Provides:
--   · Audit trail for all upload operations
--   · Orphan detection (sessions that never completed)
--   · Async status visibility (uploading → processing → completed)
--   · Signed URL lifecycle management (expires_at)
--
-- Previously the upload surface had no server-side session
-- tracking. Files could be uploaded to storage without a
-- corresponding DB row, or DB rows could be created without
-- a corresponding storage file.
-- ============================================================

CREATE TABLE IF NOT EXISTS upload_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Upload classification
  upload_type           TEXT        NOT NULL CHECK (upload_type IN (
    'attendance_csv',       -- POST /attendance/upload
    'employee_document',    -- POST /employees/:id/documents
    'onboarding_document',  -- POST /onboarding/sessions/:id/documents
    'import_file',          -- POST /import/run
    'profile_photo'         -- employee photo upload
  )),

  -- Lifecycle state
  status                TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- session created, upload not yet started
    'uploading',    -- client is actively uploading (pre-signed URL issued)
    'uploaded',     -- binary received in storage; processing not yet started
    'processing',   -- backend is processing (recompute, extraction, etc.)
    'completed',    -- processing finished successfully
    'failed',       -- processing error
    'expired',      -- signed URL expired before upload completed
    'orphaned'      -- never completed within grace period (24h)
  )),

  -- File metadata (populated once the upload completes)
  storage_path          TEXT,                   -- Supabase Storage path
  bucket                TEXT        NOT NULL DEFAULT 'employee-files',
  file_name             TEXT,                   -- original client filename
  file_size             BIGINT,                 -- bytes
  mime_type             TEXT,

  -- Reference to the domain object this upload belongs to
  reference_id          UUID,                   -- employee_id, session_id, import_job_id, etc.
  reference_type        TEXT        CHECK (reference_type IN (
    'employee', 'onboarding_session', 'import_job', 'attendance_batch', 'tenant'
  )),

  -- Processing results (populated after completion)
  result_summary        JSONB,                  -- success/failure counts, row counts, etc.
  error_message         TEXT,                   -- human-readable failure reason

  -- Operational metadata
  metadata              JSONB       NOT NULL DEFAULT '{}',

  -- Lifecycle timestamps
  upload_started_at     TIMESTAMPTZ,            -- when client began transmitting
  upload_completed_at   TIMESTAMPTZ,            -- when storage confirmed receipt
  processing_started_at TIMESTAMPTZ,            -- when backend picked up the file
  processing_ended_at   TIMESTAMPTZ,            -- when processing finished (success or fail)
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),

  -- Audit
  created_by            UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_upload_sessions_tenant_created
  ON upload_sessions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_tenant_status
  ON upload_sessions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_reference
  ON upload_sessions (reference_id) WHERE reference_id IS NOT NULL;

-- Partial index for orphan detection (pending/uploading sessions older than 1h)
CREATE INDEX IF NOT EXISTS idx_upload_sessions_orphan_scan
  ON upload_sessions (created_at)
  WHERE status IN ('pending', 'uploading', 'uploaded');

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;

-- HR admins can read all upload sessions for their tenant
CREATE POLICY "upload_sessions_hr_read"
  ON upload_sessions FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- HR admins can create upload sessions
CREATE POLICY "upload_sessions_hr_insert"
  ON upload_sessions FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- HR admins can update their own sessions
CREATE POLICY "upload_sessions_hr_update"
  ON upload_sessions FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- ── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_upload_session_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_upload_session_updated_at
  BEFORE UPDATE ON upload_sessions
  FOR EACH ROW EXECUTE FUNCTION set_upload_session_updated_at();

COMMENT ON TABLE upload_sessions IS
  'Tracks every upload lifecycle from initiation through completion or expiry. '
  'Use for audit, orphan detection, and async status visibility.';
