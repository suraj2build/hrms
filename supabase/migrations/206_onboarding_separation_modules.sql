-- Migration 206: Onboarding checklist and separation clearance/F&F modules

-- ============================================================
-- 1. onboarding_checklist_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS onboarding_checklist_templates (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  description    TEXT,
  is_default     BOOLEAN     NOT NULL DEFAULT false,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_onboarding_checklist_templates"
  ON onboarding_checklist_templates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_deny_onboarding_checklist_templates"
  ON onboarding_checklist_templates
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_templates_tenant
  ON onboarding_checklist_templates(tenant_id);

-- ============================================================
-- 2. onboarding_checklist_items
-- ============================================================
CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id      UUID        NOT NULL REFERENCES onboarding_checklist_templates(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  description      TEXT,
  category         TEXT        CHECK (category IN ('it_setup','document_collection','access_provisioning','induction','compliance','other')),
  due_day_offset   INT         NOT NULL DEFAULT 1,
  assigned_to_role TEXT        CHECK (assigned_to_role IN ('hr','it','manager','admin','employee')),
  is_mandatory     BOOLEAN     NOT NULL DEFAULT true,
  sort_order       INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_onboarding_checklist_items"
  ON onboarding_checklist_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_deny_onboarding_checklist_items"
  ON onboarding_checklist_items
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_items_tenant
  ON onboarding_checklist_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_items_template
  ON onboarding_checklist_items(template_id);

-- ============================================================
-- 3. employee_onboarding_checklists
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_onboarding_checklists (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id             UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id             UUID        REFERENCES onboarding_checklist_templates(id) ON DELETE SET NULL,
  status                  TEXT        NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started','in_progress','completed')),
  start_date              DATE,
  target_completion_date  DATE,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);

ALTER TABLE employee_onboarding_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_employee_onboarding_checklists"
  ON employee_onboarding_checklists
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_deny_employee_onboarding_checklists"
  ON employee_onboarding_checklists
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_checklists_tenant
  ON employee_onboarding_checklists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_checklists_employee
  ON employee_onboarding_checklists(employee_id);

-- ============================================================
-- 4. employee_onboarding_tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_onboarding_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_id     UUID        NOT NULL REFERENCES employee_onboarding_checklists(id) ON DELETE CASCADE,
  item_id          UUID        REFERENCES onboarding_checklist_items(id) ON DELETE SET NULL,
  title            TEXT        NOT NULL,
  description      TEXT,
  category         TEXT        CHECK (category IN ('it_setup','document_collection','access_provisioning','induction','compliance','other')),
  due_date         DATE,
  assigned_to_role TEXT        CHECK (assigned_to_role IN ('hr','it','manager','admin','employee')),
  is_mandatory     BOOLEAN     NOT NULL DEFAULT true,
  status           TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','completed','skipped')),
  completed_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  notes            TEXT,
  sort_order       INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employee_onboarding_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_employee_onboarding_tasks"
  ON employee_onboarding_tasks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_deny_employee_onboarding_tasks"
  ON employee_onboarding_tasks
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_tasks_tenant
  ON employee_onboarding_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_tasks_checklist
  ON employee_onboarding_tasks(checklist_id);

-- ============================================================
-- 5. separation_clearances
-- ============================================================
CREATE TABLE IF NOT EXISTS separation_clearances (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  separation_id  UUID        NOT NULL REFERENCES employee_separation(id) ON DELETE CASCADE,
  employee_id    UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department     TEXT        NOT NULL
                   CHECK (department IN ('it','finance','manager','admin','hr')),
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','cleared','rejected')),
  cleared_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  cleared_at     TIMESTAMPTZ,
  remarks        TEXT,
  updated_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, separation_id, department)
);

ALTER TABLE separation_clearances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_separation_clearances"
  ON separation_clearances
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_deny_separation_clearances"
  ON separation_clearances
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_separation_clearances_tenant
  ON separation_clearances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_separation_clearances_separation
  ON separation_clearances(separation_id);

-- ============================================================
-- 6. separation_ff_summary
-- ============================================================
CREATE TABLE IF NOT EXISTS separation_ff_summary (
  id                        UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  separation_id             UUID           NOT NULL UNIQUE REFERENCES employee_separation(id) ON DELETE CASCADE,
  employee_id               UUID           NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  last_payroll_amount       NUMERIC(14,2)  NOT NULL DEFAULT 0,
  leave_encashment_amount   NUMERIC(14,2)  NOT NULL DEFAULT 0,
  gratuity_amount           NUMERIC(14,2)  NOT NULL DEFAULT 0,
  notice_period_deduction   NUMERIC(14,2)  NOT NULL DEFAULT 0,
  other_deductions          NUMERIC(14,2)  NOT NULL DEFAULT 0,
  other_additions           NUMERIC(14,2)  NOT NULL DEFAULT 0,
  net_payable               NUMERIC(14,2)  GENERATED ALWAYS AS (
                              last_payroll_amount
                              + leave_encashment_amount
                              + gratuity_amount
                              + other_additions
                              - notice_period_deduction
                              - other_deductions
                            ) STORED,
  status                    TEXT           NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','approved','paid')),
  approved_by               UUID           REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at               TIMESTAMPTZ,
  paid_at                   TIMESTAMPTZ,
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE separation_ff_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_separation_ff_summary"
  ON separation_ff_summary
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_deny_separation_ff_summary"
  ON separation_ff_summary
  FOR ALL TO anon
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_separation_ff_summary_tenant
  ON separation_ff_summary(tenant_id);
CREATE INDEX IF NOT EXISTS idx_separation_ff_summary_separation
  ON separation_ff_summary(separation_id);
CREATE INDEX IF NOT EXISTS idx_separation_ff_summary_employee
  ON separation_ff_summary(employee_id);
