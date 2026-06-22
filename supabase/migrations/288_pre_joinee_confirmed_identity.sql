-- Migration 208: Pre-Joinee confirmed identity + edit flags
--
-- HR pre-fills a candidate's identity/role fields on the invitation
-- (first_name, last_name, email, phone, designation, department, joining_date).
-- These are now surfaced — pre-filled — on the candidate's Pre-Join Portal.
-- The candidate may edit them, but every change is FLAGGED for HR review.
--
-- We store the candidate's confirmed (possibly edited) values on the submission,
-- plus `edited_fields` — the list of identity fields the candidate changed away
-- from the HR-provided values — so the HR review drawer can highlight overrides.

ALTER TABLE pre_joinee_submissions
  ADD COLUMN IF NOT EXISTS confirmed_first_name   TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_last_name    TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_email        TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_phone        TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_designation  TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_department   TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_joining_date DATE,
  ADD COLUMN IF NOT EXISTS edited_fields          JSONB NOT NULL DEFAULT '[]'::jsonb;
