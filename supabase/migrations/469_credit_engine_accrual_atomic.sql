-- SYSTEM_AUDIT_2026-10-14 checkpoint 14 — follow-up to the writeLedgerEntry()
-- idempotency fix (commit 116a6f4a). That fix made the leave_accrual_ledger
-- INSERT the authoritative "already credited this period" signal for
-- runEngineMonthlyAccrual/its yearly sibling, replacing a broken upsert that
-- always silently failed. Real-HTTP + real-Postgres testing
-- (scripts/db/verify-engine-accrual-concurrency-and-crash-recovery.mjs)
-- confirmed genuinely CONCURRENT requests are safe (Postgres's own unique
-- index resolves the race atomically), but surfaced a narrower, real gap:
-- writeLedgerEntry's INSERT and creditEmployeeDays's balance upsert are two
-- SEPARATE statements, not one transaction. If anything fails between them
-- (lost DB connection, process restart, OOM) after the ledger row commits but
-- before the balance updates, the credit is PERMANENTLY unrecoverable — the
-- ledger row now satisfies the idempotency check forever, so no future retry
-- ever reaches creditEmployeeDays again for that exact (employee, leave_type,
-- year, accrual_type, accrued_on) key.
--
-- This function does both writes in one transaction (one top-level RPC call
-- is one transaction by construction, the same guarantee every other atomic
-- RPC in this codebase relies on): insert the ledger row, and only if that
-- insert actually happened (not a 23505 replay), atomically increment the
-- balance cache in the SAME statement's transaction. Either both happen or
-- neither does.
--
-- Also closes a separate, narrower lost-update risk in the OLD
-- creditEmployeeDays (apps/api/src/lib/leave-entitlement-service.ts): it read
-- the current balance into application memory, computed balance+days there,
-- then wrote that computed value back — not atomic against any OTHER
-- concurrent credit to the same (tenant, employee, leave_type, year) row
-- (e.g. a manual correction landing at the same moment). The
-- `balance = balance + p_days` arithmetic below happens inside Postgres
-- against the row Postgres itself locked for the UPDATE, so two concurrent
-- credits to the same row serialize correctly instead of one silently
-- overwriting the other's increment.

CREATE OR REPLACE FUNCTION credit_engine_accrual_atomic(
  p_tenant_id    UUID,
  p_employee_id  UUID,
  p_leave_type_id UUID,
  p_accrual_type TEXT,
  p_days         NUMERIC,
  p_year         INT,
  p_accrued_on   DATE,
  p_expires_on   DATE DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_max_balance  NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ledger_id UUID;
  v_new_balance NUMERIC;
BEGIN
  -- Claim the ledger row first — a real 23505 here (caught, not propagated)
  -- means this exact credit already happened; skip the balance update too.
  BEGIN
    INSERT INTO leave_accrual_ledger (
      tenant_id, employee_id, leave_type_id, accrual_type, days, year,
      accrued_on, expires_on, is_expired, notes
    ) VALUES (
      p_tenant_id, p_employee_id, p_leave_type_id, p_accrual_type, p_days, p_year,
      p_accrued_on, p_expires_on, false, p_notes
    )
    RETURNING id INTO v_ledger_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('skipped', true, 'ledger_id', NULL, 'balance', NULL);
  END;

  INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance, updated_at)
  VALUES (p_tenant_id, p_employee_id, p_leave_type_id, p_year,
          CASE WHEN p_max_balance IS NOT NULL THEN LEAST(p_days, p_max_balance) ELSE p_days END,
          now())
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
  DO UPDATE SET
    balance = CASE
      WHEN p_max_balance IS NOT NULL THEN LEAST(employee_leave_balance.balance + p_days, p_max_balance)
      ELSE employee_leave_balance.balance + p_days
    END,
    updated_at = now()
  RETURNING balance INTO v_new_balance;

  RETURN jsonb_build_object('skipped', false, 'ledger_id', v_ledger_id, 'balance', v_new_balance);
END;
$$;

ALTER FUNCTION credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC) SET search_path = public;

REVOKE EXECUTE ON FUNCTION credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC)
  TO service_role;
