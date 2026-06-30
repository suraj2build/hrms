-- Migration 341: Policy Knowledge Base Enhancements
-- Adds is_mandatory flag; attendance/payroll/notice_period/faq categories

-- ── is_mandatory on hr_policies ───────────────────────────────────────────────
ALTER TABLE hr_policies
  ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN NOT NULL DEFAULT false;

-- ── Expand category CHECK constraint ─────────────────────────────────────────
ALTER TABLE hr_policies
  DROP CONSTRAINT IF EXISTS hr_policies_category_check;

ALTER TABLE hr_policies
  ADD CONSTRAINT hr_policies_category_check
  CHECK (category IN ('leave','compensation','conduct','recruitment','learning',
                      'health','it','other','attendance','notice_period','payroll','faq'));
