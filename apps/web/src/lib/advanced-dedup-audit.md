# Advanced Tool De-Duplication Audit
## Phase UX-8 Pre-Work: Complete Operational Surface Cleanup

**Prepared:** 2026-05-20
**Branch:** modernization-v2
**Scope:** All routes and components in `/admin/*` namespace

---

## Executive Summary

This audit catalogues every advanced tool, page, and component in the HRIS platform and enforces single-ownership rules across all operational workflows. The goal is to eliminate competing approval flows, competing queue-like screens, and standalone advanced pages that duplicate primary workspace capabilities.

**Before cleanup:**
- Total routes: ~85
- Operational routes: ~30 (many duplicated)
- Advanced/diagnostic routes: ~35
- Developer/System routes: ~7
- Config/Setup routes: ~13
- Duplicate ownership violations: ~12
- Competing approval flows: 6
- Competing queue-like screens: 9
- Standalone components that duplicate primary workspace panels: 8

**After cleanup:**
- Total routes: ~65 (removed/redirected ~20)
- Operational routes: ~15 (de-duplicated, consolidated)
- Advanced routes: ~25 (all contextual or Command Palette only)
- Developer/System routes: ~7 (unchanged)
- Config/Setup routes: ~18 (absorbed operational config items)
- Duplicate ownership violations: 0
- Competing approval flows: 1 (MyWorkQueue owns all)
- Competing queue-like screens: 1 (MyWorkQueue)

**Pages removed or redirected:** 20
**Standalone components converted to contextual panels:** 11
**Ownership violations resolved:** 12
**Workflows unified under single owner:** 5

---

## Section 1: Classification of Every Advanced Tool

Full classification table covering all 55+ routes and components in the inventory.

| Route/Component | Tool Name | Classification | Primary User | Overlapping Operational Workspace | Owns Workflow? | Owns Approvals? | Owns Queue? |
|---|---|---|---|---|---|---|---|
| `/admin/my-work-queue` | MyWorkQueue | **Operational** (Primary Owner) | HR Admin, Manager | — (this IS the owner) | YES | YES | YES |
| `/admin/payroll/center` | PayrollControlCenter | **Operational** (Primary Owner) | Payroll Admin | — (this IS the owner) | YES | YES (step 4) | NO |
| `/admin/roster` | ShiftRoster | **Operational** (Primary Owner) | Roster Admin | — (this IS the owner) | YES | NO | NO |
| `/admin/employees` | EmployeeList | **Operational** (Primary Owner) | HR Admin | — (this IS the owner) | YES | NO | NO |
| `/admin/employees/:id` | EmployeeProfile | **Operational** (Primary Owner) | HR Admin | — (this IS the owner) | YES | NO | NO |
| `/admin/daily-ops` | DailyOperationsWorkspace | **Operational** — DEPRECATED | HR Admin | MyWorkQueue | YES (VIOLATION) | YES (VIOLATION) | YES (VIOLATION) |
| `/admin/attendance` | Attendance | **Operational** | HR Admin | MyWorkQueue (partial) | YES | NO | NO |
| `/admin/attendance/regularisation` | RegularisationApproval | **Approval** — DUPLICATE | HR Admin | MyWorkQueue needs_review | NO | YES (VIOLATION) | NO |
| `/admin/attendance/corrections` | AttendanceCorrections | **Approval** — DUPLICATE | HR Admin | MyWorkQueue needs_review | NO | YES (VIOLATION) | NO |
| `/admin/attendance/anomalies` | AttendanceAnomalies | **Operational** — DUPLICATE | HR Admin | MyWorkQueue needs_review | NO | NO | YES (VIOLATION) |
| `/admin/attendance/muster` | MusterRoll | **Audit** | HR Admin | None | NO | NO | NO |
| `/admin/attendance/audit` | AttendanceAudit | **Audit** | HR Admin, Auditor | None | NO | NO | NO |
| `/admin/roster-workspace` | RosterWorkspace | **Operational** | Roster Admin | ShiftRoster | YES | NO | NO |
| `/admin/attendance-workspace` | AttendanceWorkspace | **Operational** | HR Admin | Attendance | YES | NO | NO |
| `/admin/attendance/forensics` | AttendanceTimeline | **Replay** | HR Admin, Auditor | MyWorkQueue (contextual) | NO | NO | NO |
| `/admin/attendance/exceptions` | ExceptionGovernance | **Governance** | HR Admin | MyWorkQueue needs_review, PayrollControlCenter | NO | YES (VIOLATION) | NO |
| `/admin/attendance/confidence` | AttendanceConfidence | **Diagnostic** | HR Admin | None | NO | NO | NO |
| `/admin/attendance/risk` | AttendanceRisk | **Diagnostic** | HR Admin, Risk Lead | None | NO | NO | NO |
| `/admin/attendance/health-index` | HealthIndex | **Diagnostic** | HR Admin | None | NO | NO | NO |
| `/admin/attendance/policy-conflicts` | PolicyConflicts | **Diagnostic** | HR Admin, Config Admin | AttendancePolicy | NO | NO | NO |
| `/admin/attendance/simulate-policy` | PolicySimulation | **Simulation** | HR Admin, Config Admin | AttendancePolicy | NO | NO | NO |
| `/admin/attendance/intelligence-center` | AttendanceIntelligenceCenter | **Diagnostic** | HR Admin, Analytics | None | NO | NO | NO |
| `/admin/attendance/upload` | AttendanceUpload | **Operational** | HR Admin | AttendanceWorkspace | NO | NO | NO |
| `/admin/attendance/upload-workspace` | AttendanceUploadWorkspace | **Operational** | HR Admin | AttendanceWorkspace | NO | NO | NO |
| `/admin/attendance/periods` | AttendancePeriods | **Configuration** | Config Admin | None | NO | NO | NO |
| `/admin/attendance/policy` | AttendancePolicy | **Configuration** | Config Admin | None | NO | NO | NO |
| `/admin/attendance/center` | AttendanceOperationsCenter | **Operational** — DUPLICATE | HR Admin | MyWorkQueue | YES (VIOLATION) | YES (VIOLATION) | YES (VIOLATION) |
| `/admin/operational-health` | OperationalHealth | **Diagnostic** | HR Admin, Ops Lead | None | NO | NO | NO |
| `/admin/payroll` | PayrollRuns | **Operational** | Payroll Admin | PayrollControlCenter | NO | NO | NO |
| `/admin/payroll-readiness` | PayrollReadiness | **Operational** | Payroll Admin | PayrollControlCenter | NO | NO | NO |
| `/admin/payroll/compensation-revisions` | CompensationRevisions | **Operational** | Payroll Admin | PayrollControlCenter | NO | NO | NO |
| `/admin/payroll/advances` | AdvanceSalary | **Operational** | Payroll Admin | None | NO | NO | NO |
| `/admin/payroll/reimbursements` | Reimbursements | **Operational** | Payroll Admin | None | NO | NO | NO |
| `/admin/payroll/variable-pay` | VariablePay | **Operational** | Payroll Admin | None | NO | NO | NO |
| `/admin/payroll/loans` | LoanManagement | **Operational** | Payroll Admin | None | NO | NO | NO |
| `/admin/payroll/statutory/*` | EPF / ESI / PTAX / TDS | **Operational** (Regulatory) | Payroll Admin, Compliance | None | YES | NO | NO |
| `(no standalone route)` | PayrollResolutionCenter | **Operational** — DUPLICATE | Payroll Admin | PayrollControlCenter | YES (VIOLATION) | YES (VIOLATION) | NO |
| `(no standalone route)` | PayrollInvestigation | **Replay** / **Diagnostic** | Payroll Admin | PayrollControlCenter | NO | NO | NO |
| `(no standalone route)` | PayrollCostIntelligence | **Diagnostic** | Analytics, CFO | None | NO | NO | NO |
| `(no standalone route)` | PayrollForecast | **Simulation** | Payroll Admin, CFO | None | NO | NO | NO |
| `(no standalone route)` | PayrollSimulation | **Simulation** | Payroll Admin | None | NO | NO | NO |
| `(no standalone route)` | PayrollForensics | **Replay** | Payroll Admin, Auditor | None | NO | NO | NO |
| `(no standalone route)` | PayrollApprovalWorkflow | **Approval** — DUPLICATE | Payroll Admin | PayrollControlCenter step 4 | NO | YES (VIOLATION) | NO |
| `(no standalone route)` | PayrollExplainabilityPanel | **Explainability** | Payroll Admin | PayrollControlCenter | NO | NO | NO |
| `(no standalone route)` | PayrollFinalizationCenter | **Operational** — DUPLICATE | Payroll Admin | PayrollControlCenter step 6 | YES (VIOLATION) | NO | NO |
| `(no standalone route)` | PayrollVarianceCenter | **Diagnostic** — embedded | Payroll Admin | PayrollControlCenter step 5 | NO | NO | NO |
| `(no standalone route)` | StatutoryReconciliationCenter | **Governance** / **Audit** | Payroll Admin, Compliance | None | NO | NO | NO |
| `(no standalone route)` | PayrollPayoutCenter | **Operational** | Payroll Admin | PayrollControlCenter (post-run) | NO | NO | NO |
| `(no standalone route)` | PayrollValidation | **Operational** — embedded | Payroll Admin | PayrollControlCenter step 4 | YES (VIOLATION) | NO | NO |
| `(no standalone route)` | ArrearEngine | **Configuration** | Payroll Admin, Config Admin | None | NO | NO | NO |
| `/admin/analytics/workforce` | WorkforceAnalytics | **Diagnostic** / Analytics | HR Analytics, Director | None | NO | NO | NO |
| `/admin/intelligence` | WorkforceIntelligence | **Diagnostic** / Analytics | HR Analytics, Director | None | NO | NO | NO |
| `/admin/analytics/executive` | ExecutiveIntelligence | **Diagnostic** / Analytics | Executive, Director | None | NO | NO | NO |
| `/admin/workforce/optimization` | WorkforceOptimizationEngine | **Simulation** (has execution — CONVERT) | HR Admin, Ops Lead | MyWorkQueue | NO | NO | NO |
| `/admin/roster/intelligence` | RosterIntelligence | **Diagnostic** | Roster Admin | RosterWorkspace | NO | NO | NO |
| `/admin/roster/simulation` | RosterSimulationCenter | **Simulation** | Roster Admin | RosterWorkspace | NO | NO | NO |
| `/admin/approvals/governance-matrix` | GovernanceMatrix | **Governance** (approval execution — CONVERT) | HR Admin, Compliance | MyWorkQueue, PayrollControlCenter | NO | YES (VIOLATION) | NO |
| `/admin/system/observability` | ObservabilityConsole | **Developer/System** | Engineering, DevOps | None | NO | NO | NO |
| `/admin/system/event-governance` | EventGovernance | **Developer/System** | Engineering | None | NO | NO | NO |
| `/admin/system/orchestration` | OrchestrationConsole | **Developer/System** | Engineering | None | NO | NO | NO |
| `/admin/system/automations` | AutomationsConsole | **Developer/System** | Engineering, Config Admin | None | NO | NO | NO |
| `/admin/system/incidents` | IncidentManagement | **Developer/System** | Engineering, DevOps | None | NO | NO | NO |
| `/admin/system/webhooks` | WebhookManagement | **Developer/System** | Engineering | None | NO | NO | NO |
| `/admin/system/integrations` | IntegrationRegistry | **Developer/System** | Engineering, Config Admin | None | NO | NO | NO |
| `(UX-4 component)` | OperationsTimeline | **Replay** — convert | HR Admin | MyWorkQueue | NO | NO | NO |
| `(UX-4 component)` | WorkforceActivityGraph | **Diagnostic** | HR Analytics | None | NO | NO | NO |
| `(UX-4 component)` | ActivityFeed | **Operational** — DUPLICATE | HR Admin | MyWorkQueue live feed | NO | NO | YES (VIOLATION) |
| `(UX-4 component)` | EmployeeOperationalProfile | **Operational** — DUPLICATE | HR Admin | EmployeeResolutionWorkspace (in MyWorkQueue) | YES (VIOLATION) | NO | NO |
| `(UX-4 component)` | SmartEscalation | **Governance** | HR Admin | MyWorkQueue (queue engine) | NO | NO | NO |
| `(UX-4 component)` | OperationalHeatmap | **Diagnostic** | HR Admin, Analytics | None | NO | NO | NO |
| `(UX-4 component)` | OperationalDigestCards | **Diagnostic** | HR Admin | None | NO | NO | NO |
| `(UX-5 component)` | RecommendationCenter | **Diagnostic** — PARTIAL DUPLICATE | HR Admin | MyWorkQueue SmartQueueRecommendations | NO | NO | NO |
| `(UX-5 component)` | BulkActionPanel | **Operational** — DUPLICATE | HR Admin | MyWorkQueue BulkActionBar | NO | NO | YES (VIOLATION) |
| `(UX-5 component)` | ImpactPreviewDialog | **Diagnostic** | HR Admin | MyWorkQueue bulk action confirm | NO | NO | NO |
| `(UX-5 component)` | OperationalScorecard | **Diagnostic** — DUPLICATE | HR Admin | QueueAnalyticsDashboard | NO | NO | NO |
| `(UX-5 component)` | PredictiveWarningsStrip | **Diagnostic** — DUPLICATE | HR Admin | MyWorkQueue SmartRecommendationChips | NO | NO | NO |
| `(UX-5 component)` | WorkforceOptimizationInsights | **Diagnostic** — DUPLICATE | HR Admin, Analytics | QueueAnalyticsDashboard | NO | NO | NO |
| `/admin/notifications/inbox` | OperationalInbox | **Operational** — PARTIAL DUPLICATE | HR Admin | MyWorkQueue | NO | NO | YES (VIOLATION) |

