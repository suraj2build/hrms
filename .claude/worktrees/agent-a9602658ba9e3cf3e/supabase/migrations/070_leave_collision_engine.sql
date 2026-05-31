-- =============================================================
-- 070_leave_collision_engine.sql
--
-- Holiday / Weekly-Off / Leave Collision Engine
--
-- Adds fine-grained collision rules to the leave policy system:
--   - sandwich_mode: what to do when leave sandwiches a weekend/holiday
--   - collision_on_holiday: block | allow | convert_to_holiday
--   - collision_on_weekly_off: block | allow | convert_to_weekly_off
--   - optional_holidays: employees can pick from a pool (per tenant)
--   - leave_collision_log: audit trail for sandwich auto-inclusions
-- =============================================================

-- ── 1. Extend leave_policies with collision fields ─────────────
ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS sandwich_mode         TEXT  NOT NULL DEFAULT 'include'
    CONSTRAINT lp_sandwich_check CHECK (sandwich_mode IN ('include', 'exclude', 'block')),

  ADD COLUMN IF NOT EXISTS collision_on_holiday  TEXT  NOT NULL DEFAULT 'allow'
    CONSTRAINT lp_collision_holiday_check CHECK (collision_on_holiday IN ('block', 'allow', 'convert_to_holiday')),

  ADD COLUMN IF NOT EXISTS collision_on_weekly_off TEXT NOT NULL DEFAULT 'allow'
    CONSTRAINT lp_collision_wo_check CHECK (collision_on_weekly_off IN ('block', 'allow', 'convert_to_weekly_off'));

-- Sandwich mode semantics:
--   'include'  — weekends/holidays sandwiched between leave days are
--                automatically included in the leave count (charged as leave)
--   'exclude'  — sandwiched days are NOT counted (employee benefits)
--   'block'    — leave application spanning a weekend/holiday is rejected

COMMENT ON COLUMN leave_policies.sandwich_mode IS
  'include: sandwiched holidays/weekends charged as leave. exclude: not counted. block: reject span.';
COMMENT ON COLUMN leave_policies.collision_on_holiday IS
  'block: disallow leave on declared holiday. allow: permitted. convert_to_holiday: auto-reclassify.';
COMMENT ON COLUMN leave_policies.collision_on_weekly_off IS
  'block: disallow leave on weekly off. allow: permitted. convert_to_weekly_off: auto-reclassify.';

-- ── 2. Optional holiday pool ──────────────────────────────────
-- Employees may choose N optional holidays from the pool each year.

CREATE TABLE IF NOT EXISTS optional_holiday_pool (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID  NOT NULL REFERENCES tenants(id)           ON DELETE CASCADE,
  holiday_id  UUID  NOT NULL REFERENCES holiday_calendar(id)  ON DELETE CASCADE,
  year        INT   NOT NULL,

  UNIQUE (tenant_id, holiday_id)
);

CREATE INDEX IF NOT EXISTS idx_optional_pool_tenant_year
  ON optional_holiday_pool (tenant_id, year);

-- Employee selections — bounded by max_optional_holidays in leave_policies
CREATE TABLE IF NOT EXISTS employee_optional_holidays (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID  NOT NULL REFERENCES tenants(id)                ON DELETE CASCADE,
  employee_id UUID  NOT NULL REFERENCES employees(id)              ON DELETE CASCADE,
  pool_id     UUID  NOT NULL REFERENCES optional_holiday_pool(id)  ON DELETE CASCADE,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, employee_id, pool_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_optional_holidays_employee
  ON employee_optional_holidays (tenant_id, employee_id);

-- ── 3. Leave collision audit log ──────────────────────────────
-- Records automatic sandwich inclusions and collision resolutions
-- for audit and payroll transparency.

CREATE TABLE IF NOT EXISTS leave_collision_log (
  id                  UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID  NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  leave_request_id    UUID  NULL REFERENCES leave_requests(id)     ON DELETE SET NULL,
  leave_application_id UUID NULL REFERENCES leave_applications(id) ON DELETE SET NULL,
  employee_id         UUID  NOT NULL REFERENCES employees(id)      ON DELETE CASCADE,

  collision_date      DATE  NOT NULL,
  -- 'holiday' | 'weekly_off' | 'sandwich_holiday' | 'sandwich_weekly_off'
  collision_type      TEXT  NOT NULL,
  -- 'included' | 'excluded' | 'blocked' | 'converted'
  resolution          TEXT  NOT NULL,
  original_status     TEXT  NULL,   -- status before collision resolution
  resolved_status     TEXT  NULL,   -- status after resolution (e.g. 'leave')

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collision_log_employee
  ON leave_collision_log (tenant_id, employee_id, collision_date DESC);

CREATE INDEX IF NOT EXISTS idx_collision_log_request
  ON leave_collision_log (leave_request_id)
  WHERE leave_request_id IS NOT NULL;

-- ── 4. Row-level security ─────────────────────────────────────

ALTER TABLE optional_holiday_pool      ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_optional_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_collision_log        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ohp_tenant_read" ON optional_holiday_pool;
CREATE POLICY "ohp_tenant_read"  ON optional_holiday_pool FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "ohp_hr_write" ON optional_holiday_pool;
CREATE POLICY "ohp_hr_write"     ON optional_holiday_pool FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "eoh_tenant_read" ON employee_optional_holidays;
CREATE POLICY "eoh_tenant_read"  ON employee_optional_holidays FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "eoh_employee_insert" ON employee_optional_holidays;
CREATE POLICY "eoh_employee_insert" ON employee_optional_holidays FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "eoh_hr_delete" ON employee_optional_holidays;
CREATE POLICY "eoh_hr_delete"    ON employee_optional_holidays FOR DELETE
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "lcl_tenant_read" ON leave_collision_log;
CREATE POLICY "lcl_tenant_read"  ON leave_collision_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "lcl_system_insert" ON leave_collision_log;
CREATE POLICY "lcl_system_insert" ON leave_collision_log FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
