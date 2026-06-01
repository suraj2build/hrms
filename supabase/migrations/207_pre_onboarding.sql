-- Migration 207: Pre-Onboarding (Pre-Joinee Invitations & Submissions)

-- ============================================================
-- TABLE: pre_joinee_invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS pre_joinee_invitations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token             TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  first_name        TEXT        NOT NULL,
  last_name         TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  phone             TEXT,
  designation       TEXT,
  department        TEXT,
  joining_date      DATE        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'expired')),
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  employee_id       UUID        REFERENCES employees(id) ON DELETE SET NULL,  -- set when approved → employee created
  notes             TEXT,                                                      -- rejection reason / HR notes
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ============================================================
-- TABLE: pre_joinee_submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS pre_joinee_submissions (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id               UUID        NOT NULL UNIQUE REFERENCES pre_joinee_invitations(id) ON DELETE CASCADE,
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Personal
  dob                         DATE,
  gender                      TEXT,
  blood_group                 TEXT,
  marital_status              TEXT,
  nationality                 TEXT        DEFAULT 'Indian',

  -- Address
  address_line1               TEXT,
  address_line2               TEXT,
  city                        TEXT,
  state                       TEXT,
  pincode                     TEXT,

  -- Emergency Contact
  emergency_contact_name      TEXT,
  emergency_contact_phone     TEXT,
  emergency_contact_relation  TEXT,

  -- Bank
  bank_name                   TEXT,
  bank_account_number         TEXT,
  bank_ifsc                   TEXT,
  bank_account_type           TEXT        DEFAULT 'savings',

  -- Compliance
  pan_number                  TEXT,
  aadhaar_number              TEXT,
  uan_number                  TEXT,

  -- Status flags
  documents_uploaded          BOOLEAN     NOT NULL DEFAULT false,
  declaration_accepted        BOOLEAN     NOT NULL DEFAULT false,
  submitted_at                TIMESTAMPTZ,

  -- Review
  reviewed_by                 UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at                 TIMESTAMPTZ,
  review_notes                TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES: pre_joinee_invitations
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pji_tenant_id  ON pre_joinee_invitations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pji_token      ON pre_joinee_invitations (token);
CREATE INDEX IF NOT EXISTS idx_pji_email      ON pre_joinee_invitations (email);
CREATE INDEX IF NOT EXISTS idx_pji_status     ON pre_joinee_invitations (status);

-- ============================================================
-- INDEXES: pre_joinee_submissions
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pjs_tenant_id     ON pre_joinee_submissions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pjs_invitation_id ON pre_joinee_submissions (invitation_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE pre_joinee_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_joinee_submissions  ENABLE ROW LEVEL SECURITY;

-- pre_joinee_invitations: service_role full access
CREATE POLICY "service_role_all_pji"
  ON pre_joinee_invitations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- pre_joinee_invitations: anon deny (no access)
CREATE POLICY "anon_deny_pji"
  ON pre_joinee_invitations
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- pre_joinee_submissions: service_role full access
CREATE POLICY "service_role_all_pjs"
  ON pre_joinee_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- pre_joinee_submissions: anon deny (no access)
CREATE POLICY "anon_deny_pjs"
  ON pre_joinee_submissions
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
