/**
 * Migration 127 — Disaster Recovery & Business Continuity Governance
 *
 * Provides durable infrastructure for DR readiness tracking so that
 * backup verification, drill scheduling, and RTO/RPO evidence are
 * all queryable from the DB — not scattered across manual documents.
 *
 * Tables:
 *   backup_checkpoints     — verified backup inventory (PITR + logical exports).
 *                            Written by the 'backup_verification' scheduler job every 6h.
 *   restore_drills         — drill execution log with actual vs target RTO/RPO.
 *                            Written by operators after each quarterly drill.
 *   dr_scenarios           — reference table of 4 documented DR scenarios with runbooks.
 *
 * Views:
 *   dr_readiness           — single-row summary of platform DR readiness status.
 *                            Dashboard reads this for the DR status widget.
 *
 * SOC 2: A1.2 (recovery procedures meet RTO/RPO objectives)
 * ISO 27001: A.17.1 (information security continuity)
 *
 * RTO target: 4 hours  (time from incident declaration to service restored)
 * RPO target: 1 hour   (maximum acceptable data loss window)
 * Drill cadence: every 90 days (quarterly)
 */

-- ── Backup checkpoints ────────────────────────────────────────────────────────

CREATE TABLE backup_checkpoints (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_type      text        NOT NULL
                                   CHECK (checkpoint_type IN (
                                     'pitr',           -- Supabase PITR continuous backup
                                     'logical_export', -- pg_dump / logical snapshot
                                     'wal_segment'     -- specific WAL position
                                   )),
  tenant_id            uuid,                           -- NULL = platform-wide backup

  -- Backup timing
  backup_started_at    timestamptz NOT NULL,
  backup_completed_at  timestamptz,
  backup_size_bytes    bigint,

  -- Location and identity
  storage_location     text        NOT NULL,            -- 'supabase-pitr:project_id' or S3 URI
  wal_lsn              text,                            -- WAL LSN for PITR point targeting
  backup_id            text,                            -- external backup system ID

  -- Verification
  verification_status  text        NOT NULL DEFAULT 'unverified'
                                   CHECK (verification_status IN (
                                     'unverified', 'verified', 'failed', 'expired'
                                   )),
  verified_at          timestamptz,
  verified_by          uuid        REFERENCES auth.users(id),
  verified_by_system   text,                            -- 'backup_verification_job' for automated
  verification_checksum text,                           -- SHA-256 of backup manifest/content
  verification_notes   text,

  -- Retention
  expires_at           timestamptz,
  retained_for_days    int,

  metadata             jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_backup_checkpoints_verified   ON backup_checkpoints (verification_status, backup_completed_at DESC)
  WHERE verification_status = 'verified';
CREATE INDEX idx_backup_checkpoints_type       ON backup_checkpoints (checkpoint_type, backup_completed_at DESC);
CREATE INDEX idx_backup_checkpoints_tenant     ON backup_checkpoints (tenant_id, backup_completed_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_backup_checkpoints_unverified ON backup_checkpoints (created_at DESC)
  WHERE verification_status = 'unverified';

COMMENT ON TABLE backup_checkpoints IS
  'Verified backup inventory. Written by backup_verification scheduler job every 6h. '
  'Alert when no verified backup within 2h (RPO breach risk). '
  'SOC 2 A1.2 evidence source.';

-- ── Restore drills ────────────────────────────────────────────────────────────

CREATE TABLE restore_drills (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_code        text        NOT NULL,            -- 'A', 'B', 'C', 'D' — matches dr_scenarios
  drill_type           text        NOT NULL
                                   CHECK (drill_type IN (
                                     'full_restore',     -- actual PITR restore to isolated env
                                     'partial_restore',  -- restore specific tables only
                                     'tabletop',         -- walkthrough without actual restore
                                     'automated_verify'  -- automated connectivity + data check
                                   )),
  environment          text        NOT NULL DEFAULT 'isolated'
                                   CHECK (environment IN ('isolated','staging','production')),

  -- Scheduling
  scheduled_for        timestamptz NOT NULL,
  started_at           timestamptz,
  completed_at         timestamptz,

  -- PITR point used
  restored_to_point    timestamptz,                     -- which backup point was restored from
  backup_checkpoint_id uuid        REFERENCES backup_checkpoints(id),

  -- Actual vs target RTO/RPO
  rto_target_minutes   int         NOT NULL DEFAULT 240,  -- 4 hours
  rpo_target_minutes   int         NOT NULL DEFAULT 60,   -- 1 hour
  rto_actual_minutes   int,                               -- filled in after drill completes
  rpo_actual_minutes   int,
  rto_met              boolean GENERATED ALWAYS AS (
    CASE WHEN rto_actual_minutes IS NOT NULL AND rto_target_minutes IS NOT NULL
         THEN rto_actual_minutes <= rto_target_minutes ELSE NULL END
  ) STORED,
  rpo_met              boolean GENERATED ALWAYS AS (
    CASE WHEN rpo_actual_minutes IS NOT NULL AND rpo_target_minutes IS NOT NULL
         THEN rpo_actual_minutes <= rpo_target_minutes ELSE NULL END
  ) STORED,

  -- Result
  passed               boolean,
  failures             jsonb       NOT NULL DEFAULT '[]',  -- [{step, expected, actual}]

  -- Metadata
  runbook_version      text        NOT NULL DEFAULT 'v1.0',
  conducted_by         uuid        REFERENCES auth.users(id),
  witnesses            uuid[],                             -- other participants
  evidence_url         text,                               -- link to drill report document
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- next_drill_due: set by trigger on INSERT/UPDATE when completed_at is not null.
  -- Cannot be GENERATED ALWAYS AS STORED because timestamptz + interval is STABLE.
  next_drill_due       date
);

CREATE INDEX idx_restore_drills_passed      ON restore_drills (passed, completed_at DESC);
CREATE INDEX idx_restore_drills_scenario    ON restore_drills (scenario_code, completed_at DESC);
CREATE INDEX idx_restore_drills_due         ON restore_drills (next_drill_due ASC)
  WHERE next_drill_due IS NOT NULL AND passed = true;

-- fn_touch_restore_drills also computes next_drill_due (completed_at + 90 days).
-- Cannot be GENERATED ALWAYS AS STORED because timestamptz + interval is STABLE;
-- trigger functions are not subject to the IMMUTABLE restriction.
CREATE OR REPLACE FUNCTION fn_touch_restore_drills()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.completed_at IS NOT NULL THEN
    NEW.next_drill_due := NEW.completed_at::date + 90;
  ELSE
    NEW.next_drill_due := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Fire on both INSERT and UPDATE so that seed rows and later updates both get next_drill_due.
CREATE TRIGGER trg_touch_restore_drills
  BEFORE INSERT OR UPDATE ON restore_drills
  FOR EACH ROW EXECUTE FUNCTION fn_touch_restore_drills();

COMMENT ON TABLE restore_drills IS
  'DR drill execution log. One row per drill. Quarterly cadence required (90 days). '
  'rto_met and rpo_met are computed columns. SOC 2 A1.2 / ISO 27001 A.17.1 evidence.';

-- ── DR scenario reference table ───────────────────────────────────────────────

CREATE TABLE dr_scenarios (
  code             text        PRIMARY KEY,   -- 'A', 'B', 'C', 'D'
  name             text        NOT NULL,
  description      text        NOT NULL,
  rto_target_hours int         NOT NULL,
  rpo_target_hours int         NOT NULL,
  runbook_location text        NOT NULL,      -- path in repository
  last_tested_at   timestamptz,
  notes            text
);

INSERT INTO dr_scenarios (code, name, description, rto_target_hours, rpo_target_hours, runbook_location) VALUES
  ('A',
   'Application Crash (all instances down)',
   'All application instances crash or are terminated simultaneously. '
   'Recovery: restart container instances. No data loss expected (DB unaffected).',
   1, 0,
   'docs/runbooks/dr-scenario-a-application-crash.md'),

  ('B',
   'Database Corruption (partial table corruption)',
   'One or more tables corrupted due to a bad migration, hardware fault, or software bug. '
   'Recovery: PITR restore to pre-corruption point, re-run queue jobs from corruption window.',
   4, 1,
   'docs/runbooks/dr-scenario-b-db-corruption.md'),

  ('C',
   'Accidental Mass Delete',
   'Operator runs DELETE without correct WHERE clause, removing critical records. '
   'Recovery: PITR restore using timestamp from privileged_action_audit, replay recent jobs.',
   4, 1,
   'docs/runbooks/dr-scenario-c-mass-delete.md'),

  ('D',
   'Supabase Platform Incident (region unavailable)',
   'The Supabase project region becomes unavailable for an extended period. '
   'Recovery: activate failover Supabase project in alternate region, restore from logical export.',
   8, 1,
   'docs/runbooks/dr-scenario-d-platform-incident.md');

-- ── DR readiness view ─────────────────────────────────────────────────────────

CREATE VIEW dr_readiness AS
WITH
  latest_drill AS (
    SELECT completed_at, rto_actual_minutes, rpo_actual_minutes, rto_met, rpo_met, next_drill_due
    FROM   restore_drills
    WHERE  passed = true
    ORDER  BY completed_at DESC
    LIMIT  1
  ),
  latest_backup AS (
    SELECT backup_completed_at, verification_status
    FROM   backup_checkpoints
    WHERE  verification_status = 'verified'
    ORDER  BY backup_completed_at DESC
    LIMIT  1
  )
SELECT
  -- Backup health
  b.backup_completed_at                                              AS last_verified_backup_at,
  ROUND(EXTRACT(EPOCH FROM (now() - b.backup_completed_at)) / 3600, 2)
                                                                     AS hours_since_verified_backup,

  -- Drill health
  d.completed_at                                                     AS last_successful_drill_at,
  ROUND(EXTRACT(EPOCH FROM (now() - d.completed_at)) / 86400, 0)   AS days_since_last_drill,
  d.rto_actual_minutes,
  d.rpo_actual_minutes,
  d.next_drill_due,

  -- Overall status
  CASE
    WHEN d.completed_at IS NULL
         THEN 'no_drill_on_record'
    WHEN d.next_drill_due < CURRENT_DATE
         THEN 'drill_overdue'
    WHEN b.backup_completed_at IS NULL OR
         b.backup_completed_at < now() - INTERVAL '2 hours'
         THEN 'backup_stale'
    WHEN d.rto_met = false OR d.rpo_met = false
         THEN 'sla_missed_last_drill'
    ELSE      'ready'
  END                                                                AS dr_status,

  -- Next drill reminder
  CASE
    WHEN d.next_drill_due IS NULL         THEN 'schedule_first_drill'
    WHEN d.next_drill_due < CURRENT_DATE  THEN 'overdue'
    WHEN d.next_drill_due < CURRENT_DATE + 14 THEN 'due_within_2_weeks'
    ELSE 'on_track'
  END                                                                AS drill_schedule_status

FROM  (SELECT 1) _dummy
LEFT  JOIN latest_backup b ON true
LEFT  JOIN latest_drill  d ON true;

COMMENT ON VIEW dr_readiness IS
  'Single-row DR readiness summary. Dashboard DR widget reads this view. '
  'Alert when dr_status != ''ready''. Target: verified backup < 2h, drill < 90 days, '
  'last drill RTO ≤ 4h and RPO ≤ 1h.';

-- ── Seed: create placeholder drill record ─────────────────────────────────────
-- Ensures dr_readiness view always returns a row.
-- Replace with real drill data after first actual drill is conducted.

INSERT INTO restore_drills
  (scenario_code, drill_type, scheduled_for, started_at, completed_at,
   rto_target_minutes, rpo_target_minutes, rto_actual_minutes, rpo_actual_minutes,
   passed, runbook_version, notes)
VALUES
  ('A', 'tabletop',
   now() - INTERVAL '1 day',
   now() - INTERVAL '1 day',
   now() - INTERVAL '23 hours',
   240, 60, 12, 0,
   true, 'v1.0',
   'Initial tabletop drill — application restart scenario only. '
   'Full PITR restore drill required within 90 days.');
