-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 147 — Advanced Roster & Weekly-Off Engine
--
-- Adds:
--   1. roster_holiday_groups     — regional/branch/union holiday calendars
--   2. roster_weekly_off_rules   — rule-based off-day definitions per roster
--   3. shift_segments            — split-shift segment support
--   4. roster_rotation_groups    — multi-shift rotation group definitions
--   5. roster_rotation_members   — employee rotation group assignments
--   6. flex_policy on shifts     — grace / core-hours / flex controls
--   7. fatigue_rules on rosters  — compliance / labour-law guards
--   8. holiday_group_id on rosters + holidays — regional calendar linkage
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. roster_holiday_groups ──────────────────────────────────────────────────
--   Regional or branch-level holiday calendars (state, factory, union, etc.)
--   Holidays can be scoped to a group so different sites observe different calendars.

CREATE TABLE IF NOT EXISTS roster_holiday_groups (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  code         TEXT,
  description  TEXT,
  state_code   TEXT,                  -- ISO 3166-2 region code, e.g. 'IN-MH'
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_holiday_groups_tenant ON roster_holiday_groups (tenant_id);

-- ── 2. roster_weekly_off_rules ───────────────────────────────────────────────
--   Advanced weekly-off rule definitions attached to a roster.
--   Multiple rules per roster are supported; highest priority wins.
--
--   rule_type values:
--     FIXED_WEEKLY_OFF      — simple weekday list           { weekdays: [0,6] }
--     ALT_SATURDAY_OFF      — 2nd + 4th Saturday            { weekday: 6, weeks: [2,4] }
--     FIRST_THIRD_SATURDAY  — 1st + 3rd Saturday            { weekday: 6, weeks: [1,3] }
--     ROTATIONAL_OFF        — rotating day per cadence       { rotation_schedules: [...], rotation_weeks: 2 }
--     CYCLIC_PATTERN        — N work / M off repeating       { cycle_days: 6, off_days: [4,5] }
--     CUSTOM_CALENDAR       — explicit off-date list         { off_dates: ['YYYY-MM-DD', ...] }

CREATE TABLE IF NOT EXISTS roster_weekly_off_rules (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  roster_id      UUID NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
  rule_type      TEXT NOT NULL CHECK (rule_type IN (
    'FIXED_WEEKLY_OFF',
    'ALT_SATURDAY_OFF',
    'FIRST_THIRD_SATURDAY',
    'ROTATIONAL_OFF',
    'CYCLIC_PATTERN',
    'CUSTOM_CALENDAR'
  )),
  rule_config    JSONB NOT NULL DEFAULT '{}',
  effective_from DATE NOT NULL,
  effective_to   DATE,
  priority       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_off_rules_roster
  ON roster_weekly_off_rules (roster_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_weekly_off_rules_tenant
  ON roster_weekly_off_rules (tenant_id);

-- ── 3. shift_segments ────────────────────────────────────────────────────────
--   Split-shift support: a shift may be composed of multiple non-contiguous
--   work segments (e.g. 09:00–13:00 + 14:00–18:00).
--   If no segments exist for a shift, it is treated as a single contiguous block.

CREATE TABLE IF NOT EXISTS shift_segments (
  id                    UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id              UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  segment_order         INTEGER NOT NULL DEFAULT 1,
  start_time            TIME NOT NULL,
  end_time              TIME NOT NULL,
  minimum_hours         NUMERIC(4,2) NOT NULL DEFAULT 0,
  break_after_minutes   INTEGER NOT NULL DEFAULT 0,    -- mandatory gap/break after this segment
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, segment_order),
  CHECK (segment_order > 0),
  CHECK (minimum_hours >= 0),
  CHECK (break_after_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shift_segments_shift ON shift_segments (shift_id);

-- ── 4. roster_rotation_groups ────────────────────────────────────────────────
--   Defines a rotation group (Day→Evening→Night, etc.).
--   rotation_config shape:
--     {
--       shifts:      [{ shift_id: uuid, cohort_index: int }],
--       cycle_weeks: int,           -- how many weeks per full rotation cycle
--       start_date:  'YYYY-MM-DD',  -- cycle anchor date
--       auto_advance: bool          -- automatically advance cycle each period
--     }

CREATE TABLE IF NOT EXISTS roster_rotation_groups (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  code             TEXT,
  rotation_type    TEXT NOT NULL CHECK (rotation_type IN ('weekly', 'biweekly', 'monthly', 'custom')),
  rotation_config  JSONB NOT NULL DEFAULT '{}',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rotation_groups_tenant ON roster_rotation_groups (tenant_id);

-- ── 5. roster_rotation_members ───────────────────────────────────────────────
--   Assigns an employee to a rotation group with a cohort_index (0-indexed offset
--   within the rotation — determines which shift slot they start on).

CREATE TABLE IF NOT EXISTS roster_rotation_members (
  id                 UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rotation_group_id  UUID NOT NULL REFERENCES roster_rotation_groups(id) ON DELETE CASCADE,
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cohort_index       INTEGER NOT NULL DEFAULT 0,
  effective_from     DATE NOT NULL,
  effective_to       DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_rotation_members_employee
  ON roster_rotation_members (employee_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_rotation_members_group
  ON roster_rotation_members (rotation_group_id);

-- ── 6. flex_policy on shifts ──────────────────────────────────────────────────
--   Per-shift flexible scheduling controls.
--   Shape: {
--     grace_in_minutes:    int,    -- late-in tolerance (overrides shifts.grace_minutes if set)
--     grace_out_minutes:   int,    -- early-out tolerance
--     core_hours_required: num,    -- minimum hours in core window
--     minimum_daily_hours: num,    -- minimum total daily hours required
--     allow_early_punch:   bool,   -- allow punch-in before shift window
--     allow_late_punch:    bool,   -- allow punch-out after shift window
--     flex_start_window:   int,    -- minutes before shift start that punch-in opens
--     flex_end_window:     int     -- minutes after shift end that punch-out closes
--   }

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS flex_policy JSONB;

-- ── 7. fatigue_rules + holiday_group_id on rosters ───────────────────────────
--   fatigue_rules shape: {
--     max_consecutive_workdays: int,   -- default 6
--     min_rest_hours:           num,   -- default 8
--     max_daily_hours:          num,   -- default 12
--     max_weekly_hours:         num,   -- default 48
--     night_shift_rest_hours:   num,   -- default 11
--     ot_threshold_hours:       num    -- OT flag threshold per day
--   }

ALTER TABLE rosters
  ADD COLUMN IF NOT EXISTS fatigue_rules JSONB;

ALTER TABLE rosters
  ADD COLUMN IF NOT EXISTS holiday_group_id UUID
    REFERENCES roster_holiday_groups(id) ON DELETE SET NULL;

-- ── 8. holiday_group_id on holidays ──────────────────────────────────────────
--   Allows holiday entries to belong to a specific regional group.
--   NULL = applies to all groups (global holiday).

-- holidays table is named holiday_calendar in this DB
ALTER TABLE holiday_calendar
  ADD COLUMN IF NOT EXISTS holiday_group_id UUID
    REFERENCES roster_holiday_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_holidays_group
  ON holiday_calendar (tenant_id, holiday_group_id, date);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE roster_holiday_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_weekly_off_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_segments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_rotation_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_rotation_members ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy (all tables follow the same pattern)
CREATE POLICY "tenant_isolation" ON roster_holiday_groups
  USING (tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "tenant_isolation" ON roster_weekly_off_rules
  USING (tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "tenant_isolation" ON shift_segments
  USING (tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "tenant_isolation" ON roster_rotation_groups
  USING (tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "tenant_isolation" ON roster_rotation_members
  USING (tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()));
