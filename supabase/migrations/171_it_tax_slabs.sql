-- ============================================================
-- Migration 171: IT Tax Slabs & Standard Config
-- DB-driven tax slab masters replacing hardcoded slabs in
-- the TDS engine. Covers FY 2024-25 and FY 2025-26 for
-- both old and new tax regimes.
-- No tenant_id: tax law is uniform across all tenants.
-- ============================================================

-- ── it_tax_slabs ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS it_tax_slabs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year  TEXT NOT NULL,
  regime          TEXT NOT NULL CHECK (regime IN ('old', 'new')),
  income_from     DECIMAL(14,2) NOT NULL DEFAULT 0,
  income_to       DECIMAL(14,2),          -- NULL = no upper bound (highest slab)
  tax_rate        DECIMAL(5,4) NOT NULL,  -- 0.0500 = 5%, 0.3000 = 30%
  slab_order      INT NOT NULL,
  base_tax        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- cumulative tax on income below this slab
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (financial_year, regime, slab_order)
);

-- ── Indexes: it_tax_slabs ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_it_tax_slabs_fy_regime
  ON it_tax_slabs (financial_year, regime);

CREATE INDEX IF NOT EXISTS idx_it_tax_slabs_fy_regime_order
  ON it_tax_slabs (financial_year, regime, slab_order);

-- ── it_standard_config ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS it_standard_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year        TEXT NOT NULL,
  regime                TEXT NOT NULL CHECK (regime IN ('old', 'new', 'both')),
  standard_deduction    DECIMAL(14,2) NOT NULL DEFAULT 50000,
  rebate_87a_limit      DECIMAL(14,2),   -- gross income ceiling for 87A rebate eligibility
  rebate_87a_amount     DECIMAL(14,2),   -- maximum rebate under section 87A
  surcharge_10pct_limit DECIMAL(14,2) DEFAULT 5000000,   -- income > this: 10% surcharge
  surcharge_15pct_limit DECIMAL(14,2) DEFAULT 10000000,  -- income > this: 15% surcharge
  surcharge_25pct_limit DECIMAL(14,2) DEFAULT 20000000,  -- income > this: 25% surcharge
  cess_rate             DECIMAL(5,4) NOT NULL DEFAULT 0.04,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (financial_year, regime)
);

-- ── Indexes: it_standard_config ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_it_standard_config_fy
  ON it_standard_config (financial_year);

CREATE INDEX IF NOT EXISTS idx_it_standard_config_fy_regime
  ON it_standard_config (financial_year, regime);

-- ── Row Level Security: it_tax_slabs ───────────────────────

ALTER TABLE it_tax_slabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "it_tax_slabs_select" ON it_tax_slabs;
DROP POLICY IF EXISTS "it_tax_slabs_insert" ON it_tax_slabs;
DROP POLICY IF EXISTS "it_tax_slabs_update" ON it_tax_slabs;
DROP POLICY IF EXISTS "it_tax_slabs_delete" ON it_tax_slabs;

-- All authenticated users (any tenant) can read tax slabs
CREATE POLICY "it_tax_slabs_select"
  ON it_tax_slabs FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only hr_admin / super_admin can insert new slab records
CREATE POLICY "it_tax_slabs_insert"
  ON it_tax_slabs FOR INSERT
  WITH CHECK (get_user_role() IN ('hr_admin', 'super_admin'));

-- Only hr_admin / super_admin can update slab records
CREATE POLICY "it_tax_slabs_update"
  ON it_tax_slabs FOR UPDATE
  USING (get_user_role() IN ('hr_admin', 'super_admin'))
  WITH CHECK (get_user_role() IN ('hr_admin', 'super_admin'));

-- Only super_admin can delete slab records
CREATE POLICY "it_tax_slabs_delete"
  ON it_tax_slabs FOR DELETE
  USING (get_user_role() = 'super_admin');

-- ── Row Level Security: it_standard_config ─────────────────

ALTER TABLE it_standard_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "it_standard_config_select" ON it_standard_config;
DROP POLICY IF EXISTS "it_standard_config_insert" ON it_standard_config;
DROP POLICY IF EXISTS "it_standard_config_update" ON it_standard_config;
DROP POLICY IF EXISTS "it_standard_config_delete" ON it_standard_config;

-- All authenticated users can read standard config
CREATE POLICY "it_standard_config_select"
  ON it_standard_config FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only hr_admin / super_admin can insert config records
CREATE POLICY "it_standard_config_insert"
  ON it_standard_config FOR INSERT
  WITH CHECK (get_user_role() IN ('hr_admin', 'super_admin'));

-- Only hr_admin / super_admin can update config records
CREATE POLICY "it_standard_config_update"
  ON it_standard_config FOR UPDATE
  USING (get_user_role() IN ('hr_admin', 'super_admin'))
  WITH CHECK (get_user_role() IN ('hr_admin', 'super_admin'));

-- Only super_admin can delete config records
CREATE POLICY "it_standard_config_delete"
  ON it_standard_config FOR DELETE
  USING (get_user_role() = 'super_admin');