---

## Section 2: Advanced Duplication Matrix

Every tool classified as Operational or Approval, or any tool that duplicates a primary workspace, is listed here with its full merge recommendation.

| Tool | Overlapping Workspace | Duplicate Capabilities | Actions Duplicated | Merge Recommendation | Keep/Remove | Convert-to-Contextual |
|---|---|---|---|---|---|---|
| `AttendanceOperationsCenter` (`/admin/attendance/center`) | MyWorkQueue | Full queue view, attendance item approval, anomaly triage, bulk approve/reject | Approve, Reject, Bulk action, Queue filter | Redirect `/admin/attendance/center` → `/admin/my-work-queue?section=attendance` | **REMOVE** standalone route | NO — full removal |
| `RegularisationApproval` (`/admin/attendance/regularisation`) | MyWorkQueue `needs_review` section | Regularisation approval list, approve/reject single item, bulk approve | Approve, Reject, Comment, Bulk approve | Redirect to `/admin/my-work-queue?section=needs_review&type=regularisation` | **REMOVE** standalone route | NO — redirect only |
| `AttendanceCorrections` (`/admin/attendance/corrections`) | MyWorkQueue `needs_review` section | Correction request list, approve/reject, edit correction | Approve, Reject, Edit, Bulk approve | Redirect to `/admin/my-work-queue?section=needs_review&type=correction` | **REMOVE** standalone route | NO — redirect only |
| `AttendanceAnomalies` (`/admin/attendance/anomalies`) | MyWorkQueue queue items | Anomaly list, resolve anomaly, assign, snooze | Resolve, Assign, Snooze, Bulk resolve | Redirect to `/admin/my-work-queue?section=anomalies` | **REMOVE** standalone route | NO — redirect only |
| `DailyOperationsWorkspace` (`/admin/daily-ops`) | MyWorkQueue (full replacement) | Queue view, task assignment, approval feed, bulk actions, digest cards | All operational actions | Redirect `/admin/daily-ops` → `/admin/my-work-queue` with deprecation banner | **REMOVE** (DEPRECATED) | NO — full removal |
| `ExceptionGovernance` (`/admin/attendance/exceptions`) | MyWorkQueue `needs_review` + PayrollControlCenter | Exception list, approve exception, reject exception, escalate | Approve, Reject, Escalate, Policy override | Strip approval execution CTAs. Keep exception rule visibility as read-only Governance panel | **CONVERT** | YES — "Exception Details" contextual Sheet in MyWorkQueue item card |
| `PayrollResolutionCenter` | PayrollControlCenter | Blocker resolution, approve payroll, reject payroll, re-trigger run | Approve, Reject, Re-run, Bulk resolve | Embed all resolution actions into PayrollControlCenter step 3 (Blocker Review) | **REMOVE** standalone | YES — absorbed into PayrollControlCenter step 3 |
| `PayrollApprovalWorkflow` | PayrollControlCenter step 4 | Payroll approval routing, approval/rejection, escalation rules | Approve, Reject, Escalate, Add approver | Embed into PayrollControlCenter step 4 as approval sub-step | **REMOVE** standalone | YES — embedded in PayrollControlCenter step 4 |
| `PayrollFinalizationCenter` | PayrollControlCenter step 6 | Final payroll lock, disburse trigger, confirmation | Lock payroll, Trigger disbursal, Confirm | Embed into PayrollControlCenter step 6 as Finalization sub-step | **REMOVE** standalone | YES — embedded in PayrollControlCenter step 6 |
| `PayrollValidation` | PayrollControlCenter step 4 | Validation rule checks, pass/fail list, override | Override validation, Force pass | Embed into PayrollControlCenter step 4 as Validation sub-panel | **REMOVE** standalone | YES — embedded in PayrollControlCenter step 4 |
| `EmployeeOperationalProfile` (UX-4) | EmployeeResolutionWorkspace (Sheet in MyWorkQueue) | 6-tab employee sheet: profile, attendance, leave, payroll, docs, history | Edit profile, Resolve items, Approve leave, Correct attendance | Merge all 6 tabs into EmployeeResolutionWorkspace. Map each tab to existing resolution workspace sections | **REMOVE** standalone usage | YES — fully absorbed into EmployeeResolutionWorkspace |
| `BulkActionPanel` (UX-5) | MyWorkQueue BulkActionBar | Item selection, bulk approve, bulk reject, bulk assign, bulk snooze | Bulk approve, Bulk reject, Bulk assign, Bulk snooze | Replace all `BulkActionPanel` usage with `BulkActionBar` from MyWorkQueue. Delete standalone component | **REMOVE** standalone component | NO — use existing BulkActionBar |
| `ActivityFeed` (UX-4) | MyWorkQueue live feed | Real-time event stream, item click-to-resolve, filter by type | Resolve from feed, Assign from feed | Remove standalone usage. Expose as "Live Feed" toggle mode within MyWorkQueue queue list panel | **CONVERT** | YES — "Live Feed" mode toggle inside MyWorkQueue queue list |
| `OperationsTimeline` (UX-4) | MyWorkQueue item history | Timeline view of item state changes, re-open, re-assign | Re-open, Re-assign | Convert to "View History" contextual Sheet triggered from MyWorkQueue item card footer | **CONVERT** | YES — "View History" Sheet in MyWorkQueue item card |
| `OperationalInbox` (`/admin/notifications/inbox`) | MyWorkQueue (notification triage) | Notification list, mark read, action from notification, bulk dismiss | Action from notification, Bulk dismiss, Archive | Strip action-from-notification execution. Keep as notification history + read/unread state only. Remove queue-triage capabilities | **CONVERT** | YES — pure notification history; action links navigate to MyWorkQueue |
| `PredictiveWarningsStrip` (UX-5) | MyWorkQueue SmartRecommendationChips | Predictive warning banners, dismiss warning, act on warning | Act on warning, Dismiss | Replace all `PredictiveWarningsStrip` usage with `SmartRecommendationChips` in MyWorkQueue. Delete standalone component | **REMOVE** standalone component | NO — use existing SmartRecommendationChips |
| `RecommendationCenter` (UX-5) | MyWorkQueue SmartQueueRecommendations | Intelligence recommendations, accept recommendation, dismiss | Accept recommendation, Dismiss, Bulk accept | Convert to "Intelligence" advanced tab inside QueueAnalyticsDashboard. Remove standalone page | **CONVERT** | YES — "Intelligence" tab in QueueAnalyticsDashboard |
| `GovernanceMatrix` (`/admin/approvals/governance-matrix`) | MyWorkQueue + PayrollControlCenter | Approval routing view, approval execution, role matrix edit | Approve, Edit matrix, Override routing | Remove all approval execution CTAs (Approve/Override buttons). Keep governance trail and matrix view read-only | **CONVERT** | YES — "View Governance Trail" read-only Sheet in PayrollControlCenter footer |
| `WorkforceOptimizationEngine` (`/admin/workforce/optimization`) | MyWorkQueue (queue execution actions) | Optimization recommendations + execution of staffing actions | Reassign, Hire trigger, Shift adjust | Remove execution action buttons. Convert staffing recommendations to read-only recommendation cards surfaced in QueueAnalyticsDashboard | **CONVERT** | YES — "Optimization Insights" collapsible section in QueueAnalyticsDashboard |
| `OperationalScorecard` (UX-5) | QueueAnalyticsDashboard | Operational KPI scorecards, queue health metrics, trend charts | None (display only) | Merge scorecard metrics into QueueAnalyticsDashboard as a summary row. Remove standalone component usage | **REMOVE** standalone | YES — absorbed into QueueAnalyticsDashboard |
| `WorkforceOptimizationInsights` (UX-5) | QueueAnalyticsDashboard | Workforce insight panels, optimization gap charts | None (display only) | Merge insight panels into QueueAnalyticsDashboard "Insights" sub-tab. Remove standalone component | **REMOVE** standalone | YES — absorbed into QueueAnalyticsDashboard Insights tab |
| `ImpactPreviewDialog` (UX-5) | MyWorkQueue bulk action confirm dialog | Impact preview before bulk action, estimated affected count | Confirm bulk action | Replace with existing bulk action confirm dialog in MyWorkQueue which already shows impact preview. Delete standalone component | **REMOVE** standalone | NO — use existing confirm dialog |
| `EssOperationalCenter` (referenced) | EmployeeResolutionWorkspace | ESS request triage, approve ESS items | Approve, Reject ESS requests | Redirect ESS operational triage to MyWorkQueue `needs_review` section with ESS filter | **REMOVE** standalone | NO — redirect only |

