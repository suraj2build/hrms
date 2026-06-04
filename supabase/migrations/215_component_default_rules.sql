-- ============================================================
-- 215_component_default_rules.sql
--
-- Adds a SUGGESTED calculation rule to each salary component so that adding a
-- component to a salary structure (group) pre-fills its rule instead of being
-- configured from scratch every time. Reduces repetitive setup and the chance
-- of per-group mismatch.
--
--   salary_components.default_calculation_type
--       NULL              — no suggestion (admin must set the rule per group)
--       'fixed'           — flat ₹/month
--       'pct_of_basic'    — % of Basic
--       'pct_of_ctc'      — % of CTC
--       'pct_of_gross'    — % of Gross
--
--   salary_components.default_value
--       Default amount (₹/month for 'fixed') or percentage (for pct_* types).
--
-- These are DEFAULTS only — the authoritative per-structure rule still lives on
-- salary_structure_components. Purely additive; existing rows are unaffected.
-- ============================================================

ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS default_calculation_type TEXT
    CHECK (default_calculation_type IS NULL OR default_calculation_type IN
      ('fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross'));

ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS default_value NUMERIC(12, 4)
    CHECK (default_value IS NULL OR default_value >= 0);

COMMENT ON COLUMN salary_components.default_calculation_type IS
  'Suggested calculation rule used to pre-fill the structure builder when this '
  'component is added to a salary group. NULL = no suggestion.';

COMMENT ON COLUMN salary_components.default_value IS
  'Default amount (fixed ₹/month) or percentage (pct_* types) paired with '
  'default_calculation_type. NULL = unset.';
