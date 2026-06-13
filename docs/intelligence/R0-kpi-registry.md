# R0 — Canonical KPI Registry

**Status:** Contract (foundational artifact)
**Phase:** R0 — first step of the Workforce Intelligence modernization roadmap
**Purpose:** Define every KPI exactly once — name, formula, dataset, owner, surface, cadence.
This registry is the contract that R1–R5 execute against. No KPI may be computed in a
new surface without a matching entry here. Where two computations disagree today, this
registry declares the **canonical** one; all others must converge to it during R1.

> Grounded in the actual codebase as of this audit. Every formula below is quoted from
> live route logic, not invented. Inconsistencies are recorded verbatim in §4 so R1 has
> an exact convergence target.

---

## 1. How to read this registry

Each KPI has:

- **ID** — stable identifier used across the registry and (eventually) the canonical compute layer.
- **Formula** — the ground-truth computation.
- **Dataset** — source table(s) and the key filters.
- **Window** — time window (TTM, 30d, 90d, MTD, ISO-week, 6-month, point-in-time).
- **Owner** — the single layer responsible for the canonical computation.
- **Canonical Surface** — where the authoritative number is computed/published. All other surfaces *consume*.
- **Consumers** — surfaces permitted to display it (read-only).

**Owner layers** (from the Control Tower blueprint):
`L1 Executive` · `L2 Control Tower` · `L3 Operational Analytics` · `L4 Analytics Studio` · `L5 Data Explorer`

---

## 2. KPI Registry

### 2.1 Workforce Supply

| ID | KPI | Formula (ground truth) | Dataset / Filters | Window | Owner | Canonical Surface |
|----|-----|------------------------|-------------------|--------|-------|-------------------|
| `SUP.headcount.active` | Active Headcount | `COUNT(employees WHERE status='active')` | `employees` · tenant | point-in-time | L1 | Executive Center |
| `SUP.headcount.pit` | Point-in-time Headcount (trend) | `COUNT(emp WHERE joining_date<=month_end AND (exit_date IS NULL OR exit_date>month_end))`; exit_date = `employee_separation.last_working_date` ?? `relieved_at` | `employees` ⨝ `employee_separation` | per-month, 6-month | L1 | Executive Center |
| `SUP.headcount.by_dept` | Headcount by Department | `COUNT(active emp)` grouped by current `job_history.department_id` | `employees` ⨝ `job_history` | point-in-time | L3 | Org Health |
| `SUP.headcount.by_site` | Headcount by Site/Region/Zone | same as `by_dept`, grouped by `employees.site_id → sites` | `employees` ⨝ `sites` | point-in-time | L3 | Org Health *(enabled in R5)* |
| `SUP.joiners` | Joiners (period) | `COUNT(emp WHERE joining_date BETWEEN start AND end)` | `employees` · tenant | MTD / 7d / 30d | L3 | Org Health / Digest |
| `SUP.exits` | Exits (period) | `COUNT(employee_separation WHERE lifecycle_stage IN ('relieved','archived') AND updated_at>=start)` | `employee_separation` | MTD / 7d / 30d | L3 | Org Health / Digest |
| `SUP.net_change` | Net Headcount Change | `joiners − exits` | derived | any period | L3 | Org Health |
| `SUP.hiring_velocity` | Hiring Velocity | funnel: applications→offer→accepted→joined (recruitment module) | `applications` | rolling | L1 *(elevated R10)* | Executive CHRO view |
| `SUP.offer_acceptance` | Offer Acceptance Rate | accepted ÷ offers | `applications` | rolling | L1 *(elevated R10)* | Executive CHRO view |
| `SUP.rehire_rate` | Rehire Rate | `COUNT(invitations WHERE action='rehire') ÷ approvals` | `pre_joinee_invitations` | rolling | L3 | Org Health |
| `SUP.prejoinee_drop` | Pre-Joinee Drop Rate | `1 − (approved ÷ invited)` | `pre_joinee_invitations` | rolling | L3 | Org Health |

### 2.2 Workforce Coverage