---

## Section 3: Single-Ownership Rules Enforcement

### Rule 1 — Attendance Approval Flow

**Owner:** `MyWorkQueue` — sections: `needs_review`, `missing_punches`, `anomalies`

**Former competing entry points (6 identified):**
1. `/admin/attendance/regularisation` → RegularisationApproval — standalone approval list with Approve/Reject
2. `/admin/attendance/corrections` → AttendanceCorrections — standalone correction approval with bulk actions
3. `/admin/attendance/anomalies` → AttendanceAnomalies — standalone anomaly queue with resolve actions
4. `/admin/attendance/center` → AttendanceOperationsCenter — full duplicate queue for attendance
5. `/admin/attendance/exceptions` → ExceptionGovernance — exception approval execution (Approve/Reject exception)
6. `/admin/daily-ops` → DailyOperationsWorkspace — attendance triage section within the deprecated ops workspace

**Resolution:**
- Remove routes `/admin/attendance/regularisation`, `/admin/attendance/corrections`, `/admin/attendance/anomalies`, `/admin/attendance/center`, `/admin/daily-ops`
- All above redirected to `/admin/my-work-queue` with appropriate `?section=` query parameter
- Strip approval execution from ExceptionGovernance; convert to contextual Governance panel
- Add HTTP 301 redirects and in-app redirect banners for each deprecated route for 2-sprint grace period

