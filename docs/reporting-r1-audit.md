# EMVORA Reporting 2.0 — Phase R1: Reporting Audit

> Generated: 2026-06-09  
> Scope: Full codebase + schema audit across 74 tables, 30 existing surfaces, 13 entity domains  
> Status: Design artifact — no code changes included

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Entity domains audited | 13 |
| Database tables | 74 |
| Existing reporting surfaces | 30 |
| Export-capable reports | 9 (all .xlsx, server-generated) |
| Reports with zero export | 21 |
| Confirmed duplicate data paths | 7 |
| Datasets available (logical) | 22 |
| Dimensions catalogued | 24 |
| Measures catalogued | 58 |
| Recommended net-new reports | 18 |

---

## 1. Report Catalog

### 1.1 Operational Reports (Tabular, Exportable)

These read from finalized SSOT data and produce row-level outputs. All 9 currently have `.xlsx` server-generated export via `/reports/*/export`.

| # | Report Name | Domain | Granularity | Key Measures | Filters | Status |
|---|-------------|--------|-------------|--------------|---------|--------|
| R-01 | Headcount & Attrition | Workforce | Employee × Month | Headcount, Joiners, Exits, Attrition % | Date range, Department, Employment Type | **Live** |
| R-02 | Attendance & LOP Summary | Attendance | Employee × Date range | Present, Absent, Late, Half-day, Work Hours, LOP Days | Date range, Employee, Department | **Live** |
| R-03 | Salary Register | Payroll | Employee × Month | CTC Annual/Monthly, Component breakdown | Month, Department | **Live** |
| R-04 | Statutory Compliance Register | Compliance | Employee × Month | PF/ESI/PT/TDS amounts, UANs, PANs | Month, Department | **Live** |
| R-05 | Muster Roll | Attendance | Employee × Day (monthly grid) | Status per day (P/A/L/H/LV/HO/WO), Work Hours | Month | **Live + Export** |
| R-06 | Salary Sheet (Payslip Register) | Payroll | Employee × Month | Gross, Net, Deductions, LOP Amount | Month | **Live + Export** |
| R-07 | Leave Register | Leave | Employee × Request | Leave Type, Days, From/To, Status, Approver | Month, Department | **Stub (backend ready)** |
| R-08 | Payroll Register (Bank Disbursement) | Payroll | Employee × Month | Net Pay, Bank details (masked preview), Payment Status | Month, Department | **Live + Export** |
| R-09 | Attendance vs Payroll Comparison | Cross-module | Employee × Month | Att. payable days, Payroll payable days, Variance, Mismatch flag | Month, Department | **Live + Export** |

**Recommended additions (Operational tier):**

| # | Report Name | Domain | Rationale |
|---|-------------|--------|-----------|
| R-10 | Leave Balance Summary | Leave | Current balances per type per employee — heavily requested, no dedicated report |
| R-11 | Asset Register | Assets | Assigned assets per employee, assignment date, condition |
| R-12 | Compensation Revision History | Payroll | All salary revisions with before/after CTC, effective date, approver |
| R-13 | Advance Salary Tracker | Payroll | Open advances, recovery schedules, outstanding balance |
| R-14 | Reimbursement Claims Register | Payroll | All claims by status, category, amount — missing entirely |
| R-15 | Variable Pay Register | Payroll | Batch payouts, per-employee incentive amounts |
| R-16 | Separation & Exit Report | Workforce | Exit reason, notice period adherence, FnF status |
| R-17 | New Joiner Report | Workforce | Joiners in period, onboarding completeness, confirmation dates |
| R-18 | Document Expiry Alert | Compliance | Passports, visas, contracts expiring within N days |

---

### 1.2 Analytics Dashboards (Visual, Interactive)

These compute derived metrics and trend data. None currently have export capability.

| # | Dashboard | Domain | Key Insights | Status |
|---|-----------|--------|--------------|--------|
| A-01 | Workforce Analytics | Attendance/HR | Absenteeism trend, Leave utilization, Reliability scores, OT distribution | **Live** |
| A-02 | Attendance Intelligence Center | Attendance | Live sessions, Missing punches, Anomalies, OT heatmap, Compliance risks (8 tabs) | **Live** |
| A-03 | Roster Intelligence | Roster/Staffing | Coverage %, Burnout risk, Shift × weekday heatmap, Coverage gaps | **Live** |
| A-04 | Payroll Cost Intelligence | Payroll/Finance | Cost by dept, MOM variance, 6-month trends, Anomaly insights | **Live** |
| A-05 | Statutory Dashboard | Compliance | EPF/ESI/PTax/TDS readiness, Deadline pressure, Coverage gaps | **Live** |
| A-06 | Workforce Intelligence (Risk) | AI/Risk | Risk-ranked employees, Anomaly trends, Flag types by severity | **Live** |
| A-07 | Executive Intelligence (Ops) | Executive | Attendance rate, SLA breaches, Burnout exposure, Staffing sustainability | **Live** |
| A-08 | Operational Intelligence Workspace | Ops/SRE | Domain health scores, SLA tracking, Simulation, Automations, Security log | **Live** |
| A-09 | Payroll Forecast | Payroll | Forward cost projections | **Live (page exists)** |
| A-10 | Payroll Variance Review | Payroll | Month-on-month payroll changes | **Live (page exists)** |

