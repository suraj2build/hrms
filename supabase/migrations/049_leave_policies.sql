-- ============================================================
-- 049_leave_policies.sql
--
-- Leave entitlement policy configuration per leave type.
-- Stores accrual rules, eligibility thresholds, carry-forward
-- limits, and the year-boundary type (calendar vs. financial).
--
-- Consumed by leave-entitlement-service.ts for:
--   • Monthly accrual  (credit 1/12 each month)
--   • Yearly upfront   (credit full entitlement at year start)
--   • Carry-forward    (year-end — move unused balance to next year)
--   • Eligibility gate (block usage before minimum service days)
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_policies (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  leave_type_id   UUID          NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,

  -- ── Accrual ─────────────────────────────────────────────────────────
  -- monthly  : credit accrual_days_per_year / 12 on the 1st of each month
  -- yearly   : credit full entitlement at year-start (prorated for mid-year joiners
  --            when prorate_on_joining = true)
  -- upfront  : credit full entitlement at year-start regardless of joining date
  accrual_type            TEXT           NOT NULL DEFAULT 'yearly'
    CHECK (accrual_type IN ('monthly', 'yearly', 'upfront')),

  accrual_days_per_year   DECIMAL(5, 2)  NOT NULL DEFAULT 0
    CHECK (accrual_days_per_year >= 0 AND accrual_days_per_year <= 365),

  -- Maximum balance an employee can accumulate; NULL = no cap
  max_accrual_balance     DECIMAL(5, 1)
    CHECK (max_accrual_balance IS NULL OR max_accrual_balance >= 0),

  -- ── Eligibility ─────────────────────────────────────────────────────
  -- Minimum days from joining date before the employee can accrue / use
  -- this leave type.  0 = eligible immediately.
  eligibility_days        INT            NOT NULL DEFAULT 0
    CHECK (eligibility_days >= 0 AND eligibility_days <= 3650),

  -- When true: for yearly accrual, prorate entitlement based on months
  -- remaining in the year from the eligibility date.
  -- For monthly accrual, start from the first eligible month.
  prorate_on_joining      BOOLEAN        NOT NULL DEFAULT true,

  -- ── Carry-forward ───────────────────────────────────────────────────
  carry_forward_enabled   BOOLEAN        NOT NULL DEFAULT false,

  -- Maximum days that can be carried to the next year; NULL = unlimited
  carry_forward_max_days  DECIMAL(5, 1)
    CHECK (carry_forward_max_days IS NULL OR carry_forward_max_days >= 0),

  -- ── Year boundary ───────────────────────────────────────────────────
  -- calendar  : Jan 1 → Dec 31
  -- financial : Apr 1 → Mar 31 (Indian fiscal year)
  year_type               TEXT           NOT NULL DEFAULT 'calendar'
    CHECK (year_type IN ('calendar', 'financial')),

  -- ── Metadata ────────────────────────────────────────────────────────
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, leave_type_id)
);

-- Index for fast per-tenant lookup
CREATE INDEX IF NOT EXISTS idx_leave_policies_tenant
  ON leave_policies (tenant_id, leave_type_id);

-- ── Row-level security ───────────────────────────────────────────────────────
ALTER TABLE leave_policies ENABLE ROW LEVEL SECURITY;

-- Any authenticated user in the tenant can read policies
CREATE POLICY "lp_tenant_read" ON leave_policies FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Only HR admins can create / update / delete policies
CREATE POLICY "lp_hr_write" ON leave_policies FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_leave_policy_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_policies_updated_at
  BEFORE UPDATE ON leave_policies
  FOR EACH ROW EXECUTE FUNCTION update_leave_policy_timestamp();
