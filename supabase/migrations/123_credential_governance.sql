/**
 * Migration 123 — Credential & Secrets Governance
 *
 * Provides audit infrastructure for credential lifecycle management:
 *
 *   credential_rotation_log  — immutable record of every credential rotation event.
 *                              Provides SOC 2 CC6.1 evidence and ISO 27001 A.9.4 compliance.
 *
 *   secret_access_audit      — lightweight log of which service/user accessed which
 *                              secret and for what purpose. Enables anomaly detection.
 *
 *   secret_rotation_health   — view that computes rotation age and status per credential
 *                              for dashboard and alerting use.
 *
 * Rotation policy: all managed credentials must be rotated every 60 days.
 * Emergency rotation (breach/suspected compromise) is recorded with rotation_type='emergency'.
 */

-- ── Credential rotation log (immutable) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS credential_rotation_log (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was rotated
  credential_name         text        NOT NULL,   -- 'supabase_service_key', 'jwt_secret', 'smtp_password' …
  rotation_type           text        NOT NULL
                                      CHECK (rotation_type IN (
                                        'scheduled',
                                        'emergency',
                                        'suspected_breach',
                                        'post_incident',
                                        'policy_renewal'
                                      )),
  -- Who rotated it
  rotated_by              uuid        REFERENCES auth.users(id),
  rotated_by_system       text,                   -- service name if automated (e.g. 'vault-rotation-bot')
  rotated_at              timestamptz NOT NULL DEFAULT now(),

  -- Key fingerprints (never store full keys — SHA-256 hex prefix only)
  previous_key_fingerprint text,                  -- first 16 chars of SHA-256(old_key)
  new_key_fingerprint      text,                  -- first 16 chars of SHA-256(new_key)

  -- Reason and verification
  rotation_reason         text,
  verification_status     text        NOT NULL DEFAULT 'pending'
                                      CHECK (verification_status IN ('pending','verified','failed')),
  verified_at             timestamptz,
  verified_by             uuid        REFERENCES auth.users(id),
  verification_notes      text,

  -- Context
  environment             text        NOT NULL DEFAULT 'production'
                                      CHECK (environment IN ('development','staging','production')),
  notes                   text,
  metadata                jsonb       NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credential_rotation_name   ON credential_rotation_log (credential_name, rotated_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_rotation_type   ON credential_rotation_log (rotation_type, rotated_at DESC)
  WHERE rotation_type IN ('emergency', 'suspected_breach', 'post_incident');
CREATE INDEX IF NOT EXISTS idx_credential_rotation_unverified ON credential_rotation_log (verification_status)
  WHERE verification_status = 'pending';

-- Immutable — credential rotation records must never be modified or deleted
CREATE OR REPLACE FUNCTION fn_credential_rotation_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'credential_rotation_log is immutable — records cannot be % (audit integrity)',
    TG_OP;
END;
$$;

CREATE TRIGGER trg_credential_rotation_immutable
  BEFORE UPDATE OR DELETE ON credential_rotation_log
  FOR EACH ROW EXECUTE FUNCTION fn_credential_rotation_immutable();

COMMENT ON TABLE credential_rotation_log IS
  'Immutable audit trail for credential rotation events. '
  'SOC 2 CC6.1 evidence. Never modify or delete rows — immutable trigger enforced.';

-- ── Secret access audit ───────────────────────────────────────────────────────
-- Lightweight log of secret access by service components.
-- Written by the application when it retrieves a credential for use.

CREATE TABLE IF NOT EXISTS secret_access_audit (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  secret_name     text        NOT NULL,
  accessor_type   text        NOT NULL CHECK (accessor_type IN ('service','user','pipeline','scheduler')),
  accessor_id     text,                           -- service name or user UUID
  access_purpose  text        NOT NULL,           -- 'payroll_run', 'email_dispatch', 'scheduler_tick' …
  justification   text,
  employee_ids    uuid[],                         -- if secret access was on behalf of specific employees
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  source_ip       inet,
  correlation_id  uuid,
  environment     text        NOT NULL DEFAULT 'production',
  -- Anomaly score: 0=normal, 1=unusual, 2=suspicious — computed by detection engine
  anomaly_score   numeric(4,2) NOT NULL DEFAULT 0 CHECK (anomaly_score >= 0),
  flagged         boolean      NOT NULL DEFAULT false,
  flag_reason     text
);

CREATE INDEX IF NOT EXISTS idx_secret_access_name_time   ON secret_access_audit (secret_name, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_secret_access_accessor    ON secret_access_audit (accessor_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_secret_access_flagged     ON secret_access_audit (flagged, accessed_at DESC)
  WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_secret_access_correlation ON secret_access_audit (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE secret_access_audit IS
  'Lightweight secret access log. Written by application when credentials are retrieved. '
  'Enables anomaly detection and post-incident forensics.';

-- ── Secret rotation health view ───────────────────────────────────────────────

CREATE VIEW secret_rotation_health AS
SELECT
  credential_name,
  MAX(rotated_at)                                                            AS last_rotated_at,
  ROUND(EXTRACT(EPOCH FROM (now() - MAX(rotated_at))) / 86400, 1)           AS days_since_rotation,
  COUNT(*) FILTER (WHERE rotated_at > now() - INTERVAL '90 days')           AS rotations_90d,
  COUNT(*) FILTER (
    WHERE rotation_type IN ('emergency','suspected_breach','post_incident')
    AND   rotated_at > now() - INTERVAL '90 days'
  )                                                                          AS emergency_rotations_90d,
  BOOL_OR(verification_status = 'failed')
    FILTER (WHERE rotated_at > now() - INTERVAL '7 days')                   AS recent_verification_failed,
  CASE
    WHEN MAX(rotated_at) < now() - INTERVAL '90 days'  THEN 'overdue'
    WHEN MAX(rotated_at) < now() - INTERVAL '60 days'  THEN 'due_soon'
    ELSE                                                     'current'
  END                                                                        AS rotation_status
FROM  credential_rotation_log
WHERE environment = 'production'
GROUP BY credential_name;

COMMENT ON VIEW secret_rotation_health IS
  'Per-credential rotation age and status. Dashboard reads rotation_status. '
  'Alert on overdue (> 90 days) or due_soon (> 60 days).';

-- ── Seed: register known managed credentials ──────────────────────────────────
-- These rows are placeholders so the health view always shows all credentials.
-- Replace fingerprints with real values after first rotation.

INSERT INTO credential_rotation_log
  (credential_name, rotation_type, rotated_by_system, rotation_reason, verification_status, environment, notes)
VALUES
  ('supabase_service_role_key', 'scheduled', 'initial_setup', 'Project initialization', 'verified', 'production', 'Baseline rotation record — replace with real fingerprints'),
  ('jwt_secret',                'scheduled', 'initial_setup', 'Project initialization', 'verified', 'production', 'Baseline rotation record'),
  ('smtp_password',             'scheduled', 'initial_setup', 'Project initialization', 'verified', 'production', 'Baseline rotation record'),
  ('storage_service_key',       'scheduled', 'initial_setup', 'Project initialization', 'verified', 'production', 'Baseline rotation record'),
  ('webhook_signing_secret',    'scheduled', 'initial_setup', 'Project initialization', 'verified', 'production', 'Baseline rotation record');
