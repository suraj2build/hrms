# Program 4 — ESS Completion Audit

**Date:** 2026-06-13 · **Status:** P4.0 AUDIT COMPLETE — awaiting approval to implement
**Principle:** Extend CognixHR — close ESS gaps using existing tables, APIs, and workflows.
No new scheduler, no new notification engine, no new reporting engine, no UI modernization.

---

## Executive Summary

ESS is substantially built: 30 routes, ~150 employee-accessible API endpoints, covering
attendance, leave, payroll, tax, benefits, reimbursements, loans, letters, helpdesk,
onboarding, and team views. The backend schema is almost entirely employee-ready — tables
for bank accounts, emergency contacts, addresses, nominees, family, and documents all exist
with employee-writable columns. The gaps are almost entirely **frontend/surface gaps**: the
data is there, the APIs mostly exist, but the ESS pages either don't expose them or expose
them read-only when the table allows writes.

**Four critical gaps** require immediate attention before ESS can be called complete.
**Eight high-priority gaps** follow. Nothing requires a new table, scheduler, or engine.

---

## A. Current ESS Capability Inventory

| # | Feature | Route | API Source | Status |
|---|---------|-------|-----------|--------|
| 1 | **Dashboard** | `/ess/dashboard` | `/ess/operational-summary`, `/employees/:id/compensation`, leave balance | ✅ Read-only: KPI cards, comp structure, leave balance, quick actions |
| 2 | **Attendance** | `/ess/attendance` | `/attendance/:id`, `/attendance/regularisation/my` | ✅ Interactive: monthly heatmap, regularization submit + status tracking, correction request, rejection reason shown |
| 3 | **Shift schedule** | `/ess/schedule` | `/attendance/roster/*`, `/employees/:id/shift-history` | ✅ Read-only: 2-month forward shift view |
| 4 | **Leave apply** | `/ess/leave/apply` | `POST /leave-requests` | ✅ Interactive: apply, preview duration, policy collision check |
| 5 | **Leave list** | `/ess/leave` | `GET /leave/my-requests` | ✅ Read-only: paginated history, status filter |
| 6 | **Leave balance** | `/ess/leave/balance` | `GET /leave/entitlement/:id`, `/leave/accrual/balance` | ✅ Interactive: balance cards, accrual ledger, comp-off request + cancellation |
| 7 | **Leave cancel** | (in-list action) | `POST /leave/:id/cancel` | ✅ Available for PENDING requests |
| 8 | **Company holidays** | `/ess/company-holidays` | `/holidays` | ✅ Read-only: calendar grid |
| 9 | **Optional holidays** | `/ess/optional-holidays` | `/leave/optional-holidays/*` | ✅ Interactive: select/deselect |
| 10 | **Compensation** | `/ess/compensation` | `/employees/:id/compensation`, `/payroll/payslips/my` | ✅ Read-only: Overview, Salary structure, Pay Slips w/ PDF download, Tax (IT statement), History (revision timeline) |
| 11 | **Tax planner** | `/ess/salary/tax-planner` | `/payroll/statutory/tds/plans/my/*` | ✅ Interactive: multi-plan builder, compute, compare, submit active declaration |
| 12 | **IT statement** | `/ess/salary/it-statement` | `/payroll/statutory/tds/it-statement/my` | ✅ Read-only: regime, computation, TDS YTD |
| 13 | **YTD statement** | `/ess/salary/ytd` | `/payroll/statutory/tds/ytd/my` | ✅ Read-only |
| 14 | **Previous employer** | `/ess/salary/previous-employer` | `/payroll/statutory/tds/previous-employment/*` | ✅ Interactive: declare + save |
| 15 | **HRA declarations** | `/ess/salary/hra` | `/payroll/statutory/tds/hra/*` | ✅ Interactive: declare, upload proofs |
| 16 | **TDS recovery** | `/ess/salary/tds-recovery` | TDS endpoints | ✅ Read-only |
| 17 | **FBP** | `/ess/fbp` | FBP endpoints | ✅ Interactive: submit quarterly FBP bills |
| 18 | **Benefits** | `/ess/benefits` | `/benefits/plans`, `/benefits/my` | ✅ Interactive: enrol/waive benefit plans, dependent selection |
| 19 | **Reimbursements** | `/ess/reimbursements` | `/payroll/reimbursements/my` | ✅ Interactive: create, submit, update draft, delete draft, track status, upload receipt |
| 20 | **Loans/advances** | `/ess/loans` | `/payroll/ess/my-loans`, `/payroll/ess/my-advances` | ✅ Interactive: apply, view EMI schedule |
| 21 | **Letters** | `/ess/letters` | `/letters/ess/*` | ✅ Interactive: request letter, track status, download PDF |
| 22 | **Helpdesk** | `/ess/issues` | `/helpdesk/tickets/my`, `POST /helpdesk/tickets` | ✅ Interactive: create ticket, add comments, view own tickets |
| 23 | **Profile** | `/ess/profile` | `/employees/:id/*` | ⚠️ Mostly read-only: 6 tabs (Overview, Employment, Attendance, Leave, Payroll, Documents). Phone editable inline only. No address, emergency contacts, family, nominees, bank. "Contact HR to request changes" shown. |
| 24 | **Documents** | `/ess/documents` | `GET /employees/:id/documents`, `GET /employees/:id/contracts` | ⚠️ Read-only + download only. Two tabs: Documents, Contracts. NO upload mutation despite `documents` table being employee-writable. |
| 25 | **Approvals** | `/ess/approvals` | `/approvals/pending`, `/approvals/workflows/*` | ✅ Read-only: aggregate pending approvals across domains |
| 26 | **Operational Center** | `/ess/operational-center` | `/ess/operational-summary`, `/ess/workforce-notifications`, `/ess/workload-balance`, `/ess/schedule-fairness`, `/ess/upcoming-payroll-impact` | ⚠️ Operational/attendance data only. No document expiry alerts. No lifecycle risk signals. |
| 27 | **Team** | `/ess/team` | `/employees/:id/org-context` | ✅ Read-only: manager, peers, reports |
| 28 | **Who's off** | `/ess/whos-off` | Leave calendar endpoints | ✅ Read-only: team leave calendar |
| 29 | **Onboarding** | `/ess/onboarding` | `/employees/:id/onboarding-status` | ✅ Interactive: task checklist, toggle complete |
| 30 | **Policies** | `/ess/policies` | Static content | ✅ Static reference |