-- ============================================================
-- SEED DATA — FY 2024-25 and FY 2025-26
-- ============================================================

-- ── OLD REGIME SLABS (identical for 2024-25 and 2025-26) ───
-- Slab 1:  0 – 250,000         @  0%  base tax = 0
-- Slab 2:  250,001 – 500,000   @  5%  base tax = 0       (5% of 250k)
-- Slab 3:  500,001 – 1,000,000 @ 20%  base tax = 12,500  (12,500 from slab 2)
-- Slab 4:  1,000,001+           @ 30%  base tax = 112,500 (12,500 + 100,000)

INSERT INTO it_tax_slabs
  (financial_year, regime, income_from, income_to, tax_rate, slab_order, base_tax)
VALUES
  -- FY 2024-25 OLD
  ('2024-25', 'old', 0,        250000,  0.0000, 1, 0),
  ('2024-25', 'old', 250001,   500000,  0.0500, 2, 0),
  ('2024-25', 'old', 500001,   1000000, 0.2000, 3, 12500),
  ('2024-25', 'old', 1000001,  NULL,    0.3000, 4, 112500),

  -- FY 2025-26 OLD
  ('2025-26', 'old', 0,        250000,  0.0000, 1, 0),
  ('2025-26', 'old', 250001,   500000,  0.0500, 2, 0),
  ('2025-26', 'old', 500001,   1000000, 0.2000, 3, 12500),
  ('2025-26', 'old', 1000001,  NULL,    0.3000, 4, 112500)
ON CONFLICT (financial_year, regime, slab_order) DO NOTHING;

-- ── NEW REGIME SLABS ───────────────────────────────────────
-- FY 2024-25 (Budget 2023 slabs, applicable from AY 2024-25):
-- 0 – 300,000          @  0%  base = 0
-- 300,001 – 600,000    @  5%  base = 0
-- 600,001 – 900,000    @ 10%  base = 15,000
-- 900,001 – 1,200,000  @ 15%  base = 45,000
-- 1,200,001 – 1,500,000@ 20%  base = 90,000
-- 1,500,001+            @ 30%  base = 150,000
--
-- FY 2025-26 (Budget 2025 — same slab structure, rebate raised):

INSERT INTO it_tax_slabs
  (financial_year, regime, income_from, income_to, tax_rate, slab_order, base_tax)
VALUES
  -- FY 2024-25 NEW
  ('2024-25', 'new', 0,        300000,  0.0000, 1, 0),
  ('2024-25', 'new', 300001,   600000,  0.0500, 2, 0),
  ('2024-25', 'new', 600001,   900000,  0.1000, 3, 15000),
  ('2024-25', 'new', 900001,   1200000, 0.1500, 4, 45000),
  ('2024-25', 'new', 1200001,  1500000, 0.2000, 5, 90000),
  ('2024-25', 'new', 1500001,  NULL,    0.3000, 6, 150000),

  -- FY 2025-26 NEW (slab structure unchanged, rebate raised by Budget 2025)
  ('2025-26', 'new', 0,        300000,  0.0000, 1, 0),
  ('2025-26', 'new', 300001,   600000,  0.0500, 2, 0),
  ('2025-26', 'new', 600001,   900000,  0.1000, 3, 15000),
  ('2025-26', 'new', 900001,   1200000, 0.1500, 4, 45000),
  ('2025-26', 'new', 1200001,  1500000, 0.2000, 5, 90000),
  ('2025-26', 'new', 1500001,  NULL,    0.3000, 6, 150000)
ON CONFLICT (financial_year, regime, slab_order) DO NOTHING;

-- ── STANDARD CONFIG SEEDS ───────────────────────────────────

INSERT INTO it_standard_config
  (financial_year, regime, standard_deduction,
   rebate_87a_limit, rebate_87a_amount,
   surcharge_10pct_limit, surcharge_15pct_limit, surcharge_25pct_limit,
   cess_rate)
VALUES
  -- FY 2024-25 OLD: std deduction 50k, 87A limit 5L, rebate 12,500
  (
    '2024-25', 'old',
    50000,
    500000,  12500,
    5000000, 10000000, 20000000,
    0.04
  ),

  -- FY 2024-25 NEW: std deduction raised to 75k (Budget 2024),
  --                 87A limit 7L, rebate 25,000
  (
    '2024-25', 'new',
    75000,
    700000,  25000,
    5000000, 10000000, 20000000,
    0.04
  ),

  -- FY 2025-26 OLD: unchanged from prior year
  (
    '2025-26', 'old',
    50000,
    500000,  12500,
    5000000, 10000000, 20000000,
    0.04
  ),

  -- FY 2025-26 NEW: Budget 2025 — 87A rebate limit raised to 12L,
  --                 rebate amount raised to 60,000 (effective tax-free up to 12L)
  (
    '2025-26', 'new',
    75000,
    1200000, 60000,
    5000000, 10000000, 20000000,
    0.04
  )
ON CONFLICT (financial_year, regime) DO NOTHING;
