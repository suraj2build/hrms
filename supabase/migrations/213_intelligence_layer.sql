-- ============================================================
-- Migration 213: AI Workforce OS — Intelligence Layer
-- Read-only derived data. Never a source-of-truth.
-- Run on live Supabase SQL Editor.
-- ============================================================

-- ── intelligence_snapshots ─────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_snapshots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL,
  payload        JSONB       NOT NULL DEFAULT '{}',
  source_query   TEXT        NOT NULL DEFAULT '',
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type)
);
CREATE INDEX IF NOT EXISTS idx_intel_snapshots_tenant_type ON intelligence_snapshots (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_intel_snapshots_expires      ON intelligence_snapshots (expires_at);
ALTER TABLE intelligence_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intelligence_snapshots' AND policyname='intel_snap_tenant_read') THEN
    CREATE POLICY intel_snap_tenant_read ON intelligence_snapshots FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intelligence_snapshots' AND policyname='intel_snap_service_write') THEN
    CREATE POLICY intel_snap_service_write ON intelligence_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── intelligence_observations ──────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_observations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category       TEXT        NOT NULL,
  severity       TEXT        NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('critical','high','medium','info')),
  title          TEXT        NOT NULL,
  body           TEXT        NOT NULL,
  source_records JSONB       NOT NULL DEFAULT '[]',
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  is_dismissed   BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intel_obs_tenant_sev ON intelligence_observations (tenant_id, severity, expires_at) WHERE is_dismissed = false;
CREATE INDEX IF NOT EXISTS idx_intel_obs_tenant_cat ON intelligence_observations (tenant_id, category, generated_at DESC);
ALTER TABLE intelligence_observations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intelligence_observations' AND policyname='intel_obs_tenant_read') THEN
    CREATE POLICY intel_obs_tenant_read ON intelligence_observations FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intelligence_observations' AND policyname='intel_obs_service_write') THEN
    CREATE POLICY intel_obs_service_write ON intelligence_observations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── intelligence_digest ────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_digest (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_type    TEXT        NOT NULL DEFAULT 'monthly',
  period_start   DATE        NOT NULL,
  period_end     DATE        NOT NULL,
  narrative      TEXT        NOT NULL,
  metrics        JSONB       NOT NULL DEFAULT '{}',
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_intel_digest_tenant_period ON intelligence_digest (tenant_id, period_type, period_start DESC);
ALTER TABLE intelligence_digest ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intelligence_digest' AND policyname='intel_digest_tenant_read') THEN
    CREATE POLICY intel_digest_tenant_read ON intelligence_digest FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intelligence_digest' AND policyname='intel_digest_service_write') THEN
    CREATE POLICY intel_digest_service_write ON intelligence_digest FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
