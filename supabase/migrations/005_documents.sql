CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL
               CHECK (doc_type IN ('aadhaar','pan','offer_letter','contract','certificate',
                                   'relieving_letter','experience_letter','other')),
  name         TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size    BIGINT,
  mime_type    TEXT,
  expires_at   DATE,
  uploaded_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_tenant   ON documents(tenant_id);
CREATE INDEX idx_documents_employee ON documents(employee_id);
CREATE INDEX idx_documents_expiry   ON documents(expires_at) WHERE expires_at IS NOT NULL;
