-- ============================================================
-- 029_shift_roster.sql
-- Per-day shift overrides for individual employees.
--
-- A roster row takes precedence over the employee's standing
-- shift assignment (employee_shifts) for that specific date.
-- The unique constraint ensures one override per employee per day.
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_roster (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  shift_id    UUID        NOT NULL REFERENCES shifts(id)    ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, employee_id, date)
);

-- Lookup by date (admin view: all employees on a day)
CREATE INDEX IF NOT EXISTS idx_shift_roster_tenant_date
  ON shift_roster (tenant_id, date);

-- Lookup by employee (employee view: their roster history)
CREATE INDEX IF NOT EXISTS idx_shift_roster_employee
  ON shift_roster (tenant_id, employee_id, date DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE shift_roster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sro_tenant_read"
  ON shift_roster FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "sro_hr_write"
  ON shift_roster FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