**ESS is feature-rich.** Gaps are targeted, not foundational.

---

## B. Missing ESS Capabilities

### Critical

| Gap | Evidence | Existing Assets Available |
|-----|----------|--------------------------|
| **B1. Bank account visibility in ESS** | `EssMyProfile` shows "Contact HR to request changes" for bank data. `EssCompensation` shows salary structure but NOT bank account, UAN, PAN. `employee_bank_statutory` has no employee self-read RLS policy confirmed. | Table: `employee_bank_statutory`. API: `GET /employees/:id/bank-statutory`. Missing only: employee-read RLS policy + ESS read-only tab in EssMyProfile. |
| **B2. Document upload from ESS** | `EssDocuments.tsx` is read-only. No POST mutation. "Documents uploaded by HR will appear here." The `documents` table IS employee-writable (has `uploaded_by` FK to `profiles`). The backend API `POST /employees/:id/documents` exists. | Table: `documents`. API: `POST /employees/:id/documents`. Missing only: upload mutation + file picker in EssDocuments.tsx. |
| **B3. Lifecycle expiry alerts to employee** | `EssOperationalCenter` calls only attendance/payroll endpoints. No expiry signals for passport, visa, identity, or own documents. Program 3A sends all expiry alerts to HR inbox only — employees whose documents are expiring receive zero self-service notification. | Engine: `computeLifecycleRisks()` supports `employee_id` filter. API: `GET /workforce/expiry?employee_id=` is employee-accessible. Missing only: ESS surface (EssOperationalCenter widget or profile alert strip). |
| **B4. Separation/resignation request** | No `/ess/separation` route exists. `employee_separation.initiated_by` and `separation_clearances` tables exist but the workflow is entirely HR-initiated. Employees cannot submit a resignation through the system. | Tables: `employee_separation`, `separation_clearances`, `separation_ff_summary`. Missing: employee-write endpoint + ESS route + minimal form (separation type, last working date, reason). |

