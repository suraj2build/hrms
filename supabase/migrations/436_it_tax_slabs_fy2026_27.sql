-- ============================================================
-- FY 2026-27 income-tax reference data (it_tax_slabs / it_standard_config)
-- ============================================================
--
-- Migration 171 seeded FY2024-25 and FY2025-26 only (its own header
-- comment says so explicitly). With no FY2026-27 row, any payroll run
-- for that financial year fell through to tax-computation-engine.ts's
-- hardcoded fallback slabs/config — a deliberate, logged safety net for
-- a genuinely missing FY, NOT a substitute for keeping this table
-- current. That fallback's rebate defaults (rebate_87a_limit: 700,000,
-- rebate_87a_amount: 25,000 for the new regime) are the STALE,
-- pre-Budget-2025 values — not the current 1,200,000 / 60,000 rebate
-- already seeded correctly for FY2025-26 by migration 171 itself.
--
-- Found via live payroll UAT (see docs/UAT_LIVE_AUDIT.md UAT-039):
-- running a real Sep-2026 (FY2026-27) payroll and independently
-- reconciling one employee's tax by hand showed a real, material
-- over-deduction — an employee with taxable income between ₹7L and
-- ₹12L was charged real TDS she did not owe, because the fallback's
-- stale ₹7L rebate cliff applied instead of the correct, current ₹12L
-- one. A second employee near the boundary was overcharged by roughly
-- ₹1,07,000/year.
--
-- India's FY2026-27 Union Budget had not introduced a further slab/
-- rebate change as of this migration; mirrors FY2025-26 verbatim, same
-- as this table's own established pattern (FY2024-25 → FY2025-26 kept
-- the old-regime slabs unchanged and only touched the new-regime
-- rebate). Whoever owns FY2027-28's Budget update should add that
-- year's row here rather than let another FY silently fall through to
-- the hardcoded fallback.

INSERT INTO it_tax_slabs
  (financial_year, regime, income_from, income_to, tax_rate, slab_order, base_tax)
VALUES
  -- FY 2026-27 OLD (unchanged from FY2025-26)
  ('2026-27', 'old', 0,        250000,  0.0000, 1, 0),
  ('2026-27', 'old', 250001,   500000,  0.0500, 2, 0),
  ('2026-27', 'old', 500001,   1000000, 0.2000, 3, 12500),
  ('2026-27', 'old', 1000001,  NULL,    0.3000, 4, 112500),

  -- FY 2026-27 NEW (unchanged from FY2025-26)
  ('2026-27', 'new', 0,        300000,  0.0000, 1, 0),
  ('2026-27', 'new', 300001,   600000,  0.0500, 2, 0),
  ('2026-27', 'new', 600001,   900000,  0.1000, 3, 15000),
  ('2026-27', 'new', 900001,   1200000, 0.1500, 4, 45000),
  ('2026-27', 'new', 1200001,  1500000, 0.2000, 5, 90000),
  ('2026-27', 'new', 1500001,  NULL,    0.3000, 6, 150000)
ON CONFLICT (financial_year, regime, slab_order) DO NOTHING;

INSERT INTO it_standard_config
  (financial_year, regime, standard_deduction,
   rebate_87a_limit, rebate_87a_amount,
   surcharge_10pct_limit, surcharge_15pct_limit, surcharge_25pct_limit,
   cess_rate)
VALUES
  -- FY 2026-27 OLD: std deduction 50k, 87A limit 5L, rebate 12,500 (unchanged)
  ('2026-27', 'old', 50000, 500000, 12500, 5000000, 10000000, 20000000, 0.04),
  -- FY 2026-27 NEW: std deduction 75k, 87A limit 12L, rebate 60,000 (unchanged from FY2025-26 post-Budget-2025)
  ('2026-27', 'new', 75000, 1200000, 60000, 5000000, 10000000, 20000000, 0.04)
ON CONFLICT (financial_year, regime) DO NOTHING;
