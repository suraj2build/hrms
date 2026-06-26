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

ALTER TABLE ai_assistant_config
  ADD COLUMN IF NOT EXISTS providers_json JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: seed the chain from existing primary + fallback rows so nobody loses
-- their saved keys on upgrade.
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
