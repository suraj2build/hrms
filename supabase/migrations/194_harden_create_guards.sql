-- ============================================================
-- 194_harden_create_guards.sql
--
-- Safety harness: re-declares the key infrastructure tables
-- from migrations 120–127 with IF NOT EXISTS guards.
--
-- WHY THIS EXISTS
-- ---------------
-- Migrations 120–127 create 22 tables without IF NOT EXISTS.
-- Any re-run of those files (CI reset, restore drill, partial
-- failure recovery) fails with "relation already exists".
--
-- This migration provides a forward-compatible safety net:
--   • On fully-migrated DBs:  every statement is a no-op.
--   • On partially-failed DBs: fills in missing tables.
--   • On fresh DBs: runs AFTER 120–127, so still a no-op.
--
-- SCOPE
-- -----
-- Table structure only. Triggers, views, and seed data are
-- covered by the original migrations and are idempotent
-- (CREATE OR REPLACE / ON CONFLICT DO NOTHING).
--
-- NOTE: If running in a Supabase managed project, editing
-- the original migration files (to add IF NOT EXISTS) before
-- first deployment to production is the preferred approach.
-- This migration is the forward-compatible alternative.
-- ============================================================

-- ── 120: Durable Operational State ───────────────────────────

CREATE TABLE IF NOT EXISTS poison_job_quarantine (
  job_id              uuid        PRIMARY KEY,
  job_type            text        NOT NULL,
  tenant_id           uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  requeue_count       int         NOT NULL DEFAULT 0 CHECK (requeue_count >= 0),
  is_quarantined      boolean     NOT NULL DEFAULT false,
  first_requeue_at    timestamptz NOT NULL DEFAULT now(),
  last_requeue_at     timestamptz NOT NULL DEFAULT now(),
  quarantined_at      timestamptz,
  quarantine_reason   text,
  cleared_at          timestamptz,
  cleared_by          uuid        REFERENCES auth.users(id),
  clear_reason        text,
  metadata            jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retry_storm_incidents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text        NOT NULL,
  tenant_id       uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  dead_count      int         NOT NULL,
  window_ms       int         NOT NULL,
  first_dead_at   timestamptz NOT NULL,
  last_dead_at    timestamptz NOT NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  storm_bucket    text        NOT NULL DEFAULT '',
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','acknowledged','resolved','false_positive')),
  acknowledged_by uuid        REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  resolved_by     uuid        REFERENCES auth.users(id),
  resolved_at     timestamptz,
  resolution_note text,
  incident_id     uuid,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS module_health (
  module_name     text        PRIMARY KEY,
  status          text        NOT NULL DEFAULT 'starting'
                              CHECK (status IN ('starting','healthy','degraded','failed','stopped')),
  instance_id     text,
  version         text,
  started_at      timestamptz,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  error_message   text,
  error_count     int         NOT NULL DEFAULT 0,
  metadata        jsonb       NOT NULL DEFAULT '{}'
);

-- ── 121: Chaos Test Audit Trail ──────────────────────────────

CREATE TABLE IF NOT EXISTS chaos_test_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name   text        NOT NULL,
  scenario_code   text        NOT NULL,
  category        text        NOT NULL
                              CHECK (category IN ('infrastructure','application','data_integrity','security')),
  description     text        NOT NULL,
  environment     text        NOT NULL DEFAULT 'staging'
                              CHECK (environment IN ('staging','scale-test','dr-drill')),
  suite_run_id    uuid,
  triggered_by    text        NOT NULL DEFAULT 'automated',
  conducted_by    uuid        REFERENCES auth.users(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_seconds int GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (completed_at - started_at))::int
  ) STORED,
  passed          boolean,
  pass_criteria   text        NOT NULL,
  failure_details jsonb       NOT NULL DEFAULT '[]',
  rto_seconds_actual   int,
  rto_seconds_target   int,
  rto_met         boolean GENERATED ALWAYS AS (
    CASE WHEN rto_seconds_actual IS NOT NULL AND rto_seconds_target IS NOT NULL
         THEN rto_seconds_actual <= rto_seconds_target ELSE NULL END
  ) STORED,
  log_snippet     text,
  notes           text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chaos_scenarios (
  code                  text  PRIMARY KEY,
  name                  text  NOT NULL,
  category              text  NOT NULL CHECK (category IN ('infrastructure','application','data_integrity','security')),
  fault_method          text  NOT NULL,
  pass_criteria         text  NOT NULL,
  rto_target_seconds    int   NOT NULL,
  enabled               boolean NOT NULL DEFAULT true
);

-- ── 122: Compliance Readiness Framework ──────────────────────

