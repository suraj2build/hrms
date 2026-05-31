-- 184_muster_upload.sql
-- Muster upload: audit table + attendance_daily source tracking

-- ── Audit table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS muster_uploads (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  uploaded_by    uuid        NOT NULL REFERENCES profiles(id),
  filename       text        NOT NULL,
  period_from    date        NOT NULL,
  period_to      date        NOT NULL,
  row_count      int         NOT NULL DEFAULT 0,
  success_count  int         NOT NULL DEFAULT 0,
  error_count    int         NOT NULL DEFAULT 0,
  errors         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_muster_uploads_tenant
  ON muster_uploads(tenant_id, created_at DESC);

ALTER TABLE muster_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY muster_uploads_tenant_isolation ON muster_uploads
  USING (
    tenant_id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- ── Extend attendance_daily ─────────────────────────────────────────────────
-- source: where this row came from (biometric punch processing, muster upload, etc.)
-- muster_upload_id: FK to the specific upload batch for audit trail
ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS source          text DEFAULT 'biometric'
    CHECK (source IN ('biometric', 'muster', 'regularisation', 'correction')),
  ADD COLUMN IF NOT EXISTS muster_upload_id uuid REFERENCES muster_uploads(id);

CREATE INDEX IF NOT EXISTS idx_attendance_daily_muster
  ON attendance_daily(tenant_id, muster_upload_id)
  WHERE muster_upload_id IS NOT NULL;