---

### Rule 2 — OT Approval Flow

**Owner:** `MyWorkQueue` (section: `ot_verification`) as entry point + `PayrollControlCenter` (step 4: OT Validation) as execution owner during payroll run

**Former competing entry points (4 identified):**
1. `/admin/attendance/anomalies` → AttendanceAnomalies — included OT anomaly resolution with approve/override
2. `/admin/attendance/center` → AttendanceOperationsCenter — included OT approval column in operations table
3. `PayrollApprovalWorkflow` — OT approval embedded as pre-run gate separate from PayrollControlCenter step 4
4. `PayrollValidation` standalone — validated OT hours outside of PayrollControlCenter step 4 context

**Resolution:**
- Remove standalone OT approval surfaces from AttendanceAnomalies and AttendanceOperationsCenter (routes removed per Rule 1)
- Embed PayrollApprovalWorkflow OT gate into PayrollControlCenter step 4 (OT Validation sub-panel)
- Remove PayrollValidation standalone; absorbed into PayrollControlCenter step 4
- MyWorkQueue `ot_verification` section becomes sole pre-payroll OT review entry point; clicking an item opens EmployeeResolutionWorkspace with OT tab active

---

### Rule 3 — Payroll Blocker Resolution Flow

**Owner:** `PayrollControlCenter` (primary — 7-step wizard) + `MyWorkQueue` `payroll_blocking` section (discovery entry point only; resolves by navigating to PayrollControlCenter)

**Former competing entry points (5 identified):**
1. `PayrollResolutionCenter` — standalone blocker resolution center with Approve/Reject/Re-run actions
2. `PayrollApprovalWorkflow` — standalone approval routing separate from PayrollControlCenter step 4
3. `PayrollFinalizationCenter` — standalone finalization with Lock/Disburse, duplicating step 6
4. `PayrollValidation` standalone — validation override UI separate from PayrollControlCenter step 4
5. `/admin/payroll-readiness` — PayrollReadiness partially owned blocker pre-checks before payroll run begins

**Resolution:**
- Remove PayrollResolutionCenter; embed its blocker list and resolution actions into PayrollControlCenter step 3 (Blocker Review)
- Remove PayrollApprovalWorkflow standalone; embed into PayrollControlCenter step 4 as approval sub-step
- Remove PayrollFinalizationCenter standalone; its Lock/Disburse actions are PayrollControlCenter step 6
- Remove PayrollValidation standalone; merged into PayrollControlCenter step 4 Validation sub-panel
- Keep `/admin/payroll-readiness` as pre-run readiness check (entry point only; no approval execution)
- MyWorkQueue `payroll_blocking` section shows blockers as queue items; "Resolve" button navigates to PayrollControlCenter at the relevant step

---

### Rule 4 — Employee Operational Resolution Flow

**Owner:** `EmployeeResolutionWorkspace` (Sheet opened from MyWorkQueue item card; also accessible from EmployeeProfile)

**Former competing entry points (4 identified):**
1. `EmployeeOperationalProfile` (UX-4) — 6-tab standalone component with full edit/resolve/approve capabilities, used in multiple pages
2. `EssOperationalCenter` — standalone ESS triage with approve/reject, separate from queue
3. `/admin/attendance/center` → AttendanceOperationsCenter — employee-row-level resolution in attendance ops table
4. `ActivityFeed` (UX-4) — resolve and assign actions triggered directly from feed events without opening EmployeeResolutionWorkspace

**Resolution:**
- Merge all 6 tabs of EmployeeOperationalProfile into EmployeeResolutionWorkspace (Profile, Attendance, Leave, Payroll, Docs, History tabs already map to existing resolution workspace sections)
- Remove all standalone `EmployeeOperationalProfile` component usage across codebase; replace call sites with `EmployeeResolutionWorkspace` Sheet trigger
- Redirect EssOperationalCenter triage to MyWorkQueue `needs_review` section with `?type=ess` filter
- Remove ActivityFeed resolve/assign actions; feed items navigate to EmployeeResolutionWorkspace on click
- AttendanceOperationsCenter removal (per Rule 1) eliminates its employee-row resolution surface

---

### Rule 5 — Payroll Execution Flow

**Owner:** `PayrollControlCenter` (7-step wizard: Pre-flight → Attendance Lock → Blocker Review → OT + Validation → Variance Review → Finalization → Payout)

**Former competing entry points (5 identified):**
1. `PayrollResolutionCenter` — blocker resolution (now step 3 of PayrollControlCenter)
2. `PayrollFinalizationCenter` — finalization and lock (now step 6 of PayrollControlCenter)
3. `PayrollVarianceCenter` — variance review (now step 5 of PayrollControlCenter)
4. `PayrollApprovalWorkflow` — approval routing and execution (now step 4 of PayrollControlCenter)
5. `PayrollValidation` — validation override UI (now embedded in step 4 of PayrollControlCenter)

**Resolution:**
- All five components removed as standalone routes/components
- Each is absorbed into its corresponding PayrollControlCenter wizard step as a sub-panel
- PayrollControlCenter step navigation is the sole sequence for payroll execution
- `PayrollPayoutCenter` remains as post-run operational page (`/admin/payroll/payout`) since it occurs after the 7-step wizard completes — it does not compete with the wizard steps

---

## Section 4: Contextual Conversion Map

Every advanced tool that stays but must be converted from standalone to contextual panel.