CREATE TABLE IF NOT EXISTS compliance_controls (
  control_id       text        PRIMARY KEY,
  framework        text        NOT NULL CHECK (framework IN ('SOC2','DPDPA2023','ISO27001','Internal')),
  category         text        NOT NULL,
  control_text     text        NOT NULL,
  implementation   text        NOT NULL,
  evidence_source  text,
  status           text        NOT NULL DEFAULT 'implemented'
                               CHECK (status IN ('not_started','in_progress','implemented','verified','waived')),
  waiver_reason    text,
  waiver_approved_by text,
  owner            text        NOT NULL,
  last_reviewed    date,
  next_review_date date GENERATED ALWAYS AS (last_reviewed + 365) STORED,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_evidence_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id      text        NOT NULL REFERENCES compliance_controls(control_id) ON DELETE CASCADE,
  snapshot_date   date        NOT NULL DEFAULT CURRENT_DATE,
  evidence_data   jsonb       NOT NULL DEFAULT '{}',
  pass            boolean     NOT NULL,
  failure_reason  text,
  collected_by    text        NOT NULL DEFAULT 'automated',
  collection_method text      NOT NULL DEFAULT 'scheduler',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (control_id, snapshot_date)
);

-- ── 123: Credential & Secrets Governance ─────────────────────

CREATE TABLE IF NOT EXISTS credential_rotation_log (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_name         text        NOT NULL,
  rotation_type           text        NOT NULL
                                      CHECK (rotation_type IN (
                                        'scheduled','emergency','suspected_breach',
                                        'post_incident','policy_renewal'
                                      )),
  rotated_by              uuid        REFERENCES auth.users(id),
  rotated_by_system       text,
  rotated_at              timestamptz NOT NULL DEFAULT now(),
  previous_key_fingerprint text,
  new_key_fingerprint      text,
  rotation_reason         text,
  verification_status     text        NOT NULL DEFAULT 'pending'
                                      CHECK (verification_status IN ('pending','verified','failed')),
  verified_at             timestamptz,
  verified_by             uuid        REFERENCES auth.users(id),
  verification_notes      text,
  environment             text        NOT NULL DEFAULT 'production'
                                      CHECK (environment IN ('development','staging','production')),
  notes                   text,
  metadata                jsonb       NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS secret_access_audit (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  secret_name     text        NOT NULL,
  accessor_type   text        NOT NULL CHECK (accessor_type IN ('service','user','pipeline','scheduler')),
  accessor_id     text,
  access_purpose  text        NOT NULL,
  justification   text,
  employee_ids    uuid[],
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  source_ip       inet,
  correlation_id  uuid,
  environment     text        NOT NULL DEFAULT 'production',
  anomaly_score   numeric(4,2) NOT NULL DEFAULT 0 CHECK (anomaly_score >= 0),
  flagged         boolean      NOT NULL DEFAULT false,
  flag_reason     text
);

-- ── 124: PII & Privacy Governance ────────────────────────────

CREATE TABLE IF NOT EXISTS data_field_classifications (
  table_name       text        NOT NULL,
  column_name      text        NOT NULL,
  sensitivity      text        NOT NULL
                               CHECK (sensitivity IN ('public','internal','confidential','restricted','special_category')),
  pii_category     text,
  gdpr_basis       text,
  dpdpa_basis      text,
  retention_days   int,
  encrypt_at_rest  boolean     NOT NULL DEFAULT false,
  mask_in_logs     boolean     NOT NULL DEFAULT true,
  mask_in_exports  boolean     NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, column_name)
);

CREATE TABLE IF NOT EXISTS pii_access_log (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid        NOT NULL,
  accessor_id     uuid        NOT NULL,
  accessor_role   text        NOT NULL,
  accessed_table  text        NOT NULL,
  accessed_fields text[]      NOT NULL DEFAULT '{}',
  access_purpose  text        NOT NULL
                              CHECK (access_purpose IN (
                                'payroll_run','hr_review','audit','support',
                                'employee_self','bulk_export','background_job',
                                'compliance_report','erasure_request'
                              )),
  justification   text,
  employee_ids    uuid[],
  record_count    int,
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  source_ip       inet,
  correlation_id  uuid,
  flagged         boolean     NOT NULL DEFAULT false,
  flag_reason     text
);

