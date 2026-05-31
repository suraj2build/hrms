-- 191_verification_records.sql
-- Stores current verification state per employee per type.
-- Append-only audit lives in platform_events; this table holds latest state.

CREATE TABLE IF NOT EXISTS verification_records (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               uuid NOT NULL,
  employee_id             uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  verification_type       text NOT NULL,
  status                  text NOT NULL DEFAULT 'pending',
  provider                text,
  source                  text NOT NULL DEFAULT 'local',
  score                   integer,
  flags                   text[] DEFAULT '{}',
  name_match_confidence   text,
  dob_match_confidence    text,
  provider_reference      text,
  retry_count             integer NOT NULL DEFAULT 0,
  last_error              text,
  degraded_reason         text,
  explanation             text,
  verified_at             timestamptz,
  expires_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, verification_type)
);

CREATE INDEX IF NOT EXISTS idx_ver_records_employee ON verification_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_ver_records_tenant   ON verification_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ver_records_status   ON verification_records (tenant_id, status);
