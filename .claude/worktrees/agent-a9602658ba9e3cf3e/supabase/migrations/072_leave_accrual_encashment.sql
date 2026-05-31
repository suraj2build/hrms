-- ============================================================
-- 072_leave_accrual_encashment.sql
-- Leave Accrual Engine: monthly accrual rules, carry-forward
-- caps, accrual transaction ledger, and encashment requests.
-- ============================================================

-- ── Leave Accrual Rules ───────────────────────────────────────────────────────
-- Defines HOW and how much a specific leave type accrues per period.

CREATE TABLE IF NOT EXISTS leave_accrual_rules (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  leave_type_id     UUID         NOT NULL REFERENCES leave_types(id)  ON DELETE CASCADE,

  -- Accrual schedule
  accrual_frequency TEXT         NOT NULL DEFAULT 'monthly'
    CONSTRAINT lac_freq_check CHECK (accrual_frequency IN ('monthly', 'quarterly', 'annually', 'on_joining')),

  -- Days credited per period
  days_per_period   DECIMAL(5,2) NOT NULL DEFAULT 1.5,

  -- Pro-rate for joining mid-period?
  prorate_on_joining BOOLEAN     NOT NULL DEFAULT true,

  -- Carry-forward: how many accrued-but-unused days roll into next year?
  carry_forward_max  DECIMAL(5,1) NOT NULL DEFAULT 0,  -- 0 = no carry-forward
  carry_forward_expiry_months INT NOT NULL DEFAULT 3,  -- expires N months into new year (0 = never)

  -- Encashment allowed?
  encashable        BOOLEAN      NOT NULL DEFAULT false,
  max_encashable_per_year DECIMAL(5,1) NOT NULL DEFAULT 0,

  -- Effective date (rules can be versioned)
  effective_from    DATE         NOT NULL DEFAULT CURRENT_DATE,
  effective_to      DATE,

  is_active         BOOLEAN      NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, leave_type_id, effective_from)
);

ALTER TABLE leave_accrual_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lar_tenant_read" ON leave_accrual_rules;
CREATE POLICY "lar_tenant_read" ON leave_accrual_rules FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "lar_hr_write" ON leave_accrual_rules;
CREATE POLICY "lar_hr_write"    ON leave_accrual_rules FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Leave Balance Ledger ──────────────────────────────────────────────────────
-- Immutable transaction log: every balance change recorded as a row.

CREATE TABLE IF NOT EXISTS leave_balance_ledger (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  employee_id   UUID         NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  leave_type_id UUID         NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year          INT          NOT NULL,

  -- Transaction type
  txn_type      TEXT         NOT NULL
    CONSTRAINT lbl_txn_check CHECK (txn_type IN (
      'accrual',           -- monthly/quarterly credit
      'carry_forward',     -- rolled from previous year
      'manual_credit',     -- HR manually added days
      'deduction',         -- leave application approved
      'encashment',        -- paid out, balance reduced
      'expiry',            -- carry-forward expired
      'opening_balance'    -- initial/migrated balance
    )),

  -- Delta (positive = credit, negative = debit)
  delta         DECIMAL(5,2) NOT NULL,
  balance_after DECIMAL(6,2) NOT NULL,

  -- References
  leave_application_id UUID NULL,
  encashment_id         UUID NULL,
  notes                 TEXT NULL,
  created_by            UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lbl_employee_year
  ON leave_balance_ledger (tenant_id, employee_id, leave_type_id, year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lbl_txn_type
  ON leave_balance_ledger (tenant_id, txn_type, created_at DESC);

ALTER TABLE leave_balance_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lbl_tenant_read" ON leave_balance_ledger;
CREATE POLICY "lbl_tenant_read" ON leave_balance_ledger FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "lbl_hr_write" ON leave_balance_ledger;
CREATE POLICY "lbl_hr_write"    ON leave_balance_ledger FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Leave Encashment Requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_encashment_requests (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  employee_id   UUID         NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  leave_type_id UUID         NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year          INT          NOT NULL,
  days          DECIMAL(5,2) NOT NULL CHECK (days > 0),
  status        TEXT         NOT NULL DEFAULT 'pending'
    CONSTRAINT ler_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  approved_by   UUID         NULL REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ  NULL,
  paid_at       TIMESTAMPTZ  NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ler_employee_year
  ON leave_encashment_requests (tenant_id, employee_id, year, status);

ALTER TABLE leave_encashment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ler_tenant_read" ON leave_encashment_requests;
CREATE POLICY "ler_tenant_read"     ON leave_encashment_requests FOR SELECT
  USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "ler_employee_insert" ON leave_encashment_requests;
CREATE POLICY "ler_employee_insert" ON leave_encashment_requests FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "ler_hr_all" ON leave_encashment_requests;
CREATE POLICY "ler_hr_all"          ON leave_encashment_requests FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Accrual Job Log ───────────────────────────────────────────────────────────
-- Tracks each automated accrual run for idempotency.

CREATE TABLE IF NOT EXISTS leave_accrual_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_period      TEXT        NOT NULL,   -- 'YYYY-MM' for monthly, 'YYYY-Q1' for quarterly
  leave_type_id   UUID        NULL REFERENCES leave_types(id) ON DELETE SET NULL,
  employees_credited INT      NOT NULL DEFAULT 0,
  total_days_credited DECIMAL(8,2) NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'success'
    CONSTRAINT lar_run_status CHECK (status IN ('success', 'partial', 'failed')),
  error_message   TEXT        NULL,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, run_period, leave_type_id)
);

ALTER TABLE leave_accrual_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lar_run_hr_read" ON leave_accrual_runs;
CREATE POLICY "lar_run_hr_read" ON leave_accrual_runs FOR SELECT
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
DROP POLICY IF EXISTS "lar_run_hr_insert" ON leave_accrual_runs;
CREATE POLICY "lar_run_hr_insert" ON leave_accrual_runs FOR INSERT
  WITH CHECK (get_user_role() IN ('super_admin', 'hr_admin'));
