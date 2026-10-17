# Citykart HRMS vs. CognixHR — Navigation & Screen Comparison

**Purpose:** A screen-by-screen, code-grounded comparison between a competitor retail-chain HRMS
(Citykart, reviewed live at `citykart.cloudzmall.com` — see
[`citykart-review.md`](./citykart-review.md)) and CognixHR's own codebase at
`/Users/mack/Desktop/hrms`, used to find **concrete ways to simplify CognixHR's own
navigation and screens.**

**How to read this document:** Section 2 compares nav structure and click-depth.
Section 3 gives an explicit verdict on each Citykart pattern the prior review flagged.
Section 4 is a **prioritized action list** — the primary lens, per product direction,
is *reducing load on the HR Admin, Platform Admin, and Payroll team* as power users who
process volume, not polishing a single end-user's one-off click path. Section 5 calls out
where CognixHR is already ahead. Every claim about CognixHR cites a real file (and line
where practical) — nothing here is inferred from the Citykart review or from assumptions.

> **Headline finding, surfaced up front because it matters most:** CognixHR's approval
> queues are inconsistent in a way that directly hurts the people who process volume.
> Attendance regularisation got full bulk-select + bulk-approve/reject, built three times
> over (admin, manager, and the ops queue). Leave requests, comp-off, and overtime did not
> get it anywhere, admin or manager side — every one of those queues is still one-row,
> one-click, repeat. And for every queue type, HR admin's view is "the entire tenant,
> unfiltered" rather than "the exceptions a manager couldn't resolve." See §3.6 and §4.0.

---

## 1. Navigation structure — side by side

| | Citykart | CognixHR |
|---|---|---|
| Admin shell | 13 flat sidebar items (HR module only); 6 more modules reachable only via a 3-dropdown stack at the bottom of the sidebar | 8 top-nav **domain tabs**, always visible: Operations, Workforce, Attendance, Leave, Payroll, Compliance, Analytics, Setup — [`apps/web/src/components/layout/v2/nav-config.ts`](./apps/web/src/components/layout/v2/nav-config.ts) |
| How you reach the "other modules" | Scroll to the bottom of the sidebar, open an unlabeled dropdown, pick from 6 named modules + a careers-page dead end | Click a tab. Every domain is a first-class, labeled tab in the top nav — [`apps/web/src/components/layout/v2/TopNavV2.tsx:1-10`](./apps/web/src/components/layout/v2/TopNavV2.tsx) |
| Total leaf screens (default module/role) | ~35 (HR module only) | 8 domains × ~5 groups × ~5 items ≈ **150+ leaf nav items**, all discoverable from the always-visible tabs (counted directly from `DOMAINS` in nav-config.ts) |
| Total leaf screens (everything) | 100+ across all 7 modules, ~80% invisible without finding the dropdown | Same order of magnitude (100+), but **100% of it is one click away** — no mode switch |
| Self-service persona | A second dropdown (`HR` ⇄ `Employee`) on the *same* logged-in session, swaps the whole sidebar | A genuinely separate shell/route tree (`/ess/*`) with its own sidebar — [`apps/web/src/components/layout/EssShell.tsx`](./apps/web/src/components/layout/EssShell.tsx), [`EmployeeSidebar.tsx`](./apps/web/src/components/layout/EmployeeSidebar.tsx) (8 "pillars" + 4 service sections ≈ 24 items) |
| Manager persona | Not modeled as a separate experience — same HR/Employee toggle | A third dedicated shell at `/manager/*` — [`ManagerShell.tsx`](./apps/web/src/components/layout/ManagerShell.tsx), [`ManagerSidebar.tsx`](./apps/web/src/components/layout/ManagerSidebar.tsx) |
| Executive view | Not modeled | A fourth curated nav set (`EXECUTIVE_DOMAINS`, 3 domains) toggled from the top nav for `super_admin`/`hr_admin` — [`nav-config.ts:903-975`](./apps/web/src/components/layout/v2/nav-config.ts) |

