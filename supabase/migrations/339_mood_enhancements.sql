-- Migration 339: Mood Check-in Enhancements
-- Adds sentiment_category column; cluster/region breakdown views; min-5 privacy guard

-- ── sentiment_category on mood_checkins ───────────────────────────────────────
ALTER TABLE mood_checkins
  ADD COLUMN IF NOT EXISTS sentiment_category TEXT;

-- ── Cluster and region breakdown views ────────────────────────────────────────
-- These rely on work_locations having cluster_id + region_id fields.
-- If those columns don't exist they just produce NULLs gracefully.

CREATE OR REPLACE VIEW mood_cluster_monthly AS
SELECT
  mc.tenant_id,
  COALESCE(wl.cluster_id::TEXT, 'unknown') AS cluster_id,
  DATE_TRUNC('month', mc.submitted_at)::date AS score_month,
  ROUND(AVG(mc.mood)::numeric * 20, 1)    AS avg_score_100,
  COUNT(DISTINCT mc.employee_id)           AS respondent_count
FROM mood_checkins mc
LEFT JOIN employees  e  ON e.id = mc.employee_id
LEFT JOIN work_locations wl ON wl.id = e.work_location_id
GROUP BY mc.tenant_id, COALESCE(wl.cluster_id::TEXT, 'unknown'), DATE_TRUNC('month', mc.submitted_at)::date
HAVING COUNT(DISTINCT mc.employee_id) >= 5;

CREATE OR REPLACE VIEW mood_region_monthly AS
SELECT
  mc.tenant_id,
  COALESCE(wl.region_id::TEXT, 'unknown') AS region_id,
  TO_CHAR(mc.checkin_date, 'YYYY-MM')     AS month,
  ROUND(AVG(mc.mood)::NUMERIC, 2)         AS avg_mood,
  COUNT(DISTINCT mc.employee_id)          AS respondent_count
FROM mood_checkins mc
LEFT JOIN employees  e  ON e.id = mc.employee_id
LEFT JOIN work_locations wl ON wl.id = e.work_location_id
GROUP BY mc.tenant_id, COALESCE(wl.region_id::TEXT, 'unknown'), TO_CHAR(mc.checkin_date, 'YYYY-MM')
HAVING COUNT(DISTINCT mc.employee_id) >= 5;

-- ── Update existing mood_store_monthly view with min-5 guard ─────────────────
-- (The view was created in migration 333; recreate it with HAVING clause)
CREATE OR REPLACE VIEW mood_store_monthly AS
SELECT
  mc.tenant_id,
  e.work_location_id,
  TO_CHAR(mc.checkin_date, 'YYYY-MM') AS month,
  ROUND(AVG(mc.mood)::NUMERIC, 2)     AS avg_mood,
  COUNT(DISTINCT mc.employee_id)      AS respondent_count
FROM mood_checkins mc
JOIN employees e ON e.id = mc.employee_id
WHERE e.work_location_id IS NOT NULL
GROUP BY mc.tenant_id, e.work_location_id, TO_CHAR(mc.checkin_date, 'YYYY-MM')
HAVING COUNT(DISTINCT mc.employee_id) >= 5;