**Recommended additions (Analytics tier):**

| # | Dashboard | Domain | Rationale |
|---|-----------|--------|-----------|
| A-11 | Leave Analytics | Leave | Leave utilization trends, approval SLA, type breakdown, seasonal patterns |
| A-12 | Headcount Analytics | Workforce | Joining/exit funnel, tenure distribution, org pyramid |
| A-13 | Compensation Analytics | Payroll | Salary band distribution, grade vs actual, revision frequency |
| A-14 | Attrition Analytics | Workforce | Attrition by dept/grade/tenure, voluntary vs involuntary, flight-risk score |
| A-15 | Advance & Loan Analytics | Payroll | Outstanding advances, repayment health, delinquency rate |

---

### 1.3 Executive / Strategic (Narrative-first, KPI-driven)

| # | Surface | Domain | Key Content | Status |
|---|---------|--------|-------------|--------|
| E-01 | Executive Intelligence Center | Executive | CEO/CHRO snapshots, Workforce/Financial/Compliance trends (30D/QTD/YTD/12M) | **Live** |
| E-02 | Admin Dashboard (Control Center) | Operations | Operational KPIs, Absent trend, Pending queue, Processing status | **Live** |
| E-03 | Employee Dashboard (ESS) | ESS | Personal KPIs, Attendance, Net pay, Leave balance, Payslip | **Live** |
| E-04 | Manager Dashboard | Team Mgmt | Team attendance heatmap, Who's out, Pending approvals, Team KPIs | **Live** |
| E-05 | Workforce Command (Exec Mode) | Executive | AI narrative, Attention KPIs, Quick-drill entries | **Live** |

---

### 1.4 Intelligence Hubs (Navigation / Discovery)

| # | Surface | Domain | Content | Status |
|---|---------|--------|---------|--------|
| I-01 | Insights Hub | Navigation | Directory of 23+ surfaces organized by category | **Live** |
| I-02 | Manager Insights Panel | Team Intelligence | Team KPI strip + auto-narrative | **Live** |
| I-03 | Platform Readiness Dashboard | Setup | Setup completeness score (0-100), blockers | **Live** |
| I-04 | Onboarding Dashboard | Onboarding | Session pipeline, document status, completeness | **Live** |
| I-05 | Owner Dashboard (SaaS) | Platform Ops | Tenant health, platform stats (super_admin only) | **Live** |

---

## 2. Dataset Catalog

Each logical dataset defines a coherent analytical grain — what one row means — along with its source tables, available joins, and whether it can be filtered/sliced by standard dimensions.

---

### DS-01 · Employee Roster
**Grain:** One row per employee (point-in-time snapshot)  
**Primary table:** `employees`  
**Join tables:** `job_history` (WHERE is_current=true), `employee_personal_info`, `employee_bank_statutory`, `departments`, `designations`, `grades`, `work_locations`, `sites`, `cost_centers`, `employee_compensations` (WHERE is_active=true)  
**Available dimensions:** Department, Location, Grade, Employment Type, Cost Center, Gender, Status, Manager, Nationality, Caste Category, Designation  
**Available measures:** Headcount, CTC Monthly, CTC Annual  
**Notes:** Joining date and status on `employees`; current job attributes on `job_history`; compensation on `employee_compensations`. PAN, bank details on `employee_bank_statutory`.

---

### DS-02 · Employee Job History
**Grain:** One row per job-history record per employee  
**Primary table:** `job_history`  
**Join tables:** `employees`, `departments`, `designations`, `grades`, `work_locations`, `cost_centers`  
**Available dimensions:** All organizational dimensions + Effective Date range  
**Available measures:** Tenure at each position  
**Notes:** Enables historical org-chart queries and promotion/transfer reporting.

---

