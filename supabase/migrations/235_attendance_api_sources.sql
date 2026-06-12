-- 235_attendance_api_sources.sql
-- External API connector registry for attendance punch data ingestion.
-- Each row represents one configured remote API source that the scheduler polls.

CREATE TABLE IF NOT EXISTS attendance_api_sources (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Human-readable identifier
  name                   TEXT         NOT NULL,
  description            TEXT,

  -- Target endpoint
  endpoint_url           TEXT         NOT NULL,
  http_method            TEXT         NOT NULL DEFAULT 'GET'
                         CHECK (http_method IN ('GET','POST')),
  -- Optional POST body template (JSONB)
  request_body           JSONB,
  -- Additional HTTP headers (e.g. Accept, custom correlation headers)
  extra_headers          JSONB        NOT NULL DEFAULT '{}',

  -- Auth
  auth_type              TEXT         NOT NULL DEFAULT 'none'
                         CHECK (auth_type IN ('none','api_key','bearer','basic','hmac','oauth2')),
  -- Stores key/value auth params: { header, key } | { username, password } | { token } | etc.
  -- Values here are stored in plaintext in the DB — rotate frequently.
  auth_config            JSONB        NOT NULL DEFAULT '{}',

  -- Response parsing
  -- Dot-path or JSONPath expression pointing to the punch array within the response,
  -- e.g. "data.records" or "$.punches[*]". Leave NULL if the response IS the array.
  response_path          TEXT,

  -- Field mapping — names of the keys within each punch record
  field_employee_code    TEXT         NOT NULL DEFAULT 'employee_code',
  field_timestamp        TEXT         NOT NULL DEFAULT 'timestamp',
  field_direction        TEXT         NOT NULL DEFAULT 'direction',

  -- Scheduler: 0 = manual-only; 1–10080 (7 days) for polling
  poll_interval_min      INTEGER      NOT NULL DEFAULT 60
                         CHECK (poll_interval_min >= 0 AND poll_interval_min <= 10080),

  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,

  -- Lifecycle tracking (updated by scheduler or manual fetch)
  last_fetched_at        TIMESTAMPTZ,
  last_fetch_status      TEXT         CHECK (last_fetch_status IN ('success','error','running','never_run')),
  last_fetch_error       TEXT,
  last_fetch_count       INTEGER,

  -- Test-connection tracking (updated by POST /test)
  last_test_at           TIMESTAMPTZ,
  last_test_status       TEXT         CHECK (last_test_status IN ('success','error')),
  last_test_sample       JSONB,        -- first 3 records from last test

  -- Audit
  created_by             UUID,
  updated_by             UUID,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_api_sources_tenant
  ON attendance_api_sources (tenant_id, is_active);

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION trg_att_api_sources_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_att_api_sources_updated_at ON attendance_api_sources;
CREATE TRIGGER trg_att_api_sources_updated_at
  BEFORE UPDATE ON attendance_api_sources
  FOR EACH ROW EXECUTE FUNCTION trg_att_api_sources_updated_at();

-- RLS
ALTER TABLE attendance_api_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'attendance_api_sources' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY "tenant_isolation" ON attendance_api_sources
      USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
  END IF;
END $$;
