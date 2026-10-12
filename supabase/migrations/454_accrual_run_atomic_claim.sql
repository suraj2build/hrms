-- ============================================================
-- 454_accrual_run_atomic_claim.sql
--
-- DEFECT-02 follow-up (PR #30 Attendance/Leave UAT, 2026-10-12): the
-- idempotency check in runMonthlyAccrual() (accrual-engine.ts) was a
-- pre-check SELECT against leave_accrual_runs followed by the whole
-- employee-crediting loop, then a terminal upsert at the end recording
-- the outcome. Under two genuinely overlapping calls for the SAME
-- tenant+run_period+leave_type (an HR admin double-clicking "Run
-- Accrual", or a manual trigger overlapping a scheduled run), BOTH
-- requests could pass the pre-check (neither had written the terminal
-- row yet) and proceed to credit employees in parallel — a lost-update
-- race on employee_leave_balance (an absolute SET of a pre-fetched
-- balance + days, not an atomic increment), not reliably prevented by
-- the leave_accrual_ledger pre-check-then-insert fix alone (that only
-- protects the ledger's own rows, not the balance cache's).
--
-- Fixes this the same way comp-off.ts's approval route already does
-- (SYSCERT_AUDIT_2026-08-02.md H6 pattern): claim the run FIRST, via a
-- real INSERT against leave_accrual_runs' existing unique constraint
-- (tenant_id, run_period, leave_type_id) — the loser of a genuine race
-- gets a real Postgres 23505 unique-violation back immediately, before
-- either side has touched a single employee's balance, and bails out
-- cleanly instead of continuing in parallel. The claim starts in a new
-- 'running' status and is updated to the real terminal status once the
-- crediting loop finishes.
-- ============================================================

ALTER TABLE leave_accrual_runs DROP CONSTRAINT lar_run_status;
ALTER TABLE leave_accrual_runs ADD CONSTRAINT lar_run_status
  CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'partial'::text, 'failed'::text]));