| ID | KPI | Formula | Dataset / Filters | Window | Owner | Canonical Surface |
|----|-----|---------|-------------------|--------|-------|-------------------|
| `COV.attendance_rate` | Attendance Rate | `(present+late) ÷ total ×100` | `attendance_daily` · status∈{present,late} | 30d | L3 | Workforce Analytics |
| `COV.absent_rate` | Absenteeism Rate | `(absent+leave) ÷ total ×100` *(see conflict C4)* | `attendance_daily` | ISO-week, 12w | L3 | Workforce Analytics |
| `COV.consistency` | Consistency Score | `total_records ÷ (active_headcount × periodDays) ×100` | `attendance_daily` ⨝ `employees` | 30d | L3 | Workforce Analytics |
| `COV.shift_coverage` | Shift Coverage % | `actual_attendance ÷ planned_headcount` per site/day | **NOT AVAILABLE** — requires R6 | daily | L2 | *(R6)* |
| `COV.understaffed` | Understaffed Sites | `COUNT(site-days WHERE coverage<1)` | `workforce_staffing_snapshots` *(proto)* | daily | L2 | *(R6)* |

### 2.3 Workforce Cost

| ID | KPI | Formula | Dataset / Filters | Window | Owner | Canonical Surface |
|----|-----|---------|-------------------|--------|-------|-------------------|
| `CST.payroll_gross` | Payroll Cost (Gross) | `SUM(payroll_run_employees.gross_pay)` (live) or `SUM(snapshots.total_gross)` | `payroll_run_employees` / `payroll_dept_snapshots` · latest run/month | MTD / 6-month | L1 | Executive Financial |
| `CST.payroll_net` | Payroll Cost (Net) | `SUM(net_pay)` | `payroll_run_employees` | MTD | L1 | Executive Financial |
| `CST.ot_cost` | OT Cost | `SUM(ot_cost)` (column) *(see conflict C3)* | `payroll_run_employees` | MTD | L1 *(elevated R3)* | Executive Financial |
| `CST.ot_dependency` | OT Dependency Rate | `total_ot_cost ÷ total_gross ×100`; flag `>15%` medium, `>25%` high | `payroll_run_employees` | MTD | L1 *(elevated R3)* | Executive Financial |
| `CST.lop` | LOP Deduction | `SUM(lop_deduction)` | `payroll_run_employees` | MTD | L3 | Payroll Ops |
| `CST.avg_cost_pe` | Avg Cost per Employee | `total_gross ÷ headcount` | `payroll_run_employees` | MTD | L1 | Executive Financial |
| `CST.variance` | Payroll Variance (MoM) | `(gross − prior_gross) ÷ prior_gross ×100`; flag `>10%` med, `>20%` high | `payroll_run_employees` / snapshots | MoM | L3 *(elevate summary to L1 in R3)* | Payroll Ops |
| `CST.leave_liability` | Leave Liability | `SUM(balance_days × daily_rate)` | `employee_leave_balance` + comp | point-in-time | L1 *(elevated R3)* | Executive Financial |
| `CST.ff_exposure` | F&F Exposure | `SUM(active separations × est. F&F)` | `employee_separation` | point-in-time | L1 *(elevated R3)* | Executive Financial |
| `CST.forecast_gross` | Payroll Forecast | `base_gross + avg_ot_3m + Σ(pending_revision_delta÷12)`; net = `gross×0.85` | `employee_compensations` + snapshots + revisions | next-month | L3 | Payroll Ops |

### 2.4 Workforce Risk

