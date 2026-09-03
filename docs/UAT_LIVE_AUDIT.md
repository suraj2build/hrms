# CognixHR — Live UAT Audit Ledger

Started: 2026-09-03 (session continuation)
Environment: Local sandbox replica (this session's container) — Postgres 16 + PostgREST + auth shim + Fastify API + Vite web, migrated to commit `09deb07`, seeded "Demo" tenant.
Operator: Claude (autonomous), driving real Chromium via Playwright + direct API verification.

## Test Personas (created this UAT, in addition to the 12 seeded demo employees)

| Persona | Purpose | Status |
|---|---|---|
| A — Standard salaried | baseline PF/ESI/TDS/leave | pending |
| B — Manager | approvals, team ESS | pending |
| C — High salary | PF cap, no ESI, high TDS | pending |
| D — Low salary / ESI | ESI eligibility | pending |
| E — Mid-month joiner | proration | pending |
| F — LOP employee | unpaid leave/absence | pending |
| G — Arrear/revision | retro salary change | pending |
| H — Separation | resignation → F&F | pending |

## Findings Ledger

| ID | Module | Scenario | Role | Result | Severity | Evidence | Fix | Retest |
|----|--------|----------|------|--------|----------|----------|-----|--------|
| UAT-001 | Onboarding | Add Employee wizard (3-step) end to end | HR Admin | PASS | — | employee eb1b6508 created, employee_code SK0001 auto-generated, job_history correctly linked, tenure computed correctly | — | — |
| UAT-002 | Compensation | Set Up Compensation — Standard CTC template | HR Admin | PASS | — | Component amounts compute correctly per basis type (%CTC/%Basic/Fixed), math reconciles (Gross=sum earnings, Net=Gross-deductions, TotalCTC=Gross+employer) | — | — |
| UAT-003 | Compensation | Declared Annual CTC vs actual component sum reconciliation | HR Admin | FAIL | P2 | Employee B: declared Annual CTC = Rs 9,00,000; components (as configured, no Balance-type component used) sum to Rs 6,37,260 Total CTC. System accepted and displayed "Compensation configured successfully" with zero validation warning about the Rs 2,62,740 mismatch. Screenshot: empB-comp-done.png | not fixed (flagged for report) | — |
| UAT-004 | Compensation | Standard CTC template row order vs component dropdown option order | HR Admin | PARTIAL | P3 | Template auto-populates rows in order [Basic, HRA, SpecialAllowance, Conveyance, PF-EE, ProfTax, TDS, PF-ER] but the "Select component" dropdown lists options alphabetically-ish [Basic, Conveyance, HRA, ProfTax, PF-EE, PF-ER, SpecialAllowance, TDS]. An admin skimming the dropdown order while filling rows could misattribute a value to the wrong component (each row IS correctly labeled, so this requires user inattention, not a data corruption bug on its own) | not fixed (flagged for report) | — |
| UAT-005 | Payroll | Run payroll for Sep-2026 (14 employees, including 2 new UAT hires) | HR Admin | PASS | — | Gross Rs 22,10,972 exactly reconciles (prior 12-emp baseline Rs 20,95,067 + new hires' Rs 66,400+Rs 49,505). Real per-employee variation across 14 payslips, not mock data. | — | — |
| UAT-006 | Payroll | Payroll Hub readiness widget: "100/100 Grade A" shown simultaneously with "Not Ready" badge and 14 unresolved blockers | HR Admin | FAIL | P2 | Confusing/contradictory readiness display (Section 43: user cannot understand system state). Functionally the Run Payroll button was NOT actually blocked by this (see UAT-007), so the score/badge is a display inconsistency, not a gating bug. | not fixed (flagged for report) | — |
| UAT-007 | Payroll | **CRITICAL**: Professional Tax silently dropped from payroll calculation | HR Admin | FAIL | **P0** | Both new employees had Professional Tax correctly configured as a compensation deduction (Kavita: Rs 2,400/mo fixed; Arjun: Rs 4,800/mo). Payroll run excluded PT entirely from both payslips with **zero warning anywhere** — net pay overstated by the full PT amount for every affected employee. Root cause: apps/api/src/lib/statutory-payroll.ts strips ALL statutory-coded components (PF/ESI/PT/LWF) from the manual list and replaces them with properly-engine-computed lines — correct design — but when the replacement engine can't resolve applicability (here: employee has no site_id, only work_location_id, so PT state/slab lookup fails), NO warning is generated; the deduction just vanishes silently. This is exactly the failure mode CLAUDE.md/spec Section 20 explicitly prohibits for TDS ("must never silently generate a zero-TDS payslip"); the same principle was not being enforced for PF/ESI/PT/LWF. | **FIXED**: added detection in applyStatutoryToSlip() — when a configured PF/ESI/PT/LWF component is stripped without an equivalent engine-computed line being applied, append a clear warning to the payslip (mirrors the existing no-attendance-warning pattern). Commit pending push. | **PASS** — re-ran payroll live: both payslips now show "Professional Tax is configured for this employee but could not be applied this run (unresolved statutory setup — check site/state/registration). Verify before finalizing." directly on the Pay Slip detail screen. Verified in DB (payroll_slips.warning) AND live in UI. Underlying net-pay numbers are unchanged (correctly — the root data gap, missing site assignment, is a test-data issue, not a code bug) but the silent-failure is closed. All 218 existing API tests still pass. |

## Coverage

| Domain | Passed | Failed | Partial | Not Tested |
|---|---|---|---|---|
