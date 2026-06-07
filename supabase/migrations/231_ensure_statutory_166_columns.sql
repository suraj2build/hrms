-- 231_ensure_statutory_166_columns.sql
-- Re-applies the statutory schema pieces from migration 166 that some live DBs are
-- missing (166 was not fully applied), which caused:
--   · "duplicate key ... epf_config_tenant_id_key" and "Could not find effective_to"
--     when saving EPF/ESI config (versioning columns / legacy UNIQUE)
--   · PT never deducting (ptax_slabs.frequency / deduction_month missing → slab
--     SELECT errored → 0 slabs)
-- Fully idempotent: every statement is IF [NOT] EXISTS / DROP IF EXISTS.

-- ── EPF config: versioned, configurable EDLI/admin ─────────────────────────────
ALTER TABLE epf_config DROP CONSTRAINT IF EXISTS epf_config_tenant_id_key;
ALTER TABLE epf_config
    ADD COLUMN IF NOT EXISTS effective_to       DATE,
    ADD COLUMN IF NOT EXISTS edli_rate_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0.50,
    ADD COLUMN IF NOT EXISTS edli_cap           DECIMAL(10,2) NOT NULL DEFAULT 75.00,
    ADD COLUMN IF NOT EXISTS edli_floor         DECIMAL(10,2) NOT NULL DEFAULT 25.00,
    ADD COLUMN IF NOT EXISTS admin_charges_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0.50;
CREATE UNIQUE INDEX IF NOT EXISTS idx_epf_config_active_per_tenant
    ON epf_config (tenant_id) WHERE effective_to IS NULL;

-- ── ESI config: versioned ──────────────────────────────────────────────────────
ALTER TABLE esi_config DROP CONSTRAINT IF EXISTS esi_config_tenant_id_key;
ALTER TABLE esi_config
    ADD COLUMN IF NOT EXISTS effective_to DATE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_esi_config_active_per_tenant
    ON esi_config (tenant_id) WHERE effective_to IS NULL;

-- ── PTax slabs: frequency + deduction month (half-yearly / annual) ─────────────
ALTER TABLE ptax_slabs
    ADD COLUMN IF NOT EXISTS frequency       TEXT NOT NULL DEFAULT 'monthly',
    ADD COLUMN IF NOT EXISTS deduction_month INT;

-- ── EPF eligibility overrides: effective dating + governance fields ────────────
ALTER TABLE epf_eligibility_overrides
    ADD COLUMN IF NOT EXISTS effective_to           DATE,
    ADD COLUMN IF NOT EXISTS is_international_worker BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS higher_pf_opted        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS higher_pf_pct          DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS uan                    TEXT,
    ADD COLUMN IF NOT EXISTS restrict_pf_to_ceiling BOOLEAN;
