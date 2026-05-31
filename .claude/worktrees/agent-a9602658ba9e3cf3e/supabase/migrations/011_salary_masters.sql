-- ============================================================
-- 011_salary_masters.sql
-- Salary building blocks: salary_components, salary_structures,
-- salary_structure_components (structure → component mapping)
-- ============================================================

-- SALARY COMPONENTS  (Basic, HRA, PF Employee, PF Employer, etc.)
CREATE TABLE IF NOT EXISTS salary_components (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  code                  TEXT        NOT NULL,
  component_type        TEXT        NOT NULL
    CHECK (component_type IN ('earning', 'deduction', 'employer_contribution')),
  is_taxable            BOOLEAN     NOT NULL DEFAULT true,
  is_pf_applicable      BOOLEAN     NOT NULL DEFAULT false,   -- included in PF wage
  is_esi_applicable     BOOLEAN     NOT NULL DEFAULT false,
  is_pt_applicable      BOOLEAN     NOT NULL DEFAULT false,
  is_lwf_applicable     BOOLEAN     NOT NULL DEFAULT false,   -- Labour Welfare Fund
  is_variable           BOOLEAN     NOT NULL DEFAULT false,   -- varies month to month
  description           TEXT,
  display_order         INT         NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_salary_components_tenant ON salary_components (tenant_id);
CREATE INDEX idx_salary_components_type   ON salary_components (tenant_id, component_type);

-- SALARY STRUCTURES  (named packages, e.g. "Senior Engineer CTC", "Manager Band C")
CREATE TABLE IF NOT EXISTS salary_structures (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_salary_structures_tenant ON salary_structures (tenant_id);

-- SALARY STRUCTURE COMPONENTS
-- Links a salary structure to its components, with default calculation rules.
-- Sequence determines calculation order (Basic must be first if others % of Basic).
CREATE TABLE IF NOT EXISTS salary_structure_components (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  salary_structure_id  UUID          NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  salary_component_id  UUID          NOT NULL REFERENCES salary_components(id) ON DELETE CASCADE,
  calculation_type     TEXT          NOT NULL
    CHECK (calculation_type IN ('fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross')),
  default_value        NUMERIC(12,4) NOT NULL DEFAULT 0,   -- amount OR percentage (e.g. 40 = 40%)
  sequence             INT           NOT NULL DEFAULT 0,
  is_active            BOOLEAN       NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, salary_structure_id, salary_component_id)
);
CREATE INDEX idx_ssc_structure ON salary_structure_components (salary_structure_id);
CREATE INDEX idx_ssc_component ON salary_structure_components (salary_component_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE salary_components          ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structure_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc_tenant_read"  ON salary_components FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "sc_hr_write"     ON salary_components FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ss_tenant_read"  ON salary_structures FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ss_hr_write"     ON salary_structures FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ssc_tenant_read" ON salary_structure_components FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ssc_hr_write"    ON salary_structure_components FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
