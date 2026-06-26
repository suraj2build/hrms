-- Migration 322: owner-domain AI price table (for the billing dashboard).
--
-- Prices that turn ai_usage_log token counts into money. Owner-domain data:
-- written/read ONLY by the owner API (platform-admin auth). The HRMS chat path
-- never reads this — HRMS only logs tokens; the owner portal applies pricing.
--
-- A DB table (not localStorage/hardcoded) because these rates drive real
-- invoices: they must be shared across all owner admins, editable without a
-- deploy, and auditable.

CREATE TABLE IF NOT EXISTS ai_price_table (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,        -- 'groq' | 'openai' | 'gemini'
  model           TEXT NOT NULL,        -- exact model id; '*' = provider default/fallback
  -- USD per 1,000,000 tokens, split prompt vs completion.
  prompt_per_mtok      NUMERIC(12,4) NOT NULL DEFAULT 0,
  completion_per_mtok  NUMERIC(12,4) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  updated_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model)
);

ALTER TABLE ai_price_table ENABLE ROW LEVEL SECURITY;  -- service-role only (owner API)

-- Seed sensible defaults (placeholder rates — owner edits these in the UI).
-- Values are USD per 1M tokens; adjust to your negotiated/list rates.
INSERT INTO ai_price_table (provider, model, prompt_per_mtok, completion_per_mtok) VALUES
  ('groq',   'llama-3.3-70b-versatile', 0.59, 0.79),
  ('gemini', 'gemini-3.5-flash',        0.30, 2.50),
  ('openai', 'gpt-4o-mini',             0.15, 0.60),
  ('groq',   '*',                       0.59, 0.79),
  ('gemini', '*',                       0.30, 2.50),
  ('openai', '*',                       0.15, 0.60)
ON CONFLICT (provider, model) DO NOTHING;

NOTIFY pgrst, 'reload schema';