**Bottom line on structure:** CognixHR is not smaller than Citykart — by leaf-screen count
it's comparably large, arguably larger. But it solves Citykart's core problem
(discoverability) by making every domain a permanent, labeled tab instead of a buried
dropdown. The risk CognixHR runs instead is the opposite one: **so much is visible at once
that the top nav + contextual sidebar itself becomes the thing that needs trimming** (see
§4).

### Click-depth to common tasks

| Task | Citykart | CognixHR |
|---|---|---|
| View an employee's profile | 2 clicks (Employee ▸ Employee ▸ row) | 2 clicks: Workforce tab (default route is Employee Directory) → row click — [`apps/web/src/pages/employees/EmployeeList.tsx`](./apps/web/src/pages/employees/EmployeeList.tsx) |
| Add a new employee | 2 clicks to open wizard, **+6 more screens** (7-step wizard, 28+ fields on step 1) | 2 clicks to open wizard (Workforce → Employee Directory → "+ Add Employee"), **+2 more screens** (3-step wizard: 6 fields, then 9 mostly-optional fields, then a review screen) — [`apps/web/src/pages/employees/AddEmployee.tsx`](./apps/web/src/pages/employees/AddEmployee.tsx) |
| Approve a leave request | 1 *hidden* module switch + 3 clicks (Attendance Mgmt → Requests ▸ → Leave Requests → inline approve) | 2 clicks, **zero mode switch**: Operations tab (always visible) → "Approvals Inbox" → inline Approve — [`apps/web/src/pages/attendance/ApprovalInbox.tsx:419-427`](./apps/web/src/pages/attendance/ApprovalInbox.tsx) |
| View today's attendance | 1 hidden module switch + 1 click | 1 click: Attendance tab (always visible, default route is the Punch Intake / Operations workspace) |
| Run payroll | 1 hidden module switch + 1 click (Dashboard) to view; running itself is a separate multi-screen process | 1 click: Payroll tab (default route is Payroll Hub) → "Payroll Operations" (a guided run console) |
| Approve attendance regularisation (resolves `attendance_anomalies`) | 1 hidden module switch + 3 clicks (Attendance Mgmt → Requests ▸ → Regularisation Requests) | 2 clicks: Attendance tab → "Approvals" — and unlike leave, this one supports **bulk** select + bulk approve/reject, see §3.6 — [`apps/web/src/pages/admin/attendance/ManagerRegularisationQueue.tsx`](./apps/web/src/pages/admin/attendance/ManagerRegularisationQueue.tsx) |
| Approve a promotion/transfer | 3 clicks (Promotion Request ▸ → Manager Recommended → inline approve) | **No dedicated Promotion/Transfer workflow exists in CognixHR.** Confirmed by search — no `Promotion`/`Transfer` page anywhere under `apps/web/src/pages`. Comp Revisions and Increment Cycle (Payroll domain) cover salary-side changes only; there is no structured request/approval flow for a role or location change. This is a plain feature gap, not a design choice worth praising or blaming — flagged here so it isn't silently assumed to exist. |
| Add/manage a Department or Location | 3 clicks through a **request-and-approve queue** (`Requests ▸ Department → + Request Department`), separate from the direct-CRUD `Masters Management ▸ Organization` | 2 clicks, **one single canonical screen**: Setup tab → "Departments & Roles" (`/admin/organization`) or "Work Locations" (`/admin/masters/work-locations`) — direct CRUD, no parallel request queue (see §3.4) |

---

## 2. Per-pattern verdicts

### 2.1 The module switcher (discoverability)

**Citykart:** 3 unlabeled dropdowns at the bottom of the sidebar gate ~80% of the product
(Attendance, Payroll, Recruitment, PMS, Tour & Travel, Masters) behind a control most users
would never find without being told.

