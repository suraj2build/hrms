-- Migration 333: Mood Intelligence — store breakdown, sentiment, poll types

ALTER TABLE mood_checkins
  ADD COLUMN IF NOT EXISTS sentiment_label TEXT
    CHECK (sentiment_label IN ('positive','neutral','negative'));

ALTER TABLE pulse_questions
  ADD COLUMN IF NOT EXISTS poll_category TEXT NOT NULL DEFAULT 'weekly_pulse'
    CHECK (poll_category IN ('weekly_pulse','manager_quality','post_appraisal',
                             'onboarding','post_transfer','festival','custom'));

-- Materialized monthly store mood score (computed, not stored — just a view)
CREATE OR REPLACE VIEW mood_store_monthly AS
SELECT
  mc.tenant_id,
  e.work_location_id,
  date_trunc('month', mc.checkin_date::timestamptz) AS score_month,
  ROUND(AVG(mc.mood)::numeric * 20, 1) AS avg_score_100,  -- convert 1-5 to 0-100
  COUNT(*)::int AS response_count
FROM mood_checkins mc
JOIN employees e ON e.id = mc.employee_id
WHERE e.work_location_id IS NOT NULL
GROUP BY mc.tenant_id, e.work_location_id, date_trunc('month', mc.checkin_date::timestamptz);
