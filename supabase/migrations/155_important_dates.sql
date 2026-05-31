-- ============================================================
-- 155_important_dates.sql
--
-- Employee Important Dates — configurable date types and per-employee
-- date records. Feeds the leave event-grant engine (migration 156).
--
-- New tables
-- ──────────
-- important_date_types   — tenant-configurable event types
--                          (birthday, marriage_anniversary, joining_anniversary, …)
-- employee_important_dates — the actual date for each employee
--
-- System types (is_system = true) are seeded per tenant and cannot
-- be deleted. HR can add custom types via the admin UI.
-- ============================================================

-- ── 1. important_date_types ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS important_date_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,

  -- Machine-readable code; used by leave_policy_rules.event_trigger_date_type_id
  -- and the event-grant engine. Lower-case, underscored.
  code        TEXT        NOT NULL
    CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),

  -- Human-readable label shown in UI
  name        TEXT        NOT NULL,

  description TEXT,

  -- System types are seeded automatically; HR cannot delete them.
  -- HR can still disable them (is_active = false).
  is_system   BOOLEAN     NOT NULL DEFAULT false,

  is_active   BOOLEAN     NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One code per tenant (system and custom types share the same namespace)
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_idt_tenant_active
  ON important_date_types (tenant_id, is_active);

-- ── 2. employee_important_dates ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_important_dates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)           ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id)         ON DELETE CASCADE,
  date_type_id    UUID        NOT NULL REFERENCES important_date_types(id) ON DELETE RESTRICT,

  -- The actual date.  Year component:
  --   year_known = true  → full date is stored (e.g. 1990-07-15)
  --   year_known = false → only month & day are meaningful (e.g. 0001-07-15)
  --     The year 0001 is used as a sentinel when the birth year is unknown.
  event_date      DATE        NOT NULL,

  -- false when only the month/day is known (birth year not on record)
  year_known      BOOLEAN     NOT NULL DEFAULT true,

  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one record per date-type per employee
  UNIQUE (tenant_id, employee_id, date_type_id)
);

CREATE INDEX IF NOT EXISTS idx_eid_employee
  ON employee_important_dates (tenant_id, employee_id);

-- Supports daily scheduler query "which employees have an event today?"
-- Uses EXTRACT(MONTH) + EXTRACT(DAY) — covered by the expression index below.
CREATE INDEX IF NOT EXISTS idx_eid_month_day
  ON employee_important_dates (tenant_id, EXTRACT(MONTH FROM event_date), EXTRACT(DAY FROM event_date));

-- ── 3. updated_at triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_important_dates_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_idt_updated_at ON important_date_types;
CREATE TRIGGER trg_idt_updated_at
  BEFORE UPDATE ON important_date_types
  FOR EACH ROW EXECUTE FUNCTION update_important_dates_timestamp();

DROP TRIGGER IF EXISTS trg_eid_updated_at ON employee_important_dates;
CREATE TRIGGER trg_eid_updated_at
  BEFORE UPDATE ON employee_important_dates
  FOR EACH ROW EXECUTE FUNCTION update_important_dates_timestamp();

-- ── 4. Row-level security ─────────────────────────────────────────────────────

ALTER TABLE important_date_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_important_dates ENABLE ROW LEVEL SECURITY;

-- important_date_types: all tenant members can read; HR can write
CREATE POLICY "idt_tenant_read" ON important_date_types FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "idt_hr_write"    ON important_date_types FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- employee_important_dates: all tenant members can read; HR can write
CREATE POLICY "eid_tenant_read" ON employee_important_dates FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "eid_hr_write"    ON employee_important_dates FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── 5. Seed system date types for existing tenants ────────────────────────────
-- New tenants receive these via the tenant-onboarding procedure.
-- This INSERT seeds them for tenants that existed before this migration.

INSERT INTO important_date_types (tenant_id, code, name, description, is_system, is_active)
SELECT
  t.id,
  s.code,
  s.name,
  s.description,
  true,
  true
FROM tenants t
CROSS JOIN (VALUES
  ('birthday',              'Birthday',              'Employee''s date of birth'),
  ('marriage_anniversary',  'Marriage Anniversary',  'Employee''s wedding anniversary'),
  ('joining_anniversary',   'Joining Anniversary',   'Employee''s work anniversary (joining date)')
) AS s(code, name, description)
ON CONFLICT (tenant_id, code) DO NOTHING;
