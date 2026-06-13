# CognixHR — Existing Module Gap Audit (P1)

**Date:** 2026-06-13
**Scope:** Workforce · Attendance · Leave · Payroll · Compliance · Employee Lifecycle
**Method:** Read-only investigation of `apps/web` (pages, routes, nav), `apps/api` (routes), and `supabase/migrations` (data layer). No code was changed.
**Status:** Audit for review. **Nothing implemented.** Roadmap proposed at the end for prioritisation.

---

## How to read this

Each module lists gaps under the seven requested categories:
1. Existing capabilities (summary) · 2. Missing capabilities · 3. Orphaned pages · 4. Incomplete workflows · 5. Data captured but not surfaced · 6. Reports missing · 7. Intelligence opportunities.

**Severity rubric**
- **Critical** — production risk, statutory/legal exposure, or blocks a core month-end / settlement / filing operation.
- **High** — significant functional gap forcing manual workarounds or risking data integrity.
- **Medium** — meaningful enhancement, unsurfaced data, or a missing report of moderate value.
- **Low** — nice-to-have, niche, or discoverability/UX.

### Already shipped this session (NOT gaps — excluded below)
The following landed on branch `claude/blissful-ptolemy-8AMQn` during the current work and should **not** be treated as gaps:
Benefits enrolment (admin plans + ESS enrol **with dependent selection** + enrolment-window enforcement, migration 243) · Helpdesk **SLA policy editor + resolution-SLA + breach scanner** (migration 242) · Onboarding **buddy assignment + email** & **IT-asset assignment** (migration 241) · **PAY-09 voucher Excel export** by cost-centre · **EMP-02 org-chart click-to-reassign** + nav entry · **RPT-04 audit logging** on onboarding/letters/documents/helpdesk/benefits · **ESS-03 Team "Who's Off"** calendar · **INT-06 interview analytics depth**. Where the sub-agents flagged these as gaps, they have been corrected.

---

## Executive summary

CognixHR is a **mature, broad HRMS**: payroll, attendance, leave, statutory compliance and the employee lifecycle are all implemented end-to-end with rich data models. The dominant gap pattern is **not missing modules — it is the "last mile"**:

- **Captured-but-not-surfaced data** is the single biggest theme (work-session anomalies, cost-centre allocations, contract/identity expiry, leave carry-forward expiry, challan numbers, regime lock status, OT liability).
- **Cross-module workflow seams are open** — the clearest is **Separation → Payroll**: F&F settlement, gratuity and leave-encashment are captured as fields but not computed or paid through payroll.
- **Statutory "official artifacts" are incomplete** — Form 16 PDF and a true Form 24Q export are the highest-exposure items.
- **One live production risk**: ledger generation (`POST /payroll/runs/:id/ledger`) returns 500.

**Top of the stack (business-value-ordered, detailed roadmap at end):**
1. 🔴 Fix payroll **ledger generation 500** (prod).
2. 🔴 **Separation → Payroll F&F** settlement (gratuity + leave encashment + final dues).
3. 🔴 **Form 16 PDF** + 🟠 **Form 24Q** + 🟠 **LWF export** (statutory exposure).
4. 🟠 **Compliance deadline calendar + alerts** and **statutory audit logging**.
5. 🟠 **Document/contract/identity expiry alerts** (visa, contracts, registrations).
6. 🟠 **Standard payroll registers + bank advice file** (NEFT/RTGS).
7. 🟠 **Surface captured data** (cost-centre cost, OT liability, work-session anomalies, leave liability).
8. 🟡 **ESS self-service** (profile / family / nominees with HR approval) and **attendance shift-swap**.

---

## 1. Workforce (Directory, Org Structure, Documents, Letters, Assets, Helpdesk, Benefits)

**Existing (works end-to-end):** Employee directory + 19-table profile (`EmployeeList.tsx`, `EmployeeProfile.tsx`, `/employees/:id/full-profile`); Org chart with reassign (`OrgChart.tsx`, EMP-02 shipped); Org masters — departments/designations/grades (`Organization.tsx`, `/masters/*`); Document vault (`Documents.tsx`); Letters (`LettersAdmin.tsx`, `/letters/generate`); Assets + ledger (`AssetMaster.tsx`, `/assets`); Helpdesk with SLA (shipped); Benefits enrolment (shipped).

