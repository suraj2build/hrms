-- Migration 338: Absconding Case Management Enhancements
-- Adds second_escalation status, asset recovery tracking

-- ── Add second_escalation to status enum ─────────────────────────────────────
ALTER TABLE absconding_cases
  DROP CONSTRAINT IF EXISTS absconding_cases_status_check;

ALTER TABLE absconding_cases
  ADD CONSTRAINT absconding_cases_status_check
  CHECK (status IN ('open','flagged','second_escalation','warning_letter_1','warning_letter_2',
                    'termination_notice','terminated','rejoined','closed'));

-- ── Asset recovery tracking ───────────────────────────────────────────────────
ALTER TABLE absconding_cases
  ADD COLUMN IF NOT EXISTS asset_recovery_required    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asset_recovery_notes       TEXT,
  ADD COLUMN IF NOT EXISTS asset_recovery_resolved_at TIMESTAMPTZ;
