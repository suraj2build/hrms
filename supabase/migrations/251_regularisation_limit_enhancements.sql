-- ============================================================
-- 251_regularisation_limit_enhancements.sql
--
-- Extends the regularisation frequency limit (regularisation_policy.max_per_month)
-- with three HR-configurable controls requested as an enhancement:
--
--   1. limit_period        — the window the cap applies over (week/month/quarter/year),
--                            instead of being hard-wired to a calendar month.
--   2. exclude_rejected    — when true (default), rejected requests no longer burn an
--                            employee's quota; only pending + approved count.
--                            (Cancelled requests are always excluded.)
--   3. per_type_limits     — optional per-request-type sub-caps, e.g.
--                            {"wfh": 2, "missed_punch": 3}. Empty = no per-type caps.
--
-- max_per_month stays the numeric cap value (kept for backward compatibility; it is
-- now interpreted as "max per <limit_period>"). All additive + idempotent.
-- ============================================================

ALTER TABLE regularisation_policy
  ADD COLUMN IF NOT EXISTS limit_period     TEXT    NOT NULL DEFAULT 'month'
    CHECK (limit_period IN ('week', 'month', 'quarter', 'year')),
  ADD COLUMN IF NOT EXISTS exclude_rejected BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS per_type_limits  JSONB   NOT NULL DEFAULT '{}'::jsonb;
