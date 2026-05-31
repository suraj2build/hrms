-- ── Sprint 2: Governance Intelligence Layer ──────────────────────────────────
-- Additive only — no existing tables modified.
-- Migration 186: governance_rules, compliance_evaluations, governance_risk_scores,
--                governance_drift_events

-- governance_rules: persistent rule definitions (supplement in-memory registry)
CREATE TABLE IF NOT EXISTS governance_rules (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id         TEXT        NOT NULL UNIQUE,
  name            TEXT        NOT NULL,
  description     TEXT,
  category        TEXT        NOT NULL CHECK (category IN ('compliance','risk','trust','attendance','payroll','security','escalation','leave')),
  jurisdiction    TEXT,
  state           TEXT,
  severity        TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  effective_from  DATE        NOT NULL,
  effective_to    DATE,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  event_types     TEXT[]      NOT NULL DEFAULT '{}',
  conditions      JSONB       NOT NULL DEFAULT '{}',
  actions         JSONB       NOT NULL DEFAULT '[]',
  replay_safe     BOOLEAN     NOT NULL DEFAULT true,
  explainability_template TEXT,
  tenant_id       UUID        REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform-wide rule
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- compliance_evaluations: append-only compliance check results
-- event_id is a soft reference to platform_events — no FK constraint so this
-- table can be created even if platform_events hasn't been applied yet.
-- The FK is added separately below once platform_events is confirmed to exist.
CREATE TABLE IF NOT EXISTS compliance_evaluations (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        UUID,       -- soft ref to platform_events.id (FK added below)
  entity_type     TEXT        NOT NULL,
  entity_id       UUID        NOT NULL,
  rule_id         TEXT,
  compliant       BOOLEAN     NOT NULL,
  severity        TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  violations      TEXT[]      NOT NULL DEFAULT '{}',
  explainability  JSONB,
  evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK to platform_events only if that table exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'platform_events')
  AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_schema = 'public'
                    AND table_name = 'compliance_evaluations'
                    AND constraint_name = 'compliance_evaluations_event_id_fkey') THEN
    ALTER TABLE compliance_evaluations
      ADD CONSTRAINT compliance_evaluations_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES platform_events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- governance_risk_scores: snapshot risk scores per entity
CREATE TABLE IF NOT EXISTS governance_risk_scores (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT        NOT NULL,
  entity_id       UUID        NOT NULL,
  score_type      TEXT        NOT NULL CHECK (score_type IN ('employee','branch','payroll','attendance','governance_drift')),
  score           NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  severity        TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  contributing_factors JSONB  NOT NULL DEFAULT '[]',
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id)  -- upsert-friendly
);

-- governance_drift_events: append-only drift signals
-- source_event_id is a soft reference — FK added below once platform_events exists.
CREATE TABLE IF NOT EXISTS governance_drift_events (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  signal          TEXT        NOT NULL,
  severity        TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  affected_module TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  entity_id       UUID,
  entity_type     TEXT,
  explainability  JSONB,
  source_event_id UUID,       -- soft ref to platform_events.id (FK added below)
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK to platform_events only if that table exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'platform_events')
  AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_schema = 'public'
                    AND table_name = 'governance_drift_events'
                    AND constraint_name = 'governance_drift_events_source_event_id_fkey') THEN
    ALTER TABLE governance_drift_events
      ADD CONSTRAINT governance_drift_events_source_event_id_fkey
      FOREIGN KEY (source_event_id) REFERENCES platform_events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compliance_evaluations_tenant_entity ON compliance_evaluations(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_compliance_evaluations_tenant_compliant ON compliance_evaluations(tenant_id, compliant) WHERE compliant = false;
CREATE INDEX IF NOT EXISTS idx_governance_risk_scores_tenant ON governance_risk_scores(tenant_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_governance_drift_events_tenant ON governance_drift_events(tenant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_rules_category ON governance_rules(category, effective_from);

-- RLS
ALTER TABLE governance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_drift_events ENABLE ROW LEVEL SECURITY;

-- HR/admin can read governance intelligence for their tenant
CREATE POLICY "gr_read"  ON governance_rules           FOR SELECT USING (tenant_id = auth.uid() OR tenant_id IS NULL);
CREATE POLICY "ce_read"  ON compliance_evaluations     FOR SELECT USING (tenant_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "grs_read" ON governance_risk_scores     FOR SELECT USING (tenant_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "gde_read" ON governance_drift_events    FOR SELECT USING (tenant_id IN (SELECT id FROM tenants WHERE id = auth.uid()));

-- Service role can insert/update
CREATE POLICY "ce_insert"  ON compliance_evaluations  FOR INSERT WITH CHECK (true);
CREATE POLICY "grs_upsert" ON governance_risk_scores  FOR INSERT WITH CHECK (true);
CREATE POLICY "grs_update" ON governance_risk_scores  FOR UPDATE USING (true);
CREATE POLICY "gde_insert" ON governance_drift_events FOR INSERT WITH CHECK (true);
CREATE POLICY "gr_insert"  ON governance_rules        FOR INSERT WITH CHECK (true);
