-- Migration 321: AI usage metering + managed-vs-self provisioning mode.
--
-- Adds the contract between HRMS (consumer) and the owner portal (provisioner)
-- for the AI assistant, mirroring how tenant licensing already works
-- (owner writes tenants.status; HRMS reads it).
--
--   1. tenants.ai_mode         — 'self' (tenant brings own keys) | 'managed'
--                                (provider supplies keys via owner portal).
--                                Owner portal WRITES; HRMS READS.
--   2. ai_managed_config       — the global master provider chain used by all
--                                'managed' tenants. Owner portal WRITES; HRMS READS.
--   3. ai_usage_log            — one row per assistant chat completion, with token
--                                counts. HRMS WRITES; owner portal READS to bill.
--                                Token-only (no prices) — pricing applied by the
--                                owner portal so rate changes never touch HRMS.

-- ── 1. Per-tenant provisioning mode ──────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_mode TEXT NOT NULL DEFAULT 'self'
    CHECK (ai_mode IN ('self', 'managed'));

-- ── 2. Global managed (master) provider chain ────────────────────────────────────
-- Singleton row (id = 1). providers_json mirrors ai_assistant_config.providers_json:
-- an ordered array of { provider, api_key, model, enabled }.
CREATE TABLE IF NOT EXISTS ai_managed_config (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  providers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: service-role only (owner portal + HRMS API both use the service key).
ALTER TABLE ai_managed_config ENABLE ROW LEVEL SECURITY;

-- ── 3. Per-call usage meter ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INT  NOT NULL DEFAULT 0,
  completion_tokens INT  NOT NULL DEFAULT 0,
  total_tokens      INT  NOT NULL DEFAULT 0,
  -- where the key came from: 'managed' (owner master key), 'tenant' (BYOK), 'env'.
  source            TEXT NOT NULL DEFAULT 'tenant',
  user_id           UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast per-tenant / per-month aggregation for the billing dashboard.
CREATE INDEX IF NOT EXISTS ai_usage_log_tenant_month_idx
  ON ai_usage_log (tenant_id, created_at);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

-- HR admins may read their own tenant's usage (in-app cost visibility).
-- (API uses the service-role client which bypasses RLS; this is defence-in-depth.)
CREATE POLICY "ai_usage_log_hr_read" ON ai_usage_log
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'hr_admin') AND tenant_id = get_user_tenant_id()
  );

-- Make the new columns/tables visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
