-- ============================================================
-- 086_workforce_optimization.sql
-- Workforce Optimization Engine: fairness metrics, shift balance
-- scores, optimization hints, rest-gap tracking.
-- ============================================================

-- Shift balance scores per employee per period
CREATE TABLE IF NOT EXISTS workforce_shift_balance (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start    DATE        NOT NULL,
  period_end      DATE        NOT NULL,
  -- OT metrics
  total_ot_hours          DECIMAL(8,2) NOT NULL DEFAULT 0,
  ot_fairness_score       DECIMAL(5,2),        -- 0-100, higher = more equitable distribution
  -- Consecutive shift metrics
  max_consecutive_days    INT NOT NULL DEFAULT 0,
  consecutive_violations  INT NOT NULL DEFAULT 0,  -- days exceeding 6 consecutive
  -- Weekend metrics
  weekend_shifts_count    INT NOT NULL DEFAULT 0,
  weekend_fairness_score  DECIMAL(5,2),        -- 0-100
  -- Night shift metrics
  night_shifts_count      INT NOT NULL DEFAULT 0,
  night_shift_fairness_score DECIMAL(5,2),     -- 0-100
  -- Rest gap metrics
  min_rest_gap_hours      DECIMAL(5,2),        -- minimum rest between shifts in period
  rest_gap_violations     INT NOT NULL DEFAULT 0,  -- gaps < 8h
  -- Workload metrics
  total_work_hours        DECIMAL(8,2) NOT NULL DEFAULT 0,
  workload_score          DECIMAL(5,2),        -- 0-100
  -- Overall
  overall_balance_score   DECIMAL(5,2),        -- 0-100 composite
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_wsb_tenant_period
  ON workforce_shift_balance (tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_wsb_employee
  ON workforce_shift_balance (tenant_id, employee_id, period_start);
CREATE INDEX IF NOT EXISTS idx_wsb_score
  ON workforce_shift_balance (tenant_id, overall_balance_score, period_start);

-- Workforce optimization hints — actionable explanations
CREATE TABLE IF NOT EXISTS workforce_optimization_hints (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     UUID        REFERENCES employees(id) ON DELETE CASCADE,
  department_id   UUID        REFERENCES departments(id) ON DELETE CASCADE,
  period_start    DATE        NOT NULL,
  period_end      DATE        NOT NULL,
  hint_type       TEXT        NOT NULL CHECK (hint_type IN (
    'consecutive_shift_overload',
    'ot_concentration',
    'weekend_imbalance',
    'night_shift_imbalance',
    'rest_gap_violation',
    'staffing_pressure',
    'shift_overload',
    'workload_imbalance',
    'fairness_breach'
  )),
  severity        TEXT        NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title           TEXT        NOT NULL,
  explanation     TEXT        NOT NULL,    -- human-readable, explainable
  affected_dates  TEXT[],                 -- specific dates implicated
  metric_value    DECIMAL(8,2),           -- actual measured value
  threshold_value DECIMAL(8,2),           -- configured threshold
  payroll_impact  DECIMAL(10,2),          -- estimated payroll cost impact
  resolved        BOOLEAN     NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_woh_tenant_period
  ON workforce_optimization_hints (tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_woh_employee
  ON workforce_optimization_hints (tenant_id, employee_id, period_start);
CREATE INDEX IF NOT EXISTS idx_woh_type_severity
  ON workforce_optimization_hints (tenant_id, hint_type, severity);
CREATE INDEX IF NOT EXISTS idx_woh_unresolved
  ON workforce_optimization_hints (tenant_id, resolved, severity) WHERE resolved = false;

-- Staffing optimization snapshots — team/department level
CREATE TABLE IF NOT EXISTS workforce_staffing_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id   UUID        REFERENCES departments(id) ON DELETE CASCADE,
  site_id         UUID,                       -- optional site reference
  snapshot_date   DATE        NOT NULL,
  required_headcount  INT,
  scheduled_headcount INT,
  present_headcount   INT,
  coverage_ratio      DECIMAL(5,4),           -- present / required (0-1)
  ot_headcount        INT     NOT NULL DEFAULT 0,
  understaffed        BOOLEAN NOT NULL DEFAULT false,
  overstaffed         BOOLEAN NOT NULL DEFAULT false,
  staffing_pressure   TEXT    CHECK (staffing_pressure IN ('low','normal','elevated','critical')),
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, department_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_wss_tenant_date
  ON workforce_staffing_snapshots (tenant_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_wss_pressure
  ON workforce_staffing_snapshots (tenant_id, staffing_pressure, snapshot_date) WHERE understaffed = true;

-- RLS
ALTER TABLE workforce_shift_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_optimization_hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_staffing_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wsb_tenant_read" ON workforce_shift_balance FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "wsb_hr_write" ON workforce_shift_balance FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "woh_tenant_read" ON workforce_optimization_hints FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "woh_hr_write" ON workforce_optimization_hints FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "wss_tenant_read" ON workforce_staffing_snapshots FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "wss_hr_write" ON workforce_staffing_snapshots FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));
