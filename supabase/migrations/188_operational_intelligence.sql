-- ── Sprint 4: Operational Intelligence & Controlled Automation ───────────────
-- All tables additive. No existing tables modified.

-- automation_activity_logs: append-only audit trail of all automation actions
CREATE TABLE IF NOT EXISTS automation_activity_logs (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_type  TEXT        NOT NULL
    CHECK (action_type IN ('notification','escalation','reminder','task_creation','nudge','sla_alert','incident_creation')),
  entity_id    UUID        NOT NULL,
  entity_type  TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  severity     TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  metadata     JSONB,
  explainability JSONB,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sla_breach_events: append-only SLA breach log
CREATE TABLE IF NOT EXISTS sla_breach_events (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sla_id           TEXT        NOT NULL,
  entity_id        UUID        NOT NULL,
  entity_type      TEXT        NOT NULL,
  breach_severity  TEXT        NOT NULL CHECK (breach_severity IN ('info','warning','high','critical')),
  description      TEXT        NOT NULL,
  explainability   JSONB,
  breached_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- operational_heatmap_snapshots: periodic heatmap captures
CREATE TABLE IF NOT EXISTS operational_heatmap_snapshots (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain       TEXT        NOT NULL
    CHECK (domain IN ('payroll','attendance','governance','trust','approvals','system')),
  period       TEXT        NOT NULL,  -- YYYY-MM
  cells        JSONB       NOT NULL DEFAULT '[]',
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- simulation_runs: analytical simulation history
CREATE TABLE IF NOT EXISTS simulation_runs (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  simulation_type  TEXT        NOT NULL
    CHECK (simulation_type IN ('payroll_impact','compliance_threshold','workforce_overtime','policy_change')),
  label            TEXT        NOT NULL,
  input_params     JSONB       NOT NULL DEFAULT '{}',
  result_summary   JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL
);

-- operational_health_signals: persisted health snapshots
CREATE TABLE IF NOT EXISTS operational_health_signals (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain       TEXT        NOT NULL,
  score        NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  severity     TEXT        NOT NULL CHECK (severity IN ('healthy','warning','critical')),
  factors      TEXT[]      NOT NULL DEFAULT '{}',
  explainability JSONB,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- security_intelligence_events: passive security signal log
CREATE TABLE IF NOT EXISTS security_intelligence_events (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  signal_type  TEXT        NOT NULL,
  entity_id    UUID        NOT NULL,
  entity_type  TEXT        NOT NULL DEFAULT 'user',
  severity     TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  description  TEXT        NOT NULL,
  metadata     JSONB,
  explainability JSONB,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_automation_logs_org ON automation_activity_logs(org_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_breaches_org ON sla_breach_events(org_id, breached_at DESC);
CREATE INDEX IF NOT EXISTS idx_heatmap_snapshots_org ON operational_heatmap_snapshots(org_id, domain, period);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_org ON simulation_runs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_signals_org ON operational_health_signals(org_id, domain, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_org ON security_intelligence_events(org_id, detected_at DESC);

-- RLS
ALTER TABLE automation_activity_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_breach_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_heatmap_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_runs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_health_signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_intelligence_events   ENABLE ROW LEVEL SECURITY;

-- Read policies
CREATE POLICY "aal_read" ON automation_activity_logs      FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "sbe_read" ON sla_breach_events             FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "ohs_read" ON operational_heatmap_snapshots FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "sr_read"  ON simulation_runs               FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "ohs2_read" ON operational_health_signals   FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "sie_read" ON security_intelligence_events  FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));

-- Write policies
CREATE POLICY "aal_insert" ON automation_activity_logs      FOR INSERT WITH CHECK (true);
CREATE POLICY "sbe_insert" ON sla_breach_events             FOR INSERT WITH CHECK (true);
CREATE POLICY "ohs_insert" ON operational_heatmap_snapshots FOR INSERT WITH CHECK (true);
CREATE POLICY "sr_insert"  ON simulation_runs               FOR INSERT WITH CHECK (true);
CREATE POLICY "ohs2_insert" ON operational_health_signals   FOR INSERT WITH CHECK (true);
CREATE POLICY "sie_insert" ON security_intelligence_events  FOR INSERT WITH CHECK (true);
