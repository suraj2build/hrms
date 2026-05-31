-- ============================================================
-- 074_payroll_engine.sql
--
-- Payroll processing engine tables.
--
-- Tables:
--   payroll_runs    – one row per tenant × month × processing attempt
--   payroll_slips   – one row per employee per run (computed payslip)
--
-- Design notes:
--   • A run is idempotent: re-triggering for the same month replaces the
--     existing draft run (upsert on tenant_id + month).
--   • `component_breakdown` stores a JSONB snapshot of every salary
--     component at the time of computation so historic slips are immutable
--     even after policy changes.
--   • status flow:  draft → processing → finalized | failed
-- ============================================================

-- ── payroll_runs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month             TEXT        NOT NULL,                          -- 'YYYY-MM'
  status            TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'finalized', 'failed')),
  employee_count    INT         NOT NULL DEFAULT 0,
  total_gross       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_lop_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  error_message     TEXT,
  notes             TEXT,
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  finalized_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  finalized_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_month
  ON payroll_runs (tenant_id, month DESC);

-- ── payroll_slips ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_slips (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  run_id                UUID          NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id           UUID          NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  month                 TEXT          NOT NULL,                            -- 'YYYY-MM'

  -- Working-day metrics
  total_working_days    INT           NOT NULL DEFAULT 0,  -- scheduled working days in month
  payable_days          INT           NOT NULL DEFAULT 0,  -- actually payable per attendance
  lop_days              INT           NOT NULL DEFAULT 0,  -- Loss-of-Pay days (absent / unapproved)
  overtime_hours        NUMERIC(6,2)  NOT NULL DEFAULT 0,

  -- Pay amounts
  ctc_monthly           NUMERIC(12,2) NOT NULL DEFAULT 0,  -- CTC / 12 from compensation
  gross_pay             NUMERIC(12,2) NOT NULL DEFAULT 0,  -- sum of earning components (pre-LOP)
  lop_amount            NUMERIC(12,2) NOT NULL DEFAULT 0,  -- deduction for LOP days
  total_deductions      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- sum of deduction components + LOP
  net_pay               NUMERIC(12,2) NOT NULL DEFAULT 0,  -- gross_pay - total_deductions
  employer_contributions NUMERIC(12,2) NOT NULL DEFAULT 0, -- employer PF/ESI etc.

  -- Snapshot of every component at computation time
  component_breakdown   JSONB         NOT NULL DEFAULT '[]'::jsonb,
  -- [ { name, code, type, calc_type, value, monthly_amount, is_employer_contrib } ]

  -- Metadata
  status                TEXT          NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'held')),
  held_reason           TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_slips_run
  ON payroll_slips (run_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_slips_employee
  ON payroll_slips (tenant_id, employee_id, month DESC);

-- ── updated_at triggers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_runs_updated_at   ON payroll_runs;
DROP TRIGGER IF EXISTS trg_payroll_slips_updated_at  ON payroll_slips;

CREATE TRIGGER trg_payroll_runs_updated_at
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_payroll_slips_updated_at
  BEFORE UPDATE ON payroll_slips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_slips ENABLE ROW LEVEL SECURITY;

-- HR admin / super_admin: full access
DROP POLICY IF EXISTS "pr_hr_all" ON payroll_runs;
CREATE POLICY "pr_hr_all"  ON payroll_runs  FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "ps_hr_all" ON payroll_slips;
CREATE POLICY "ps_hr_all"  ON payroll_slips FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- Employees: read own finalized slips only
DROP POLICY IF EXISTS "ps_emp_read" ON payroll_slips;
CREATE POLICY "ps_emp_read" ON payroll_slips FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND status = 'finalized'
    AND employee_id IN (
      SELECT employee_id FROM profiles WHERE id = auth.uid()
    )
  );
