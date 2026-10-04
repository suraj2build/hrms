-- ============================================================
-- 440_leave_accrual_ledger_policy_rule_id.sql
--
-- Closes audit finding G01 (COGNIXHR_PRODUCTION_READINESS_AUDIT_2026-09-27.md):
-- "Leave accrual can report success while crediting nobody."
--
-- All four leave-jobs.ts accrual insert paths (monthly, quarterly, yearly,
-- carry-forward) write a `policy_rule_id` field into their
-- leave_accrual_ledger upsert payload, but no migration ever added that
-- column to the table. Confirmed directly against the live schema
-- (information_schema.columns) and by tracing leave-jobs.ts:455-507: the
-- upsert fails with an "unknown column" error, the handler catches it,
-- logs it, and returns { employees_processed: 0, total_days_credited: 0 }
-- — the accrual job can report a clean run while crediting nobody.
--
-- Migration 163 added a `policy_rule_id` column, but to a DIFFERENT table
-- (leave_policy_snapshots, migration 163 section A), not this one —
-- confirmed by reading 163's own header comment and CREATE TABLE
-- statement. leave_accrual_ledger itself never received the column.
--
-- Nullable, matching leave_policy_snapshots' own policy_rule_id (not every
-- accrual path resolves a named policy rule — legacy/default policies
-- pass null, same as leave-jobs.ts already does for every current call
-- site). ON DELETE SET NULL, same convention as 163's sibling column: a
-- deleted policy rule must not cascade-delete historical accrual ledger
-- entries, which are a permanent audit trail.
-- ============================================================

ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS policy_rule_id UUID REFERENCES leave_policy_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_accrual_ledger_policy_rule_id
  ON leave_accrual_ledger (policy_rule_id)
  WHERE policy_rule_id IS NOT NULL;

COMMENT ON COLUMN leave_accrual_ledger.policy_rule_id IS
  'Which named leave_policy_rules row drove this accrual entry, when resolved '
  'via the policy engine (null for legacy/default-policy accruals). Added by '
  'migration 440 to close audit finding G01 — leave-jobs.ts has written this '
  'field since before this column existed, causing every accrual upsert to '
  'fail silently.';
