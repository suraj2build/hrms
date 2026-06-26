-- Migration 320: idempotent schema-cache reload.
--
-- Ensures all columns added in migrations 318 and 319 exist and forces
-- PostgREST to reload its schema cache. Safe to run multiple times.

ALTER TABLE ai_assistant_config
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT
    CHECK (fallback_provider IS NULL OR fallback_provider IN ('groq', 'openai', 'gemini')),
  ADD COLUMN IF NOT EXISTS fallback_api_key  TEXT,
  ADD COLUMN IF NOT EXISTS fallback_model    TEXT,
  ADD COLUMN IF NOT EXISTS providers_json    JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