| # | Gap | Category | Severity | Evidence / Notes |
|---|-----|----------|----------|------------------|
| W1 | **ESS profile is entirely read-only** — employees can't initiate address/bank/personal updates (with HR approval) | Missing capability | **High** | `EssMyProfile.tsx` read-only; peers (Keka/Darwinbox) allow request→approve |
| W2 | **Identity/visa/contract expiry not surfaced** — `employee_identity.expiry_date`, `employee_contracts.end_date` captured, no alerts | Data not surfaced / Report | **High** | migrations `012_employee_extended.sql`; no expiry dashboard or digest |
| W3 | **Letter approval chain unused** — `letter_approval_chains` table exists, no routing UI; e-sign fields (`signed_by/at`) unused | Incomplete workflow | **Medium** | `076_letter_generation.sql`; LettersAdmin has no approval/sign flow |
| W4 | **Bulk letter generation** (offer letters for a joiner cohort) | Missing capability | **Medium** | only single-letter generate |
| W5 | **Asset return not gated at separation** — `employee_asset_ledger` has return action but separation doesn't enforce "all assets returned" | Incomplete workflow | **High** | links to L-sep below; ties to SeparationWorkflow |
| W6 | **Asset history timeline / valuation / maintenance** — ledger captured, no per-asset timeline, no depreciation/warranty | Data not surfaced / Report | **Medium** | `211_asset_management.sql` |
| W7 | **Profile completeness / data-quality score** + duplicate (PAN/Aadhaar/phone) flags | Intelligence | **Medium** | `trust.ts` hints at duplicate detection; not surfaced as a score |
| W8 | **Helpdesk**: knowledge base, CSAT survey, auto-assignment, bulk actions | Missing capability | **Low–Medium** | core + SLA done; these are enhancements |
| W9 | **Benefits**: payroll-deduction integration, claims, policy-doc storage, plan comparison | Missing capability | **Medium** | enrolment shipped; downstream integration open |
| W10 | **Org masters discoverability** — Organization lives under Setup; headcount/budget per dept not reported | Report / Low | **Low** | nav-config Setup group; no headcount-by-dept/grade report |
| W11 | **Headcount / org-structure exports** (org chart PDF, headcount by dept & grade) | Report | **Medium** | none today |

---

## 2. Employee Lifecycle (Onboarding, Separation/Offboarding/FNF, Family/Nominees)

**Existing:** Onboarding hub (invites + AI review), pre-join portal, checklists/sessions, buddy assignment + IT-asset (shipped); Separation workflow with dept clearances + F&F summary (`SeparationWorkflow.tsx`, `/employees/:id/separation`, `separation_*` tables); Family & nominations CRUD (`/employees/:id/family|nominations`).

| # | Gap | Category | Severity | Evidence / Notes |
|---|-----|----------|----------|------------------|
| L1 | **Separation has no enforced state machine** — stepper is cosmetic; can mark "relieved" without clearance/asset return/FNF | Incomplete workflow | **High** | `SeparationWorkflow.tsx` lifecycle stepper unguarded |
| L2 | **FNF is manual entry, not computed** — `separation_ff_summary` amounts hand-keyed; no payroll/gratuity/leave-encashment auto-calc | Incomplete workflow | **Critical** | see Payroll P2; biggest cross-module seam |
| L3 | **Exit interview is a checkbox** — `exit_interview_done` flag only; no questionnaire/response capture | Missing capability | **Medium** | `employee_separation` |
| L4 | **Clearance SLA / escalation** — no deadline on IT/Finance/HR clearances; `remarks` not shown | Incomplete workflow / Data not surfaced | **Medium** | `separation_clearances` |
| L5 | **Rehire-eligibility flag** (block rehire on misconduct) | Missing capability | **Low** | no field/flag |
| L6 | **Family/Nominees have no ESS self-service**; nominee `share_percentage` not validated to 100% per scheme | Missing capability / Incomplete workflow | **Medium** | `employee_nominations`; no scheme-wise summary |
| L7 | **Buddy-facing portal/checklist** — assignment + email shipped, but buddy has no view/tasks | Missing capability | **Low–Medium** | `onboarding_buddy_assets` |
| L8 | **Onboarding funnel + bottleneck analytics** — `onboarding_lifecycle_events` captured, no funnel/TAT/stalled view | Report / Intelligence | **Medium** | invited→submitted→approved→created conversion |
| L9 | **Pre-join: offer-letter view/acceptance + e-signature/NDA** | Missing capability | **Medium** | `PreJoinPortal.tsx` is form+docs only |
| L10 | **Role-based onboarding checklists** (currently tenant-level only) | Missing capability | **Low** | `onboarding_checklist_templates` |
| L11 | **Attrition / flight-risk intelligence**; separation-reason trend & time-to-relieve reports | Intelligence / Report | **Medium** | separation data exists, no analytics |

