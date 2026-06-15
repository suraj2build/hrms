-- ============================================================
-- 271_leave_ledger_conflict_target_fix.sql
--
-- C6-P1 BLOCKER FIX — ledger dual-write ON CONFLICT could not infer its index.
--
-- The idempotent ledger upserts in the leave/comp-off/accrual handlers target
-- `onConflict: tenant_id,source_request_id`. But the idempotency indexes added
-- in 264 (co_grant), 268 (consumption) and 269 (reversal, encashment) are all
-- PARTIAL — `... WHERE accrual_type = '<type>' AND source_request_id IS NOT NULL`.
--
-- Postgres ON CONFLICT inference CANNOT match a partial index unless the same
-- predicate is restated, and supabase-js `onConflict` only takes column names
-- (no predicate). So every one of those upserts raised
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- which the handlers swallow (`if (ledgerErr) log.warn(...)`). The cache moved
-- but the ledger row was never written → cache and ledger drift apart on the
-- very first leave approval / cancel / encashment / comp-off grant.
--
-- Fix: replace the four per-type PARTIAL source_request_id unique indexes with a
-- single NON-PARTIAL composite unique index on (tenant_id, accrual_type,
-- source_request_id). A bare `ON CONFLICT (tenant_id, accrual_type,
-- source_request_id)` can infer it directly.
--
-- Semantics preserved:
--   • Idempotency per (tenant, accrual_type, source_request_id) — one consumption,
--     one reversal, one encashment, one co_grant per source request, exactly as
--     before. consumption + reversal still coexist for the same leave id because
--     accrual_type is part of the key.
--   • Accrual rows with NULL source_request_id (monthly/yearly/opening_balance…)
--     are unconstrained by this index (NULLs are distinct), matching the prior
--     `WHERE source_request_id IS NOT NULL` partial predicate.
--
-- The matching application change is `onConflict: 'tenant_id,accrual_type,
-- source_request_id'` at all five call sites (leave.ts ×3, comp-off.ts,
-- accrual-engine.ts). Idempotent and safe to re-run.
-- ============================================================

DROP INDEX IF EXISTS uidx_accrual_ledger_co_request;
DROP INDEX IF EXISTS uidx_accrual_ledger_consumption_request;
DROP INDEX IF EXISTS uidx_accrual_ledger_reversal_request;
DROP INDEX IF EXISTS uidx_accrual_ledger_encashment_request;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_request
  ON leave_accrual_ledger (tenant_id, accrual_type, source_request_id);
