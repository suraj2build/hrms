-- Migration 302: draft_bank_statutory
--
-- Pre-joinee / onboarding-session draft of bank + statutory details, captured
-- before the employee record exists. Mirrors employee_bank_statutory but keyed
-- by onboarding session instead of employee. Referenced by
-- routes/employees/trust.ts (trust-scoring of onboarding drafts).

CREATE TABLE IF NOT EXISTS draft_bank_statutory (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id     UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  account_number TEXT,
  ifsc_code      TEXT,
  bank_name      TEXT,
  branch_name    TEXT,
  account_type   TEXT,
  pan_number     TEXT,
  aadhaar_number TEXT,
  uan_number     TEXT,
  esi_number     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_draft_bank_session ON draft_bank_statutory (tenant_id, session_id);

ALTER TABLE draft_bank_statutory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "draft_bank_hr_all" ON draft_bank_statutory;
DROP POLICY IF EXISTS "draft_bank_tenant" ON draft_bank_statutory;
CREATE POLICY "draft_bank_hr_all" ON draft_bank_statutory FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "draft_bank_tenant" ON draft_bank_statutory FOR SELECT USING (tenant_id = get_user_tenant_id());
