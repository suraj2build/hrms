-- ============================================================
-- 110_payroll_run_employees.sql
--
-- Per-employee payroll run detail table.
-- Referenced by migration 080 (ALTER was premature — table didn't exist).
-- Also referenced by payroll/cost.ts API route.
--
-- One row per employee per payroll run.
-- Stores gross, net, OT cost, LOP deduction, and volatility index.
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_run_employees (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  payroll_run_id      UUID          NOT NULL REFERENCES payroll_runs(id)  ON DELETE CASCADE,
  employee_id         UUID          NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  month               TEXT          NOT NULL,           -- YYYY-MM

  -- Pay amounts (mirrors payroll_slips but focused on cost intelligence)
  gross_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ot_cost             NUMERIC(10,2) NOT NULL DEFAULT 0,
  lop_deduction       NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Volatility: |net_pay - prior_net| / prior_net * 100, NULL if no prior month
  volatility_index    NUMERIC(5,2)  NULL,

  -- Reference to payroll_slips if full breakdown is needed
  slip_id             UUID          NULL REFERENCES payroll_slips(id)     ON DELETE SET NULL,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pre_tenant_run
  ON payroll_run_employees (tenant_id, payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_pre_tenant_employee
  ON payroll_run_employees (tenant_id, employee_id, month DESC);

CREATE INDEX IF NOT EXISTS idx_pre_volatility
  ON payroll_run_employees (tenant_id, month DESC, volatility_index DESC)
  WHERE volatility_index IS NOT NULL;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_pre_updated_at ON payroll_run_employees;
CREATE TRIGGER trg_pre_updated_at
  BEFORE UPDATE ON payroll_run_employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE payroll_run_employees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payroll_run_employees' AND policyname = 'pre_hr_all'
  ) THEN
    CREATE POLICY "pre_hr_all" ON payroll_run_employees FOR ALL
      USING (get_user_role() IN ('super_admin', 'hr_admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payroll_run_employees' AND policyname = 'pre_tenant_read'
  ) THEN
    CREATE POLICY "pre_tenant_read" ON payroll_run_employees FOR SELECT
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