**CognixHR verdict: avoided.** All 8 domains are permanent, labeled tabs in
[`TopNavV2.tsx`](./apps/web/src/components/layout/v2/TopNavV2.tsx) — `getVisibleDomains()`
renders every domain the current role can see, all at once, with no dropdown or mode switch
required to reach Attendance, Payroll, or Analytics. The nav config even has a **dev-time
integrity check** (`nav-config.ts:1130-1165`) that warns in the console if a nav item's route
isn't covered by its own domain's `matchPrefixes` — i.e. a safeguard specifically against the
"a whole section goes invisible by accident" failure mode. CognixHR trades Citykart's
discoverability problem for a different one: with 150+ items always one click away across 8
domains, the *contextual sidebar itself* is dense (see §4.3).

### 2.2 The 7-step, 28-field Add Employee wizard

**Citykart:** 7 steps (Store Details, Personal, Experience, Family, ID & Bank, Nomination,
Others), 28+ fields on step 1 alone, gated so you can't skip ahead.

**CognixHR verdict: avoided, deliberately.** [`AddEmployee.tsx`](./apps/web/src/pages/employees/AddEmployee.tsx)
is a **3-step wizard**:
- Step 1 (`step1Schema`, lines 30-37): 6 fields, only 4 required (first name, last name,
  email, joining date).
- Step 2 (`step2Schema`, lines 39-49): 9 fields, only `employment_type` required — department,
  designation, grade, manager, site, roster, work location, and cost center are all optional.
- Step 3: a plain review-and-submit screen.

The code explicitly documents the design intent at lines 457-464: after onboarding, "complete
the employee's profile from their profile page: personal details, Aadhaar/PAN/UAN, bank info,
emergency contacts, and documents" — i.e. a deliberate split between a lean required-fields
step and an optional-fields-filled-in-later model, which is exactly the mitigation the
Citykart review's own takeaway (#3) recommended. This is CognixHR's strongest point of
comparison.

### 2.3 The 9-tab, 40+-field employee profile

**Citykart:** 9 tabs (General, Personal, Experience, Qualification, Attendance, Nomination,
Attachments, Academy Eligibility, Employment History), 40+ tracked fields, one long scroll
per tab.

**CognixHR verdict: a different shape, not dramatically fewer fields.**
[`EmployeeProfile.tsx`](./apps/web/src/pages/employees/EmployeeProfile.tsx) organizes **12
sub-tabs under 6 sections** (`SUB_TABS`, lines 197-215): Core (Overview, Personal, Education,
User Account), Employment (Job & Position, Shift & Roster, Separation), Compensation
(Compensation, Bank & Statutory), Documents, Relationships (Family & Nominees), Assets
(Access Card). The grouped-section tab bar (`line 311-325`) is a cleaner *presentation* than
Citykart's flat 9-tab row, but it is not fundamentally fewer screens or fields — it's the same
order-of-magnitude complexity, reorganized. This is a real opportunity (§4.4), not a solved
problem.

### 2.4 Two parallel systems for the same master data

**Citykart:** Location and Department exist both as direct CRUD (`Masters Management ▸
Organization`) and as a separate request-and-approve queue (`Requests ▸ Location/Department`)
— no clear source of truth.

**CognixHR verdict: avoided.** A repo-wide search for a request/change-approval pattern on
master data (`grep -rn "change.request\|ChangeRequest"`) found nothing. Department, Site,
Work Location, State, Cluster, Cost Center, Grade, Employment Category are each a single
direct-CRUD page under `apps/web/src/pages/masters/` — e.g.
[`Sites.tsx`](./apps/web/src/pages/masters/Sites.tsx),
[`WorkLocations.tsx`](./apps/web/src/pages/masters/WorkLocations.tsx). One nuance worth
flagging on inspection: `Sites.tsx` renders a nested, expandable preview of each site's work
locations (lines 304-314) but deliberately does **not** duplicate CRUD there — it only
`onNavigate`s out to the canonical `WorkLocations.tsx` page to actually add/edit one
(confirmed: no `Pencil`/`Trash2` icons appear on the nested location rows, only on the Site
row itself at lines 290-299). That's the right pattern — a read-only drill-in preview with one
canonical edit surface — and worth preserving as new master-data screens are added.

