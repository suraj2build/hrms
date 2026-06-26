-- Migration 319: unified ordered provider chain for the AI Assistant.
--
-- Replaces the separate primary + fallback columns with a single ordered list:
-- providers_json is an array of { provider, api_key, model, enabled } in
-- priority order. The assistant tries each enabled entry top-to-bottom and uses
-- the first that answers; the rest act as automatic fallbacks.
--
-- The legacy provider/api_key/model/fallback_* columns are kept for backward
-- compatibility (read as a fallback when providers_json is empty) but the admin
-- UI now writes only providers_json.
--
-- Also adds fallback_* columns (from migration 318) with IF NOT EXISTS so this
-- migration is safe to run whether or not 318 was applied first.

ALTER TABLE ai_assistant_config
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT
    CHECK (fallback_provider IS NULL OR fallback_provider IN ('groq', 'openai', 'gemini')),
  ADD COLUMN IF NOT EXISTS fallback_api_key  TEXT,
  ADD COLUMN IF NOT EXISTS fallback_model    TEXT,
  ADD COLUMN IF NOT EXISTS providers_json    JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: seed the chain from existing primary + fallback rows so nobody loses
-- their saved keys on upgrade. Uses a DO block so the fallback_* columns are
-- referenced via dynamic SQL only after we know they exist.
DO $$
BEGIN
  -- Backfill with fallback columns (always present now that we added them above).
  UPDATE ai_assistant_config
  SET providers_json = (
    SELECT jsonb_agg(entry) FROM (
      SELECT jsonb_build_object(
        'provider', provider, 'api_key', api_key, 'model', model, 'enabled', enabled
      ) AS entry
      WHERE api_key IS NOT NULL
      UNION ALL
      SELECT jsonb_build_object(
        'provider', fallback_provider, 'api_key', fallback_api_key, 'model', fallback_model, 'enabled', true
      )
      WHERE fallback_provider IS NOT NULL AND fallback_api_key IS NOT NULL
    ) rows
  )
  WHERE (providers_json IS NULL OR providers_json = '[]'::jsonb)
    AND api_key IS NOT NULL;
END $$;

-- Force PostgREST to reload its schema cache so the new columns are immediately
-- writable via the REST API without needing a server restart.
NOTIFY pgrst, 'reload schema';
