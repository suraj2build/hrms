-- ─────────────────────────────────────────────────────────────────────────────
-- 021_attendance_guards.sql
--
-- Step 1: attendance_processing_lock  — one row per tenant, prevents parallel runs
-- Step 2: unique constraint on attendance_logs(tenant_id, employee_id, check_in)
-- Step 3: attendance_processing_runs  — audit log, one row per completed run
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Concurrency lock ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_processing_lock (
  tenant_id  UUID        NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  is_running BOOLEAN     NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  started_by UUID                                          -- profiles.id of who triggered it
);

ALTER TABLE attendance_processing_lock ENABLE ROW LEVEL SECURITY;

-- Only hr_admin / super_admin can read or update the lock
CREATE POLICY "hr_lock_rw" ON attendance_processing_lock
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- Seed one row per existing tenant so upsert-based locking always finds a row
INSERT INTO attendance_processing_lock (tenant_id, is_running)
  SELECT id, FALSE FROM tenants
  ON CONFLICT (tenant_id) DO NOTHING;

-- ── Step 2: Unique constraint on attendance_logs ──────────────────────────────
-- Prevents duplicate session rows for the same employee + check_in timestamp.
-- The processor uses ON CONFLICT DO NOTHING so harmless re-runs never double-insert.
ALTER TABLE attendance_logs
  ADD CONSTRAINT uq_attendance_logs_checkin
  UNIQUE (tenant_id, employee_id, check_in);

-- ── Step 3: Processing audit table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_processing_runs (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date             DATE        NOT NULL,
  processed_count  INT         NOT NULL DEFAULT 0,   -- employees successfully processed
  skipped_count    INT         NOT NULL DEFAULT 0,   -- unmatched employee_codes
  incomplete_count INT         NOT NULL DEFAULT 0,   -- sessions with no OUT punch
  raw_logs_marked  INT         NOT NULL DEFAULT 0,   -- raw log rows marked processed
  logs_created     INT         NOT NULL DEFAULT 0,   -- attendance_log rows inserted
  daily_upserted   INT         NOT NULL DEFAULT 0,   -- attendance_daily rows upserted
  triggered_by     UUID,                             -- profiles.id
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  error_message    TEXT                              -- set if run failed mid-way
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_tenant_date
  ON attendance_processing_runs (tenant_id, date DESC);

ALTER TABLE attendance_processing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_runs_read" ON attendance_processing_runs
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "hr_runs_write" ON attendance_processing_runs
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