### 2.5 "Requests" as a misleading sidebar label

**Citykart:** A top-level "Requests" item is not leave/attendance requests — it's master-data
change requests, a label trap for returning users.

**CognixHR verdict: avoided.** There is no top-level "Requests" item at all in
`nav-config.ts`. Approval-type items are explicitly named for what they contain —
"Approvals Inbox", "Leave Approvals", "Promotion"/"Transfer" (n/a, see §1) — so this specific
confusion has no equivalent to inherit.

### 2.6 Inline approve/reject vs. detail-page visits — and bulk action for volume

This is the most consequential pattern in the whole comparison, and it needs the most
nuance. Citykart's review flagged *inline single-row* approve/reject as the good pattern,
but the sharper question for an admin/payroll team processing real volume is: **can they
select many items and act on all of them in one step, or are they stuck opening and closing
one row at a time?** Citykart doesn't appear to offer bulk action anywhere (only inline
single-row), so CognixHR had no bar to clear here except its own.

**CognixHR's actual state is inconsistent — some queues got bulk, most didn't:**

| Request type | Inline approve/reject? | **Bulk** select + act? | Evidence |
|---|---|---|---|
| Attendance regularisation (the resolution path for `attendance_anomalies`) | Yes | **Yes — in 3 separate places** | Admin+manager dual-role queue: [`ManagerRegularisationQueue.tsx:1-13`](./apps/web/src/pages/admin/attendance/ManagerRegularisationQueue.tsx) ("Dual-role view... Bulk select + approve/reject"); manager team queue: [`ManagerTeamRegularisation.tsx:4-14`](./apps/web/src/pages/manager/ManagerTeamRegularisation.tsx) ("Bulk regularisation workspace for managers... multi-select + bulk approve/bulk reject"); ops queue: [`useOperationalQueue.ts:244`](./apps/web/src/lib/queue/useOperationalQueue.ts) posts to `/attendance/regularisation/bulk-approve`. Backing API: `POST /attendance/regularisation/bulk-approve` / `bulk-reject`. |
| Raw attendance anomalies (before regularisation) | N/A (dashboard, not a row queue) | **API yes, but no manual multi-select UI on the dedicated Anomalies page** | `POST /attendance/anomalies/bulk-resolve` exists — [`apps/api/src/routes/attendance/anomalies.ts:472-505`](./apps/api/src/routes/attendance/anomalies.ts) — and is used by the Operations Queue (`useOperationalQueue.ts:238`), but [`AttendanceAnomalies.tsx`](./apps/web/src/pages/attendance/AttendanceAnomalies.tsx) itself is a department-level dashboard with only a one-click automatic "Reconcile" (auto-resolve stale anomalies) — no per-row checkbox list. An admin who goes straight to the dedicated "Anomalies" nav item won't find the bulk tool; they'd have to know to go to "Operations Queue" instead. |
| **Leave requests** | Yes, single row | **No — nowhere in the codebase** | [`ApprovalInbox.tsx`](./apps/web/src/pages/attendance/ApprovalInbox.tsx) (serves `/admin/leave/approvals`, `/admin/approvals/inbox`, **and** `/manager/approvals` — same component, three routes) has per-row Approve (line 419-427) and an inline expanding Reject form (line 165-201), with **no `Checkbox`/`selected`/bulk construct anywhere in the file**. The Operations Queue (`MyWorkQueue.tsx`) does not pull in plain leave applications either — its "Leave" filter chip is leave *collision* records (`/leave/collision/log`), a different thing. No bulk-approve endpoint exists for `leave_requests`/`leave_applications` at all (confirmed: the only "bulk" leave API routes are `bulk-assign` and opening-balance migration, [`leave.ts:1404-1638`](./apps/api/src/routes/attendance/leave.ts) — neither is approval). |
| **Comp-off** | Yes, single row | **No** | Admin page [`CompOff.tsx:342-400`](./apps/web/src/pages/attendance/CompOff.tsx) and manager page `ManagerTeamCompOff.tsx` both have per-row Approve/Reject with an inline notes/reason form, and neither contains a `Checkbox`/bulk construct. |
| **Overtime** | Yes, single row | **No** | Admin page [`OvertimeManagement.tsx:464-532`](./apps/web/src/pages/attendance/OvertimeManagement.tsx) and manager page `ManagerTeamOvertimeRequests.tsx` are the same shape — per-row only. |

