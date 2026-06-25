-- Restore dob (date of birth) on employees.
-- Migration 016 dropped this column; the ESS home API (GET /ess/home)
-- references it for birthday display in the context panel.
-- ADD COLUMN IF NOT EXISTS is idempotent — safe on databases where dob
-- was re-added via seed scripts.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS dob DATE;