| Tool | Current Form | Converted To | Integration Point | New Label | Panel Type |
|---|---|---|---|---|---|
| `AttendanceTimeline` (`/admin/attendance/forensics`) | Standalone page with full timeline replay | Contextual Sheet panel | "Explain This Issue" button on EmployeeResolutionWorkspace Summary tab and MyWorkQueue item card actions menu | "Explain This Issue" | Sheet (60% width, right-side) |
| `ExceptionGovernance` (`/admin/attendance/exceptions`) | Standalone page with exception approval execution | Contextual read-only Governance panel | "Exception Details" button on MyWorkQueue item card for exception-type items | "Exception Details" | Sheet (50% width) |
| `AttendanceConfidence` (`/admin/attendance/confidence`) | Standalone diagnostic page | Inline confidence score chip on queue items + expandable diagnostic Sheet | Confidence chip on every MyWorkQueue attendance item; chip click opens full diagnostic | "Confidence Score" | Chip + Sheet on demand |
| `AttendanceRisk` (`/admin/attendance/risk`) | Standalone diagnostic page | "Risk Assessment" contextual panel | "View Risk" button in MyWorkQueue item actions and EmployeeResolutionWorkspace Attendance tab | "Risk Assessment" | Sheet (50% width) |
| `HealthIndex` (`/admin/attendance/health-index`) | Standalone diagnostic page | Embedded summary metric in QueueAnalyticsDashboard | Health Index score widget in QueueAnalyticsDashboard header row; clicking expands full breakdown | "Health Index" | Inline widget + expandable panel |
| `PolicyConflicts` (`/admin/attendance/policy-conflicts`) | Standalone diagnostic page | Contextual panel in AttendancePolicy config page | "View Conflicts" button in AttendancePolicy config page toolbar | "Policy Conflicts" | Sheet (50% width) |
| `PolicySimulation` (`/admin/attendance/simulate-policy`) | Standalone page | "Simulate This Change" contextual dialog | Triggered only from AttendancePolicy config page save/preview flow; not accessible from nav | "Simulate This Change" | Dialog (full-screen overlay) |
| `AttendanceIntelligenceCenter` (`/admin/attendance/intelligence-center`) | Standalone ML/analytics page | "Intelligence" advanced tab in QueueAnalyticsDashboard | QueueAnalyticsDashboard tab strip — new "Intelligence" tab | "Intelligence" | Tab panel inside QueueAnalyticsDashboard |
| `GovernanceMatrix` (`/admin/approvals/governance-matrix`) | Standalone page with approval execution and matrix editing | Read-only "View Governance Trail" panel | "View Governance Trail" button in PayrollControlCenter footer + MyWorkQueue advanced actions | "Governance Trail" | Sheet (60% width, read-only) |
| `PayrollExplainabilityPanel` | Standalone explainability component | "Why was this calculated?" contextual Sheet | "Explain" button on every PayrollControlCenter line-item and on EmployeeResolutionWorkspace Payroll tab items | "Why This Amount?" | Sheet (50% width) |
| `PayrollInvestigation` | Standalone diagnostic/replay | "Investigate" contextual Sheet | "Investigate" button in PayrollControlCenter step 3 Blocker Review panel and on payroll anomaly queue items in MyWorkQueue | "Investigate" | Sheet (60% width) |
| `PayrollCostIntelligence` | Standalone analytics | "Cost Intelligence" advanced section in ExecutiveIntelligence | Tab panel inside ExecutiveIntelligence page; also available in QueueAnalyticsDashboard "Cost" tab | "Cost Intelligence" | Tab panel |
| `PayrollForecast` | Standalone simulation | "Forecast" contextual panel in PayrollControlCenter pre-flight | "View Forecast" button in PayrollControlCenter step 1 Pre-flight panel | "Payroll Forecast" | Sheet (50% width) |
| `PayrollSimulation` | Standalone simulation | "Simulate" contextual dialog in PayrollControlCenter step 1 | "Run Simulation" button in PayrollControlCenter step 1 Pre-flight panel only | "Simulate Run" | Dialog (full-screen overlay) |
| `PayrollForensics` | Standalone replay | "Forensics" contextual Sheet in PayrollControlCenter | "View Forensics" in PayrollControlCenter run history row actions + post-run summary footer | "Run Forensics" | Sheet (60% width) |
| `StatutoryReconciliationCenter` | Standalone governance/audit | "Reconciliation" tab in statutory routes (`/admin/payroll/statutory/*`) | Tab panel within EPF/ESI/PTAX/TDS pages as a "Reconciliation" tab | "Reconciliation" | Tab panel inside statutory pages |
| `WorkforceOptimizationEngine` (`/admin/workforce/optimization`) | Standalone page with execution actions | "Optimization Insights" collapsible section (read-only recommendations) | Collapsible section in QueueAnalyticsDashboard after removing execution action buttons | "Optimization Insights" | Collapsible section |
| `RosterSimulationCenter` (`/admin/roster/simulation`) | Standalone simulation page | "Simulate Roster" contextual dialog | "Simulate" button in RosterWorkspace toolbar only; not accessible from nav directly | "Simulate Roster" | Dialog (full-screen overlay) |
| `RosterIntelligence` (`/admin/roster/intelligence`) | Standalone diagnostic page | "Intelligence" tab in RosterWorkspace | Tab strip in RosterWorkspace — new "Intelligence" tab showing diagnostic metrics | "Intelligence" | Tab panel inside RosterWorkspace |
| `OperationsTimeline` (UX-4) | Standalone timeline component used in multiple pages | "View History" contextual Sheet | "View History" in MyWorkQueue item card footer actions | "View History" | Sheet (50% width) |
| `ActivityFeed` (UX-4) | Standalone real-time feed component | "Live Feed" mode toggle inside MyWorkQueue queue list panel | Toggle button "List / Live Feed" in MyWorkQueue queue list header | "Live Feed" | Mode toggle within MyWorkQueue |
| `RecommendationCenter` (UX-5) | Standalone intelligence workspace | "Intelligence" tab in QueueAnalyticsDashboard | QueueAnalyticsDashboard tab strip — "Intelligence" tab (merged with AttendanceIntelligenceCenter recommendations) | "Intelligence" | Tab panel inside QueueAnalyticsDashboard |
| `OperationalHealth` (`/admin/operational-health`) | Standalone diagnostic page | Command Palette only + "System Health" widget in QueueAnalyticsDashboard | Accessible via Cmd+K "System Health"; health score badge in QueueAnalyticsDashboard header | "System Health" | Command Palette + inline widget |
| `OperationalInbox` (`/admin/notifications/inbox`) | Standalone operational inbox with action execution | Notification history only; action links navigate to MyWorkQueue | Notification bell dropdown remains; standalone route becomes read-only notification log | "Notification History" | Standalone page (read-only, no execution) |
| `SmartEscalation` (UX-4) | Standalone escalation rule component | "Escalation Rules" read-only panel in GovernanceMatrix view | Shown inside GovernanceMatrix read-only Sheet; no mutation outside of Configuration domain | "Escalation Rules" | Panel inside GovernanceMatrix Sheet |

---

## Section 5: Pages Removed / Routes Deprecated

| Route | Component | Status | Redirect To | Reason |
|---|---|---|---|---|
| `/admin/daily-ops` | DailyOperationsWorkspace | **DEPRECATED → REMOVE** | `/admin/my-work-queue` | Fully superseded by queue-first UX in MyWorkQueue; DailyOperationsWorkspace is a pre-modernization artifact |
| `/admin/attendance/center` | AttendanceOperationsCenter | **REMOVE** | `/admin/my-work-queue?section=attendance` | Complete duplicate queue with approve/reject/bulk actions already owned by MyWorkQueue |
| `/admin/attendance/regularisation` | RegularisationApproval | **REMOVE** | `/admin/my-work-queue?section=needs_review&type=regularisation` | Duplicate approval flow; MyWorkQueue `needs_review` owns regularisation approval |
| `/admin/attendance/corrections` | AttendanceCorrections | **REMOVE** | `/admin/my-work-queue?section=needs_review&type=correction` | Duplicate approval flow; MyWorkQueue `needs_review` owns correction approval |
| `/admin/attendance/anomalies` | AttendanceAnomalies | **REMOVE** | `/admin/my-work-queue?section=anomalies` | Duplicate queue with resolve/assign actions; MyWorkQueue `anomalies` section owns this |
| `(no route — component)` | PayrollResolutionCenter | **REMOVE** standalone usage | PayrollControlCenter step 3 (Blocker Review) | Duplicate blocker resolution; now embedded in PayrollControlCenter wizard step 3 |
| `(no route — component)` | PayrollApprovalWorkflow | **REMOVE** standalone usage | PayrollControlCenter step 4 (OT + Validation + Approval) | Duplicate approval execution; embedded in PayrollControlCenter step 4 |
| `(no route — component)` | PayrollFinalizationCenter | **REMOVE** standalone usage | PayrollControlCenter step 6 (Finalization) | Duplicate finalization; now embedded in PayrollControlCenter wizard step 6 |
| `(no route — component)` | PayrollValidation | **REMOVE** standalone usage | PayrollControlCenter step 4 sub-panel | Duplicate validation override; embedded in PayrollControlCenter step 4 |
| `(no route — component)` | EmployeeOperationalProfile | **REMOVE** standalone usage | EmployeeResolutionWorkspace (Sheet in MyWorkQueue) | Complete 6-tab duplicate of EmployeeResolutionWorkspace; tabs merged in |
| `(no route — component)` | BulkActionPanel (UX-5) | **REMOVE** component | MyWorkQueue BulkActionBar | Exact duplicate of BulkActionBar; all call sites updated to use BulkActionBar |
| `(no route — component)` | ImpactPreviewDialog (UX-5) | **REMOVE** component | MyWorkQueue bulk action confirm dialog | Duplicate of existing confirm dialog which already shows impact preview |
| `(no route — component)` | PredictiveWarningsStrip (UX-5) | **REMOVE** component | MyWorkQueue SmartRecommendationChips | Duplicate of SmartRecommendationChips; all call sites updated |
| `(no route — component)` | OperationalScorecard (UX-5) | **REMOVE** standalone usage | QueueAnalyticsDashboard summary row | Scorecard metrics absorbed into QueueAnalyticsDashboard header; no standalone usage |
| `(no route — component)` | WorkforceOptimizationInsights (UX-5) | **REMOVE** standalone usage | QueueAnalyticsDashboard "Insights" sub-tab | Insight panels absorbed into QueueAnalyticsDashboard Insights tab |
| `/admin/workforce/optimization` | WorkforceOptimizationEngine | **CONVERT route** | Execution buttons removed; page becomes read-only recommendations | Page stays but execution action buttons (`Reassign`, `Hire trigger`, `Shift adjust`) are removed; page accessible via Command Palette only |
| `/admin/approvals/governance-matrix` | GovernanceMatrix | **CONVERT route** | Approval execution removed; route stays as read-only governance view | Remove `Approve`, `Override`, `Edit matrix` CTAs; route retained for governance trail viewing only |
| `(no route — component)` | ActivityFeed standalone usage | **CONVERT component** | MyWorkQueue "Live Feed" mode toggle | Standalone ActivityFeed component usage removed; functionality moved inside MyWorkQueue as a view mode |
| `EssOperationalCenter` (referenced) | EssOperationalCenter | **REMOVE** standalone | `/admin/my-work-queue?section=needs_review&type=ess` | Duplicate approval triage; MyWorkQueue `needs_review` with ESS filter owns this |
| `/admin/workforce/center` (if exists) | WorkforceOperationsCenter | **REMOVE** | `/admin/employees` | Duplicate employee operations hub; EmployeeList owns employee management |

