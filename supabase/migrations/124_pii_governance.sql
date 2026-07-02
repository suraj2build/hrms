/**
 * Migration 124 — PII & Privacy Governance
 *
 * Implements privacy-by-design infrastructure required by GDPR Art. 25,
 * DPDPA 2023 §8, and ISO 27001 A.18.
 *
 * Tables:
 *   data_field_classifications   — data registry: every PII field classified by
 *                                  sensitivity tier, legal basis, and retention period.
 *   pii_access_log               — access justification log for sensitive field reads.
 *   erasure_requests             — right-to-erasure workflow with 30-day SLA tracking.
 *   retention_enforcement_runs   — audit trail for automated retention enforcement jobs.
 *
 * Sensitivity tiers:
 *   public        — freely shareable (employee name, department)
 *   internal      — internal use only (employee ID, join date)
 *   confidential  — need-to-know (date of birth, emergency contacts)
 *   restricted    — financial / identity data (salary, national ID, bank account)
 *   special_category — biometric / health data (GDPR Art. 9)
 */

-- ── Data field classification registry ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_field_classifications (
  table_name       text        NOT NULL,
  column_name      text        NOT NULL,
  sensitivity      text        NOT NULL
                               CHECK (sensitivity IN (
                                 'public', 'internal', 'confidential',
                                 'restricted', 'special_category'
                               )),
  pii_category     text                    -- 'identity', 'financial', 'health', 'biometric', 'contact'
                               CHECK (pii_category IN (
                                 'identity', 'financial', 'health',
                                 'biometric', 'contact', 'employment', NULL
                               )),
  gdpr_basis       text,                   -- lawful basis: 'contract', 'legitimate_interest', 'consent', 'legal_obligation'
  dpdpa_basis      text,                   -- DPDPA 2023 basis
  retention_days   int,                    -- NULL = retain for duration of employment + statutory period
  encrypt_at_rest  boolean      NOT NULL DEFAULT false,
  mask_in_logs     boolean      NOT NULL DEFAULT true,
  mask_in_exports  boolean      NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),

  PRIMARY KEY (table_name, column_name)
);

CREATE INDEX IF NOT EXISTS idx_dfc_sensitivity ON data_field_classifications (sensitivity)
  WHERE sensitivity IN ('restricted', 'special_category');
CREATE INDEX IF NOT EXISTS idx_dfc_encrypt     ON data_field_classifications (encrypt_at_rest)
  WHERE encrypt_at_rest = true;

CREATE OR REPLACE FUNCTION fn_touch_data_field_classifications()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_touch_data_field_classifications
  BEFORE UPDATE ON data_field_classifications
  FOR EACH ROW EXECUTE FUNCTION fn_touch_data_field_classifications();

COMMENT ON TABLE data_field_classifications IS
  'PII data classification registry. One row per table/column containing personal data. '
  'Used for: retention enforcement, encryption decisions, access log filtering, RoPA generation.';

-- ── Seed: classify all known PII fields ──────────────────────────────────────

INSERT INTO data_field_classifications
  (table_name, column_name, sensitivity, pii_category, gdpr_basis, dpdpa_basis, retention_days, encrypt_at_rest, mask_in_logs, notes)
