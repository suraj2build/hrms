-- ============================================================
-- Migration 455: Correct the FY2025-26 / FY2026-27 new-regime
-- slab breakpoints seeded by migrations 171 and 436.
-- ============================================================
--
-- Confirmed defect (UAT round 10, 2026-10-13): migration 171's own header
-- comment for the FY2025-26 new-regime INSERT reads "Budget 2025 — same
-- slab structure, rebate raised" — it correctly updated the Section 87A
-- rebate parameters in it_standard_config (limit 7L→12L, amount
-- 25,000→60,000) but kept the OLD, pre-Budget-2025 slab breakpoints
-- (3L/6L/9L/12L/15L, from Budget 2023/2024) instead of the breakpoints
-- Budget 2025 actually introduced (4L/8L/12L/16L/20L/24L). Migration 436
-- then seeded FY2026-27 by mirroring FY2025-26 "verbatim" — carrying the
-- same wrong slab breakpoints into a second financial year while (again)
-- correctly carrying forward the already-fixed rebate config.
--
-- Verified against multiple independent, dated secondary sources
-- confirming the FY2025-26 (AY 2026-27) new-regime structure under
-- Section 115BAC as amended by the Finance Act 2025 (Union Budget 2025,
-- effective 1 April 2025): nil to 4L, 5% 4-8L, 10% 8-12L, 15% 12-16L,
-- 20% 16-20L, 25% 20-24L, 30% above 24L — and confirmed no further Budget
-- 2026 change to these brackets for FY2026-27 (multiple sources agree the
-- FY2025-26 structure carries forward unchanged). The standard deduction
-- (75,000) and Section 87A rebate (12L ceiling / 60,000 amount) already
-- seeded in it_standard_config match this same structure and did not
-- need correction — only it_tax_slabs' breakpoints were stale.
--
-- Scope: it_tax_slabs has no tenant_id (migration 171: "No tenant_id: tax
-- law is uniform across all tenants") — this is a single global
-- correction, not a per-tenant migration campaign. It changes what every
-- tenant's FUTURE payroll computation uses for these two financial
-- years; it cannot retroactively alter a finalized payroll run, because
-- payroll_slips.tds_deducted stores the resolved rupee amount computed at
-- generation time, not a live reference back to this table — finalizing
-- a run freezes its figures regardless of what this table says
-- afterward. (Verified no payroll_slips row exists anywhere in this
-- database at the time of this migration — this fix has zero blast
-- radius on any already-computed figure in this environment, and the
-- same structural guarantee holds in any environment.)
--
-- History preservation: the old (wrong) rows are NOT deleted. They are
-- marked superseded_at/superseded_reason and excluded from live lookups
-- by loadSlabs() (tax-computation-engine.ts), so the exact configuration
-- that was live before this fix remains queryable for audit — e.g. to
-- recompute what a specific pre-fix TDS figure would have been, or to
-- confirm when/why the correction landed.

ALTER TABLE it_tax_slabs
  ADD COLUMN IF NOT EXISTS superseded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT;

-- The original UNIQUE (financial_year, regime, slab_order) would collide
-- with the corrected rows below (new rows reuse slab_order 1..N for the
-- same FY/regime) now that superseded rows stay in the table instead of
-- being deleted. Replace it with a partial unique index that only
-- applies to the live (non-superseded) rows.
ALTER TABLE it_tax_slabs DROP CONSTRAINT IF EXISTS it_tax_slabs_financial_year_regime_slab_order_key;

CREATE UNIQUE INDEX IF NOT EXISTS it_tax_slabs_fy_regime_order_active_uq
  ON it_tax_slabs (financial_year, regime, slab_order)
  WHERE superseded_at IS NULL;

-- ── Supersede the stale FY2025-26 / FY2026-27 new-regime rows ─────────

UPDATE it_tax_slabs
SET superseded_at     = now(),
    superseded_reason = 'Migration 455: slab breakpoints were still the pre-Budget-2025 '
      || '(Budget 2023/2024) structure (3L/6L/9L/12L/15L) — corrected to the Budget 2025 '
      || 'structure (4L/8L/12L/16L/20L/24L) that applies to this financial year. The '
      || 'rebate config in it_standard_config for this FY was already correct; only this '
      || 'table was stale.'
WHERE financial_year IN ('2025-26', '2026-27')
  AND regime = 'new'
  AND superseded_at IS NULL;

-- ── Insert the corrected FY2025-26 / FY2026-27 new-regime slabs ────────
-- Slab 1: 0 – 400,000           @  0%  base = 0
-- Slab 2: 400,001 – 800,000     @  5%  base = 0
-- Slab 3: 800,001 – 1,200,000   @ 10%  base = 20,000   (5% of 400,000)
-- Slab 4: 1,200,001 – 1,600,000 @ 15%  base = 60,000   (20,000 + 10% of 400,000)
-- Slab 5: 1,600,001 – 2,000,000 @ 20%  base = 120,000  (60,000 + 15% of 400,000)
-- Slab 6: 2,000,001 – 2,400,000 @ 25%  base = 200,000  (120,000 + 20% of 400,000)
-- Slab 7: 2,400,001+             @ 30%  base = 300,000  (200,000 + 25% of 400,000)

INSERT INTO it_tax_slabs
  (financial_year, regime, income_from, income_to, tax_rate, slab_order, base_tax)
VALUES
  ('2025-26', 'new', 0,        400000,  0.0000, 1, 0),
  ('2025-26', 'new', 400001,   800000,  0.0500, 2, 0),
  ('2025-26', 'new', 800001,   1200000, 0.1000, 3, 20000),
  ('2025-26', 'new', 1200001,  1600000, 0.1500, 4, 60000),
  ('2025-26', 'new', 1600001,  2000000, 0.2000, 5, 120000),
  ('2025-26', 'new', 2000001,  2400000, 0.2500, 6, 200000),
  ('2025-26', 'new', 2400001,  NULL,    0.3000, 7, 300000),

  ('2026-27', 'new', 0,        400000,  0.0000, 1, 0),
  ('2026-27', 'new', 400001,   800000,  0.0500, 2, 0),
  ('2026-27', 'new', 800001,   1200000, 0.1000, 3, 20000),
  ('2026-27', 'new', 1200001,  1600000, 0.1500, 4, 60000),
  ('2026-27', 'new', 1600001,  2000000, 0.2000, 5, 120000),
  ('2026-27', 'new', 2000001,  2400000, 0.2500, 6, 200000),
  ('2026-27', 'new', 2400001,  NULL,    0.3000, 7, 300000)
ON CONFLICT (financial_year, regime, slab_order) WHERE superseded_at IS NULL DO NOTHING;
