-- Migration 316: per-tenant AI Assistant configuration.
--
-- Backs the admin "AI Assistant" settings panel: provider + API key + model +
-- enable toggle. The raw api_key is stored server-side (service-role writes only)
-- and is NEVER returned to the browser — the config API returns a masked hint.
-- Falls back to env vars when no row exists (see lib/ai/config.ts).

CREATE TABLE IF NOT EXISTS ai_assistant_config (
  tenant_id   UUID        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider    TEXT        NOT NULL DEFAULT 'groq'
              CHECK (provider IN ('groq', 'openai', 'gemini')),
  api_key     TEXT,                              -- server-side only; never sent to client
  model       TEXT,                              -- NULL = provider default
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  updated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_assistant_config ENABLE ROW LEVEL SECURITY;

-- HR/super admins manage their tenant's row. (API uses the service-role client,
-- which bypasses RLS; this policy is defence-in-depth for any anon/auth client.)
CREATE POLICY "ai_assistant_config_hr_all" ON ai_assistant_config
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin') AND tenant_id = get_user_tenant_id());