---

## 3. Attendance

**Existing:** CSV upload + API connector + biometric pipeline (`attendance_devices/raw_logs/daily`); muster roll & override; regularisation queue; shifts/rosters/rotation; OT & comp-off; risk/confidence/health/anomalies intelligence pages; periods lock + audit log; who's-in; forensics timeline.

| # | Gap | Category | Severity | Evidence / Notes |
|---|-----|----------|----------|------------------|
| A1 | **Shift-swap / roster-change requests** — declared in `GovernanceMatrix` dropdown & approval types but no entity, no request/approve UI, no backend | Incomplete workflow / Missing | **High** | `053_approval_workflows.sql` lacks `shift_swap`; no page/route |
| A2 | **Work-session anomalies (11 types) never surfaced** — `work_session_anomalies` computed with severity/metadata, no admin dashboard or employee view | Data not surfaced / Report | **Medium** | `148_attendance_session_intelligence.sql` |
| A3 | **Geo / biometric verification not captured** — no lat/lon, no fingerprint match id, no device-health dashboard | Missing capability | **Medium** | `attendance_raw_logs` lacks geo |
| A4 | **Roster auto-assignment / bulk assign / rotation preview** | Missing capability | **Medium** | manual roster only |
| A5 | **Overtime liability report** — OT accrued/payable per dept/shift; max-consecutive-days breaches | Report | **Medium** | `069_overtime_policy.sql` data, no report |
| A6 | **Correction-abuse & attendance-volatility reports** — `correction_abuse_count`, `attendance_volatility` in risk profiles, not reported | Data not surfaced / Report | **Medium** | `085_attendance_risk_health.sql` |
| A7 | **Upload-session drill-down / replay** — `upload_sessions` summary only; no per-session affected-employee list or recompute | Incomplete workflow / Data not surfaced | **Low–Medium** | `128_upload_sessions.sql` |
| A8 | **Orphan:** `AttendanceCorrections.tsx` is a "coming soon" placeholder with no route | Orphaned page | **Low** | superseded by regularisation; candidate for deletion |
| A9 | **Absenteeism prediction / anomaly root-cause / device-reliability trends** | Intelligence | **Medium** | rich raw material, no models |

---

## 4. Leave

**Existing:** Leave types & policies; accrual rules + ledger + jobs + carry-forward + manual credit + encashment requests; apply/approve; balances (ESS + admin); company/optional holidays; comp-off; collision log; policy engine/simulation; governance; team balances.

| # | Gap | Category | Severity | Evidence / Notes |
|---|-----|----------|----------|------------------|
| LV1 | **Leave encashment at separation not integrated** — `leave_encashment_requests` exists; no auto-calc on exit, no payroll/FNF link | Incomplete workflow | **High** | pairs with L2/P2 |
| LV2 | **Carry-forward expiry not surfaced** — `carry_forward_expiry_months` captured; no employee/manager alert, no "expiring/forfeited" report | Data not surfaced / Report | **Medium** | `072_leave_accrual_encashment.sql` |
| LV3 | **Leave-liability forecasting & utilisation reports** — taken-vs-accrued, dept utilisation, year-end liability | Report / Intelligence | **Medium** | accrual ledger present |
| LV4 | **Event grants not managed in UI** — `leave_event_grants` (marriage/maternity) captured, no admin UI/notification | Data not surfaced | **Low–Medium** | `156_leave_governance.sql` |
| LV5 | **Balance drill-down** — "12 days" not decomposable to accrued+carry-forward; no transaction view from balance card | Data not surfaced | **Low–Medium** | `leave_balance_ledger` |
| LV6 | **Application-window messaging** — `161_..window_governance` enforces windows but ESS doesn't show "apply from X to Y" | Incomplete workflow | **Low** | |
| LV7 | **Team coverage forecast / >X% absent alert**; **leave SLA** (avg approval time, pending >7d) | Report / Intelligence | **Medium** | collision data exists |
| LV8 | **Maternity/paternity/adoption** statutory leave variants & benefit-act tracking | Missing capability | **Medium** | overlaps Compliance C-mat |

