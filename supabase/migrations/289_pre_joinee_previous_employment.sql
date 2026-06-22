-- Migration 289: Pre-Joinee previous employment
--
-- The candidate Pre-Join Portal now collects the candidate's prior work
-- experience. Stored as a JSONB array of entries on the submission; on
-- approval each entry is copied into the canonical `previous_employment`
-- table for the newly created employee.
--
-- Entry shape:
--   { company_name, designation, from_date, to_date, last_ctc, reason_for_leaving }

ALTER TABLE pre_joinee_submissions
  ADD COLUMN IF NOT EXISTS previous_employment JSONB NOT NULL DEFAULT '[]'::jsonb;
