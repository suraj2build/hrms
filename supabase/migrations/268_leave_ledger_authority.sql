-- ============================================================
-- 268_leave_ledger_authority.sql
--
-- C6 (foundation): make leave_accrual_ledger the authoritative, complete record
-- of leave movement so the cached employee_leave_balance can become a derived
-- mirror rather than a competing source of truth.
--
-- Today leave APPROVAL only mutates the cache (deduct_leave_balance) and writes
-- NO ledger debit — so the ledger and the cache drift permanently and neither
-- can reproduce the displayed balance.
--
-- This migration:
--   1. Extends accrual_type to allow signed 'consumption' debits and a one-time
--      'opening_balance' reconciliation row.
--   2. Adds an idempotency unique for consumption rows (keyed by the leave
--      request that caused them).
--   3. Defines recompute_leave_balance() — derives the cache from the ledger.
--   4. Backfills an opening_balance row per (employee, leave_type, year) equal to
--      cache − Σ(existing ledger), so Σ(ledger) == current cache. From here on,
--      every credit and the new consumption debit keep them in lockstep.
--
-- Reads are NOT yet switched to the ledger (that is the final, flag-gated cutover
-- step, LEAVE_LEDGER_AUTHORITATIVE). After this migration the two are kept equal
-- by dual-write, so the cutover is a safe one-line flip.
-- ============================================================

-- ── 1. accrual_type — comprehensive superset (heals prior migration drift) ──
ALTER TABLE leave_accrual_ledger
  DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;
ALTER TABLE leave_accrual_ledger
  ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    'monthly', 'quarterly', 'yearly', 'upfront', 'carry_forward',
    'co_grant', 'manual', 'adjustment', 'wo_credit',
    'consumption',      -- signed debit when leave is approved/consumed
    'opening_balance'   -- one-time reconciliation to current cached balance
  ));

-- ── 2. Consumption idempotency (one debit per leave request) ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_consumption_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'consumption' AND source_request_id IS NOT NULL;

-- ── 3. Derive the cached balance from the ledger ───────────────────────────
CREATE OR REPLACE FUNCTION recompute_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_year          INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(days), 0) INTO v_balance
  FROM   leave_accrual_ledger
  WHERE  tenant_id = p_tenant_id AND employee_id = p_employee_id
    AND  leave_type_id = p_leave_type_id AND year = p_year
    AND  is_expired = false;

  INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, balance, year)
  VALUES (p_tenant_id, p_employee_id, p_leave_type_id, v_balance, p_year)
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
  DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
END;
$$;

-- ── 4. One-time opening-balance reconciliation ─────────────────────────────
-- opening_balance = current cache − Σ(existing non-expired ledger), so the
-- ledger total equals the balance employees see today. Idempotent: skipped where
-- an opening_balance row already exists for the key.
INSERT INTO leave_accrual_ledger
  (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, notes)
SELECT b.tenant_id, b.employee_id, b.leave_type_id, b.year, 'opening_balance',
       b.balance - COALESCE((
         SELECT SUM(l.days) FROM leave_accrual_ledger l
         WHERE l.tenant_id = b.tenant_id AND l.employee_id = b.employee_id
           AND l.leave_type_id = b.leave_type_id AND l.year = b.year
           AND l.is_expired = false
       ), 0),
       CURRENT_DATE, false, 'Opening balance reconciliation (migration 268)'
FROM   employee_leave_balance b
WHERE  NOT EXISTS (
  SELECT 1 FROM leave_accrual_ledger o
  WHERE o.tenant_id = b.tenant_id AND o.employee_id = b.employee_id
    AND o.leave_type_id = b.leave_type_id AND o.year = b.year
    AND o.accrual_type = 'opening_balance'
);
