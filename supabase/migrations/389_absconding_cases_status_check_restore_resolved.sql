-- ============================================================
-- 389_absconding_cases_status_check_restore_resolved.sql
--
-- FIX (HIGH, ISSUE-130): migration 338 rewrote absconding_cases_
-- status_check to add 'open', 'second_escalation', and 'rejoined',
-- but dropped 'resolved' from the original 323 definition in the
-- process — the same DROP+ADD-as-replacement-not-union mistake as
-- ISSUE-127/128/129.
--
-- Confirmed live: lib/absconding-engine.ts's resolveCase() defaults
-- to status='resolved' ("employee returned / situation clarified"),
-- reachable via PATCH /absconding/cases/:caseId/status
-- (routes/absconding/index.ts, z.enum(['resolved','closed'])). Any
-- HR admin resolving a case this way has been hitting a silent
-- CHECK-constraint violation since migration 338 shipped.
-- ============================================================

ALTER TABLE absconding_cases DROP CONSTRAINT IF EXISTS absconding_cases_status_check;

ALTER TABLE absconding_cases ADD CONSTRAINT absconding_cases_status_check
  CHECK (status IN (
    'open',
    'flagged',
    'second_escalation',
    'wl1_sent',
    'wl2_sent',
    'termination_pending',
    'terminated',
    'resolved',
    'rejoined',
    'closed'
  ));