**Why this matters more than the nav-depth comparison:** at the scale CLAUDE.md itself
documents (2,877 employees in the Muster Roll example), a backlog of even a few dozen
pending leave requests, comp-off claims, or overtime requests turns "click Approve" into a
genuinely repetitive task with no shortcut — exactly the one-item-at-a-time pattern the
product direction calls out as something that "should not be there." CognixHR already
proved it knows how to build the right pattern (regularisation, three times over); it just
didn't carry that pattern to the other three request types that go through the identical
submit-via-ESS → land-in-a-queue → manager-or-admin-acts pipeline.

### 2.7 Manager-first routing and the (missing) admin exception path

The product direction's second concern: routine approvals should default to the employee's
own manager, with HR Admin pulled in only for exceptions — not as the default approver for
everyday volume. Checking this against the actual routing code:

**What CognixHR gets right:** every request type checked routes to the manager by default.
- Leave: `GET /approvals/pending` — "Manager: only direct-reports' pending" via
  `getPendingApprovalsForManager()` ([`apps/api/src/lib/approval-service.ts:1035`](./apps/api/src/lib/approval-service.ts)),
  called from [`leave-requests.ts:598-604`](./apps/api/src/routes/attendance/leave-requests.ts).
- Comp-off: "managers see only their direct reports' requests" via `getDirectReportIds()` —
  [`comp-off.ts:216-222`](./apps/api/src/routes/attendance/comp-off.ts).
- Overtime: the same `isHrAdmin()` / direct-report branching pattern —
  [`overtime.ts:73, 400, 450`](./apps/api/src/routes/attendance/overtime.ts).
- Regularisation: the same dual-role split, explicitly documented in the UI file header
  (§2.6 above).

**What's missing — there is no exception-only admin view.** In every one of those same four
files, the `hr_admin`/`super_admin` branch is unconditionally "see the whole tenant" — not
"see what's stuck, escalated, or has no active manager." Verbatim from the code:
- `comp-off.ts:214-215`: `if (isHrAdmin(req.userRole)) { // HR admin sees the whole tenant }`
- `leave-requests.ts:549-550`: `if (isHrAdmin) { // ── HR admin: all tenant-wide pending, paginated per type ──` — note the comment itself says "all," not "escalated."

`HR_ADMIN_ROLES` / `MANAGER_ROLES` are defined once in
[`apps/api/src/lib/rbac.ts:38-49`](./apps/api/src/lib/rbac.ts) and this exact two-branch
shape (`isHrAdmin` → everyone; manager → direct reports only) is copy-pasted across all four
route files — there is no third branch anywhere for "overdue," "no manager assigned," "SLA
breached," or "policy violation." The regularisation queue does carry SLA-deadline and
`sla_breached` fields (`ManagerRegularisationQueue.tsx:39-52`) and there's a one-off
`POST /notifications/escalate` endpoint ([`apps/api/src/routes/notifications/index.ts:224-252`](./apps/api/src/routes/notifications/index.ts))
that lets an **HR admin** (not a manager) flag an item's status as `escalated` in a side
table — but nothing *reads* that flag to filter what an admin sees, and nothing lets a
manager push an item into an admin's queue. So the raw material for a real exception path
(SLA breach flags, an escalate mutation) exists in fragments, but no screen or query actually
assembles them into "here is only what needs HR Admin's attention" — HR Admin's queue is
always the full firehose, identical in shape to what every manager combined would see, just
without the per-manager split. See §4.0 for the fix.

