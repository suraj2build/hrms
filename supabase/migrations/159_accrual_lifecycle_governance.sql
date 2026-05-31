-- =============================================================================
-- 159_accrual_lifecycle_governance.sql
--
-- Enterprise Accrual Semantics & Entitlement Lifecycle Governance Extension.
--
-- This is an EXTENSION PASS — all existing tables, indexes, RLS policies, and
-- the scheduler automation infrastructure are preserved.  Only new columns,
-- new tables, and constraint replacements are added.
--
-- Adds:
--   A. Lifecycle governance columns to leave_policy_rules
--   B. Lifecycle governance columns to leave_policies (legacy compat)
--   C. Extend leave_accrual_ledger.accrual_type CHECK (new types only)
--   D. Extend leave_accrual_ledger with new audit columns
--   E. leave_accrual_tiers    — service-year-based rate tiers
--   F. leave_accrual_freezes  — temporary accrual suspension records
--   G. leave_entitlement_releases — consumability tracking for earned accruals
--   H. Indexes for lifecycle query patterns
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Lifecycle governance columns → leave_policy_rules
-- ─────────────────────────────────────────────────────────────────────────────
-- Only added when the column doesn't exist (safe to re-run).

-- Advance vs Earned: when the credit is generated relative to the work cycle
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS accrual_earning_basis TEXT NOT NULL DEFAULT 'earned'
    CHECK (accrual_earning_basis IN ('advance', 'earned'));

-- Credit timing: start of cycle (advance CL) vs end of cycle (earned EL)
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS accrual_credit_timing TEXT NOT NULL DEFAULT 'cycle_start'
    CHECK (accrual_credit_timing IN ('cycle_start', 'cycle_end'));

-- When a credit becomes consumable after it is posted
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS accrual_consumption_timing TEXT NOT NULL DEFAULT 'immediate'
    CHECK (accrual_consumption_timing IN (
      'immediate',
      'after_cycle_completion',
      'after_payroll_lock',
      'after_attendance_confirmation'
    ));

-- Whether advance accruals not yet earned can be consumed
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS future_accrual_consumable BOOLEAN NOT NULL DEFAULT true;

-- How to recover advance leave if employee separates mid-cycle
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS advance_accrual_recovery_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (advance_accrual_recovery_mode IN (
      'none',
      'prorate',           -- recover pro-rated unearned portion
      'full_recovery',     -- recover full advance if any unearned
      'lop_deduction'      -- deduct via LOP on final payroll
    ));

-- How to handle partial cycles at joining / separation
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS joining_cycle_handling TEXT NOT NULL DEFAULT 'prorate'
    CHECK (joining_cycle_handling IN (
      'full',              -- credit full cycle amount regardless of join date
      'prorate',           -- prorate based on eligible days in cycle
      'next_cycle'         -- no credit in join cycle; first credit next cycle
    ));

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS separation_cycle_handling TEXT NOT NULL DEFAULT 'prorate'
    CHECK (separation_cycle_handling IN (
      'full',
      'prorate',
      'none'               -- no credit in separation cycle
    ));

-- Payroll cutoff behavior: what happens to credits near payroll lock
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS payroll_cutoff_behavior TEXT NOT NULL DEFAULT 'hold'
    CHECK (payroll_cutoff_behavior IN (
      'hold',              -- hold credit until after payroll lock
      'release',           -- release credit immediately even if payroll open
      'defer_to_next'      -- defer to next period if within cutoff window
    ));

-- Accrual freeze mode: how freeze suspension is applied
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS accrual_freeze_mode TEXT NOT NULL DEFAULT 'skip'
    CHECK (accrual_freeze_mode IN (
      'skip',              -- no credit during freeze; no replay on unfreeze
      'replay'             -- replay missed credits when freeze lifted
    ));

-- Minimum service days before first accrual (in addition to eligibility_days)
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS minimum_service_days INT NOT NULL DEFAULT 0;

-- Minimum paid days in a month required to earn accrual
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS minimum_paid_days INT NOT NULL DEFAULT 0;

-- Minimum attendance percentage (0-100) required to earn accrual
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS minimum_attendance_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00
    CHECK (minimum_attendance_pct >= 0 AND minimum_attendance_pct <= 100);

-- Whether tiered accrual rates (leave_accrual_tiers) are enabled for this rule
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS tiered_accrual_enabled BOOLEAN NOT NULL DEFAULT false;

