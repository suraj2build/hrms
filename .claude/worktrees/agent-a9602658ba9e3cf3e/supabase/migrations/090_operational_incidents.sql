-- ============================================================
-- 090_operational_incidents.sql
-- Workforce Operations Incident System: incident lifecycle,
-- escalation chains, investigation linkage, audit timelines.
-- ============================================================

-- Operational incidents — workforce operations events requiring response
CREATE TABLE IF NOT EXISTS operational_incidents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_type   TEXT        NOT NULL CHECK (incident_type IN (
    'payroll_impact',          -- payroll calculation disrupted
    'staffing_shortage',       -- critical understaffing
    'attendance_integrity',    -- data integrity / fraud concern
    'sla_breach_escalated',    -- SLA blown past escalation threshold
    'workforce_overload',      -- burnout-level overload detected
    'shift_imbalance',         -- systemic shift assignment problem
    'system_outage',           -- processing / automation outage
    'compliance_breach',       -- policy / legal compliance risk
    'data_anomaly',            -- suspicious data pattern
    'integration_failure'      -- external integration failure
  )),
  severity        TEXT        NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'low', 'medium', 'high', 'critical'
  )),
  status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'investigating', 'escalated', 'mitigating', 'resolved', 'closed', 'false_positive'
  )),
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  -- Linkage
  employee_id     UUID        REFERENCES employees(id) ON DELETE SET NULL,
  department_id   UUID        REFERENCES departments(id) ON DELETE SET NULL,
  -- Related entity (flexible)
  related_entity_type TEXT,
  related_entity_id   UUID,
  -- Resolution
  assigned_to     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  -- Payroll impact
  payroll_impact_amount DECIMAL(12,2),
  affected_employee_count INT,
  -- SLA
  sla_target_hours  INT,
  sla_breached      BOOLEAN   NOT NULL DEFAULT false,
  -- Investigation linkage
  investigation_id  UUID,                             -- links to investigation workflow
  -- Metadata
  source          TEXT        NOT NULL DEFAULT 'system' CHECK (source IN (
    'system', 'manual', 'alert', 'escalation', 'integration'
  )),
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oi_tenant_status
  ON operational_incidents (tenant_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oi_tenant_type
  ON operational_incidents (tenant_id, incident_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oi_assigned
  ON operational_incidents (tenant_id, assigned_to, status) WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS idx_oi_sla
  ON operational_incidents (tenant_id, sla_breached, status) WHERE sla_breached = true;

-- Incident escalations — escalation chain per incident
CREATE TABLE IF NOT EXISTS incident_escalations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id     UUID        NOT NULL REFERENCES operational_incidents(id) ON DELETE CASCADE,
  escalated_from  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  escalated_to    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  escalation_reason TEXT      NOT NULL,
  escalated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  stage           INT         NOT NULL DEFAULT 1      -- which escalation level
);

CREATE INDEX IF NOT EXISTS idx_ie_incident
  ON incident_escalations (incident_id, escalated_at);

-- Incident timeline events — operational audit trail per incident
CREATE TABLE IF NOT EXISTS incident_timeline_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id     UUID        NOT NULL REFERENCES operational_incidents(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN (
    'created', 'assigned', 'status_changed', 'severity_changed', 'escalated',
    'comment_added', 'resolution_proposed', 'resolved', 'closed',
    'payroll_impact_updated', 'investigation_linked', 'sla_breached'
  )),
  actor_id        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  description     TEXT        NOT NULL,
  before_state    JSONB,
  after_state     JSONB,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ite_incident
  ON incident_timeline_events (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ite_tenant_recent
  ON incident_timeline_events (tenant_id, created_at DESC);

-- Incident comments — discussion thread
CREATE TABLE IF NOT EXISTS incident_comments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id     UUID        NOT NULL REFERENCES operational_incidents(id) ON DELETE CASCADE,
  author_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT        NOT NULL,
  is_internal     BOOLEAN     NOT NULL DEFAULT false,   -- internal = visible only to HR
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ic_incident
  ON incident_comments (incident_id, created_at ASC);

-- RLS
ALTER TABLE operational_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oi_tenant_read" ON operational_incidents FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "oi_hr_write" ON operational_incidents FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ie_tenant_read" ON incident_escalations FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ie_hr_write" ON incident_escalations FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ite_tenant_read" ON incident_timeline_events FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ite_hr_write" ON incident_timeline_events FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ic_tenant_read" ON incident_comments FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ic_hr_write" ON incident_comments FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));