### DS-03 · Attendance Daily
**Grain:** One row per employee per calendar day  
**Primary table:** `attendance_daily`  
**Join tables:** `employees`, `job_history` (as-of date), `shifts`, `overtime_requests`  
**Available dimensions:** Department, Location, Grade, Employment Type, Shift, Date, Month, Day-of-week  
**Available measures:** Present flag, Absent flag, Work Hours, Late Minutes, Overtime Minutes, LOP flag, Status  
**Notes:** Computed nightly from `attendance_punch_logs` via AttendanceEngine. Corrections and regularisations backfill rows.

---

### DS-04 · Attendance Punch Log
**Grain:** One row per punch event (IN or OUT)  
**Primary table:** `attendance_punch_logs`  
**Join tables:** `employees`  
**Available dimensions:** Employee, Date, Source (device/manual/regularisation), Direction  
**Available measures:** Punch timestamp, Session duration (derived)  
**Notes:** Immutable raw events. Higher granularity than DS-03; used for session-level analysis and explainability.

---

### DS-05 · Leave Requests
**Grain:** One row per leave request  
**Primary table:** `leave_requests`  
**Join tables:** `employees`, `leave_types`, `job_history` (as-of from_date), `approval_instances`, `approval_actions`  
**Available dimensions:** Department, Location, Grade, Leave Type, Status, Approver, Month (of from_date), Quarter  
**Available measures:** Computed Days, Approval TAT (days)  
**Notes:** `leave_applications` is the older model; `leave_requests` is the new manager-approval workflow. Both should be unioned for full history.

---

### DS-06 · Leave Balance
**Grain:** One row per employee per leave type per year  
**Primary table:** `employee_leave_balance`  
**Join tables:** `employees`, `leave_types`, `job_history`  
**Available dimensions:** Department, Location, Grade, Leave Type, Year  
**Available measures:** Balance (days), Opening Balance (derived from ledger)  
**Notes:** Point-in-time snapshot. For historical balance queries, sum `leave_balance_ledger` up to any date.

---

### DS-07 · Leave Balance Ledger
**Grain:** One row per balance transaction (accrual, deduction, encashment, etc.)  
**Primary table:** `leave_balance_ledger`  
**Join tables:** `employees`, `leave_types`  
**Available dimensions:** Transaction Type, Leave Type, Employee, Month, Year  
**Available measures:** Delta, Balance After  
**Notes:** Immutable event log. Supports full audit trail and point-in-time balance reconstruction.

---

### DS-08 · Payroll Slips
**Grain:** One row per employee per payroll run  
**Primary table:** `payroll_slips`  
**Join tables:** `payroll_runs`, `employees`, `job_history` (as-of month)  
**Available dimensions:** Department, Location, Grade, Employment Type, Month, Payroll Run Status  
**Available measures:** Gross Pay, Net Pay, Deductions, LOP Days, LOP Amount, OT Hours, CTC Monthly, TDS Deducted, component_breakdown (JSONB — all earnings/deductions by component code)  
**Notes:** `component_breakdown` JSONB contains the full salary component snapshot. TDS column added in migration 226.

---

### DS-09 · Payroll Runs
**Grain:** One row per payroll run (month-level)  
**Primary table:** `payroll_runs`  
**Available dimensions:** Month, Status, Created By  
**Available measures:** Total Gross, Total Net, Total Deductions, Total LOP Amount, Employee Count  
**Notes:** Summary-level; join to DS-08 for employee-level detail.

---

### DS-10 · Compensation Structures
**Grain:** One row per employee compensation record (effective-dated)  
**Primary table:** `employee_compensations`  
**Join tables:** `salary_structures`, `employee_compensation_components`, `salary_components`, `employees`  
**Available dimensions:** Grade, Department, Structure Name, Employment Type, Effective Date  
**Available measures:** CTC Annual, CTC Monthly (generated), Component amounts  
**Notes:** `is_active=true` gives current compensation; historical records via effective_from/effective_to.

---

### DS-11 · EPF Contributions
**Grain:** One row per employee per contribution month  
**Primary table:** `epf_contributions`  
**Join tables:** `employees`, `epf_eligibility_overrides` (for UAN), `statutory_registrations` (for establishment ID)  
**Available dimensions:** Department, Month, Financial Year  
**Available measures:** PF Wages, Employee Contribution, Employer PF (3.67%), Employer EPS (8.33%), EDLI, Voluntary PF  
**Notes:** No `admin_charges` column (computed externally as 0.5% of PF wages). No `ncp_days` stored.

---

### DS-12 · ESI Contributions
**Grain:** One row per employee per contribution month  
**Primary table:** `esi_contributions`  
**Join tables:** `employees`, `esi_eligibility_timeline`  
**Available dimensions:** Department, Month  
**Available measures:** ESI Wages, Employee Contribution (0.75%), Employer Contribution (3.25%), Total Contribution (generated)  