-- Service anniversary cycle: accrue on employee's work-anniversary months
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS service_anniversary_cycle BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Lifecycle governance columns → leave_policies (legacy compat)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS accrual_earning_basis TEXT NOT NULL DEFAULT 'earned'
    CHECK (accrual_earning_basis IN ('advance', 'earned'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS accrual_credit_timing TEXT NOT NULL DEFAULT 'cycle_start'
    CHECK (accrual_credit_timing IN ('cycle_start', 'cycle_end'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS accrual_consumption_timing TEXT NOT NULL DEFAULT 'immediate'
    CHECK (accrual_consumption_timing IN (
      'immediate',
      'after_cycle_completion',
      'after_payroll_lock',
      'after_attendance_confirmation'
    ));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS future_accrual_consumable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS advance_accrual_recovery_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (advance_accrual_recovery_mode IN ('none', 'prorate', 'full_recovery', 'lop_deduction'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS joining_cycle_handling TEXT NOT NULL DEFAULT 'prorate'
    CHECK (joining_cycle_handling IN ('full', 'prorate', 'next_cycle'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS separation_cycle_handling TEXT NOT NULL DEFAULT 'prorate'
    CHECK (separation_cycle_handling IN ('full', 'prorate', 'none'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS payroll_cutoff_behavior TEXT NOT NULL DEFAULT 'hold'
    CHECK (payroll_cutoff_behavior IN ('hold', 'release', 'defer_to_next'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS accrual_freeze_mode TEXT NOT NULL DEFAULT 'skip'
    CHECK (accrual_freeze_mode IN ('skip', 'replay'));

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS minimum_service_days INT NOT NULL DEFAULT 0;

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS minimum_paid_days INT NOT NULL DEFAULT 0;

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS minimum_attendance_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00
    CHECK (minimum_attendance_pct >= 0 AND minimum_attendance_pct <= 100);

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS tiered_accrual_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS service_anniversary_cycle BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Extend leave_accrual_ledger.accrual_type CHECK
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL does not support ALTER CONSTRAINT — must drop and re-add.
-- We use a DO block so the migration is safe to re-run (constraint may already
-- be extended if migration was run previously).

DO $$
BEGIN
  -- Drop the old CHECK constraint (name from migration 050)
  BEGIN
    ALTER TABLE leave_accrual_ledger
      DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;
  EXCEPTION WHEN others THEN
    NULL; -- constraint might have been renamed; proceed
  END;

  -- Re-add with extended set of accrual_type values
  BEGIN
    ALTER TABLE leave_accrual_ledger
      ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
      CHECK (accrual_type IN (
        -- original types (preserved)
        'monthly',
        'yearly',
        'upfront',
        'carry_forward',
        'co_grant',
        'manual',
        'adjustment',
        -- quarterly (added in engine-aware batch)
        'quarterly',
        -- new lifecycle types
        'advance_accrual',        -- advance credit before cycle completes
        'earned_accrual',         -- earned credit after cycle completes
        'prorated_accrual',       -- partial-cycle credit (joining/separation)
        'recovery',               -- advance accrual recovered on separation
        'settlement_recovery',    -- advance recovered via payroll deduction
        'tier_adjustment',        -- adjustment from tier-rate change
        'release'                 -- entitlement release event (consumability)
      ));
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- already added (idempotent)
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Extend leave_accrual_ledger with lifecycle audit columns
-- ─────────────────────────────────────────────────────────────────────────────

-- Earning basis of this specific ledger entry
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS accrual_earning_basis TEXT
    CHECK (accrual_earning_basis IS NULL OR accrual_earning_basis IN ('advance', 'earned', 'prorated'));

-- When this credit becomes consumable (NULL = immediate / already consumable)
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS consumption_eligible_from DATE DEFAULT NULL;

-- What triggered the consumability release (null = immediate)
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS release_trigger TEXT
    CHECK (release_trigger IS NULL OR release_trigger IN (
      'immediate',
      'cycle_completion',
      'payroll_lock',
      'attendance_confirmation',
      'manual_release'
    ));

-- The leave cycle period this entry belongs to (YYYY-MM for monthly, YYYY for yearly)
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS cycle_period TEXT DEFAULT NULL;

-- Attendance/paid days in the cycle (used for minimum_attendance_pct check)
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS attendance_days_paid DECIMAL(5,1) DEFAULT NULL;

-- Employee's service tenure in decimal years at the time of accrual (for tier)
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS service_years_at_accrual DECIMAL(5,2) DEFAULT NULL;

-- Which tier rule was applied (FK to leave_accrual_tiers.id, nullable)
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS tier_id UUID DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. leave_accrual_tiers — service-year-based rate tiers
-- ─────────────────────────────────────────────────────────────────────────────
-- Enables tiered accrual: 0-2 years = 1.0 days/mo, 3-5 years = 1.5 days/mo, etc.
-- Tied to a leave_policy_rules row (rule_id).

CREATE TABLE IF NOT EXISTS leave_accrual_tiers (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID         NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,
  rule_id               UUID         NOT NULL REFERENCES leave_policy_rules(id) ON DELETE CASCADE,
  -- Service tenure window (years, inclusive lower bound, exclusive upper)
  service_years_from    DECIMAL(5,2) NOT NULL DEFAULT 0,    -- 0.00 = from start
  service_years_to      DECIMAL(5,2),                       -- NULL = no upper bound
  accrual_days_per_year DECIMAL(7,2) NOT NULL,              -- rate for this tier
  description           TEXT,                               -- e.g. "0-2 years: 12 days/yr"
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT chk_tier_service_range CHECK (
    service_years_from >= 0
    AND (service_years_to IS NULL OR service_years_to > service_years_from)
  ),
  CONSTRAINT chk_tier_days_positive CHECK (accrual_days_per_year > 0)
);

CREATE INDEX IF NOT EXISTS idx_accrual_tiers_rule
  ON leave_accrual_tiers (tenant_id, rule_id, service_years_from);

ALTER TABLE leave_accrual_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lat_tenant_read" ON leave_accrual_tiers FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lat_hr_write" ON leave_accrual_tiers FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- F. leave_accrual_freezes — temporary accrual suspension
-- ─────────────────────────────────────────────────────────────────────────────
-- HR can freeze accruals for an employee + leave type for a date range.
-- The lifecycle engine checks this table before crediting.

CREATE TABLE IF NOT EXISTS leave_accrual_freezes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  employee_id     UUID         NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  leave_type_id   UUID                  REFERENCES leave_types(id)   ON DELETE CASCADE,
  -- NULL leave_type_id = freeze applies to ALL leave types for this employee
  freeze_from     DATE         NOT NULL,
  freeze_to       DATE,        -- NULL = open-ended (until manually lifted)
  reason          TEXT         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'lifted', 'expired')),
  -- Replay fields: if accrual_freeze_mode = 'replay', record what was missed
  replay_completed BOOLEAN     NOT NULL DEFAULT false,
  replay_completed_at TIMESTAMPTZ DEFAULT NULL,
  created_by      UUID                  REFERENCES profiles(id)      ON DELETE SET NULL,
  lifted_by       UUID                  REFERENCES profiles(id)      ON DELETE SET NULL,
  lifted_at       TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT chk_freeze_date_range CHECK (
    freeze_to IS NULL OR freeze_to >= freeze_from
  )
);

CREATE INDEX IF NOT EXISTS idx_accrual_freezes_employee
  ON leave_accrual_freezes (tenant_id, employee_id, freeze_from, freeze_to);

-- Partial index for active-freeze lookups (most common pattern)
CREATE INDEX IF NOT EXISTS idx_accrual_freezes_active
  ON leave_accrual_freezes (tenant_id, employee_id, leave_type_id)
  WHERE status = 'active';

ALTER TABLE leave_accrual_freezes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "laf_tenant_read" ON leave_accrual_freezes FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "laf_hr_write" ON leave_accrual_freezes FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- G. leave_entitlement_releases — consumability event log
-- ─────────────────────────────────────────────────────────────────────────────
-- When accrual_consumption_timing != 'immediate', credits are held until a
-- trigger event fires.  This table records the release events.

CREATE TABLE IF NOT EXISTS leave_entitlement_releases (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id)           ON DELETE CASCADE,
  employee_id       UUID         NOT NULL REFERENCES employees(id)         ON DELETE CASCADE,
  leave_type_id     UUID         NOT NULL REFERENCES leave_types(id)       ON DELETE CASCADE,
  ledger_entry_id   UUID                  REFERENCES leave_accrual_ledger(id) ON DELETE SET NULL,
  cycle_period      TEXT         NOT NULL,          -- YYYY-MM or YYYY
  days_released     DECIMAL(5,1) NOT NULL,
  release_trigger   TEXT         NOT NULL
    CHECK (release_trigger IN (
      'immediate',
      'cycle_completion',
      'payroll_lock',
      'attendance_confirmation',
      'manual_release'
    )),
  trigger_reference TEXT,                           -- payroll period ID, etc.
  released_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  released_by       UUID                  REFERENCES profiles(id)          ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entitlement_releases_employee
  ON leave_entitlement_releases (tenant_id, employee_id, leave_type_id, cycle_period);

CREATE INDEX IF NOT EXISTS idx_entitlement_releases_trigger
  ON leave_entitlement_releases (tenant_id, release_trigger, released_at DESC);

ALTER TABLE leave_entitlement_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ler_tenant_read" ON leave_entitlement_releases FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ler_hr_write" ON leave_entitlement_releases FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Additional indexes for lifecycle query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- Find held (not-yet-consumable) ledger credits for an employee
CREATE INDEX IF NOT EXISTS idx_lal_held_credits
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id)
  WHERE consumption_eligible_from IS NOT NULL
    AND is_expired = false;

-- Recovery type entries (advance recovery, separation)
CREATE INDEX IF NOT EXISTS idx_lal_recovery_types
  ON leave_accrual_ledger (tenant_id, employee_id, accrual_type)
  WHERE accrual_type IN ('recovery', 'settlement_recovery', 'advance_accrual');

-- Service-anniversary cycle lookups
CREATE INDEX IF NOT EXISTS idx_lal_cycle_period
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id, cycle_period);

-- Tier FK index
CREATE INDEX IF NOT EXISTS idx_lal_tier_id
  ON leave_accrual_ledger (tier_id)
  WHERE tier_id IS NOT NULL;
