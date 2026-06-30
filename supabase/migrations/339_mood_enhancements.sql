-- Migration 339: Mood Check-in Enhancements
-- Adds sentiment_category column; cluster/region breakdown views; min-5 privacy guard

-- ── sentiment_category on mood_checkins ───────────────────────────────────────
ALTER TABLE mood_checkins
  ADD COLUMN IF NOT EXISTS sentiment_category TEXT;

-- ── Add cluster_id + region_id to work_locations ─────────────────────────────
-- work_locations (migration 010) only has city/state; these nullable columns
-- let admins assign stores to named clusters and regions for mood analytics.
ALTER TABLE work_locations
  ADD COLUMN IF NOT EXISTS cluster_id TEXT,
  ADD COLUMN IF NOT EXISTS region_id  TEXT;

-- ── Cluster and region breakdown views ────────────────────────────────────────

CREATE OR REPLACE VIEW mood_cluster_monthly AS
SELECT
  mc.tenant_id,
  COALESCE(wl.cluster_id::TEXT, 'unknown') AS cluster_id,
  TO_CHAR(mc.checkin_date, 'YYYY-MM')      AS month,
  ROUND(AVG(mc.mood)::NUMERIC, 2)          AS avg_mood,
  COUNT(DISTINCT mc.employee_id)           AS respondent_count
FROM mood_checkins mc
LEFT JOIN employees  e  ON e.id = mc.employee_id
LEFT JOIN work_locations wl ON wl.id = e.work_location_id
GROUP BY mc.tenant_id, COALESCE(wl.cluster_id::TEXT, 'unknown'), TO_CHAR(mc.checkin_date, 'YYYY-MM')
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
-- (The view was created in migration 333; recreate with HAVING clause, preserving
--  original column names: score_month, avg_score_100, response_count)
CREATE OR REPLACE VIEW mood_store_monthly AS
SELECT
  mc.tenant_id,
  e.work_location_id,
  date_trunc('month', mc.checkin_date::timestamptz) AS score_month,
  ROUND(AVG(mc.mood)::numeric * 20, 1)              AS avg_score_100,
  COUNT(DISTINCT mc.employee_id)::int               AS response_count
FROM mood_checkins mc
JOIN employees e ON e.id = mc.employee_id
WHERE e.work_location_id IS NOT NULL
GROUP BY mc.tenant_id, e.work_location_id, date_trunc('month', mc.checkin_date::timestamptz)
HAVING COUNT(DISTINCT mc.employee_id) >= 5;
