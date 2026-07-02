/**
 * Migration 122 — Compliance Readiness Framework
 *
 * Provides compliance-as-code infrastructure so that audit evidence
 * is generated automatically from the platform's own data, not assembled
 * manually each audit cycle.
 *
 * Tables:
 *   compliance_controls          — control registry (SOC 2, DPDPA 2023, ISO 27001)
 *   compliance_evidence_snapshots — periodic evidence collection per control
 *
 * The evidence collection job runs quarterly and upserts a snapshot row
 * per control. Auditors export these rows to produce evidence packages.
 */

-- ── Compliance control registry ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_controls (
  control_id       text        PRIMARY KEY,   -- 'CC6.1', 'DPDPA-8', 'ISO-A9.4' etc.
  framework        text        NOT NULL
                               CHECK (framework IN ('SOC2', 'DPDPA2023', 'ISO27001', 'Internal')),
  category         text        NOT NULL,      -- 'access_control', 'encryption', 'incident_response' …
  control_text     text        NOT NULL,      -- formal control statement (verbatim from standard)
  implementation   text        NOT NULL,      -- how the platform satisfies this control
  evidence_source  text,                      -- table/view/API to query for evidence
  status           text        NOT NULL DEFAULT 'implemented'
                               CHECK (status IN ('not_started','in_progress','implemented','verified','waived')),
  waiver_reason    text,                      -- if status='waived'
  waiver_approved_by text,
  owner            text        NOT NULL,      -- team or person responsible
  last_reviewed    date,
  next_review_date date GENERATED ALWAYS AS (last_reviewed + 365) STORED,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_controls_framework ON compliance_controls (framework);
CREATE INDEX IF NOT EXISTS idx_compliance_controls_status    ON compliance_controls (status)
  WHERE status NOT IN ('implemented', 'verified');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_touch_compliance_controls()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_compliance_controls
  BEFORE UPDATE ON compliance_controls
  FOR EACH ROW EXECUTE FUNCTION fn_touch_compliance_controls();

COMMENT ON TABLE compliance_controls IS
  'Control registry mapping platform capabilities to SOC 2, DPDPA 2023, and ISO 27001 requirements. '
  'One row per control. Evidence snapshots collected quarterly via scheduler job.';

-- ── Evidence snapshots ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_evidence_snapshots (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id       text        NOT NULL REFERENCES compliance_controls(control_id) ON DELETE CASCADE,
  snapshot_date    date        NOT NULL DEFAULT CURRENT_DATE,
  evidence_data    jsonb       NOT NULL DEFAULT '{}',   -- computed evidence payload
  pass             boolean     NOT NULL,
  failure_reason   text,                                -- if pass=false: what's missing
  collected_by     text        NOT NULL DEFAULT 'automated',  -- 'automated' or user id
  collection_method text       NOT NULL DEFAULT 'scheduler',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (control_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_compliance_evidence_control  ON compliance_evidence_snapshots (control_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_evidence_failing  ON compliance_evidence_snapshots (snapshot_date DESC)
  WHERE pass = false;

COMMENT ON TABLE compliance_evidence_snapshots IS
  'Quarterly evidence snapshots per control. Auditors export these rows. '
  'Unique constraint prevents duplicate snapshots per control per day.';

-- ── Compliance health view ────────────────────────────────────────────────────

CREATE VIEW compliance_health AS
SELECT
  c.control_id,
  c.framework,
  c.category,
  c.status                                                          AS control_status,
  c.owner,
  c.last_reviewed,
  c.next_review_date,
  e.snapshot_date                                                   AS last_evidence_date,
  e.pass                                                            AS last_evidence_pass,
  e.failure_reason                                                  AS last_failure_reason,
  EXTRACT(DAY FROM now() - e.snapshot_date::timestamptz)::int      AS evidence_age_days,
  CASE
    WHEN e.snapshot_date IS NULL                      THEN 'no_evidence'
    WHEN e.pass = false                               THEN 'failing'
    WHEN e.snapshot_date < CURRENT_DATE - 90          THEN 'stale'
    ELSE                                                   'current'
  END                                                               AS evidence_status,
  CASE
    WHEN c.next_review_date < CURRENT_DATE             THEN 'overdue'
    WHEN c.next_review_date < CURRENT_DATE + 30        THEN 'due_soon'
    ELSE                                                   'current'
  END                                                               AS review_status
FROM  compliance_controls c
LEFT  JOIN LATERAL (
  SELECT snapshot_date, pass, failure_reason
  FROM   compliance_evidence_snapshots
  WHERE  control_id = c.control_id
  ORDER  BY snapshot_date DESC
  LIMIT  1
) e ON true;

COMMENT ON VIEW compliance_health IS
  'Per-control compliance health rollup. Dashboard reads this view. '
  'evidence_status=failing or no_evidence requires operator action.';

-- ── Seed: 25 foundational controls ───────────────────────────────────────────

INSERT INTO compliance_controls
  (control_id, framework, category, control_text, implementation, evidence_source, status, owner, last_reviewed)
VALUES

-- SOC 2 Trust Services Criteria
('CC6.1',  'SOC2', 'access_control',
 'Logical and physical access controls restrict access to assets',
 'Role-based access via auth.users roles. requirePermission() preHandler on all sensitive routes. privileged_action_audit records every elevated action.',
 'privileged_action_audit', 'implemented', 'Platform Team', CURRENT_DATE),

('CC6.2',  'SOC2', 'access_control',
 'New internal and external users are registered and granted access based on authorization',
 'Employee creation requires hr_admin role. Tenant provisioning requires super_admin. No self-service role elevation.',
 'auth.users', 'implemented', 'Platform Team', CURRENT_DATE),

('CC6.3',  'SOC2', 'access_control',
 'Access is removed when no longer required',
 'Employee status=terminated triggers session revocation job. Auth.users disabled on offboarding.',
 'employees', 'implemented', 'Platform Team', CURRENT_DATE),

('CC7.1',  'SOC2', 'monitoring',
 'System performance and capacity are monitored and evaluated',
 'Operational health dashboard (/system/operational-health). Business event metrics. Scheduler heartbeats. Durable queue metrics.',
 'module_health', 'implemented', 'Platform Team', CURRENT_DATE),

('CC7.2',  'SOC2', 'incident_detection',
 'Security events are identified and documented',
 'security_events table (partitioned). 12 detection rules in security_detection_rules. security_alerts table with MTTA tracking.',
 'security_alerts', 'implemented', 'Platform Team', CURRENT_DATE),

('CC7.3',  'SOC2', 'incident_response',
 'Identified security incidents are responded to and resolved',
 'security_alerts → operational_incidents escalation path. On-call rotation. Documented runbooks per scenario.',
 'security_alerts', 'implemented', 'Platform Team', CURRENT_DATE),

('CC8.1',  'SOC2', 'change_management',
 'Changes to infrastructure and software are authorized and tested before deployment',
 'Migration files versioned in repository. CI/CD runs scale tests and chaos test suite. Deployment requires passing test gates.',
 'chaos_test_runs', 'implemented', 'Platform Team', CURRENT_DATE),

('CC9.1',  'SOC2', 'risk_mitigation',
 'Identified risks are mitigated through implementation of controls',
 'chaos_test_runs table captures 12 resilience scenarios. Quarterly execution. CI/CD gates on pass rate.',
 'chaos_test_runs', 'implemented', 'Platform Team', CURRENT_DATE),

('A1.1',   'SOC2', 'availability',
 'Current processing capacity and usage are maintained and monitored',
 'Scale validation matrix (12 operations). Durable queue depth monitoring. Connection pool utilization alerts.',
 'module_health', 'implemented', 'Platform Team', CURRENT_DATE),

('A1.2',   'SOC2', 'availability',
 'Recovery objectives are established and procedures are in place to achieve them',
 'restore_drills table (RTO ≤ 4h, RPO ≤ 1h targets). 4 DR scenario runbooks. Quarterly drill requirement.',
 'restore_drills', 'implemented', 'Platform Team', CURRENT_DATE),

-- DPDPA 2023 obligations
('DPDPA-5',  'DPDPA2023', 'lawful_processing',
 'Personal data shall be processed only for specified lawful purposes',
 'data_field_classifications.gdpr_basis documents lawful basis per field. Purpose recorded in pii_access_log.',
 'data_field_classifications', 'implemented', 'Legal/DPO', CURRENT_DATE),

('DPDPA-8',  'DPDPA2023', 'data_fiduciary',
 'Data fiduciary obligations: accuracy, completeness, and storage limitation',
 'data_field_classifications.retention_days enforced by retention_enforcement_runs scheduler job.',
 'retention_enforcement_runs', 'implemented', 'Legal/DPO', CURRENT_DATE),

('DPDPA-9',  'DPDPA2023', 'data_minimisation',
 'Only necessary personal data shall be processed',
 'data_field_classifications registry documents all PII fields. API layer returns only required fields (no SELECT *).',
 'data_field_classifications', 'implemented', 'Legal/DPO', CURRENT_DATE),

('DPDPA-11', 'DPDPA2023', 'consent',
 'Personal data shall be processed only with valid consent or other lawful basis',
 'Employment contract constitutes lawful basis documented in data_field_classifications.gdpr_basis.',
 'data_field_classifications', 'implemented', 'Legal/DPO', CURRENT_DATE),

('DPDPA-12', 'DPDPA2023', 'data_principal_rights',
 'Right of erasure — data principal can request deletion of personal data',
 'erasure_requests table with 30-day SLA. Durable queue job pii_erasure processes requests. Completion verified via erasure_requests.verification_hash.',
 'erasure_requests', 'implemented', 'Legal/DPO', CURRENT_DATE),

('DPDPA-13', 'DPDPA2023', 'data_principal_rights',
 'Right to access — data principal can request information about processed data',
 'Employees can view their own data via employee self-service portal. HR admin can produce data extract on request.',
 'employees', 'in_progress', 'Legal/DPO', CURRENT_DATE),

('DPDPA-35', 'DPDPA2023', 'impact_assessment',
 'Data Protection Impact Assessment for large-scale processing of sensitive data',
 'DPIA.md in repository covering payroll processing as high-risk activity. Reviewed by DPO-equivalent.',
 NULL, 'in_progress', 'Legal/DPO', CURRENT_DATE),

-- ISO 27001 Annex A controls
('ISO-A9.1', 'ISO27001', 'access_control',
 'Access control policy — access based on business and security requirements',
 'Role hierarchy: read_only_auditor < hr_viewer < hr_admin < payroll_admin/ops_admin < super_admin. requirePermission() enforced.',
 'privileged_action_audit', 'implemented', 'Platform Team', CURRENT_DATE),

('ISO-A9.4', 'ISO27001', 'authentication',
 'Authentication information management — secure credential lifecycle',
 'credential_rotation_log tracks all credential rotations. 60-day rotation policy. Emergency revocation < 15 min.',
 'credential_rotation_log', 'implemented', 'Platform Team', CURRENT_DATE),

('ISO-A10.1','ISO27001', 'cryptography',
 'Cryptographic controls — policy and key management',
 'Field-level encryption for national_id and bank_account_number via pgsodium. Tenant data encryption keys (DEK) in Supabase Vault.',
 'data_field_classifications', 'in_progress', 'Platform Team', CURRENT_DATE),

('ISO-A12.4','ISO27001', 'logging',
 'Event logging — administrator and operator activity logged and protected',
 'privileged_action_audit, pii_access_log, security_events tables. Immutable audit triggers (fn_audit_immutable) block UPDATE/DELETE.',
 'privileged_action_audit', 'implemented', 'Platform Team', CURRENT_DATE),

('ISO-A13.1','ISO27001', 'network_security',
 'Network controls — networks are managed and controlled',
 'All traffic over TLS 1.2+. Supabase Row Level Security isolates tenant data. API rate limiting on all endpoints.',
 NULL, 'implemented', 'Platform Team', CURRENT_DATE),

('ISO-A16.1','ISO27001', 'incident_management',
 'Information security incident management — reporting and response',
 'security_alerts table with status lifecycle. Escalation to operational_incidents. On-call rotation with documented runbooks.',
 'security_alerts', 'implemented', 'Platform Team', CURRENT_DATE),

('ISO-A17.1','ISO27001', 'business_continuity',
 'Information security continuity — recovery procedures meet objectives',
 'restore_drills table with verified RTO ≤ 4h / RPO ≤ 1h. 4 DR scenario runbooks. backup_checkpoints verified every 6h.',
 'restore_drills', 'implemented', 'Platform Team', CURRENT_DATE),

('ISO-A18.1','ISO27001', 'compliance',
 'Identification and compliance with applicable legislation and requirements',
 'This compliance_controls registry maps all applicable obligations. Quarterly evidence collection. Annual review cycle.',
 'compliance_evidence_snapshots', 'implemented', 'Legal/DPO', CURRENT_DATE);
