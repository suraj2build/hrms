# Navigation & Information Architecture Audit

**Status:** Audit only — no changes made. For joint review before restructuring.
**Scope:** `apps/web` client navigation across all personas.
**Method:** Source of truth = `App.tsx` (routes), `components/layout/v2/nav-config.ts` (admin nav), `EmployeeSidebar.tsx` (ESS), `ManagerSidebar.tsx` (manager), plus orphan/role analysis.

---

## 0. System facts that frame the whole audit

| Fact | Evidence | Implication |
|---|---|---|
| Only **4 roles** exist: `super_admin`, `hr_admin`, `manager`, `employee` | `rbac`, `types`, `AdminShellV2` | "Executive / CHRO" is **not a real persona** — no role, no shell, no gating. |
| Admin portal gated to `super_admin` + `hr_admin` **only at the shell** | `AdminShellV2.tsx:46,92` | **Zero role differentiation _inside_ admin.** hr_admin sees the exact same 10 domains as super_admin, including platform/SRE consoles. |
| Active admin nav = `nav-config.ts` (`AdminShellV2` → `TopNavV2` + `ContextualSidebar`) | shell imports | `AdminShell.tsx`, `AdminSidebar.tsx`, `navigation.config.ts` are **legacy** (only `navigation.config` still feeds UniversalSearch). |
| 211 page files; ~22 not wired into any route | orphan scan | Significant dead/orphaned surface, several are "architecture concept" pages. |

---

## 1. Current IA Map

### Shells / Portals (personas)
```
/owner/*     OwnerLayout        Platform owner (separate platform admin)
/admin/*     AdminShellV2       super_admin, hr_admin   → 10 domains (nav-config.ts)
/manager/*   ManagerShell       manager (+ admins via RoleSwitcher) → Employee + Manager sections
/ess/*       EssShell           every authenticated user → 5 groups + Manager quick-access
(no shell)   Executive/CHRO     NOT A PERSONA — only a page link inside Admin > Home
```

### Admin portal — 10 domains (nav-config.ts)

| # | Domain | Groups | Item count | Notes |
|---|---|---|---|---|
| 0 | **Home** | Overview, Configuration | 5 | Workforce Command, Control Center, Platform Health, **Executive Intelligence**, Company Settings |
| 1 | Workforce | Employees | 9 | Directory, Ops Center, Docs, Onboarding(+Checklists), Separation, Assets, Letters, Recruitment(Soon) |
| 2 | Attendance | Operations, Scheduling, Analytics & Audit | 15 | Ops Center, Workspace, Punch Intake, Muster(+Upload), Anomalies, Approvals, Periods; Roster, Overrides, Roster Intelligence; Exceptions, Timeline, Who Is In, Audit |
| 3 | Leave | Operations | 10 | Approvals, Balances, Transactions, Comp Off, Overtime, **Engine Status**, Accrual Ledger, **Accrual Engine**, **Collision Log**, Optional Holidays |
| 4 | Payroll | Execution, Processing, Pay Inputs, Analytics & Audit | 24 | Ops Center, Run Console, Runs, Comp Revisions, Forecast, Variance / Validation, Reconciliation, Governance, Approvals, Finalization, Payout, Payout Reconciliation, Accounting / Advances, Reimbursements, FBP, Variable Pay, Loans, Arrears / Forensics, Investigation |
| 5 | Compliance | Overview, Statutory Filings, IT/TDS Governance | 9 | Dashboard; PF/ESI/PT/TDS/LWF/Stat Recon; Tax Governance, Verification Queue |
| 6 | Operations | Queue | 4 | Operations Queue, Daily Operations, Approvals Inbox, Inbox |
| 7 | Reports | Reports | 4 | All Reports, Muster Roll, Cost Intelligence, Payroll Ledger |
| 8 | **Advanced Operations** | Risk & Governance, Simulation & Optimization, Advanced Intelligence, Platform Orchestration | 24 | Mixes user analytics with **SRE/platform consoles** (Observability, Orchestration, Webhooks, Integrations, Incidents, Enterprise Control Center, UAT Certification) |
| 9 | Setup | Organization, Workforce Rules, Leave Config, Payroll Rules, System | 26 | Single source of truth for masters/config (well-disciplined) |

### Manager console (ManagerSidebar)
- **Employee section** (blue) → `/manager/self/*` rendering ESS components in-shell: Dashboard, Attendance, Leave, Pay & Comp, Tax Planner/IT/YTD/TDS, HRA, Prev Employer, Reimbursements, Documents, Policies, HR Support.
- **Manager section** (amber) → `/manager/*`: Team Dashboard, Who Is In, Team Attendance, Approvals, Leave Balances, Performance, Team Reports.

