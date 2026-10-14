# SYSTEM_AUDIT_2026-10-14 — Module Coverage Register

Continuation of SYSTEM_AUDIT_2026-10-14 from commit `8ce4ba67` on
`integration/g13-plus-market-priorities` (PR #30, unmerged). This round
executed item 4 of the user's governing instruction: inventory every
active module and mark it tested / partially tested / blocked / not
examined, instead of declaring the audit complete.

**This is a working checklist, not a one-shot report.** The user
explicitly rejected treating the inventory as a handoff — the audit
continues in batches across sessions, each batch committed as its own
checkpoint so completed work is never repeated. Batch log:

- **Checkpoint 1** (commit `7b6fb081`): recovered 3 Codex findings
  (pilot-guard, screenshot-path write-side, owner screenshot signing);
  fixed the setup.ts anti-hijack IDOR regression; fixed 11 stale/missing
  nav targets.
- **Checkpoint 2** (this commit): closed the admin attendance-processing
  gap for real (not a relabel — see below); hardened screenshot-path
  validation from a blacklist to an allowlist (closes encoded-traversal,
  backslash, empty-filename, nested-path bypasses the first pass missed);
  added setup.ts tests for interrupted-retry-while-fresh, USER_NOT_FOUND,
  validation error, and a real concurrent-insert race; audited **2 of
  ~30 files in the Employees module** (`routes/employees/index.ts`,
  `user-account.ts`) against all 6 of item 2's categories — this was
  initially mis-described as an "end-to-end" module audit, which was
  wrong and is corrected here: with 27 files still unopened the module
  status is PARTIAL, not complete, for either checkpoint. Found +
  fixed a real defect: `PUT /employees/:id` could transition status to
  `'separated'` (reachable from `EmployeeProfile.tsx`'s Overview tab, not
  only the dedicated Separation Workflow) without revoking the employee's
  login — a 6th code path the AF-001 remediation (`user-account-service.ts`)
  had documented covering only 5. Verified the real Postgres SQLSTATE for
  the setup.ts race (`23505`) against an actual local Postgres 16 instance,
  separate from the mocked unit tests.
- **Checkpoint 3** (this commit): user correctly rejected checkpoint 2 on
  three counts — fixed below, not just acknowledged:
  1. **The admin attendance-processing fix was pointed at dead code.**
     `AdminDashboard.tsx` (checkpoint 1 and 2's edit target) has **zero
     route registrations anywhere** — `/admin/dashboard` is a hard
     `<Navigate>` redirect straight to `/admin/control-center`
     (`ControlCenter.tsx`), and the one component that would have rendered
     `AdminDashboard` (`Dashboard.tsx`, a role router) is itself never
     registered on any route either. Confirmed via `grep` across the whole
     `apps/web/src` tree: zero importers of `Dashboard.tsx`, exactly one
     importer of `AdminDashboard.tsx` (`Dashboard.tsx`, also dead). A real
     Chromium browser session logging in as a seeded super_admin landed on
     `ControlCenter.tsx` and confirmed this directly — clicking "Process
     Attendance" from the live dashboard navigated to `/admin/attendance/
     center`, not `/manager/team/attendance` as checkpoint 2 claimed to
     have fixed. **Both prior checkpoints' edits to `AdminDashboard.tsx`
     were real, correct fixes to a file nothing renders** — left in place
     (not deleted; file deletion was denied by the session's destructive-
     action guard) but flagged here so no future session trusts it as a
     coverage data point. The actually-reachable pages
     (`pages/admin/ControlCenter.tsx`'s "Process now" banner + "Process
     Attendance" quick action, and `components/operational/
     CommandPalette.tsx`'s "Process Attendance" command) each independently
     had the SAME defect (→ `/admin/attendance/center`, which
     `AttendanceOperationsCenter.tsx` confirmed has no trigger button
     either) and are now fixed to the real destination
     (`/manager/team/attendance`) and **proven working end-to-end in a
     real browser** — see the browser-evidence item below.
  2. **Separation-revocation fix strengthened per the user's specific asks:**
     added `apps/api/src/lib/__tests__/user-account-service.test.ts` (7
     tests) — `revokeEmployeeAuth` itself had ZERO direct unit tests before
     this; now covers the happy path, profile-update failure (auth ban
     still attempted regardless, not skipped), auth-ban failure, both
     failing, and two retry scenarios (a failed call followed by a
     succeeding one; calling it twice in a row is a harmless idempotent
     no-op). Added `apps/api/src/plugins/__tests__/auth-is-active-
     rejection.test.ts` (4 tests) exercising the REAL `authenticate`
     preHandler (not a mock of it) to prove an existing cached session is
     actually rejected with 401 within the bounded 60s recheck window once
     `profiles.is_active` flips to false — not just that `revokeEmployeeAuth`
     was *called*. Explicitly disclosed what this does NOT prove: Supabase
     Auth's own JWT-level ban (`ban_duration`) is a hosted-Supabase
     mechanism with no local equivalent to test — still blocked. Checked
     for alternative/bulk status-changing paths: `lib/import-engine/
     importer.ts`'s bulk employee CSV update path does write `employees.
     status`, but the import template's enum (`templates.ts`) only allows
     `active`/`inactive` and the validator (`validator.ts`) rejects any
     other value including `separated` — confirmed this path cannot reach
     the transition that needs revocation, so it is not a gap. Confirmed
     reactivation is NOT automatic: grepped every `profiles` write of
     `is_active: true` in the entire API — the only one outside account
     creation (`setup.ts`) is the explicit, HR-admin-gated `PATCH
     /employees/:id/user-account` (`action: 'reactivate'`); no code path
     revives a separated employee's login as a side effect of anything else.
  3. **Concurrent /setup tested through the real stack, not just Postgres
     in isolation.** Rebuilt the local sandbox stack (Postgres 16 + the
     PostgREST-compatible gateway shim + the compiled API server, all
     re-verified running — see Verification evidence below) and wrote
     `scripts/db/verify-setup-concurrency-live.mjs`, which fires genuinely
     concurrent HTTP `POST /setup` requests at the real API and checks the
     real database afterward: exactly one profile/tenant pair, both callers
     agree on the same tenant, zero orphaned tenant rows, a real
     interrupted-retry (20 minutes later, past the freshness window,
     recovered via the real metadata-match path — not simulated) returns
     the SAME tenant/profile with no duplicate, and a stranger who only
     knows the `user_id` is still refused for an existing profile. Along
     the way, patched the local-sandbox-only gateway shim (disclosed, not
     a product change) to actually persist and return `user_metadata` on
     `/auth/v1/admin/users` — it previously always returned `{}`, which
     would have made this round's new interrupted-retry test pass for the
     wrong reason (freshness only) instead of exercising the real
     metadata-match code path `setup.ts` relies on for a late retry.
  4. **Browser-tested both dashboard "Process Attendance" actions, real
     Chromium via Playwright** — `scripts/db/browser-test-attendance-
     processing.mjs`, run against a freshly seeded 4-role tenant
     (`scripts/pilot/seed-pilot-tenant.mjs`, reused unmodified). For both
     `super_admin` and `hr_admin`: real login → real dashboard → click the
     real "Process Attendance" quick action → lands on
     `/manager/team/attendance` → the real trigger button is visible →
     clicking it fires a real `POST /attendance/process` → **200,
     persisted result visible on screen** ("Processing Complete" banner,
     screenshotted). For `employee`: the quick action is correctly absent
     from whatever dashboard this role gets, AND — to prove server-side
     enforcement independent of the UI hiding it — the test captures this
     role's own real bearer token from its ordinary traffic (not
     fabricated) and fires a direct `POST /attendance/process` with it:
     **403 FORBIDDEN, "hr_admin or super_admin required"**. Screenshots in
     `/tmp/attendance-browser-evidence/` (not committed — ephemeral local
     evidence, re-creatable by re-running the script).
- **Checkpoint 4** (this commit): the user explicitly authorized larger
  30-50-file batches with the full item-2 checklist against each, in the
  stated execution order (Employees → Attendance/Leave/Approvals →
  Payroll/Statutory/F&F → Masters/Onboarding/Recruitment/Assets →
  ESS/Manager/Admin/Owner → shared infra). This batch **completes item 1,
  the Employees module** — every remaining file read this round:
  `personal-info.ts`, `identity.ts`, `bank-statutory.ts`, `contracts.ts`,
  `employee-documents.ts`, `addresses.ts`, `education.ts`,
  `emergency-contacts.ts`, `family.ts`, `exit-interview.ts`,
  `important-dates.ts`, `nominations.ts`, `passport-visa.ts`,
  `previous-employment.ts`, `shift-history.ts`, `full-create.ts`,
  `full-profile.ts`, `job-history.ts`, `manager.ts`, `access-cards.ts`,
  `onboarding-status.ts`, `options.ts`, `org-context.ts`, `trust.ts`,
  `context-data.ts`, `separation.ts`, and the non-F&F sections of
  `separation-workflow.ts` (clearances, approve/advance/relieve/archive,
  gratuity-config, clearance-departments — its F&F sections were already
  extensively audited and fixed across several prior rounds, see the G12/
  F&F history in CLAUDE.md, and were not re-derived here).
  **One real, confirmed defect found and fixed**: `context-data.ts`'s
  three endpoints (`/employees/:id/attendance`, `/overtime`, and —
  critically — `/payroll-summary`, which returns CTC/net pay/total
  deductions) were gated only on `MANAGER_ROLES` (any `manager`, `hr_admin`
  or `super_admin`), with **no check that the target employee was actually
  in the caller's team** — any manager in the tenant could pull any other
  employee's compensation summary by guessing/enumerating employee UUIDs,
  not just their own reports'. Fixed using the exact `isDirectReport`/
  `getDirectReportIds` pattern already established elsewhere in this
  codebase (`manager-scope.ts`, used by overtime/comp-off/separation
  clearance) — HR admins still bypass, a manager now has to actually be in
  the target employee's reporting chain. 6 new tests, including the
  payroll-summary case specifically since it's the most sensitive of the
  three. Everything else read in this batch (~26 files) was already
  correctly tenant-scoped, FK-cross-tenant-checked, CAS-versioned, and
  (where applicable) storage-path-prefix-validated — no further defects
  found. The Employees module status below is now genuinely complete, not
  partial.
- **Checkpoint 5** (this commit): the user correctly pushed back on
  checkpoint 4's `payroll-summary` fix on three specific points, all
  addressed:
  1. **Team membership alone doesn't establish the right compensation
     policy.** Checkpoint 4 scoped `payroll-summary` to the caller's full
     subordinate tree (`getDirectReportIds`), the same check used for
     attendance/overtime. That's too wide for compensation specifically:
     `manager-compensation.ts` (Program 5 · P5.3) — the one other place in
     this codebase that defines what a manager may see of compensation
     data — deliberately scopes to immediate direct reports only
     (`employees.manager_id === callerEmpId`). Narrowed `payroll-summary`
     to match exactly, via a new `canAccessCompensation` helper separate
     from the `canAccessEmployee` helper attendance/overtime still use.
     A manager-of-managers can now see a grandchild report's attendance/
     overtime (operational visibility, intentionally broad) but NOT their
     CTC/net pay (compensation visibility, intentionally narrow) — proven
     with a dedicated grandchild-vs-direct-report test case.
  2. **"Employees complete" now means source-review complete, stated as
     such**, with browser/database coverage recorded separately rather
     than implied by the module-level status cell — see the per-type
     breakdown added to the Employees row and to the Verification
     evidence section below. F&F's reliance on prior-round evidence
     (not freshly re-reviewed this round) is now stated explicitly rather
     than left implicit in a parenthetical.
  3. **Added the three requested authorization test cases**: (a) a
     reassignment test proving the FORMER manager loses `payroll-summary`
     access the moment `employees.manager_id` changes (read live, not
     cached) and the NEW manager gains it in the same instant; (b) a
     cross-tenant test proving an employee that exists only in a
     different tenant is refused, not silently matched; (c) a manager
     role with no linked `employee_id` (an unlinked profile) is refused
     rather than falling through to an unintended allow. 16 tests total in
     the file now (up from 6), covering both the attendance/overtime
     policy and the now-separate, narrower payroll-summary policy.
- **Checkpoint 6** (this commit): started item 2's batch — Attendance,
  Leave, comp-off and Approvals — per the user's explicit steering
  ("Continue the Attendance/Leave/Approvals batch now... Keep progressing
  through the existing audit plan without stopping at checkpoints").
  **Fully read**: `routes/attendance/leave-requests.ts` (733 lines — every
  handler), `lib/leave-request-service.ts` (full — create/get/list/cancel),
  `lib/approval-service.ts` (full — leave + regularisation approve/reject/
  reverse, the multi-level gate, the PEND-94 policy-mismatch/backdated/
  self-approved computation, `getPendingApprovalsForManager`). **Partially
  read, scope-check only** (the manager-visibility helper each file's
  manager branch calls, not every handler in the file): `routes/attendance/
  overtime.ts`, `routes/attendance/comp-off.ts`, plus the `GET /leave-
  requests` and `GET /approvals/pending-count` manager-scope branches
  cross-checked against them. **Not opened this batch**: every other file
  in the 64-file `routes/attendance` directory (shifts, rosters, holidays,
  wo-credit, punch, corrections, retroactive, period-locks, muster, and
  the ~45 others) and both files in `routes/approvals`
  (`governance-evolution.ts`, `workflows.ts`) — carried forward as
  genuinely unexamined, not implied by this batch's "Leave/Approvals"
  label.

  **Found and fixed a real, confirmed defect — the same class checkpoint 5
  found in `context-data.ts`'s `payroll-summary`, now in the approval
  queues**: four manager-facing "pending work" surfaces scoped themselves
  to the caller's FULL subordinate tree (`getDirectReportIds`, any depth)
  while the matching approve/reject/cancel-approval action on the exact
  same item authorizes only the employee's IMMEDIATE manager
  (`validateApprover` for leave/regularisation, `authorizeOtTarget` /
  `authorizeCompOffTarget` for overtime/comp-off — all one-level
  `isDirectReport` checks). Traced end-to-end into the web app
  (`ApprovalInbox.tsx` embeds `ManagerTeamOvertimeRequests.tsx` and
  `ManagerTeamCompOff.tsx` directly as its Overtime/Comp-off tabs) to
  confirm this is not theoretical: a manager-of-managers would see a
  grandchild report's pending item with a clickable Approve button in
  their own Approvals inbox, and clicking it would always 403. Fixed four
  call sites — `GET /overtime/requests` (manager branch),
  `GET /attendance/comp-off` (manager branch), `GET /approvals/pending-
  count` (the sidebar/header badge, all four tables), and `GET /leave-
  requests?status=APPROVED` with no `employee_id` (the Approved tab behind
  cancel-approval) — by adding a new shared helper, `getImmediateReportIds`
  (`lib/manager-scope.ts`), the one-level counterpart to the existing
  `getDirectReportIds`/`isDirectReport`, and pointing all four at it instead
  of the deep-tree helper. Read-only/historical team visibility (attendance,
  overtime list-by-employee-filter in the admin OT screen, `GET
  /overtime/requests/:id` and the equivalent leave single-record read) is
  unaffected by design — that deliberately stays on the full tree, per the
  same "broad view, narrow act" distinction checkpoint 5 established for
  compensation. 2 new route-level tests (`leave-requests-approvals-scope.
  test.ts`, three-level hierarchy, proves pending-count and the Approved
  tab both exclude a grandchild) + 3 new unit tests for the new helper
  (`manager-scope-immediate-reports.test.ts`) + full existing attendance
  suite re-run (80 tests across 8 files, 0 regressions) + `tsc --noEmit`
  clean on `apps/api`.

  **Same checkpoint, one more file**: read `routes/attendance/
  regularisation.ts` in full (all 9 routes). Found the same defect class a
  third time: `bulk-approve`/`bulk-reject`'s ownership guard — whose own
  comment says "every request in the batch must belong to a direct
  report" (P6.5) — used `getDirectReportIds` (the full tree), so a batch
  containing a grandchild's request passed the guard, then failed later
  per-item with an unrelated-looking FORBIDDEN from `approveRegularisation`/
  `rejectRegularisation`'s own `validateApprover` check. Not a security
  hole (the per-item call still correctly refused it) but a real
  correctness bug relative to the guard's own stated intent, and a
  confusing partial-batch-failure UX. Fixed both call sites to
  `getImmediateReportIds`; 3 new route tests (`regularisation-bulk-scope.
  test.ts`) proving a grandchild-only batch now 403s cleanly at the gate
  (never reaching the mocked approve/reject call) and a direct-report-only
  batch still succeeds. `GET /attendance/regularisation/team` was already
  correctly immediate-only (`.eq('manager_id', ...)` directly, no helper
  needed) — no fix there. Full suite re-run: 561/561 passed, 67/67 files,
  0 regressions; `tsc --noEmit` clean.

  **Correction (this commit) — the "leave.ts is dead code" conclusion
  below was wrong, and the user caught it**: "No frontend caller does not
  prove an API is unreachable. Check whether these routes are registered.
  If they are, test direct HTTP access and either retire them explicitly
  or validate their consistency with the canonical leave flow." The
  reasoning that follows (frontend comments, 9 files) was real but
  insufficient — it never checked whether the route file is actually
  *registered* on the running server, which is the only thing that
  determines HTTP reachability. It is: `src/index.ts:837` —
  `await fastify.register(attendanceLeaveRoute)  // /attendance/leave/*`.
  Confirmed live over **real HTTP** against the real compiled API server
  (not Fastify inject, not a mock) — `scripts/db/verify-legacy-leave-http.mjs`:
  `POST /attendance/leave/apply` → 201, and the resulting row is readable
  straight out of `leave_applications` in real Postgres. Any authenticated
  caller can still reach this table-level flow directly, regardless of
  what the current frontend calls.

  That real-HTTP check is what surfaced a genuine, distinct defect: this
  legacy approve handler had **no hard period-lock block** — unlike the
  canonical flow (`approveLeaveRequest`/`approveRegularisation`), which
  refuses outright once the affected month is locked, this file only had a
  non-blocking "payroll freeze guard" further down that let the approval
  proceed anyway and queued a best-effort reconciliation adjustment
  afterward. Fixed to mirror the canonical hard block exactly (checked
  before any balance/attendance mutation). Proved against real Postgres,
  not just a mock: inserted a real `attendance_period_locks` row for
  `2099-03` with `state='LOCKED'`, called `POST /attendance/leave/:id/approve`
  over real HTTP → **409 PERIOD_LOCKED**, confirmed via a fresh read-back
  that the row's status stayed `'pending'`; reopened the period and
  retried → the pre-existing path proceeds unaffected (reached the balance
  check, same as before this change — it failed there for an unrelated
  reason, no leave balance was seeded for this synthetic employee, which
  is itself further proof the new guard isn't what's blocking it).

  Not resolved, flagged for an explicit product decision rather than
  decided unilaterally: whether to **retire** this legacy
  `leave_applications` pathway outright (its remaining feature gaps
  relative to the canonical flow — no multi-level approval chain, no
  PEND-94 self-approval/backdated/policy-mismatch computation, no
  application-window governance — would take rebuilding most of
  `approval-service.ts` a second time against a table nothing else reads)
  or to leave it live as a legacy fallback now that its one safety-
  critical gap (period-lock) is closed. That decision is explicitly left
  open, not assumed.

  **Verification, by evidence type — corrected and extended per the
  user's explicit requirement to keep this register honest about tier**:

  | Evidence type | What's covered |
  |---|---|
  | Source review | All 4 fixed call sites (pending-count, leave Approved tab, overtime queue, comp-off queue) + regularisation bulk guards + full read of `leave.ts` |
  | Mocked route-level tests | 8 new route-level test files covering grandchild exclusion, reassignment (both directions), cross-tenant refusal, unlinked-manager refusal, bulk atomicity (zero items changed on any unauthorized id), and preserved HR-admin access, for: leave pending-count, leave Approved tab, the overtime queue, the comp-off queue, and regularisation bulk-approve/reject. Full suite: 599/599 passed, 70/70 files, 0 regressions; `tsc --noEmit` clean on `apps/api`. |
  | **Real Postgres + real HTTP** (new this round) | Rebuilt the local stack (Postgres 16 `hrms_uat`, the gateway shim, the freshly-rebuilt compiled API, the Vite web dev server — all survived from earlier in this session and were restarted, not recreated). `scripts/db/seed-scope-verify-tenant.mjs` creates a genuine 3-level hierarchy (HR_ADMIN; MGR_TOP = manager-of-managers; MGR_MID = MGR_TOP's direct report and EMP's actual manager; EMP) in a fresh tenant with one real pending leave/overtime/comp-off/regularisation row each, then drives the real API over real HTTP: **MGR_TOP's `/approvals/pending-count` reads all-zero and every list (`/approvals/pending`, `/overtime/requests?status=PENDING`, `/attendance/comp-off?status=pending`) is empty; MGR_TOP's direct approve/reject attempts on all three actionable types each return 403; MGR_MID sees exactly 1 of each and successfully approves the overtime and comp-off requests, persisted-read-back-confirmed in Postgres (`approved_by`/`reviewed_by` = MGR_MID's real user id); HR_ADMIN sees and can act on everything tenant-wide.** `scripts/db/verify-legacy-leave-http.mjs` adds the leave.ts period-lock proof described above. Both scripts are committed for reuse, not throwaway. |
  | **Live browser** (new this round) | `scripts/db/browser-verify-approvals-scope.mjs` (Playwright, the pre-installed Chromium) drives a REAL login (email+password through the actual `/login` page) for each of MGR_TOP, MGR_MID, and HR_ADMIN against the same seeded tenant, navigates to the real Approval Inbox page (`/manager/approvals` / `/admin/approvals/inbox`), and screenshots the result — sent to the user as 3 PNGs. **MGR_TOP's page reads "No pending approvals — All items have been reviewed," sidebar badge blank. MGR_MID's page shows "Approvals 2," "Leave Requests (1)" and "Attendance Corrections (1)" with the real employee's row and working Approve/Reject buttons. HR_ADMIN's page shows the same 2 items tenant-wide plus a notification banner.** This is the same employee's same pending items in every screenshot — the only variable is which manager is logged in. |

  This is now the first batch in this audit with genuine real-Postgres,
  real-HTTP, *and* live-browser evidence for an authorization-scope fix,
  not just mocked route tests — the bar the user has been holding this
  register to since checkpoint 2.
- **Next planned batches** (not yet started — listed so a future session
  picks up here, not from zero): continue item 2's batch — the remaining
  ~60 unopened `routes/attendance` files (tier 1 next: `leave.ts`,
  `leave-employee.ts`, `leave-entitlement.ts`, `leave-accrual.ts`,
  `leave-accrual-lifecycle.ts`, `leave-reconciliation.ts`,
  `leave-collision.ts`, `leave-duration.ts`, `leave-policy-resolve.ts`,
  `regularisation.ts`, `regularisation-policy.ts`; tier 2: punch/
  corrections/overtime's non-scope sections/recompute/retroactive/
  period-locks; tier 3: rosters/shifts/holidays/wo-credit) and
  `routes/approvals/governance-evolution.ts` + `workflows.ts`. Then item 3 —
  Compensation,
  Payroll, statutory calculations, reimbursements, loans/advances, F&F and
  accounting (much of this has prior-round coverage per CLAUDE.md, but
  has not been re-verified against this round's full item-2 checklist).
  Then items 4-6 per the user's stated execution order: Masters/
  organization/positions/onboarding/recruitment/assets/documents; ESS/
  manager/admin/owner portals + dashboards/reports/imports/notifications/
  support/integrations; shared infrastructure and cross-module
  interactions. Also recommended, not yet done: delete the confirmed-100%-dead
  `AdminDashboard.tsx` / `Dashboard.tsx` (zero route registrations,
  verified above) — flagging rather than deleting this round since the
  session's own destructive-action guard declined the delete.

**Scale disclosure, stated up front so it isn't mistaken for completion:**
the API has **289 route files** across **52 route namespaces**; the web
app has **40+ page directories** and **168 registered navigation entries**
(`nav-config.ts`). A literal line-by-line pass over every file against
every category in item 2 (API method/path/query/body/response mismatches;
role/tenant/object-level authorization; pagination/numeric/date/retry
handling; upload/download privacy; approval/cancellation/reversal rules)
is not something one audit round can close — it is explicitly **not
claimed as complete here**. What follows is an honest per-module status,
not a clean bill of health.

Legend: **Tested** = concrete fix + automated test + (where applicable)
real-Postgres or local-gateway verification this round or a prior
documented round. **Partially tested** = some but not all of item 2's
categories were examined. **Not examined** = no work done on this module
in this audit; status unknown, carried forward from before this audit
started.

| Module (route namespace / page area) | Status | Notes |
|---|---|---|
| **Setup / account provisioning** (`routes/__tests__/setup.test.ts`, `pages/auth`) | Tested | Anti-hijack IDOR fixed this round (ownership guard now runs before BOTH the idempotent-return and create paths); 5 tests incl. 2 negative/disclosure tests proving zero `profiles` reads on a refused request. |
| **Pilot guard** (`lib/pilot-guard.ts`) | Tested | Fail-open→fail-closed fixed this round for null/undefined/string/number `is_pilot` values; 10 tests. Fixed resulting regressions in 3 unrelated payroll test mocks. |
| **Support / feedback** (`routes/support`) | Tested | Screenshot-path tenant-folder validation added this round (write side); 5 tests. |
| **Owner admin** (`routes/owner`, `pages/owner`) | Partially tested | Screenshot-signing independent re-validation fixed this round (read side, incl. pre-existing invalid records); 5 tests. Owner route nav links spot-checked (nested `/owner/*` routes resolve correctly). Platform-admin authorization on other `/owner/*` endpoints (activate/suspend/cancel/hard-delete) not re-audited this round — last verified in the tenant-licensing work recorded in CLAUDE.md. |
| **Attendance** (`routes/attendance`, `pages/attendance`) | Partially tested | Nav links fixed: `EmployeeShifts.tsx` dead `<a href="/shift-master">` → `<Link to="/admin/shift-master">`; `MusterRoll.tsx`'s `/admin/payroll/readiness` → `/admin/payroll-readiness`. **Admin attendance-processing gap closed for real, on the actually-reachable pages this time** (checkpoint 3; checkpoints 1–2 fixed the correct behavior on `AdminDashboard.tsx`, which turned out to be 100% dead code — see the checkpoint 3 writeup above). The backend (`apps/api/src/routes/attendance/process.ts`) already correctly authorizes `hr_admin`/`super_admin` and needed no fix. Fixed the real live call sites: `pages/admin/ControlCenter.tsx` (the "Process now" banner button and the "Process Attendance" quick action, both previously → `/admin/attendance/center`, confirmed to have no trigger button) and `components/operational/CommandPalette.tsx`'s global "Process Attendance" command (same dead-end target). All three now point at `/manager/team/attendance`, where `Attendance.tsx` unconditionally renders the real trigger button for `isAdmin` roles. **Proven end-to-end in a real Chromium browser** (`scripts/db/browser-test-attendance-processing.mjs`): real login → real dashboard click → real visible button → real `POST /attendance/process` → 200 → "Processing Complete" banner visible on screen, for both `super_admin` and `hr_admin`; `employee` never sees the control AND is refused 403 when a direct API call is made using that role's own real captured session token. API-level correctness (processing idempotency, anomaly reconciliation) last verified in the Round 2026-10-11 de-emphasis work and the earlier UAT scenario matrix (W/WO/H/X/P/L-series), not re-run this round. |
| **Payroll** (`routes/payroll`, `pages/payroll`) | Partially tested | Nav links fixed: 3 call sites (`WorkflowRecommendations.tsx`, `OperationalInboxV2.tsx`, `PayrollContextPanel.tsx`) hardcoded `/admin/payroll/blockers` with no `:runId` — none of their data sources carry a `run_id` (`PayrollContextPanel`'s blockers are month-aggregated, not run-scoped), so each now falls back to the runs list `/admin/payroll`, matching the pattern `PayrollOperationsCenter.tsx` and `navigation.config.ts` already use correctly. `AdminDashboard.tsx`'s "Compliance" quick action pointed at the real `/admin/payroll/statutory-dashboard` ("Compliance Cockpit") instead of the non-existent `/admin/compliance`. Approval/finalization/reversal correctness, F&F, leave encashment — extensively tested in prior rounds (G12, F&F concurrency, accounting-ledger fixes); not re-run this round. |
| **Leave** (`routes/attendance/leave-requests.ts`, `lib/leave-request-service.ts`, `lib/approval-service.ts`, `routes/attendance/leave.ts`; `pages/leave`, `pages/ess` leave) | Partially tested | **Checkpoint 6**: `leave-requests.ts` + both service files read in full. Found + fixed a real authorization-scope defect: the Approved-tab list behind the cancel-approval action (`GET /leave-requests?status=APPROVED`, manager, no `employee_id`) and the `/approvals/pending-count` badge both scoped via the full subordinate tree while the actual cancel/approve/reject action is immediate-manager-only — narrowed both to the new `getImmediateReportIds` helper. **Upgraded to real-Postgres + real-HTTP + live-browser evidence** (see the batch-log entry above): a genuine 3-level hierarchy proves the manager-of-managers sees zero pending items and is refused 403 on direct action, the real immediate manager sees and can act on them, HR sees everything — screenshotted live in the browser. Also read `routes/attendance/leave.ts` in full: confirmed live/reachable over real HTTP (it is registered, not dead code — an earlier conclusion in this same checkpoint was wrong and corrected per the user's explicit catch), and found + fixed a real gap there too — its legacy approve handler had no hard period-lock block, unlike the canonical flow; fixed and proved 409 against a real locked-period row in Postgres. Everything else in `leave-requests.ts`/the two service files (overlap-check fail-closed, period-lock recheck on approve/reverse, per-calendar-year balance bucketing, the elapsed-range reversal guard, the multi-level approval gate, self-approval guards, idempotency-key handling) was read and found already correct — carries forward from prior rounds' PEND-94/PEND-103/PEND-105/ISSUE-144/etc. fixes, not newly defective, but also not independently re-verified against real Postgres this round. The other ~15 `routes/attendance/leave-*.ts` files (accrual, entitlement, duration, reconciliation, collision, policy-resolve, jobs, scheduler-status) are **not yet opened**. Raise-leave-on-behalf, standalone encashment — previously tested (G12, prior rounds), not re-run this round. **Open product decision, not yet resolved**: whether to formally retire `leave.ts`'s legacy `leave_applications` pathway now that its one safety-critical gap is closed, or keep it as a (still feature-incomplete relative to canonical) fallback. |
| **Employees / People Directory** (`routes/employees`, `pages/employees`) | **Source review complete — see verification breakdown below, not "fully tested"** | **Checkpoints 2+4+5: all ~30 route files read against the item-2 checklist** (tenant scoping, object/team-level authorization, FK cross-tenant validation, CAS/optimistic concurrency, storage-path privacy, approval/reversal correctness). This status means the *source* has been read end-to-end — it does NOT mean every file has browser or real-Postgres evidence; see the explicit per-type breakdown immediately below the table-closing note. Two real defects found and fixed: (1) `PUT /employees/:id` could set `status: 'separated'` without revoking auth access — checkpoint 2 (3 tests). (2) `context-data.ts`'s attendance/overtime/**payroll-summary** endpoints were gated on role only (`MANAGER_ROLES`), not on team membership — checkpoint 4 fixed attendance/overtime using `getDirectReportIds` (full subordinate tree, matching `team-assets.ts`/`team-helpdesk.ts`/`team-regularisation-context.ts`'s established operational-visibility policy); checkpoint 5 then corrected `payroll-summary` specifically, after the user flagged that team membership alone doesn't establish the right *compensation* policy — `manager-compensation.ts` (Program 5 · P5.3, the one other place in this codebase defining manager-visible compensation) deliberately scopes to **immediate direct reports only**, narrower than the subordinate-tree check. Reusing the broader check for payroll-summary would have let a manager-of-managers see a grandchild report's CTC — now fixed to mirror the direct-only policy exactly. 16 tests total, including the direct-vs-grandchild distinction, reassignment (both the former manager losing access and the new manager gaining it, read live off `employees.manager_id`, not cached), cross-tenant requests, and a manager role with no linked employee record. Every other file in the module (`index.ts`, `user-account.ts`, `personal-info.ts`, `identity.ts`, `bank-statutory.ts`, `contracts.ts`, `employee-documents.ts`, `addresses.ts`, `education.ts`, `emergency-contacts.ts`, `family.ts`, `exit-interview.ts`, `important-dates.ts`, `nominations.ts`, `passport-visa.ts`, `previous-employment.ts`, `shift-history.ts`, `full-create.ts`, `full-profile.ts`, `job-history.ts`, `manager.ts`, `access-cards.ts`, `onboarding-status.ts`, `options.ts`, `org-context.ts`, `trust.ts`, `separation.ts`, `separation-workflow.ts`'s non-F&F sections) was read and found already correctly tenant-scoped, FK-cross-tenant-checked, CAS-versioned and storage-path-validated. Much of it carries explicit comments from prior audit rounds ("Fresh audit finding", "P6.0d — ownership guard") — **those comments are supporting context for where to look, not proof of current correctness**; this round read the live code behind each comment rather than trusting the comment's claim, which is exactly how the `context-data.ts` gap (no such comment existed there) and the payroll-summary scope-width issue (the existing fix's own comment claimed a pattern match that wasn't quite right) were actually found. **F&F reliance, stated explicitly, not implied**: `separation-workflow.ts`'s F&F sections (~lines 416–972) were **not re-reviewed this round** — F&F's current correctness rests on the prior documented rounds (G12, F&F concurrency, accounting-ledger fixes per CLAUDE.md), which is prior evidence, not fresh verification. `probation-confirmations.ts` likewise relies on its own dedicated test file from a prior round, not a fresh read this round. |
| **Approvals** (`routes/approvals`, `routes/attendance/overtime.ts`+`comp-off.ts`'s approval queues, `routes/attendance/regularisation.ts`'s bulk guards, `pages/attendance/ApprovalInbox.tsx`) | Partially tested | `Settings.tsx`'s Governance Matrix link fixed (`/admin/approvals/governance` → `/admin/approvals/governance-matrix`). `OperationalInbox.tsx`'s stale `/approvals/inbox` → `/admin/approvals/inbox` fixed (prior turn, this audit). **Checkpoint 6**: found + fixed the overtime/comp-off half of the same scope-mismatch defect described in the Leave row above — `GET /overtime/requests` and `GET /attendance/comp-off`'s manager branches narrowed from the full subordinate tree to `getImmediateReportIds`, matching `authorizeOtTarget`/`authorizeCompOffTarget`'s real one-level authority; traced into `ApprovalInbox.tsx` to confirm these two files are its embedded Overtime/Comp-off tabs, not a separate unused list — **confirmed live in the real browser**: a manager-of-managers' Approval Inbox genuinely shows "No pending approvals" while the real immediate manager's shows the actual pending items with working Approve/Reject (3 screenshots, real login, real tenant). Also found + fixed `regularisation.ts`'s `bulk-approve`/`bulk-reject` ownership guard, which used the same too-broad helper despite its own comment promising immediate-report-only scope — narrowed, with a mixed-batch test proving zero items are touched when any one id is unauthorized. `routes/approvals/governance-evolution.ts` and `workflows.ts` (the dedicated approvals namespace, as opposed to the per-domain approve/reject actions checked here) are **not yet opened** — still relies on the prior UAT-round verification recorded in CLAUDE.md/STATUS.md. |
| **Masters / Org structure** (`routes/masters`, `pages/masters`) | Partially tested | `OrgGovernancePanel.tsx`'s 6 stale `/masters/*` nav calls fixed → `/admin/masters/*` (prior turn, this audit). No further audit this round. |
| **Settings** (`pages/settings/Settings.tsx`) | Tested (nav only) | "Coming soon" badge on Session & Auth Policy now actually disables the card (was cosmetic-only — fully clickable to a dead route). Data Explorer, Leave Accrual Jobs, Governance Matrix links fixed. Rest of Settings (webhooks, integrations, AI provider config, billing) not independently re-audited. |
| **Dashboard** (`pages/dashboard/AdminDashboard.tsx`) | Partially tested | 3 stale nav targets fixed (`/admin/compliance`, `/admin/attendance/process` ×2, `/admin/leave/types`). **Known gap, disclosed not fixed:** the "Process Attendance" / "Process now" actions now land on `/admin/operational-health` (a real, registered admin page) but that page is read-only observability — it shows processing status/last-run/anomaly funnel, it does **not** have a button to trigger a new processing run. The only UI with that trigger (`POST /attendance/process`) is `Attendance.tsx`, registered solely at the manager-facing route `/manager/team/attendance`. This is a genuine product gap (no admin-facing manual-trigger UI), not a renamed link — flagged for a product decision rather than silently invented. |
| **Recruitment / Careers** (`routes/recruitment`, public `careers` routes, `pages/recruitment`, `pages/careers`) | Not examined this round | Public careers intake built and tested in the market-readiness round recorded in CLAUDE.md. No new audit this round. |
| **Documents** (`routes/documents`, `pages/documents`) | Not examined this round | — |
| **Assets** (`routes/assets`, `pages/assets`) | Not examined this round | F&F asset-recovery integration tested in a prior round; general asset CRUD/authorization not independently re-audited. |
| **Compensation** (`routes/compensation`, `pages/payroll` compensation screens) | Not examined this round | — |
| **Compliance / Statutory** (`routes/compliance`, `pages/payroll` statutory screens) | Not examined this round | PT/TDS slab correctness tested in a prior UAT round; no new audit this round. |
| **ESS** (`pages/ess`) | Not examined this round | Context Rail is explicitly frozen per CLAUDE.md — out of scope by design, not an audit gap. |
| **Manager** (`pages/manager`, `routes/manager`) | Not examined this round | — |
| **Executive** (`pages/executive`, `routes/executive`) | Not examined this round | — |
| **Reports / Analytics / Insights** (`routes/analytics`, `routes/reports`, `pages/reports`, `pages/insights`) | Not examined this round | — |
| **Notifications / Operational Inbox** (`routes/notifications`, `pages/notifications`) | Partially tested | `OperationalInbox.tsx` and `OperationalInboxV2.tsx` nav fixes (above). Backend notification delivery/dedup not audited. |
| **Integrations / Fabric / Imports / Workforce / Trust / Governance / Helpdesk / Signal-intelligence / Community / Talent / Succession / Onboarding / Benefits / Positions / Enterprise / System / Security / Workspace / Mood / Certifications / WhatsApp / Billing** (remaining route namespaces) | Not examined this round | No audit activity. Listed explicitly per the user's instruction not to leave modules silently unmentioned. |
| **Dead code found, not fixed** | Disclosed | `components/feeds/ActivityFeed.tsx` has zero import sites anywhere in `apps/web/src` (confirmed via grep) and contains a stale `navigate('/operations/timeline')` call to a route that doesn't exist under any name. Left unfixed because the component is unreachable — fixing a nav target inside dead code would be guessing at intent for code nothing renders. Recommend deletion in a follow-up if confirmed truly unused. |

## Verification evidence, by category (separated per the user's instruction)

**Source inspection** (read, not executed): every nav-link fix was checked against an actual `<Route>` in `App.tsx` before being used, rather than guessed; `attendance/process.ts`'s role-gating and `Attendance.tsx`'s `isAdmin` rendering were read directly to confirm the admin-processing fix is real, not cosmetic; `ManagerShell.tsx` was read to confirm it does not block admin roles from `/manager/team/attendance`.

**Mocked unit/route tests** (`npx vitest run` on `apps/api`):
- Checkpoint 1: 494/494 passed, 59/59 files.
- Checkpoint 2: 526/526 passed, 61/61 files, 0 regressions — adds the feedback-screenshot-path allowlist unit tests (17), the hardened route-level bypass tests (9 + 9 new cases across the support/owner screenshot-path tests), the setup.ts interrupted-retry/USER_NOT_FOUND/validation/concurrency tests (4 new), and the PUT /employees/:id revocation regression (3 new).
- Checkpoint 3: **537/537 passed, 63/63 files**, 0 regressions — adds `revokeEmployeeAuth`'s first-ever direct unit tests (7, including 2 retry scenarios) and the real-`authenticate`-preHandler is_active-rejection tests (4).
- `npx tsc --noEmit` on both `apps/web` and `apps/api` — **0 errors** on both, every checkpoint including this one (re-run after the `ControlCenter.tsx`/`CommandPalette.tsx` fixes).

**Employees module (checkpoints 2/4/5), coverage by type — explicit per the user's instruction not to let a module-level "complete" status imply more than source review provides:**

| Evidence type | Status | What it covers |
|---|---|---|
| Source review | **Complete** — all ~30 route files read | Every file against the item-2 checklist (tenant scope, authorization, FK validation, concurrency, storage-path privacy) |
| Mocked unit/route tests | **Done for both defects found** | `revokeEmployeeAuth`/is_active-rejection (checkpoint 3, 11 tests), `context-data.ts` team/compensation scoping (checkpoint 4+5, 16 tests) — zero for the ~28 files where no defect was found, since there was nothing to regression-test |
| Real Postgres | **Not done for Employees specifically** | The real-Postgres/real-stack work this round (setup.ts concurrency) was a different module; no Employees-specific DB round-trip was run |
| Browser | **Not done for Employees specifically** | No Employees-module browser journey was run this round; the browser evidence in this register is for the Attendance-processing fix, a different module |
| F&F sections of `separation-workflow.ts` | **Relies on prior-round evidence, not re-reviewed this round** | Covered across several prior documented rounds (G12, F&F concurrency, accounting-ledger fixes, CLAUDE.md) — that is prior evidence being relied upon, not fresh verification in this round |

**Real Postgres**, checkpoint 2 (isolated): a minimal `profiles`/`tenants` schema was created and two genuinely concurrent `psql` transactions were raced against the same `profiles.id` primary key, confirming SQLSTATE 23505. The user correctly noted this alone doesn't prove the whole workflow — superseded by checkpoint 3's live-stack test below, kept as evidence that the raw Postgres-level assumption was independently verified before building on it.

**Real stack, checkpoint 3** (Postgres 16 + the PostgREST-compatible gateway shim + the compiled, freshly-rebuilt API server, all brought up this round — `pg_ctlcluster 16 main start`, `node /tmp/supabase-gateway.mjs`, `node --env-file=.env dist/index.js`; the `hrms_uat` database and its full migration history survived from earlier in this session): `scripts/db/verify-setup-concurrency-live.mjs` fires real, concurrent HTTP `POST /setup` requests at the real API and inspects the real database afterward — **all 4 checks pass**: exactly one profile/tenant pair survives the race with both callers agreeing on it, zero orphaned tenant rows, a real 20-minutes-later interrupted retry recovers the same tenant/profile via the genuine metadata-match code path (not simulated — the gateway shim was patched to actually persist `user_metadata`, which it previously discarded), and a stranger who only knows the `user_id` is still refused for an existing profile. This script is committed (not a throwaway) so a future session can re-run it without rebuilding the test.

**Local browser journeys, checkpoint 3**: real Chromium (Playwright, the environment's pre-installed browser) against the live stack above, `scripts/db/browser-test-attendance-processing.mjs`, run against a freshly seeded 4-role tenant. Found and fixed the dead-code misdirection described in the checkpoint 3 batch log above as a direct result of this browser run (the test's first pass navigated to the WRONG page and immediately surfaced that checkpoints 1–2 had fixed unreachable code). After the fix: super_admin and hr_admin both get navigation → visible control → real processing → a persisted "Processing Complete" result visible on screen (screenshotted); employee gets neither the control nor server-side permission. This script is also committed for re-use. Screenshots are ephemeral (`/tmp/attendance-browser-evidence/`, not committed) — re-run the script to regenerate them.

**Real stack + real HTTP + live browser, checkpoint 6** (same stack as checkpoint 3, restarted this round — `pg_ctlcluster 16 main start`, the gateway shim, a freshly-`npm run build`'d API with this checkpoint's own source changes, and the Vite web dev server; `hrms_uat` and all committed scripts survived from earlier in this session): this is the direct response to the user's explicit demand for real-Postgres/real-HTTP/browser evidence for the manager-scope fix, not just mocked route tests.
- `scripts/db/seed-scope-verify-tenant.mjs` creates a genuine 3-level hierarchy (HR_ADMIN; MGR_TOP = manager-of-managers; MGR_MID = MGR_TOP's direct report and EMP's real manager; EMP) in a fresh tenant, with one real pending leave/overtime/comp-off/regularisation row for EMP, then drives the real API over real HTTP as each role. Result: MGR_TOP's `/approvals/pending-count` reads all-zero and every list endpoint (`/approvals/pending`, `/overtime/requests?status=PENDING`, `/attendance/comp-off?status=pending`) is empty; MGR_TOP's direct approve attempts on the leave/overtime/comp-off items each return 403; MGR_MID (the real immediate manager) sees exactly 1 of each and successfully approves the overtime and comp-off requests — confirmed via a fresh Postgres read-back that `approved_by`/`reviewed_by` on those rows is MGR_MID's real user id; HR_ADMIN sees and can act on everything tenant-wide.
- `scripts/db/verify-legacy-leave-http.mjs` separately confirms `routes/attendance/leave.ts` is live (real HTTP `POST /attendance/leave/apply` → 201, row readable in real Postgres) and proves the new period-lock fix fires against a real locked-period row (409, status stays `pending` on read-back) and doesn't disturb the open-period path on retry.
- `scripts/db/browser-verify-approvals-scope.mjs` (Playwright, the pre-installed Chromium) logs in for real (typed email+password through the actual `/login` form) as each of MGR_TOP, MGR_MID and HR_ADMIN against the same seeded tenant, navigates to the real Approval Inbox, and screenshots it — 3 PNGs sent to the user. MGR_TOP's page reads "No pending approvals — All items have been reviewed," sidebar badge blank; MGR_MID's shows "Approvals 2," "Leave Requests (1)," "Attendance Corrections (1)," the real employee's row, and working Approve/Reject buttons; HR_ADMIN's shows the same 2 items tenant-wide plus a notification banner. Same employee, same pending items, in every screenshot — the only variable is which manager is logged in.

All three scripts are committed (not throwaway) for re-use by a future session. Screenshots are ephemeral (`/tmp/scope-verify-screens/`, not committed) — re-run the browser script to regenerate them.

## Explicitly still blocked / out of scope (unchanged from the prior round)

- Hosted Supabase/RLS/storage behavior — still blocked, no Supabase project access in this session. Nothing above claims to prove RLS; the local gateway described in prior rounds is a sandbox-only PostgREST-like shim.
- PMS and Travel Desk — on hold per explicit user instruction, untouched.
- `main` branch — untouched. PR #30 — unmerged.