---

### DS-13 · PTax Contributions
**Grain:** One row per employee per contribution month  
**Primary table:** `ptax_contributions`  
**Join tables:** `employees`, `ptax_slabs`, `ptax_state_config`  
**Available dimensions:** State Code, Month, Financial Year, Gender  
**Available measures:** Gross Salary, PTax Amount  

---

### DS-14 · TDS Projections
**Grain:** One row per employee per month per financial year  
**Primary table:** `tds_monthly_projections`  
**Join tables:** `employees`, `tax_declarations`, `tax_regime_elections`  
**Available dimensions:** Financial Year, Month, Regime (Old/New), Declaration Category  
**Available measures:** Gross Income Projected, Total Deductions Projected, Taxable Income, Tax Liability, TDS This Month, TDS Already Deducted  

---

### DS-15 · Tax Declarations
**Grain:** One row per employee per declaration category per financial year  
**Primary table:** `tax_declarations`  
**Join tables:** `employees`, `declaration_proofs`  
**Available dimensions:** Financial Year, Category (80C/80D/HRA/LTA/etc.), Status, Regime  
**Available measures:** Declared Amount, Approved Amount, Proof Count  

---

### DS-16 · Assets
**Grain:** One row per asset  
**Primary table:** `assets`  
**Join tables:** `employees` (current assignee), `asset_categories`, `sites`  
**Available dimensions:** Category, Status, Location, Department (via assignee's job_history)  
**Available measures:** Asset Count, Assignment Age (days)  
**Notes:** Migration 211 defines assets schema.

---

### DS-17 · Advance Salary
**Grain:** One row per advance request  
**Primary table:** `advance_salary_requests`  
**Join tables:** `advance_recovery_schedules`, `advance_recoveries`, `employees`  
**Available dimensions:** Status, Department, Month (requested/disbursed)  
**Available measures:** Requested Amount, Approved Amount, Outstanding Balance, Recovery Months  

---

### DS-18 · Reimbursement Claims
**Grain:** One row per claim  
**Primary table:** `reimbursement_claims`  
**Join tables:** `reimbursement_categories`, `employees`, `reimbursement_attachments`  
**Available dimensions:** Category Type, Status, Department, Month (expense/claim date)  
**Available measures:** Claimed Amount, Approved Amount, Pending Amount  

---

### DS-19 · Variable Pay
**Grain:** One row per employee per batch  
**Primary table:** `variable_payouts`  
**Join tables:** `variable_payout_batches`, `incentive_templates`, `employees`  
**Available dimensions:** Template Type, Status, Department, Month  
**Available measures:** Payout Amount  

---

### DS-20 · Separation
**Grain:** One row per separated employee  
**Primary table:** `employee_separation`  
**Join tables:** `employees`, `job_history`  
**Available dimensions:** Separation Type, Department, Grade, Last Working Month  
**Available measures:** Notice Period Adherence (days), Tenure at Exit  
**Notes:** Migration 210 defines `separation_lifecycle` with richer status tracking.

---

### DS-21 · Approval Transactions
**Grain:** One row per approval action  
**Primary table:** `approval_actions`  
**Join tables:** `approval_instances`, `employees` (via entity_id), `profiles` (actor)  
**Available dimensions:** Entity Type (leave/correction/regularisation), Action (approved/rejected), Level, Approver  
**Available measures:** Resolution TAT (hours), SLA breach flag  

---

### DS-22 · Workforce Intelligence Flags
**Grain:** One row per active risk flag per employee  
**Primary table:** `employee_risk_flags`  
**Join tables:** `employees`, `job_history`  
**Available dimensions:** Flag Type, Risk Score bucket, Department, Dismissed flag  
**Available measures:** Risk Score, Anomaly Count (from details JSONB)  

---

## 3. Dimension Catalog

Dimensions are attributes used to slice or group measures. All are sourced from existing SSOT tables — no new columns required.

| # | Dimension | Display Label | Source Table | Source Column | Type | Cardinality | Notes |
|---|-----------|---------------|-------------|----------------|------|-------------|-------|
| D-01 | Department | Department | `departments` | `name` | String | Low (~5–50) | Hierarchical (parent_id); support drill-up/down |
| D-02 | Site | Site | `sites` | `name` | String | Low (~1–20) | Physical location with timezone |
| D-03 | Work Location | Work Location | `work_locations` | `name` | String | Low (~1–30) | City/state address detail |
| D-04 | Cost Center | Cost Center | `cost_centers` | `name` | String | Low (~1–30) | Financial allocation code |
| D-05 | Grade | Grade | `grades` | `name` | String | Low (~3–15) | Pay band linked; sortable by `min_salary` |
| D-06 | Employment Type | Employment Type | `job_history` | `employment_type` | Enum | Very low (5) | permanent / contract / intern / probation / consultant |
| D-07 | Manager | Manager | `job_history` | `manager_id → employees.full_name` | String | Medium | Self-join on employees; team roll-up possible |
| D-08 | Gender | Gender | `employee_personal_info` | `gender` | Enum | Very low (3) | male / female / other |
| D-09 | Caste Category | Category | `employee_personal_info` | `caste_category` | Enum | Very low (5) | general / obc / sc / st / ews |
| D-10 | Designation | Designation | `designations` | `name` | String | Medium (~10–100) | Job title; `level` column enables hierarchy |
| D-11 | Employment Status | Status | `employees` | `status` | Enum | Very low (4) | active / inactive / on_notice / separated |
| D-12 | Shift | Shift | `shifts` | `name` | String | Low (~2–10) | Morning / General / Night etc. |
| D-13 | Leave Type | Leave Type | `leave_types` | `name` | String | Low (~3–15) | CL / SL / PL / EL etc. |
| D-14 | Month | Month | Derived | `YYYY-MM` | Date (month) | Medium | From any date column; group by YYYY-MM |
| D-15 | Quarter | Quarter | Derived | `Q1–Q4 (Indian FY)` | Enum | Very low (4) | Apr-Jun=Q1, Jan-Mar=Q4 |
| D-16 | Financial Year | Financial Year | Derived | `YYYY-YY` | String | Low | Indian FY: Apr 1 – Mar 31 |
| D-17 | Tax Regime | Tax Regime | `tax_regime_elections` | `regime` | Enum | Very low (2) | old / new |
| D-18 | Declaration Category | IT Section | `tax_declarations` | `declaration_category` | Enum | Low (15) | 80C / 80D / HRA / LTA etc. |
| D-19 | State Code | State | `ptax_contributions` | `state_code` | String | Low (~5–30) | Indian state code (MH, KA, etc.) |
| D-20 | Separation Type | Exit Type | `employee_separation` | `separation_type` | Enum | Low (6) | resignation / termination / retirement / etc. |
| D-21 | Asset Category | Asset Type | `asset_categories` | `name` | String | Low (~3–15) | Laptop / Phone / Vehicle etc. |
| D-22 | Reimbursement Category | Claim Type | `reimbursement_categories` | `category_type` | Enum | Low (8) | fuel / travel / medical / etc. |
| D-23 | Approval Status | Approval Outcome | `approval_actions` | `action` | Enum | Very low (4) | approved / rejected / escalated / auto_approved |
| D-24 | Risk Flag Type | Risk Type | `employee_risk_flags` | `flag_type` | Enum | Low (6) | chronic_late / high_anomaly_rate / etc. |

---

## 4. Measure Catalog

All measures are computable from existing SSOT columns — no new schema required. Aggregation functions listed assume SQL grouping.

### Workforce Measures

| # | Measure | Formula / Source | Agg | Unit | Datasets |
|---|---------|-----------------|-----|------|---------|
| M-01 | Headcount | `COUNT(DISTINCT employee_id) WHERE status='active'` | SUM | Count | DS-01 |
| M-02 | Joiners | `COUNT(*) WHERE joining_date BETWEEN :from AND :to` | SUM | Count | DS-01 |
| M-03 | Exits | `COUNT(*) WHERE separation.last_working_date BETWEEN :from AND :to` | SUM | Count | DS-20 |
| M-04 | Attrition Rate % | `(Exits / Avg Headcount) × 100` | CALC | % | DS-01, DS-20 |
| M-05 | Net Headcount Change | `Joiners − Exits` | CALC | Count | DS-01, DS-20 |
| M-06 | Avg Tenure | `AVG(current_date - joining_date)` | AVG | Months | DS-01 |
| M-07 | Probation Count | `COUNT(*) WHERE employment_type='probation'` | SUM | Count | DS-01, DS-02 |
| M-08 | Manager Span | `COUNT(direct_reports) per manager` | AVG | Count | DS-01 |
| M-09 | Confirmation Due | `COUNT(*) WHERE confirmation_date <= NOW() + 30d AND status='active'` | SUM | Count | DS-02 |

### Attendance Measures

| # | Measure | Formula / Source | Agg | Unit | Datasets |
|---|---------|-----------------|-----|------|---------|
| M-10 | Present Days | `SUM(CASE WHEN status IN ('present','late','half_day') THEN 1 ELSE 0 END)` | SUM | Days | DS-03 |
| M-11 | Absent Days | `SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END)` | SUM | Days | DS-03 |
| M-12 | Late Arrivals | `COUNT(*) WHERE status='late'` | SUM | Count | DS-03 |
| M-13 | Half Days | `COUNT(*) WHERE status='half_day'` | SUM | Count | DS-03 |
| M-14 | Total Work Hours | `SUM(work_hours)` | SUM | Hours | DS-03 |
| M-15 | Overtime Hours | `SUM(overtime_minutes) / 60` | SUM | Hours | DS-03 |
| M-16 | Late Minutes | `SUM(late_minutes)` | SUM | Minutes | DS-03 |
| M-17 | LOP Days | `SUM(CASE WHEN status='absent' THEN 1 WHEN status='half_day' THEN 0.5 END)` | SUM | Days | DS-03 |
| M-18 | Attendance Rate % | `(Present Days / Working Days) × 100` | CALC | % | DS-03 |
| M-19 | Absence Rate % | `(Absent Days / Working Days) × 100` | CALC | % | DS-03 |
| M-20 | Late Rate % | `(Late Arrivals / Working Days) × 100` | CALC | % | DS-03 |
| M-21 | Reliability Score | `(Present − (Late×0.3) − (Absent×1)) / Total × 100` | CALC | 0–100 | DS-03 |
| M-22 | Avg Daily Work Hours | `AVG(work_hours)` | AVG | Hours | DS-03 |
| M-23 | OT Cost | `SUM(overtime_minutes × hourly_rate × ot_multiplier)` | SUM | ₹ | DS-03, DS-08 |

### Leave Measures

| # | Measure | Formula / Source | Agg | Unit | Datasets |
|---|---------|-----------------|-----|------|---------|
| M-24 | Leave Days Taken | `SUM(computed_days) WHERE status='approved'` | SUM | Days | DS-05 |
| M-25 | Leave Applications Count | `COUNT(*)` | SUM | Count | DS-05 |
| M-26 | Leave Approval Rate % | `COUNT(approved) / COUNT(*) × 100` | CALC | % | DS-05 |
| M-27 | Leave Rejection Rate % | `COUNT(rejected) / COUNT(*) × 100` | CALC | % | DS-05 |
| M-28 | Leave Approval TAT | `AVG(approved_at - created_at)` | AVG | Hours | DS-05, DS-21 |
| M-29 | Leave Balance | `balance` | SUM | Days | DS-06 |
| M-30 | Leave Utilization % | `(Taken / (Balance + Taken)) × 100` | CALC | % | DS-05, DS-06 |
| M-31 | Leave Encashment Amount | `SUM(days × daily_rate)` | SUM | ₹ | DS-07 |
| M-32 | Comp-Off Balance | `SUM(balance) WHERE leave_type.code='CO'` | SUM | Days | DS-06 |

### Payroll Measures

| # | Measure | Formula / Source | Agg | Unit | Datasets |
|---|---------|-----------------|-----|------|---------|
| M-33 | Gross Pay | `SUM(gross_pay)` | SUM | ₹ | DS-08 |
| M-34 | Net Pay | `SUM(net_pay)` | SUM | ₹ | DS-08 |
| M-35 | Total Deductions | `SUM(total_deductions)` | SUM | ₹ | DS-08 |
| M-36 | LOP Amount | `SUM(lop_amount)` | SUM | ₹ | DS-08 |
| M-37 | OT Pay | `SUM(component_breakdown->>'OT')` | SUM | ₹ | DS-08 |
| M-38 | Basic Salary | `SUM(component_breakdown->>'BASIC')` | SUM | ₹ | DS-08 |
| M-39 | HRA | `SUM(component_breakdown->>'HRA')` | SUM | ₹ | DS-08 |
| M-40 | TDS Deducted | `SUM(tds_deducted)` | SUM | ₹ | DS-08 |
| M-41 | CTC Annual | `SUM(ctc_annual)` | SUM | ₹ | DS-10 |
| M-42 | Avg CTC Monthly | `AVG(ctc_monthly)` | AVG | ₹ | DS-10 |
| M-43 | Payroll MOM Variance | `(Current Gross − Prior Gross) / Prior Gross × 100` | CALC | % | DS-09 |
| M-44 | Avg Cost per Employee | `Total Gross / Headcount` | CALC | ₹ | DS-08, DS-01 |

### Statutory Measures

| # | Measure | Formula / Source | Agg | Unit | Datasets |
|---|---------|-----------------|-----|------|---------|
| M-45 | EPF Employee Contribution | `SUM(employee_contribution)` | SUM | ₹ | DS-11 |
| M-46 | EPF Employer PF | `SUM(employer_pf)` | SUM | ₹ | DS-11 |
| M-47 | EPF EPS | `SUM(employer_eps)` | SUM | ₹ | DS-11 |
| M-48 | EDLI Contribution | `SUM(edli_contribution)` | SUM | ₹ | DS-11 |
| M-49 | EPF Admin Charges | `SUM(pf_wages) × 0.005` | CALC | ₹ | DS-11 |
| M-50 | ESI Employee Contribution | `SUM(employee_contribution)` | SUM | ₹ | DS-12 |
| M-51 | ESI Employer Contribution | `SUM(employer_contribution)` | SUM | ₹ | DS-12 |
| M-52 | PTax Amount | `SUM(ptax_amount)` | SUM | ₹ | DS-13 |
| M-53 | TDS Monthly | `SUM(tds_this_month)` | SUM | ₹ | DS-14 |
| M-54 | Total Statutory Outflow | `EPF Total + ESI Total + PTax + TDS` | CALC | ₹ | DS-11–14 |

### Cost & Finance Measures

| # | Measure | Formula / Source | Agg | Unit | Datasets |
|---|---------|-----------------|-----|------|---------|
| M-55 | Total Payroll Cost | `Gross Pay + Employer Contributions` | SUM | ₹ | DS-08, DS-11, DS-12 |
| M-56 | Dept Cost Share % | `Dept Gross / Total Gross × 100` | CALC | % | DS-08 |
| M-57 | Advance Outstanding | `SUM(approved_amount) − SUM(recovered)` | CALC | ₹ | DS-17 |
| M-58 | Reimbursement Pending | `SUM(claimed_amount) WHERE status IN ('submitted','under_review')` | SUM | ₹ | DS-18 |

---

## 5. Duplicate Report Analysis

Seven confirmed overlap clusters were found. Each represents the same data being fetched, computed, or displayed in multiple places without a shared dataset layer.

---

### DUPE-01 · Attendance Daily Data (5 surfaces)

| Surface | File | Data Source | Overlap Type |
|---------|------|-------------|--------------|
| Attendance & LOP Summary | Reports.tsx Tab 2 | `GET /reports/attendance-summary` | Full query |
| Muster Roll | Reports.tsx Tab 5 | `GET /attendance/muster` | Full query |
| Workforce Analytics | WorkforceAnalytics.tsx | `GET /attendance/payroll-summary` | Partial |
| Manager Dashboard | ManagerDashboard.tsx | `GET /attendance/:id` per employee | Per-employee |
| Employee Dashboard | EmployeeDashboard.tsx | `GET /attendance/daily?employee_id` | Per-employee |

**Root cause:** No shared React Query key or dataset layer for `attendance_daily`. Every surface fetches independently.  
**Fix:** Single `useAttendanceDataset(filters)` hook backed by one cache key. Reports tab, analytics, and dashboards all consume this hook.

---

### DUPE-02 · Headcount (3 surfaces)

| Surface | File | Query |
|---------|------|-------|
| Headcount & Attrition Report | Reports.tsx Tab 1 | `GET /reports/headcount` |
| Admin Dashboard | AdminDashboard.tsx | `GET /analytics/dashboard` (includes headcount KPI) |
| Executive Intelligence | ExecutiveIntelligenceCenter.tsx | `GET /executive/workforce` (includes headcount) |

**Fix:** Single `GET /analytics/headcount` endpoint returning the canonical count. Dashboard and executive surfaces call it instead of embedding headcount inside larger payloads.

---

### DUPE-03 · Statutory Employee Data (3 surfaces)

| Surface | File | Query |
|---------|------|-------|
| Statutory Compliance Register | Reports.tsx Tab 4 | `GET /reports/statutory` |
| Statutory Dashboard | StatutoryDashboard.tsx | `GET /payroll/statutory/*` (per module) |
| Filing Pack Readiness | FilingPackCenter.tsx | `GET /payroll/filing-pack/readiness` |

**Fix:** Statutory readiness is computed fresh in three places from the same `epf_contributions`, `esi_contributions`, `ptax_contributions` tables. A single `/payroll/statutory/summary?month=` endpoint powering all three surfaces removes this triplication.

---

### DUPE-04 · Payroll Cost (2 surfaces)

| Surface | File | Query |
|---------|------|-------|
| Payroll Cost Intelligence | PayrollCostIntelligence.tsx | `GET /analytics/payroll/cost` |
| Executive Financial | ExecutiveIntelligenceCenter.tsx | `GET /executive/financial` |

**Fix:** `/executive/financial` re-aggregates `payroll_slips` independently. Should call `/analytics/payroll/cost` and let the executive layer do projection/narrative on top.

---

### DUPE-05 · Employee Salary Components (2 surfaces)

| Surface | File | Query |
|---------|------|-------|
| Salary Register | Reports.tsx Tab 3 | `GET /reports/salary-register` |
| Employee Dashboard (ESS) | EmployeeDashboard.tsx | `GET /employees/:id/full-profile` (includes compensation) |

**Fix:** Low-severity (different granularity: one is aggregate, one is per-employee). Ensure both read from `employee_compensation_components` with identical JOIN logic.

---

### DUPE-06 · Leave Balance (2 surfaces)

| Surface | File | Query |
|---------|------|-------|
| Leave Balances Page | Leave module | `GET /leave/balances` |
| Employee Dashboard (ESS) | EmployeeDashboard.tsx | `GET /leave/balance?employee_id` |

**Fix:** Same table, same RLS filter. Both can use a shared `useLeaveBalance(employeeId?)` hook backed by a single cache key.

---

### DUPE-07 · Risk Score / Anomaly Count (2 surfaces)

| Surface | File | Query |
|---------|------|-------|
| Workforce Intelligence | WorkforceIntelligence.tsx | `GET /intelligence/workforce` |
| Executive Intelligence | ExecutiveIntelligenceCenter.tsx | `GET /executive/compliance` (includes risk counts) |

**Fix:** Risk counts in `/executive/compliance` are re-queried from `employee_risk_flags`. Should delegate to `/intelligence/workforce/summary` and consume the same payload.

---

## Appendix A — Surfaces Without Export Capability

21 of 30 reporting surfaces have no export. Priority candidates for export addition:

| Priority | Surface | Recommended Format |
|----------|---------|-------------------|
| High | Payroll Cost Intelligence | CSV (dept cost breakdown) |
| High | Workforce Analytics | CSV (employee-level reliability scores) |
| High | Leave Analytics (proposed A-11) | CSV / Excel |
| Medium | Attendance Intelligence — Missing Punches tab | CSV |
| Medium | Attendance Intelligence — Compliance Risks tab | CSV |
| Medium | Roster Intelligence | CSV (burnout ranking) |
| Medium | Executive Intelligence Center | PDF executive summary |
| Low | Statutory Dashboard | CSV per module |
| Low | Workforce Intelligence Flags | CSV (risk register) |

---

## Appendix B — Missing Reports (No Current Surface)

The following reportable entities exist in the schema but have zero reporting surface:

| Entity | Tables | Missing Report |
|--------|--------|---------------|
| Reimbursements | `reimbursement_claims`, `reimbursement_categories` | Reimbursement Claims Register (R-14) |
| Variable Pay | `variable_payouts`, `variable_payout_batches` | Variable Pay Register (R-15) |
| Advance Salary | `advance_salary_requests`, `advance_recovery_schedules` | Advance Tracker (R-13) |
| Tax Declarations | `tax_declarations`, `declaration_proofs` | IT Declaration Register |
| Document Expiry | `documents`, `employee_passport_visa` | Expiry Alert Register (R-18) |
| Comp-Off | `leave_requests` WHERE type='comp-off' | Comp-Off Balance Register |
| Policy Evaluation | `policy_evaluation_log` | Leave Policy Audit Trail |
| Audit Log | `audit_logs` | HR Audit Trail Report |
| Separation | `employee_separation` | Attrition & Exit Report (R-16) |
| Leave Accrual | `leave_accrual_runs` | Accrual Run History |
| Job Transfers | `job_history` multi-row | Internal Mobility Report |

---

## Appendix C — Phase Readiness Summary

| Phase | What It Needs From This Audit | Status |
|-------|-------------------------------|--------|
| **R2 — Reporting Hub** | 4 section groupings from Report Catalog §1 | Ready |
| **R3 — Operational Reports** | R-01 through R-18 list + SSOT dataset paths | Ready |
| **R4 — Analytics Studio** | Dataset Catalog (§2) + Dimension Catalog (§3) + Measure Catalog (§4) | Ready |
| **R5 — Data Explorer** | DS-01, DS-03, DS-05, DS-08, DS-16, DS-20 as explorer datasets | Ready |
| **R6 — Executive Analytics** | E-01 through E-05 + Duplicate fixes DUPE-01 to DUPE-07 | Ready |
