-- Migration 315: allow offer-letter sign-off in the maker_checker_log (P2.4).
--
-- Job offers previously went straight to the candidate from any HR admin with no
-- internal salary/grade sign-off. To gate offer send behind a four-eyes control
-- (opt-in via OFFER_SIGNOFF_DUAL_CONTROL), the maker_checker_log must accept the
-- 'offer_letter' entity_type. Extend the CHECK; idempotent.

ALTER TABLE maker_checker_log
  DROP CONSTRAINT IF EXISTS maker_checker_log_entity_type_check;
ALTER TABLE maker_checker_log
  ADD  CONSTRAINT maker_checker_log_entity_type_check
  CHECK (entity_type IN (
    'payroll_run', 'compensation_revision', 'advance', 'loan',
    'reimbursement', 'variable_payout', 'arrear_batch',
    'tds_override', 'governance_action', 'offer_letter'));