| ID | KPI | Formula | Dataset / Filters | Window | Owner | Canonical Surface |
|----|-----|---------|-------------------|--------|-------|-------------------|
| `RSK.lifecycle.days_to_due` | Lifecycle days-to-due | `ROUND((due_date − today)/86.4M)` | `lifecycle-expiry.ts` (single source) | point-in-time | L2 | Control Tower |
| `RSK.lifecycle.bucket` | Lifecycle bucket | `<0→overdue · ≤7→due_7 · ≤30→due_30 · else due_90` | lifecycle-expiry | point-in-time | L2 | Control Tower |
| `RSK.lifecycle.severity` | Lifecycle severity | `overdue→critical · due_7→high · due_30→medium · due_90→info` | lifecycle-expiry | point-in-time | L2 | Control Tower |
| `RSK.probation_due` | Probation Due | `joining_date + employment_categories.probation_days`, gated by `is_current ∧ type='probation' ∧ confirmation_date IS NULL` *(see conflict C2)* | `job_history` ⨝ `employment_categories` | point-in-time | L2 | Control Tower |
| `RSK.cert_expiry` | Certification Expiry | `employee_certifications.expiry_date`, status='active' | `employee_certifications` | ≤90d horizon | L2 | Control Tower |
| `RSK.trust` | Trust Risk | document/identity trust score | trust tables | point-in-time | L2 | Risk Posture |
| `RSK.compliance` | Compliance Risk | open compliance exceptions count + ageing | compliance/exception tables | point-in-time | L2 | Risk Posture |
| `RSK.governance` | Governance Risk | policy-conflict signals | governance tables | point-in-time | L2 | Risk Posture |
| `RSK.security` | Security Risk | security event summary | `security_intelligence_events` (org_id) | point-in-time | L2 | Risk Posture |
| `RSK.privacy` | Privacy Risk | PII-access + erasure backlog | privacy tables | point-in-time | L2 | Risk Posture |
| `RSK.posture_index` | **Risk Posture Index** *(NEW — R2)* | weighted composite of the six above | derived | point-in-time | L1 | Executive Center |
| `RSK.attrition_signal` | Attrition Signal | `count(status∈{on_notice,separated}, 90d)` → `≥10 elevated · ≥3 normal · else low` *(see conflict C1)* | `employees` | 90d | L3 | Org Health |
| `RSK.assets_at_risk` | Assets at Risk | assigned assets on active separations | `employee_asset_ledger` ⨝ separation | point-in-time | L2 | Control Tower |
| `RSK.sla_breach` | Exception SLA Breach Rate | `sla_breached ÷ total ×100` | `attendance_exceptions` / `operational_incidents` | period | L3 | Workforce Analytics |

### 2.5 Workforce Productivity (own-data only; external deferred)

| ID | KPI | Formula | Dataset / Filters | Window | Owner | Canonical Surface |
|----|-----|---------|-------------------|--------|-------|-------------------|
| `PRD.reliability` | Reliability Score | `clamp(0,100, 100 − absent_rate×60 − late_rate×20)`; grade A≥90 B≥75 C≥60 D *(see conflict C5)* | `attendance_daily` per emp | period | L3 | Workforce Analytics |
| `PRD.burnout` | Burnout Exposure | `UNION(optimization_hints[overload/ot_conc], emps with work_hours>9 on ≥5 days)` | `workforce_optimization_hints` + `attendance_daily` | MTD | L3 | Workforce Analytics |
| `PRD.probation_conversion` | Probation Conversion | confirmed ÷ probations opened | `job_history` | rolling | L3 | Org Health |
| `PRD.sales_per_employee` | Sales Per Employee | **EXTERNAL — POS/ERP** | n/a | — | — | *Deferred (do not surface)* |
| `PRD.labour_cost_pct` | Labour Cost % of Revenue | **EXTERNAL — POS/ERP** | n/a | — | — | *Deferred (do not surface)* |
| `PRD.rev_per_hour` | Revenue Per Labour Hour | **EXTERNAL — POS/ERP** | n/a | — | — | *Deferred (do not surface)* |

### 2.6 Workforce Planning

| ID | KPI | Formula | Status | Owner | Canonical Surface |
|----|-----|---------|--------|-------|-------------------|
| `PLN.sanction_vs_actual` | Sanction vs Actual | `target_headcount − active_headcount` per site/role | **Requires R7** (position mgmt) | L1 | *(R7)* |
| `PLN.vacancy` | Open Positions / Vacancy Ageing | sanctioned − filled; ageing | **Requires R7** | L1 | *(R7)* |
| `PLN.hiring_forecast` | Hiring Forecast | `attrition_velocity × position_count` (proto from existing data) | partial today | L3 | Org Health |

---

## 3. KPIs to RETIRE (R1 action)

| KPI | Reason |
|-----|--------|
| `Open Positions` (Executive card) | Phantom — no data until R7. Remove. |
| `Time to Hire` (Executive card) | Phantom — not wired. Remove. |
| `Productivity Index` (Executive card) | No data source (needs ERP). Remove. |
| Org Health headcount **trend** | Duplicate of `SUP.headcount.pit`. Consume canonical. |
| Monthly Digest summary | Duplicate of Executive monthly. Retire monthly cadence (keep daily/weekly). |
| 2nd reliability computation | Collapse into `PRD.reliability` (see C5). |

