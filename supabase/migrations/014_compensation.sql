-- ============================================================
-- 014_compensation.sql
-- Employee compensation history + component breakdown.
--
-- employee_compensations: one row per revision (history).
--   is_active = true → currently effective compensation.
--   ctc_monthly is auto-computed via GENERATED ALWAYS AS.
--
-- employee_compensation_components: the per-component
--   breakdown of each compensation record.
--   computed_monthly / computed_annual stored at write time
--   (no re-calculation needed at read time → payroll-ready).
--
-- Trigger: activating a new compensation record auto-closes
-- the previous active one.
-- ============================================================

-- --------------------------------------------------------
-- EMPLOYEE COMPENSATIONS  (history)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_compensations (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  employee_id          UUID          NOT NULL REFERENCES employees(id)         ON DELETE CASCADE,
  salary_structure_id  UUID          NOT NULL REFERENCES salary_structures(id),
  -- Effective period
  effective_from       DATE          NOT NULL,
  effective_to         DATE,         -- NULL = currently active
  is_active            BOOLEAN       NOT NULL DEFAULT false,
  -- CTC summary
  ctc_annual           NUMERIC(14,2) NOT NULL,
  ctc_monthly          NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(ctc_annual / 12, 2)) STORED,
  -- Metadata
  notes                TEXT,
  created_by           UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by          UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- Guard
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Partial unique index: only ONE active compensation per employee per tenant
CREATE UNIQUE INDEX uidx_comp_one_active
  ON employee_compensations (tenant_id, employee_id)
  WHERE is_active = true;

CREATE INDEX idx_comp_employee ON employee_compensations (tenant_id, employee_id);
CREATE INDEX idx_comp_active   ON employee_compensations (tenant_id, is_active) WHERE is_active = true;

-- --------------------------------------------------------
-- EMPLOYEE COMPENSATION COMPONENTS
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_compensation_components (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  compensation_id      UUID          NOT NULL REFERENCES employee_compensations(id) ON DELETE CASCADE,
  salary_component_id  UUID          NOT NULL REFERENCES salary_components(id),
  calculation_type     TEXT          NOT NULL
    CHECK (calculation_type IN ('fixed','pct_of_basic','pct_of_ctc','pct_of_gross')),
  value                NUMERIC(12,4) NOT NULL,   -- input: flat amount OR percentage (e.g. 40 = 40%)
  computed_monthly     NUMERIC(14,2),            -- calculated & stored at save time
  computed_annual      NUMERIC(14,2),            -- calculated & stored at save time
  sequence             INT           NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (compensation_id, salary_component_id)
);

CREATE INDEX idx_ecc_compensation ON employee_compensation_components (compensation_id);
CREATE INDEX idx_ecc_component    ON employee_compensation_components (salary_component_id);

-- --------------------------------------------------------
-- TRIGGER: auto-close previous active compensation on INSERT/UPDATE
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_close_prev_compensation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE employee_compensations
    SET
      is_active    = false,
      effective_to = NEW.effective_from - INTERVAL '1 day'
    WHERE
      tenant_id   = NEW.tenant_id
      AND employee_id = NEW.employee_id
      AND is_active   = true
      AND id         != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_prev_compensation
  AFTER INSERT OR UPDATE OF is_active ON employee_compensations
  FOR EACH ROW EXECUTE FUNCTION fn_close_prev_compensation();

-- --------------------------------------------------------
-- ROW LEVEL SECURITY
-- --------------------------------------------------------
ALTER TABLE employee_compensations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ec_hr_all"  ON employee_compensations          FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ec_self"    ON employee_compensations          FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ecc_hr_all" ON employee_compensation_components FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ecc_self"   ON employee_compensation_components FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employee_compensations ec
      WHERE ec.id = compensation_id
        AND ec.tenant_id = get_user_tenant_id()
    )
  );
