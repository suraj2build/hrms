-- ============================================================
-- 069_overtime_policy.sql
--
-- Overtime Policy Engine — Phase 4 of Attendance + Leave
-- Enterprise Maturity Program.
--
-- Changes:
--   1. overtime_policies — configurable OT rules per tenant
--   2. employee_overtime_policies — per-employee policy override
--   3. overtime_requests — OT approval workflow
--   4. Extend attendance_daily with ot_eligible, ot_approved_minutes
--
-- OT Calculation Modes:
--   'threshold'  — OT starts after shift_hours + grace (most common)
--   'shift_end'  — OT starts from shift_end time
--   'fixed_rate' — fixed daily OT allowance (e.g., field workers)
--
-- Rate Types:
--   'flat'       — fixed extra_rate per hour (₹ amount)
--   'multiplier' — extra_rate × hourly wage (e.g., 1.5x, 2x)
-- ============================================================

-- ── 1. overtime_policies ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS overtime_policies (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     TEXT        NOT NULL,
  description              TEXT,

  -- ── Calculation mode ──────────────────────────────────────────────────────
  calculation_mode         TEXT        NOT NULL DEFAULT 'threshold'
    CHECK (calculation_mode IN ('threshold', 'shift_end', 'fixed_rate')),

  -- ── Threshold mode settings ───────────────────────────────────────────────
  -- OT starts after: shift_hours + ot_start_after_minutes
  ot_start_after_minutes   INT         NOT NULL DEFAULT 0
    CHECK (ot_start_after_minutes >= 0 AND ot_start_after_minutes <= 240),

  -- ── Caps ──────────────────────────────────────────────────────────────────
  max_ot_minutes_per_day   INT
    CHECK (max_ot_minutes_per_day IS NULL OR (max_ot_minutes_per_day > 0 AND max_ot_minutes_per_day <= 720)),
  max_ot_minutes_per_week  INT
    CHECK (max_ot_minutes_per_week IS NULL OR (max_ot_minutes_per_week > 0 AND max_ot_minutes_per_week <= 3600)),
  max_ot_minutes_per_month INT
    CHECK (max_ot_minutes_per_month IS NULL OR (max_ot_minutes_per_month > 0 AND max_ot_minutes_per_month <= 14400)),

  -- ── Approval requirement ──────────────────────────────────────────────────
  requires_approval        BOOLEAN     NOT NULL DEFAULT true,
  auto_approve_below_min   INT         DEFAULT NULL   -- auto-approve OT < N minutes; null = always require
    CHECK (auto_approve_below_min IS NULL OR auto_approve_below_min > 0),

  -- ── Rate configuration ────────────────────────────────────────────────────
  rate_type                TEXT        NOT NULL DEFAULT 'multiplier'
    CHECK (rate_type IN ('flat', 'multiplier')),
  -- For 'multiplier': 1.5 = time-and-a-half, 2.0 = double time
  -- For 'flat': extra rupees per hour
  extra_rate               DECIMAL(8,4) NOT NULL DEFAULT 1.5
    CHECK (extra_rate > 0),

  -- ── Weekend / holiday OT (separate rate) ─────────────────────────────────
  weekend_rate             DECIMAL(8,4) DEFAULT NULL   -- null = same as extra_rate
    CHECK (weekend_rate IS NULL OR weekend_rate > 0),
  holiday_rate             DECIMAL(8,4) DEFAULT NULL   -- null = same as extra_rate
    CHECK (holiday_rate IS NULL OR holiday_rate > 0),

  -- ── Rounding ──────────────────────────────────────────────────────────────
  -- Round OT up to nearest N minutes (0 = no rounding)
  rounding_minutes         INT         NOT NULL DEFAULT 0
    CHECK (rounding_minutes >= 0 AND rounding_minutes <= 60),

  -- ── Status ────────────────────────────────────────────────────────────────
  is_default               BOOLEAN     NOT NULL DEFAULT false,
  is_active                BOOLEAN     NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, name)
);

-- Only one default OT policy per tenant
CREATE UNIQUE INDEX IF NOT EXISTS ot_policy_one_default
  ON overtime_policies (tenant_id)
  WHERE is_default = true;

-- ── 2. employee_overtime_policies ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_overtime_policies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  ot_policy_id     UUID        NOT NULL REFERENCES overtime_policies(id) ON DELETE CASCADE,
  effective_from   DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)   -- one active assignment per employee
);

-- ── 3. overtime_requests ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS overtime_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  attendance_date  DATE        NOT NULL,

  -- Computed by the OT engine from attendance_daily.overtime_minutes
  raw_ot_minutes   INT         NOT NULL DEFAULT 0
    CHECK (raw_ot_minutes >= 0),
  -- After applying policy caps + rounding
  approved_minutes INT
    CHECK (approved_minutes IS NULL OR approved_minutes >= 0),

  -- Workflow
  status           TEXT        NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED')),
  requested_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Policy snapshot (for audit — policy may change after request)
  ot_policy_id     UUID        REFERENCES overtime_policies(id) ON DELETE SET NULL,
  rate_type        TEXT,
  extra_rate       DECIMAL(8,4),
  is_weekend_day   BOOLEAN     NOT NULL DEFAULT false,
  is_holiday_day   BOOLEAN     NOT NULL DEFAULT false,

  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One OT request per employee per day
  UNIQUE (tenant_id, employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_ot_requests_employee_date
  ON overtime_requests (tenant_id, employee_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_ot_requests_status
  ON overtime_requests (tenant_id, status, created_at DESC);

-- ── 4. Extend attendance_daily with OT eligibility fields ─────────────────────

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS ot_eligible      BOOLEAN     NOT NULL DEFAULT false;

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS ot_approved_minutes INT
    CHECK (ot_approved_minutes IS NULL OR ot_approved_minutes >= 0);

-- ── 5. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE overtime_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "otp_tenant_read" ON overtime_policies;
CREATE POLICY "otp_tenant_read" ON overtime_policies FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "otp_hr_write" ON overtime_policies;
CREATE POLICY "otp_hr_write"    ON overtime_policies FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

ALTER TABLE employee_overtime_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eotp_tenant_read" ON employee_overtime_policies;
CREATE POLICY "eotp_tenant_read" ON employee_overtime_policies FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "eotp_hr_write" ON employee_overtime_policies;
CREATE POLICY "eotp_hr_write"    ON employee_overtime_policies FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "otr_tenant_read" ON overtime_requests;
CREATE POLICY "otr_tenant_read"   ON overtime_requests FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "otr_employee_insert" ON overtime_requests;
CREATE POLICY "otr_employee_insert" ON overtime_requests FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "otr_hr_all" ON overtime_requests;
CREATE POLICY "otr_hr_all"        ON overtime_requests FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin', 'manager'));

-- ── 6. Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE overtime_policies IS
  'Configurable OT rules per tenant. One default policy; per-employee overrides in employee_overtime_policies.';

COMMENT ON COLUMN overtime_policies.calculation_mode IS
  'threshold: OT starts after shift + ot_start_after_minutes.
   shift_end: OT starts at the shift end time regardless of work hours.
   fixed_rate: flat daily OT allowance.';

COMMENT ON COLUMN overtime_policies.extra_rate IS
  'For rate_type=multiplier: wage multiplier (1.5 = time-and-a-half).
   For rate_type=flat: extra rupees per OT hour.';

COMMENT ON COLUMN overtime_requests.approved_minutes IS
  'OT minutes after applying policy caps and rounding. Null until approved.';
