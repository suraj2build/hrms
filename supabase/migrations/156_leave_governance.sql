-- ============================================================
-- 156_leave_governance.sql
--
-- Enterprise Leave Governance: extends the existing leave policy
-- engine (migrations 054, 055, 072) with:
--
--   A. accrual_timing on leave_policy_rules
--      'beginning_of_cycle' | 'end_of_cycle'
--
--   B. Event-triggered leave grants on leave_policy_rules
--      Links a rule to an important_date_type so the automation
--      engine can grant days on birthday / anniversary / custom event.
--
--   C. encashment_basis on leave_accrual_rules
--      Which salary basis to use when computing encashment payout.
--
--   D. 'site' added to leave_policy_assignments.scope_type
--      Allows site-level default leave policy assignment, consistent
--      with the Rotation Policy and Roster Policy governance model.
--
--   E. sites.default_leave_policy_id  FK
--   F. employees.leave_policy_override_id  FK
--
--   G. leave_event_grants  — idempotent log of every event-triggered
--      grant; prevents re-granting the same event in the same year.
--
-- Resolution priority (updated — highest → lowest):
--   1. employee        (employees.leave_policy_override_id)
--   2. department      (leave_policy_assignments scope_type='department')
--   3. work_location   (leave_policy_assignments scope_type='work_location')
--   4. site            (leave_policy_assignments scope_type='site'
--                       OR sites.default_leave_policy_id)
--   5. default         (leave_policy_assignments scope_type='default')
--   6. legacy          (leave_policies table)
-- ============================================================

-- ── A. accrual_timing on leave_policy_rules ───────────────────────────────────
-- Determines WHEN in the accrual cycle the days are credited:
--   beginning_of_cycle : credit on the 1st of the period (month/quarter/year start)
--   end_of_cycle       : credit on the last day of the period (month/quarter/year end)

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS accrual_timing TEXT NOT NULL DEFAULT 'beginning_of_cycle';

-- Add constraint separately (IF NOT EXISTS workaround — drop first)
ALTER TABLE leave_policy_rules
  DROP CONSTRAINT IF EXISTS lpr_accrual_timing_check;

ALTER TABLE leave_policy_rules
  ADD CONSTRAINT lpr_accrual_timing_check
    CHECK (accrual_timing IN ('beginning_of_cycle', 'end_of_cycle'));

-- ── B. Event-triggered leave grants on leave_policy_rules ─────────────────────
-- When event_trigger_date_type_id is set, the automation engine will
-- automatically grant event_grant_days to the employee each year.
--
-- event_trigger_date_type_id  — FK to important_date_types.id
--   NULL = regular accrual rule (no event trigger)
--   SET  = rule is event-driven; accrual fields are ignored by event engine
--
-- event_grant_days      — days to grant per year for this event (default 1.0)
-- event_validity_days   — how many days after the event date the granted leave
--   is valid. NULL = no expiry. 0 = same day only.
--   Example: birthday leave valid 30 days after birthday.

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS event_trigger_date_type_id UUID
    REFERENCES important_date_types(id) ON DELETE SET NULL;

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS event_grant_days DECIMAL(3,1) DEFAULT 1.0;

ALTER TABLE leave_policy_rules
  DROP CONSTRAINT IF EXISTS lpr_event_grant_days_check;

ALTER TABLE leave_policy_rules
  ADD CONSTRAINT lpr_event_grant_days_check
    CHECK (event_grant_days IS NULL OR event_grant_days > 0);

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS event_validity_days INT DEFAULT 30;

ALTER TABLE leave_policy_rules
  DROP CONSTRAINT IF EXISTS lpr_event_validity_days_check;

ALTER TABLE leave_policy_rules
  ADD CONSTRAINT lpr_event_validity_days_check
    CHECK (event_validity_days IS NULL OR event_validity_days >= 0);

CREATE INDEX IF NOT EXISTS idx_lpr_event_trigger
  ON leave_policy_rules (tenant_id, event_trigger_date_type_id)
  WHERE event_trigger_date_type_id IS NOT NULL;

-- ── C. encashment_basis on leave_accrual_rules ────────────────────────────────
-- Which salary component base to use when computing the encashment payout:
--   basic           : employee's basic salary component
--   gross           : total gross salary
--   fixed_ctc       : fixed CTC (excluding variable pay)
--   custom_component: a specific named salary component (stored separately)

ALTER TABLE leave_accrual_rules
  ADD COLUMN IF NOT EXISTS encashment_basis TEXT DEFAULT 'basic';

ALTER TABLE leave_accrual_rules
  DROP CONSTRAINT IF EXISTS lar_encashment_basis_check;

ALTER TABLE leave_accrual_rules
  ADD CONSTRAINT lar_encashment_basis_check
    CHECK (encashment_basis IS NULL OR encashment_basis IN ('basic', 'gross', 'fixed_ctc', 'custom_component'));

-- ── D. Add 'site' to leave_policy_assignments.scope_type ──────────────────────
-- Drop the existing unnamed CHECK constraint (PostgreSQL auto-names it
-- {table}_{column}_check) and replace with an extended set.

