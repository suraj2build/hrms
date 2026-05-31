-- ── Sprint 3: Workforce Trust & Compliance Intelligence ─────────────────────
-- All tables are additive. No existing tables modified.

-- verification_events: append-only log of all verification checks
CREATE TABLE IF NOT EXISTS verification_events (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id         UUID        NOT NULL,
  entity_type       TEXT        NOT NULL DEFAULT 'employee',
  verification_type TEXT        NOT NULL
    CHECK (verification_type IN ('pan','aadhaar','bank_account','ifsc','document','phone','email')),
  status            TEXT        NOT NULL
    CHECK (status IN ('verified','failed','pending','skipped','inconclusive')),
  score             NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  flags             TEXT[]      NOT NULL DEFAULT '{}',
  explainability    JSONB,
  verified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- duplicate_detection_events: append-only duplicate alerts
CREATE TABLE IF NOT EXISTS duplicate_detection_events (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id             UUID        NOT NULL,
  entity_type           TEXT        NOT NULL DEFAULT 'employee',
  duplicate_type        TEXT        NOT NULL
    CHECK (duplicate_type IN ('pan','bank_account','phone','nominee_name','emergency_contact_phone','device_fingerprint','aadhaar')),
  matching_entity_ids   UUID[]      NOT NULL DEFAULT '{}',
  value_hash            TEXT        NOT NULL,  -- SHA-256, no PII
  severity              TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  explainability        JSONB,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- workforce_trust_scores: latest trust score per entity (upsert-friendly)
CREATE TABLE IF NOT EXISTS workforce_trust_scores (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id           UUID        NOT NULL,
  entity_type         TEXT        NOT NULL DEFAULT 'employee',
  score_type          TEXT        NOT NULL
    CHECK (score_type IN ('employee','onboarding','payroll','document')),
  score               NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (score >= 0 AND score <= 100),
  severity            TEXT        NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  factors             TEXT[]      NOT NULL DEFAULT '{}',
  explainability      JSONB,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity_id, score_type)
);

-- workforce_graph_edges: entity relationship graph (hashed values only, no PII)
CREATE TABLE IF NOT EXISTS workforce_graph_edges (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_entity  UUID        NOT NULL,
  from_type    TEXT        NOT NULL DEFAULT 'employee',
  to_entity    TEXT        NOT NULL,  -- hashed value (SHA-256)
  to_type      TEXT        NOT NULL,  -- 'pan' | 'bank_account' | 'phone' | etc.
  edge_type    TEXT        NOT NULL
    CHECK (edge_type IN ('employee_bank','employee_nominee','employee_phone','employee_emergency_contact','employee_document','employee_pan')),
  weight       NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, from_entity, to_entity, edge_type)
);

-- compliance_revision_events: regulatory change tracking
CREATE TABLE IF NOT EXISTS compliance_revision_events (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id            UUID        REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform-wide
  revision_type     TEXT        NOT NULL
    CHECK (revision_type IN ('pf','esi','minimum_wage','overtime','jurisdiction_specific')),
  jurisdiction      TEXT        NOT NULL DEFAULT 'IN',
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  old_value         NUMERIC,
  new_value         NUMERIC,
  unit              TEXT,
  effective_from    DATE        NOT NULL,
  source_reference  TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','superseded')),
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  explainability    JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_verification_events_org_entity ON verification_events(org_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_type ON verification_events(org_id, verification_type, status);
CREATE INDEX IF NOT EXISTS idx_dup_events_org ON duplicate_detection_events(org_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_dup_events_hash ON duplicate_detection_events(org_id, value_hash);
CREATE INDEX IF NOT EXISTS idx_trust_scores_org ON workforce_trust_scores(org_id, score ASC);
CREATE INDEX IF NOT EXISTS idx_graph_edges_org_from ON workforce_graph_edges(org_id, from_entity);
CREATE INDEX IF NOT EXISTS idx_graph_edges_org_to ON workforce_graph_edges(org_id, to_entity, edge_type);
CREATE INDEX IF NOT EXISTS idx_compliance_revisions_status ON compliance_revision_events(status, ingested_at DESC);

-- RLS
ALTER TABLE verification_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_detection_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_trust_scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_graph_edges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_revision_events   ENABLE ROW LEVEL SECURITY;

-- Read policies (HR/admin for their tenant)
CREATE POLICY "ve_read"   ON verification_events        FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "dde_read"  ON duplicate_detection_events FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "wts_read"  ON workforce_trust_scores     FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "wge_read"  ON workforce_graph_edges      FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
CREATE POLICY "cre_read"  ON compliance_revision_events FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()) OR org_id IS NULL);

-- Write policies (service role)
CREATE POLICY "ve_insert"  ON verification_events        FOR INSERT WITH CHECK (true);
CREATE POLICY "dde_insert" ON duplicate_detection_events FOR INSERT WITH CHECK (true);
CREATE POLICY "wts_upsert" ON workforce_trust_scores     FOR INSERT WITH CHECK (true);
CREATE POLICY "wts_update" ON workforce_trust_scores     FOR UPDATE USING (true);
CREATE POLICY "wge_upsert" ON workforce_graph_edges      FOR INSERT WITH CHECK (true);
CREATE POLICY "wge_update" ON workforce_graph_edges      FOR UPDATE USING (true);
CREATE POLICY "cre_insert" ON compliance_revision_events FOR INSERT WITH CHECK (true);
CREATE POLICY "cre_update" ON compliance_revision_events FOR UPDATE USING (true);