---

## 5. Payroll

**Existing:** Runs/console/operations (state machine, blockers, events); components & structures; compensation master + revisions; slips (immutable snapshots, ESS view); validation/reconciliation/governance/approvals/finalization; payout + payout reconciliation; financial ledger & accounting center; cost intelligence/variance/forecast/simulation; reimbursements/loans/advances/variable-pay/arrears; FBP reconciliation; explainability/forensics.

| # | Gap | Category | Severity | Evidence / Notes |
|---|-----|----------|----------|------------------|
| P1 | **Ledger generation 500 (PROD)** — `POST /payroll/runs/:id/ledger` returns `LEDGER_BUILD_FAILED`. Most likely an early hard-return in `buildPayrollFinancialLedger` (`payroll-accounting-engine.ts`): **"No snapshot found"** (snapshot migration **145** / run not finalised-with-snapshot) or "No employee snapshots". GL entry inserts swallow errors, so the 500 is upstream. | Incomplete workflow / Critical risk | **Critical** | needs the live response body to confirm branch; snapshot-missing is the prime suspect |
| P2 | **Full & Final settlement not integrated** — no settlement run; gratuity & leave-encashment not computed/paid via payroll | Missing capability | **Critical** | drives L2 + LV1; no `payroll_separation_settlements` |
| P3 | **Reconciliation gaps** — leave & advance/EMI not reconciled before finalize; can finalize with imbalance | Incomplete workflow | **High** | `reconciliation.ts` = attendance only |
| P4 | **No bank file formats** — payout export is CSV only; no NEFT/RTGS/ISO-20022 / payment-advice | Report / Missing | **High** | `exports.ts` has statutory but no payout file |
| P5 | **Missing standard registers** — payroll register, component-wise register, arrear register, variable-pay register, OT register, loan/advance register | Report | **High** | most are pure data-shaping over existing tables |
| P6 | **Cost-centre allocation captured but not surfaced** — `payroll_cost_allocations` exists; cost intelligence shows dept-level only; GL entries don't split by cost-centre | Data not surfaced / Report | **High** | finance can't allocate cost |
| P7 | **GL account mapping has no UI** — `payroll_gl_mappings` seedable only; can't adapt to chart of accounts | Incomplete workflow | **Medium** | no `/payroll/gl-mappings` CRUD |
| P8 | **Payslip PDF + email distribution** — no PDF endpoint, no send-to-employee | Missing capability | **Medium** | Printer icon is placeholder |
| P9 | **Compensation revision "payroll impact preview"** — `payroll_impact_preview` JSONB never populated; no what-if before approval; no batch revisions | Incomplete workflow | **Medium** | `CompensationRevisions.tsx` |
| P10 | **Variance approval is read-only** — `payroll_variance_approvals` table, no approve/reject route/UI | Incomplete workflow | **Medium** | governance gap |
| P11 | **Advance recovery / variable-pay reconciliation** — schedules captured, not reconciled vs actual deductions; no loan interest/amortisation | Incomplete workflow / Report | **Medium** | dispute risk at FNF |
| P12 | **Off-cycle / bonus run type** & multi-currency | Missing capability | **Medium / Low** | single INR salary run only |
| P13 | **Ledger explainability triggers incomplete** — minor changes (component/deduction/OT) not auto-logged; no forensics export | Data not surfaced | **Low–Medium** | `077_..explainability_ledger.sql` |
| P14 | **Possible orphans (verify):** `StatutoryPolicy.tsx` (no route?), `LoanManagement.tsx` vs `LoansAndAdvances.tsx` (duplicate?) | Orphaned page | **Low** | confirm before action |
| P15 | **Payroll intelligence** — ML cost forecast, anomaly/outlier detection, leakage analysis, comp benchmarking, advance-default risk | Intelligence | **Medium** | basic linear forecast today |

