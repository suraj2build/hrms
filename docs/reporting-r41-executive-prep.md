# R4.1 — Executive Analytics Prep (Reuse Map)

**Status:** Documentation only. No Executive Analytics surfaces are built in this phase.
This maps what the future Executive layer can *reuse* from the canonical platform
delivered in R3.1 → R4, so that when it is built it adds **zero** new metrics and
**zero** new aggregation APIs.

## Guiding rule

Everything an executive surface needs already exists as a **canonical dataset
endpoint** (`/datasets/*`) returning `{ summary, by_group | by_department }`, plus
the **Data Explorer** drill primitives (`filter_*` params, drill-to-employee-list).
Executive Analytics is a *composition / presentation* layer on top — never a new
source of truth.

---

## 1. Canonical building blocks available for reuse

| Dataset endpoint | `summary` totals | Group-by dimensions | Drill filters |
|---|---|---|---|
| `/datasets/headcount` | active, joiners, exits, net_change, attrition_rate | department, location, grade, gender, employment_type, time | department, location, grade, gender |
| `/datasets/payroll-cost` | total_gross, total_net, total_deductions, OT, MoM variance | department, location, grade, designation, time | department, location, grade, designation |
| `/datasets/attendance` | avg_attendance_rate, total_lop_days, absent/present | department (absenteeism_pct) | department |
| `/datasets/employees` | total_headcount, confirmed, probation, new_joiners, avg_tenure | department, location, designation, grade, gender, employment_type | department, location, grade, gender |
| `/datasets/leave` | total_days, requests, avg_days_per_employee | leave_type, department, employment_type | department |
| `/datasets/compensation` | total_ctc, avg_ctc, headcount | department, grade, designation, location | department, location, grade, designation |
| `/datasets/separation` | total_exits, avg_notice_days | exit_type, department, location | department, location |
| `/datasets/assets` | total_assets, total_value, utilisation_pct | status, category | category, status |

Frontend reuse primitives:
- `apps/web/src/lib/analytics/*` — `DATASET_CATALOG`, `resolveQuery(query, drillStack)`, `ChartData`, drill metadata (`DRILL_NEXT`, `DRILL_FILTER_PARAM`).
- `apps/web/src/lib/explorer/*` — `SURFACES`, `resolveExplorer`, `computeStat` (Count/Sum/Average/Median/Percentage), `resolveEmployeeList`, `exportRows`.

---

## 2. Executive surface → reuse plan

### Workforce Command (real-time operating picture)
- **Headcount tile / trend** → `/datasets/headcount` (`summary` + `monthly_trend`).
- **Cost run-rate + MoM** → `/datasets/payroll-cost?include_trends=true` (`mom_variance`, `trends`).
- **Absenteeism hotspots** → `/datasets/attendance` `by_department` sorted by `absenteeism_pct` (already computed in R4).
- **Open exits / notice pipeline** → `/datasets/separation` `summary.avg_notice_days`.
- *No new endpoints.* Compose 4 canonical calls; reuse Analytics `ChartData` shape for the visuals.

### Executive Intelligence (CHRO "why" answers)
- **"Why did payroll cost increase?"** → `/datasets/payroll-cost` `mom_variance` + drill `by_department` → `by_designation` (Explorer drill chain already does this).
- **"Which locations drive compensation growth?"** → `/datasets/compensation?group_by=location` then drill `filter_location_id` → grade.
- Reuse `computeStat` for the headline number; reuse Explorer drill stack to expose the contributing rows.

### Org Health (composite index)
- Inputs are all canonical `summary` fields — attrition_rate (headcount), avg_attendance_rate (attendance), avg_tenure_months (employees), utilisation_pct (assets), avg_days_per_employee (leave).
- The index is a **weighted blend of existing measures** — define weights in a config, do **not** create new measures. Computation is presentation-layer arithmetic over canonical summaries.

### Narratives (auto-generated text)
- Pure presentation: read the same `summary` + top `by_group` rows already fetched for the tiles, and template sentences ("Payroll rose ₹X (+Y%) MoM, driven by <top department>").
- Source the "driver" row from the existing drill output — no extra query.

---

## 3. Explicitly NOT in scope yet (per platform restrictions)

- No AI / natural-language querying.
- No forecasting / predictive measures.
- No report-builder widgets.
- No duplicate metrics or duplicate APIs — every executive number resolves to a
  canonical `/datasets/*` field listed in §1.

---

## 4. Net assessment

The R3.1 → R4 platform is **sufficient** to build all four executive surfaces as a
thin composition layer. The recommended next build order when authorized:
1. Workforce Command (4 canonical calls, highest daily value).
2. Executive Intelligence (reuses Explorer drill verbatim).
3. Org Health index (config-weighted blend of canonical summaries).
4. Narratives (templated text over already-fetched data).