---

## Section 6: Final Advanced Tool Rules

```
ADVANCED TOOL RULES — IMMUTABLE
================================

Advanced tools CANNOT:
  ✗ Own approval workflows
      (violation examples removed: RegularisationApproval, ExceptionGovernance, GovernanceMatrix,
       PayrollApprovalWorkflow, AttendanceCorrections)
  ✗ Own queue items or sections
      (violation examples removed: AttendanceOperationsCenter, ActivityFeed standalone,
       AttendanceAnomalies, BulkActionPanel standalone, OperationalInbox queue triage)
  ✗ Own payroll execution steps
      (violation examples removed: PayrollResolutionCenter, PayrollFinalizationCenter,
       PayrollValidation standalone, PayrollApprovalWorkflow)
  ✗ Own employee resolution flows
      (violation examples removed: EmployeeOperationalProfile standalone,
       EssOperationalCenter)
  ✗ Duplicate primary workspace actions
      (violation examples removed: DailyOperationsWorkspace, AttendanceOperationsCenter,
       PredictiveWarningsStrip, OperationalScorecard)
  ✗ Have "Approve / Reject / Run / Lock / Disburse" primary CTAs
  ✗ Accept bulk item selection and execute bulk mutations
  ✗ Be the primary navigation entry point for any operational task
  ✗ Trigger state changes in production payroll, attendance records, or employee data
      (exceptions: Configuration tools, Developer/System tools — see below)

Advanced tools MAY:
  ✓ Explain WHY an issue occurred (Explainability)
      Examples: PayrollExplainabilityPanel ("Why This Amount?"), AttendanceConfidence chip
  ✓ Show historical patterns and audit trails (Audit/Replay)
      Examples: MusterRoll, AttendanceAudit, AttendanceTimeline ("Explain This Issue"),
                PayrollForensics ("Run Forensics"), OperationsTimeline ("View History")
  ✓ Model hypothetical scenarios without production mutations (Simulation)
      Examples: PolicySimulation ("Simulate This Change" — config page only),
                RosterSimulationCenter ("Simulate Roster" — RosterWorkspace only),
                PayrollSimulation ("Simulate Run" — PayrollControlCenter step 1 only),
                PayrollForecast ("Payroll Forecast" — PayrollControlCenter step 1 only)
  ✓ Display diagnostic metrics and scoring (Diagnostic)
      Examples: AttendanceRisk, HealthIndex, AttendanceIntelligenceCenter,
                WorkforceAnalytics, WorkforceIntelligence, ExecutiveIntelligence,
                RosterIntelligence, OperationalHealth
  ✓ Show compliance trail and policy visibility read-only (Governance)
      Examples: GovernanceMatrix (read-only after conversion), ExceptionGovernance (read-only),
                StatutoryReconciliationCenter, SmartEscalation
  ✓ Configure system behavior and master data (Configuration)
      Examples: AttendancePeriods, AttendancePolicy, ArrearEngine — these MAY mutate
                config/setup data but CANNOT mutate operational records
  ✓ Expose engineering telemetry and system infrastructure (Developer/System)
      Examples: ObservabilityConsole, EventGovernance, OrchestrationConsole,
                AutomationsConsole, IncidentManagement, WebhookManagement, IntegrationRegistry
      These MAY execute system actions (restart job, acknowledge incident) within their domain
  ✓ Surface in contextual panels triggered FROM primary workspaces
  ✓ Be opened via "Explain" / "Diagnose" / "Audit" / "Investigate" / "Simulate" buttons
      in primary workspaces — never via top-level nav
  ✓ Be accessed via Command Palette only (for low-frequency, power-user tools)
  ✓ Read operational data for display/analysis purposes

INTEGRATION PATTERN (mandatory for all advanced tools):
  1. Advanced panel is triggered BY a primary workspace action (button, chip, menu item)
  2. Advanced panel renders as Sheet (right-side drawer) or Dialog (full-screen overlay)
  3. Advanced panel has NO standalone navigation item in primary sidebar or top nav
     (exception: Developer/System tools may have a dedicated "System" nav section)
  4. Advanced panel CANNOT mutate operational state
     (exceptions: Configuration domain, Developer/System domain)
  5. Advanced panel "Close" / "Done" returns user to primary workspace — no dead ends
  6. Advanced panel may be bookmarked/deep-linked for power users via Command Palette

COMMAND PALETTE RULE:
  Any advanced tool reachable only via Cmd+K must display the tag [ADVANCED] in palette results
  Command Palette is NOT a backdoor to operational execution — palette results obey same rules
```

---

## Section 7: Simplified Advanced Navigation

### Command Palette only (no nav items)

These tools are low-frequency, power-user tools that should not occupy nav space. Accessible exclusively via Cmd+K:

- `AttendanceTimeline` — search "Explain attendance issue" or "Attendance forensics"
- `AttendanceRisk` — search "Attendance risk" or "Risk assessment"
- `HealthIndex` — search "Attendance health" or "Health index"
- `PolicyConflicts` — search "Policy conflicts" or "Config diagnostic"
- `PayrollInvestigation` — search "Investigate payroll" or "Payroll diagnostic"
- `PayrollCostIntelligence` — search "Payroll cost intelligence" or "Cost analysis"
- `PayrollForensics` — search "Payroll forensics" or "Run history"
- `StatutoryReconciliationCenter` — search "Statutory reconciliation" or "EPF reconciliation"
- `WorkforceOptimizationEngine` (read-only mode) — search "Workforce optimization" or "Staffing recommendations"
- `OperationalHealth` — search "System health" or "Operational health"
- `WorkforceIntelligence` — search "Workforce intelligence" or "HR intelligence"
- `AttendanceIntelligenceCenter` — search "Attendance intelligence" or "ML attendance"
- `GovernanceMatrix` (read-only) — search "Governance matrix" or "Approval routing"

### Advanced tab or contextual button inside primary workspaces

These tools live as tabs, buttons, or expandable sections within primary workspaces — no standalone nav:

**Inside MyWorkQueue:**
- "Live Feed" toggle — replaces standalone ActivityFeed
- "View History" Sheet on item card — replaces standalone OperationsTimeline
- "Exception Details" Sheet on exception-type items — replaces ExceptionGovernance execution
- "Confidence Score" chip on attendance items (click → AttendanceConfidence Sheet)
- SmartRecommendationChips — replaces PredictiveWarningsStrip
- QueueAnalyticsDashboard "Intelligence" tab — replaces RecommendationCenter + AttendanceIntelligenceCenter
- QueueAnalyticsDashboard "Optimization Insights" section — replaces WorkforceOptimizationInsights

**Inside PayrollControlCenter:**
- "Explain" button on every line item → PayrollExplainabilityPanel Sheet ("Why This Amount?")
- "Simulate Run" in step 1 Pre-flight → PayrollSimulation dialog
- "View Forecast" in step 1 Pre-flight → PayrollForecast Sheet
- "Investigate" in step 3 Blocker Review → PayrollInvestigation Sheet
- "View Forensics" in run history rows → PayrollForensics Sheet
- "View Governance Trail" in footer → GovernanceMatrix read-only Sheet
- "Audit Trail" in footer → AttendanceAudit filtered to current payroll period

**Inside EmployeeResolutionWorkspace (Sheet in MyWorkQueue):**
- "Explain This Issue" on Summary tab → AttendanceTimeline Sheet
- "Risk Assessment" on Attendance tab → AttendanceRisk Sheet

**Inside AttendancePolicy (config page):**
- "View Conflicts" toolbar button → PolicyConflicts Sheet
- "Simulate This Change" in save flow → PolicySimulation dialog

**Inside RosterWorkspace:**
- "Intelligence" tab → RosterIntelligence panel
- "Simulate Roster" toolbar button → RosterSimulationCenter dialog

### Config-only advanced (Setup domain)

These are accessible from the Setup/Config domain as configuration flows. They appear in the Setup nav section, not in operational nav:

- `AttendancePeriods` (`/admin/attendance/periods`) — Setup > Attendance > Periods
- `AttendancePolicy` (`/admin/attendance/policy`) — Setup > Attendance > Policy
- `ArrearEngine` — Setup > Payroll > Arrear Configuration
- `AutomationsConsole` (`/admin/system/automations`) — Setup > System > Automations (also in Developer/System nav)
- `IntegrationRegistry` (`/admin/system/integrations`) — Setup > System > Integrations (also in Developer/System nav)

---

## Section 8: Reduced Maintenance Surface Area

```
BEFORE CLEANUP (modernization-v2 branch state):
================================================
  Total routes:                    ~85
  Operational routes:              ~30  (but ~12 duplicated or competing)
  Advanced/diagnostic routes:      ~35  (many with ownership violations)
  Developer/System routes:         ~7
  Config/Setup routes:             ~13
  Duplicate ownership violations:  ~12
  Competing approval flows:        6    (RegularisationApproval, AttendanceCorrections,
                                         ExceptionGovernance, PayrollApprovalWorkflow,
                                         GovernanceMatrix execution, EssOperationalCenter)
  Competing queue-like screens:    9    (DailyOperationsWorkspace, AttendanceOperationsCenter,
                                         ActivityFeed standalone, BulkActionPanel standalone,
                                         OperationalInbox queue triage, AttendanceAnomalies,
                                         EmployeeOperationalProfile, RecommendationCenter,
                                         PredictiveWarningsStrip)
  Standalone components that       8    (EmployeeOperationalProfile, BulkActionPanel,
  duplicate primary panels:             ImpactPreviewDialog, OperationalScorecard,
                                         WorkforceOptimizationInsights, PredictiveWarningsStrip,
                                         ActivityFeed standalone, PayrollResolutionCenter)

AFTER CLEANUP (UX-8 target state):
====================================
  Total routes:                    ~65  (removed/redirected ~20 routes)
  Operational routes:              ~15  (de-duplicated, each workflow has one owner)
  Advanced routes:                 ~25  (all contextual — Sheet/Dialog — or Command Palette)
  Developer/System routes:         ~7   (unchanged)
  Config/Setup routes:             ~18  (absorbed: AttendancePeriods, AttendancePolicy,
                                         ArrearEngine from operational domain)
  Duplicate ownership violations:  0
  Competing approval flows:        1    (MyWorkQueue owns ALL approval flows)
  Competing queue-like screens:    1    (MyWorkQueue is the single queue surface)
  Standalone components that       0    (all converted to contextual panels or removed)
  duplicate primary panels:

  Maintenance reduction:
  - ~20 routes removed or redirected (23% route reduction)
  - ~8 standalone components deleted (reduced bundle + test surface)
  - 12 ownership violations resolved (zero competing entry points per workflow)
  - 5 workflows now have exactly one owner
  - All advanced tools follow Sheet/Dialog/Tab contextual pattern — predictable UX contract
  - Engineers: fewer pages to maintain, update, and test
  - Designers: single UX contract for advanced tools (Sheet/Dialog), no bespoke layouts
  - QA: ~20 fewer routes to regression test; advanced tool behavior is predictable
```

---

## Section 9: Operational Ownership Corrections

| Operational Task | Was Owned By (multiple — violation) | Now Owned By (single) | Deprecated Entry Points |
|---|---|---|---|
| Attendance regularisation approval | RegularisationApproval (`/admin/attendance/regularisation`), AttendanceOperationsCenter (`/admin/attendance/center`), DailyOperationsWorkspace (`/admin/daily-ops`) | `MyWorkQueue` — `needs_review` section, type: `regularisation` | `/admin/attendance/regularisation` (removed), `/admin/attendance/center` (removed), `/admin/daily-ops` (deprecated) |
| Attendance correction approval | AttendanceCorrections (`/admin/attendance/corrections`), AttendanceOperationsCenter (`/admin/attendance/center`) | `MyWorkQueue` — `needs_review` section, type: `correction` | `/admin/attendance/corrections` (removed), `/admin/attendance/center` (removed) |
| Attendance anomaly resolution | AttendanceAnomalies (`/admin/attendance/anomalies`), AttendanceOperationsCenter, DailyOperationsWorkspace | `MyWorkQueue` — `anomalies` section | `/admin/attendance/anomalies` (removed), `/admin/attendance/center` (removed) |
| OT approval and validation | AttendanceAnomalies, AttendanceOperationsCenter, PayrollApprovalWorkflow (standalone), PayrollValidation (standalone) | `MyWorkQueue` (`ot_verification` section) for pre-run; `PayrollControlCenter` step 4 for run-time OT gate | PayrollApprovalWorkflow standalone (removed), PayrollValidation standalone (removed), AttendanceAnomalies and AttendanceOperationsCenter (removed) |
| Exception approval and override | ExceptionGovernance (`/admin/attendance/exceptions`) — had Approve/Reject/Policy override CTAs | `MyWorkQueue` `needs_review` section (exception type items) | ExceptionGovernance execution CTAs removed; route converted to read-only governance panel |
| Payroll blocker resolution | PayrollResolutionCenter, PayrollApprovalWorkflow, PayrollFinalizationCenter, PayrollValidation, PayrollControlCenter (partial) | `PayrollControlCenter` — step 3 (Blocker Review) | PayrollResolutionCenter (removed), PayrollApprovalWorkflow (removed), PayrollFinalizationCenter (removed), PayrollValidation (removed) |
| Payroll finalization and lock | PayrollFinalizationCenter, PayrollControlCenter step 6 | `PayrollControlCenter` — step 6 (Finalization) | PayrollFinalizationCenter standalone (removed) |
| Payroll approval routing execution | PayrollApprovalWorkflow, GovernanceMatrix (approval execution), PayrollControlCenter step 4 | `PayrollControlCenter` — step 4 (Approval sub-step) | PayrollApprovalWorkflow (removed); GovernanceMatrix approval execution stripped |
| Employee operational resolution | EmployeeOperationalProfile (6-tab component), EssOperationalCenter, ActivityFeed (inline resolve), EmployeeResolutionWorkspace | `EmployeeResolutionWorkspace` (Sheet from MyWorkQueue item card) | EmployeeOperationalProfile standalone (removed), EssOperationalCenter (removed/redirected), ActivityFeed inline resolve (removed) |
| ESS request triage and approval | EssOperationalCenter, MyWorkQueue `needs_review` | `MyWorkQueue` — `needs_review` section, type: `ess` | EssOperationalCenter (removed, redirected to `/admin/my-work-queue?section=needs_review&type=ess`) |
| Bulk queue item mutation | BulkActionPanel (UX-5 standalone), MyWorkQueue BulkActionBar | `MyWorkQueue` BulkActionBar | BulkActionPanel standalone component (deleted) |
| Pre-action impact preview | ImpactPreviewDialog (UX-5 standalone), MyWorkQueue bulk confirm dialog | `MyWorkQueue` built-in bulk action confirm dialog | ImpactPreviewDialog standalone component (deleted) |

