-- ============================================================
-- 019_attendance.sql
--
-- Biometric attendance schema — 4 tables:
--   A. attendance_devices     — registered biometric devices
--   B. attendance_raw_logs    — immutable punch log from devices
--   C. attendance_logs        — processed check-in / check-out pairs
--   D. attendance_daily       — computed daily summary per employee
-- ============================================================

-- ── A. attendance_devices ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_devices (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  api_key    TEXT        NOT NULL UNIQUE,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adev_tenant
  ON attendance_devices (tenant_id);

-- Partial index: api_key lookups only need active devices
CREATE INDEX IF NOT EXISTS idx_adev_apikey_active
  ON attendance_devices (api_key)
  WHERE is_active = true;

-- ── B. attendance_raw_logs ────────────────────────────────────────────────────
-- Raw punch events from biometric devices. Immutable once inserted.
-- Never updated or deleted — source of truth for all processing.
CREATE TABLE IF NOT EXISTS attendance_raw_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id     UUID        NOT NULL REFERENCES attendance_devices(id) ON DELETE RESTRICT,
  employee_code TEXT        NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  direction     TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite index for processor queries: by tenant + employee_code + day
CREATE INDEX IF NOT EXISTS idx_arl_tenant_code_ts
  ON attendance_raw_logs (tenant_id, employee_code, timestamp);

-- Index for device-level audit queries
CREATE INDEX IF NOT EXISTS idx_arl_device
  ON attendance_raw_logs (tenant_id, device_id, timestamp);

-- ── C. attendance_logs ────────────────────────────────────────────────────────
-- Processed check-in / check-out pairs derived from raw logs.
CREATE TABLE IF NOT EXISTS attendance_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in    TIMESTAMPTZ,
  check_out   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_al_employee_checkin
  ON attendance_logs (tenant_id, employee_id, check_in DESC);

-- ── D. attendance_daily ───────────────────────────────────────────────────────
-- One row per employee per calendar date — aggregated from attendance_logs.
CREATE TABLE IF NOT EXISTS attendance_daily (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date             DATE        NOT NULL,
  work_hours       NUMERIC(5,2) NOT NULL DEFAULT 0,
  late_minutes     INTEGER     NOT NULL DEFAULT 0,
  overtime_minutes INTEGER     NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'present'
                   CHECK (status IN ('present','absent','half_day','late','holiday','weekend')),

  UNIQUE (tenant_id, employee_id, date)
);

-- Primary access pattern: employee history ordered by date
CREATE INDEX IF NOT EXISTS idx_ad_employee_date
  ON attendance_daily (tenant_id, employee_id, date DESC);

-- Admin view: all employees for a specific date
CREATE INDEX IF NOT EXISTS idx_ad_tenant_date
  ON attendance_daily (tenant_id, date DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE attendance_devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_raw_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_daily    ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user within the same tenant
CREATE POLICY "tenant_read_adev"  ON attendance_devices  FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_read_arl"   ON attendance_raw_logs FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_read_al"    ON attendance_logs     FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_read_ad"    ON attendance_daily    FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Write: hr_admin / super_admin only (devices, processed logs, daily summary)
CREATE POLICY "hr_write_adev"  ON attendance_devices  FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "hr_write_al"    ON attendance_logs     FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "hr_write_ad"    ON attendance_daily    FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));

-- Raw logs: service-role INSERT only (ingest API runs as service role).
-- No UPDATE / DELETE policy — immutability enforced by omission.
CREATE POLICY "service_insert_arl" ON attendance_raw_logs FOR INSERT WITH CHECK (true);
