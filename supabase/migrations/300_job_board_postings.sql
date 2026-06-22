-- Migration 300: Job-board postings (sourcing framework)
--
-- Tracks where a requisition has been posted across external job boards. HR can
-- record postings manually today; an automated connector (per board) can write
-- the same rows once vendor API credentials are configured. job_board_connectors
-- holds per-tenant, per-board enablement + credentials for that future automation.

CREATE TABLE IF NOT EXISTS job_board_connectors (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board       TEXT        NOT NULL,                       -- naukri | linkedin | indeed | other
  enabled     BOOLEAN     NOT NULL DEFAULT false,
  config      JSONB       NOT NULL DEFAULT '{}'::jsonb,    -- api keys / account ids (server-only)
  last_synced TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, board)
);

CREATE TABLE IF NOT EXISTS job_board_postings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requisition_id UUID        NOT NULL REFERENCES job_requisitions(id) ON DELETE CASCADE,
  board          TEXT        NOT NULL,
  external_url   TEXT,
  external_ref   TEXT,
  status         TEXT        NOT NULL DEFAULT 'posted'
                 CHECK (status IN ('posted','paused','closed','failed')),
  posted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_board_postings_req ON job_board_postings (tenant_id, requisition_id);

ALTER TABLE job_board_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_board_postings   ENABLE ROW LEVEL SECURITY;
-- Connectors hold credentials → HR only, never exposed to tenant read.
CREATE POLICY "jbc_hr_all"  ON job_board_connectors FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "jbp_hr_all"  ON job_board_postings   FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "jbp_self"    ON job_board_postings   FOR SELECT USING (tenant_id = get_user_tenant_id());