### High

| Gap | Evidence | Existing Assets Available |
|-----|----------|--------------------------|
| **B5. Emergency contacts in ESS** | `EssMyProfile` does not show emergency contacts. `emergency_contacts` table confirmed employee-writable. API `GET /employees/:id/emergency-contacts` exists. | Table: `emergency_contacts`. API: GET+POST+DELETE exist. Missing only: tab/section in EssMyProfile. |
| **B6. Personal info self-service (address, nominees, family)** | EssMyProfile shows personal info read-only. `employee_addresses`, `employee_family`, `employee_nominations` are all confirmed employee-writable tables. APIs exist. Admin EmployeeProfile page has full mutations — these are not exposed in ESS. | Tables: `employee_addresses`, `employee_family`, `employee_nominations`. APIs: all CRUD exist. Missing: ESS forms in EssMyProfile (currently read-only displays with "Contact HR" message). |
| **B7. Asset obligations view** | No `/ess/assets` route. Employees cannot see their assigned assets, pending return obligations, or asset history. | API: `GET /assets/my` + `GET /employees/:id/assets/outstanding-count` both confirmed. Table: `employee_asset_ledger`. Missing only: ESS page (or tab in EssDocuments). |
| **B8. Anomaly self-service** | Attendance anomaly detection system (`anomalies:view`, `anomalies:resolve` permissions exist for employees). `GET /attendance/anomalies/*` + `POST /attendance/anomalies/resolve` are employee-accessible. But no ESS page surfaces personal anomalies — employees don't know they have flagged attendance anomalies. | APIs: GET + resolve both employee-accessible. Table: attendance anomaly records. Missing only: ESS surface (widget in EssOperationalCenter or section in MyAttendance). |
| **B9. Helpdesk ticket close/reopen** | Employee can create and comment on tickets. Schema has `status = 'awaiting_employee'` and `closed`. No employee-facing close or "mark resolved" endpoint confirmed. Employees cannot signal "my issue is fixed" — HR must close. | Table: `helpdesk_tickets` (status enum includes 'closed'). Missing: PATCH endpoint for employee close + button in EssHelpdesk. |

### Medium

| Gap | Evidence | Existing Assets Available |
|-----|----------|--------------------------|
| **B10. Overtime ESS page** | `POST /overtime/request` and `GET /overtime/*` endpoints are employee-accessible. No `/ess/overtime` route exists. Employees can only submit OT via attendance corrections (indirect path). | APIs confirmed. Missing only: ESS page/tab. |
| **B11. Reimbursement cancellation (submitted)** | `DELETE /payroll/reimbursements/my/:id` is documented as "Delete draft claim" only. Once a claim reaches `submitted` status, employee cannot pull it back. `reimbursement_claims.status` enum includes `cancelled`. | Table: status field supports `cancelled`. Missing: employee-facing PATCH/cancel endpoint for `submitted` status + button in EssReimbursements. |
| **B12. Loan/advance withdrawal** | No employee-cancel endpoint for `pending` loans confirmed. Employees cannot withdraw an unapproved loan request. `employee_loans.status` includes `cancelled`. | Table: status field. Missing: cancel endpoint for `pending` status + button in EssLoans. |
| **B13. Shift preference submission** | EssSchedule is read-only. `employee_shifts` is HR-only. No preference channel for employees to signal shift preferences. | No existing preference table. Low priority — would require a new lightweight table. |
| **B14. FBP submission history** | EssFBP allows quarterly submission but no confirmed history/audit view of past FBP submissions and their approval status. | Table: FBP claims table (exists per reimbursement pattern). Missing: history list. |

### Low

