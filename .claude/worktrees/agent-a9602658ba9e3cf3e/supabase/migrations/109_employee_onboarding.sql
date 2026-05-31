-- ============================================================
-- 109_employee_onboarding.sql
-- AI-Assisted Employee Onboarding Infrastructure
-- Document ingestion → AI extraction → draft profiles → HR review → employee creation
-- ============================================================

-- onboarding_sessions: groups all documents for one candidate
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_name      TEXT,
  status              TEXT        NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'extracting', 'draft_ready', 'hr_review',
    'validation_pending', 'approved', 'rejected', 'employee_created', 'archived'
  )),
  extraction_progress INT         NOT NULL DEFAULT 0,   -- 0-100
  extraction_error    TEXT,
  assigned_to         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_by          UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- onboarding_documents: metadata for each uploaded document
CREATE TABLE IF NOT EXISTS onboarding_documents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  document_type       TEXT        NOT NULL CHECK (document_type IN (
    'aadhaar', 'pan', 'passport', 'driving_license',
    'resume', 'offer_letter', 'experience_letter', 'relieving_letter', 'joining_letter',
    'salary_slip', 'compensation_letter', 'bank_proof',
    'pf_uan_document', 'esi_document', 'tax_document', 'other'
  )),
  file_name           TEXT        NOT NULL,
  file_size           INT,
  mime_type           TEXT,
  storage_path        TEXT        NOT NULL,       -- Supabase Storage path
  extraction_status   TEXT        NOT NULL DEFAULT 'pending' CHECK (extraction_status IN (
    'pending', 'processing', 'extracted', 'failed', 'skipped'
  )),
  extraction_error    TEXT,
  extraction_version  TEXT        DEFAULT 'claude-3-5-haiku',
  confidence_score    DECIMAL(4,3),               -- overall doc confidence 0.000–1.000
  review_status       TEXT        NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending', 'reviewed', 'approved', 'rejected'
  )),
  extracted_text      TEXT,                       -- raw OCR/parsed text (for audit)
  page_count          INT,
  uploaded_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- draft_employee_profiles: consolidated AI + HR data before employee creation
CREATE TABLE IF NOT EXISTS draft_employee_profiles (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'extraction_complete' CHECK (status IN (
    'extraction_complete', 'hr_review_pending', 'validation_pending',
    'approval_pending', 'approved', 'rejected', 'employee_created'
  )),

  -- Core identity
  first_name          TEXT,
  last_name           TEXT,
  email               TEXT,
  phone               TEXT,
  dob                 DATE,
  gender              TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
  address_line1       TEXT,
  address_city        TEXT,
  address_state       TEXT,
  address_pincode     TEXT,

  -- Employment
  employee_code       TEXT,
  joining_date        DATE,
  department_id       UUID        REFERENCES departments(id) ON DELETE SET NULL,
  designation_id      UUID        REFERENCES designations(id) ON DELETE SET NULL,
  grade_id            UUID        REFERENCES grades(id) ON DELETE SET NULL,
  employment_type     TEXT        CHECK (employment_type IN (
    'permanent', 'contract', 'intern', 'probation', 'consultant'
  )),

  -- Payroll / compliance
  pan_number          TEXT,
  uan_number          TEXT,
  esi_number          TEXT,
  pf_number           TEXT,
  bank_name           TEXT,
  bank_account_number TEXT,
  bank_ifsc           TEXT,
  bank_account_type   TEXT,
  ctc_annual          DECIMAL(14,2),

  -- Previous employment summary
  previous_employer   TEXT,
  previous_designation TEXT,

  -- Validation results
  validation_errors   JSONB,      -- [{field, message, severity}]
  validation_warnings JSONB,      -- [{field, message}]
  duplicate_risk      JSONB,      -- {pan: bool, uan: bool, email: bool, similar_names: [...]}

  -- HR governance
  hr_overrides        JSONB,      -- {field: {original, override, overridden_by, overridden_at}}
  approved_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  linked_employee_id  UUID        REFERENCES employees(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- draft_employee_fields: field-level extraction with source traceability
-- Every extracted field points back to its source document
CREATE TABLE IF NOT EXISTS draft_employee_fields (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  draft_id            UUID        NOT NULL REFERENCES draft_employee_profiles(id) ON DELETE CASCADE,
  document_id         UUID        REFERENCES onboarding_documents(id) ON DELETE SET NULL,
  field_name          TEXT        NOT NULL,        -- e.g. 'pan_number', 'first_name'
  extracted_value     TEXT,
  normalized_value    TEXT,                        -- post-normalization (uppercase PAN, etc.)
  confidence_score    DECIMAL(4,3),
  source_document_type TEXT,                       -- 'pan', 'resume', etc.
  extraction_reasoning TEXT,                       -- Claude's brief explanation
  is_conflicting      BOOLEAN     NOT NULL DEFAULT false,
  conflict_note       TEXT,                        -- describes the conflict
  is_hr_override      BOOLEAN     NOT NULL DEFAULT false,
  override_value      TEXT,
  override_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  override_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- onboarding_audit_log: every action on a session or draft
CREATE TABLE IF NOT EXISTS onboarding_audit_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  session_id          UUID        REFERENCES onboarding_sessions(id) ON DELETE SET NULL,
  draft_id            UUID        REFERENCES draft_employee_profiles(id) ON DELETE SET NULL,
  action              TEXT        NOT NULL,  -- 'document_uploaded', 'extraction_started', 'field_overridden', 'approved', etc.
  actor_id            UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  details             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_tenant    ON onboarding_sessions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status    ON onboarding_sessions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_docs_session       ON onboarding_documents (session_id, document_type);
CREATE INDEX IF NOT EXISTS idx_onboarding_docs_status        ON onboarding_documents (tenant_id, extraction_status);
CREATE INDEX IF NOT EXISTS idx_draft_profiles_session        ON draft_employee_profiles (session_id);
CREATE INDEX IF NOT EXISTS idx_draft_profiles_tenant_status  ON draft_employee_profiles (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_draft_fields_draft            ON draft_employee_fields (draft_id, field_name);
CREATE INDEX IF NOT EXISTS idx_onboarding_audit_session      ON onboarding_audit_log (session_id, created_at DESC);

-- RLS
ALTER TABLE onboarding_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_employee_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_employee_fields    ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_audit_log     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "os_tenant_read"  ON onboarding_sessions     FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "os_hr_write"     ON onboarding_sessions     FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "od_tenant_read"  ON onboarding_documents    FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "od_hr_write"     ON onboarding_documents    FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "dep_tenant_read" ON draft_employee_profiles FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "dep_hr_write"    ON draft_employee_profiles FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "def_tenant_read" ON draft_employee_fields   FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "def_hr_write"    ON draft_employee_fields   FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "oal_tenant_read" ON onboarding_audit_log    FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "oal_hr_write"    ON onboarding_audit_log    FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
