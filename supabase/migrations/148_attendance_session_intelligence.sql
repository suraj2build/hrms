-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 148 — Attendance Session Intelligence & Temporal Ownership Engine
--
-- Adds:
--   1. shifts columns       — crosses_midnight, shift_day_offset, max_shift_span_hours
--   2. work_sessions        — canonical paired-punch session ledger per business date
--   3. work_session_anomalies — detected attendance anomalies per session / day
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Extend shifts ──────────────────────────────────────────────────────────
--
--   crosses_midnight     — true when shift end_time is on the following calendar day
--   shift_day_offset     — number of calendar days the shift spans
--                          1 = starts and ends on the same date
--                          2 = ends on the next calendar day (typical night shift)
--   max_shift_span_hours — hard cap used when repairing missing OUT punches;
--                          a session will never be estimated beyond this many hours

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS crosses_midnight      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shift_day_offset      INT     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_shift_span_hours  INT     NOT NULL DEFAULT 12;

-- ── 2. work_sessions ─────────────────────────────────────────────────────────
--
--   One row per paired IN/OUT session.  An employee may have more than one row
--   per attendance_date (split shifts, early-exit + re-entry, etc.).
--
--   attendance_date  — the BUSINESS date that owns this session for payroll
--                      purposes.  For cross-midnight shifts the business date is
--                      the date the shift STARTED, not the calendar date of the
--                      OUT punch.
--
--   source_punch_ids — JSONB array of attendance_punches.id values that were
--                      consumed to build this session.
--
--   compliance_flags — arbitrary key-value bag; used by the engine to attach
--                      flags such as { estimated_out: true }, { split_session: true }.

CREATE TABLE IF NOT EXISTS work_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  employee_id           UUID        NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,

  -- Temporal ownership
  attendance_date       DATE        NOT NULL,
  session_start         TIMESTAMPTZ NOT NULL,
  session_end           TIMESTAMPTZ,                          -- NULL = open / incomplete
  work_minutes          INT,                                  -- NULL until session closed

  -- Computed deviations (populated by the session engine)
  overtime_minutes      INT         NOT NULL DEFAULT 0,
  late_minutes          INT         NOT NULL DEFAULT 0,
  early_exit_minutes    INT         NOT NULL DEFAULT 0,

  -- Source tracking
  source                TEXT        NOT NULL
    CHECK (source IN ('biometric', 'mobile', 'manual', 'kiosk', 'import')),
  source_punch_ids      JSONB       NOT NULL DEFAULT '[]',

  -- Shift linkage
  shift_id              UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  is_cross_midnight     BOOLEAN     NOT NULL DEFAULT false,

  -- Lifecycle / approval
  approval_status       TEXT        NOT NULL DEFAULT 'auto'
    CHECK (approval_status IN ('auto', 'pending', 'approved', 'rejected', 'flagged')),

  -- Payroll lock
  payroll_locked        BOOLEAN     NOT NULL DEFAULT false,
  payroll_locked_at     TIMESTAMPTZ,
  payroll_run_id        UUID,

  -- Compliance
  compliance_flags      JSONB       NOT NULL DEFAULT '{}',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for work_sessions
CREATE INDEX IF NOT EXISTS idx_work_sessions_emp_date
  ON work_sessions (tenant_id, employee_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_work_sessions_payroll_locked
  ON work_sessions (tenant_id, payroll_locked)
  WHERE payroll_locked = true;

CREATE INDEX IF NOT EXISTS idx_work_sessions_session_start
  ON work_sessions (tenant_id, session_start);

CREATE INDEX IF NOT EXISTS idx_work_sessions_session_end
  ON work_sessions (tenant_id, session_end)
  WHERE session_end IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_sessions_approval_status
  ON work_sessions (tenant_id, approval_status)
  WHERE approval_status != 'auto';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_work_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_work_sessions_updated_at ON work_sessions;
CREATE TRIGGER set_work_sessions_updated_at
  BEFORE UPDATE ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION trg_work_sessions_updated_at();

-- ── 3. work_session_anomalies ─────────────────────────────────────────────────
--
--   Detected anomalies produced by the session intelligence engine.
--   Multiple anomalies can reference the same work_session.
--
--   anomaly_type values:
--     missing_punch              — IN punch with no matching OUT (or vice-versa)
--     excessive_ot               — session OT exceeds policy threshold
--     insufficient_rest          — < min_rest_hours gap after previous day's last session
--     double_shift               — more than 2 complete sessions on the same business date
--     unauthorized_source        — punch source not in the site's allowed list
--     suspicious_timing          — punch time is in the dead-hours window (e.g. 00:00–04:00)
--     excessive_consecutive_days — employee has worked more than max_consecutive_workdays
--     early_punch                — punch-in significantly before shift open window
--     late_punch                 — punch-out significantly after shift close window
--     duplicate_punch            — two punches of the same type within dedup window
--     cross_midnight_unresolved  — cross-midnight IN punch with no OUT by next business day

CREATE TABLE IF NOT EXISTS work_session_anomalies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  attendance_date  DATE        NOT NULL,

  anomaly_type     TEXT        NOT NULL
    CHECK (anomaly_type IN (
      'missing_punch',
      'excessive_ot',
      'insufficient_rest',
      'double_shift',
      'unauthorized_source',
      'suspicious_timing',
      'excessive_consecutive_days',
      'early_punch',
      'late_punch',
      'duplicate_punch',
      'cross_midnight_unresolved'
    )),

  severity         TEXT        NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'critical')),

  -- Optional back-reference to the offending session
  session_id       UUID        REFERENCES work_sessions(id) ON DELETE SET NULL,

  -- Punch IDs involved (may be empty for day-level anomalies like consecutive_days)
  punch_ids        JSONB       NOT NULL DEFAULT '[]',

  -- Arbitrary context bag (thresholds, measured values, etc.)
  detail           JSONB       NOT NULL DEFAULT '{}',

  -- Resolution tracking
  resolved         BOOLEAN     NOT NULL DEFAULT false,
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID        REFERENCES employees(id) ON DELETE SET NULL,
  resolution_note  TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for work_session_anomalies
CREATE INDEX IF NOT EXISTS idx_wsa_emp_date
  ON work_session_anomalies (tenant_id, employee_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_wsa_anomaly_type
  ON work_session_anomalies (tenant_id, anomaly_type);

CREATE INDEX IF NOT EXISTS idx_wsa_unresolved
  ON work_session_anomalies (tenant_id, resolved)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS idx_wsa_severity
  ON work_session_anomalies (tenant_id, severity);

-- ── 4. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE work_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_session_anomalies ENABLE ROW LEVEL SECURITY;

-- work_sessions: tenant isolation via profiles (consistent with rest of schema)
DROP POLICY IF EXISTS "tenant_isolation" ON work_sessions;
CREATE POLICY "tenant_isolation" ON work_sessions
  USING (tenant_id = get_user_tenant_id());

-- work_session_anomalies: tenant isolation via profiles
DROP POLICY IF EXISTS "tenant_isolation" ON work_session_anomalies;
CREATE POLICY "tenant_isolation" ON work_session_anomalies
  USING (tenant_id = get_user_tenant_id()
  );