ALTER TABLE leave_policy_assignments
  DROP CONSTRAINT IF EXISTS leave_policy_assignments_scope_type_check;

ALTER TABLE leave_policy_assignments
  ADD CONSTRAINT leave_policy_assignments_scope_type_check
    CHECK (scope_type IN ('employee', 'department', 'work_location', 'site', 'default'));

-- Re-assert the scope_id NOT-NULL rule (also needs to allow site/default = NULL)
ALTER TABLE leave_policy_assignments
  DROP CONSTRAINT IF EXISTS chk_scope_id_null;

ALTER TABLE leave_policy_assignments
  ADD CONSTRAINT chk_scope_id_null
    CHECK (
      (scope_type = 'default' AND scope_id IS NULL)
      OR
      (scope_type <> 'default' AND scope_id IS NOT NULL)
    );

-- ── E. sites.default_leave_policy_id ─────────────────────────────────────────
-- Site-level leave policy default.  Resolved if no employee / department /
-- work_location assignment matches.  Mirrors the Roster/Rotation governance model.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS default_leave_policy_id UUID
    REFERENCES leave_policy_masters(id) ON DELETE SET NULL;

COMMENT ON COLUMN sites.default_leave_policy_id IS
  'Leave Governance (migration 156): Default leave policy for employees at this site. '
  'Resolved after department and work_location scope; before the tenant-wide default.';

-- ── F. employees.leave_policy_override_id ────────────────────────────────────
-- Employee-level override — highest priority in the resolution chain.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS leave_policy_override_id UUID
    REFERENCES leave_policy_masters(id) ON DELETE SET NULL;

COMMENT ON COLUMN employees.leave_policy_override_id IS
  'Leave Governance (migration 156): Employee-level leave policy override. '
  'Highest priority in the resolution chain; overrides site/department defaults.';

-- ── G. leave_event_grants ─────────────────────────────────────────────────────
-- Immutable log of every event-triggered leave grant.
-- The unique constraint on (employee_id, date_type_id, event_year) provides
-- idempotency: the automation engine can run daily without double-granting.

CREATE TABLE IF NOT EXISTS leave_event_grants (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)                ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id)              ON DELETE CASCADE,
  leave_type_id   UUID        NOT NULL REFERENCES leave_types(id)            ON DELETE CASCADE,
  date_type_id    UUID        NOT NULL REFERENCES important_date_types(id)   ON DELETE RESTRICT,

  -- The policy rule that drove this grant
  policy_rule_id  UUID        NOT NULL REFERENCES leave_policy_rules(id)     ON DELETE RESTRICT,

  -- Calendar year the event falls in (for annual idempotency)
  event_year      INT         NOT NULL CHECK (event_year >= 2000 AND event_year <= 2100),

  -- Date on which the days were credited to the balance ledger
  grant_date      DATE        NOT NULL,

  days_granted    DECIMAL(3,1) NOT NULL CHECK (days_granted > 0),

  -- When the granted days expire (NULL = no expiry)
  expiry_date     DATE,

  -- Lifecycle: active → used (all days consumed) | expired | cancelled (HR retraction)
  status          TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'expired', 'cancelled')),

  -- FK to the leave_balance_ledger entry created for this grant
  ledger_entry_id UUID        REFERENCES leave_balance_ledger(id)            ON DELETE SET NULL,

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- IDEMPOTENCY: one grant per employee × date-type × calendar year
  UNIQUE (tenant_id, employee_id, date_type_id, event_year)
);

CREATE INDEX IF NOT EXISTS idx_leg_employee
  ON leave_event_grants (tenant_id, employee_id, event_year DESC);

CREATE INDEX IF NOT EXISTS idx_leg_status_expiry
  ON leave_event_grants (tenant_id, status, expiry_date)
  WHERE status = 'active';

-- ── H. Row-level security for leave_event_grants ─────────────────────────────

ALTER TABLE leave_event_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leg_tenant_read" ON leave_event_grants FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Automation engine writes via service-role; HR can also insert (manual grants)
CREATE POLICY "leg_hr_write" ON leave_event_grants FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── I. Backfill joining_anniversary dates from employees.joining_date ─────────
-- For every active employee that already has a joining_date, seed their
-- joining_anniversary important date so the event engine can pick it up.
-- Birthday and marriage_anniversary must be entered by HR (not system data).

INSERT INTO employee_important_dates (
  tenant_id,
  employee_id,
  date_type_id,
  event_date,
  year_known,
  notes
)
SELECT
  e.tenant_id,
  e.id                        AS employee_id,
  idt.id                      AS date_type_id,
  e.joining_date              AS event_date,
  true                        AS year_known,
  'Auto-seeded from joining_date (migration 156)' AS notes
FROM employees e
JOIN important_date_types idt
  ON  idt.tenant_id = e.tenant_id
  AND idt.code      = 'joining_anniversary'
WHERE e.joining_date IS NOT NULL
  AND e.status = 'active'
ON CONFLICT (tenant_id, employee_id, date_type_id) DO NOTHING;
