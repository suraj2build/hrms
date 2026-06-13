# Program 5 — Compensation Lifecycle Audit

**Date:** 2026-06-13 · **Status:** AUDIT ONLY — no code, no migrations, no UI changes
**Branch:** `claude/blissful-ptolemy-8AMQn`
**Principle:** Extend existing payroll architecture. No Compensation Engine V2, no duplicate approval
system, no duplicate budget/analytics engine.

---

## 1. Architecture Review

The compensation lifecycle is the most mature domain in CognixHR. The core engine — salary
structures, employee compensation, revision workflow, payroll run, statutory compliance, forensics,
freeze/snapshot — is production-ready and fully wired. The vast majority of what a "Compensation
Lifecycle" program could build already exists.

Program 5's job is to **surface the three remaining employee-facing gaps** and **close two
executive-visibility gaps**, not to rebuild anything.

```
salary_structures ──────────────────────────────────────────────────────┐
salary_components                                                        │
employee_compensations ──────── payroll_runs ──── payroll_slips         │
employee_compensation_components    │                  │                 │
compensation_revisions ─────────────┘          statutory engine         │
  (submit/approve/reject/withdraw)              (PF/ESI/PT/TDS)         │
variable_payout_batches                                                  │
variable_payouts                                                         ├─▶ HR surface (COMPLETE)
benefit_plans                                                            │     CompensationMaster.tsx
benefit_enrollments                                                      │     CompensationRevisions.tsx
advance_recovery_schedules                                               │     SalaryComponents.tsx
loan_schedules ──────────────────────────────────────────────────────────┘     VariablePay.tsx
                                                                               PayrollControlCenter.tsx (+ 20 payroll pages)

ESS surface (MOSTLY COMPLETE):
  EssCompensation.tsx — Overview/Salary/Payslips/Tax/History tabs ← real data ✅
  EssFBP.tsx          — Flexible benefit declarations ✅ (standalone page, sidebar linked)
  EssBenefits.tsx     — Benefit enrollment ✅ (standalone page, sidebar linked)
  EssLoansAdvances.tsx — Loans & advances ✅
  EssCompensation.tsx — Bonuses & Incentives tab ← ComingSoon placeholder ❌  (P5.1)
  EssCompensation.tsx — Benefits tab ← ComingSoon placeholder ❌              (P5.2)

Manager surface (MISSING):
  No manager compensation workspace ← no pages, no routes                  ❌  (P5.3)

Executive surface (PARTIAL):
  ExecutiveIntelligenceCenter.tsx / FinancialView.tsx — gross/net/dept costs ✅
  Component-level payroll mix (fixed/variable/statutory/OT) ← EmptyBody    ❌  (P5.4)
  OT cost month-over-month trend ← EmptyBody                               ❌  (P5.6)

HR increment tooling (INDIVIDUAL ONLY):
  compensation_revisions handles one employee at a time ✅
  Batch annual increment cycle / cohort management ← not built             ❌  (P5.5)
```

---

## 2. Existing Asset Inventory

Everything listed here is **complete and must not be duplicated.**

### Database (all pre-existing migrations)

| Table | Migration | Purpose |
|---|---|---|
| `salary_components` | 014 | Master component catalog (taxable, PF/ESI flags, variable flag) |
| `salary_structures` | 014 | Named salary templates |
| `salary_structure_components` | 014 | Component ↔ structure mapping (calc_type, default_value, sequence) |
| `employee_compensations` | 014 | Active CTC per employee (unique is_active per employee) |
| `employee_compensation_components` | 014 | Per-employee component breakdown with computed values |
| `compensation_revisions` | 078 | Full revision workflow (submit→approve/reject/withdraw); before/after snapshot; retro_months; payroll_impact_preview |
| `incentive_templates` | (variable-pay) | Variable pay template catalog (performance_bonus, referral_bonus, etc.) |
| `variable_payout_batches` | (variable-pay) | HR-created payout batches (pending→approved) |
| `variable_payouts` | (variable-pay) | Per-employee payout rows within a batch |
| `benefit_plans` | 243 | Benefit catalog with enrollment window, coverage, cost split |
| `benefit_enrollments` | 243 | Employee enrollment elections + dependent_ids |
| `advance_salary_requests` | (advances) | Salary advance requests + recovery status |
| `advance_recovery_schedules` | (advances) | EMI-like recovery schedule per advance |
| `employee_loans` | (loans) | Employee loan records + outstanding balance |
| `loan_schedules` | (loans) | EMI schedule per loan, marked paid on payroll finalization |
| `payroll_runs` | 074 | Monthly payroll batch lifecycle (draft→finalized→frozen) |
| `payroll_slips` | 074 | Per-employee computed output (gross/deductions/net/LOP) |
| `payroll_run_events` | 139 | Immutable forensic event log per employee per run |
| `payroll_run_blockers` | 142 | Validation failures with resolution audit trail |
| `payroll_validation_rules` | (validation) | Configurable rule severity/blocking |
| `payroll_freeze_log` | 225 | Freeze/unfreeze audit trail |
| `statutory_filing_closures` | 146 | PF/ESI/PT/TDS filing closure records |