### 2.8 Shared admin/self-service profile component

**Citykart:** `My Profile` (employee self-service) reuses the exact same 9-tab component as
the admin "view employee" screen — good reuse, one UI to maintain.

**CognixHR verdict: the opposite choice, made deliberately.** CognixHR does **not** share the
component. [`ProfilePlatform.tsx:1-17`](./apps/web/src/pages/profile/ProfilePlatform.tsx)
documents this explicitly:

> "Admin shell ONLY ever shows the operational HR admin form here... The previous 'view as
> employee / view as manager' impersonation UX inside the admin profile was removed to
> eliminate shell confusion, duplicated UX, and permission ambiguity."

Instead, [`EssMyProfile.tsx:1-14`](./apps/web/src/pages/ess/EssMyProfile.tsx) is a
purpose-built, independent component whose own header comment says "NOT an admin employee
form. No payroll structures, compensation tabs, or salary details." This is a real trade-off,
not a simple miss: CognixHR gets a leaner, workflow-first self-service experience at the cost
of maintaining two UIs instead of one for overlapping data (name, department, designation,
manager, etc. are duplicated field-by-field across `EmployeeProfile.tsx` and
`EssMyProfile.tsx`). Citykart's single-component approach is cheaper to maintain; CognixHR's
split approach is easier to keep each audience's view free of irrelevant clutter. Neither is
strictly "better" — call this a documented, intentional divergence rather than a bug.

### 2.9 The "Other Modules Management" dead end

**Citykart:** Selecting this module-switcher option silently exits the authenticated app into
a public, unauthenticated careers page with no way back.

**CognixHR verdict: no equivalent found, and the architecture makes it unlikely.** CognixHR
has no module switcher to begin with (§2.1), so there's no analogous "pick an option from a
dropdown and get ejected" failure mode. No evidence of any nav item routing out of the
authenticated shell into a public page was found in `App.tsx`'s route table.

---

## 3. Recommendations — prioritized

Ranked with the stated priority in mind: HR Admin, Platform Admin, and Payroll team
throughput, not single-user polish. "Impact" is about volume/risk reduction for those
personas; "Effort" is a rough read of how contained the change looks from the code.

### 0. (Highest priority) Bring leave, comp-off, and overtime approvals up to the bulk-action bar regularisation already cleared

**Impact: very high. Effort: medium — the pattern to copy already exists three times over.**

Concretely:
- Port the exact `selected: Set<string>` + `BulkActionBar`-style UI from
  [`ManagerRegularisationQueue.tsx:206-230`](./apps/web/src/pages/admin/attendance/ManagerRegularisationQueue.tsx)
  (or [`ManagerTeamRegularisation.tsx`](./apps/web/src/pages/manager/ManagerTeamRegularisation.tsx),
  the manager-scoped twin) into [`ApprovalInbox.tsx`](./apps/web/src/pages/attendance/ApprovalInbox.tsx)
  for leave requests, into [`CompOff.tsx`](./apps/web/src/pages/attendance/CompOff.tsx) /
  `ManagerTeamCompOff.tsx` for comp-off, and into
  [`OvertimeManagement.tsx`](./apps/web/src/pages/attendance/OvertimeManagement.tsx) /
  `ManagerTeamOvertimeRequests.tsx` for overtime.
