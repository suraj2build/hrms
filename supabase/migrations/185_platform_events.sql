-- =============================================================================
-- 185_platform_events.sql
-- Enterprise platform event store — append-only, immutable.
-- Separate from the operational event_log (migration 066_hr_events.sql).
-- This table is the structured backbone for governance, observability and AI.
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_events (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type       TEXT        NOT NULL,
  module           TEXT        NOT NULL,
  entity_type      TEXT        NOT NULL,
  entity_id        UUID        NOT NULL,
  org_id           UUID        NOT NULL,
  branch_id        UUID        NULL,
  actor_id         UUID        NULL,
  actor_type       TEXT        NOT NULL DEFAULT 'user',
  severity         TEXT        NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  payload          JSONB       NOT NULL DEFAULT '{}',
  correlation_id   UUID        NULL,
  parent_event_id  UUID        NULL REFERENCES platform_events(id),
  governance_context JSONB     NULL,
  metadata         JSONB       NULL,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_events_pkey PRIMARY KEY (id),
  CONSTRAINT platform_events_org_fk
    FOREIGN KEY (org_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Append-only guard: prevent UPDATE and DELETE via trigger.
-- NOTE: CREATE RULE is intentionally avoided here — Supabase migrations run
-- inside a transaction block and CREATE RULE can fail in that context on
-- some hosted PostgreSQL configurations. A BEFORE trigger achieves the same
-- immutability guarantee and works reliably inside a transaction.
CREATE OR REPLACE FUNCTION platform_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_events is append-only: % operations are not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_events_no_update ON platform_events;
CREATE TRIGGER trg_platform_events_no_update
  BEFORE UPDATE ON platform_events
  FOR EACH ROW EXECUTE FUNCTION platform_events_immutable();

DROP TRIGGER IF EXISTS trg_platform_events_no_delete ON platform_events;
CREATE TRIGGER trg_platform_events_no_delete
  BEFORE DELETE ON platform_events
  FOR EACH ROW EXECUTE FUNCTION platform_events_immutable();

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_pe_org_type
  ON platform_events (org_id, event_type, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_pe_entity
  ON platform_events (org_id, entity_type, entity_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_pe_correlation
  ON platform_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pe_actor
  ON platform_events (org_id, actor_id, timestamp DESC)
  WHERE actor_id IS NOT NULL;

-- RLS
ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'platform_events' AND policyname = 'pe_hr_read'
  ) THEN
    CREATE POLICY pe_hr_read ON platform_events FOR SELECT
      USING (org_id = get_user_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'platform_events' AND policyname = 'pe_service_insert'
  ) THEN
    CREATE POLICY pe_service_insert ON platform_events FOR INSERT
      WITH CHECK (org_id = get_user_tenant_id());
  END IF;
END $$;