### API routes (all pre-existing, must not be duplicated)

| Route prefix | File | Capability |
|---|---|---|
| `GET/POST/PUT /payroll/compensation-master/*` | `compensation-master.ts` | HR compensation CRUD + effective dating |
| `GET/POST/… /compensation/revisions` | `compensation/revisions.ts` | Full revision workflow with preview |
| `GET/POST/… /payroll/variable-pay/*` | `variable-pay.ts` | Template + batch + payout + approve |
| `GET/POST/… /benefits/*` | `benefits/` | Plan catalog + enrollment (admin + ESS) |
| `GET/POST/… /payroll/runs/*` | `payroll/index.ts` | Payroll run lifecycle (20+ endpoints) |
| `GET /payroll/my-slips` | `payroll/index.ts` | ESS: own finalized slips |
| `GET /payroll/slips/:id` | `payroll/index.ts` | ESS: single slip detail |
| `GET /payroll/slips/trend` | `payroll/index.ts` | ESS: 24-month rolling trend |
| `GET /payroll/cost/*` | `cost.ts` | HR/exec: payroll cost analytics + drilldown |
| `GET /payroll/forecast/*` | `forecast.ts` | Predictive payroll forecasting |
| `GET /payroll/simulate/*` | `simulate.ts` | What-if payroll scenario simulation |
| `GET /payroll/ops-dashboard/*` | `ops-dashboard.ts` | Operational KPI dashboard |
| `GET /payroll/compensation-coverage` | `payroll/index.ts` | Per-employee readiness audit |
| `GET /payroll/readiness-score` | `payroll/index.ts` | Composite payroll readiness score |
| `GET /payroll/statutory-reconciliation` | `reconciliation.ts` | PF/ESI/PT/TDS cross-statute recon |
| `GET /payroll/forensics` | `investigate.ts` | Per-employee forensic event timeline |

### UI pages (all pre-existing, must not be duplicated)

| Page | Route | Status |
|---|---|---|
| `CompensationMaster.tsx` | `/payroll/compensation-master` | ✅ Complete |
| `CompensationRevisions.tsx` | `/payroll/compensation-revisions` | ✅ Complete |
| `CompensationSetup.tsx` | `/payroll/compensation-setup` | ✅ Complete |
| `SalaryComponents.tsx` | `/payroll/salary-components` | ✅ Complete |
| `VariablePay.tsx` | `/payroll/variable-pay` | ✅ Complete (HR side) |
| `EssCompensation.tsx` | `/ess/compensation` | ✅ Partial (2 placeholder tabs) |
| `EssFBP.tsx` | `/ess/fbp` | ✅ Complete |
| `EssBenefits.tsx` | `/ess/benefits` | ✅ Complete (standalone page) |
| `EssLoansAdvances.tsx` | `/ess/loans` | ✅ Complete |
| `PayrollCostIntelligence.tsx` | `/payroll/cost-intelligence` | ✅ Complete |
| `PayrollForecast.tsx` | `/payroll/forecast` | ✅ Complete |
| `PayrollSimulation.tsx` | `/payroll/simulate` | ✅ Complete |
| `ExecutiveIntelligenceCenter.tsx` | `/executive/*` | ✅ Partial (component-mix gap) |
| `FinancialView.tsx` | `/executive/financial` | ✅ Partial (component-mix gap) |
| 20+ other payroll pages | `/payroll/*` | ✅ Complete |

