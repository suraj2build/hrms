-- ═══════════════════════════════════════════════════════════════
-- 449 — Accounting ledger must not silently drop ad-hoc payroll components
--
-- A review of the G12 leave-encashment work found a real defect in the
-- accounting-ledger pipeline, pre-existing but newly exposed: a payroll
-- slip's "ad-hoc" components — ones synthesized directly in payroll-
-- engine.ts with no backing row in the employee_compensations catalog
-- (standalone leave encashment's LEAVE_ENCASHMENT earning + its TDS
-- withholding, migration 447; advance/loan-EMI recovery deductions,
-- ADVANCE_RECOVERY/LOAN_EMI) — were SILENTLY OMITTED from every journal
-- entry buildPayrollFinancialLedger() (payroll-accounting-engine.ts)
-- generates, because that function's `comps` array comes exclusively from
-- payroll_employee_snapshots.compensation_snapshot, which is built from
-- employee_compensation_components — the employee's STANDING structure,
-- not the slip's actual computed component list.
--
-- Worse than just omission: the LOP contra amount was computed as
-- `gross_pay - net_pay - statutoryDedTotal` (statutoryDedTotal from the
-- catalog components only), so any ad-hoc deduction's rupee value (e.g. the
-- encashment's TDS line) got swept into "LOP recovery" instead of its real
-- GL bucket (TDS Payable) — a genuine misclassification, not just a gap.
--
-- Fix (code-side, apps/api/src/lib/payroll-snapshot-engine.ts +
-- payroll-accounting-engine.ts): buildPayrollRunSnapshot now fetches
-- payroll_slips.component_breakdown and buildEmployeePayrollSnapshot diffs
-- it against the compensation catalog by code, storing the difference —
-- the genuinely ad-hoc lines — on this new column.
-- buildPayrollFinancialLedger now merges adhoc_components into the
-- `comps` array generateLedgerEntries posts (so they get a real Dr/Cr pair
-- via the SAME existing GL-mapping/default-fallback path catalog
-- components already use), and excludes their net effect from the LOP
-- formula so they're never double-counted into that bucket either.
--
-- This column is additive and does NOT participate in
-- validateSnapshotIntegrity's hash check (that check already covers only a
-- fixed field subset, not every blob field — unchanged by this migration).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE payroll_employee_snapshots
  ADD COLUMN IF NOT EXISTS adhoc_components JSONB;

COMMENT ON COLUMN payroll_employee_snapshots.adhoc_components IS
  'payroll_slips.component_breakdown lines with no employee_compensations catalog row (standalone leave encashment, advance/loan EMI recovery) — captured here because compensation_snapshot only reflects the standing compensation structure. The accounting ledger posts these via the same GL-mapping path as catalog components; NULL for snapshots taken before migration 449.';
