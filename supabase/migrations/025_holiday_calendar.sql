-- ─────────────────────────────────────────────────────────────────────────────
-- 025_holiday_calendar.sql
--
-- Holiday calendar — tenant-scoped, date-keyed.
--
-- The attendance processor checks this table during daily computation:
--   IF the processing date appears here → status = 'holiday', work_hours = 0.
--
-- is_optional=true means the holiday is optional (e.g. restricted holiday).
-- The processor treats optional holidays the same way; payroll can differentiate.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS holiday_calendar (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  name        TEXT        NOT NULL,
  is_optional BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by tenant + date (the primary access pattern in the processor)
CREATE INDEX IF NOT EXISTS idx_holiday_calendar_tenant_date
  ON holiday_calendar (tenant_id, date);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE holiday_calendar ENABLE ROW LEVEL SECURITY;

-- Any authenticated user in the same tenant may read the holiday list
CREATE POLICY "tenant_read" ON holiday_calendar
  FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Only hr_admin / super_admin may insert, update, or delete
CREATE POLICY "hr_write" ON holiday_calendar
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
