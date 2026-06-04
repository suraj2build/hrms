-- ============================================================
-- 218_statutory_filing_closure.sql
--
-- Statutory filing closure state machine.
--
-- Until now "ready_for_filing" was computed on every call to
-- GET /payroll/statutory-reconciliation from child-table presence + variance,
-- with NO persisted record of whether a statute was actually filed. There was
-- no way to:
--   * lock a month's statutory figures once filed (idempotent closure),
--   * record the challan / acknowledgement reference,
--   * freeze the reconciled snapshot that filing was based on,
--   * distinguish "ready but not filed" vs "filed" vs "confirmed".
--
-- This migration adds one table to persist that closure state per
-- tenant · month · statute (pf / esi / pt / tds). A closure can only be
-- created when the run is finalized and the statute reconciles within ₹1
-- (enforced in the API). State machine:
--
--   (no row) ──file──▶ filed ──confirm──▶ confirmed
--        ▲                │                    │
--        └──── reopen ◀───┴──────── reopen ◀───┘   (reopen deletes the row)
--
-- Additive only. Existing rows unaffected.
-- ============================================================

CREATE TABLE IF NOT EXISTS statutory_filing_closures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month           TEXT NOT NULL,                              -- 'YYYY-MM'
  statutory_type  TEXT NOT NULL
                    CHECK (statutory_type IN ('pf', 'esi', 'pt', 'tds')),
  status          TEXT NOT NULL DEFAULT 'filed'
                    CHECK (status IN ('filed', 'confirmed')),
  run_id          UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,

  -- Frozen figures at the moment of filing (the reconciled snapshot).
  computed_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,          -- from payslips
  payable_amount  NUMERIC(14, 2) NOT NULL DEFAULT 0,          -- from filing tables
  variance        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  snapshot        JSONB,                                      -- full recon row snapshot

  -- Filing references
  challan_number  TEXT,
  reference_note  TEXT,

  -- Audit trail
  filed_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  filed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, month, statutory_type)
);

CREATE INDEX IF NOT EXISTS idx_stat_closure_tenant_month
  ON statutory_filing_closures (tenant_id, month);

COMMENT ON TABLE statutory_filing_closures IS
  'Persisted closure state for statutory filing (PF/ESI/PT/TDS) per tenant·month. '
  'A row exists only once a statute has been filed; it freezes the reconciled '
  'amounts and challan reference. Reopening deletes the row.';
COMMENT ON COLUMN statutory_filing_closures.snapshot IS
  'Frozen reconciliation snapshot (computed/payable/variance + run id) captured '
  'at the instant of filing, for audit and dispute resolution.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE statutory_filing_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stat_closure_read" ON statutory_filing_closures FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "stat_closure_hr"   ON statutory_filing_closures FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
