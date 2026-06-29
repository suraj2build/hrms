-- Migration 335: Internal Talent Marketplace
-- Employees register interest in open internal roles; HR sees the talent pool.

-- ── Open internal roles (posted by HR) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS talent_roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  department      TEXT,
  location        TEXT,
  description     TEXT,
  skills_required TEXT[],
  experience_min  SMALLINT,  -- minimum years of experience
  is_open         BOOLEAN     NOT NULL DEFAULT true,
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at       TIMESTAMPTZ,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Employee interest registrations ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS talent_interests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id         UUID        NOT NULL REFERENCES talent_roles(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cover_note      TEXT,
  skills          TEXT[],
  availability    TEXT        CHECK (availability IN ('immediate','1_month','3_months','open')),
  status          TEXT        NOT NULL DEFAULT 'interested'
                  CHECK (status IN ('interested','shortlisted','selected','not_selected','withdrawn')),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reviewer_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, employee_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_talent_roles_tenant_open
  ON talent_roles(tenant_id, is_open);

CREATE INDEX IF NOT EXISTS idx_talent_roles_tenant_created
  ON talent_roles(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_talent_interests_role
  ON talent_interests(tenant_id, role_id, status);

CREATE INDEX IF NOT EXISTS idx_talent_interests_employee
  ON talent_interests(tenant_id, employee_id);

-- ── Updated_at triggers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_talent_roles_ts() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_talent_roles_ts ON talent_roles;
CREATE TRIGGER trg_talent_roles_ts
  BEFORE UPDATE ON talent_roles
  FOR EACH ROW EXECUTE FUNCTION update_talent_roles_ts();

DROP TRIGGER IF EXISTS trg_talent_interests_ts ON talent_interests;
CREATE TRIGGER trg_talent_interests_ts
  BEFORE UPDATE ON talent_interests
  FOR EACH ROW EXECUTE FUNCTION update_talent_roles_ts();

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE talent_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE talent_interests ENABLE ROW LEVEL SECURITY;

-- Roles: HR can manage all; employees can read open roles
DROP POLICY IF EXISTS "talent_roles_admin" ON talent_roles;
CREATE POLICY "talent_roles_admin" ON talent_roles FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "talent_roles_employee_read" ON talent_roles;
CREATE POLICY "talent_roles_employee_read" ON talent_roles FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND is_open = true);

-- Interests: HR can see all; employees can manage their own
DROP POLICY IF EXISTS "talent_interests_admin" ON talent_interests;
CREATE POLICY "talent_interests_admin" ON talent_interests FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "talent_interests_employee_read" ON talent_interests;
CREATE POLICY "talent_interests_employee_read" ON talent_interests FOR SELECT
  USING (tenant_id = get_user_tenant_id()
         AND employee_id = (
           SELECT id FROM employees
           WHERE id = (
             SELECT employee_id FROM profiles
             WHERE id = auth.uid() AND tenant_id = get_user_tenant_id()
             LIMIT 1
           )
         ));

DROP POLICY IF EXISTS "talent_interests_employee_insert" ON talent_interests;
CREATE POLICY "talent_interests_employee_insert" ON talent_interests FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "talent_interests_employee_update" ON talent_interests;
CREATE POLICY "talent_interests_employee_update" ON talent_interests FOR UPDATE
  USING (tenant_id = get_user_tenant_id()
         AND (
           get_user_role() IN ('super_admin','hr_admin')
           OR employee_id = (
             SELECT id FROM employees
             WHERE id = (
               SELECT employee_id FROM profiles
               WHERE id = auth.uid() AND tenant_id = get_user_tenant_id()
               LIMIT 1
             )
           )
         ));
