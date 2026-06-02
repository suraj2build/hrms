-- 208_pre_joinee_documents.sql
-- Documents uploaded by a pre-joinee via the public candidate portal.
-- One file per (invitation, document_type) — re-upload replaces the row.

CREATE TABLE IF NOT EXISTS pre_joinee_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invitation_id UUID NOT NULL REFERENCES pre_joinee_invitations(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('cv','pan','aadhaar','cheque','photo','other')),
  file_name     TEXT,
  storage_path  TEXT NOT NULL,
  mime_type     TEXT,
  file_size     INT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invitation_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_pre_joinee_documents_tenant
  ON pre_joinee_documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pre_joinee_documents_invitation
  ON pre_joinee_documents (invitation_id);

ALTER TABLE pre_joinee_documents ENABLE ROW LEVEL SECURITY;

-- service_role: full access (API uses the service-role client)
DROP POLICY IF EXISTS pre_joinee_documents_service_all ON pre_joinee_documents;
CREATE POLICY pre_joinee_documents_service_all
  ON pre_joinee_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- anon: explicitly deny (public portal goes through the token-validated API)
DROP POLICY IF EXISTS pre_joinee_documents_anon_deny ON pre_joinee_documents;
CREATE POLICY pre_joinee_documents_anon_deny
  ON pre_joinee_documents
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
