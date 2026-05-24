-- ============================================================
-- 073_workforce_intelligence.sql
--
-- Workforce Intelligence Engine — persistent snapshot cache.
-- Stores the most-recent intelligence snapshot per tenant so
-- the UI can load instantly without re-scanning all records.
--
-- The snapshot is written by the backend on demand (or by the
-- leave-scheduler daily tick) and contains pre-aggregated risk
-- scores, trend data, and anomaly patterns.
-- ============================================================

-- ── attendance_intelligence_snapshot ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_intelligence_snapshot (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_from     DATE        NOT NULL,
  period_to       DATE        NOT NULL,

  -- Aggregated stats (stored as JSONB for flexibility)
  summary         JSONB       NOT NULL DEFAULT '{}',
  at_risk         JSONB       NOT NULL DEFAULT '[]',  -- array of { employee_id, name, code, risk_score, reasons[] }
  trends          JSONB       NOT NULL DEFAULT '{}',  -- { daily: [...], anomaly_by_type: {...}, anomaly_by_severity: {...} }
  patterns        JSONB       NOT NULL DEFAULT '{}',  -- { repeat_offenders: [...], top_anomaly_types: [...] }

  UNIQUE (tenant_id)   -- one active snapshot per tenant (upsert replaces)
);

ALTER TABLE attendance_intelligence_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intel_tenant_read" ON attendance_intelligence_snapshot;
CREATE POLICY "intel_tenant_read" ON attendance_intelligence_snapshot
  FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "intel_hr_write" ON attendance_intelligence_snapshot;
CREATE POLICY "intel_hr_write" ON attendance_intelligence_snapshot
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── employee_risk_flags ───────────────────────────────────────────────────────
-- Persistent per-employee risk flags (updated when snapshot is computed).
-- HR can manually dismiss a flag; it reappears on the next compute run
-- if the condition still holds.
CREATE TABLE IF NOT EXISTS employee_risk_flags (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  flag_type       TEXT        NOT NULL
    CHECK (flag_type IN (
      'chronic_late',
      'frequent_no_punch',
      'high_anomaly_rate',
      'excessive_leave',
      'absent_streak',
      'low_attendance'
    )),
  risk_score      SMALLINT    NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  details         JSONB,
  first_flagged   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed       BOOLEAN     NOT NULL DEFAULT false,
  dismissed_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  dismissed_at    TIMESTAMPTZ,
  dismiss_note    TEXT,

  UNIQUE (tenant_id, employee_id, flag_type)
);

CREATE INDEX IF NOT EXISTS idx_risk_flags_tenant
  ON employee_risk_flags (tenant_id, dismissed, risk_score DESC);

ALTER TABLE employee_risk_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "risk_tenant_read" ON employee_risk_flags;
CREATE POLICY "risk_tenant_read" ON employee_risk_flags
  FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "risk_hr_write" ON employee_risk_flags;
CREATE POLICY "risk_hr_write" ON employee_risk_flags
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
