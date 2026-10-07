-- ============================================================
-- 441_leave_accrual_ledger_cycle_key_full_unique.sql
--
-- Found while building a real-stack reproduction for audit finding G01
-- (see migration 440): migration 163 created uidx_lal_cycle_key as a
-- PARTIAL unique index (`WHERE cycle_key IS NOT NULL`), with a comment
-- stating "'ignoreDuplicates: true' in upsert operations relies on this."
-- That assumption does not hold: PostgREST's generated
-- `INSERT ... ON CONFLICT (cycle_key) DO UPDATE/NOTHING` has no WHERE
-- clause, and Postgres only matches a partial unique index to an ON
-- CONFLICT target when the conflict clause's predicate matches exactly.
-- Without it, Postgres raises "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" — reproduced directly against
-- real Postgres via scripts/g01-leave-accrual-ledger-check.sh.
--
-- This breaks EVERY cycle_key-based upsert in the accrual-ledger system,
-- not just one call site — grepped: leave-jobs.ts's monthly accrual
-- (L497) and yearly accrual (L849), and leave-ledger-service.ts's
-- writeAccrualEntry() (L504, documented there as "the preferred path").
-- Every one of these silently fails whenever cycle_key is set (i.e. on
-- every real accrual write that uses it), caught and logged as a
-- non-fatal batch-write error by its caller — the exact "reports success
-- while crediting nobody" failure mode G01 itself describes, via an
-- independent root cause.
--
-- Fix: a plain (non-partial) unique index has the SAME practical semantics
-- for this column — standard SQL/Postgres unique-index behavior already
-- treats every NULL as distinct from every other NULL, so multiple rows
-- with cycle_key IS NULL were never going to conflict under a partial
-- index OR a full one. The WHERE clause bought nothing semantically and
-- broke ON CONFLICT inference. Dropping it is not a behavior change for
-- NULL rows, and it fixes the only rows that matter (non-null cycle_key).
-- ============================================================

DROP INDEX IF EXISTS uidx_lal_cycle_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_lal_cycle_key
  ON leave_accrual_ledger (cycle_key);

COMMENT ON INDEX uidx_lal_cycle_key IS
  'Full (non-partial) unique index, migration 441. Was partial '
  '(WHERE cycle_key IS NOT NULL) from migration 163, which broke every '
  'PostgREST upsert(..., {onConflict: ''cycle_key''}) call against this '
  'table — Postgres cannot match a partial index to an ON CONFLICT target '
  'with no WHERE clause. Semantically identical for NULL rows either way '
  '(standard unique-index NULL handling already allows any number of '
  'NULLs); only non-null cycle_key rows are actually constrained, and now '
  'upserts against them work.';
