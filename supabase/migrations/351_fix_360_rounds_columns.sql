-- Migration 351: Fix feedback_360_rounds schema
-- 1. Make nominee_id nullable (the setup UI creates a round before nominees are chosen)
-- 2. Add self_review / manager_review columns (referenced by the API but missing from schema)
-- 3. Add a partial unique index so only one bulk (nominee-less) round exists per survey

ALTER TABLE feedback_360_rounds
  ALTER COLUMN nominee_id DROP NOT NULL;

ALTER TABLE feedback_360_rounds
  ADD COLUMN IF NOT EXISTS self_review    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manager_review BOOLEAN NOT NULL DEFAULT true;

-- Prevent duplicate bulk rounds (when nominee_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_360_rounds_survey_bulk
  ON feedback_360_rounds (survey_id) WHERE nominee_id IS NULL;
