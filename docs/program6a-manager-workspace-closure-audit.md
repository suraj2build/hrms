# Program 6A — Manager Workspace Completion · Closure Audit

**Date:** 2026-06-13 · **Status:** ✅ **PROGRAM 6A COMPLETE (P6.0 · P6.1 · P6.2)**
**Branch:** `claude/blissful-ptolemy-8AMQn`
**Principle honoured throughout:** extend the existing manager workspace, readiness
engine, trust engine, Program 3A lifecycle engine, separation workflow and the
inbox/notification system. **No Manager Workspace V2, no Lifecycle Engine V2, no
Approval Engine V2, no Notification Engine V2, no Dashboard V2, no Risk Engine V2.
Zero new tables, zero migrations.**

> Scope guard: Program 6B was **NOT** started. Certification Governance, Reporting,
> Analytics and UI Modernization remain deferred.

---

## 1. Security Fix Report

All four P6.0 fixes are authorization/integrity only — no workflow changed.

| Fix | File | Before | After |
|---|---|---|---|
| **P6.0a** Hierarchy consistency | `attendance/regularisation.ts` | Team queue filtered on `reporting_manager_id` + `employment_status` — **neither column exists** on `employees`, so the manager regularisation queue silently returned **empty for every manager** | Filters on `manager_id` + `status` (the columns defined in `004_employees.sql` and used by every other manager surface) |
| **P6.0b** Overtime scope guard | `attendance/overtime.ts` | Any `manager` role could approve/reject **any** employee's OT across the tenant; list showed all | `authorizeOtTarget()` — a manager may only action OT for a direct report; list scoped to direct reports; **HR admin retains full access** |
| **P6.0c** Comp-off scope guard | `attendance/comp-off.ts` | Any `manager` role could approve/reject **any** employee's comp-off; list showed all | `authorizeCompOffTarget()` — identical guard model as OT; list scoped to direct reports; HR admin full access |
| **P6.0d** Separation clearance | `employees/separation-workflow.ts` | Clearance PATCH was HR-admin-only with **no ownership model** — managers could not submit their own clearance at all | Opened to managers **only** for the `manager` clearance department **and only** for direct reports; every other non-admin caller rejected; HR admin bypass remains |

**Single hierarchy model (P6.0a deliverable):** the org hierarchy is now keyed on
**`employees.manager_id`** with active status from **`employees.status`**,
centralised in **`lib/manager-scope.ts`** (`resolveCallerEmployeeId`,
`resolveManagerEmployeeId`, `getDirectReportIds`, `isDirectReport`, `isHrAdmin`).
`reporting_manager_id` / `employment_status` are documented as non-columns and no
longer referenced in any manager-scoped query. No ambiguity remains.

---

## 2. Lifecycle Workspace Summary (P6.1)

New page **`/manager/team/lifecycle`** (`ManagerTeamLifecycle.tsx`), backed by one
new read endpoint that projects existing engines. Four sections:

1. **Probation & Confirmation** — on-probation list merged with confirmation
   due / overdue (derived from the Program 3A probation risk). Each row carries a
   **"Recommend"** action that raises an inbox item to HR. Managers **cannot
   confirm directly** — the copy states this explicitly.
2. **New Joiners** — joined within 90 days, with **readiness %** + status + pending
   items pulled live from the **Readiness Engine** (`computeReadiness`).
3. **Expiry Risks** — documents / identity / passport / visa / contract, bucketed
   (overdue / 7 / 30 / 90) straight from the **Program 3A lifecycle source**.
4. **Separations** — active notice/LWD/stage, plus an inline **Manager Clearance**
   approve/reject that reuses the existing `PATCH …/separation-clearances/:id`.

A trust-risk banner (high/critical) is surfaced at the top of the workspace.

---

## 3. API Inventory

| Method · Endpoint | Purpose | Access |
|---|---|---|
| `GET /manager/team/lifecycle[?include_readiness=true]` | Probation, new joiners, expiry, separations, trust + rail summary | manager (HR override via `?manager_employee_id`) |
| `POST /manager/team/lifecycle/confirmation-recommend` | Recommend a direct report for confirmation → inbox item to HR | manager (own reports) · HR |

**Modified (guards added, no behaviour change for HR):**

| Method · Endpoint | Change |
|---|---|
| `GET /attendance/regularisation/team` | P6.0a — fixed hierarchy columns |
| `GET · POST /overtime/requests[/:id/approve\|reject]` | P6.0b — direct-report scope guard + scoped list |
| `GET · POST /attendance/comp-off[/:id/approve\|reject]` | P6.0c — direct-report scope guard + scoped list |
| `PATCH /employees/:id/separation-clearances/:clearanceId` | P6.0d — manager direct-report ownership guard |

**Reused as-is (no change):** `GET /manager/dashboard`, `GET /approvals/pending`,
`GET /employees/:id/readiness`, `GET /separations`, `POST /compensation/revisions`,
inbox/notification helpers (`notifyHrAdmins`), the Program 3A
`computeLifecycleRisks`, the Readiness Engine `computeReadiness`.

---

## 4. UI Inventory

