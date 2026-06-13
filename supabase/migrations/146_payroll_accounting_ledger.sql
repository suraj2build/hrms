-- ============================================================
-- 146_payroll_accounting_ledger.sql
--
-- Enterprise payroll financial ledger & accounting engine.
--
-- Five new tables:
--   payroll_gl_mappings             — component → debit/credit GL account codes
--   payroll_financial_ledgers       — top-level accounting batch per run
--   payroll_ledger_entries          — individual double-entry accounting rows
--   payroll_cost_allocations        — department / cost-center burden breakdown
--   payroll_payout_reconciliation   — payout execution vs payroll obligation
-- ============================================================

-- ── 1. GL Account Mapping ─────────────────────────────────────────────────────
-- Maps each salary component code to its debit and credit GL accounts.
-- Tenant-configurable; default system mappings seeded below.

CREATE TABLE IF NOT EXISTS payroll_gl_mappings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,

  -- The salary component this mapping applies to.
  -- NULL means "default for this component_type" (fallback when no exact match).
  component_code  TEXT,
  component_type  TEXT        NOT NULL CHECK (component_type IN ('earning','deduction','employer_contribution','net_pay','accrual','bank')),

  debit_gl_code   TEXT        NOT NULL,
  debit_gl_name   TEXT        NOT NULL,
  credit_gl_code  TEXT        NOT NULL,
  credit_gl_name  TEXT        NOT NULL,

  -- Allow future-dated GL reconfiguration without destroying history
  effective_from  DATE        NOT NULL DEFAULT CURRENT_DATE,
  is_active       BOOLEAN     NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,

  UNIQUE (tenant_id, component_code, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_gl_mappings_tenant_code
  ON payroll_gl_mappings (tenant_id, component_code, is_active);

ALTER TABLE payroll_gl_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_gl_mappings_tenant_isolation ON payroll_gl_mappings;
CREATE POLICY payroll_gl_mappings_tenant_isolation
  ON payroll_gl_mappings FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 2. Financial Ledger (top-level batch per run) ─────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_financial_ledgers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  run_id           UUID        NOT NULL,

  -- Must reference snapshot — accounting derives from immutable snapshot only
  snapshot_id      UUID        REFERENCES payroll_run_snapshots (id),

  ledger_month     TEXT        NOT NULL,
  ledger_type      TEXT        NOT NULL DEFAULT 'payroll'
                               CHECK (ledger_type IN ('payroll','accrual','reversal','payout','adjustment')),
  ledger_status    TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (ledger_status IN ('draft','balanced','pending_approval','posted','reversed','archived')),

  -- Control totals — must be equal for a balanced ledger
  total_debit      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credit     NUMERIC(14,2) NOT NULL DEFAULT 0,

  currency         TEXT        NOT NULL DEFAULT 'INR',

  -- Approval workflow
  submitted_by     UUID,
  submitted_at     TIMESTAMPTZ,
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,

  posted_at        TIMESTAMPTZ,
  posted_by        UUID,

  -- If this ledger reverses another, reference that ledger
  reverses_ledger_id UUID REFERENCES payroll_financial_ledgers (id),

  -- Linked to accrual ledger when payout clears accrual
  accrual_ledger_id  UUID REFERENCES payroll_financial_ledgers (id),

  integrity_hash   TEXT,
  notes            TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID
);

