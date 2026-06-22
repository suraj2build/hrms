-- Migration 294: Background Verification (BGV) workflow
--
-- A BGV case is opened per application (candidate) and tracks individual checks
-- (identity, education, employment, criminal, address, reference). Vendor-agnostic:
-- HR records each check's status + vendor reference + remarks (+ an optional report
-- document path); a real vendor-API integration can write the same rows later.

CREATE TABLE IF NOT EXISTS bgv_cases (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id  UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id    UUID        REFERENCES candidates(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('not_started','in_progress','clear','flagged','cancelled')),
  vendor          TEXT,
  initiated_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  initiated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  overall_remarks TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);
CREATE INDEX IF NOT EXISTS idx_bgv_cases_tenant ON bgv_cases (tenant_id, status);

CREATE TABLE IF NOT EXISTS bgv_checks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id       UUID        NOT NULL REFERENCES bgv_cases(id) ON DELETE CASCADE,
  check_type    TEXT        NOT NULL
                CHECK (check_type IN ('identity','education','employment','criminal','address','reference')),
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','initiated','in_progress','clear','flagged','not_applicable')),
  vendor_ref    TEXT,
  remarks       TEXT,
  document_path TEXT,
  document_name TEXT,
  verified_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, check_type)
);
CREATE INDEX IF NOT EXISTS idx_bgv_checks_case ON bgv_checks (tenant_id, case_id);

ALTER TABLE bgv_cases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bgv_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bgv_case_hr_all"  ON bgv_cases  FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "bgv_case_self"    ON bgv_cases  FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "bgv_check_hr_all" ON bgv_checks FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "bgv_check_self"   ON bgv_checks FOR SELECT USING (tenant_id = get_user_tenant_id());
