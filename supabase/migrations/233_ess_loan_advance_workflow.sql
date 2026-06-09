-- =============================================================================
-- 233_ess_loan_advance_workflow.sql
-- ESS two-stage approval for salary advances and loans.
--
-- Adds manager approval stage:
--   pending_manager → pending_hr → approved → disbursed → (existing flow)
--
-- Employees can now submit their own requests via ESS.
-- Manager approves first, then HR gives final approval and disburses.
-- =============================================================================

-- ── advance_salary_requests — extend status and add manager approval columns ──

ALTER TABLE advance_salary_requests
  DROP CONSTRAINT IF EXISTS advance_salary_requests_status_check;

ALTER TABLE advance_salary_requests
  ADD CONSTRAINT advance_salary_requests_status_check
    CHECK (status IN (
      'pending_manager','pending_hr',
      'pending','approved','rejected','disbursed',
      'recovering','recovered','fully_recovered','cancelled'
    ));

ALTER TABLE advance_salary_requests
  ADD COLUMN IF NOT EXISTS manager_approved_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_rejected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_via_ess    BOOLEAN NOT NULL DEFAULT false;

-- ── employee_loans — extend status and add manager approval columns ───────────

ALTER TABLE employee_loans
  DROP CONSTRAINT IF EXISTS employee_loans_status_check;

ALTER TABLE employee_loans
  ADD CONSTRAINT employee_loans_status_check
    CHECK (status IN (
      'pending_manager','pending_hr',
      'pending','approved','rejected','disbursed','active',
      'foreclosed','completed','cancelled'
    ));

ALTER TABLE employee_loans
  ADD COLUMN IF NOT EXISTS manager_approved_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_rejected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_via_ess    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pause_reason         TEXT,
  ADD COLUMN IF NOT EXISTS foreclosure_notes    TEXT,
  ADD COLUMN IF NOT EXISTS disbursed_by         UUID REFERENCES profiles(id) ON DELETE SET NULL;
