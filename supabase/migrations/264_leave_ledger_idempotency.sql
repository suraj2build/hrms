-- ============================================================
-- 264_leave_ledger_idempotency.sql
--
-- LI-1: Leave ledger idempotency + the missing credit RPC.
-- Closes Enterprise Integrity findings C7 (comp-off/WO double-credit)
-- and L4 (credit_leave_balance RPC was called but never defined, so
-- the cached balance was silently never updated).
--
-- Note: full unification of the three balance stores (C6/L1) — making
-- the ledger the single source of truth with signed debit rows and a
-- derived cache — is a separate, backfill-bearing initiative and is NOT
-- attempted here. This migration hardens the ledger against duplicate
-- CREDITS and makes the cache-credit path actually work.
-- ============================================================

-- ── 1. Source linkage for traceability + idempotency ───────────────────────
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS source_request_id UUID;

-- ── 2. Extend the idempotency index to cover co_grant + wo_credit ──────────
-- Previously only monthly/quarterly/yearly/upfront/carry_forward were covered,
-- so comp-off (co_grant) and WO carry-over (wo_credit) had NO unique backstop —
-- ON CONFLICT had nothing to bind to and silently inserted duplicates.
DROP INDEX IF EXISTS uidx_accrual_ledger_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_idempotency
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
  WHERE accrual_type IN ('monthly','quarterly','yearly','upfront','carry_forward','co_grant','wo_credit');

-- A comp-off credit is uniquely identified by its originating request — the
-- strongest idempotency key (independent of accrued_on date drift).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_co_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'co_grant' AND source_request_id IS NOT NULL;

-- ── 3. Define the missing credit_leave_balance RPC ─────────────────────────
-- Idempotent-per-call upsert into the cached balance store. Callers invoke this
-- only after a NEW ledger row is written (the ledger is the integrity record;
-- the cache is a convenience mirror). Mirrors deduct_leave_balance (036).
CREATE OR REPLACE FUNCTION credit_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, balance, year)
  VALUES (p_tenant_id, p_employee_id, p_leave_type_id, p_days, p_year)
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
  DO UPDATE SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
                updated_at = now();
END;
$$;