---

## Section 10: Implementation Priority

### Tier 1 — Immediate (removes active confusion, no new builds required)

These are pure removals and redirects. Implement in the current sprint to prevent users landing on duplicate surfaces.

1. **Remove `/admin/attendance/center` route** — add HTTP 301 redirect to `/admin/my-work-queue?section=attendance`. Remove `AttendanceOperationsCenter` from router and nav.
2. **Remove `/admin/attendance/regularisation` route** — redirect to `/admin/my-work-queue?section=needs_review&type=regularisation`. Remove `RegularisationApproval` from router.
3. **Remove `/admin/attendance/corrections` route** — redirect to `/admin/my-work-queue?section=needs_review&type=correction`. Remove `AttendanceCorrections` from router.
4. **Remove `/admin/attendance/anomalies` route** — redirect to `/admin/my-work-queue?section=anomalies`. Remove `AttendanceAnomalies` from router.
5. **Deprecate `/admin/daily-ops` with redirect banner** — show "DailyOperationsWorkspace has moved to My Work Queue" banner for 2 sprints, then remove route. Redirect to `/admin/my-work-queue`.
6. **Convert `EmployeeOperationalProfile` usage → `EmployeeResolutionWorkspace`** — find all `<EmployeeOperationalProfile />` call sites in the codebase, replace with `EmployeeResolutionWorkspace` Sheet trigger. No new component build required if tabs already exist.
7. **Remove `BulkActionPanel` standalone usage** — replace all `<BulkActionPanel />` call sites with `<BulkActionBar />` (existing MyWorkQueue component). Delete `BulkActionPanel` component file.
8. **Remove `PredictiveWarningsStrip` standalone usage** — replace all call sites with `<SmartRecommendationChips />`. Delete `PredictiveWarningsStrip` component file.
9. **Remove `ImpactPreviewDialog` standalone usage** — replace all call sites with MyWorkQueue's existing bulk action confirm dialog. Delete `ImpactPreviewDialog` component file.
10. **Strip approval execution from `GovernanceMatrix`** — remove `Approve`, `Override routing`, `Edit matrix` buttons/handlers from `GovernanceMatrix`. Route stays; page becomes read-only governance trail viewer.

---

### Tier 2 — This Sprint (contextual conversions, moderate effort)

These require building new Sheet/Dialog trigger points in existing primary workspaces.

1. **Add "Explain This Issue" button to `EmployeeResolutionWorkspace` Summary tab** — triggers `AttendanceTimeline` as a Sheet panel. Remove `/admin/attendance/forensics` from primary nav (keep route for deep-link/Command Palette).
2. **Add "View Audit Trail" button to `PayrollControlCenter` footer** — triggers `AttendanceAudit` filtered to current payroll period as Sheet.
3. **Add "Why This Amount?" button to every `PayrollControlCenter` line item** — triggers `PayrollExplainabilityPanel` Sheet. Verify `PayrollExplainabilityPanel` accepts an `employeeId + periodId` prop for contextual loading.
4. **Convert `GovernanceMatrix` to "View Governance Trail" Sheet in `PayrollControlCenter`** — add "View Governance Trail" button to `PayrollControlCenter` footer. `GovernanceMatrix` component renders inside Sheet (read-only mode via `readOnly` prop).
5. **Move `PredictiveWarningsStrip` capability into `MyWorkQueue` `SmartRecommendationChips`** — verify SmartRecommendationChips covers all warning types from PredictiveWarningsStrip. Add any missing warning types to SmartRecommendationChips data model.
6. **Add "Exception Details" contextual Sheet to `MyWorkQueue` item cards** — for items with `type: exception`, show "Exception Details" button that opens `ExceptionGovernance` read-only panel as Sheet. Remove approval execution CTAs from ExceptionGovernance component.
7. **Merge `OperationalScorecard` metrics into `QueueAnalyticsDashboard`** — add scorecard summary row to QueueAnalyticsDashboard header. Remove all `<OperationalScorecard />` standalone usages.
8. **Merge `WorkforceOptimizationInsights` into `QueueAnalyticsDashboard` "Insights" tab** — add "Insights" sub-tab to QueueAnalyticsDashboard. Move insight panels from WorkforceOptimizationInsights into it. Remove standalone usage.

---

### Tier 3 — Next Sprint (simulation cleanup and diagnostic wiring)

These require more substantial changes to config pages and simulation flows.

1. **Move `PolicySimulation` to `AttendancePolicy` config page only** — add "Simulate This Change" button to AttendancePolicy save/preview flow. Remove `/admin/attendance/simulate-policy` from primary nav. Make route accessible via Command Palette only as fallback.
2. **Move `RosterSimulationCenter` to `RosterWorkspace` only** — add "Simulate Roster" button to RosterWorkspace toolbar. Remove `/admin/roster/simulation` from primary nav. Make route accessible via Command Palette only.
3. **Add "Intelligence" tab to `QueueAnalyticsDashboard`** — merge `RecommendationCenter` + `AttendanceIntelligenceCenter` outputs into a new "Intelligence" tab. Remove `RecommendationCenter` standalone page.
4. **Add "Why This Flag?" diagnostic chip to `MyWorkQueue` queue item cards** — all attendance queue items show confidence score chip (AttendanceConfidence). Clicking opens AttendanceConfidence diagnostic Sheet.
5. **Convert `ActivityFeed` to "Live Feed" mode toggle in `MyWorkQueue`** — add "List / Live Feed" toggle to MyWorkQueue queue list header. Live Feed mode renders ActivityFeed component inline within the queue panel. Remove all standalone `<ActivityFeed />` usages.
6. **Add "View History" Sheet to `MyWorkQueue` item card footer** — "View History" button triggers OperationsTimeline as Sheet for that item's `entityId`. Remove standalone OperationsTimeline usages.
7. **Add `PayrollSimulation` and `PayrollForecast` to `PayrollControlCenter` step 1** — "Simulate Run" and "View Forecast" buttons in Pre-flight panel. Both open as full-screen dialog/Sheet respectively. Remove standalone route usages if any.
8. **Add "Investigate" Sheet to `PayrollControlCenter` step 3 Blocker Review** — "Investigate" button on each blocker item opens `PayrollInvestigation` Sheet. Remove PayrollInvestigation standalone usages if any.
9. **Add "Intelligence" tab to `RosterWorkspace`** — integrate `RosterIntelligence` as a tab panel inside RosterWorkspace. Remove `/admin/roster/intelligence` from primary nav; keep route for Command Palette.
10. **Register all Command Palette-only tools in palette registry** — ensure all tools listed in Section 7 "Command Palette only" are registered in the palette index with correct search labels and `[ADVANCED]` tag.