### Payroll engine libraries (all pre-existing)

`payroll-engine.js` · `statutory-payroll.js` · `payroll-validator.js` ·
`payroll-blocker-engine.js` · `payroll-snapshot-engine.js` ·
`payroll-accounting-engine.js` · `statutory-governance.js` · `payroll-read-model.js` ·
`payroll-compensation-coverage.js`

---

## 3. Reuse Inventory

All Program 5 items reuse existing infrastructure. No new tables, no new engines.

| Gap | Existing asset to reuse |
|---|---|
| P5.1 ESS bonus visibility | `variable_payout_batches` + `variable_payouts` (filter `status='approved'` + `employee_id=self`) |
| P5.2 ESS Benefits tab wiring | `EssBenefits.tsx` component tree already built; wire into EssCompensation Benefits tab |
| P5.3 Manager compensation console | `employee_compensations` + `compensation_revisions` (scoped to `reports_to=manager`); reuse revision workflow |
| P5.4 Component-level payroll mix | `cost.ts` backend + `payroll_slips.component_breakdown` JSONB — aggregate fixed/variable/statutory/OT per run |
| P5.5 Batch increment cycle | `compensation_revisions` (bulk-insert individual revisions per selected employee); reuse approve endpoint |
| P5.6 OT cost trend | `payroll_slips.overtime_hours` × OT rate per employee — aggregate by month; extend `cost.ts` |

---

## 4. Missing Capability Inventory

### Critical — gap blocks the compensation lifecycle experience for employees or managers

**P5.1 — ESS Bonuses & Incentives tab (no backend ESS endpoint)**

- `EssCompensation.tsx` tab `'bonuses'` renders `ComingSoon` placeholder.
- `variable_payout_batches` / `variable_payouts` tables are fully populated by HR (VariablePay.tsx).
- There is no `GET /payroll/variable-pay/my` or any self-scoped endpoint exposing approved payouts to
  the employee themselves.
- Employees see zero visibility into their approved performance bonuses, referral bonuses, or
  retention bonuses until this gap is closed.
- **New work needed:** one read-only ESS endpoint (filter to `approved` batches, `employee_id=self`)
  + wire the tab.

**P5.2 — ESS Benefits tab in EssCompensation is a placeholder**

- `EssCompensation.tsx` tab `'benefits'` renders `ComingSoon` placeholder with blurb
  "once the benefits catalogue is enabled."
- `EssBenefits.tsx` is a fully functional standalone page (enrollment, dependent selection,
  plan catalog, enrollment window enforcement) accessible from the sidebar at `/ess/benefits`.
- The EssCompensation "Benefits" tab is simply not wired to the existing content.
- **New work needed:** wire the tab content — either embed EssBenefits logic or replace with a
  redirect/link card. No new API or table required.

### High — meaningful operational gap

**P5.3 — Manager compensation console does not exist**

- The manager sidebar has only `TeamLeaveBalances` and `ManagerLoanApprovals`.
- Managers have no way to: view direct reports' active CTC, submit increment recommendations for
  their team, or track the status of submitted revisions.
- The `compensation_revisions` API distinguishes `hr_admin` vs. employee callers but has no
  manager-scoped access path (manager submits revision for a direct report; HR approves).
- The `employees.reports_to` field exists and is used in team views — the data for scoping is
  present.
- **New work needed:** manager-facing `GET /manager/team/compensation` (team CTC, scoped to
  `reports_to=req.userId`) + allow managers to `POST /compensation/revisions` for their direct
  reports (server-side guard: `employee.reports_to = manager_employee_id`). New page:
  `ManagerCompensation.tsx` under `/manager/compensation`.

**P5.4 — Component-level payroll mix not surfaced in executive intelligence**

- `FinancialView.tsx` contains two explicit `EmptyBody` cells:
  > "Component-level payroll breakdown (fixed / variable / statutory / OT) isn't exposed yet —
  > only gross & net totals are available."
