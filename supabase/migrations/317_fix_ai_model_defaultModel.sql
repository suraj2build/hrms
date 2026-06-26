-- Clear stale literal 'defaultModel' stored by a previous code bug.
-- effectiveModel() now guards against this too, but clean the DB row
-- so the settings UI shows blank (= provider default) instead of a bogus value.
UPDATE ai_assistant_config
SET model = NULL
WHERE model = 'defaultModel';
