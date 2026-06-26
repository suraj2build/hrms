-- Migration 318: add fallback provider to AI assistant config.
--
-- When the primary provider fails (rate limit, downtime, bad key) the assistant
-- automatically retries with the fallback provider so users always get an answer.
-- Each tenant can configure a second provider + key independently of the primary.

ALTER TABLE ai_assistant_config
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT
    CHECK (fallback_provider IS NULL OR fallback_provider IN ('groq', 'openai', 'gemini')),
  ADD COLUMN IF NOT EXISTS fallback_api_key  TEXT,   -- server-side only; never sent to client
  ADD COLUMN IF NOT EXISTS fallback_model    TEXT;   -- NULL = provider default