- `payroll_slips.component_breakdown` is a JSONB field containing per-component computed values.
  `cost.ts` backend has department-level aggregates. The aggregate of fixed/variable/statutory
  per run is not yet computed server-side.
- **New work needed:** extend `cost.ts` (or add one endpoint) to aggregate component types across
  all slips in a run; wire the two empty panels in FinancialView.

### Medium — operational gap that can wait for prioritisation

**P5.5 — Annual increment cycle (batch processing) not built**

- `CompensationRevisions.tsx` handles one employee at a time: HR selects an employee, enters new
  CTC, submits, approves. There is no "run FY2026-27 increment cycle" flow.
- Common HR pattern: select a cohort (dept/grade/all active) → apply a % matrix or flat amount →
  generate draft revisions for 50+ employees → bulk review → bulk approve → all activate on
  effective date.
- No migration needed (individual `compensation_revisions` rows are the right unit), but the
  batch-creation surface, cohort picker, and bulk-approve UI do not exist.
- **New work needed:** HR page `IncrementCycle.tsx` (cohort selection → preview → bulk submit →
  HR approval list); API `POST /compensation/revisions/bulk` (creates N individual revision rows,
  reuses the existing approve endpoint per-row or introduces a bulk-approve). This is the most
  complex P5 item.

**P5.6 — Overtime cost trend not aggregated in executive intelligence**

- `ExecutiveIntelligenceCenter.tsx` contains:
  > "A month-by-month overtime trend isn't aggregated yet."
- `payroll_slips.overtime_hours` is stored per slip. The per-department OT cost panel in
  FinancialView shows current-period OT cost but no trend line.
- **New work needed:** extend `cost.ts` to compute `SUM(overtime_hours × ot_hourly_rate)` by
  month and department; wire the trend panel.

### Low — informational gap, not operationally blocking

**Merit matrix / increment bands (no table exists)**

- There is no `increment_bands` or `merit_matrix` table (no migration found).
- P5.5 batch increment is usable without one (HR enters amounts manually), but a structured
  grade × performance_rating → increment_pct matrix would reduce HR manual work.
- Recommendation: defer until P5.5 batch cycle is live and adoption is confirmed.

**Compensation benchmarking / market data (not in scope)**

- No market salary data source has been connected. This is a future integration concern,
  not a lifecycle gap.

---

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **P5.1 variable pay ESS endpoint exposes draft payouts** | High | Filter strictly to `status='approved'` batches; never expose `pending` rows to employees |
| **P5.3 manager CTC access leaks non-direct-report salaries** | High | Server-side guard: resolve manager's `employee_id` → fetch employees where `reports_to=manager_employee_id`; never trust client-supplied employee list |
| **P5.5 batch increment builds a parallel approval engine** | High | The batch submit must create individual `compensation_revisions` rows and reuse the existing per-row approve/reject endpoints. Do not introduce a "batch approval" state machine — that would be a duplicate engine |
| **P5.5 bulk revision effective-date conflicts** | Medium | Guard: if an employee already has a `pending` revision, block the batch insert for that employee (return error, not silent skip) |
| **P5.4 component-breakdown query is slow on large tenants** | Medium | Aggregate at run finalization time (store in `payroll_runs.component_mix` JSONB) rather than re-scanning all slips on every executive page load |
| **P5.2 EssBenefits wired inside EssCompensation causes enrollment window confusion** | Low | Keep the tab as a navigation card/link to `/ess/benefits` rather than a full embed to avoid duplicating enrollment logic in two places |

---

## 6. Recommended Build Order

| Phase | Item | Complexity | Migrations | API new | UI new |
|---|---|---|---|---|---|
| **P5.1** | ESS Bonuses & Incentives tab | Low | None | 1 read-only endpoint | Wire 1 tab |
| **P5.2** | ESS Benefits tab wiring | Very low | None | None | Wire 1 tab (link card) |
| **P5.3** | Manager compensation console | Medium | None | 1–2 manager-scoped endpoints | 1 new page |
| **P5.4** | Component-level payroll mix (exec) | Low | None | Extend `cost.ts` (1 endpoint) | Wire 2 empty panels |
| **P5.5** | Batch annual increment cycle | High | None | 1 bulk-create endpoint | 1 new HR page |
| **P5.6** | OT cost trend aggregation (exec) | Low | None | Extend `cost.ts` (1 endpoint) | Wire 1 empty panel |
| Closure | Closure audit | — | — | — | — |