- Add `POST /attendance/leave/bulk-approve` / `bulk-reject`, `POST /attendance/comp-off/bulk-approve`
  / `bulk-reject`, and `POST /overtime/bulk-approve` / `bulk-reject` API endpoints, mirroring
  `/attendance/regularisation/bulk-approve`'s existing shape (same-tenant guard, direct-report
  guard for managers, idempotency key, affected-row count returned). This is almost entirely
  precedent-following, not new design.
- This is the single change most likely to be felt by actual HR Admin/Payroll users, because
  it's the one place the review found a clean "one workflow type got the good pattern, the
  rest didn't" split inside CognixHR's own code — not a hypothetical, a confirmed gap.

### 1. Build a real exception-only view for HR Admin, instead of "everyone gets the full tenant"

**Impact: high. Effort: medium.** Per §2.7, every `isHrAdmin()` branch across
`leave-requests.ts`, `comp-off.ts`, `overtime.ts`, and the regularisation routes currently
returns the entire tenant's pending queue to HR Admin, with no filter for "only what actually
needs you" (SLA-breached, no manager assigned, manager inactive, escalated). Concretely:
- Add a `scope=exceptions` query param to `/approvals/pending` (and the comp-off/overtime
  equivalents) that, for `hr_admin`/`super_admin` callers, filters to: `sla_breached = true`
  OR the employee's `manager_id` is null/inactive OR the item has an `escalated` row in
  `inbox_items` (the table `/notifications/escalate` already writes to —
  [`apps/api/src/routes/notifications/index.ts:240-245`](./apps/api/src/routes/notifications/index.ts) —
  but nothing currently reads back).
- Make that the **default** landing view for "Approvals Inbox" when the caller is HR Admin;
  keep "show everything" as an explicit secondary toggle for audits/oversight, not the default.
- This turns the existing-but-inert SLA/escalation plumbing into an actual routing feature,
  rather than leaving HR Admin to triage the same full list every manager already saw a slice
  of.

### 2. Consolidate the duplicate approval surfaces for the same work

**Impact: medium-high. Effort: medium.** `ApprovalInbox.tsx` (serving `/admin/leave/approvals`,
`/admin/approvals/inbox`, and `/manager/approvals`) and `MyWorkQueue.tsx` (`/admin/my-work-queue`,
labeled "Operations Queue") both present attendance-related pending work to the same admin
audience, but with different item sets and completely different capability levels — one has a
full bulk bar with Approve All/Reject All/Snooze All/Escalate All
([`MyWorkQueue.tsx:273-288`](./apps/web/src/pages/workspace/MyWorkQueue.tsx)), the other has
none. This is CognixHR's own version of Citykart's "two parallel systems for overlapping work"
problem (§2.4) — not master data this time, but approval UX. Either:
(a) fold leave/comp-off/overtime into the Operations Queue's item model so there's one bulk-
capable surface for all pending-approval work, or (b) if `ApprovalInbox.tsx` stays the
canonical leave/comp-off/overtime surface, give it the Operations Queue's bulk bar instead of
maintaining two different interaction models for adjacent nav items in the same "Queue" group.

### 3. Trim the 8-domain / 150+-item top nav before it becomes CognixHR's own discoverability problem

**Impact: medium. Effort: high (requires product sign-off on what moves/merges).** CognixHR
solved Citykart's *buried* problem by making everything a visible tab, but
`nav-config.ts`'s own header comment documents at least 3 rounds of domain consolidation
already (merging Reports+Intelligence into "Analytics," folding Runbooks into Operations,
folding Platform/SRE tooling into Setup) — a sign the authors already feel the pressure of too
many top-level destinations. Concretely worth another pass: the Payroll domain alone has 4
groups and ~20 items (lines 445-491); Setup has 8 groups and ~35 items (lines 757-888). Not
every super_admin-only "Platform" item (Fabric Intelligence, Trust Intelligence, System
Orchestration — `nav-config.ts:870-887`) needs to sit in the same nav tree an HR Admin sees
daily; consider a separate, explicitly-labeled "Platform Admin" shell (the repo already has
precedent for separate shells per audience — ESS, Manager, Executive) rather than growing the
Setup domain further.

