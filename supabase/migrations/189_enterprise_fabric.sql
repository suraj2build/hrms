-- ── Sprint 5: Enterprise Orchestration Fabric ────────────────────────────────
-- All tables additive. No existing tables modified.

-- decision_graph_nodes: append-only decision lineage
CREATE TABLE IF NOT EXISTS decision_graph_nodes (
  node_id      TEXT        NOT NULL,
  node_type    TEXT        NOT NULL
    CHECK (node_type IN ('approval','escalation','override','governance_eval','automation_action','trust_decision','simulation','sla_breach','system')),
  entity_id    UUID        NOT NULL,
  entity_type  TEXT        NOT NULL,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  description  TEXT        NOT NULL,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  metadata     JSONB,
  explainability JSONB,
  CONSTRAINT decision_graph_nodes_pkey PRIMARY KEY (node_id)
);

-- decision_graph_edges: directional edges between decision nodes
CREATE TABLE IF NOT EXISTS decision_graph_edges (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_node_id TEXT        NOT NULL REFERENCES decision_graph_nodes(node_id) ON DELETE CASCADE,
  to_node_id   TEXT        NOT NULL REFERENCES decision_graph_nodes(node_id) ON DELETE CASCADE,
  edge_type    TEXT        NOT NULL
    CHECK (edge_type IN ('caused_by','triggers','correlates_with','escalates_to','resolves')),
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weight       NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- orchestration_activity_logs: workflow orchestration audit trail
CREATE TABLE IF NOT EXISTS orchestration_activity_logs (
  activity_id    TEXT        NOT NULL PRIMARY KEY,
  org_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_type  TEXT        NOT NULL,
  entity_id      UUID        NOT NULL,
  entity_type    TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','cancelled')),
  steps          JSONB       NOT NULL DEFAULT '[]',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  metadata       JSONB,
  explainability JSONB
);

-- replay_sessions: operational replay audit records
CREATE TABLE IF NOT EXISTS replay_sessions (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id        UUID        NOT NULL,
  entity_type      TEXT        NOT NULL,
  replay_from      TIMESTAMPTZ NOT NULL,
  replay_to        TIMESTAMPTZ NOT NULL,
  events_replayed  INTEGER     NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL CHECK (status IN ('running','completed','failed')),
  result_summary   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL
);

-- intelligence_compositions: persisted composition snapshots
CREATE TABLE IF NOT EXISTS intelligence_compositions (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id           UUID        NOT NULL,
  entity_type         TEXT        NOT NULL,
  governance_score    NUMERIC(5,2) NOT NULL,
  trust_score         NUMERIC(5,2) NOT NULL,
  operational_health  NUMERIC(5,2) NOT NULL,
  security_risk       NUMERIC(5,2) NOT NULL,
  composite_risk      NUMERIC(5,2) NOT NULL,
  severity            TEXT        NOT NULL,
  factors             TEXT[]      NOT NULL DEFAULT '{}',
  explainability      JSONB,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- enterprise_health_snapshots: fabric-level health history
CREATE TABLE IF NOT EXISTS enterprise_health_snapshots (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  overall_score          NUMERIC(5,2) NOT NULL,
  governance_health      NUMERIC(5,2),
  trust_health           NUMERIC(5,2),
  operational_health     NUMERIC(5,2),
  security_health        NUMERIC(5,2),
  active_orchestrations  INTEGER     NOT NULL DEFAULT 0,
  pending_slas           INTEGER     NOT NULL DEFAULT 0,
  open_incidents         INTEGER     NOT NULL DEFAULT 0,
  explainability         JSONB,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dgn_org_entity ON decision_graph_nodes(org_id, entity_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dgn_org_type   ON decision_graph_nodes(org_id, node_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dge_from       ON decision_graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_dge_to         ON decision_graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_oal_org        ON orchestration_activity_logs(org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_org         ON replay_sessions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ic_org_entity  ON intelligence_compositions(org_id, entity_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_org        ON enterprise_health_snapshots(org_id, computed_at DESC);

-- RLS
ALTER TABLE decision_graph_nodes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_graph_edges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE replay_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_compositions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_health_snapshots ENABLE ROW LEVEL SECURITY;

-- Read
CREATE POLICY "dgn_read"  ON decision_graph_nodes        FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "dge_read"  ON decision_graph_edges        FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "oal_read"  ON orchestration_activity_logs FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "rs_read"   ON replay_sessions             FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "ic_read"   ON intelligence_compositions   FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "ehs_read"  ON enterprise_health_snapshots FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));

-- Write
CREATE POLICY "dgn_insert" ON decision_graph_nodes        FOR INSERT WITH CHECK (true);
CREATE POLICY "dge_insert" ON decision_graph_edges        FOR INSERT WITH CHECK (true);
CREATE POLICY "oal_insert" ON orchestration_activity_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "oal_update" ON orchestration_activity_logs FOR UPDATE USING (true);
CREATE POLICY "rs_insert"  ON replay_sessions             FOR INSERT WITH CHECK (true);
CREATE POLICY "ic_insert"  ON intelligence_compositions   FOR INSERT WITH CHECK (true);
CREATE POLICY "ehs_insert" ON enterprise_health_snapshots FOR INSERT WITH CHECK (true);
