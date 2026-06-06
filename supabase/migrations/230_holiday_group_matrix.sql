-- 230_holiday_group_matrix.sql
-- Holiday calendar matrix: one holiday can belong to multiple groups (many-to-many).
-- The existing holiday_calendar.holiday_group_id is kept for backward compatibility
-- with the attendance engine — it is populated from the junction as the "primary" group.
--
-- Employee → holiday group: direct tag employees.holiday_group_id (overrides site).
-- Additive + idempotent.

-- ── holiday_group_assignments (junction table) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS holiday_group_assignments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  holiday_id  UUID        NOT NULL REFERENCES holiday_calendar(id) ON DELETE CASCADE,
  group_id    UUID        NOT NULL REFERENCES roster_holiday_groups(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, holiday_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_hga_holiday ON holiday_group_assignments (tenant_id, holiday_id);
CREATE INDEX IF NOT EXISTS idx_hga_group   ON holiday_group_assignments (tenant_id, group_id);

COMMENT ON TABLE holiday_group_assignments IS
  'Many-to-many: one holiday can be assigned to multiple holiday groups. '
  'The single holiday_calendar.holiday_group_id is kept for backward compat '
  '(attendance engine) and mirrors the first/primary group.';

-- ── employees.holiday_group_id (direct per-employee group tag) ─────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS holiday_group_id UUID
    REFERENCES roster_holiday_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_holiday_group ON employees (holiday_group_id)
  WHERE holiday_group_id IS NOT NULL;

COMMENT ON COLUMN employees.holiday_group_id IS
  'Direct holiday group tag for this employee. Overrides the site-level group when set. '
  'NULL = inherit from site.holiday_group_id.';

-- ── Backfill junction from existing single-FK assignments ──────────────────────
-- Any holiday already assigned to a group via holiday_calendar.holiday_group_id
-- gets a row in the junction table so the matrix shows existing assignments.
INSERT INTO holiday_group_assignments (tenant_id, holiday_id, group_id)
SELECT tenant_id, id, holiday_group_id
FROM   holiday_calendar
WHERE  holiday_group_id IS NOT NULL
ON CONFLICT (tenant_id, holiday_id, group_id) DO NOTHING;