### 4. Give the 12-sub-tab employee profile the same "lean first, detail later" treatment Add Employee already got

**Impact: medium. Effort: medium.** §2.3 found the profile view (`EmployeeProfile.tsx`) still
carries Citykart-level density (12 sub-tabs, 6 sections) even though Add Employee
deliberately avoided it. Consider collapsing rarely-touched tabs (Access Card, Family &
Nominees, Education) into a single "More" or "Records" tab, reserving the always-visible
tab bar for what HR Admin actually opens daily (Overview, Job & Position, Compensation,
Documents) — mirroring the same "required now, optional/later" split that made
`AddEmployee.tsx` simpler than Citykart's wizard.

### 5. Surface the existing anomaly bulk-resolve tool on the page actually named for it

**Impact: low-medium. Effort: low.** §2.6 found `POST /attendance/anomalies/bulk-resolve`
already exists and is already wired into the Operations Queue, but
[`AttendanceAnomalies.tsx`](./apps/web/src/pages/attendance/AttendanceAnomalies.tsx) — the
page an admin would naturally click for "Anomalies" in the Attendance domain — has no manual
multi-select UI of its own, only an automatic "Reconcile" button. Add a row-level list with
checkboxes to that page calling the same bulk-resolve endpoint, so the capability isn't only
reachable by knowing to go to a differently-named page ("Operations Queue") instead.

---

## 4. Where CognixHR is already ahead of Citykart

To keep this comparison honest in both directions:

- **No buried module switcher.** All 8 domains are permanent, labeled top-nav tabs
  ([`TopNavV2.tsx`](./apps/web/src/components/layout/v2/TopNavV2.tsx)) with a dev-time
  integrity check guarding against a domain silently going unreachable
  (`nav-config.ts:1130-1165`). Citykart's entire Attendance and Payroll modules are one
  undiscovered dropdown away from invisible; nothing in CognixHR is.
- **A genuinely lean Add Employee flow.** 3 steps, 4 required fields on step 1, versus
  Citykart's 7 steps and 28+ fields on step 1 alone — and the design intent (push optional
  fields to post-onboarding profile completion) is explicit in the code
  (`AddEmployee.tsx:457-464`).
- **No dual master-data system.** Department/Location/Grade/Cost Center etc. each have one
  canonical direct-CRUD screen; no parallel request-and-approve queue duplicates them the way
  Citykart's Masters-vs-Requests split does. The one place that looks like it might duplicate
  (Sites showing nested Work Locations) deliberately avoids it by linking out to the canonical
  editor rather than re-implementing CRUD inline (`Sites.tsx:304-314`).
- **Attendance regularisation's bulk-action support, where it exists, is genuinely good** —
  built three times over (admin, manager-team, and ops-queue surfaces) with SLA-breach
  indicators, a reject-reason dialog, and bulk endpoints that re-run the same per-row
  direct-report security check a single approve would. This is the pattern the rest of the
  queues should be measured against (§4.0), not a weakness.
- **No misleadingly-named nav items.** Every approval surface is named for what it contains
  ("Leave Approvals," "Approvals Inbox") — nothing plays Citykart's "Requests" bait-and-switch.
- **Manager-first routing is already correct in principle.** Leave, comp-off, overtime, and
  regularisation all default to "manager sees only direct reports" at the API layer
  (§2.7) — Citykart's review didn't even surface whether that product offers manager-scoped
  routing at all. CognixHR's gap is narrower than "doesn't route to managers" — it's "admin's
  view isn't filtered down from the full tenant to actual exceptions," which is a smaller,
  more tractable problem to close (§4.1).
- **No dead-end nav items.** Nothing routes an authenticated admin out to an unauthenticated
  public page with no way back.