### ESS portal (EmployeeSidebar)
- **Main** → Dashboard
- **Attendance & Leave** → My Attendance, Leave & Comp-Off, Company Holidays, Optional Holidays, Approvals*(mgr)
- **Payroll & Tax** → Pay & Compensation, Tax Planner, IT Statement, YTD, TDS Recovery
- **Declarations & Claims** → HRA, Previous Employer, Reimbursements, Flexible Benefits
- **Documents & Support** → My Documents, Letters, My Team*(mgr), Policies, HR Support, Helpdesk
- **Manager quick-access** (mgr+) → Manager Console, Team Attendance, Approvals, Team Reports

---

## 2. Where architecture concepts leaked into user navigation

This is the central finding. Engine/internal names are surfaced as end-user menu labels.

| Concept | Where it shows in nav | Problem |
|---|---|---|
| **Intelligence** | "Workforce Command", "Intelligence Hub", "Session Intelligence", "Roster Intelligence", "Cost Intelligence", "Org Health", "Executive Intelligence", "Operational Health" — scattered across Home, Attendance, Reports, Advanced Ops | 8+ "intelligence" entries, no single home; users can't tell them apart. |
| **Governance** | "Payroll Governance", "Tax Governance", "Leave Governance", "Governance Matrix", "Event Governance" — across Payroll, Compliance, Setup, Advanced Ops | Same word, 5 meanings, 4 domains. |
| **Executive** | "Executive Intelligence" buried in **Home > Overview** beside operational tools | Implies a C-suite read-only persona that has no role/shell. |
| **Replay** | "Snapshot & Replay Engine" → `PayrollExplainabilityPanel` only at deep link `/admin/payroll/runs/:runId/explain` | Built capability, **no nav entry** — hidden. |
| **Trust** | `pages/trust/TrustWorkspace.tsx` | **Orphaned** — not routed, not in nav. |
| **Fabric** | `pages/fabric/FabricWorkspace.tsx` | **Orphaned** — not routed, not in nav. |
| Forensics / Observability / Orchestration / Confidence / Health Index | Payroll, Attendance, Advanced Ops | Internal engine vocabulary as user labels. |

**Platform/SRE leak:** `Observability Console`, `Orchestration Console`, `Webhooks`, `Integration Registry`, `Incident Manager`, `Event Governance`, `Enterprise Control Center`, `UAT Certification`, `Automations` all sit in **Advanced Operations**, visible to every `hr_admin`. These are platform-engineering surfaces, not HR-user features.

---

## 3. Navigation Debt Report

| # | Debt | Severity | Detail |
|---|---|---|---|
| D1 | No in-portal role gating | **High** | hr_admin == super_admin nav. SRE consoles exposed to HR. |
| D2 | No CHRO/Executive persona | **High** | Exec Intelligence is a buried link, not a curated landing. |
| D3 | Architecture vocabulary in labels | **High** | "Intelligence/Governance/Forensics/Observability" leak (§2). |
| D4 | Too many "home/overview" surfaces | **High** | Control Center, Enterprise Control Center, Workforce Command, Executive Intelligence, Readiness, (orphan) AdminDashboard — 5–6 competing landings. |
| D5 | Engine internals as user items | Med | Leave: "Engine Status", "Accrual Engine", "Collision Log" sit beside "Approvals/Balances". |
| D6 | Payroll domain overload | Med | 24 items, 10+ "Centers" with overlapping scope. |
| D7 | Advanced Operations is a grab-bag | Med | Risk + Simulation + Analytics + SRE in one domain. |
| D8 | Hidden capabilities | Med | Replay/Explainability, Attendance Workspace, Daily Ops reachable only by deep link. |
| D9 | Legacy dead code | Med | `AdminShell` + `AdminSidebar` + `navigation.config.ts` superseded; still compiled, still feeds search. |
| D10 | Orphaned pages | Med | ~22 page files unrouted (§5/§6). |
| D11 | Duplicate routes to one component | Low–Med | See §4. |
| D12 | Internal QA tool in prod nav | Low | "UAT Certification" in Advanced Ops. |

---

## 4. Duplicate Route Report

Routes that resolve to the **same component / page** (multiple access paths):

| Component | Routes | Verdict |
|---|---|---|
| `ApprovalInbox` | `/admin/leave/approvals`, `/admin/approvals/inbox`, `/manager/approvals`, `/ess/approvals` | Intentional per-persona, but 1 component / 4 entries — confirm scoping. |
| `Reports` | `/admin/reports`, `/manager/reports/team`, `/manager/reports/exports` | "team" and "exports" are the same page → collapse. |
| `ShiftRoster` | `/admin/roster`, `/manager/team/roster`, `/manager/team/calendar` | "Team Roster" == "Team Calendar" (same component) → **duplicate**. |
| `CompensationRevisions` | `/admin/payroll/compensation-revisions`, `/admin/payroll/revisions` | Pure alias → drop one. |
| `LeaveAccrualAdmin` | `/admin/leave/accrual`, `/admin/leave/balances` | Same component, two nav labels ("Accrual Engine" + "Leave Balances"). |
| `LeaveAccrualLedger` | `/admin/leave/ledger`, `/admin/leave/transactions` | Same component, two nav labels. |
| `AttendancePolicy` | `/admin/attendance/policy`, `/admin/attendance/groups` | Alias. |
| `WhoIsIn` | `/admin/attendance/who-is-in`, `/manager/team/who-is-in` | Cross-persona reuse. |
| `Attendance Periods` (`/admin/attendance/periods`) | Listed in **Attendance > Operations** AND **Setup > Payroll Rules** | Same route, two nav homes → pick one. |
| `Muster Roll` (`/admin/attendance/muster`) | **Attendance > Operations** AND **Reports** | Same route, two domains. |
| Tax tools (`TaxPlanner/IT/YTD/HRA/...`) | `/ess/salary/*` AND `/manager/self/salary/*` | Same components, doubled for shell consistency. |