| Gap | Evidence | Existing Assets Available |
|-----|----------|--------------------------|
| **B15. Leave encashment request** | `GET /leave/encashment/*` endpoint exists but no employee POST. Encashment is HR-initiated only. | Partial API. Missing: employee request endpoint + ESS form. |
| **B16. Internal mobility request** | No table, no route, no workflow. Out of scope for current sprint. | Nothing exists — full new feature if built. |
| **B17. Comp-off balance expiry** | Leave balance shows comp-off. Unclear if comp-off expiry (time-bounded comp-offs) is shown. | Leave balance APIs have accrual ledger. Would need expiry date surfacing. |

---

## C. Incomplete Workflows

| Workflow | Where It Stops | Evidence | Severity |
|---------|----------------|----------|---------|
| **C1. Personal data updates** | Employee sees data but cannot edit address, emergency contacts, nominees, family. "Contact HR to request changes" message — data is stale until HR manually updates. | EssMyProfile line 684: "Contact HR to request changes" shown for employment/personal data. No address/contact mutations in ESS. | Critical |
| **C2. Document upload in ESS** | Employees can view HR-uploaded documents and download them. Cannot upload their own documents (passport scan, identity card, updated address proof). | EssDocuments.tsx: no POST mutation. `documents` backend table has `uploaded_by` field — designed for employee upload. | Critical |
| **C3. Reimbursement → no submission withdrawal** | Employee creates draft ✓, submits ✓, tracks status ✓. Once submitted, cannot retract. DELETE endpoint is for `draft` only. | `DELETE /payroll/reimbursements/my/:id` — documented "Delete draft claim". No cancel for submitted status. | Medium |
| **C4. Loan application → no withdrawal** | Employee applies ✓, views schedule ✓. Cannot cancel a `pending` loan before HR approval. | No cancel endpoint confirmed for `pending` employee_loans. | Medium |
| **C5. Helpdesk → employee cannot close** | Employee creates ticket ✓, adds comments ✓. Cannot signal "resolved from my side". Status `awaiting_employee` exists but no employee-facing close action. | Schema has `closed` status + `resolved_at`, `closed_at` timestamps. No PATCH endpoint for employees. | High |
| **C6. Letter request → no escalation** | Employee requests ✓, tracks status (pending/processing/fulfilled/rejected) ✓. Cannot escalate an unprocessed request after N days. | `letter_requests` table has `processed_at` — SLA-based escalation data is available but not surfaced. | Low |
| **C7. Benefits → no mid-enrollment modification** | Employee enrolls/waives ✓. Cannot modify enrollment choice during open window without HR intervention. `benefit_enrollments` has no amendment record. | `benefit_enrollments.status` is binary (enrolled/waived). No history/amendment log. | Medium |
| **C8. Separation → employee-initiated flow absent** | Employee cannot initiate resignation at all. HR creates separation record only. | No employee endpoint. `employee_separation.initiated_by` field exists but no employee workflow. | Critical |
| **C9. Anomaly flags → employee unaware** | Attendance anomaly system detects and flags issues. Employee can resolve (`anomalies:resolve` permission) but has no surface to discover anomalies were flagged. | `GET /attendance/anomalies/*` is employee-accessible. No ESS page renders it. | High |

---

## D. Captured But Unsurfaced Employee Data