| Screen | Change |
|---|---|
| **ManagerTeamLifecycle** (`/manager/team/lifecycle`, new) | Four-section lifecycle workspace + trust banner + recommend/clearance actions |
| **ManagerLifecycleRails** (new component) | Five additive intelligence rails — probation / new joiners / trust / expiry / separation — rendered inside the existing dashboard; renders nothing when all signals are zero |
| **ManagerDashboard** (`/manager/dashboard`) | `<ManagerLifecycleRails />` inserted after `<ManagerInsights />`. **No redesign** — additive only |
| **ManagerSidebar** | "Team Lifecycle" entry added under Manager, between Team Compensation and Leave Balances |
| **App.tsx** | Lazy route `/manager/team/lifecycle` registered |

---

## 5. Reuse Inventory (extended, not built)

| Capability | Existing asset reused | New code |
|---|---|---|
| Manager → direct-report scoping | `employees.manager_id` / `status` | `lib/manager-scope.ts` (one shared helper; replaces ad-hoc duplication) |
| Expiry / probation risk | **Program 3A** `computeLifecycleRisks`, `summariseLifecycle` | filter to team — no expiry logic added |
| New-joiner readiness | **Readiness Engine** `computeReadiness` | per-joiner call inside the lifecycle endpoint |
| Trust risk | `workforce_trust_scores` (Trust Engine output) | team filter + severity sort |
| Separations + clearance | `employee_separation`, `separation_clearances`, existing PATCH | manager clearance reuses the existing endpoint (now guarded) |
| Confirmation recommendation | **inbox/notification** `notifyHrAdmins` | one notify call — no confirmation workflow table |
| Dashboard intelligence | existing Manager Dashboard + `ManagerInsights` pattern | additive `ManagerLifecycleRails` component |

**Net new infrastructure: zero.** No tables, migrations, schedulers, approval
engines, risk engines or notification frameworks.

---

## 6. Validation Report

| Requirement | Result | Evidence |
|---|---|---|
| **Security** OT approval restricted to direct reports | ✅ | `authorizeOtTarget` on approve + reject; list scoped via `getDirectReportIds` |
| **Security** Comp-off approval restricted to direct reports | ✅ | `authorizeCompOffTarget` on approve + reject; list scoped |
| **Security** Separation clearance restricted appropriately | ✅ | Manager limited to `manager` dept + direct report; HR bypass intact |
| **Security** Hierarchy ambiguity removed | ✅ | Single `manager_id`/`status` model in `lib/manager-scope.ts`; regularisation queue now resolves |
| **Lifecycle** Managers can see probation status | ✅ | Probation section (on-probation list from `job_history`) |
| **Lifecycle** Managers can see confirmations due | ✅ | Due/overdue derived from Program 3A probation risk |
| **Lifecycle** Managers can see new joiner readiness | ✅ | Readiness Engine % + status + pending items |
| **Lifecycle** Managers can see separations | ✅ | Separations section, direct reports only |
| **Risk** Managers can see trust risks | ✅ | Trust banner + dashboard rail (high/critical) |
| **Risk** Managers can see expiry risks | ✅ | Expiry section + dashboard rail (docs/contracts/visa) |
| **Dashboard** New intelligence rails render correctly | ✅ | `ManagerLifecycleRails` after `ManagerInsights`; hidden when no signal |
| **Dashboard** No duplicate queries / calculations | ✅ | Workspace + rails share `GET /manager/team/lifecycle` (rails omit readiness); one query key family |
| **Architecture** No new engines / workflows / dashboards | ✅ | All reuse; confirmation = inbox item; clearance = existing PATCH |
| **Program 6B not started** | ✅ | No 6B code |

**Typecheck:** `apps/api` clean (exit 0); `apps/web` clean except the pre-existing
`AdminRecruitmentDashboard.tsx` errors (unrelated, present before this work).
**Tests:** `apps/api` full suite green — 73 passed.

**Honest scope notes (not defects):**
- New-joiner readiness is computed per joiner via the Readiness Engine only when
  `include_readiness=true` (the workspace); the dashboard rails omit it to stay
  light. Same endpoint, single code path.
- Confirmation is a **recommendation** — it raises an HR inbox item; the actual
  confirmation remains an HR job-history action. No confirmation workflow table
  was introduced (none exists, and the constraints forbid creating one).
- Notification generation for due/overdue/expiry runs through the existing inbox
  on the recommend action; a scheduled scanner for these was **not** added (would
  be a new scheduler — out of scope).

---

## 7. Program 6A Closure Audit

| Phase | Status | Notes |
|---|---|---|
| **P6.0a Hierarchy consistency** | ✅ | Single `manager_id`/`status` model; regularisation queue fixed |
| **P6.0b Overtime scope guard** | ✅ | Direct-report guard on write + read; HR bypass intact |
| **P6.0c Comp-off scope guard** | ✅ | Identical guard model as OT |
| **P6.0d Separation clearance guard** | ✅ | Manager dept + direct report only; opens manager clearance action |
| **P6.1 Team Lifecycle Workspace** | ✅ | Probation · new joiners · expiry · separations + clearance |
| **P6.2 Manager Intelligence Layer** | ✅ | Five dashboard rails; additive; hidden when calm |

### Migrations to apply before deploy
- **None.** Program 6A added no tables and no migrations.

**Program 6A is complete and ready for review. Program 6B remains deferred and
must not begin until Program 6A is reviewed and approved.**
