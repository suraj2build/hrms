-- Fresh audit finding (payroll cluster pass): employee_loans.loan_type's
-- CHECK constraint (migration 100) allows 'home', but every actual caller —
-- apps/api/src/routes/payroll/loans.ts's LOAN_TYPES zod enum, and both
-- frontend LOAN_TYPES lists (payroll/LoansAndAdvances.tsx,
-- ess/EssLoansAdvances.tsx) — uses 'housing' instead. No code path anywhere
-- in the repo ever inserts 'home' (confirmed via repo-wide grep; the only
-- other mention is a descriptive SQL comment in seed-demo-extra-2.sql).
-- Every housing-loan request has been failing the DB CHECK on insert since
-- this table was created — the same recurring "route-vs-CHECK vocabulary
-- mismatch" bug class this session has hit repeatedly.
--
-- True union, additive only — matches this session's established
-- non-destructive migration pattern (e.g. migration 393).

ALTER TABLE employee_loans DROP CONSTRAINT IF EXISTS employee_loans_loan_type_check;
ALTER TABLE employee_loans ADD CONSTRAINT employee_loans_loan_type_check
  CHECK (loan_type IN (
    'personal', 'education', 'vehicle', 'home', 'emergency', 'other', -- migration 100
    'housing'                                                          -- routes/payroll/loans.ts + frontend
  ));
