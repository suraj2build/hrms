-- ============================================================
-- Migration 076: Letter Generation Module
-- ============================================================
-- Tables:
--   letter_templates   — HR-authored Handlebars templates
--   letter_approvals   — approval chain config per template
--   generated_letters  — all issued letters (HR-initiated)
--   letter_requests    — ESS self-service requests from employees
--   letter_approvals_log — per-letter per-level approval audit trail
-- ============================================================

-- ── 1. Letter Templates ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS letter_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- identity
  name            TEXT NOT NULL,                          -- e.g. "Offer Letter"
  code            TEXT NOT NULL,                          -- e.g. "offer_letter"
  category        TEXT NOT NULL DEFAULT 'hr_initiated',   -- hr_initiated | ess_requestable
  letter_type     TEXT NOT NULL,                          -- offer | appointment | confirmation | increment | relieving | experience | salary | custom

  -- content
  subject_template TEXT NOT NULL DEFAULT '',              -- Handlebars subject line
  body_html        TEXT NOT NULL DEFAULT '',              -- Handlebars HTML body
  variables        JSONB NOT NULL DEFAULT '[]',           -- [{key, label, source, required}]

  -- approval
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approval_levels   INTEGER NOT NULL DEFAULT 1,           -- 1..3

  -- meta
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES employees(id),
  updated_by      UUID REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_letter_templates_tenant ON letter_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_letter_templates_category ON letter_templates(tenant_id, category);

-- ── 2. Template Approval Chain Config ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS letter_approval_chains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES letter_templates(id) ON DELETE CASCADE,

  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  approver_role   TEXT NOT NULL,   -- hr_admin | manager | super_admin
  label           TEXT NOT NULL,   -- e.g. "HR Manager", "Department Head"

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (template_id, level)
);

-- ── 3. Generated Letters (HR-initiated) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS generated_letters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  template_id     UUID NOT NULL REFERENCES letter_templates(id),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- resolved content
  subject         TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  variable_values JSONB NOT NULL DEFAULT '{}',            -- {key: resolvedValue}
  missing_vars    TEXT[] NOT NULL DEFAULT '{}',           -- keys that had no value

  -- PDF
  pdf_url         TEXT,                                   -- Supabase Storage path
  pdf_generated_at TIMESTAMPTZ,

  -- approval state
  approval_status TEXT NOT NULL DEFAULT 'draft'           -- draft | pending_approval | approved | rejected | issued
    CHECK (approval_status IN ('draft','pending_approval','approved','rejected','issued')),
  current_level   INTEGER NOT NULL DEFAULT 0,             -- 0 = no approval needed / approved
  rejection_reason TEXT,

  -- issuance
  issued_at       TIMESTAMPTZ,
  issued_by       UUID REFERENCES employees(id),

  -- meta
  created_by      UUID REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_letters_tenant   ON generated_letters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_generated_letters_employee ON generated_letters(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_generated_letters_status   ON generated_letters(tenant_id, approval_status);

-- ── 4. Letter Approval Log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS letter_approval_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  letter_id       UUID NOT NULL REFERENCES generated_letters(id) ON DELETE CASCADE,
  level           INTEGER NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('approved','rejected','recalled')),
  actor_id        UUID NOT NULL REFERENCES employees(id),
  comments        TEXT,
  acted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letter_approval_log_letter ON letter_approval_log(letter_id);

-- ── 5. ESS Letter Requests ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS letter_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES letter_templates(id),

  reason          TEXT,                                   -- employee's stated purpose
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- HR processing
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','fulfilled','rejected')),
  processed_by    UUID REFERENCES employees(id),
  processed_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  generated_letter_id UUID REFERENCES generated_letters(id),  -- set when fulfilled

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letter_requests_tenant   ON letter_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_letter_requests_employee ON letter_requests(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_letter_requests_status   ON letter_requests(tenant_id, status);

-- ── 6. Updated_at triggers ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_letter_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_letter_templates_updated_at  ON letter_templates;
DROP TRIGGER IF EXISTS trg_generated_letters_updated_at ON generated_letters;
DROP TRIGGER IF EXISTS trg_letter_requests_updated_at   ON letter_requests;

CREATE TRIGGER trg_letter_templates_updated_at
  BEFORE UPDATE ON letter_templates
  FOR EACH ROW EXECUTE FUNCTION update_letter_updated_at();

CREATE TRIGGER trg_generated_letters_updated_at
  BEFORE UPDATE ON generated_letters
  FOR EACH ROW EXECUTE FUNCTION update_letter_updated_at();

CREATE TRIGGER trg_letter_requests_updated_at
  BEFORE UPDATE ON letter_requests
  FOR EACH ROW EXECUTE FUNCTION update_letter_updated_at();

-- ── 7. Row-Level Security ─────────────────────────────────────────────────────

ALTER TABLE letter_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE letter_approval_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_letters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE letter_approval_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE letter_requests        ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (API uses service-role key)
-- Auth users see only their tenant

DROP POLICY IF EXISTS letter_templates_tenant_iso ON letter_templates;
CREATE POLICY letter_templates_tenant_iso ON letter_templates
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS letter_approval_chains_tenant_iso ON letter_approval_chains;
CREATE POLICY letter_approval_chains_tenant_iso ON letter_approval_chains
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS generated_letters_tenant_iso ON generated_letters;
CREATE POLICY generated_letters_tenant_iso ON generated_letters
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS letter_approval_log_tenant_iso ON letter_approval_log;
CREATE POLICY letter_approval_log_tenant_iso ON letter_approval_log
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS letter_requests_tenant_iso ON letter_requests;
CREATE POLICY letter_requests_tenant_iso ON letter_requests
  USING (tenant_id = get_user_tenant_id());

-- ── 8. Seed: default templates for new tenants ───────────────────────────────
-- (These are starter templates — HR can customise them in the Template Manager)

-- NOTE: These are inserted per-tenant at tenant onboarding time by the
-- application layer (POST /tenants/:id/seed-letters), not here, because
-- tenant_id is not known at migration time.