---

## 6. Compliance (Statutory EPF/ESI/PT/LWF/TDS, Tax Governance, Filing, Audit)

**Existing:** EPF/ESI/PT/TDS management + exports (ECR CSV, ESI, PT, TDS snapshot, challan, statutory-reconciliation); filing-pack center; statutory reconciliation; tax governance (declaration window, regime, Form 12BB-style declarations, proof verification queue); IT/YTD statements (ESS); statutory groups + multi-code registrations; generic audit trail (`audit_logs`).

| # | Gap | Category | Severity | Evidence / Notes |
|---|-----|----------|----------|------------------|
| C1 | **Form 16 PDF generation missing** — `it-statement.ts` returns JSON only; employees can't download official Form 16 | Missing capability / Report | **Critical** | bank/loan/ITR need it |
| C2 | **Form 24Q actual filing format missing** — filing-pack shows "24q" artifact but no ITNS-281 / Annexure A-B / quarterly split | Report / Incomplete workflow | **High** | `/payroll/exports/tds` exports snapshot, not 24Q |
| C3 | **LWF monthly export missing** — `lwf_contributions`/`lwf_state_settings` captured, no `/payroll/exports/lwf` | Report | **High** | config-only today |
| C4 | **No compliance deadline calendar / alerts** — no scheduler for EPF/ESI/PT (15th), 24Q (quarterly); HR tracks externally → penalty risk | Intelligence / Missing | **High** | `229`, `232` data; no calendar |
| C5 | **Statutory management is unaudited** — `logAction` absent in EPF/ESI/PT/TDS/LWF management, tax-declaration approvals, filing-pack status (8 of 11 areas) | Incomplete workflow | **High** | only `statutory/governance.ts` logs |
| C6 | **Gratuity & Bonus registers** (eligibility/accrual) absent | Report / Missing | **High** | ties to P2 gratuity |
| C7 | **Challan numbers not tracked** — no `challan_number/date` on filing artifacts | Data not surfaced | **Medium** | filing proof incomplete |
| C8 | **PT slab deletion "coming soon"**; PT per-state wage ceiling / grade differential (e.g. MH) absent | Incomplete workflow / Missing | **Medium** | `PTAXManagement.tsx` toast |
| C9 | **Multi-state mid-year transfer** (PT/ESI state change pro-rata); **ESI partial-month** & high-wage opt-out | Missing capability | **Medium** | manual today |
| C10 | **Form 16-A (deduction proof)**; previous-employer Form 16 auto-reconciliation; regime mid-year switch | Missing capability | **Medium** | data captured, no recompute |
| C11 | **POSH / grievance** — no committee registry, incident workflow, or POSH Act S.12 annual report (only static text + generic helpdesk) | Missing capability / Report | **Medium** | legal obligation |
| C12 | **Labour-law registers** — wages register, state-format muster/leave registers, Shops & Establishment hours | Report | **Medium** | data exists, no statutory format |
| C13 | **Maternity Benefit Act tracking** (eligibility, benefit wage) | Missing capability | **Medium** | overlaps LV8 |
| C14 | **Audit-readiness scoring / compliance complexity matrix / filing-status drill-down** — `compliance_controls` unused for statutory | Intelligence | **Medium** | executive signal |

---

## Consolidated gap register (by severity)

### 🔴 Critical
- **P1** Ledger generation 500 (prod).
- **P2 / L2 / LV1** Separation → Payroll **Full & Final** (gratuity + leave encashment + final dues) auto-computed & paid.
- **C1** Form 16 PDF generation.

### 🟠 High
- **C2** Form 24Q filing format · **C3** LWF export · **C4** compliance deadline calendar/alerts · **C5** statutory audit logging · **C6** gratuity/bonus registers.
- **P3** leave/advance reconciliation before finalize · **P4** bank file formats / payment advice · **P5** standard payroll registers · **P6** cost-centre cost surfacing.
- **W1** ESS profile self-service · **W2** document/contract/identity expiry alerts · **W5/L1** separation state-machine + asset-return gating.
- **A1** shift-swap requests.

