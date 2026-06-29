-- Migration 325: HR Policy Knowledge Base + Acknowledgement Workflow
--
-- Creates two new tables:
--   hr_policies            — company policy documents (HR-authored, versioned)
--   policy_acknowledgements — per-employee ack records (one-time, immutable)

-- ── hr_policies ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_policies (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                    TEXT        NOT NULL,
  category                 TEXT        NOT NULL DEFAULT 'other'
    CHECK (category IN ('leave','compensation','conduct','recruitment','learning','health','it','other')),
  description              TEXT,
  content                  TEXT,
  file_url                 TEXT,
  status                   TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  version                  SMALLINT    NOT NULL DEFAULT 1,
  requires_acknowledgement BOOLEAN     NOT NULL DEFAULT false,
  effective_from           DATE,
  published_at             TIMESTAMPTZ,
  published_by             UUID        REFERENCES profiles(id)  ON DELETE SET NULL,
  created_by               UUID        REFERENCES profiles(id)  ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_status
  ON hr_policies(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_published
  ON hr_policies(tenant_id, category)
  WHERE status = 'published';

-- ── policy_acknowledgements ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  policy_id       UUID        NOT NULL REFERENCES hr_policies(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_acks_policy
  ON policy_acknowledgements(tenant_id, policy_id);

CREATE INDEX IF NOT EXISTS idx_policy_acks_employee
  ON policy_acknowledgements(tenant_id, employee_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_hr_policies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hr_policies_updated_at ON hr_policies;
CREATE TRIGGER trg_hr_policies_updated_at
  BEFORE UPDATE ON hr_policies
  FOR EACH ROW EXECUTE FUNCTION update_hr_policies_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE hr_policies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_acknowledgements ENABLE ROW LEVEL SECURITY;

-- HR admins have full access to policies
DROP POLICY IF EXISTS "hr_policies_admin_all" ON hr_policies;
CREATE POLICY "hr_policies_admin_all" ON hr_policies FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));

-- All authenticated tenant members can read published policies
DROP POLICY IF EXISTS "hr_policies_read_published" ON hr_policies;
CREATE POLICY "hr_policies_read_published" ON hr_policies FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND status = 'published');

-- All authenticated tenant members can read/write their own acks
DROP POLICY IF EXISTS "policy_acks_tenant_all" ON policy_acknowledgements;
CREATE POLICY "policy_acks_tenant_all" ON policy_acknowledgements FOR ALL
  USING (tenant_id = get_user_tenant_id());