Total migrations to apply before deploy: **zero.**
All data and engines pre-exist. Program 5 adds surfaces only.

---

## 7. Program 5 Roadmap

```
P5.1 — ESS Bonuses & Incentives
  Backend: GET /payroll/variable-pay/my
           (resolved employee_id from profile; filter approved batches; return batch name,
            payout_type, amount, paid_month, remarks)
  Frontend: wire EssCompensation.tsx 'bonuses' tab
            show payout cards sorted by paid_month desc; total YTD bonus stat tile

P5.2 — ESS Benefits tab wiring
  No backend change.
  Frontend: replace ComingSoon in EssCompensation 'benefits' tab with a
            navigation card → /ess/benefits (or inline the EssBenefits content
            with a shared query hook)

P5.3 — Manager Compensation Console
  Backend: GET /manager/team/compensation
           (scoped to employees.reports_to = manager's employee_id;
            returns active CTC + last revision date per direct report)
           Extend POST /compensation/revisions to accept manager caller
           (server-side guard: submitted employee must be a direct report)
  Frontend: new page ManagerCompensation.tsx at /manager/compensation
            team CTC table + "Request increment" action per row
            revision tracking panel (own submitted revisions, status badges)
  Sidebar: add "Team Compensation" link under manager nav group

P5.4 — Component-level payroll mix (executive)
  Backend: extend GET /payroll/cost/component-mix (new or extend cost.ts)
           aggregate component_breakdown JSONB across all slips in a run
           grouped by component_type (earning/deduction/employer_contribution)
           then by sub-type (fixed_earning/variable_earning/statutory_deduction)
  Frontend: wire FinancialView.tsx "Payroll Mix" panel (currently EmptyBody)
            stacked bar: fixed salary / variable pay / statutory deductions / OT
            wire ExecutiveIntelligenceCenter.tsx parallel EmptyBody

P5.5 — Batch Annual Increment Cycle (most complex)
  Backend: POST /compensation/revisions/bulk
           body: { employee_ids[], effective_date, revision_type='increment',
                   mode: 'flat_amount'|'pct_of_ctc', value, reason, notes }
           - Validate: each employee has active compensation; no pending revisions
           - Insert N individual compensation_revisions rows (same schema as single)
           - Return: { created[], skipped[{ employee_id, reason }] }
           Reuse existing GET/POST /compensation/revisions/:id/approve for per-row approval
  Frontend: new page IncrementCycle.tsx at /payroll/increment-cycle
            Step 1: cohort selection (dept filter, grade filter, or upload list)
            Step 2: preview (current CTC table, new CTC computation, delta %)
            Step 3: bulk submit → creates revision rows
            Step 4: approval queue (existing CompensationRevisions.tsx handles per-row approve)

P5.6 — OT Cost Trend aggregation (executive)
  Backend: extend cost.ts with GET /payroll/cost/ot-trend
           aggregate SUM(overtime_hours) × (ctc_monthly / working_days / 8) per month
           grouped by department; return 12-month series
  Frontend: wire FinancialView.tsx "Overtime by Department" trend panel (currently EmptyBody)

Closure: docs/program5-compensation-closure-audit.md
```

---

## 8. Scope Guard

The following are **explicitly out of scope for Program 5:**

- No Compensation Engine V2 — existing payroll engine is complete and production-ready
- No Salary Framework V2 — existing structures/components model is sufficient
- No duplicate approval system — all revision approvals route through the existing
  `compensation_revisions` workflow
- No budget engine — `payroll_impact_preview` in revisions covers impact estimation
- No duplicate analytics engine — extend `cost.ts` and the executive pages, not new dashboards
- No ML/predictive compensation modelling — out of scope for all current programs
- No performance-to-increment linkage (merit matrix) — Program 3B domain; defer post 3B
- No market salary benchmarking — future integration, not a lifecycle gap
- Program 3B (Certification Governance) and Program 6 (Manager Workspace) remain deferred

**Program 5 is an audit. Implementation must not begin until Program 4 is reviewed and approved.**