VALUES
  -- employees table
  ('employees', 'first_name',               'internal',      'employment', 'contract',            'legitimate_interest', NULL,  false, false, NULL),
  ('employees', 'last_name',                'internal',      'employment', 'contract',            'legitimate_interest', NULL,  false, false, NULL),
  ('employees', 'personal_email',           'confidential',  'contact',    'contract',            'contract',            3650,  false, true,  'Personal email for communications'),
  ('employees', 'phone',                    'confidential',  'contact',    'contract',            'contract',            3650,  false, true,  NULL),
  ('employees', 'date_of_birth',            'confidential',  'identity',   'contract',            'contract',            3650,  false, true,  'Age determination for statutory compliance'),
  ('employees', 'gender',                   'confidential',  'identity',   'contract',            'contract',            3650,  false, true,  'Statutory reporting'),
  ('employees', 'national_id',              'restricted',    'identity',   'legal_obligation',    'legal_obligation',    3650,  true,  true,  'Aadhaar/PAN — encrypt at rest'),
  ('employees', 'pan_number',               'restricted',    'identity',   'legal_obligation',    'legal_obligation',    3650,  true,  true,  'PAN card for TDS'),
  ('employees', 'address_line1',            'confidential',  'contact',    'contract',            'contract',            3650,  false, true,  NULL),
  ('employees', 'address_line2',            'confidential',  'contact',    'contract',            'contract',            3650,  false, false, NULL),
  ('employees', 'city',                     'internal',      'contact',    'contract',            'contract',            3650,  false, false, NULL),
  ('employees', 'emergency_contact_name',   'confidential',  'contact',    'legitimate_interest', 'legitimate_interest', 3650,  false, true,  'Third-party data — handle with care'),
  ('employees', 'emergency_contact_phone',  'confidential',  'contact',    'legitimate_interest', 'legitimate_interest', 3650,  false, true,  'Third-party data'),
  ('employees', 'bank_account_number',      'restricted',    'financial',  'contract',            'contract',            3650,  true,  true,  'Salary disbursement — encrypt at rest'),
  ('employees', 'bank_ifsc',                'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('employees', 'bank_name',                'confidential',  'financial',  'contract',            'contract',            3650,  false, false, NULL),
  -- employee_compensations table
  ('employee_compensations', 'ctc_annual',  'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  'Salary data — restricted access'),
  ('employee_compensations', 'ctc_monthly', 'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('employee_compensations', 'basic',       'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('employee_compensations', 'hra',         'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  -- payroll_runs / payroll_run_employees
  ('payroll_run_employees',  'gross_pay',   'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('payroll_run_employees',  'net_pay',     'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('payroll_run_employees',  'tax_deducted','restricted',    'financial',  'legal_obligation',    'legal_obligation',    3650,  false, true,  NULL),
  -- attendance_raw_logs
  ('attendance_raw_logs', 'device_id',      'confidential',  'biometric',  'legitimate_interest', 'legitimate_interest', 1825,  false, false, 'Clock-in device — may qualify as biometric data'),
  ('attendance_raw_logs', 'timestamp',      'internal',      'employment', 'legitimate_interest', 'legitimate_interest', 1825,  false, false, NULL);

-- ── PII access justification log ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pii_access_log (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid        NOT NULL,
  accessor_id     uuid        NOT NULL,           -- auth.users(id) of the accessor
  accessor_role   text        NOT NULL,
  accessed_table  text        NOT NULL,
  accessed_fields text[]      NOT NULL DEFAULT '{}',  -- columns accessed
  access_purpose  text        NOT NULL
                              CHECK (access_purpose IN (
                                'payroll_run', 'hr_review', 'audit', 'support',
                                'employee_self', 'bulk_export', 'background_job',
                                'compliance_report', 'erasure_request'
                              )),
  justification   text,                           -- required for bulk_export and support
  employee_ids    uuid[],                         -- affected employee records (NULL = bulk)
  record_count    int,                            -- number of employee records accessed
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  source_ip       inet,
  correlation_id  uuid,
  -- Anomaly flag: set by detection engine if access pattern is unusual
  flagged         boolean     NOT NULL DEFAULT false,
  flag_reason     text
);

CREATE INDEX IF NOT EXISTS idx_pii_access_tenant_time   ON pii_access_log (tenant_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pii_access_accessor      ON pii_access_log (accessor_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pii_access_purpose       ON pii_access_log (access_purpose, accessed_at DESC)
  WHERE access_purpose IN ('bulk_export', 'support');
CREATE INDEX IF NOT EXISTS idx_pii_access_flagged       ON pii_access_log (flagged, accessed_at DESC)
  WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_pii_access_correlation   ON pii_access_log (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE pii_access_log IS
  'PII access justification log. Written when sensitive fields are read. '
  'Enables post-incident forensics and anomaly detection (bulk export detection).';

-- ── Right-to-erasure requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS erasure_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,

  -- Subject identification
  employee_id      uuid,                          -- NULL for ex-employees no longer in DB
  subject_email    text,
  subject_name     text,

  -- Request metadata
  requested_at     timestamptz NOT NULL DEFAULT now(),
  request_source   text        NOT NULL DEFAULT 'subject'
                               CHECK (request_source IN ('subject','hr_admin','regulator','legal')),
  requested_by     uuid        REFERENCES auth.users(id),

  -- Workflow state
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending', 'in_progress', 'completed',
                                 'rejected', 'partial', 'on_hold'
                               )),
  -- SLA: GDPR Art. 17 / DPDPA §12 = 30 days
  -- sla_deadline is a plain column computed by fn_erasure_requests_before_insert trigger.
  -- sla_breached is NOT stored (depends on CURRENT_DATE which changes daily);
  --   compute inline: sla_deadline < CURRENT_DATE AND status NOT IN ('completed','rejected').
  sla_deadline     date,

  -- Resolution
  rejection_reason text,                          -- legal hold, statutory retention, etc.
  completed_at     timestamptz,
  completed_by     uuid        REFERENCES auth.users(id),

  -- Evidence of completion
  fields_erased    jsonb,    -- {table: [col1, col2]} actually anonymised/deleted
  fields_retained  jsonb,    -- {table: [col1, col2], reason: 'statutory_7yr'}
  retention_basis  text,     -- why retained fields were not erased

  -- Tamper evidence
  verification_hash text,    -- SHA-256(id || completed_at || fields_erased) for integrity

  notes            text,
  metadata         jsonb     NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erasure_tenant_status  ON erasure_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_erasure_pending_sla    ON erasure_requests (sla_deadline ASC)
  WHERE status IN ('pending', 'in_progress', 'on_hold');
CREATE INDEX IF NOT EXISTS idx_erasure_employee       ON erasure_requests (employee_id)
  WHERE employee_id IS NOT NULL;

-- Compute sla_deadline on INSERT (requested_at + 30 days).
-- Cannot be GENERATED ALWAYS AS STORED because timestamptz + interval is STABLE.
CREATE OR REPLACE FUNCTION fn_erasure_requests_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.sla_deadline := NEW.requested_at::date + 30;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_erasure_requests_before_insert
  BEFORE INSERT ON erasure_requests
  FOR EACH ROW EXECUTE FUNCTION fn_erasure_requests_before_insert();

CREATE OR REPLACE FUNCTION fn_touch_erasure_requests()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_touch_erasure_requests
  BEFORE UPDATE ON erasure_requests
  FOR EACH ROW EXECUTE FUNCTION fn_touch_erasure_requests();

COMMENT ON TABLE erasure_requests IS
  'Right-to-erasure workflow. SLA = 30 days (GDPR Art. 17, DPDPA §12). '
  'sla_deadline set by trigger on INSERT. sla_breached computed inline: '
  'sla_deadline < CURRENT_DATE AND status NOT IN (''completed'',''rejected''). '
  'Dashboard alerts on breached requests.';

-- ── Retention enforcement runs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retention_enforcement_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  run_at             timestamptz NOT NULL DEFAULT now(),
  tables_scanned     text[]      NOT NULL DEFAULT '{}',
  records_evaluated  int         NOT NULL DEFAULT 0,
  records_deleted    int         NOT NULL DEFAULT 0,
  records_anonymized int         NOT NULL DEFAULT 0,
  records_retained   int         NOT NULL DEFAULT 0,  -- retention basis applied
  duration_ms        int,
  errors             jsonb       NOT NULL DEFAULT '[]',
  triggered_by       text        NOT NULL DEFAULT 'scheduler'
                                 CHECK (triggered_by IN ('scheduler','manual','test'))
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_tenant ON retention_enforcement_runs (tenant_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_runs_errors ON retention_enforcement_runs (run_at DESC)
  WHERE jsonb_array_length(errors) > 0;

COMMENT ON TABLE retention_enforcement_runs IS
  'Audit trail for automated data retention enforcement. '
  'One row per tenant per weekly scheduler run. Records how many rows were deleted/anonymised.';

-- ── Privacy health view ───────────────────────────────────────────────────────

CREATE VIEW privacy_health AS
SELECT
  t.id                                                                AS tenant_id,
  -- Open erasure requests
  (SELECT COUNT(*) FROM erasure_requests e
   WHERE e.tenant_id = t.id AND e.status IN ('pending','in_progress','on_hold'))
                                                                      AS open_erasure_requests,
  -- Breached SLA erasure requests (sla_deadline has passed and not yet resolved)
  (SELECT COUNT(*) FROM erasure_requests e
   WHERE e.tenant_id = t.id
     AND e.sla_deadline < CURRENT_DATE
     AND e.status NOT IN ('completed', 'rejected'))                   AS sla_breached_requests,
  -- Last retention enforcement run
  (SELECT run_at FROM retention_enforcement_runs r
   WHERE r.tenant_id = t.id ORDER BY run_at DESC LIMIT 1)            AS last_retention_run_at,
  -- Bulk export events in last 7 days (anomaly indicator)
  (SELECT COUNT(*) FROM pii_access_log p
   WHERE p.tenant_id = t.id
     AND p.access_purpose = 'bulk_export'
     AND p.accessed_at > now() - INTERVAL '7 days')                  AS bulk_exports_7d,
  -- Flagged PII access in last 7 days
  (SELECT COUNT(*) FROM pii_access_log p
   WHERE p.tenant_id = t.id
     AND p.flagged = true
     AND p.accessed_at > now() - INTERVAL '7 days')                  AS flagged_access_7d
FROM tenants t;

COMMENT ON VIEW privacy_health IS
  'Per-tenant privacy health rollup. Dashboard uses this for Privacy Health widget. '
  'Alert on sla_breached_requests > 0 and flagged_access_7d > 0.';
