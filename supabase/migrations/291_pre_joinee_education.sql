-- Migration 291: Pre-Joinee education
--
-- The candidate Pre-Join Portal now collects the candidate's education history
-- (with an optional certificate upload per qualification). Stored as a JSONB
-- array on the submission; on approval each entry is copied into the canonical
-- `employee_education` table for the newly created employee.
--
-- Entry shape:
--   { qualification, institution, specialization, year_of_completion,
--     grade, document_path, document_name }

ALTER TABLE pre_joinee_submissions
  ADD COLUMN IF NOT EXISTS education JSONB NOT NULL DEFAULT '[]'::jsonb;
