-- ============================================================
-- 012_employee_extended.sql
-- All 11 employee sub-tables:
--   personal_info, previous_employment, bank_statutory,
--   identity, contracts, family, nominations,
--   emergency_contacts, addresses, separation, access_cards
-- ============================================================

-- --------------------------------------------------------
-- EMPLOYEE PERSONAL INFO  (1:1)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_personal_info (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id            UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  gender                 TEXT        CHECK (gender IN ('male','female','other')),
  dob                    DATE,
  marital_status         TEXT        CHECK (marital_status IN ('single','married','divorced','widowed')),
  blood_group            TEXT,
  nationality            TEXT        NOT NULL DEFAULT 'Indian',
  religion               TEXT,
  caste_category         TEXT        CHECK (caste_category IN ('general','obc','sc','st','ews')),
  physically_handicapped BOOLEAN     NOT NULL DEFAULT false,
  profile_photo          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
CREATE INDEX idx_epi_employee ON employee_personal_info (tenant_id, employee_id);

-- --------------------------------------------------------
-- PREVIOUS EMPLOYMENT  (1:N)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS previous_employment (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id        UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_name       TEXT          NOT NULL,
  designation        TEXT,
  department         TEXT,
  from_date          DATE,
  to_date            DATE,
  reason_for_leaving TEXT,
  last_ctc           NUMERIC(14,2),
  reference_name     TEXT,
  reference_contact  TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_prev_emp_employee ON previous_employment (tenant_id, employee_id);

-- --------------------------------------------------------
-- BANK & STATUTORY  (1:1)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_bank_statutory (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id    UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Bank details
  bank_name      TEXT,
  account_number TEXT,             -- store masked (e.g. xxxxxx1234)
  ifsc_code      TEXT,
  branch_name    TEXT,
  account_type   TEXT        CHECK (account_type IN ('savings','current','salary')),
  -- Statutory (India)
  pan_number     TEXT,
  aadhaar_number TEXT,             -- store last 4 digits only (e.g. 'xxxx xxxx 1234')
  uan_number     TEXT,             -- Universal Account Number (PF)
  pf_number      TEXT,             -- Employer PF account number
  esi_number     TEXT,
  pt_applicable  BOOLEAN     NOT NULL DEFAULT false,
  lwf_applicable BOOLEAN     NOT NULL DEFAULT false,
  -- Tax
  tax_regime     TEXT        NOT NULL DEFAULT 'new' CHECK (tax_regime IN ('old','new')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
CREATE INDEX idx_ebs_employee ON employee_bank_statutory (tenant_id, employee_id);

-- --------------------------------------------------------
-- IDENTITY DOCUMENTS  (1:N)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_identity (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  identity_type_id UUID        NOT NULL REFERENCES identity_types(id),
  identity_number  TEXT        NOT NULL,
  issued_by        TEXT,
  issued_date      DATE,
  expiry_date      DATE,
  storage_path     TEXT,       -- scanned copy in Supabase Storage
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ei_employee ON employee_identity (tenant_id, employee_id);

-- --------------------------------------------------------
-- CONTRACTS  (1:N)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_contracts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_type TEXT        NOT NULL
    CHECK (contract_type IN ('appointment','renewal','amendment','nda','other')),
  start_date    DATE        NOT NULL,
  end_date      DATE,
  storage_path  TEXT,
  status        TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','expired','terminated')),
  notes         TEXT,
  created_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ec_employee ON employee_contracts (tenant_id, employee_id);
CREATE INDEX idx_ec_status   ON employee_contracts (tenant_id, status);

-- --------------------------------------------------------
-- FAMILY MEMBERS  (1:N)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_family (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id          UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  relationship_type_id UUID        NOT NULL REFERENCES relationship_types(id),
  name                 TEXT        NOT NULL,
  dob                  DATE,
  gender               TEXT        CHECK (gender IN ('male','female','other')),
  is_dependent         BOOLEAN     NOT NULL DEFAULT false,
  is_nominee           BOOLEAN     NOT NULL DEFAULT false,
  occupation           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ef_employee ON employee_family (tenant_id, employee_id);

-- --------------------------------------------------------
-- NOMINATIONS  (1:N — PF, Gratuity, ESI, Superannuation)
-- share_percentage per scheme must sum to 100
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_nominations (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id          UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  scheme               TEXT          NOT NULL
    CHECK (scheme IN ('pf','gratuity','esi','superannuation')),
  nominee_name         TEXT          NOT NULL,
  relationship_type_id UUID          REFERENCES relationship_types(id),
  dob                  DATE,
  share_percentage     NUMERIC(5,2)  NOT NULL
    CHECK (share_percentage > 0 AND share_percentage <= 100),
  address              TEXT,
  is_minor             BOOLEAN       NOT NULL DEFAULT false,
  guardian_name        TEXT,         -- required if is_minor = true
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_en_employee ON employee_nominations (tenant_id, employee_id);
CREATE INDEX idx_en_scheme   ON employee_nominations (tenant_id, employee_id, scheme);

-- --------------------------------------------------------
-- EMERGENCY CONTACTS  (1:N)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  relationship    TEXT,
  phone           TEXT        NOT NULL,
  alternate_phone TEXT,
  email           TEXT,
  address         TEXT,
  is_primary      BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emcon_employee ON emergency_contacts (tenant_id, employee_id);

-- --------------------------------------------------------
-- ADDRESSES  (1:N — current / permanent / correspondence)
-- One row per address_type per employee (upsert pattern)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_addresses (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id           UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  address_type          TEXT        NOT NULL
    CHECK (address_type IN ('current','permanent','correspondence')),
  line1                 TEXT        NOT NULL,
  line2                 TEXT,
  city                  TEXT        NOT NULL,
  state                 TEXT        NOT NULL,
  country               TEXT        NOT NULL DEFAULT 'India',
  pincode               TEXT,
  is_same_as_permanent  BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, address_type)
);
CREATE INDEX idx_ea_employee ON employee_addresses (tenant_id, employee_id);

-- --------------------------------------------------------
-- SEPARATION  (1:1)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_separation (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id         UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  separation_type     TEXT        NOT NULL
    CHECK (separation_type IN (
      'resignation','termination','retirement','end_of_contract',
      'absconding','deceased','mutual_separation'
    )),
  initiated_by        TEXT        NOT NULL
    CHECK (initiated_by IN ('employee','employer')),
  notice_date         DATE,
  last_working_date   DATE,
  exit_reason         TEXT,
  exit_interview_done BOOLEAN     NOT NULL DEFAULT false,
  exit_interview_date DATE,
  clearance_done      BOOLEAN     NOT NULL DEFAULT false,
  remarks             TEXT,
  created_by          UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
CREATE INDEX idx_sep_employee ON employee_separation (tenant_id, employee_id);

-- --------------------------------------------------------
-- ACCESS CARDS  (1:N — history of issued cards)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_access_cards (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  card_number   TEXT        NOT NULL,
  issued_date   DATE,
  returned_date DATE,
  status        TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','returned','lost','deactivated')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, card_number)
);
CREATE INDEX idx_ac_employee ON employee_access_cards (tenant_id, employee_id);

-- --------------------------------------------------------
-- TRIGGERS: updated_at
-- --------------------------------------------------------
CREATE TRIGGER set_epi_updated_at
  BEFORE UPDATE ON employee_personal_info
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_ebs_updated_at
  BEFORE UPDATE ON employee_bank_statutory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_ea_updated_at
  BEFORE UPDATE ON employee_addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------
-- ROW LEVEL SECURITY
-- --------------------------------------------------------
ALTER TABLE employee_personal_info  ENABLE ROW LEVEL SECURITY;
ALTER TABLE previous_employment     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_bank_statutory ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_identity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_contracts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_family         ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_nominations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_addresses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_separation     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_access_cards   ENABLE ROW LEVEL SECURITY;

-- Policies: HR admins / super admins full access; employees read own
CREATE POLICY "epi_hr_all"  ON employee_personal_info  FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "epi_self"    ON employee_personal_info  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pe_hr_all"   ON previous_employment     FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "pe_self"     ON previous_employment     FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ebs_hr_all"  ON employee_bank_statutory FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ei_hr_all"   ON employee_identity       FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ei_self"     ON employee_identity       FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ecnt_hr_all" ON employee_contracts      FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ecnt_self"   ON employee_contracts      FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ef_hr_all"   ON employee_family         FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ef_self"     ON employee_family         FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "enom_hr_all" ON employee_nominations    FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "enom_self"   ON employee_nominations    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "emc_hr_all"  ON emergency_contacts      FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "emc_self"    ON emergency_contacts      FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ea_hr_all"   ON employee_addresses      FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ea_self"     ON employee_addresses      FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "es_hr_all"   ON employee_separation     FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "eac_hr_all"  ON employee_access_cards   FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