CREATE INDEX IF NOT EXISTS idx_payroll_financial_ledgers_run_id
  ON payroll_financial_ledgers (run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_financial_ledgers_tenant_month
  ON payroll_financial_ledgers (tenant_id, ledger_month);
CREATE INDEX IF NOT EXISTS idx_payroll_financial_ledgers_status
  ON payroll_financial_ledgers (tenant_id, ledger_status);

ALTER TABLE payroll_financial_ledgers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_financial_ledgers_tenant_isolation ON payroll_financial_ledgers;
CREATE POLICY payroll_financial_ledgers_tenant_isolation
  ON payroll_financial_ledgers FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 3. Ledger Entries (double-entry rows) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_ledger_entries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id            UUID        NOT NULL REFERENCES payroll_financial_ledgers (id) ON DELETE RESTRICT,
  tenant_id            UUID        NOT NULL,

  -- Entry classification
  entry_type           TEXT        NOT NULL
    CHECK (entry_type IN (
      'salary_expense',       -- gross salary debit
      'net_payable',          -- net pay credit (Payroll Payable)
      'pf_employee',          -- employee PF deduction
      'pf_employer',          -- employer PF contribution
      'esi_employee',         -- employee ESI deduction
      'esi_employer',         -- employer ESI contribution
      'tds_payable',          -- TDS deduction
      'pt_payable',           -- Professional Tax deduction
      'other_deduction',      -- any other deduction
      'employer_contribution',-- other employer burden
      'lop_recovery',         -- LOP deduction
      'payout',               -- bank disbursement
      'accrual',              -- month-end accrual
      'accrual_reversal',     -- accrual clearance
      'adjustment'            -- manual correction
    )),

  entry_category       TEXT        NOT NULL CHECK (entry_category IN ('expense','liability','asset','equity')),

  -- Optional drill-down context
  employee_id          UUID,
  department_id        UUID,
  cost_center_id       UUID,

  -- GL account codes
  gl_account_code      TEXT        NOT NULL,
  gl_account_name      TEXT        NOT NULL,

  -- Exactly one of debit/credit is non-zero per row (standard double-entry)
  debit_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,

  currency             TEXT        NOT NULL DEFAULT 'INR',

  description          TEXT,
  source_component_code TEXT,
  source_component_name TEXT,

  -- Accounting period date (may differ from created_at for accruals)
  accounting_date      DATE        NOT NULL DEFAULT CURRENT_DATE,

  -- Unique reference per journal (run_id + sequence, e.g. PAY-2026-05-0042)
  journal_reference    TEXT,

  -- Link to reversal entry if this entry was reversed
  reversed_by_entry_id UUID REFERENCES payroll_ledger_entries (id),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_ledger_entries_ledger_id
  ON payroll_ledger_entries (ledger_id);
CREATE INDEX IF NOT EXISTS idx_payroll_ledger_entries_employee_id
  ON payroll_ledger_entries (employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_ledger_entries_gl_code
  ON payroll_ledger_entries (tenant_id, gl_account_code);
CREATE INDEX IF NOT EXISTS idx_payroll_ledger_entries_accounting_date
  ON payroll_ledger_entries (tenant_id, accounting_date);

ALTER TABLE payroll_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_ledger_entries_tenant_isolation ON payroll_ledger_entries;
CREATE POLICY payroll_ledger_entries_tenant_isolation
  ON payroll_ledger_entries FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 4. Cost Center Allocations ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_cost_allocations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id         UUID        NOT NULL REFERENCES payroll_financial_ledgers (id) ON DELETE RESTRICT,
  tenant_id         UUID        NOT NULL,

  employee_id       UUID,
  department_id     UUID,
  cost_center_id    UUID,
  department_name   TEXT,
  cost_center_name  TEXT,

  gross_pay         NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_pay           NUMERIC(14,2) NOT NULL DEFAULT 0,
  lop_recovery      NUMERIC(14,2) NOT NULL DEFAULT 0,
  employer_burden   NUMERIC(14,2) NOT NULL DEFAULT 0,   -- employer PF + ESI
  statutory_burden  NUMERIC(14,2) NOT NULL DEFAULT 0,   -- employee deductions
  overtime_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,   -- gross + employer_burden

  -- Percentage share of this employee/dept in the run total
  allocation_pct    NUMERIC(7,4)  NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_cost_allocations_ledger_id
  ON payroll_cost_allocations (ledger_id);
CREATE INDEX IF NOT EXISTS idx_payroll_cost_allocations_department
  ON payroll_cost_allocations (tenant_id, department_id);

ALTER TABLE payroll_cost_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_cost_allocations_tenant_isolation ON payroll_cost_allocations;
CREATE POLICY payroll_cost_allocations_tenant_isolation
  ON payroll_cost_allocations FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 5. Payout Reconciliation ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_payout_reconciliation (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  run_id           UUID        NOT NULL,
  slip_id          UUID,
  employee_id      UUID,
  ledger_id        UUID        REFERENCES payroll_financial_ledgers (id),

  expected_amount  NUMERIC(14,2) NOT NULL,
  paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance_amount  NUMERIC(14,2) GENERATED ALWAYS AS (paid_amount - expected_amount) STORED,

  currency         TEXT        NOT NULL DEFAULT 'INR',

  utr_number       TEXT,
  bank_reference   TEXT,
  bank_account_masked TEXT,
  ifsc_code        TEXT,

  payment_status   TEXT        NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','processing','paid','failed','reversed','held','partial')),

  initiated_at     TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,

  failure_reason   TEXT,
  retry_count      INTEGER     NOT NULL DEFAULT 0,
  last_retry_at    TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payout_recon_run_id
  ON payroll_payout_reconciliation (run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payout_recon_employee_id
  ON payroll_payout_reconciliation (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payout_recon_status
  ON payroll_payout_reconciliation (tenant_id, payment_status);

ALTER TABLE payroll_payout_reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_payout_reconciliation_tenant_isolation ON payroll_payout_reconciliation;
CREATE POLICY payroll_payout_reconciliation_tenant_isolation
  ON payroll_payout_reconciliation FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 6. Expand payroll_run_events CHECK for accounting events ─────────────────

ALTER TABLE payroll_run_events
  DROP CONSTRAINT IF EXISTS payroll_run_events_type_check;

ALTER TABLE payroll_run_events
  ADD CONSTRAINT payroll_run_events_type_check
  CHECK (event_type IN (
    -- run lifecycle (migrations 139 + 144)
    'run_started','run_completed','slip_computed','slip_insert_failed',
    'validation_failed','data_fetch_failed','compensation_missing',
    'compensation_invalid','dry_run_completed',
    -- governance (migration 144)
    'run_finalized','run_rolled_back','run_frozen','run_unfrozen',
    'blocker_resolved','approval_submitted','approval_approved',
    'approval_rejected','slip_regenerated','payout_initiated',
    'payout_failed','payout_reversed','override_applied',
    -- snapshot (migration 145)
    'snapshot_created','snapshot_verified','snapshot_integrity_failed',
    'replay_completed','replay_variance_found',
    -- accounting (migration 146)
    'ledger_created','ledger_balanced','ledger_posted',
    'ledger_reversed','ledger_integrity_failed',
    'payout_reconciled','payout_reconciliation_failed',
    'accrual_created','accrual_cleared'
  ));

-- ── 7. Seed default GL mappings template function ─────────────────────────────
-- Called per-tenant when they first configure accounting.
-- We expose a DB function so the API can call it without a migration per tenant.

CREATE OR REPLACE FUNCTION seed_default_gl_mappings(p_tenant_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payroll_gl_mappings (tenant_id, component_code, component_type, debit_gl_code, debit_gl_name, credit_gl_code, credit_gl_name)
  VALUES
    -- Earnings → Salary Expense / Payroll Payable
    (p_tenant_id, 'BASIC',             'earning',               '5001', 'Basic Salary Expense',           '2100', 'Payroll Payable'),
    (p_tenant_id, 'HRA',               'earning',               '5002', 'HRA Expense',                    '2100', 'Payroll Payable'),
    (p_tenant_id, 'SPECIAL',           'earning',               '5003', 'Special Allowance Expense',      '2100', 'Payroll Payable'),
    (p_tenant_id, 'LTA',               'earning',               '5004', 'LTA Expense',                    '2100', 'Payroll Payable'),
    (p_tenant_id, 'MEDICAL',           'earning',               '5005', 'Medical Allowance Expense',      '2100', 'Payroll Payable'),
    (p_tenant_id, 'OT',                'earning',               '5006', 'Overtime Expense',               '2100', 'Payroll Payable'),
    (p_tenant_id, NULL,                'earning',               '5000', 'Salary Expense',                 '2100', 'Payroll Payable'),
    -- Deductions → Payroll Payable / Statutory Payable
    (p_tenant_id, 'PF_EMPLOYEE',       'deduction',             '2100', 'Payroll Payable',                '2110', 'EPF Employee Payable'),
    (p_tenant_id, 'ESI_EMPLOYEE',      'deduction',             '2100', 'Payroll Payable',                '2120', 'ESI Employee Payable'),
    (p_tenant_id, 'TDS',               'deduction',             '2100', 'Payroll Payable',                '2130', 'TDS Payable'),
    (p_tenant_id, 'PROFESSIONAL_TAX',  'deduction',             '2100', 'Payroll Payable',                '2140', 'Professional Tax Payable'),
    (p_tenant_id, NULL,                'deduction',             '2100', 'Payroll Payable',                '2199', 'Other Statutory Payable'),
    -- Employer contributions → Employer Expense / Statutory Payable
    (p_tenant_id, 'PF_EMPLOYER',       'employer_contribution', '5100', 'Employer PF Contribution',       '2111', 'EPF Employer Payable'),
    (p_tenant_id, 'ESI_EMPLOYER',      'employer_contribution', '5110', 'Employer ESI Contribution',      '2121', 'ESI Employer Payable'),
    (p_tenant_id, 'GRATUITY',          'employer_contribution', '5200', 'Gratuity Expense',               '2150', 'Gratuity Payable'),
    (p_tenant_id, NULL,                'employer_contribution', '5190', 'Employer Contribution Expense',  '2190', 'Employer Contribution Payable'),
    -- Net pay payout → Payroll Payable / Bank
    (p_tenant_id, 'NET_PAY',           'net_pay',               '2100', 'Payroll Payable',                '1100', 'Bank Account'),
    -- Accrual entries
    (p_tenant_id, 'ACCRUAL',           'accrual',               '5000', 'Salary Expense',                 '2105', 'Payroll Accrual Payable'),
    (p_tenant_id, 'ACCRUAL_REVERSAL',  'accrual',               '2105', 'Payroll Accrual Payable',         '1100', 'Bank Account')
  ON CONFLICT (tenant_id, component_code, effective_from) DO NOTHING;
END;
$$;
