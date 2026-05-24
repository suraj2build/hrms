-- ============================================================
-- 080_payroll_cost_snapshots.sql
--
-- Monthly department-level payroll cost snapshots.
-- Populated after each payroll run finalization.
-- Enables fast trend queries without re-aggregating payroll_slips.
--
-- Also adds compensation_volatility_index to payroll_run_employees
-- for variance tracking per employee.
-- ============================================================

-- Dept cost snapshots: one row per tenant+department+month
CREATE TABLE IF NOT EXISTS payroll_dept_snapshots (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  payroll_run_id      UUID          NULL REFERENCES payroll_runs(id)     ON DELETE SET NULL,
  department_id       UUID          NULL REFERENCES departments(id)      ON DELETE SET NULL,
  department_name     TEXT          NOT NULL DEFAULT 'Unassigned',
  month               TEXT          NOT NULL,   -- YYYY-MM

  -- Aggregate figures
  headcount           INT           NOT NULL DEFAULT 0,
  total_gross         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ot_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_lop_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  avg_gross           NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Variance vs prior month (populated on snapshot creation)
  prior_month_gross   NUMERIC(14,2) NULL,
  variance_pct        NUMERIC(6,2)  NULL,
  variance_amount     NUMERIC(12,2) NULL,

  -- Flags
  has_high_variance   BOOLEAN       NOT NULL DEFAULT false,  -- |variance_pct| > 10
  ot_heavy            BOOLEAN       NOT NULL DEFAULT false,  -- ot_cost > gross * 0.15

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, department_id, month)
);

CREATE INDEX IF NOT EXISTS idx_dept_snapshots_tenant_month
  ON payroll_dept_snapshots (tenant_id, month DESC, department_id);

CREATE INDEX IF NOT EXISTS idx_dept_snapshots_variance
  ON payroll_dept_snapshots (tenant_id, has_high_variance, month DESC)
  WHERE has_high_variance = true;

ALTER TABLE payroll_dept_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payroll_dept_snapshots' AND policyname = 'dept_snap_read'
  ) THEN
    CREATE POLICY "dept_snap_read" ON payroll_dept_snapshots FOR SELECT
      USING (tenant_id = get_user_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payroll_dept_snapshots' AND policyname = 'dept_snap_hr_write'
  ) THEN
    CREATE POLICY "dept_snap_hr_write" ON payroll_dept_snapshots FOR ALL
      USING (get_user_role() IN ('super_admin', 'hr_admin'));
  END IF;
END $$;

-- ── Extend payroll_run_employees with cost intelligence fields ────────────────
-- NOTE: payroll_run_employees is created in migration 110.
-- The ALTER below is a no-op if columns already exist (IF NOT EXISTS guard).
-- Skipped here to avoid dependency on table that may not exist yet.
-- The columns ot_cost, lop_deduction, volatility_index are defined
-- directly in migration 110_payroll_run_employees.sql.
