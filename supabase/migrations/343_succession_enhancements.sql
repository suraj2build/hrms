-- Migration 343: Succession Planning Enhancements
-- Adds calibration sessions, changes log, and mentor profiles

-- ── Calibration sessions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calibration_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  created_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  status       TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  participants JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS calibration_changes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
  changed_by    UUID        NOT NULL REFERENCES profiles(id),
  candidate_id  UUID        NOT NULL REFERENCES succession_candidates(id) ON DELETE CASCADE,
  field_changed TEXT        NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  notes         TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE calibration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_changes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calibration_sessions_tenant" ON calibration_sessions;
CREATE POLICY "calibration_sessions_tenant" ON calibration_sessions FOR ALL
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "calibration_changes_tenant" ON calibration_changes;
CREATE POLICY "calibration_changes_tenant" ON calibration_changes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM calibration_sessions cs
    WHERE cs.id = calibration_changes.session_id
      AND cs.tenant_id = get_user_tenant_id()
  ));

-- ── Mentor profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mentor_profiles (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID        NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  skill_tags       TEXT[]      NOT NULL DEFAULT '{}',
  max_mentees      INT         NOT NULL DEFAULT 2,
  current_mentees  INT         NOT NULL DEFAULT 0,
  available        BOOLEAN     NOT NULL DEFAULT true,
  engagement_score NUMERIC(4,1),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mentor_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_profiles_tenant" ON mentor_profiles;
CREATE POLICY "mentor_profiles_tenant" ON mentor_profiles FOR ALL
  USING (tenant_id = get_user_tenant_id());