---

## 5. Consolidation Candidates

1. **Unify the landing zone.** Collapse Control Center / Enterprise Control Center / Workforce Command / Readiness / Executive Intelligence into **one role-aware home** (HR home vs Exec home vs Super-admin platform home).
2. **One "Insights" area.** Gather all *Intelligence/Analytics/Health/Cost/Org* surfaces under a single curated section with plain-language labels (e.g., "Workforce Insights", "Payroll Insights").
3. **Split "Advanced Operations."** Keep analytics for HR; move **Platform Orchestration** (Observability, Orchestration, Webhooks, Integrations, Incidents, Enterprise CC, Automations, UAT) into a **super-admin-only "Platform"** area.
4. **Tame Payroll.** Group the ~10 "Centers" into a clear **run lifecycle** (Prepare → Validate → Approve → Finalize → Pay → Reconcile → Account) instead of a flat 24-item list.
5. **Hide engine internals.** Leave "Engine Status / Accrual Engine / Collision Log" behind an "Advanced/Engine" disclosure, not in the primary Leave list.
6. **Manager reports + roster/calendar** → single entries.

---

## 6. Removal Candidates

> Verify each is truly unreferenced before deletion — some "orphans" are tab sub-components imported by other pages, not by `App.tsx`.

**Confirmed orphan pages (not routed, not in nav):**
- `pages/trust/TrustWorkspace.tsx` (**Trust**)
- `pages/fabric/FabricWorkspace.tsx` (**Fabric**)
- `pages/governance/GovernanceWorkspace.tsx` (**Governance**)
- `pages/operations/OperationalIntelligenceWorkspace.tsx`
- `pages/intelligence/ExecutiveNarrative.tsx` (imported in `App.tsx` but **no `<Route>`** — dead import)
- `pages/analytics/ExecutiveIntelligence.tsx`
- `pages/dashboard/AdminDashboard.tsx`
- `pages/workspace/WorkforceWorkspace.tsx`, `PayrollWorkspace.tsx`, `OperationsWorkspace.tsx`
- `pages/masters/Rosters.tsx` (superseded by RosterPolicies)
- `pages/ess/TaxDeclarations.tsx`, `EssAttendanceCalendar.tsx`, `EssCompOff.tsx`, `EssRegularization.tsx` (replaced/merged per App comments)
- `pages/attendance/AttendanceCorrections.tsx` (superseded by regularisation)
- `pages/payroll/PayrollOperationsCenter.tsx`, `pages/payroll/StatutoryPolicy.tsx`

**Likely tab sub-components (NOT orphans — keep, verify):**
- `intelligence/Employee360Tab.tsx`, `intelligence/ManagerInsights.tsx`, `intelligence/OnboardingReadiness.tsx`, `attendance/EmployeeDrawer.tsx`, `profile/ManagerProfileView.tsx`

**Legacy code to retire (after migrating UniversalSearch off it):**
- `components/layout/AdminShell.tsx`, `components/layout/AdminSidebar.tsx`, `config/navigation.config.ts`

**Placeholder / internal:**
- "Recruitment" (badge: Soon) — placeholder
- "UAT Certification" — internal QA, remove from production nav

---

## Per-persona evaluation

- **Employee:** Cleanest surface; well-consolidated (merges documented in `App.tsx`). Minor: "Helpdesk" vs "HR Support" overlap.
- **Manager:** Good blue/amber self-vs-team split. Debt: Team Roster == Team Calendar; team vs exports reports duplicate.
- **HR (hr_admin):** Overloaded — 10 domains, ~90 items, engine internals + SRE consoles exposed, no progressive disclosure. Primary pain point.
- **CHRO / Executive:** No real persona. Needs a curated read-only landing, not a buried link.
- **Admin (super_admin):** Platform consoles are appropriate **for this role only** — currently wrongly shared with hr_admin (D1).

---

## Recommended review order (when we restructure)

1. Decide role model: does **hr_admin** need a reduced nav vs **super_admin**? Introduce an **Executive** view?
2. Approve the **architecture-vocabulary → plain-language** label rename map.
3. Approve **landing-zone unification** and **Advanced Ops split**.
4. Approve **removal list** (orphans + legacy) after reference verification.
5. Approve **duplicate-route collapses**.
