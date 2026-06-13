-- ============================================================
-- 244_fnf_settlement.sql
--
-- P1.2 — Full & Final settlement engine support.
--
--   1. gratuity_config — per-tenant gratuity formula/eligibility (configurable).
--   2. separation_ff_summary — additive columns:
--        a. tracking columns the existing F&F handlers already write but which
--           were never created (updated_at / updated_by / paid_by) — this also
--           repairs manual F&F save.
--        b. computed-settlement metadata (gratuity years, leave-encash days/rate,
--           notice shortfall, salary basis, settlement reference, compute audit).
--
-- net_payable stays a GENERATED column — never written by the app.
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Gratuity configuration (per tenant) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS gratuity_config (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  rate_numerator    INTEGER     NOT NULL DEFAULT 15,        -- statutory 15 days
  rate_denominator  INTEGER     NOT NULL DEFAULT 26,        -- per 26 working days
  min_years         NUMERIC(4,1) NOT NULL DEFAULT 5,        -- eligibility threshold
  max_amount        NUMERIC(14,2) NOT NULL DEFAULT 2000000, -- statutory ceiling ₹20L
  basis             TEXT        NOT NULL DEFAULT 'basic'
                                CHECK (basis IN ('basic', 'gross')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID
);

ALTER TABLE gratuity_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gratuity_config_tenant_isolation ON gratuity_config;
CREATE POLICY gratuity_config_tenant_isolation
  ON gratuity_config FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 2. F&F summary — additive columns ─────────────────────────────────────────
ALTER TABLE separation_ff_summary
  -- tracking columns the existing handlers expect (repairs manual save)
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by             UUID,
  ADD COLUMN IF NOT EXISTS paid_by                UUID,
  -- computed-settlement metadata
  ADD COLUMN IF NOT EXISTS gratuity_eligible      BOOLEAN,
  ADD COLUMN IF NOT EXISTS gratuity_years         NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS leave_encashment_days  NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS leave_encashment_rate  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS notice_shortfall_days  INTEGER,
  ADD COLUMN IF NOT EXISTS salary_basis_basic     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS salary_basis_gross     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS settlement_reference   TEXT,
  ADD COLUMN IF NOT EXISTS computed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS computed_by            UUID;
