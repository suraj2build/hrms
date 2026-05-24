-- ============================================================
-- 059_rosters.sql
--
-- Step 3: Roster Master — named shift-rotation / work-cycle pattern.
--
-- A roster defines a repeating work schedule (7-day, 14-day, or 28-day
-- cycle) with weekly-off days and optional shift assignments per day.
--
-- pattern_json schema (flexible JSONB):
-- {
--   "weekly_off_days": [0, 6],          -- DOW ints: 0=Sun…6=Sat
--   "shift_pattern": [                  -- optional per-cycle-day shift
--     { "cycle_day": 0, "shift_code": "GEN" },
--     { "cycle_day": 1, "shift_code": "GEN" }
--   ]
-- }
--
-- weekly_off_days is the primary field consumed by the attendance
-- and leave engines.  shift_pattern is metadata for future use.
--
-- Employees reference a roster via employees.roster_id (added in 060).
-- When an employee has both a shift assignment AND a roster, the roster
-- weekly_off_days are used as a fallback only when no shift is assigned.
-- ============================================================

CREATE TABLE IF NOT EXISTS rosters (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  cycle_days    INT         NOT NULL DEFAULT 7
    CHECK (cycle_days IN (7, 14, 28)),
  pattern_json  JSONB       NOT NULL DEFAULT '{"weekly_off_days":[]}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rosters_tenant
  ON rosters (tenant_id);

ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rosters_tenant_read" ON rosters
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "rosters_hr_write" ON rosters
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