| Data | Table / Source | Currently surfaced? | Notes |
|------|---------------|---------------------|-------|
| **D1. Document/identity/passport/visa expiry** | `lifecycle-expiry.ts` + `GET /workforce/expiry?employee_id=` | ❌ Not in ESS | Program 3A sends to HR inbox only. Employees get zero alert. |
| **D2. Own bank account & statutory details** | `employee_bank_statutory` (UAN, PAN, PF number, ESIC IP, bank account) | ❌ No ESS read | RLS policy absent. EssCompensation shows salary only, not statutory identity. |
| **D3. Own addresses** | `employee_addresses` (current, permanent, correspondence) | ❌ Not in EssMyProfile | Visible in admin EmployeeProfile under Personal tab. |
| **D4. Emergency contacts** | `emergency_contacts` | ❌ Not in ESS | Admin profile has it; ESS does not. |
| **D5. Family members** | `employee_family` | ❌ Not in ESS | Admin profile Family & Nominees tab has mutations; not in ESS. |
| **D6. PF/gratuity/ESI nominees** | `employee_nominations` (scheme: pf, gratuity, esi, superannuation) | ❌ Not in ESS | Admin profile has it; ESS profile does not. |
| **D7. Asset assignments + obligations** | `assets` (assigned_to), `employee_asset_ledger` | ❌ No ESS page | `GET /assets/my` exists; not surfaced. |
| **D8. Separation FnF progress** | `separation_clearances`, `separation_ff_summary` | ❌ Not in ESS | If employee is in notice period, no ESS view of clearance or FnF status. |
| **D9. Attendance anomalies** | `attendance_anomalies` (or equivalent) | ❌ No ESS surface | Employee has `anomalies:view` + `anomalies:resolve` permissions; no page. |
| **D10. TDS monthly projection trajectory** | `tds_monthly_projections` (12-month projected liability) | ⚠️ Partial | TaxPlanner uses compute endpoint. No simple "your projected TDS this year" widget in dashboard. |
| **D11. Previous employer income (read view)** | `previous_employment` / TDS previous-employer records | ⚠️ Partial | PreviousEmployer.tsx has submit form. Unclear if submitted data is shown in a read view. |
| **D12. Employment contract details** | `employee_contracts` | ✅ In EssDocuments Contracts tab | Covered. Read-only view. |
| **D13. Payslip statutory breakdown** | `payroll_slips.component_breakdown` (JSONB) | ✅ Payslip PDF shows UAN/PF | Covered via EssCompensation payslip print. |

---

## E. ESS Reporting Opportunities

All opportunities use existing data — no new reporting engine.

