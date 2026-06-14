-- ============================================================
-- 249_positions.sql
--
-- R7 (Position Management) — the sanctioned-strength layer.
--
-- Until now the system tracked WHO fills WHAT (job_history) and how many to
-- hire RIGHT NOW (job_requisitions.openings), but never the authorised
-- structure: the permanent slots an org budgets for. This migration adds that
-- missing layer and the two KPIs the R0 registry deferred to R7:
--   PLN.sanction_vs_actual = sanctioned_count − filled_count  (per position / org unit)
--   PLN.vacancy            = open positions + ageing
--
-- New:  positions table (sanctioned slots)
-- Wire: position_id FK on job_requisitions (demand → slot)
--       position_id FK on job_history      (who occupies which slot)
-- View: position_vacancy_summary (sanctioned vs filled, derived — no new data)
--
-- All additive & idempotent: existing rows are unaffected; position_id is
-- nullable so legacy job_history / requisitions keep working.
-- ============================================================

-- ── Position master ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              TEXT         NOT NULL,                 -- e.g. 'ENG-SR-001'
  title             TEXT         NOT NULL,                 -- display name (may differ from designation)
  -- What kind of slot this is — all FK to the existing org taxonomy
  designation_id    UUID         REFERENCES designations(id)   ON DELETE SET NULL,
  grade_id          UUID         REFERENCES grades(id)         ON DELETE SET NULL,
  department_id     UUID         REFERENCES departments(id)    ON DELETE SET NULL,
  work_location_id  UUID         REFERENCES work_locations(id) ON DELETE SET NULL,
  cost_center_id    UUID         REFERENCES cost_centers(id)   ON DELETE SET NULL,
  site_id           UUID         REFERENCES sites(id)          ON DELETE SET NULL,
  -- Sanctioned strength: how many people this slot is authorised for
  sanctioned_count  INT          NOT NULL DEFAULT 1 CHECK (sanctioned_count > 0),
  status            TEXT         NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','frozen','abolished')),
  effective_date    DATE         NOT NULL DEFAULT CURRENT_DATE,  -- when the slot was sanctioned
  abolished_date    DATE,                                        -- when abolished (status='abolished')
  notes             TEXT,
  created_by        UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_positions_tenant_status
  ON positions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_dept
  ON positions (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_site
  ON positions (tenant_id, site_id);

CREATE OR REPLACE FUNCTION trg_positions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_positions_updated_at ON positions;
CREATE TRIGGER trg_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION trg_positions_updated_at();

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS positions_tenant_iso ON positions;
CREATE POLICY positions_tenant_iso ON positions
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Wire position_id onto the demand side (requisitions) ──────────────────────
ALTER TABLE job_requisitions
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jr_position
  ON job_requisitions (tenant_id, position_id) WHERE position_id IS NOT NULL;

-- ── Wire position_id onto the occupancy side (job_history) ────────────────────
ALTER TABLE job_history
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jh_position
  ON job_history (tenant_id, position_id) WHERE position_id IS NOT NULL;

-- ── Derived vacancy view (no new data; sanctioned − filled) ───────────────────
-- security_invoker so it respects the caller's RLS (the API uses the service
-- role and additionally filters tenant_id explicitly, matching house style).
-- filled_count = current occupants of the slot (job_history.is_current=true).
DROP VIEW IF EXISTS position_vacancy_summary;
CREATE VIEW position_vacancy_summary
  WITH (security_invoker = true) AS
SELECT
  p.id                                       AS position_id,
  p.tenant_id,
  p.code,
  p.title,
  p.department_id,
  p.designation_id,
  p.grade_id,
  p.site_id,
  p.status,
  p.sanctioned_count,
  COUNT(jh.id)                               AS filled_count,
  GREATEST(p.sanctioned_count - COUNT(jh.id), 0) AS open_vacancies,
  p.effective_date                           AS sanctioned_since,
  (CURRENT_DATE - p.effective_date)          AS vacancy_age_days
FROM positions p
LEFT JOIN job_history jh
  ON jh.position_id = p.id
 AND jh.is_current  = true
 AND jh.tenant_id   = p.tenant_id
WHERE p.status = 'active'
GROUP BY p.id, p.tenant_id, p.code, p.title, p.department_id,
         p.designation_id, p.grade_id, p.site_id, p.status,
         p.sanctioned_count, p.effective_date;
