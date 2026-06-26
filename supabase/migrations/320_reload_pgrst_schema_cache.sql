-- Migration 320: force PostgREST to reload its schema cache.
--
-- Migrations 318 (fallback_* columns) and 319 (providers_json) added new
-- columns to ai_assistant_config. PostgREST caches the schema at startup and
-- only sees new columns after a reload. Without this, upserts to those columns
-- fail with "Could not find column in schema cache" even though the DB has them.
--
-- NOTIFY pgrst, 'reload schema' triggers an immediate cache refresh so writes
-- to providers_json and fallback_* work as soon as this migration runs.

NOTIFY pgrst, 'reload schema';