CREATE TABLE IF NOT EXISTS erasure_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_id      uuid,
  subject_email    text,
  subject_name     text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  request_source   text        NOT NULL DEFAULT 'subject'
                               CHECK (request_source IN ('subject','hr_admin','regulator','legal')),
  requested_by     uuid        REFERENCES auth.users(id),
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','in_progress','completed','rejected','partial','on_hold')),
  sla_deadline     date,
  rejection_reason text,
  completed_at     timestamptz,
  completed_by     uuid        REFERENCES auth.users(id),
  fields_erased    jsonb,
  fields_retained  jsonb,
  retention_basis  text,
  verification_hash text,
  notes            text,
  metadata         jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_enforcement_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  run_at             timestamptz NOT NULL DEFAULT now(),
  tables_scanned     text[]      NOT NULL DEFAULT '{}',
  records_evaluated  int         NOT NULL DEFAULT 0,
  records_deleted    int         NOT NULL DEFAULT 0,
  records_anonymized int         NOT NULL DEFAULT 0,
  records_retained   int         NOT NULL DEFAULT 0,
  duration_ms        int,
  errors             jsonb       NOT NULL DEFAULT '[]',
  triggered_by       text        NOT NULL DEFAULT 'scheduler'
                                 CHECK (triggered_by IN ('scheduler','manual','test'))
);

-- ── 125: Security Operations ──────────────────────────────────
-- security_events is partitioned — skip here; use original migration 125.
-- Only security_detection_rules and security_alerts are reproduced.

CREATE TABLE IF NOT EXISTS security_detection_rules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name        text        NOT NULL UNIQUE,
  description      text        NOT NULL,
  severity         text        NOT NULL,
  enabled          boolean     NOT NULL DEFAULT true,
  event_type_filter text,
  window_seconds   int         NOT NULL,
  threshold        int         NOT NULL,
  alert_channel    text        NOT NULL DEFAULT 'slack'
                               CHECK (alert_channel IN ('slack','pagerduty','email','all')),
  cooldown_seconds int         NOT NULL DEFAULT 300,
  runbook_url      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 127: Disaster Recovery Governance ────────────────────────

CREATE TABLE IF NOT EXISTS backup_checkpoints (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_type      text        NOT NULL
                                   CHECK (checkpoint_type IN ('pitr','logical_export','wal_segment')),
  tenant_id            uuid,
  backup_started_at    timestamptz NOT NULL,
  backup_completed_at  timestamptz,
  backup_size_bytes    bigint,
  storage_location     text        NOT NULL,
  wal_lsn              text,
  backup_id            text,
  verification_status  text        NOT NULL DEFAULT 'unverified'
                                   CHECK (verification_status IN ('unverified','verified','failed','expired')),
  verified_at          timestamptz,
  verified_by          uuid        REFERENCES auth.users(id),
  verified_by_system   text,
  verification_checksum text,
  verification_notes   text,
  expires_at           timestamptz,
  retained_for_days    int,
  metadata             jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restore_drills (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_code        text        NOT NULL,
  drill_type           text        NOT NULL
                                   CHECK (drill_type IN ('full_restore','partial_restore','tabletop','automated_verify')),
  environment          text        NOT NULL DEFAULT 'isolated'
                                   CHECK (environment IN ('isolated','staging','production')),
  scheduled_for        timestamptz NOT NULL,
  started_at           timestamptz,
  completed_at         timestamptz,
  restored_to_point    timestamptz,
  backup_checkpoint_id uuid        REFERENCES backup_checkpoints(id),
  rto_target_minutes   int         NOT NULL DEFAULT 240,
  rpo_target_minutes   int         NOT NULL DEFAULT 60,
  rto_actual_minutes   int,
  rpo_actual_minutes   int,
  rto_met              boolean GENERATED ALWAYS AS (
    CASE WHEN rto_actual_minutes IS NOT NULL AND rto_target_minutes IS NOT NULL
         THEN rto_actual_minutes <= rto_target_minutes ELSE NULL END
  ) STORED,
  rpo_met              boolean GENERATED ALWAYS AS (
    CASE WHEN rpo_actual_minutes IS NOT NULL AND rpo_target_minutes IS NOT NULL
         THEN rpo_actual_minutes <= rpo_target_minutes ELSE NULL END
  ) STORED,
  passed               boolean,
  failures             jsonb       NOT NULL DEFAULT '[]',
  runbook_version      text        NOT NULL DEFAULT 'v1.0',
  conducted_by         uuid        REFERENCES auth.users(id),
  witnesses            uuid[],
  evidence_url         text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  next_drill_due       date
);

CREATE TABLE IF NOT EXISTS dr_scenarios (
  code             text  PRIMARY KEY,
  name             text  NOT NULL,
  description      text  NOT NULL,
  rto_target_hours int   NOT NULL,
  rpo_target_hours int   NOT NULL,
  runbook_location text  NOT NULL,
  last_tested_at   timestamptz,
  notes            text
);
