-- ============================================================
-- 399_inbox_items_severity_add_success.sql
--
-- Fresh-audit finding (onboarding-orchestrator.ts): the onboarding
-- inbox dispatcher (document verified / checklist complete / joining
-- finalised) has always sent severity: 'success' for positive
-- lifecycle events, but inbox_items.severity's CHECK constraint only
-- allowed 'info', 'warning', 'error', 'critical' — every one of those
-- inserts has failed silently since the feature shipped, so no
-- onboarding employee has ever received an inbox notification.
--
-- 'success' is a genuinely distinct, meaningful severity tier (a
-- positive/completed event, not just informational) and is already
-- the vocabulary both the API's admin-facing POST /notifications/inbox
-- endpoint and the ESS onboarding Updates/NextSteps widgets are built
-- around — true-union widening the CHECK, not a code-side typo fix.
-- ============================================================

ALTER TABLE inbox_items
  DROP CONSTRAINT IF EXISTS inbox_items_severity_check;

ALTER TABLE inbox_items
  ADD CONSTRAINT inbox_items_severity_check
  CHECK (severity IN ('info', 'warning', 'error', 'critical', 'success'));