### 🟡 Medium
W3, W4, W6, W7, W9, W11 · L3, L4, L6, L8, L9, L11 · A2–A7, A9 · LV2, LV3, LV7, LV8 · P7–P13, P15 · C7–C14.

### 🟢 Low
W8, W10 · L5, L7, L10 · A8 · LV4, LV5, LV6 · P14.

---

## Recommended implementation roadmap (ordered by business value)

> Sizes are rough (S ≤ 2d, M ≈ 3–5d, L ≈ 1–2wk). Migrations called out where needed. Sequenced so dependencies land first.

### Program 1 — Stabilise & unblock (Critical) 🔴
1. **P1 Ledger 500 fix** *(S)* — capture the live error; if "No snapshot found", apply/verify migration **145** and add a clear pre-flight check + actionable error in the Accounting Center. No schema change if it's a data/migration gap.
2. **P2/L2/LV1 Full & Final settlement** *(L, migration)* — settlement run that pulls last-month dues + **gratuity** (tenure × last drawn) + **leave encashment** (from leave ledger) − notice recovery; writes payout + GL; surfaces in SeparationWorkflow. Unlocks three High gaps at once.
3. **C1 Form 16 PDF** *(M)* — server-side PDF from existing `it-statement` data; ESS download + bulk admin generate.

### Program 2 — Statutory exposure (High) 🟠
4. **C5 statutory audit logging** *(S)* — add `logAction` across EPF/ESI/PT/TDS/LWF management, declaration approvals, filing-pack status. Low-risk, high governance value.
5. **C4 compliance deadline calendar + alerts** *(M, migration)* — `compliance_deadlines` + scheduler + dashboard widget + notifications.
6. **C3 LWF export** *(S)* + **C2 Form 24Q** *(M)* + **C6 gratuity/bonus registers** *(M)*.

### Program 3 — Payroll finance completeness (High) 🟠
7. **P5 standard registers** *(M)* — payroll register, component, arrear, variable-pay, OT, loan/advance (mostly shaping existing data; reuse the PAY-09 XLSX pattern).
8. **P4 bank advice / NEFT-RTGS file** *(M)*.
9. **P6 cost-centre cost surfacing** *(S–M)* — expose `payroll_cost_allocations`; add cost-centre dimension to GL entries.
10. **P3 reconciliation gates** *(M)* — block finalize on unreconciled leave/advance beyond threshold.

### Program 4 — Lifecycle & ESS self-service (High→Medium) 🟡
11. **W2 expiry-alert engine** *(M, small migration)* — one scheduler over identity/contract/registration/benefit-window expiries → digest + dashboard. High ROI, broad reuse.
12. **W5/L1 separation state-machine + asset-return gating** *(M)*.
13. **W1 ESS profile self-service + approval** *(L)*; **L6 family/nominees self-service** *(M)*.
14. **A1 shift-swap requests** *(M, migration)* — add entity_type + request/approve UI.

### Program 5 — Surface captured data & reports (Medium) 🟡
15. **A2 work-session anomaly dashboard** · **A5 OT liability** · **A6 correction-abuse** reports.
16. **LV2 carry-forward expiry** · **LV3 leave-liability & utilisation** reports.
17. **L8 onboarding funnel** · **P10 variance approval** · **P9 comp-revision impact preview**.

### Program 6 — Intelligence (Medium, after data exists) 🟡
18. **L11 attrition/flight-risk** · **A9 absenteeism prediction** · **P15 payroll anomaly/leakage/benchmarking** · **C14 audit-readiness scoring**.

### Cleanup (Low) 🟢
19. Verify & remove orphans (**A8** `AttendanceCorrections.tsx`, **P14** `StatutoryPolicy.tsx` / `LoanManagement.tsx`); org-masters discoverability (**W10**).

---

## Recommended first move

If you want maximum risk-reduction-per-day: **Program 1** (ledger 500 → F&F → Form 16). If you want maximum breadth-per-day with near-zero regression risk: start **Program 2 #4 (statutory audit logging)** and **Program 4 #11 (expiry alerts)** — both are additive, reuse existing patterns, and close multiple gaps each.

*Prepared for review. No implementation performed. Awaiting prioritisation before any build program begins.*