---

## 4. Recorded Conflicts — convergence targets for R1/R8

These are the exact disagreements in the live code. Each names the **canonical winner**.

**C1 — Attrition computed two ways.**
- `/analytics/executive/workforce-stability`: `(separations ÷ active_headcount) ×100` over a date range (a true rate).
- `/intelligence/org/attrition-signal`: counts `status∈{on_notice,separated}` over 90d → categorical signal.
- **Canonical:** the **rate** (`turnover_rate`, TTM) is the headline number owned by L1. The 90d categorical `RSK.attrition_signal` is retained as an *operational signal only* (L3), explicitly labelled, never presented as "attrition %". R1 must ensure both consume one shared separations source.

**C2 — Probation Due defined three ways.**
- `/intelligence/manager-summary`: `joining_date ≤ 90d ago` (crude).
- `/intelligence/executive-narrative`: active + `joining_date ≤ 90d ago` (crude).
- `lifecycle-expiry.ts`: `joining_date + employment_categories.probation_days`, gated by `is_current ∧ type='probation' ∧ confirmation_date IS NULL` (accurate, category-aware).
- **Canonical:** `lifecycle-expiry.ts` (`RSK.probation_due`). The crude 90d versions must be replaced by calls into the lifecycle service. **No hard-coded 90d** anywhere.

**C3 — OT cost sourced two ways.**
- Payroll cost endpoints read `payroll_run_employees.ot_cost` (explicit column).
- `/datasets/payroll-cost` parses `component_breakdown` JSONB for codes `OT|OVERTIME|OT_PAY`.
- **Canonical:** the explicit column `payroll_run_employees.ot_cost` (`CST.ot_cost`). The dataset parser must reconcile to the column; if they ever differ, the column wins.

**C4 — Absenteeism includes/excludes `leave` inconsistently.**
- `workforce/absenteeism` and `reliability-trends`: `(absent+leave) ÷ total`.
- `workforce/summary`: `absent ÷ total` (excludes leave), and reports `on_leave_rate` separately.
- **Canonical:** `COV.absent_rate = (absent+leave) ÷ total` for the headline absenteeism KPI; pure `absent` and `on_leave` remain available as **separate** breakdown metrics, never relabelled as "absenteeism".

**C5 — Reliability computed twice.**
- `/analytics/workforce/reliability`: `100 − absent_rate×60 − late_rate×20`, grades A/B/C/D.
- Attendance Health Index computes an independent reliability number.
- **Canonical:** `PRD.reliability` (the formula above). The Health Index must consume it, not recompute. This is R8.

---

## 5. Headcount filter note (single definition)

`SUP.headcount.active` counts `employees.status='active'` (point-in-time). The trend variant
`SUP.headcount.pit` is occupancy-based (joined ≤ month-end, not yet exited). These are
**intentionally different** and both canonical — but they must never be cross-substituted:
- "Active Headcount" (today) → `SUP.headcount.active`
- "Headcount over time" → `SUP.headcount.pit`

R1 must ensure no surface displays `active` count on a time axis or `pit` count as "today".

---

## 6. Contract rules (binding on R1–R5)

1. **One KPI, one computation.** A KPI may be computed only in its Owner layer's canonical surface. Every other surface consumes the published value.
2. **No new KPI without a registry entry.** Adding a metric to any surface requires a row here first.
3. **No phantom KPIs.** A KPI card may render only if its dataset is live. External-dependency KPIs (§2.5 deferred) must not appear until integrated.
4. **Windows are explicit.** Every displayed KPI states its window. Mixing windows in one comparison is prohibited.
5. **Conflicts resolve toward canonical (§4).** R1/R8 converge all duplicate computations to the declared winner; the loser is deleted, not left dormant.
6. **Site-awareness is additive (R5).** Adding `GROUP BY site_id/region/zone` to an existing KPI does not create a new KPI — it is the same registry entry, disaggregated.

---

*This registry is the R0 deliverable and the contract for all subsequent intelligence
modernization work. Changes to a canonical formula require updating this file first.*