| Opportunity | Data Source | Feasibility | Priority |
|-------------|-------------|------------|---------|
| **E1. Attendance trends (12-month heatmap)** | `attendance_daily` (date, status, work_hours, late_minutes, overtime_minutes) | High — extend existing `/ess/attendance` calendar to allow month navigation | High |
| **E2. Overtime summary (monthly bar)** | `attendance_daily.overtime_minutes` aggregated by month | High — single query, fits in EssOperationalCenter or new OT ESS page | High |
| **E3. Leave utilization year-over-year** | `leave_requests` + `employee_leave_balance` by year | Medium — requires multi-year `leave_requests` query | Medium |
| **E4. Tax projection trajectory** | `tds_monthly_projections` (all 12 months for current FY) | High — data exists, TaxPlanner already queries compute; add simple chart widget | High |
| **E5. Loan repayment schedule view** | `loan_schedules` (all installments for employee's loans) | High — `GET /payroll/ess/my-loans/:id/schedule` endpoint confirmed | Medium |
| **E6. Asset assignment history** | `employee_asset_ledger` (action, date, condition) | Medium — `GET /employees/:id/assets` exists; add history view | Low |
| **E7. Benefits value summary** | `benefit_plans.employer_cost` + `benefit_plans.employee_cost` per enrolled plan | Medium — enrolled plans + costs, aggregate "total benefits value" | Low |
| **E8. FBP claim history** | FBP claims table (status, period, claimed amount, approved amount) | Medium — if FBP claims table exists | Medium |
| **E9. Reimbursement history (paid vs pending)** | `reimbursement_claims` (all statuses, all years) | High — already partially shown in EssReimbursements | Low |

---

## F. Mobile Experience Gaps

| Surface | Gap | Severity |
|---------|-----|---------|
| **F1. Tax planner** | Multi-section form: plan creation, item management per section (80C, 80D…), proof uploads, plan comparison. Extremely complex for mobile. No simplified flow. | High |
| **F2. Attendance calendar heatmap** | Monthly calendar grid is data-dense. Regularization request form is manageable but the side-panel layout collapses poorly on small screens. | High |
| **F3. Leave balance workspace** | Three-tab layout with accrual ledger table (month × type matrix). Ledger table scrolls horizontally on mobile. | Medium |
| **F4. No quick punch action** | Attendance check-in/out requires navigating to `/ess/attendance`. No dashboard widget, no quick action, no one-tap punch. For field/mobile workers this is a significant friction point. | High |
| **F5. Compensation page** | Multi-tab with salary structure tables, payslip archive, IT statement. Dense data tables on mobile. | Medium |
| **F6. Reimbursements filing** | Receipt upload + category + date + amount + description. No mobile-optimized quick-expense capture (photo → amount → submit). | Medium |
| **F7. Approvals aggregate** | Cross-domain approvals in a table layout. Works on mobile but table columns truncate. | Low |
| **F8. Benefits enrollment** | Plan comparison with coverage amounts, dependent selection. Complex card layout on narrow screens. | Low |

---

## G. Reuse Opportunities

For every gap identified, the existing asset that eliminates the need for new infrastructure:

| Gap | Build from scratch? | Reuse path |
|-----|--------------------|-----------| 
| B1 Bank account view | No | Add employee-read RLS policy on `employee_bank_statutory`. Render in EssMyProfile new "Bank & Statutory" read-only tab. API `GET /employees/:id/bank-statutory` already exists. |
| B2 Document upload in ESS | No | Add `useMutation` + file picker to EssDocuments.tsx. API `POST /employees/:id/documents` already exists. `documents` table already writable. |
| B3 Lifecycle expiry alerts | No | Call `GET /workforce/expiry?employee_id={self}` from EssOperationalCenter. Engine + API fully built in Program 3A. Just a new widget. |
| B4 Separation request | Partial | New ESS route + simple form. Tables `employee_separation`, `separation_clearances`, `separation_ff_summary` all exist. New POST endpoint needed (employee-initiated create). FnF computation already exists. |
| B5 Emergency contacts | No | Add tab to EssMyProfile. API `GET/POST/DELETE /employees/:id/emergency-contacts` confirmed. Table `emergency_contacts` employee-writable. |
| B6 Personal info self-service | No | Extend EssMyProfile: add address tab + nominees tab + family tab. All APIs confirmed. All tables employee-writable. |
| B7 Asset obligations | No | New `/ess/assets` page or tab in EssDocuments. API `GET /assets/my` + outstanding-count confirmed. |
| B8 Anomaly self-service | No | Add widget to `EssOperationalCenter` (or section in `MyAttendance`). `GET /attendance/anomalies/*` + resolve endpoint are employee-accessible. |
| B9 Helpdesk close/reopen | Near-zero | Add `PATCH /helpdesk/tickets/:id/close` employee endpoint + "Mark Resolved" button in EssHelpdesk. Schema supports it. |
| C3 Reimbursement cancel | Near-zero | Add PATCH/cancel for `submitted` status. Table has `cancelled` value in status enum. |
| C4 Loan withdrawal | Near-zero | Add cancel endpoint for `pending` employee_loans. Status enum has `cancelled`. |
| E1 Attendance trends | No | Extend `/ess/attendance` to allow month-back navigation. Same `attendance_daily` query, extend date range. |
| E4 Tax trajectory | No | Query `tds_monthly_projections` for current FY. Add chart widget to TaxPlanner or ESS dashboard. |

---

## H. Recommended Build Order

### P4.1 — Self-Service Data Ownership (Critical, no new tables)
**Goal:** Employee owns and can maintain their own data without filing HR tickets.

| Item | What to build | Reuses |
|------|--------------|--------|
| P4.1a | Bank account read-only tab in EssMyProfile | RLS policy addition + GET endpoint |
| P4.1b | Emergency contacts tab in EssMyProfile (view + add + delete) | Existing API |
| P4.1c | Address management in EssMyProfile (current, permanent) | Existing API + table |
| P4.1d | Family & nominees tab in EssMyProfile (view + add + delete) | Existing API + table |

---

### P4.2 — Document & Expiry Self-Service (Critical)
**Goal:** Employee can upload own documents and see their own expiry risk.

| Item | What to build | Reuses |
|------|--------------|--------|
| P4.2a | Document upload in EssDocuments (add upload mutation) | Existing POST API + `documents` table |
| P4.2b | Lifecycle expiry alerts in EssOperationalCenter (own passport/visa/doc expiry widget) | Program 3A engine: `GET /workforce/expiry?employee_id=` |

---

### P4.3 — Workflow Completion (Critical + High)
**Goal:** Close workflows that exist but stop prematurely.

| Item | What to build | Reuses |
|------|--------------|--------|
| P4.3a | Separation/resignation request from ESS (new `/ess/separation` route + POST endpoint) | `employee_separation` table + clearance/FnF tables |
| P4.3b | Asset obligations ESS view (new `/ess/assets` page or EssDocuments tab) | `GET /assets/my` + `outstanding-count` API |
| P4.3c | Attendance anomaly surface (widget in EssOperationalCenter + resolve action) | Existing anomaly API |
| P4.3d | Helpdesk close/mark-resolved by employee | Single new PATCH endpoint + button |
| P4.3e | Reimbursement cancellation for submitted claims | New cancel endpoint |
| P4.3f | Loan withdrawal for pending applications | New cancel endpoint |

---

### P4.4 — ESS Reporting Opportunities (High + Medium)
**Goal:** Surface data the system already has but doesn't show employees.

| Item | What to build | Reuses |
|------|--------------|--------|
| P4.4a | Attendance trends: extend MyAttendance to navigate back multiple months | `attendance_daily` query |
| P4.4b | Overtime summary in EssOperationalCenter | `attendance_daily.overtime_minutes` aggregation |
| P4.4c | Tax projection trajectory widget in TaxPlanner | `tds_monthly_projections` query |
| P4.4d | Loan repayment schedule visibility in EssLoans (if not already shown) | `GET /payroll/ess/my-loans/:id/schedule` |

---

### P4.5 — Mobile Quick Actions (High — experience, not functionality)
**Goal:** Reduce mobile friction on the highest-frequency actions.

| Item | What to build | Notes |
|------|--------------|-------|
| P4.5a | Quick punch widget on ESS dashboard (attendance check-in/out from dashboard) | Existing punch API |
| P4.5b | Simplified mobile reimbursement capture (photo + amount + category → draft) | Existing reimbursement API |
| P4.5c | Tax planner simplified mobile view | Existing form, mobile layout |

---

### P4.6 — Low Priority Workflow Additions
| Item | What to build |
|------|--------------|
| P4.6a | Leave encashment request from ESS |
| P4.6b | FBP claim history list |
| P4.6c | Benefits utilization value summary |
| P4.6d | Asset assignment history view |

---

## Classification Summary

| Priority | Items | Key theme |
|---------|-------|-----------|
| **Critical** | B1, B2, B3, B4, C1, C2, C8 | Data ownership + employee-initiated workflows |
| **High** | B5, B6, B7, B8, B9, C3, C5, C9, E1, E2, E4, F1, F4 | Feature completeness + workflow closure |
| **Medium** | B10, B11, B12, B14, C3, C4, C6, C7, E3, E5, F2, F3, F5, F6 | UX completeness |
| **Low** | B13, B15, B16, B17, C6, E6, E7, E8, E9, F7, F8 | Nice-to-have |

---

## Migrations Required

**Zero new migrations needed for P4.1 through P4.4.** All tables exist.

The only migration-level change needed:
- **One RLS policy addition** (not a migration, just a policy): add an employee self-read policy
  on `employee_bank_statutory` so `GET /employees/:id/bank-statutory` returns data when
  the requester is the employee themselves.

P4.3a (separation request) needs one new API endpoint with employee write access to
`employee_separation`. The table already exists — no schema change, no migration.

---

## Scope Guard

Program 4 covers **ESS functional completion only.**

- No analytics modernization
- No UI component library changes
- No new reporting engine
- No new notification engine
- No new scheduler
- Program 3B (Certification Governance) remains deferred

**Program 4 audit is complete and ready for review.**
