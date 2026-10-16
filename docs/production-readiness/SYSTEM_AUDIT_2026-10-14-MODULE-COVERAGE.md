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
- **Checkpoint 7** (this commit): continuation from `096e4a3b`, responding
  to the user's two-part steering message after independently reviewing
  checkpoint 6 rather than taking its conclusions on faith: (1) the
  period-lock check racing lock-creation/payroll-finalization needs
  transactional enforcement, not a sequential test; (2) manager-scope
  ("exclude indirect reports") is not automatically the right policy for
  every workflow and needs to be recorded per-workflow, not assumed.

  **Period-lock race — confirmed real, not theoretical, by reading the
  actual RPC bodies.** Checkpoint 6's leave.ts fix (and the pre-existing
  canonical flow) only ever checked `attendance_period_locks` via a
  separate JS query (`getLockedMonths`/`isMonthLocked`) *before* calling
  the approval RPC — a real TOCTOU window: a period lock committed by
  another session between that JS check and the RPC's own commit would go
  undetected, and the approval would still commit its balance deduction/
  status change. Confirmed by reading the actual SQL bodies, not assumed:
  `approve_leave_request_atomic`, `reverse_leave_request_atomic` (427),
  and `approve_regularisation_atomic` (042) never referenced
  `attendance_period_locks` at all; the comp-off and overtime claim
  mutations (plain UPDATEs in `comp-off.ts`/`ot-engine.ts`) had the exact
  same gap. Migration 262's DB trigger does not backstop this either — it
  deliberately allows LOCKED/PAYROLL_PROCESSING writes to
  `attendance_daily` (only PAYROLL_FINALIZED is a hard floor), by design,
  so it was never meant to catch this.

  **Fix (migration 461):** fold the period-lock check into the SAME
  transaction as each protected mutation — a fresh `SELECT ... FOR UPDATE`
  / status-check / lock-check / mutate sequence inside one PL/pgSQL
  function, not a separate earlier round trip. Under Postgres's default
  READ COMMITTED isolation, each *statement* gets a fresh snapshot, so a
  lock-check statement issued immediately before the mutation, in the same
  transaction, is guaranteed to see any lock committed before that
  statement began — closing the exact window a separate JS-side check
  could miss, without needing `pg_advisory_xact_lock` coordination between
  the lock-creation path and the approval path. Applied to:
  `approve_leave_request_atomic`, `reverse_leave_request_atomic`,
  `approve_regularisation_atomic` (bodies replaced, signatures unchanged —
  no caller-side TS change needed), plus three NEW atomic RPCs for
  mutations that previously had no single-transaction form at all:
  `approve_legacy_leave_application_atomic` (`routes/attendance/leave.ts`'s
  approve, replacing a 3-round-trip validate→deduct→update sequence),
  `approve_comp_off_claim_atomic` (`comp-off.ts`), and
  `approve_overtime_claim_atomic` (`ot-engine.ts`/`overtime.ts`). The
  pre-existing JS-side `getLockedMonths`/`isMonthLocked` pre-checks are
  KEPT, reframed in code comments as a fast-fail UX optimization only —
  they are no longer the enforcement boundary.

  **Proof this specific ordering is closed — not a sequential test**
  (checkpoint 8 correction: this heading originally claimed "the race is
  actually closed," full stop — that overclaimed. This test proves only
  the ordering where the period-lock write commits before the mutation's
  check runs. The complementary ordering, and the period-lock WRITER
  side's complete lack of any shared mechanism, were not examined here at
  all and were NOT actually closed until checkpoint 8's migration 462 —
  see that entry below for the real fix and the two-ordering proof),
  per the
  user's explicit rejection of "insert a locked row, then call approve" as
  insufficient: `scripts/db/verify-period-lock-no-race.mjs` uses two raw
  `pg` connections with explicit transaction control to construct the
  literal scenario — connection A takes the `FOR UPDATE` row lock (the
  exact point the RPC reaches before its lock-check), connection B
  concurrently inserts and COMMITS a period lock for that month while A's
  transaction is still open and has not yet looked at
  `attendance_period_locks`, then A's lock-check statement runs as a fresh
  statement in its still-open transaction. **Result: A's check correctly
  sees the lock B committed mid-flight (PASS)** — this is the
  determinism the user asked for, not a timing-dependent guess. Parts 2-3
  then confirm the real compiled RPC refuses a locked month (409-class
  exception, persisted read-back shows status unchanged) and succeeds
  once reopened (persisted read-back shows the balance deduction). Part 4
  runs 15 trials of a real RPC approve racing a real lock-insert via
  `Promise.all` (genuine DB/HTTP-timing concurrency, no artificial stagger)
  — **15/15 self-consistent** (every trial lands in exactly
  approved-with-balance-deducted or refused-with-nothing-mutated, never a
  partial state). Script is committed for reuse.

  **End-to-end confirmation through the real HTTP+API layer** (not just
  the raw RPC): real `POST /attendance/leave/apply` → `POST .../approve`
  against the live compiled API server confirmed the leave.ts refactor
  works (201, then 200 "Approved successfully", persisted
  `status: 'approved'`); a second smoke test confirmed `POST
  /attendance/comp-off/:id/approve` (200, `status: 'approved'`,
  `days_credited: 1`) and `POST /overtime/requests/:id/approve` (200,
  `status: 'APPROVED'`, `approved_minutes: 90`) against the live API,
  each independently persisted-read-back-confirmed in Postgres.

  **Second gap found while doing this comparison, not assumed away**:
  comparing `leave.ts`'s `/attendance/leave/:id/cancel` against canonical
  `reverseApprovedLeaveRequest` (the user's explicit instruction —
  "document differences before recommending retirement; do not remove it
  silently") surfaced two further real gaps, neither previously fixed:
  **F1** — no period-lock check at all (not even a JS pre-check, unlike
  approve); **F2** — no elapsed-range guard, unlike canonical's
  `req.from_date < todayLocal` block that prevents over-crediting balance/
  corrupting already-elapsed attendance for a leave that has already
  started. Both fixed this round: F1 via a new
  `cancel_legacy_leave_application_atomic` RPC (migration 461 — status
  check + period-lock check + status UPDATE + ledger reversal + balance
  restore, one transaction, mirroring the approve-side consolidation); F2
  via a JS-side tenant-local "today" comparison before the RPC is ever
  called (mirrors canonical; this check reads an already-fetched date
  against "now," not a race-sensitive mutation precondition, so it does
  not need to be inside the RPC's transaction the way the lock check
  does). Verified against real Postgres
  (`scripts/db/verify-cancel-legacy-atomic.mjs`, 3 parts: locked month
  blocks cancel with no partial mutation; unlock → succeeds with balance
  restored + ledger row written; a retried cancel on the now-cancelled
  row is rejected with no double-credit) and with 4 new mocked route
  tests (F2's early-return, F1's RPC-surfaced 409, the happy path calling
  the RPC and reporting `days_restored`, and the pre-existing non-approved
  status check unaffected by the refactor).

  **Prevalidation vs. independent-per-item-commit, tested as two distinct
  invariants per the user's explicit instruction** (checkpoint 8
  correction: this was originally labeled "transactional atomicity" —
  wrong name for the second invariant, fixed in checkpoint 8 below; the
  behavior and the test itself were correct, only the label was not):
  added one new test to `regularisation-bulk-scope.test.ts`, alongside
  the already-existing prevalidation test (an unauthorized item in the
  batch → zero items mutate, proven by the service mock never being
  invoked). The new test mocks the service call to throw for one
  AUTHORIZED mid-batch item and asserts the other two authorized items
  still process independently and report correctly (`{approved: 2,
  failed: 1, total: 3}`, each item's outcome keyed by id) — proving a
  runtime failure on one item of an all-authorized batch does not abort
  or silently drop the rest, which prevalidation alone does not
  establish. This is per-item partial success, not atomicity — see
  checkpoint 8.

  **Fresh-install migration verification**: migration 461 (as extended
  this round with the cancel RPC) applied cleanly, zero errors, against a
  freshly-bootstrapped Postgres 16 database running the complete
  migration history (000→461, 457 files) — 480 tables, all 5 target
  functions (`fn_months_in_range`,
  `approve_legacy_leave_application_atomic`,
  `approve_comp_off_claim_atomic`, `approve_overtime_claim_atomic`,
  `cancel_legacy_leave_application_atomic`) present. Throwaway database
  dropped after verification.

  **Test suite**: 604/604 passed, 70/70 files (up from checkpoint 6's
  599/599 — 1 new atomicity test, 4 new cancel-handler tests), 0
  regressions; `tsc --noEmit` clean on `apps/api`.

  **Manager scope recorded per workflow (the user's second instruction
  — "Direct-report exclusion is not automatically correct for every
  operational read or approval"), so this is a documented policy, not an
  implicit default applied uniformly:**

  | Workflow class | Intended scope | Why | Where enforced |
  |---|---|---|---|
  | Attendance/overtime **history** (read-only team visibility — e.g. admin OT list-by-employee, team attendance views) | **Full subordinate tree, any depth** | Deliberate "broad view, narrow act" design — a manager-of-managers legitimately needs operational visibility into their whole org for planning/oversight, even though they can't personally action a grandchild's item | `getDirectReportIds` (`lib/manager-scope.ts`) |
  | **Compensation** visibility (`context-data.ts`'s `payroll-summary`, `manager-compensation.ts`) | **Immediate direct reports only** | Explicit product policy (Program 5 · P5.3) — compensation is sensitive enough that even a manager-of-managers should not see a grandchild report's CTC, unlike operational attendance data | `getImmediateReportIds` |
  | Approval **ACTION** authority (leave approve/reject/cancel-approval, regularisation approve/reject, overtime approve, comp-off approve) | **Immediate manager only, always** | `validateApprover`/`authorizeOtTarget`/`authorizeCompOffTarget` have always been one-level `isDirectReport` checks — a multi-level approval chain is a separate, explicitly-configured feature, never an implicit fallback to "anyone above in the tree" | `isDirectReport` / the approver-chain validators |
  | Approval **queue/count** (pending lists, the `/approvals/pending-count` badge, the Approved tab behind cancel-approval) | **Must match action authority exactly — immediate only** | A queue that shows items the viewer cannot act on is misleading UX and was checkpoint 6's actual bug (full-tree queues feeding one-level action authority) | `getImmediateReportIds` (fixed checkpoint 6) |
  | **Bulk**-approve/reject ownership guards (regularisation bulk endpoints) | **Must match action authority exactly — immediate only** | Same reasoning as queue/count: the guard's own stated intent ("every request in the batch must belong to a direct report") only makes sense at the same level the per-item approve call itself authorizes | `getImmediateReportIds` (fixed checkpoint 6) |

  The pattern that falls out of this table: **"broad view, narrow act"** —
  read-only operational visibility legitimately stays on the full tree by
  design (attendance/overtime history), while anything that is or directly
  feeds an actionable decision (approval action, its queue, its bulk
  guard) must match the one-level action-authority boundary exactly;
  compensation is the one visibility case that is *narrower* than the
  default operational-visibility tree, by explicit product policy rather
  than by the action-authority rule. This table is the audit's answer to
  "is direct-report exclusion correct here" for every workflow currently
  touched by this register — it is not exhaustive of every module in the
  codebase (e.g. compensation's policy pre-dates this round and is cited,
  not re-derived here).

  **Not yet done, explicitly carried forward**: the broader retirement
  decision for `leave.ts`'s legacy pathway (still open, not assumed —
  F1/F2 close its remaining safety gaps relative to canonical, but it is
  still feature-incomplete: no multi-level approval chain, no PEND-94
  computation); the remaining ~60 unopened `routes/attendance` files and
  `routes/approvals/governance-evolution.ts`/`workflows.ts` (next planned
  batch, below, unchanged in scope from checkpoint 6's plan).
- **Checkpoint 8** (this commit): the user independently inspected
  checkpoint 7 and correctly rejected two of its claims rather than taking
  "604 tests pass" as resolution. Both corrections below are real fixes,
  not reclassifications of already-correct behavior.

  **A. The period-lock race was NOT actually closed by checkpoint 7.**
  Migration 461's in-transaction `SELECT` only catches ONE of the two
  possible race orderings: the one where the period-lock write already
  committed before the mutation's check statement ran. It does nothing
  for the complementary ordering — the mutation's check runs first,
  correctly sees OPEN (the lock genuinely hasn't committed yet), the
  mutation proceeds and commits, and the lock-creation write lands
  microseconds later. Checkpoint 7's own Part 4 stochastic test actually
  surfaced exactly this ("all resolved 'approve wins'") and the write-up
  treated it as an acceptable unresolved race instead of recognizing it
  as the uncaught half. Worse: checkpoint 7 never inspected the
  period-lock WRITER side (`routes/attendance/period-locks.ts`'s
  lock/unlock/start-payroll/finalize) at all — confirmed by reading it
  this round: all four were plain Supabase-js UPDATE/INSERT calls with a
  folded CAS `WHERE` clause but no lock of any kind, sharing no mechanism
  whatsoever with the mutation RPCs' in-transaction check. Two
  independent "hope we don't race each other" writers is not the same as
  one shared serialization point.

  **Fix (migration 462):** a Postgres advisory lock keyed by
  `(tenant_id, period_month)` (`fn_lock_period_months`, via
  `pg_advisory_xact_lock` — auto-released on commit/rollback), acquired
  by BOTH writer classes before either decides anything. This works even
  when no `attendance_period_locks` ROW exists yet for that month — the
  exact case the user explicitly asked to be tested, and the reason a row
  lock (`FOR UPDATE`) cannot substitute: there is no row to lock. Four new
  atomic RPCs (`lock_period_atomic`, `unlock_period_atomic`,
  `start_payroll_processing_atomic`, `finalize_period_atomic`) replace
  `period-locks.ts`'s plain CAS writes; all seven mutation RPCs from
  migration 461 (plus the cancel RPC added after it) are re-created to
  acquire the same lock, for every month in their date range (sorted
  ascending — a standard lock-ordering discipline so two multi-month
  transactions can never deadlock by acquiring in different orders;
  lock-creation only ever touches one month per call, so it can never be
  one half of such a cycle) before their existing lock-check `SELECT`.

  **Proof, both orderings, via genuine blocking (not timing inference)**:
  `scripts/db/verify-period-lock-shared-serialization.mjs` uses two raw
  `pg` connections with explicit transaction control and queries
  `pg_locks` directly to confirm a real wait, not just a slow response.
  - **Part 1 ("lock wins")**: `lock_period_atomic` holds the advisory
    lock for a month with **no pre-existing row at all**; a concurrent
    real `approve_leave_request_atomic` call is shown present in
    `pg_locks` as an ungranted advisory-lock wait (confirmed `true`) —
    genuinely blocked, not slow. Once the lock-creation call commits, the
    approval unblocks, observes the now-committed LOCKED row, and is
    refused with `PERIOD_LOCKED`; the request's status is confirmed
    unchanged (`PENDING`) — no partial mutation.
  - **Part 2 ("approval wins")**: the approval holds the lock first; a
    concurrent `lock_period_atomic` call is shown genuinely blocked in
    `pg_locks`. Once the approval commits (balance deducted, status
    `APPROVED` — accepted as correct, since it genuinely preceded the
    lock in real commit order, not a race the system failed to catch),
    the lock-creation call proceeds and succeeds. A **third**, fresh
    approval attempt for the same now-locked month, started only after
    the lock is durably committed, is then refused — proving the lock is
    enforced prospectively regardless of which writer happened to go
    first.
  - **Part 3**: a leave spanning two months is refused by locking
    *either* month (tested both).
  - **Part 4**: 10 concurrent real calls (mixed multi-month approvals and
    lock-creation calls, overlapping months) all resolve within a bounded
    timeout — no deadlock/hang.
  All four parts pass. Script committed for reuse. Migration 462 also
  re-verified against a fresh Postgres 16 instance running the complete
  migration history (000→462, 458 files, 0 errors, 480 tables, all 5 new
  functions present) and smoke-tested through the real compiled API
  server over real HTTP (`lock`→`start-payroll`→`finalize`→`finalize`
  again correctly refused 409; `lock` on a fresh month with no prior row
  →`unlock`, both 200, persisted read-back confirmed).

  **B. Bulk regularisation's guarantee was mislabeled, and the UI claim
  needed verifying rather than assuming.** The prior checkpoint's test
  titles called the per-item independence behavior "TRANSACTIONAL
  ATOMICITY" and "BULK ATOMICITY" — the user correctly rejected this: if
  authorized items commit independently (which they do — one item's
  runtime failure doesn't block or undo the others), that is **per-item
  partial success**, the opposite of atomicity, not a variant of it.
  Relabeled both the tests (now PREVALIDATION for the zero-mutation gate,
  PER-ITEM PARTIAL SUCCESS for the independent-commit behavior) and added
  an explicit CONTRACT doc comment to both routes in `regularisation.ts`
  stating this plainly, including that callers must surface
  `summary.failed` rather than treating 200 as unconditional success.

  Checked all four of the user's specific asks:
  - *Unauthorized-item prevalidation causes zero mutations* — already
    covered (pre-existing test, unchanged).
  - *Each successful item's approval, punches, and attendance effects are
    consistent* — already covered by the pre-existing
    `regularisation-approve-punch-upsert.test.ts`'s bulk-path describe
    block (2 ids in one batch, each gets its own correctly-shaped punch
    upsert call, `summary` matches) — cited rather than re-derived.
  - *Failed items are explicitly reported and retry safely* — **new**
    test (`RETRY SAFETY`, `regularisation-bulk-scope.test.ts`): submits a
    3-id batch where the middle id fails; resubmits the SAME 3 ids with
    no Idempotency-Key (modeling a plain UI retry click, not a replayed
    request) and confirms the two already-succeeded ids come back as an
    explicit `CONFLICT` failure (never silently re-approved) while the
    genuinely-still-pending id processes cleanly exactly once. This
    models `approveRegularisation`'s real status pre-check and migration
    462's `approve_regularisation_atomic` DB-level backstop of the same
    invariant (both already read this round, confirming the real
    behavior this mock stands in for).
  - *UI shows partial failure rather than unconditional success* — **real
    defects found, not hypothetical**, by reading all three web call
    sites rather than assuming the existing toasts were fine:
    1. `ManagerRegularisationQueue.tsx` (HR admin's bulk queue,
       `/admin/attendance/regularisation`) — its `BulkResult` TypeScript
       interface didn't even include `failed`/`total`, and its toast
       always read "Approved N requests" with **zero mention of
       failures**, regardless of `summary.failed`. Fixed: now reads
       `summary.failed` and shows a `toast.warning` ("N approved, N
       failed") whenever any item failed, `toast.success` only when none
       did.
    2. `ManagerTeamRegularisation.tsx` (the per-manager queue) — the text
       already named the failed count ("Approved N of M · K failed") but
       the toast's *styling* was unconditionally green/success even when
       `failed > 0`, visually reading as full success at a glance. Fixed
       to use `toast.warning` whenever `failed > 0`.
    3. **The most serious of the three**, found in `useOperationalQueue.ts`
       (the generic cross-module Operational Queue widget): its
       `bulkApprove`/`bulkReject` batch MANY regularisation (and anomaly)
       ids into a SINGLE HTTP call, then compute `failed` as "how many of
       these `promises` themselves rejected" — but a batch call that
       returns 200 with `summary: {approved: 2, failed: 3, total: 5}` is
       a *fulfilled* promise, so this count was **structurally blind** to
       any partial failure reported inside a 200 response, for both the
       regularisation batch (`summary.failed`) and the anomaly batch
       (`resolved_count` short of the requested count). A batch that
       silently processed 2 of 5 would have shown "5 items approved" —
       literal unconditional success on a call that demonstrably wasn't.
       Fixed: each batched entry now carries its `requested` count and is
       inspected on its own terms after settling (`value.summary.failed`
       for regularisation, `requested - value.resolved_count` for
       anomalies) rather than relying solely on whole-call rejection.
  No web test infra exists in this repo (`apps/web` has no test runner
  configured, confirmed via `package.json` and an empty-result search for
  `*.test.ts*` under `src`) — these three fixes are source-review-verified
  and `tsc --noEmit`-clean, not unit-tested; disclosed, not implied.

  **Test suite**: 605/605 passed, 70/70 files (up from checkpoint 7's
  604/604 — 1 new retry-safety test), 0 regressions; `tsc --noEmit` clean
  on both `apps/api` and `apps/web`.
- **Checkpoint 9** (this commit): the user accepted checkpoint 8's
  evidence as closing the specific gap previously raised, and asked for
  three acceptance properties to be carried forward while the broader
  sweep continues: every relevant writer shares the lock, multi-month
  acquisition stays consistently ordered, and payroll finalization must
  calculate from the protected state rather than persist a pre-lock
  calculation. All three were checked, not assumed; one more concrete
  defect was found and fixed, plus a live-browser-verified UI gap.

  **Alternate writers / lock sharing — confirmed complete for
  `attendance_period_locks`, one new participant added.** Grepped every
  reference to the table: the only writers of `attendance_period_locks.
  state` are the four endpoints in `period-locks.ts` (already converted
  to shared-lock RPCs in checkpoint 8); `routes/payroll/runs.ts` only
  *reads* it as a gate, never writes it. That read, however, is exactly
  where the user's second acceptance property bit: it happens ONCE, early
  in `POST /payroll/runs/:id/finalize`, via a plain unprotected `SELECT`
  — and is never re-verified before the actual persist. The same file's
  own author had already recognised this exact staleness class for a
  DIFFERENT guard: the code immediately before Step 1 explicitly re-checks
  the FREEZE guard with the comment "the stale-employee recompute loop
  above can run long enough for a concurrent POST /freeze... to land in
  between" — but never applied that same re-check to the attendance-lock
  gate sitting right next to it. If HR unlocks (or never locked) the
  period while the staleness-recompute loop is running, finalize would
  seal slips/run on a calculation made while believing the period was
  closed — precisely "persist results calculated before acquiring the
  lock."

  **Fix (migration 463)**: `recheck_attendance_lock_for_finalize(tenant,
  month)` acquires the SAME `fn_lock_period_months` advisory lock every
  protected mutation RPC now acquires (migration 462), then re-reads
  `attendance_period_locks.state` fresh under that lock — genuinely
  serialized against a concurrent `lock_period_atomic`/`unlock_period_
  atomic` call, not a second unprotected read racing the first. Called
  immediately before Step 1, alongside the pre-existing freeze re-check
  (force_finalize still bypasses it, matching the original gate's own
  bypass). **Not attempted, disclosed rather than silently skipped**:
  this does not re-run the leave-staleness check for approvals landing in
  the narrower window between the recompute loop finishing and this
  re-check — only the attendance-lock STATE itself is re-verified;
  closing that fully would mean porting the recompute loop's slip
  computation into SQL, out of proportion to the concrete defect found.
  Converting the entire ~900-line finalize flow (slips, loan/advance
  schedules, maker-checker, accounting) into one atomic transaction was
  considered and rejected as disproportionate to this specific gap.

  **Proof, real Postgres** (`scripts/db/verify-finalize-lock-recheck.mjs`,
  4 parts, all pass): no pre-existing lock row at all → refused (the case
  a row lock can't cover); LOCKED → succeeds; unlocked again → refused
  (proves this is a live re-check, not a cached read); a concurrent
  `lock_period_atomic` call is shown genuinely blocked in `pg_locks` while
  the recheck's transaction holds the lock open. **Mocked route tests**
  (`runs-finalize.test.ts`, 2 new): refuses with 423 `ATTENDANCE_REOPENED`
  and finalizes nothing when the recheck reports reopened; `force_finalize`
  correctly bypasses it. Fixed a resulting regression in the file's
  existing mock (`fastify.supabase.rpc` wasn't mocked at all — now
  defaults to the same LOCKED state the `attendance_period_locks` table
  mock already represents). **Multi-month ordering**: unaffected and
  already proven in checkpoint 8 (`fn_lock_period_months` sorts
  ascending); this RPC only ever locks one month (a payroll run is
  month-scoped), so no new ordering concern. Fresh-install: migration 463
  applied cleanly against a fresh Postgres 16 instance with the complete
  000→463 history (459 files, 0 errors, 480 tables, function present).
  Smoke-tested through the real compiled API (lock→start-payroll→
  finalize→finalize-again correctly refused 409).

  **Bulk-action mixed-result/retry — verified live in the browser, not
  assumed from the API fix alone.** Seeded a real tenant with a manager
  and 3 direct reports' pending regularisations, logged in for real,
  selected all 3, and raced a real HR-admin period-lock call (via the
  actual `/attendance/period-locks/:month/lock` endpoint, not a mock)
  against the click so one of the three genuinely fails server-side while
  the other two succeed — `scripts/db/browser-verify-bulk-mixed-result.mjs`.
  Confirmed: the toast correctly read "Approved 2 of 3 · 1 failed"
  (checkpoint 8's fix holds up live); successful items correctly
  disappeared from the pending list on refetch. **Found a real, now-fixed
  gap in the remaining property ("failed items remain identifiable")**:
  after the toast's few seconds, there was nothing anywhere in the UI
  saying WHICH item failed — only a count. Selection cleared for
  successful and failed ids alike, and a failure that leaves the item no
  longer 'pending' (this test's locked-period rejection was itself auto-
  rejected moments later by the pre-existing "auto-LOP on lock" background
  job in `period-locks.ts`, a separate, already-correct feature) makes it
  vanish from the refetched list exactly like a success would — so once
  the toast faded, the manager had no way to identify which request
  needed attention. Fixed in both `ManagerTeamRegularisation.tsx` and
  `ManagerRegularisationQueue.tsx`: the warning toast now names the
  failed item(s) by employee, resolved from `results` against the list as
  it stood when the action was taken (e.g. "Approved 2 of 3 · 1 failed
  (Bob Reports)"), with duration extended to 8s so there's a real chance
  to read it. Re-ran the same live scenario after the fix — confirmed the
  toast now reads the employee's name, screenshotted and sent to the
  user. **Retry-safety** itself (the third property) is proven at the API
  layer, not browser-replayed: checkpoint 8's `RETRY SAFETY` test already
  demonstrates a resubmitted batch cannot re-approve an already-succeeded
  id (explicit `CONFLICT`, not silent re-approval) while the genuinely-
  still-pending id processes exactly once — the one browser-reachable
  failure mode found this round (already-actioned/auto-rejected) is
  terminal, not retryable, so a browser-level retry of it is not a
  meaningful case; the meaningful case (transient failure, still pending)
  is exactly what the mocked test already covers against the real status-
  check logic (`approveRegularisation`'s pre-check and migration 462's
  `approve_regularisation_atomic` DB-level backstop, both read this round
  to confirm the mock's behavior matches).

  **Test suite**: 607/607 passed, 70/70 files (up from checkpoint 8's
  605/605 — 2 new finalize-recheck tests), 0 regressions; `tsc --noEmit`
  clean on both `apps/api` and `apps/web`.
- **Checkpoint 10** (this commit): the user correctly rejected a repeat
  post of the checkpoint 9 report as adding no new evidence, and named two
  concerns neither closed: (1) `recheck_attendance_lock_for_finalize`'s
  advisory lock is released the instant that RPC call returns (it commits
  its own transaction), so the financial writes that followed as separate
  later calls were never actually covered by it — validation and
  persistence were not protected together; (2) a longer toast naming the
  failed employee is still temporary — once it fades, nothing durable
  identifies which request needs attention. Both are now closed, with the
  user's exact specified proof structure for point 1 and a live-browser
  retry for point 2. **Correction to checkpoint 9's claim above**:
  checkpoint 9's "genuinely serialized ... not a second unprotected read
  racing the first" was accurate only for the re-check itself — it did not
  mean the finalize was protected end-to-end, and the writeup should not
  have been read that way. It wasn't: Step 1/Step 2 ran as separate,
  later, unprotected `fastify.supabase` calls after the recheck RPC had
  already committed and released its lock.

  **Point 1 — finalization race, fixed for real this time (migration
  464, `finalize_payroll_run_atomic`).** The only architecturally sound
  fix, given this codebase's connection-pooled/PostgREST-style client
  (confirmed again this round: each `.rpc()`/`.from()` call is its own
  independent transaction, no session continuity across calls) is to fuse
  the lock acquisition, the attendance-state re-check, AND both seal
  writes into **one** transaction, so there is no gap between "confirmed
  locked" and "sealed" for a concurrent unlock to land in. `routes/
  payroll/runs.ts`'s finalize handler now calls this single RPC in place
  of the old recheck-then-two-separate-updates sequence; the old "Step 2:
  mark the run as finalized" block is deleted outright (folded into the
  RPC), not left dangling. **Scope decision, stated not implied**: Step 1
  (slip finalize) had to be folded in too, not just Step 2 (run finalize)
  — traced `ess/home.ts` and confirmed payslip visibility gates on
  `payroll_slips.status='finalized'` alone, independent of `payroll_runs.
  status`, so leaving Step 1 outside the fused transaction would have let
  an employee see a "finalized" payslip from a run that was never actually
  sealed. Verified the existing intermediate side-effects that still run
  after the fused RPC (resyncRunTotals, advance/loan marking, the G12
  leave-encashment paid-flip, maker-checker) have no ordering dependency
  on `payroll_runs.status` still reading `'draft'` — safe to run after
  Step1+Step2 instead of between them, same as before. The freeze-guard
  re-check immediately before the call is left untouched — a different,
  unrelated mechanism, not the subject of this finding.

  **Proof, in the exact sequence the user specified** —
  `scripts/db/verify-finalize-atomic-seal.mjs` (committed, 3 parts, real
  Postgres, all pass): **Part 1, negative control** — hand-replays
  checkpoint 9's exact broken pattern (call the old recheck RPC, let it
  return and release its lock, land a concurrent `unlock_period_atomic`
  in the now-open gap, then run the old-style raw Step 1/Step 2 UPDATEs
  with no further check) and confirms it **still seals stale payroll**
  (period reads `OPEN`, run reads `finalized` anyway) — proving the gap
  was real, not hypothetical, and that checkpoint 9 alone did not close
  it. **Part 2, positive proof** — pauses after `finalize_payroll_run_
  atomic` returns but *before* its own transaction commits (a second
  `pg.Client` holds `BEGIN; SELECT finalize_payroll_run_atomic(...)` open),
  attempts to reopen the period from a concurrent connection during that
  window, and confirms via `pg_locks` (`locktype='advisory' AND
  pid=$1 AND granted=false`) that the reopen is **genuinely blocked**, not
  just slow — only proceeding after the finalize transaction commits.
  Read-back confirms the run+slip are sealed and the period only flips to
  `OPEN` *after*, never a hybrid state. **Part 3, control** — reopening
  *before* a fresh finalize attempt starts is still refused outright with
  `ATTENDANCE_REOPENED`, confirming the gate itself still works end-to-end.
  **Mocked route tests** (`runs-finalize.test.ts`): both checkpoint-9 tests
  rewritten against the new RPC name and the `p_check_attendance_lock`
  param (the mock previously simulated the old two-call sequence; fixed to
  simulate the fused RPC, including a regression where `slipUpdateSpy`
  wasn't invoked by the new default mock path). **Fresh-install**:
  applied cleanly against a throwaway Postgres 16 instance with the
  complete 000→464 migration history (460 files, 0 errors, 480 tables) —
  this also caught and fixed a real mistake made while iterating on the
  migration file itself: changing `finalize_payroll_run_atomic`'s
  parameter list without an explicit `DROP FUNCTION IF EXISTS` first left
  TWO overloads coexisting in `hrms_uat` (Postgres treats a different
  parameter list as a different function); the migration now drops the
  old 4-param signature before recreating the 5-param one, and the
  fresh-install check confirms exactly one overload exists.

  **Point 2 — bulk-failure identification, durable panel + working
  retry, verified live in the browser, not assumed from the component
  diff alone.** Replaced `describeFailedItems` (a string folded into the
  toast, however long its duration) with a `FailedItem[]` component-state
  array and a persistent panel — row per failure, rendered until retried
  or dismissed, showing the request id, employee, date, the server's own
  error, and which action (`approve`/`reject`) to retry — in both
  `ManagerTeamRegularisation.tsx` and `ManagerRegularisationQueue.tsx`
  (the only two bulk-regularisation UIs; `useOperationalQueue.ts`'s
  consumers were already covered in a prior checkpoint and are unaffected
  by this change). Selection after a bulk action is set to **only the
  failed ids**, not cleared — the existing "Approve N"/"Approve All"
  button then doubles as a correct "retry remaining failures" control with
  no separate code path, and per-row retry reuses the existing single-item
  endpoints (`POST /attendance/regularisation/:id/approve` /
  `/:id/reject`) rather than resubmitting the original batch, so a retry
  can never re-touch an id that already succeeded.

  **Live-browser verification** (`scripts/db/verify-checkpoint10-bulk-
  retry-panel.mjs`, committed, self-contained — seeds its own tenant,
  manager, 3 direct reports and 3 pending regularisations): selected all
  3, bulk-approved while B's period was LOCKED, waited past the toast's
  display window, and screenshotted — the panel was **still showing B's
  row by employee name, date, and the real server error** (sent to the
  user). Postgres read-back at that point: A and C `approved`, B still
  `pending` — exactly the partial-success case. Reopened the period,
  clicked "Retry" on B's row, screenshotted again — panel cleared, a
  fresh "Approved Bala Report's request" toast, no pending requests left
  (sent to the user). Postgres read-back: B now `approved`; **A's and
  C's `approved_at` timestamps are byte-identical to the first read**,
  proving the retry touched only B and did not re-process or duplicate
  the already-succeeded items. **One scenario-design correction made
  mid-run, disclosed rather than silently fixed**: the first script draft
  locked B's period through the real `POST /attendance/period-locks/
  :month/lock` endpoint (matching checkpoint 9's own script) — but that
  endpoint also fires a background auto-reject-pending-as-LOP job (a
  separate, already-correct feature, not the subject of this fix), which
  flips the regularisation straight to a terminal `rejected` state no
  retry can ever undo. That is real, correct product behavior, not a bug
  — but it is not the *transient, retry-after-resolution* race this point
  is about, so the script now writes `attendance_period_locks.state`
  directly for the lock/unlock steps, still exercising the real
  `approveRegularisation()` lock-check code path under test, without
  triggering the unrelated auto-reject side effect.

  **Test suite**: 607/607 passed, 70/70 files — unchanged from checkpoint
  9's count (the 2 finalize tests were rewritten in place against the new
  RPC, not added to); 0 regressions. `tsc --noEmit` clean on both
  `apps/api` and `apps/web`.
- **Checkpoint 11** (this commit; tagged `checkpoint 10+1` in the code's
  own inline comments, since this round's work is a direct, same-session
  continuation of checkpoint 10's "continue the remaining module audit
  without waiting for another instruction" closing instruction — promoted
  to its own numbered entry here for the register's sequential history):
  closes tier 1 of the "Next planned batches" list below — the remaining
  11 unopened `routes/attendance/leave-*.ts`/`regularisation-policy.ts`
  files, plus `routes/approvals/governance-evolution.ts` and
  `workflows.ts` (the dedicated approvals namespace, never opened before
  this round). Two independent background audit agents read all 13 files
  in full against the item-2 checklist (tenant scoping, object/team
  authorization, FK cross-tenant validation, CAS/concurrency, period-lock
  interaction, pagination, numeric/date edge cases, retry/idempotency,
  error-response hygiene) and reported back with file:line citations and
  concrete failure scenarios; **4 real defects were independently verified
  by direct code reads (not taken on the subagents' word) and fixed, each
  with new mocked tests**:

  1. **`lib/approval-orchestrator.ts`'s `gateApprove`/`gateReject` — a
  multi-level approval chain could be silently bypassed by deleting its
  config mid-chain.** Flagged by the approvals-namespace agent while
  tracing `workflows.ts`'s config-mutation endpoints (its own 6-item
  checklist was otherwise clean) against the question the audit brief
  asked it to check: can a malformed/malicious governance config break or
  bypass a live approval? Verified directly by reading `gateApprove`
  itself: when a workflow_type's active config is deleted/deactivated (or
  no level applies to the entity's amount any more), the function
  returned `{kind:'finalize', authorized:false}` (the legacy single-step
  path) **before ever checking whether an `approval_instances` row was
  already open mid-chain** for that entity. Concrete scenario: a 2-level
  leave chain (direct_manager → hr_admin); the manager approves, advancing
  the instance to `current_level=2` (still `PENDING`, awaiting hr_admin);
  an admin then deletes both config levels (routine cleanup, or a
  careless/compromised admin); the SAME manager calls approve again — now
  sees zero config, falls to legacy, and finalizes the request through
  `validateApprover` (which the manager satisfies on their own) —
  **silently skipping the still-pending hr_admin level**, with the stale
  `approval_instances` row left open forever. **Fixed**: both early-return
  sites in `gateApprove` AND `gateReject` now check
  `getWorkflowInstance(...).final_approved === null` first; if an open
  instance exists, the action fails CLOSED with `CONFLICT` ("has an
  approval chain in progress... restore the configuration or ask an
  administrator to resolve the pending approval") instead of silently
  bypassing — consistent with the existing out-of-range-`cfg` guard a few
  lines below, which already used the same fail-closed philosophy for a
  narrower case. 6 new mocked tests
  (`lib/__tests__/approval-orchestrator-config-deletion.test.ts`): the
  tenant-never-configured-a-chain case and the chain-already-closed case
  are proven UNCHANGED (no regression), and the open-instance case is
  proven to now return `CONFLICT` for both `gateApprove` and `gateReject`,
  including the amount-threshold variant (`applicable.length === 0`).

  2. **Three routes let a manager (or, in one case, any employee) view
  another employee's leave data with no team-membership check** — the
  same defect class checkpoint 6 already fixed for `leave-requests.ts`'s
  Approved-tab list and checkpoint 4 fixed for `context-data.ts`,
  recurring in files that hadn't been opened yet:
     - `leave-collision.ts`'s `GET /leave/collision/preview` had **zero**
       object-level authorization — only tenant-membership of
       `employee_id` was checked, so any authenticated employee could pass
       a colleague's id and get back their holiday/weekly-off collision
       analysis. A structural gap against the sibling endpoint in the same
       directory, `leave-duration.ts`'s `POST /leave/duration/preview`,
       which both are called with the identical `employee_id` from the
       same `LeaveApply.tsx` screen — one was guarded, the other wasn't.
     - `leave-employee.ts`'s `GET /leave/requests` (the
       `EmployeeResolutionWorkspace.tsx` alias) was gated only on
       `MANAGER_ROLES.includes(role)` — a plain `manager` (not HR) could
       pass ANY `employee_id` tenant-wide, or omit it and get every tenant
       leave request including `reason`/`rejection_reason` text.
       `listLeaveRequests` already supported an `employeeIds` array filter
       "to scope to a manager's reporting line" — this route just never
       used it.
     - `leave-policy-resolve.ts`'s both GET endpoints used
       `!MANAGER_ROLES.includes(role)` to gate the ownership check, which
       skips it for EVERY manager-tier role, not just HR — a manager with
       zero reporting relationship to an employee could resolve that
       employee's full leave policy (accrual rate, eligibility, minimum
       service) plus name/code/joining_date, tenant-wide.

     **Fixed**: all three now apply the established self/HR/
     `getDirectReportIds`-scoped-manager pattern that `leave-duration.ts`
     already uses correctly (full subordinate tree for read-only
     visibility, matching that file's own precedent and its explicit
     comment on why tenant-scoping alone isn't enough). 19 new mocked
     tests across 3 files (`leave-collision-preview-scope.test.ts` ×5,
     `leave-employee-requests-scope.test.ts` ×7,
     `leave-policy-resolve-scope.test.ts` ×7) proving: self always
     allowed; HR always allowed, tenant-wide; a manager allowed only for
     their own report tree (direct report → 200, non-report → 403, omitted
     `employee_id` → scoped to the tree, not tenant-wide); a manager role
     with no linked employee record → 403, not a silent fallthrough.

  3. **`governance-evolution.ts`'s matrix create/update — a UNIQUE
  constraint conflict was misclassified as a 500, plus a missing
  cross-tenant FK check the same file already applies to two sibling
  fields.** `approval_matrices` has `UNIQUE(tenant_id, name, entity_type)`
  (migration 089); `POST`/`PUT /approvals/governance/matrices` both sent
  that conflict straight to `serverError`/500 instead of the clean 409
  `conflictError` this repo's own `lib/workflow-service.ts:102` already
  uses for the identical `error.code === '23505'` case — a real
  misclassification per this repo's own established pattern, not a data
  leak (the message was already a safe hardcoded string). Separately,
  `escalation_employee_id` (inside each stage) was only checked as a
  well-formed UUID — never re-validated as belonging to this tenant's
  `profiles`, unlike `delegate_id` (this same file, `POST /delegations`)
  and `granted_to` (`POST /overrides`), both of which this file already
  fixed with the identical pattern and an explanatory comment. Severity
  is capped by a fact independently confirmed by reading
  `docs/approval-mechanism-audit.md` and grepping for
  `stages.escalation_employee_id`: nothing currently reads that field for
  real SLA escalation, so the real-world impact is "stores/echoes a
  foreign tenant's UUID," not a cross-tenant action or data read — still a
  real, fixable inconsistency against the file's own standard. **Fixed**:
  both routes now check `error.code === '23505'` → `conflictError`
  (`MATRIX_ALREADY_EXISTS`), and both re-validate every
  `escalation_employee_id` against `profiles` scoped to `req.tenantId`
  before insert/update. 6 new mocked tests
  (`approvals/__tests__/governance-matrices-conflict-fk.test.ts`): 23505 →
  409 on both POST and PUT; a genuine non-23505 DB error still correctly
  falls through to 500 (unaffected); a foreign-tenant
  `escalation_employee_id` → 400 `INVALID_REFERENCE`; a genuine same-
  tenant id → 201; no `escalation_employee_id` at all → unaffected.

  4. **`leave-accrual.ts`'s `POST /leave/encashment/request` — the
  annual-encashment-cap check is a read-then-insert with no idempotency
  protection**, unlike the sibling `/leave/accrual/run` route a few lines
  above in the SAME file, which already uses
  `checkIdempotency`/`storeIdempotency`. No DB constraint enforces the cap
  (confirmed: migration 072's index on `leave_encashment_requests` is
  non-unique), and `processEncashment` at approval time only re-checks
  leave BALANCE sufficiency, never this cap again — so a double-click or a
  client retry after a timeout could submit two requests that each read
  the same pre-insert sum, each pass the cap check, and both later get
  approved independently, exceeding `max_encashable_per_year` with
  nothing in the system ever catching it. **Fixed, both ends**: the API
  route now accepts and honors an `Idempotency-Key` header exactly like
  `/leave/accrual/run` (a retried submission replays the cached response,
  no second insert); and — since a backend-only fix is inert if nothing
  ever sends the header — `EssLeaveBalance.tsx` (the actual caller of this
  endpoint, confirmed via grep: it previously sent NO idempotency key at
  all) now generates and sends one, mirroring `LeaveApply.tsx`'s existing
  stable-per-form-mount-UUID pattern exactly. **Explicitly NOT attempted,
  disclosed rather than silently left implicit**: a fully concurrency-
  proof fix (re-checking the cap atomically under a row/advisory lock at
  insert AND at approval time, closing the case where two truly
  independent requests use two different idempotency keys) is a larger
  lift than this specific gap warrants — the idempotency-key fix closes
  the common double-click/client-retry case, the actual failure mode a
  real user would hit, not the full theoretical race. 3 new mocked tests
  (`leave-encashment-request-idempotency.test.ts`): a retried submission
  with the SAME key replays (exactly one insert across two calls); two
  DIFFERENT keys both insert (two genuinely separate requests, unaffected);
  no key at all still succeeds (backward compatible, optional).

  **Lower-severity findings read and explicitly NOT fixed, disclosed
  rather than silently dropped** (both agents' own judgment, independently
  consistent with this round's "proportionate fix" standard): a double-
  submit race in `leave-accrual-lifecycle.ts`'s `POST /leave/lifecycle/
  release` can insert two audit-trail rows for the same release
  (cosmetic duplicate-audit-row, not a double-credit of leave balance —
  the underlying field it clears is idempotent either way); two
  concurrent first-ever page loads for `regularisation-policy.ts`'s `GET
  /attendance/regularisation/policy` can both miss a `maybeSingle()` check
  and both attempt a plain insert, with the loser surfacing an avoidable
  (but sanitized, non-leaking) 500 on first load.

  **Test suite**: 76/76 files, 641/641 tests passed (up from checkpoint
  10's 70/70 files, 607/607 tests — 34 new tests: 6 orchestrator + 19
  leave-scope + 6 governance + 3 encashment-idempotency), 0 regressions.
  `tsc --noEmit` clean on both `apps/api` and `apps/web`. All fixes are
  mocked-route-test-verified this round; none of the four has real-
  Postgres or live-browser evidence yet — disclosed, not implied, matching
  this register's established per-evidence-type discipline.
- **Checkpoint 12** (this commit): the user independently reviewed
  checkpoint 11 and correctly rejected its encashment-cap fix as
  incomplete — idempotency alone cannot protect a shared cap against
  simultaneous same-key requests racing before either result is stored,
  or against two DIFFERENT-key requests (two legitimately separate
  submissions by design). The user also asked for real-Postgres evidence
  for the approval-chain fix against an actual persisted multi-stage
  chain (checkpoint 11 had only mocked tests), expanded team-scope
  coverage (reassignment/cross-tenant/unlinked-manager), and precise,
  citable traceability for checkpoint 10's claims rather than the word
  "closed" alone. All four addressed, each with real evidence, not just
  a narrower disclosure.

  **1. Encashment cap — genuinely atomic now, not idempotency-shaped.**
  Inspecting `lib/idempotency.ts` confirmed the suspicion directly: it
  defines TWO different patterns — `checkIdempotency`/`storeIdempotency`
  (a plain check-then-work-then-store pair whose own module doc already
  warns "a race window between the check and the eventual
  storeIdempotency() call, wide enough for both requests to see no cached
  hit and both do the work") and a SEPARATE `claimIdempotency` (an atomic
  INSERT relying on the `(tenant_id, key)` unique constraint, used
  correctly by `leave-entitlement.ts` for this exact race class).
  Checkpoint 11 used the non-atomic pair — a real, confirmed gap. Fixed:
  the route now calls `claimIdempotency`/`releaseIdempotencyClaim`,
  matching `leave-entitlement.ts`'s established pattern exactly.
  Idempotency was never going to be sufficient for the cap itself,
  though — it answers "is this a replay," not "does the combined total
  of every request for this employee/leave_type/year stay under the cap,
  regardless of which key each one used." Migration 465 adds
  `request_leave_encashment_atomic`, a single transaction that takes
  `pg_advisory_xact_lock(hashtextextended(tenant:employee:leave_type:year,
  0))` (the same composite-key convention migrations 425/427 already use
  for this exact employee-scoped shape), re-sums existing requests, checks
  the cap, and inserts — all serialized against every concurrent request
  for that tuple, independent of idempotency keys entirely. **A second,
  independent defect found while building this fix**: the cap sum
  excluded only `status='rejected'`, never `'reversed'` — but
  `reverse_leave_encashment_atomic` (migration 446) credits the leave
  balance BACK on reversal, so a reversed request's days should free back
  into the cap too; leaving it counted understated the employee's
  remaining allowance forever after a correction. Fixed in the same
  migration.

  **Real-Postgres proof** (`scripts/db/verify-encashment-cap-atomic.mjs`,
  4 parts, all pass): Part 1 — two real `pg.Client` connections race an
  INSERT on the identical `idempotency_keys` row; exactly one succeeds,
  the other hits a genuine `23505` (the DB primitive `claimIdempotency`
  itself relies on). Part 2 — two DIFFERENT-key requests (no idempotency
  key touches the RPC layer at all) for the same employee/leave_type/year,
  individually under a 5-day cap (3 + 3) but combined over it;
  `pg_locks`-confirmed the second GENUINELY BLOCKS while the first's
  transaction is open, then correctly refuses `ENCASHMENT_LIMIT_EXCEEDED`
  once it sees the first's committed 3 days — exactly one row persists,
  never both. Part 3 — an over-cap request is refused with zero rows
  inserted (plpgsql exception auto-rolls back the whole function), then a
  corrected retry at a valid amount succeeds cleanly. Part 4 — a request
  is approved (hand-simulating the balance deduction the real approval
  flow performs, since that flow itself is out of this script's scope),
  then reversed via the real `reverse_leave_encashment_atomic` RPC;
  read-back from real Postgres confirms the leave balance is credited
  back to EXACTLY its original value, the cap correctly frees back up for
  a new request (the `'reversed'`-exclusion fix), the reconciled live
  request total for the year matches exactly (the reversed days are not
  double-counted), and `leave_balance_ledger` has exactly one `reversal`
  row with the correct delta. **Mocked route tests**
  (`leave-encashment-request-idempotency.test.ts`, rewritten, 7 tests):
  proves the ROUTE's wiring to both mechanisms — delegates to the RPC
  (not a raw insert); a same-key retry replays via the cached response;
  a key already in the CLAIMED (in-flight) state is refused 409 without
  ever reaching the RPC (deterministic proxy for the race Part 1 proves
  against real Postgres — JS microtask timing cannot reliably force two
  `Fastify.inject` calls to interleave in a synchronous mock, so this is
  proven by state, not by racing timers); two different keys both reach
  the RPC (idempotency does not suppress genuinely separate requests); a
  failed RPC call releases the claim so a corrected retry is not
  permanently stuck. Fresh-install: migration 465 applies cleanly against
  a throwaway Postgres 16 instance with the complete 000→465 history (461
  files, 0 errors, 480 tables, function present).

  **2. Approval-chain bypass — proven against a REAL persisted multi-stage
  chain + real HTTP, not mocked.** `scripts/db/verify-approval-chain-
  bypass.mjs` seeds a genuine tenant, a manager with one direct report, a
  real pending `attendance_regularisation` row, and a REAL 2-level
  `approval_workflow_config` (`direct_manager` → `hr_admin`) — then drives
  the actual compiled API over real HTTP. Step 1: the manager approves
  level 1 for real; read-back confirms the chain genuinely ADVANCES (not
  finalizes) — `attendance_regularisation.status` stays `'pending'`, a
  real `approval_instances` row exists at `current_level=2,
  final_approved=null`. Step 2: HR deletes BOTH config rows mid-flight
  (the exact scenario under test). Step 3: the SAME manager — who already
  satisfies `direct_manager` and would pass the legacy `validateApprover`
  check — attempts to approve AGAIN; **genuinely refused with a real 409**
  ("has an approval chain in progress... Restore the configuration..."),
  and read-back confirms the regularisation is STILL `pending`,
  `approved_by` is still `null`, and the `approval_instances` row is
  UNCHANGED — no partial or hybrid state, nothing silently skipped. Step
  4, the authorized recovery path: HR restores the identical config (same
  `level` numbers, via the real `POST /approvals/workflows/config`
  endpoint) and the CORRECT level-2 approver (hr_admin) then approves for
  real — read-back confirms the chain resumes cleanly and finalizes
  (`status='approved'`, `approval_instances.final_approved=true`). **The
  documented recovery path, now proven, not asserted**: when an in-flight
  chain's config is deleted or deactivated, HR must restore
  `approval_workflow_config` rows with the SAME `level` numbers the open
  `approval_instances.current_level` still expects (via `POST /approvals/
  workflows/config`, which upserts on `(tenant_id, workflow_type,
  level)`) — after that, the correct approver for that level can proceed
  normally; there is no separate "force-unstick" endpoint, and none is
  needed, since restoring the config is sufficient and keeps the
  per-level approver requirement intact rather than bypassing it.
  (A seed-config bug was hit and fixed while building this script:
  `getOrCreateInstance` resolves a new instance's `submitted_by` from the
  OWNING employee's own `profiles` row, not the approvers' — without one,
  it silently returns null and `gateApprove` falls straight to legacy
  before ever reaching the config/instance check under test, which is
  exactly why the first run of this script showed the bypass "succeeding"
  at step 1 for the wrong reason; fixed by seeding a profile for the
  report employee too, not just the manager and HR.)

  **3. Team-scope rules — expanded coverage for reassignment, cross-
  tenant, and unlinked-manager, across all three checkpoint-11 fixes.**
  9 new mocked tests added across the three existing scope-test files
  (now 8/10/10 tests respectively — 28 total, up from 5/7/7 — 19 total):
  **reassignment** — the
  former manager genuinely loses access and the new manager genuinely
  gains it, proven by varying the `reportIds` fixture between calls
  (standing in for `getDirectReportIds`'s real live RPC read, which has
  no caching layer to go stale) rather than assuming it from the
  production code alone; **cross-tenant** — `leave-collision.ts` and
  (for HR) `leave-policy-resolve.ts` both correctly 404 a foreign-tenant
  `employee_id` (the tenant-membership check runs before or independent
  of the ownership check); `leave-employee.ts`'s `GET /leave/requests`
  has no explicit tenant-membership check of its own, but a manager
  requesting a foreign `employee_id` is still correctly refused 403
  (`getDirectReportIds` is itself tenant-scoped, so a foreign id can
  never appear in the report tree), and HR requesting one gets zero rows
  back, not another tenant's data (`listLeaveRequests` always ANDs
  `employee_id` with THIS tenant's `tenant_id`, so no row can satisfy
  both) — verified, not newly built, since tightening this to an explicit
  404 was not asked for and would be scope creep on a route that is
  already safe; **unlinked manager** — a `manager`-role profile with no
  linked `employee_id` is refused 403 on all three endpoints, not a
  silent tenant-wide fallthrough (already proven for `leave-employee.ts`
  in checkpoint 11; now proven for the other two as well).

  **Test suite, this checkpoint's final count**: 76/76 files (unchanged —
  all of this checkpoint's test additions extended existing files rather
  than adding new ones), 654/654 tests passed (up from checkpoint 11's
  641 — 13 new: 4 in the rewritten encashment-idempotency file + 3 each
  in the three team-scope files), 0 regressions. `tsc --noEmit` clean on
  both `apps/api` and `apps/web`. Fresh-install: migration 465 verified
  against the complete 000→465 migration history (461 files, 0 errors,
  480 tables).

  **4. Checkpoint 10's exact traceability — citations, not the word
  "closed."** The user correctly declined to accept prose-only closure
  claims. Precise references, re-checked against the current source this
  round rather than restated from memory:
  - **The finalization transaction boundary**: `supabase/migrations/
    464_payroll_finalize_atomic_seal.sql` lines 51–140 define
    `finalize_payroll_run_atomic` as a single `LANGUAGE plpgsql` FUNCTION
    (not a PROCEDURE — a plain function body has no internal `COMMIT`
    available to it at all, so nothing inside it can end the transaction
    early). Line 77, `PERFORM fn_lock_period_months(p_tenant_id,
    ARRAY[p_month])`, is the FIRST statement and acquires the advisory
    lock. Lines 84–93 re-verify the attendance-lock state. Lines 99–111
    re-verify the run's CAS status `FOR UPDATE`. Lines 113–131 are Step 1
    (finalize draft slips) and Step 2 (seal the run) — the LAST writes
    before `RETURN` at line 133 and `END;` at line 139. Because
    Supabase-js's `.rpc()` call (`apps/api/src/routes/payroll/runs.ts`
    line 2702) invokes this function as a single top-level SQL statement,
    and Postgres executes an entire function body as part of the ONE
    implicit transaction that statement opens, the lock acquired at line
    77 is provably held, uninterrupted, through every statement up to and
    including line 131 — there is no code path, inside this function,
    capable of releasing it earlier. This is what "the transaction
    boundary" concretely is: lines 51–140 in their entirety, one
    transaction, no exceptions.
  - **The deterministic concurrency proof** (re-run this round to
    reconfirm, not just cited from memory): `scripts/db/verify-finalize-
    atomic-seal.mjs` Part 2 opens a real transaction on connection A that
    calls this exact RPC and does NOT commit; while that transaction is
    open, connection B's concurrent `unlock_period_atomic` call is shown
    via `SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND
    pid=$1 AND granted=false` to be genuinely blocked (not merely slow);
    only after connection A commits does connection B's call proceed —
    and by then the run and slip are already sealed. Part 1 is the
    negative control proving the OLD (checkpoint-9) split pattern really
    did let stale payroll commit, by hand-replaying it against the same
    schema. All three parts re-run clean this round.
  - **The durable bulk-failure panel**: `apps/web/src/pages/manager/
    ManagerTeamRegularisation.tsx` — the `FailedItem` interface at line
    65, the `lastFailures` state at line 92, the `toFailedItems` resolver
    at line 108, and the persistent panel's render guard at line 259
    (`{lastFailures.length > 0 && (...)}`, which is NOT a toast — it stays
    mounted until the user retries or dismisses each row). Live-browser
    evidence: `scripts/db/verify-checkpoint10-bulk-retry-panel.mjs`,
    screenshotted at `4-panel-after-toast-fades.png` (taken 3.5s after the
    bulk-approve click — longer than the toast's own display window) and
    `5-after-retry.png` (after clicking the real "Retry" button), both
    sent to the user in checkpoint 10's turn. The script's own Postgres
    read-back, re-confirmed: after the first bulk action, A and C read
    `approved` with real timestamps and B reads `pending`; after the
    retry, B reads `approved` and — the specific claim this section is
    citing evidence for — A's and C's `approved_at` timestamps are
    BYTE-IDENTICAL to their first read, proving the retry touched only
    the one row it targeted.
- **Checkpoint 13** (this commit): the user independently reviewed
  checkpoint 12's real-Postgres approval-chain script and surfaced a
  second, different bug it had exposed while being built: a missing
  employee profile silently triggers the LEGACY single-step approval
  fallback even when a multi-level workflow genuinely applies — the user
  asked this be fixed to fail explicitly or resolve identity through an
  authorized path, with both regression and persisted tests. The user also
  asked the encashment lifecycle (approval/reversal/policy changes) be
  confirmed cap-invariant under concurrency, with same-key-different-
  payload and lost-HTTP-response-retry specifically tested, before
  resuming the unopened-module sweep.

  **1. `getOrCreateInstance` silent-legacy-fallback — fixed, fails closed
  now.** By the point `gateApprove`/`gateReject` call `getOrCreateInstance`,
  checkpoint 11's own earlier guards (`config.length===0`,
  `applicable.length===0`, both checked with `openInstanceExists` to
  distinguish "genuinely unconfigured" from "configured but instance
  already open") have ALREADY run and returned — so a workflow is
  PROVABLY configured and applicable by the time this function is reached.
  Its old bare-`null` return on a failed `submitted_by` resolution was
  indistinguishable, to both call sites, from "no workflow configured,"
  so it fell straight to the legacy single-step path — skipping every
  configured stage. Fixed (`lib/approval-orchestrator.ts`):
  `getOrCreateInstance` now returns a discriminated
  `{kind:'found'|'identity_unresolved'|'db_error', ...}` result; a new
  `instanceFailureDecision` helper turns `identity_unresolved` into a
  `409 CONFLICT` naming the actual problem ("no login profile is linked to
  the requesting employee... Link a profile... before approving") and any
  other `db_error` into a generic `DB_ERROR` — neither ever falls through
  to `{kind:'finalize', authorized:false}` (the legacy path) once a
  workflow is known to apply. **Authorized recovery path, not just a
  refusal**: `GateInput` gained an optional `submittedByHint` — the
  entity's OWN already-recorded submitter column
  (`leave_requests.requested_by`, NOT NULL; `attendance_regularisation.
  submitted_by`, nullable) — so callers that already loaded the row can
  pass its valid-at-submission-time identity directly instead of making
  `getOrCreateInstance` re-derive it from the target employee's CURRENT
  `profiles` link, which can be absent even for a validly-submitted
  request. Wired into all 4 existing call sites in `approval-service.ts`
  (leave approve/reject, regularisation approve/reject); a caller that
  omits the hint falls back to the employee→profile lookup, unchanged.
  Genuinely unconfigured workflows are completely unaffected — the
  earlier `config.length===0` guard still returns legacy, exactly as
  before, confirmed by a dedicated test case. **Deliberately not wired
  this round**: the 5 other known `gateApprove`/`gateReject` call sites
  (`comp-off.ts`, `overtime.ts`, `payroll/loans.ts`,
  `payroll/reimbursements.ts`, `payroll/advances.ts`) — the shared
  orchestrator's fail-closed fix protects them regardless (they now
  correctly error instead of silently bypassing); only the nicer
  resolved-identity UX, not a safety gap, is deferred there.

  **Mocked tests**
  (`lib/__tests__/approval-orchestrator-identity-unresolved.test.ts`, new,
  6 tests): identity-unresolved with an active config fails CLOSED with
  `CONFLICT` for both `gateApprove` and `gateReject`; a supplied
  `submittedByHint` resolves the instance WITHOUT ever querying the
  employee→profile lookup (proven by a `'THROW'` sentinel on that lookup
  path); a null/absent hint falls back to the lookup unchanged; a
  genuinely unconfigured workflow stays legacy even with a hint provided;
  a non-identity DB error during instance creation also fails closed, not
  legacy. **Real-Postgres + real-HTTP proof**
  (`scripts/db/verify-approval-chain-bypass.mjs`, extended with a new
  "Part B," steps 8–11, reusing Part A's seeded tenant/manager/HR and
  restored 2-level config): seeds a second employee with deliberately NO
  `profiles` row and a pending regularisation for them; the manager's real
  HTTP approve attempt is refused `409` with the exact "no login profile
  is linked" message, and a real Postgres read-back confirms the
  regularisation is still `pending`, `approved_by` is still `null`, and —
  critically — no `approval_instances` row was EVER created (the function
  fails before `createWorkflowInstance` is reached, not after). The
  authorized recovery path is then proven, not just asserted: a profile is
  linked to the employee, the SAME manager retries the SAME call, and it
  now succeeds, genuinely engaging the 2-level chain (advances to level 2,
  read back from Postgres as `current_level=2, submitted_by=<newly-linked
  profile id>` — proving the fallback resolution genuinely engaged, not
  that it merely stopped erroring); HR then finalizes level 2 for real.
  All 4 new steps pass alongside the unchanged original 7 from Part A.

  **2. Encashment cap invariant under concurrency — approval/reversal/
  policy-change review, same-key-different-payload, and lost-response
  retry.** Traced every writer in the encashment lifecycle
  (`processEncashment` in `accrual-engine.ts`; migration 447's
  `assign_leave_encashment_to_payroll_run_atomic`,
  `fn_finalize_leave_encashments_for_run`,
  `fn_revert_leave_encashments_for_rollback`; migration 446/448's
  `reverse_leave_encashment_atomic`) against the cap invariant (`SUM(days)
  WHERE status NOT IN ('rejected','reversed') <= max_encashable_per_year`
  for a given `tenant/employee/leave_type/year`, enforced transactionally
  at insert time by migration 465's `request_leave_encashment_atomic`,
  proven under real concurrency in checkpoint 12). **Conclusion: the
  invariant is preserved continuously, not just at insert time** — every
  writer after the atomic insert either (a) never changes a row's `days`
  value at all (approve, assign-to-run, finalize), or (b) only ever
  REMOVES a row from the counted set (reversal → `'reversed'`), never adds
  to it or resurrects a removed row. No writer in this set can increase
  the counted sum once a row exists, so a request that passed the cap
  check at insert time cannot later be pushed over the cap by anything
  downstream — this closes the "approval/reversal/policy changes preserve
  the invariant" half of the user's ask via code review; it is a logical
  argument about the writer set, not a new concurrency test, since
  checkpoint 12's Part 4 (approve → reverse → re-request) already
  exercises the one state transition (reversal) that changes set
  membership at all, under real Postgres.

  **Same-key-different-payload and lost-response-retry — a real,
  previously undetected gap, now fixed.** `lib/idempotency.ts`'s
  `checkIdempotency` replayed whatever was stored under a
  `(tenant_id, key)` pair with NO comparison against the current request
  body — a client that reused an Idempotency-Key across two meaningfully
  different submissions would silently get back the FIRST request's
  result describing a DIFFERENT request, with the second one dropped,
  never inserted, never reported as refused. Fixed, backward-compatibly:
  migration 466 adds an optional, nullable `idempotency_keys.request_hash`
  column; `hashIdempotencyPayload()` (new) fingerprints a recursively
  key-sorted canonicalization of the parsed request body (so key-ordering
  differences across clients still hash identically); `getStoredRequestHash()`
  (new) reads back whatever hash is stored for a key;
  `claimIdempotency`/`storeIdempotency` each gained an OPTIONAL trailing
  `requestHash` parameter (every existing call site across the codebase
  that omits it is unaffected — `checkIdempotency`'s own signature and
  return type are completely unchanged, so none of its ~136 existing call
  sites needed touching). Wired into `POST /leave/encashment/request`
  (`routes/attendance/leave-accrual.ts`): the route now calls
  `getStoredRequestHash` BEFORE `checkIdempotency`, and a mismatch is
  refused with a new `409 IDEMPOTENCY_KEY_REUSED` rather than replayed or
  silently reprocessed as an untracked third request; the genuine retry
  case (same key, same payload, simulating a client that committed but
  never saw the HTTP response) is unaffected and still replays the cached
  result.

  **Mocked tests**
  (`routes/attendance/__tests__/leave-encashment-request-hash-mismatch.
  test.ts`, new, 4 tests): same-key-different-payload → `409
  IDEMPOTENCY_KEY_REUSED`, no second RPC call, first result not replayed;
  same payload with different JSON key ORDERING is still recognized as
  the same request (hash is computed from the parsed/normalized body, not
  raw bytes) and replays normally; a genuine retry after a fully-committed
  request (simulating a lost HTTP response) replays the exact cached
  result with no second RPC call; a pre-existing row with no stored hash
  at all (a hash-naive legacy row) is unaffected, still replays as before.

  **Real-Postgres + real-HTTP proof, with an honestly-disclosed test-infra
  bug found and fixed along the way**
  (`scripts/db/verify-encashment-idempotency-hash.mjs`, new): seeds a real
  tenant/employee/encashable leave type, then drives the real compiled API
  over real HTTP. First attempt at running this script against the
  existing local gateway shim (`/tmp/supabase-gateway.mjs` — sandbox-only
  test infrastructure, **not part of the repo**, built in prior rounds to
  stand in for the unreachable real `postgrest` binary) returned `409
  DUPLICATE_REQUEST` on the very FIRST request, every time, whenever an
  Idempotency-Key header was sent — meaning `claimIdempotency`'s real
  INSERT (via the real `supabase-js` client, not a mock) was failing on
  every call through this gateway, silently, via its own documented
  fail-safe ("any other insert failure... fail safe by not claiming").
  Root-caused with a direct `curl` reproduction against the gateway's REST
  endpoint: the shim's generic insert/update handler forwarded a JS `null`
  (the value `claimIdempotency` deliberately sends for the NOT-NULL jsonb
  `response` column while a claim is in-flight) as a bare SQL NULL
  parameter, violating the NOT NULL constraint — where real PostgREST
  distinguishes an explicit JSON `null` sent for a jsonb column (stored as
  the jsonb null literal) from a true SQL NULL. **This means the
  encashment route's real HTTP behavior with an Idempotency-Key header had
  never actually been exercised successfully end-to-end before this
  round** — checkpoint 12's own real-Postgres script called the RPC
  directly via raw `pg.Client` queries (deliberately routing around this
  exact gateway limitation per its own code comment), and the mocked route
  tests mock `supabase` entirely, so neither could have caught it. Fixed
  the test shim itself (a `JSONB_NULL_COLUMNS` table/column allow-list,
  currently just `idempotency_keys.response`, explicitly commented as a
  test-infra fix, not a product change) rather than working around it in
  the test — re-ran `verify-approval-chain-bypass.mjs` and
  `verify-encashment-cap-atomic.mjs` afterward to confirm zero regression
  from the shim change (both: ALL PARTS/STEPS PASS, unchanged results).
  With the shim fixed, all 3 steps of the new script pass against real
  Postgres: (1) first submission persists exactly once; (2) the SAME key
  with a DIFFERENT payload (2 days vs. the original 3) is refused `409
  IDEMPOTENCY_KEY_REUSED`, is NOT the first response replayed, and leaves
  exactly 1 row persisted, not 2; (3) retrying the SAME key with the SAME
  payload (simulating a client that never saw the first response) returns
  the byte-identical cached response with `Idempotency-Replayed: true` and
  still exactly 1 row persisted — no duplicate insert from the "lost
  response" retry. Final Postgres read-back: exactly one row, `days=3`
  (the original request), never overwritten, duplicated, or bypassed by
  either the mismatched or the retried attempt.

  **Migration 466 fresh-install**: applied cleanly against a newly created
  database with the project's `scripts/db/bootstrap.sql` shim, then the
  complete `000`→`466` history — 462 `.sql` files, 0 errors; resulting
  schema has 468 tables in `public` (`pg_tables`); `idempotency_keys.
  request_hash` confirmed present (`TEXT`, nullable) via `\d`.

  **Test suite, this checkpoint's final count**: 78/78 files (up from
  checkpoint 12's 76 — 2 new files: the identity-unresolved orchestrator
  tests and the hash-mismatch route tests), 664/664 tests passed (up from
  654 — 10 new: 6 + 4), 0 regressions. `tsc --noEmit` clean on both
  `apps/api` and `apps/web`.

- **Checkpoint 13 addendum** (same commit, follow-up to the user's
  qualification before this review could be treated as closed): four
  specific follow-ups, all closed with evidence, not restated claims.

  **1. Cap invariant extended to policy changes and excluded→counted
  transitions — a real gap check, not restated reasoning.** Enumerated
  every writer of `leave_encashment_requests.status` across the codebase
  (grepped, not assumed): the atomic insert (pending), `processEncashment`
  (pending→approved), the route-level reject (pending→rejected),
  `assign_leave_encashment_to_payroll_run_atomic`/
  `fn_finalize_leave_encashments_for_run` (approved→paid, both counted,
  no membership change), `fn_revert_leave_encashments_for_rollback`
  (paid→approved, same), `reverse_leave_encashment_atomic`
  (approved/paid→reversed, guarded by `v_req.status NOT IN
  ('approved','paid')` raising `CONFLICT` for anything else — so a
  rejected or already-reversed row can never be "re-reversed" back into a
  counted status). **No writer anywhere transitions a row OUT of
  `rejected`/`reversed`** — confirmed by reading every one, not inferred.
  **Cap-policy changes** (`leave_accrual_rules.max_encashable_per_year`/
  `encashable`) can't desync the invariant because the enforcement was
  never a stored "remaining allowance" counter — `request_leave_encashment_
  atomic` re-sums live rows and reads the rule fresh on every call, so a
  policy edit is picked up immediately and correctly for every subsequent
  request, with nothing cached to go stale. **Real-Postgres proof**, new
  "Part 5" in `scripts/db/verify-encashment-cap-atomic.mjs`: a request
  succeeds under a newly-lowered cap; a second request that would have
  been refused under that same lowered cap succeeds once the cap is
  raised again (3+4=7, > the old cap of 5, <= the new cap of 10) — proving
  the check reads the rule live, not a value captured once; a request
  rejected then reversed is refused with `CONFLICT` (not resurrected); a
  request approved, reversed, then reversed AGAIN is refused with
  `CONFLICT`, and `leave_balance_ledger` has exactly ONE reversal row for
  it, not two (no double-credit). Building this surfaced and fixed a bug
  in the test's OWN setup, not the product: the script's reused tenant/
  employee from Part 2 had no `employee_leave_balance` row, so the
  reversal function's explainability-log `INSERT...SELECT` silently
  matched zero rows — fixed by seeding a balance row at the top of Part 5,
  matching what a real approval would already have created.

  **2. `submittedByHint` — verified tenant-scoped and not client-
  overridable, by tracing the data flow, not asserting it.** All 4 call
  sites (`approveLeaveRequest`/`rejectLeaveRequest`/`approveRegularisation`/
  `rejectRegularisation` in `approval-service.ts`) pass a value read
  directly off a DB row fetched with `.eq('tenant_id', tenantId)` —
  `getLeaveRequest()` for leave (`leave-request-service.ts:577-594`) and a
  direct `attendance_regularisation` select for regularisation — and that
  `tenantId` is itself `req.tenantId`, set exclusively by the auth plugin
  from the authenticated session, never read from the request body or any
  route parameter. Checked every one of the 4 HTTP route handlers
  (`leave-requests.ts`, `regularisation.ts`) for a client-suppliable
  `requested_by`/`submitted_by`/`submittedByHint`-shaped body field that
  could flow into this value: none exists — the approve/reject request
  bodies accept only unrelated fields (e.g. a rejection `reason`). No new
  defect found; this closes the verification as a clean result, not a
  fix.

  **3. Gateway fix preserved and versioned; affected-evidence search
  completed with a definitive negative result.** The corrected gateway
  (the `JSONB_NULL_COLUMNS` fix from the main checkpoint 13 entry above)
  is now committed at `scripts/db/local-test-gateway.mjs` — previously it
  existed only at `/tmp/supabase-gateway.mjs`, recreated from scratch each
  session with no history; the committed file's header carries its own
  fix-history note so a future diff explains itself. **Earlier-evidence
  search**: grepped every real call site of `claimIdempotency` codebase-
  wide (the only function whose bug-triggering `response: null` insert the
  gateway bug affects — `checkIdempotency`/`storeIdempotency` never hit
  it, since `storeIdempotency` always writes a real response object) — 5
  sites total: `leave-accrual.ts` (encashment, new this round),
  `leave-entitlement.ts` ×3 (monthly/yearly/carry-forward accrual jobs —
  confirmed via grep to have NO caller anywhere in the codebase, not even
  the scheduler, so never exercised with a header at all), `integrations/
  index.ts` (PAN verify), `imports/index.ts` (import job creation). Then
  grepped every frontend page that ever sends an `Idempotency-Key` header
  (36 files) and mapped each to its target endpoint: none target PAN-
  verify, import-creation, or any of the 3 entitlement routes — the
  routes those pages DO target (`/succession/calibration`, `/payroll/
  runs`, `/payroll/arrears/batches`, reimbursement/advance/comp-off/
  regularisation approvals, etc.) use the separate, unaffected
  `checkIdempotency`/`storeIdempotency` pair, confirmed via the same
  grep that found only 5 `claimIdempotency` call sites total. Finally,
  grepped every script under `scripts/` for an `Idempotency-Key` header:
  exactly 2 files ever send one — `verify-encashment-cap-atomic.mjs`
  (Part 1 uses a raw `pg.Client` INSERT with an explicit `'null'::jsonb`
  cast, deliberately routing around the gateway's REST layer entirely per
  its own code comment — never exercised the broken path) and this
  round's own new `verify-encashment-idempotency-hash.mjs` (which is what
  found the bug, before it was used to support any claim). **Conclusion,
  not an assumption: zero prior checkpoints' reported evidence relied on
  the broken path.** Re-ran `verify-approval-chain-bypass.mjs` and
  `verify-encashment-cap-atomic.mjs` after the gateway fix regardless, to
  confirm it introduced no regression of its own — both unchanged, all
  parts/steps still pass; no other committed script needed re-running.

  **4. Test suite re-confirmed after the Part 5 additions**: 78/78 files,
  664/664 tests (unchanged — Part 5 is a `.mjs` script, not a vitest
  file). `tsc --noEmit` clean on both apps.

- **Checkpoint 14 — tier 2, batch 1** (this commit): the user's standing
  instruction is to continue the sweep without pausing between
  checkpoints; this is the first tier-2 batch, covering `punch.ts`,
  `corrections.ts`, `overtime.ts` (re-examined, not just its approval-queue
  scope), `recompute.ts`, `retroactive.ts`, `period-locks.ts` — the exact
  6 files this register's own prior entry named as the next batch.

  **1. `corrections.ts` — a configured multi-level approval chain was
  100% ignored, not just bypassable on an edge case. SEVERE, now fixed.**
  `attendance_correction` is a registered entity type
  (`ENTITY_WORKFLOW_MAP` → workflow_type `'correction'`) with a real,
  reachable admin UI to configure a chain for it — Settings → Approval
  Workflows → a labeled "Corrections" tab
  (`apps/web/src/pages/settings/ApprovalWorkflows.tsx` line 95), backed by
  a real, accepting API (`routes/approvals/workflows.ts`'s
  `WORKFLOW_TYPES` enum includes `'correction'`). But
  `corrections.ts`'s `approveOneCorrection`/reject handler never called
  `gateApprove`/`gateReject` at all — every correction finalized in ONE
  step via the route's own bespoke `authoriseApprover` (manager-or-HR),
  silently skipping every stage past the first for ANY tenant that
  configured a chain through that real UI. This is a stronger version of
  the bug class checkpoints 11-13 already closed elsewhere: not a
  fallback triggered by a missing identity or a deleted config, but total
  non-engagement of the orchestrator for this entity type — and the
  route had **zero existing tests** before this fix, which is plausibly
  why it went unnoticed. Fixed: wired `gateApprove`/`gateReject`
  identically to the established leave/regularisation/overtime pattern,
  including the `submittedByHint` authorized-path identity
  (`attendance_corrections.submitted_by`, set at submission time to the
  real submitting user's own profile id — confirmed by reading the
  `POST /attendance/corrections` handler, not assumed). `attendance_
  corrections.status` has no separate "approval_level" column the way
  leave does, so an intermediate `{kind:'advanced'}` decision now simply
  leaves `status` at `'pending'` (unchanged) rather than CAS-advancing it
  to `'processing'` — correctly deferring the recompute/event/
  orchestration side effects until the chain is actually closed.
  Genuinely unconfigured workflows are completely unaffected (confirmed
  by test and by code: `config.length===0` still returns legacy
  immediately, before ever reaching this route's own authorization
  logic). **Mocked tests** (new,
  `corrections-approval-chain.test.ts`, 5 tests): a 2-level chain
  genuinely advances on the first approval (stays pending, not
  processing) and only finalizes on the second; an unconfigured workflow
  is unaffected; reject finalizes immediately at any level; a non-direct-
  manager is still refused by the legacy check when no chain applies.
  **Real-Postgres + real-HTTP proof** (`scripts/db/verify-approval-chain-
  bypass.mjs`'s new "Part C", reusing Part A's seeded tenant/manager/HR):
  a genuine 2-level chain seeded via raw SQL (equivalent to what the real
  UI would write); the manager's real HTTP approval correctly only
  ADVANCES (stays `'pending'`, a real `approval_instances` row opens at
  level 2 — before this fix it would have silently finalized to
  `'processing'` right here); HR's real HTTP approval at level 2
  genuinely finalizes (`'processing'`, `approved_by` correctly HR's own
  id, `approval_instances.final_approved=true`); a separate correction
  rejected at level 1 finalizes immediately as `'rejected'` with the
  chain closed at level 1 (never advanced) — matching `gateReject`'s
  documented "any level may reject" semantics. All 4 new steps pass
  alongside the unchanged original 11 from Parts A/B.

  **2. `period-locks.ts`'s auto-LOP job orphans open approval chains —
  real, now fixed.** The `/lock` route's fire-and-forget auto-reject of
  every still-pending regularisation for the locked month does a raw
  `UPDATE attendance_regularisation SET status='rejected'`, bypassing
  `gateReject` entirely. If any of those regularisations had an OPEN
  multi-level `approval_instances` row (advanced past level 1, genuinely
  awaiting a later approver — proven reachable: `regularisation.ts`
  already supports exactly this, confirmed throughout Parts A-C above),
  that row was left orphaned: `current_level`/`final_approved` untouched,
  `final_approved` still `NULL` — the entity reads `'rejected'` but its
  own chain metadata still claims "awaiting approval," which would keep
  surfacing a dead request in an approver's pending-approvals view.
  Fixed: the same fire-and-forget block now also closes any such open
  instance (`final_approved=false, closed_at=now()`), mirroring
  `recordAndAdvance`'s own close semantics exactly. **Real-Postgres +
  real-HTTP proof** (new `scripts/db/verify-period-lock-auto-lop-closes-
  chain.mjs`): seeds a tenant/manager/HR/employee and a real 2-level
  regularisation chain, advances a regularisation to level 2 via real
  HTTP (leaving a genuinely open instance, confirmed by read-back before
  proceeding), then HR locks the period via real HTTP
  `POST /attendance/period-locks/:month/lock`; polls Postgres for the
  fire-and-forget job to settle; confirms the regularisation reads
  `'rejected'` with the auto-LOP message AND the `approval_instances` row
  is now closed (`final_approved=false`, `closed_at` set) rather than
  left open forever. Both assertions PASS.

  **3. Files read and found already correct, no defect**: `punch.ts`
  (tenant-scoped, admin-vs-self correctly gated, period-lock checked,
  the DB-level unique constraint backstops the idempotency layer for the
  exact same-timestamp race); `overtime.ts` (already correctly wired to
  `gateApprove`/`gateReject` from an earlier round — confirmed the
  `'advanced'` branch is handled properly and `'finalize'` correctly
  falls through to the real OT engine call; missing only the optional
  `submittedByHint` nicety, which is the same already-disclosed,
  deliberate scope decision from the main checkpoint 13 entry above, not
  a new gap, since the orchestrator's own fail-closed behavior protects
  it regardless); `recompute.ts` (admin-only, tenant-scoped,
  `fetchAllRows` used correctly per CLAUDE.md's universal pagination
  rule, period-lock checked before either the single-employee or
  background bulk path, background job status/error tracking correct).

  **4. Disclosed, not fixed (low severity, read-only observability)**:
  `retroactive.ts`'s `POST /attendance/retroactive/detect` has no
  de-duplication — confirmed via `\d attendance_retroactive_impacts` that
  no unique constraint exists — so calling `/detect` twice for an
  overlapping date range inserts duplicate impact rows. This is a
  data-quality nit in a read-only admin observability list (the kind of
  module CLAUDE.md's "admin-load philosophy" section already discusses
  de-emphasizing), not a security or financial-correctness defect; left
  for a future round rather than scope-creeping this batch.

  **Test suite, this checkpoint's final count**: 79/79 files (up from
  78 — 1 new file, `corrections-approval-chain.test.ts`), 669/669 tests
  passed (up from 664 — 5 new), 0 regressions. `tsc --noEmit` clean on
  both `apps/api` and `apps/web`. (**Correction**: the version of this
  entry pushed in commit `ad72803a` stated 80/80 files and 674/674 tests —
  an arithmetic slip caught on the next re-run, corrected here; no test
  file or test case was ever actually lost, this was a reporting error
  only, not a regression.)

## Repository-wide file tracker (checkpoint 14, replaces prior approximate tier counts)

The user asked for a fixed, countable tracker in place of "~49 unopened
files"-style prose estimates. Below is that tracker, counted directly from
the repository, not estimated.

**Scope and exclusions, stated explicitly:**
- **Counted unit**: `.ts` files under `apps/api/src/routes/**` (excluding
  `__tests__/` directories), the backend route surface this audit's item-2
  checklist (tenant scoping, object/team-level authorization, FK
  cross-tenant validation, CAS/optimistic concurrency, storage-path
  privacy, pagination, approval/reversal correctness) actually applies to.
  Verified by direct `find`, not recalled from memory: **289 files across
  53 route-namespace directories, plus 1 standalone top-level file
  (`setup.ts`) = 54 tracked rows, 289 files total.**
- **Excluded from this file-count** (tracked qualitatively elsewhere in
  this register, not as audited "files" here): `apps/web/src/pages/**`
  (this audit's web-layer work has been nav-link spot-checks and a handful
  of browser-verified flows, not a per-file authorization review — the
  web app has 40+ page directories, separately disclosed below, not
  file-counted); `apps/api/src/lib/**` shared services (reviewed
  opportunistically while tracing a route's logic, e.g. `accrual-engine.ts`,
  `approval-orchestrator.ts` — not independently tracked as "files" since
  they have no authorization surface of their own, only logic a route
  calls into); `supabase/migrations/**` (tracked separately via the
  fresh-install/schema-drift checks already in this register, not as
  "route files"); `scripts/`, `components/` (not routes).
- **"Examined" is deliberately strict**: a file counts as Examined only
  where this specific audit (SYSTEM_AUDIT_2026-10-14, checkpoints 1–14)
  has a documented, specific finding (a defect fixed, or a file explicitly
  named as read against the item-2 checklist and found correct) — not
  merely referenced in passing, not merely nav-link-fixed on the web side,
  and not merely "tested in a prior round" (G01-G13, UAT rounds,
  market-readiness rounds, tenant-licensing work) predating this specific
  audit. Those prior-round claims are real prior evidence — cited per-row
  below where they exist — but are kept visibly separate from what this
  audit itself has re-verified, per the same evidentiary discipline this
  register has used throughout (source / mocked / real-Postgres / browser
  kept distinct, never blended into one "tested" claim).
- **"Examined" is not "tested," and both are weaker than "defect-free."**
  Examined means the source was read against the item-2 checklist. Tested
  means a specific claim from that reading has mocked, real-Postgres,
  real-HTTP, or browser evidence behind it (per-checkpoint, cited in the
  batch-log entries above — e.g. `corrections.ts` is both Examined AND
  Tested, with 5 mocked tests + 4 real-HTTP steps; a file marked Examined
  with no accompanying test citation was read and found to already match
  the checklist, which is a weaker claim than "proven under test." Neither
  status is a claim of defect-freedom: it is specifically a claim about
  what WAS checked, not a guarantee about what wasn't. The "Open defects"
  column counts only what is currently KNOWN and disclosed-unfixed (one
  row, `retroactive.ts`'s dedup gap) — it is not, and must not be read as,
  an assurance that the other 234 unexamined files, or the 53 examined-
  but-found-correct files, contain zero defects. Absence of a listed
  defect means "not yet found," not "verified absent."

| Module (route namespace) | Total files | Examined (this audit) | Remaining | Open defects | Blocked verification |
|---|---|---|---|---|---|
| attendance | 64 | 64 | 0 | 1 open-confirmed (retroactive.ts dedup — low-severity, read-only observability, disclosed not fixed). 14 found-and-FIXED-same-batch (roster-api.ts pagination ×2, roster-calendar.ts rotation-members pagination, leave-reconciliation.ts breakdown-aggregation, writeLedgerEntry idempotency + atomicity, regularisation-policy.ts SLA-breach-reject chain orphaning, scoped-policy accrual gap (migration 470 + `leave-entitlement-service.ts` scope-chain resolver), two-accrual-system double-credit (migration 470 execution-time guard), reconciliation.ts's `/attendance/reconciliation/open` capped-breakdown undercounting, **workforce-optimization.ts missing-authz on 7 routes, health-index.ts department/tenant pagination, 4-file DECIMAL-string-coercion NaN bug, risk.ts `/summary` pagination, risk.ts non-deterministic pagination tie-breaker** — don't count as open) | — |
| employees | 31 | 31 | 0 | 0 | separation-workflow.ts F&F section (~lines 416-972) relies on prior-round evidence, not re-read this audit |
| payroll (incl. statutory/) | 52 | 11 | 41 | 0 open-confirmed. 5 found-and-FIXED-same-batch (runs.ts DELETE TOCTOU race; compensation-revisions.ts silent component-copy swallow → rebuilt fully atomic; advances.ts /recover guaranteed-NOT-NULL-violation + stuck-schedule torn write; loans.ts /record-payment identical guaranteed-NOT-NULL-violation + non-idempotent retry; **record_loan_payment_atomic (migration 396) column-ambiguity bug that made the function fail on every call since it was created — silently breaking runs.ts's own automatic loan-balance sweep this whole time**) — don't count as open | approval/finalization/F&F/encashment-adjacent correctness relies on PRIOR rounds (G12 etc.), not re-verified by this audit's own checkpoints; the 41 remaining files include all 14 statutory/ files (not yet opened) |
| masters | 29 | 0 | 29 | — | nav-link fixes only; no file-level authz review this audit |
| ess | 12 | 0 | 12 | — | distinct from the frozen web ESS Context Rail (CLAUDE.md) — this is the unrelated API namespace |
| onboarding | 8 | 0 | 8 | — | — |
| system | 8 | 0 | 8 | — | — |
| datasets | 10 | 0 | 10 | — | — |
| analytics | 6 | 0 | 6 | — | — |
| manager | 6 | 3 (team-assets.ts/team-helpdesk.ts/team-regularisation-context.ts — referenced as the operational-visibility policy source in checkpoint 4) | 3 | 0 | — |
| enterprise | 3 | 0 | 3 | — | — |
| governance | 3 | 0 | 3 | — | — |
| operations | 3 | 0 | 3 | — | — |
| workspace | 4 | 0 | 4 | — | — |
| notifications | 4 | 0 | 4 | — | web nav fixes only; backend not audited this audit |
| compensation | 2 | 0 | 2 | — | — |
| approvals | 2 | 1 (governance-evolution.ts — cp11: 500-vs-409 + missing FK check) | 1 (workflows.ts not opened) | 0 | — |
| fabric | 2 | 0 | 2 | — | — |
| intelligence | 2 | 0 | 2 | — | — |
| owner | 2 | 1 (error-reports.ts — screenshot-signing re-validation) | 1 (index.ts) | 0 | index.ts's activate/suspend/cancel/hard-delete relies on the prior tenant-licensing round (CLAUDE.md), not this audit |
| recruitment | 2 | 0 | 2 | — | built in a prior market-readiness round, not re-verified this audit |
| trust | 2 | 0 | 2 | — | — |
| setup (top-level file) | 1 | 1 (cp1: anti-hijack IDOR fix) | 0 | 0 | — |
| support | 1 | 1 (cp2: screenshot-path tenant-folder validation) | 0 | 0 | — |
| absconding | 1 | 0 | 1 | — | — |
| assets | 1 | 0 | 1 | — | F&F asset-recovery covered via a prior round, not this audit |
| assistant | 1 | 0 | 1 | — | — |
| benefits | 1 | 0 | 1 | — | — |
| billing | 1 | 0 | 1 | — | — |
| certifications | 1 | 0 | 1 | — | — |
| community | 1 | 0 | 1 | — | — |
| compliance | 1 | 0 | 1 | — | PT/TDS slabs verified in a prior UAT round, not this audit |
| departments | 1 | 0 | 1 | — | — |
| documents | 1 | 0 | 1 | — | — |
| executive | 1 | 0 | 1 | — | — |
| helpdesk | 1 | 0 | 1 | — | — |
| import | 1 | 0 | 1 | — | — |
| imports | 1 | 0 | 1 | — | — |
| integrations | 1 | 0 | 1 | — | — |
| letters | 1 | 0 | 1 | — | — |
| mood | 1 | 0 | 1 | — | — |
| observability | 1 | 0 | 1 | — | — |
| policy | 1 | 0 | 1 | — | — |
| positions | 1 | 0 | 1 | — | — |
| recognition | 1 | 0 | 1 | — | — |
| reports | 1 | 0 | 1 | — | — |
| security | 1 | 0 | 1 | — | — |
| signal-intelligence | 1 | 0 | 1 | — | — |
| succession | 1 | 0 | 1 | — | — |
| surveys | 1 | 0 | 1 | — | — |
| talent | 1 | 0 | 1 | — | — |
| uploads | 1 | 0 | 1 | — | — |
| whatsapp | 1 | 0 | 1 | — | — |
| workforce | 1 | 0 | 1 | — | — |
| **TOTAL (54 rows, 53 namespaces + setup.ts)** | **289** | **113** | **176** | **1 open-confirmed (retroactive.ts dedup — low-severity, read-only observability) — none else currently open; the scoped-policy accrual gap and the two-accrual-system double-credit, both CONFIRMED financial defects as of checkpoint 14, are now FIXED as of checkpoint 15 (migration 470) — see that section below; every other defect found this audit was fixed in the same checkpoint it was found** | **global: hosted Supabase/RLS/storage behavior is never verified anywhere in this tracker — see "Explicitly still blocked" below; PT/TDS/F&F/asset/careers/tenant-licensing rows above rely on evidence from rounds OUTSIDE this specific audit, real but not re-verified here** |

**Checkpoint 14 continuation, second leg**: 4 more files examined —
`manager-dashboard.ts`, `payroll-summary.ts`, `context.ts` (no defects;
all already correctly bound team-scale queries / delegate to
`fetchAllRows`-correct `buildMonthReadModel` / explicitly cite CLAUDE.md's
bounded-top-N exception), and `regularisation-policy.ts`, where a fifth
real defect was found and fixed: `POST /attendance/regularisation/
breach-check`'s SLA-breach auto-reject used a raw `UPDATE`, bypassing
`gateReject` — the same orphaned-`approval_instances`-chain bug class as
the period-locks.ts fix earlier in this same checkpoint. Fixed by routing
it through the same `auto_lop_reject_regularisations_atomic` RPC
(migration 468 adds a `p_rejection_reason` parameter, non-breaking for
the existing period-locks.ts call site). Proven via
`scripts/db/verify-sla-breach-reject-closes-chain.mjs`: a real 2-level
chain advanced to level 2, backdated past a 1-hour SLA, breach-check
called over real HTTP — the request rejects with the SLA message AND the
chain closes (`final_approved=false`, `closed_at` set), not orphaned.
**Updated: attendance 33/64 examined (31 remaining); overall 71/289
examined, 218 remaining.**

**Checkpoint 14 continuation, third leg**: 2 more files examined —
`ingest.ts` (public device-auth ingestion endpoint; tenant correctly
derived server-side from the device row, not client-supplied; proper
dedup upsert) and `fetch.ts` (per-employee attendance fetch; already
correctly uses `fetchAllRows` for both `attendance_daily` and
`attendance_logs` over a caller-supplied, unbounded date range, with
proper self/manager/HR ownership scoping). No defects found in either.
**Updated: attendance 35/64 examined (29 remaining); overall 73/289
examined, 216 remaining.**

**Reduction this batch (checkpoint 14, tier 2 batch 1)**: attendance moved
from 0/64 examined (nothing in `attendance` had been counted under this
strict this-audit-only definition before checkpoint 14's own file-level
work began) to 16/64 — the checkpoint 3/6/7/11/12/13/14 files
(`leave-requests.ts`, `leave.ts`, `leave-collision.ts`, `leave-employee.ts`,
`leave-policy-resolve.ts`, `leave-accrual.ts`, `regularisation.ts`,
`overtime.ts`, `comp-off.ts` (approval-queue scope), `process.ts`,
`period-locks.ts`, `punch.ts`, `corrections.ts`, `recompute.ts`,
`retroactive.ts`, plus the encashment route). **Overall remaining: 235 of
289 files (81%).** This replaces every prior "~49 unopened" / "~43
unopened" estimate in this document with the exact count above; those
prose estimates undercounted because they were scoped to "tier 2 of
`routes/attendance`" alone rather than the full repository.

**Checkpoint 14 continuation (same 48-file batch, no new phase)**:
13 more `attendance` files examined — `wfh.ts`, `muster.ts`, `muster-
upload.ts`, `roster-context.ts`, `wo-credit.ts` (all read in full, no
defect found), `roster-api.ts`, `roster-calendar.ts`, `leave-duration.ts`,
`leave-jobs.ts`, `leave-reconciliation.ts`, `leave-scheduler-status.ts`,
`leave-accrual-lifecycle.ts`, `leave-entitlement.ts`. Four real defects
found and fixed in this continuation, each with real-Postgres/real-HTTP
evidence (verification scripts committed alongside):
1. `roster-api.ts`'s main `GET /attendance/roster` had `shift_roster`,
   `employee_shifts`, and `job_history` as unbounded `.select()` calls —
   the same CLAUDE.md pagination-ceiling class as the Muster Roll bug,
   since `employee_shifts`/`job_history` are sized 1:1 with employee
   count. A second instance in `copy-week`'s source-week fetch, same fix.
   Proof: `scripts/db/verify-roster-api-pagination.mjs` seeds 1,050
   employees/standing-shifts/job_history rows in one tenant and confirms
   the real endpoint returns all 1,050, not truncated at 1,000.
2. `roster-calendar.ts`'s `GET /roster-rotation-members` had the same
   unbounded-select shape for a table sized ~1:1 with rotation-assigned
   employee count (unlike this file's other, genuinely small admin-CRUD
   tables).
3. `leave-reconciliation.ts`'s `GET /leave/reconciliation/open` computed
   its `by_type`/`by_severity` breakdown from the same capped (`limit`,
   ≤200) page shown to the dashboard, so the breakdown silently
   undercounted for any tenant with more unresolved issues than that page
   size while `total` (from an exact count) stayed correct. Fixed by
   deriving the breakdown from a dedicated `fetchAllRows` pull.
4. **The most severe finding of this continuation**:
   `leave-entitlement-service.ts`'s `writeLedgerEntry()` — relied on by
   `runEngineMonthlyAccrual`/its yearly sibling to prevent double-crediting
   `employee_leave_balance` on a repeated call — used an
   `.upsert({onConflict: '...'})` against a column list that matches
   `leave_accrual_ledger`'s `uidx_accrual_ledger_idempotency` index, but
   that index is PARTIAL; Postgres rejected the upsert on *every* call
   with "there is no unique or exclusion constraint matching the ON
   CONFLICT specification", and that error was silently swallowed —
   the function always returned `{skipped: false}`, making the "can't
   double-credit on re-run" guarantee a complete no-op, since
   `creditEmployeeDays()` itself has no idempotency of its own. Found
   empirically while investigating a separate suspected issue (see below)
   — `employee_leave_balance` was observed drifting to 2× the ledger
   total via `scripts/db/verify-accrual-scope-gap.mjs`. Fixed by switching
   to a plain `INSERT` and treating a real `23505` unique-violation as the
   idempotency signal (the same pattern `claimAccrualRun`/
   `claimIdempotency` already use elsewhere in this codebase). Proof:
   `scripts/db/verify-engine-accrual-ledger-idempotency.mjs` — two real
   HTTP calls to the same monthly-accrual endpoint for the same employee/
   leave-type/period; call 2 is now a genuine no-op (`skipped: 1`,
   balance and ledger both unchanged), and `employee_leave_balance` is
   confirmed equal to `sum(leave_accrual_ledger)` afterward.

Also fixed in the same continuation (test infrastructure, not product
code): the local gateway's RPC handler treated every JS array parameter
as a native Postgres array type (from an earlier checkpoint-14 fix for a
`UUID[]` parameter), which broke `credit_monthly_accrual_batch`'s JSONB
`p_employee_days` parameter (a JS array of objects). Fixed by introspecting
each RPC's real parameter types from `information_schema.parameters` and
only treating a value as a native array when the function's own declared
parameter type is itself an array type.

**Checkpoint 14 continuation, fourth leg — user-directed follow-up on the
two disclosed accrual items above.** The user correctly flagged that
sequential-retry evidence doesn't prove concurrency safety or crash
recovery, and that the two-system overlap needed an actual controlled
test rather than staying an "unconfirmed risk." Both were re-investigated
with dedicated real-Postgres + real-HTTP scripts; one finding is now
fixed, the other is upgraded from disclosed risk to a CONFIRMED open
functional defect, and the scope gap is now a fully diagnosed open
finding (not deferred as "needs a product decision" with no further
analysis).

1. **Engine-accrual concurrency and crash recovery — FIXED** (migration
   469, `credit_engine_accrual_atomic`;
   `scripts/db/verify-engine-accrual-concurrency-and-crash-recovery.mjs`).
   Genuinely concurrent requests (fired via `Promise.all`, not sequential
   awaits) for the same employee/leave-type/period were already safe —
   Postgres's own unique index on `leave_accrual_ledger` resolves the
   race atomically (Part A, PASS). But the ledger INSERT and the balance
   UPSERT were two separate statements; a failure between them (lost
   connection, process restart) left the ledger row as a permanent
   "already credited" signal with the balance never actually incremented
   — unrecoverable by any future retry (Part B, reproduced the gap
   against the pre-fix code by forcing the exact half-committed state).
   Fixed by wrapping both writes in one atomic RPC; re-verified by forcing
   a real mid-transaction failure (a `CHECK (balance >= 0)` violation)
   inside the SAME call that already ran the ledger insert, and confirming
   the whole call rolls back — no orphaned ledger row — after which a
   normal retry credits cleanly. Both parts now PASS.

2. **Two independent accrual-config systems overlapping for the same
   employee/period — CONFIRMED DOUBLE-CREDIT, upgraded from disclosed
   risk to an open functional defect.**
   `scripts/db/verify-dual-accrual-system-overlap.mjs` configured ONE
   employee with BOTH systems for the SAME leave type (an employee-scope
   `leave_policy_rules` assignment at 12 days/year = 1/month, AND a
   `leave_accrual_rules` row at 1 day/month) and called both real HTTP
   endpoints (`POST /leave/accrual/run` and `POST /leave/jobs/monthly-
   accrual`) in both orders. Result: **both orders produce a confirmed
   double-credit** — 2 ledger rows, balance = 2, for an employee who
   should have been credited 1 day that month. There is **no precedence
   rule of any kind** — neither code path checks whether the other
   system already (or will later) credit the same employee/leave-type/
   period; whichever runs, runs, unconditionally, regardless of call
   order. (Note: the ORIGINAL exploratory test for this, `verify-accrual-
   scope-gap.mjs` Part 3, ran before the writeLedgerEntry fix above and
   showed no double-credit only because Phase 1's ledger write was
   silently failing at the time — that result is superseded and was never
   a real "no overlap" finding.)
   **Affected configuration**: any employee who has an active
   employee-scope `leave_policy_assignments` row (or, by the same
   mechanism, any scope once item 3 below is fixed) whose policy's
   `leave_policy_rules` includes a `monthly`/`quarterly` rule for a leave
   type that ALSO has an active `leave_accrual_rules` row for that same
   leave type. Both are independently HR-admin-configurable with no
   warning that the other exists.
   **Recommended resolution** (not yet implemented — crosses into the
   `masters` namespace, 0/29 examined by this audit, so deferred to a
   dedicated pass rather than patched inside this one): add a
   mutual-exclusivity check at BOTH CRUD layers — `leave-accrual.ts`'s
   `POST`/`PUT /leave/accrual/rules` should refuse to create/activate a
   rule for a `leave_type_id` that already has an active `leave_policy_
   rules` row covering it (via any assignment scope), and symmetrically
   `masters/leave-policy-rules.ts`'s create/update for a `monthly`/
   `quarterly` rule should refuse one whose `leave_type_id` already has
   an active `leave_accrual_rules` row. This prevents new dual-configs at
   the point of creation (the cheapest, lowest-regression-risk fix) but
   does **not** retroactively detect or correct any tenant already
   dual-configured today — that needs a one-time audit query across
   existing tenants before this fix ships, which this audit has not run.

3. **Scoped-policy accrual gap — upgraded to a fully diagnosed open
   functional defect** (previously disclosed as "needs a product
   decision" with no further analysis; the user correctly rejected
   treating that as sufficient).
   Confirmed via `masters/leave-policy-assignments.ts` (line 30's
   `z.discriminatedUnion('scope_type', [employee, department,
   work_location, site, default])` and its `SCOPE_PRIORITY` map) that all
   five assignment scopes are a real, fully-supported, HR-admin-reachable
   configuration surface — department/work_location/site/default-scoped
   policies are not an edge case or theoretical possibility; they are the
   intended mechanism for covering employees WITHOUT an individual
   override, which is the common case for most of a tenant's workforce.
   **This is therefore a functional defect, not merely an architectural
   gap**: `runEngineMonthlyAccrual`/`runEngineYearlyCredit` only query
   `leave_policy_assignments` with `scope_type='employee'`
   (`leave-entitlement-service.ts` lines ~880, ~1110), so every employee
   covered ONLY by a department/work_location/site/default-scoped
   assignment — i.e., anyone without a personal override — receives
   **zero** accrual credit from this code path, silently. Confirmed
   empirically (`scripts/db/verify-accrual-scope-gap.mjs` Part 1): a
   default-scope-only employee got `employees_processed: 0` from the real
   HTTP endpoint and zero ledger rows.
   **Affected configurations**: any tenant using the `masters/leave-
   policy-*` screens with department-, work_location-, site-, or
   default-scoped assignments for `monthly`/`quarterly` `leave_policy_
   rules` — i.e., any tenant that configures accrual this way for anyone
   other than named individual employees. Tenants using ONLY
   `leave_accrual_rules` (the older, flat per-leave-type system) or ONLY
   employee-scope policy assignments are unaffected by this specific gap
   (though may be affected by finding #2 above if both systems are
   configured for the same leave type).
   **Recommended resolution**: extend `runEngineMonthlyAccrual`'s (and
   `runEngineYearlyCredit`'s) assignment query to resolve the full scope
   chain per employee — employee → department → work_location → site →
   default, in that priority order — mirroring the EXACT pattern already
   correctly implemented for *reading* policy in
   `resolveEffectiveDurationPolicy` (`leave-duration.ts`) and
   `resolveLifecyclePolicyForEmployee` (`leave-accrual-lifecycle.ts`),
   and matching the `SCOPE_PRIORITY` ordering `masters/leave-policy-
   assignments.ts` already encodes. This requires, per active employee,
   resolving their current `department_id`/`work_location_id`/`site_id`
   (via `job_history`, the same join `leave-duration.ts` already does)
   and walking the scope-candidate list — a bounded per-employee lookup,
   not a new architecture, but touches the hot per-tenant accrual loop so
   needs its own dedicated real-Postgres test (confirming no double-
   credit is introduced between the newly-resolved scopes and the
   existing employee-scope path, and that Phase 2's legacy-`leave_
   policies` exclusion set still correctly excludes everyone the engine
   path now covers) before shipping — which is why this audit is
   diagnosing and recommending it here rather than writing it inline in
   the same pass as the other fixes above, consistent with not rushing a
   change to the hot accrual loop without dedicated verification.

**Updated reduction**: attendance moved from 16/64 to **29/64** examined
(35 remaining) as of this leg (unchanged by this diagnostic work, which
touched lib files and a route already counted). **Overall: 67 of 289
files examined, 222 remaining (77% remaining)** — down from 235 remaining
at the top of this batch.

**Checkpoint 14 continuation, fifth leg**: 3 more files examined —
`api-sources.ts` (596 lines; SSRF-protected outbound fetches via
`ssrfCheck`, admin-gated, tenant-scoped, secrets properly redacted on
read), `upload.ts` (556 lines; path-traversal guard on `storage_path`,
period-lock pre-filter before punch upsert, chunked+concurrent upserts,
orphaned-job detection, background recompute correctly decoupled from
job completion), `upload-health.ts` (already correctly uses
`fetchAllRows`, fixed in a prior round). No defects found in any of the
three. **Updated: attendance 38/64 examined (26 remaining); overall
76/289 examined, 213 remaining.**

## Checkpoint 15 — both confirmed accrual defects CLOSED (migration 470)

The user explicitly rejected leaving either checkpoint-14 finding as
"diagnosed/reproduced, resolution recommended" — both are financial
correctness defects, already authorized to fix, and the "needs dedicated
tests or changes in the masters namespace" qualifier was explicitly
pre-empted as not an acceptable reason to defer. Both are now implemented,
and both are proven with real-Postgres + real-HTTP evidence, not just
code review.

**1. Scoped-policy accrual gap — FIXED.** `runEngineMonthlyAccrual` and
`runEngineYearlyCredit` (`leave-entitlement-service.ts`) previously
resolved only `scope_type='employee'` assignments, so any employee
covered solely by a department/work_location/site/default-scoped policy
assignment received zero accrual credit. Fixed by implementing the full
effective-dated priority chain (employee > department > work_location >
site > default) in two places that must agree:
- **SQL** — `resolve_engine_policy_rule(tenant, employee, leave_type,
  as_of)` (migration 470): the canonical resolver, walks all five scopes
  in declared priority order, checking `leave_policy_assignments`
  effective-dating then `leave_policy_rules` effective-dating for the
  specific leave type, returning the first match.
- **TypeScript** — an in-memory `resolveApplicableRule` mirror in both
  engine functions, batch-fetching every assignment/rule row once per run
  (via `fetchAllRows`, per CLAUDE.md's pagination rule) and resolving
  per-employee from `employees.department_id/work_location_id/site_id`
  directly (confirmed synced from `job_history` by the pre-existing
  `trg_sync_employee_job_fields` trigger — no join needed), instead of
  one RPC round trip per employee.

  **Real-Postgres proof** (`scripts/db/verify-scoped-policy-accrual.mjs`,
  all PASSED): each of the five scopes individually; the full 5-scope
  precedence stack for one employee (confirming department overrides
  default, etc., in the declared order); removing an override and
  confirming fallback to the next scope; reassigning an employee between
  departments and confirming the resolved rule changes accordingly;
  effective-date boundaries (a rule not yet effective, or already
  expired, is correctly skipped); retry idempotency (re-running the same
  period credits nothing twice); and tenant isolation (one tenant's scope
  configuration never leaks into another's resolution). In every case the
  resulting `leave_accrual_ledger` row and `employee_leave_balance` value
  were reconciled against the expected credit for that employee's
  resolved rule, not just checked for "some credit happened."

**2. Two-accrual-system double credit — FIXED.** `leave_accrual_rules`
(System A) and `leave_policy_rules`+`leave_policy_assignments` (System B)
are two independently-triggered crediting systems with no shared
authority; an employee configured in both was credited twice, in either
call order, with no precedence rule. A CRUD-time-only mutual-exclusivity
check was explicitly rejected as insufficient — it can't catch configs
that already overlap, concurrent config changes, or two scheduled jobs
racing each other. The guard is instead enforced **inside the existing
atomic crediting transactions themselves** (migration 470), so it holds
at execution time regardless of configuration history or race timing:
- `credit_engine_accrual_atomic` (System B) now checks, inside its own
  transaction, for an active, effective-dated, frequency-matching
  `leave_accrual_rules` row for the same tenant/employee/leave_type
  before writing any ledger or balance row.
- `credit_monthly_accrual_batch` (System A) runs the symmetric check per
  employee via `resolve_engine_policy_rule` in a CTE, before its own
  ledger/balance writes.
- On conflict, **neither system credits**. The ambiguity is recorded into
  a new `leave_accrual_conflicts` table (`detected_by` records which run
  found it: `system_a_run` / `system_b_run` / `detection_scan`) for HR
  review — never auto-resolved, never silently defaulting to one system.

  **Pre-existing overlaps** (configured before migration 470 existed) are
  handled by a separate, standalone, re-runnable, read-only detection
  tool: `scripts/db/detect-existing-accrual-overlaps.mjs`. It is dry-run
  by default; `--apply` records findings into `leave_accrual_conflicts`
  only — it never writes to `leave_accrual_ledger`, `employee_leave_
  balance`, or `leave_balance_ledger`, directly satisfying "preserve audit
  history; do not automatically reverse historical credits without
  reconciliation." Verified by seeding a simulated pre-470 double-credit,
  running dry-run (found, nothing written), running `--apply` (recorded),
  running `--apply` again (idempotent, 0 new rows via the table's
  `UNIQUE (tenant_id, employee_id, leave_type_id, period)` constraint),
  then confirming via direct SQL that the original seeded ledger rows
  were byte-for-byte unchanged throughout.

  **Real-Postgres + real-HTTP proof**
  (`scripts/db/verify-dual-accrual-conflict-execution-time.mjs`, 10/10
  checks PASSED): both job call orders (System A then B, System B then
  A); genuinely simultaneous execution via `Promise.all` (not sequential
  awaits — directly answering the concern that sequential-retry evidence
  doesn't prove concurrency safety); retry-after-success (idempotent, no
  second credit); and a forced mid-transaction failure (an impossible
  `p_max_balance=-1`) in a conflicting scenario, proving the conflict
  check runs and blocks *before* any write is attempted, not merely
  before a crash is simulated. Exactly one credit in every non-conflicting
  shape; exactly zero (correctly blocked + reported, never defaulted) in
  every conflicting shape. `scripts/db/verify-dual-accrual-system-
  overlap.mjs` (the original checkpoint-14 reproduction script) was
  updated to assert this "both blocked" verdict and now passes instead of
  reproducing the bug.

**Also in this batch**: removed the dead `writeLedgerEntry` function from
`leave-entitlement-service.ts` (superseded by the atomic RPC at both call
sites, zero remaining references); surfaced per-run conflicted-employee
counts through `AccrualResult`/`BatchResult` into `leave-jobs.ts`'s job
error reporting, so a blocked conflict is visible in the job run's result,
not only in the `leave_accrual_conflicts` table.

**Verification**: `npx tsc --noEmit` clean (both the migration-adjacent
lib changes and all four new/updated scripts). `npx vitest run`: 79/79
files, 669/669 tests passing — zero regressions from the pre-checkpoint-15
baseline. Migration 470 applied cleanly to `hrms_uat` (full `000`→`470`
history). `main` untouched throughout; PR #30 still unmerged.

**Status change**: both items move from "CONFIRMED open defect,
resolution recommended" (checkpoint 14) to **FIXED** (checkpoint 15). The
attendance namespace's only remaining open-confirmed defect is
`retroactive.ts`'s detect-dedup gap (low-severity, disclosed, not fixed —
see Part 4 of the regularisation-cluster entry above).

**Checkpoint 15 continuation, sixth leg**: 13 more files examined —
`queue-actions.ts`, `status.ts`, `last-run.ts`, `run-details.ts`,
`run-export.ts`, `sample-csv.ts`, `who-is-in.ts`, `work-sessions.ts`,
`debug-raw.ts`, `audit.ts`, `force-unlock.ts`, `reconciliation.ts`,
`reconciliation-validate.ts`. One real defect found and fixed:
`reconciliation.ts`'s `GET /attendance/reconciliation/open` had the exact
same capped-breakdown bug class already found and fixed in the sibling
`leave-reconciliation.ts` earlier this audit — `by_type`/`by_severity`
were aggregated from the same `data` page capped at `limit` (≤200), so a
tenant with more unresolved issues than that cap got a silently
undercounted breakdown while `total` (an exact count) stayed correct.
Fixed identically: the breakdown is now derived from a dedicated
`fetchAllRows` pull of just the grouping columns. **Real-Postgres +
real-HTTP proof** (`scripts/db/verify-attendance-reconciliation-open-
breakdown.mjs`): seeds 210 unresolved issues across two types/severities,
calls the real endpoint with `limit=20`, confirms `total=210`,
`data.length=20` (capped page unchanged), and `by_type`/`by_severity` sum
to 210, not 20 — 7/7 checks PASS. The other 12 files were read and found
already correct: tenant-scoped, role-gated (`HR_ADMIN_ROLES` or
`MANAGER_ROLES` as appropriate — `who-is-in.ts` correctly scopes managers
to direct reports via `manager_id`), `fetchAllRows` used everywhere
unbounded data could exceed PostgREST's 1,000-row cap (`run-export.ts`,
`who-is-in.ts`, `work-sessions.ts`'s month-range routes, `debug-raw.ts`),
intentionally bounded top-N queries correctly left as `.limit()`/`.range()`
per CLAUDE.md's exception (`last-run.ts`, `run-details.ts`'s list route,
`audit.ts`, `work-sessions.ts`'s anomaly browse/search), and CAS-correct
lock/unlock in `work-sessions.ts` (the authoritative guard is the
`payroll_locked` WHERE clause folded into the UPDATE itself, not the
friendly pre-check read, so a concurrent request can't race it).
**Updated: attendance 51/64 examined (13 remaining); overall 89/289
examined, 200 remaining.**

**Checkpoint 15 continuation, seventh leg — `attendance` namespace
COMPLETE (64/64)**: the final 13 files — the intelligence/anomaly/
forensics/confidence/risk cluster (`anomalies.ts`, `anomaly-reconcile.ts`,
`confidence.ts`, `forensics.ts`, `health-index.ts`, `inference.ts`,
`intelligence.ts`, `risk.ts`, `timeline-intelligence.ts`,
`workforce-optimization.ts`, `pipeline-stats.ts`, `policy-conflicts.ts`,
`simulate-policy.ts`) — were examined despite being de-emphasized per
CLAUDE.md's admin-load philosophy decision; the lighter pass still
surfaced 5 real defects, most severe first:

1. **`workforce-optimization.ts` — missing authorization on 7 of 9
   routes.** `fairness-balance`, `consecutive-shifts`, `rest-gaps`,
   `ot-distribution`, `staffing-hints`, `shift-overload`, and `hints` had
   `fastify.authenticate` only — no role check — unlike every sibling file
   in this same cluster (`anomalies.ts`, `confidence.ts`, `health-index.ts`,
   `inference.ts`), which all gate reads behind `HR_ADMIN_ROLES`. Any
   authenticated employee could read every coworker's name alongside OT
   fairness scores, weekend/night fairness, rest-gap and consecutive-shift
   violations, and shift-overload status, tenant-wide. Fixed by adding the
   same `requireAdmin()` gate already used by this file's two write
   routes. **Real-HTTP proof** (`scripts/db/verify-workforce-optimization-
   admin-gate.mjs`): a plain `'employee'` role gets 403 on all 7 routes;
   `'hr_admin'` gets 200 — 14/14 checks PASS.
2. **`health-index.ts` — department/tenant aggregation pagination gap.**
   `POST /attendance/health-index/compute`'s department/tenant branches
   read `attendance_health_scores` with a plain, unpaginated `.select()`,
   silently truncating at PostgREST's 1,000-row ceiling for a tenant with
   >1,000 scored employees — the CLAUDE.md-flagged bug class. Fixed with
   `fetchAllRows()`.
3. **DECIMAL-column string-coercion NaN bug, 4 files.** `health_score`,
   `confidence_score`, `confidence_penalty`, `risk_score`, and the three
   fairness-score columns are all `DECIMAL(5,2)`, which can come back as a
   string rather than a JS number; `+=`/`.reduce()` on an uncoerced string
   concatenates instead of summing, producing `NaN`, which serializes as
   JSON `null` and is rejected by a `NOT NULL` constraint on write —
   confirmed empirically (fix #2's own verification failed with exactly
   this Postgres error before this coercion fix landed alongside it).
   Fixed with `Number(...)` at every read site, matching the
   `Number(row.days)` pattern already used elsewhere in this codebase
   (`leave.ts`, `leave-accrual-lifecycle.ts`): `health-index.ts`,
   `confidence.ts` (3 spots), `inference.ts`, `workforce-optimization.ts`.
   **Real-Postgres proof** (`scripts/db/verify-health-index-aggregation-
   pagination.mjs`): seeds 1,050 rows (1,000 @ 50.00, 50 @ 90.00), confirms
   the persisted tenant-scope average is the true weighted average
   (51.90), not `NaN`/`null` and not the wrong capped-page value.
4. **`risk.ts` — `GET /attendance/risk/summary` pagination gap**, the
   identical plain-select 1,000-row-ceiling bug as #2, plus the same
   DECIMAL string-coercion bug on `risk_score`. **Real-Postgres proof**
   (`scripts/db/verify-risk-summary-pagination.mjs`): seeds 1,050
   employees (1,000 @ score 10/level `'low'`, 50 @ score 80/level
   `'critical'`), confirms `total_employees=1050` and
   `avg_risk_score=13.33` (the true average), not capped at 1000.
5. **`risk.ts` — non-deterministic pagination sort key**, found while
   fixing #4. `POST /attendance/risk/compute` stamps every row in one
   batch with the SAME `computed_at` (one `now` reused across the whole
   upsert), so `ORDER BY computed_at` alone is not a stable sort key:
   OFFSET-based `.range()` pagination over ties can skip or duplicate rows
   across page boundaries — the exact instability this module's own
   `supabase-paginate.ts` already documents as a known risk class (see its
   `fetchAllRowsByKeyset` comment). Fixed by adding a unique `id`
   tie-breaker to both the `/summary` `fetchAllRows` loop and the
   `/attendance/risk` list route's `ORDER BY`. **Real-Postgres proof**
   (`scripts/db/verify-risk-list-pagination-stability.mjs`): seeds 1,050
   rows with IDENTICAL `risk_score` AND `computed_at` (the worst case),
   pages through the real endpoint, confirms every id appears exactly
   once — no skips, no duplicates.

All other files in this final batch read and found already correct:
tenant-scoped, role-gated, `fetchAllRows` used wherever unbounded data
could exceed PostgREST's 1,000-row cap, bounded top-N queries correctly
left as `.limit()`/`.range()` per CLAUDE.md's exception, single-employee/
single-date routes correctly scoped and bounded by construction
(`forensics.ts`, `timeline-intelligence.ts`), a stateless read-only
simulation with no DB writes (`simulate-policy.ts`).

**Updated: attendance 64/64 examined (0 remaining) — namespace complete.
Overall: 102/289 examined, 187 remaining.**

## Checkpoint 16 — precision qualifications on the attendance baseline, requested before moving to payroll

The user accepted attendance as complete and authorized moving to
`payroll` without reopening the two accrual defects absent concrete new
evidence, but required three qualifications be kept explicit in this
register rather than left implied. Recorded here, verbatim in substance:

1. **"64/64 attendance files examined" is source-review coverage, not a
   claim that every browser workflow or hosted-Supabase RLS behavior has
   been tested.** This register already tracks these as separate
   evidence tracks (see "Separate totals" below and the repeated
   "Examined is not Tested" caveat earlier in this document), but it is
   restated here explicitly: the 64/64 number means every attendance
   route file was read against the item-2 checklist (tenant scoping,
   authorization, pagination, CAS, storage-path privacy, approval/
   reversal correctness). A substantial fraction additionally has
   real-Postgres/real-HTTP script evidence (cited per finding throughout
   checkpoints 1–16). A much smaller fraction has actual browser-driven
   UAT evidence (checkpoint 10's bulk-retry panel; the ApprovalInbox
   screenshots; a handful of others cited in the "Frontend pages" row of
   "Separate totals"). **No attendance route has been verified against a
   real hosted Supabase project's actual RLS policy enforcement** — every
   real-Postgres script in this audit runs against local Postgres 16 with
   the local test gateway (`scripts/db/local-test-gateway.mjs`), which
   enforces tenant scoping at the application-query level this audit
   checks, not via Postgres RLS policies the way the hosted product does.
   This gap is global (see "Explicitly still blocked" elsewhere in this
   document) and is not specific to attendance.

2. **The dual-accrual-conflict concurrency proof tested job-vs-job races,
   not config-write-vs-job races — stated precisely, not just "tested
   concurrency."** `scripts/db/verify-dual-accrual-conflict-execution-
   time.mjs`'s 10/10 checks prove: (a) both call orders of the two
   crediting jobs (System A then B, B then A); (b) genuinely simultaneous
   execution of the two jobs via `Promise.all`; (c) retry-after-success
   idempotency; (d) a forced mid-transaction failure proving the conflict
   check runs before any write. All four are races between **two
   crediting-job invocations**. None of them is a race between a
   **CRUD config write** (e.g. an HR admin creating a new
   `leave_accrual_rules` row via `POST /leave/accrual/rules` while a
   `leave_policy_rules`-driven crediting transaction for the same
   employee/leave-type is already in flight) and an in-progress crediting
   transaction. The execution-time guard's actual protection in that
   specific race depends on PostgreSQL's READ COMMITTED semantics (the
   default isolation level this codebase runs at): the conflict-check
   SELECT inside `credit_engine_accrual_atomic`/`credit_monthly_accrual_
   batch` sees whatever is committed in the database AT THE TIME THAT
   STATEMENT RUNS, not a snapshot taken at transaction start — so a config
   write that commits before the conflict-check statement executes IS
   seen, but this specific scenario (a true config-write-mid-transaction
   race) has not been independently constructed and proven with two live
   connections the way the job-vs-job race was. This is disclosed as an
   untested race shape, not claimed as proven, and is not being treated as
   a confirmed defect absent concrete evidence of an actual failure.

3. **SQL/TS resolver alignment is now covered by a dedicated shared test
   suite**, closing the drift risk the user flagged (two independent
   implementations of the same scope-resolution logic with no direct
   cross-check before this). `scripts/db/verify-sql-ts-resolver-parity.mjs`
   calls `resolve_engine_policy_rule()` (SQL) directly as an oracle, then
   separately triggers the real HTTP monthly-accrual job (which runs the
   TS `resolveApplicableRule()` closures) and compares the two resolvers'
   answers to EACH OTHER, not to a hand-computed expectation. Six cases —
   department-wins, work_location-wins, site-wins, default-only,
   employee-override-wins, and the effective-date boundary (a department
   RULE not yet effective, falling through to default despite an active
   department ASSIGNMENT) — each with a unique `accrual_days_per_year` per
   scope so a numeric coincidence can't mask the two resolvers picking
   different scopes. **12/12 checks PASS**: both resolvers agree on which
   scope wins and on the resulting credited amount in every case. Not yet
   addressed, lower priority: the TS resolver is actually duplicated
   verbatim as two separate closures (inside `runEngineMonthlyAccrual` and
   `runEngineYearlyCredit`), which is itself a maintenance drift risk
   independent of SQL/TS parity — flagged for a future dedicated-refactor
   pass, not fixed inline here since it touches the hot accrual loop.

## Checkpoint 16 — payroll audit begins

Per explicit instruction, moved to the `payroll` namespace (52 files),
prioritizing in order: salary visibility/authorization, calculation
inputs, finalization, reversals, statutory outputs, payments, accounting,
pagination, cross-module reconciliation. Attendance's 64/64 baseline is
preserved, not revisited (see the precision qualifications recorded
above). First leg: 9 files examined against the same item-2 checklist —
`runs.ts` (the central 3991-line run-lifecycle file: finalize, rollback,
delete, retry-failed, list, export), `slips.ts` (salary visibility/
authorization), `compensation-master.ts` and `compensation-revisions.ts`
(salary visibility/authorization + calculation inputs), `accounting.ts`,
`ledger.ts`, `run-ledgers.ts` (accounting), `reconciliation.ts`
(cross-module reconciliation action log — the actual compute logic lives
in `workspace/stats.ts`, outside this namespace, per this file's own
docstring), `integrity.ts` (snapshot-hash verification + deterministic
replay — no defect found, already delegates its core logic to
`payroll-snapshot-engine.ts`).

Two real defects found and fixed, both in the "finalization/reversals"
and "calculation inputs" priority areas respectively:

1. **`runs.ts` — TOCTOU race in `DELETE /payroll/runs/:id`.** The route's
   pre-check read `status` in a statement separate from the DELETE, and
   the DELETE itself filtered only on `id`/`tenant_id` — no status in its
   WHERE clause. A concurrent finalize landing between the two could let
   this route hard-delete a now-finalized run and its real payslips,
   completely bypassing the "finalized runs cannot be deleted" rule the
   pre-check exists to enforce. Fixed by folding the same status
   exclusion into the DELETE's own WHERE clause (CAS, not check-then-
   write) — the identical fix shape this file already applies to its own
   `finalize_payroll_run_atomic`/`rollback_payroll_run_atomic` paths.
   **Real-Postgres, genuinely-concurrent proof**
   (`scripts/db/verify-payroll-run-delete-cas.mjs`, 9/9 checks): Part A
   holds an uncommitted finalize transaction open on the run row via one
   live connection while firing the real HTTP DELETE on a second
   connection — confirmed still blocked ~450ms in, then correctly returns
   409 once the finalize commits, with the run intact and still
   'finalized' afterward. Part B is the deterministic counterpart; Part C
   confirms the happy path (deleting a genuine draft) is unaffected.
2. **`compensation-revisions.ts` — silent component-copy swallow on
   `POST /:id/approve`.** This exact function already fixed this precise
   bug class twice (the supersede-prior-compensation failure and the
   new-compensation-insert failure both correctly surface a 500, per the
   file's own comments quoting the user's prior correction: "Previously
   silently warned + returned success — HR would see 'Revision approved'
   with the employee's compensation never actually updated"). The THIRD
   write in the same sequence — copying the new compensation's salary
   components, scaled for the new CTC — was still only `req.log.warn`-ing
   on failure and returning a clean success. Left as-is, a failure there
   leaves the employee's new `employee_compensations` row active with the
   new CTC but ZERO components; the payroll engine's
   `fetchActiveCompensation` read would then compute near-zero/warning pay
   for that employee at the next run, with HR never told anything was
   wrong. Fixed identically to the two sibling cases. **Verification**:
   `tsc --noEmit` clean, `vitest` 79/79 files unaffected. Disclosed
   honestly, not overclaimed: this fix is verified by code inspection and
   exact pattern-parity with the two adjacent, already-proven error paths
   in the same function — not by an independent forced-failure real-HTTP
   proof, since the specific DB constraint needed to deterministically
   trigger this exact insert failure could not be practically constructed
   through the black-box API (no client-mocking harness exists for this
   route) in the time available for this batch.

All other files in this first leg read and found already correct and, in
several cases, visibly already hardened by prior audit rounds (the
`finalize`/`rollback` paths in particular: atomic RPCs with advisory
locking, maker-checker four-eyes approval, explicit documented history of
prior bugs found and fixed in this exact file). Tenant-scoped, role-gated,
`fetchAllRows` used wherever unbounded data could exceed PostgREST's
1,000-row cap, bounded top-N queries correctly left as `.limit()` per
CLAUDE.md's exception, self-vs-admin salary visibility correctly enforced
in `slips.ts`/`ledger.ts`/`compensation-master.ts`, cross-tenant FK
verification already present for every caller-supplied foreign key in
`compensation-master.ts`'s compensation-assignment write path.

tsc --noEmit clean; vitest 79/79 files, 669/669 tests, zero regressions
across both fixes in this leg.

**Updated: payroll 9/52 examined (43 remaining) — all 14 `statutory/`
files are still unopened. Overall: 111/289 examined, 178 remaining.**

**Next planned batch**: continue `payroll` — `statutory-recon.ts`,
`statutory/*` (14 files — epf, esi, ptax, lwf, tds*, it-statement,
ytd-statement, hra-declarations, previous-employment, tax-governance,
governance), `advances.ts`, `loans.ts`, `ess-loans.ts`, `arrears.ts`,
`adjustments.ts`, `variable-pay.ts`, `fbp.ts`, `reimbursements.ts`,
`payout-batches.ts`, `bulk-ops.ts`, `forensics.ts`, `investigate.ts`,
`validation.ts`, `validation-rules.ts`, and the remaining smaller files
(`context.ts`, `cost.ts`, `forecast.ts`, `governance.ts`,
`ops-dashboard.ts`, `run-diagnostics.ts`, `scheduler-monitor.ts`,
`simulate.ts`, `snapshots.ts`, `approval-stages.ts`, `exports.ts`,
`filing-pack.ts`, `index.ts`). Then `masters` (29), `ess` (12), then the
long tail of 1–3-file namespaces. Also recommended, not yet done: delete
the confirmed-100%-dead `AdminDashboard.tsx` / `Dashboard.tsx` (zero route
registrations, verified in an earlier round) — flagging rather than
deleting since the session's own destructive-action guard declined the
delete.

## Checkpoint 17 — advances.ts + loans.ts, and a pre-existing cross-cutting defect found along the way

Per the standing authorization's explicit requirement ("Do not mark a
financial defect resolved merely because an endpoint now returns an
error. Prove failed operations do not leave partial state and retries
cannot duplicate effects."), first went back and made
`compensation-revisions.ts`'s `POST /:id/approve` (only error-surfacing-
fixed in checkpoint 16) **fully atomic**: `approve_compensation_revision_
atomic` (migration 471) fuses the status transition, the new-compensation
insert (relying on the pre-existing `fn_close_prev_compensation` trigger
to auto-deactivate the prior row), and the component-copy insert into one
transaction. Proven with the required 4-part standard — previous
compensation stays valid on a forced failure (19/19 checks,
`scripts/db/verify-compensation-revision-approve-atomic.mjs`): Part A
forces a real CHECK-constraint violation and confirms the revision stays
`pending` with the original compensation still the sole active row; Part B
retries with valid data and succeeds exactly once; a second retry after
genuine success is rejected (`INVALID_STATUS`), not reapplied; Part C is
genuine `Promise.all` concurrency over real HTTP — exactly one of two
simultaneous approvals wins, the unique-active-compensation invariant
holds.

Then opened `advances.ts` (620 lines, full file) and `loans.ts` (668
lines, full file) — the two remaining sibling "payments" files in the
priority list. Both have the same shape: a manual, HR-triggered
record-a-payment endpoint, structurally distinct from (and not called by)
the automatic payroll-finalize sweep in `runs.ts`.

1. **`advances.ts` — `POST /payroll/advances/recover`.** `advance_
   recoveries.employee_id`/`recovery_month` are NOT NULL with no default;
   the route's insert never supplied either — every real call failed
   outright — and the failure landed AFTER the recovery schedule had
   already been CAS'd to `'recovered'` in an earlier, separate statement,
   permanently stranding it recovered with no recovery record and no way
   to retry (its own CAS guard requires `status='pending'`). Confirmed via
   grep that this route is unreferenced by the frontend and by the
   automatic recovery logic — live, reachable, and unconditionally broken.
   Fixed with `record_advance_recovery_atomic` (migration 472): the
   schedule's CAS to `'recovered'` is now the idempotency gate (0-row
   match raises `ALREADY_RECOVERED`, nothing else is written), the insert
   now supplies both columns, and the advance's aggregate status update
   happens in the same transaction. **15/15 checks**
   (`scripts/db/verify-advance-recovery-atomic.mjs`): Part A replicates
   the OLD code's exact two-statement sequence directly in SQL and
   confirms the real NOT NULL violation and the resulting torn state
   (schedule stuck `'recovered'`, zero recovery rows) — the bug was real,
   not theoretical. Part B is the fixed real-HTTP happy path. Part C: a
   retry against an already-recovered schedule is rejected 409, not
   reapplied (still exactly 1 recovery row). Part D: genuine `Promise.all`
   concurrency over real HTTP — exactly one 201, one 409, exactly 1
   recovery row.

2. **`loans.ts` — `POST /payroll/loans/record-payment`.** The exact same
   bug class, independently present in the sibling file: `loan_
   payments.payment_month` is NOT NULL with no default; the route's zod
   schema never accepted it and the insert never supplied it — every real
   call failed outright. Confirmed unreferenced by the frontend (only the
   `pending-recoveries`-equivalent GET paths are called from
   `LoansAndAdvances.tsx`). Separately, even past that insert failure, the
   3-step sequence (insert payment → CAS `loan_schedules` to `'paid'` →
   separately call `record_loan_payment_atomic` for the balance) had no
   idempotency guard on the insert itself — a retry after a step-2/3
   failure could have inserted a second payment row and double-applied the
   balance deduction; both failure paths were already disclosed via
   `req.log.error` in a prior round but never actually fixed. Fixed with
   `record_loan_payment_manual_atomic` (migration 473), same shape as
   `record_advance_recovery_atomic`: the schedule's CAS to `'paid'` is the
   idempotency gate (0-row match raises `ALREADY_PAID`).

   **While building this fix, found a second, independent, and more
   severe defect**: `record_loan_payment_atomic` itself (migration 396 —
   previously credited by an earlier audit round with closing a
   lost-update race on `outstanding_balance`) has **never actually been
   able to run**. Its own `RETURNS TABLE (outstanding_balance NUMERIC,
   status TEXT)` declares OUT parameters with those exact names, which
   PL/pgSQL treats as variables in scope for the whole function body —
   colliding with `employee_loans`' own `outstanding_balance`/`status`
   columns referenced inside its own UPDATE. Every call raises `column
   reference "outstanding_balance" is ambiguous`, confirmed by invoking it
   directly against real Postgres with no caller involved at all. This is
   the SAME function `runs.ts`'s automatic payroll-finalize loan-balance
   sweep calls on every run with a paid loan EMI (the "Loan outstanding
   balance sweep" block, already examined and passed as correct in
   checkpoint 16's first leg) — that call site treats the RPC's error as
   non-fatal and silently skips the `paid_amount` marker, so this has been
   failing silently on every finalized run, meaning **no loan's
   `outstanding_balance` has ever actually been decremented by the
   automatic sweep**, in this codebase's entire history, independent of
   anything checkpoint 16 found or missed about that call site's
   idempotency shape. Checkpoint 16's examination of `runs.ts` checked the
   sweep's OWN idempotency pattern (the `paid_amount IS NULL` filter) and
   correctly found that pattern sound — it did not re-verify that the RPC
   it calls actually executes, which is exactly the kind of blind spot
   "examined, not tested" is supposed to flag. Fixed by qualifying the
   UPDATE's column reads with a table alias (migration 474) — confirmed
   fixed by calling the function directly against real Postgres, then
   re-run through the full 4-part proof above (which depends on it) all
   passing. This is disclosed as its own finding, not folded silently into
   the loans.ts fix, because its blast radius is independent of
   `record-payment` and extends to `runs.ts`'s automatic sweep, which was
   previously marked examined-and-correct.

tsc --noEmit clean; vitest 79/79 files, 669/669 tests, zero regressions.

**Updated: payroll 11/52 examined (41 remaining) — all 14 `statutory/`
files are still unopened. Overall: 113/289 examined, 176 remaining.**

### Separate totals: frontend pages, shared services, migrations

The backend route tracker above (289 files) is explicitly **not** the
whole system. Three more surfaces, counted directly, kept as their own
totals rather than folded into the 289 so backend progress is never read
as whole-system progress:

| Surface | Total (Bash-verified) | Examined this audit | Evidence depth | Remaining |
|---|---|---|---|---|
| **Frontend pages** (`apps/web/src/pages/**/*.tsx`) | **306** (41 directories) | **~26** distinct files named in this register's checkpoint history (nav-link target fixed or logic referenced) | **Mixed, and shallower than the backend bar** — of those ~26, only **5** have actual browser evidence (real login, real click, screenshot): `Attendance.tsx`, `ControlCenter.tsx`, `CommandPalette.tsx` (attendance-processing flow), `ApprovalInbox.tsx` (3 screenshots, scope-verify), `ManagerTeamRegularisation.tsx` (bulk-retry panel). The other ~21 are nav-link-target fixes only — the file was read to confirm/correct a `<Link>`/`navigate()` target, not reviewed for business logic, authorization, or data correctness. **"Examined" here means "a stale link was found and fixed," not "this page's logic was audited."** | ~280-301 depending on which bar is applied |
| **Shared services, API** (`apps/api/src/lib/**/*.ts`, excl. `__tests__`) | **171** | **~16**: `accrual-engine.ts`, `approval-orchestrator.ts`, `approval-service.ts`, `approval-guards.ts`, `workflow-service.ts`, `idempotency.ts`, `period-lock.ts`, `manager-scope.ts`, `audit-service.ts`, `event-bus.ts`, `ot-engine.ts`, `api-errors.ts`, `pilot-guard.ts`, `user-account-service.ts`, `manager-compensation.ts`, `workforce-orchestrator.ts` | Read in full against the logic a calling route needed, not independently re-derived against a standalone checklist the way routes are — correct for what each route-level finding needed, not a claim that the rest of each file (or any untouched function in an examined file) is clean | ~155 |
| **Shared services, web** (`apps/web/src/lib/**/*.ts*`) | **70** | **0** | — not examined this audit | 70 |
| **Database migrations** (`supabase/migrations/*.sql`) | **474** | **Verified by a DIFFERENT method, not comparable to "examined"**: every migration through 467 has been applied, in order, to a fresh Postgres 16 instance with zero errors (most recently confirmed earlier this audit) — this proves the migration HISTORY up to that point is internally consistent and reproducible, not that each migration's SQL was individually read against a correctness checklist. 471-474 (checkpoint 17) were each individually authored, applied directly and cleanly to `hrms_uat`'s existing 000→470 history, and proven under the real-Postgres/real-HTTP scripts cited in checkpoint 17 — **not yet re-swept through a fresh-install 000→474 run**, so their interaction with a from-scratch install is unverified (the same gap already disclosed for 446-450/461-467 when they were added). 446/447/448/450/461-467/471-474 were individually authored and read in depth as part of a specific fix this audit; the rest were pre-existing and have NOT been read line-by-line this audit. | n/a — different evidence type, not file-counted the same way |

**Reading this correctly**: "54 of 289 backend route files examined" is
real, specific progress on the ONE surface this audit has gone deepest
on. It says nothing about the other ~310 lib files, ~306 web pages, or
whether an unexamined migration has a defect — those are separate,
largely-unstarted surfaces with their own totals above, not implicitly
covered by the backend number.

## Checkpoint 14 qualifications — both closed with a real fix, not a restated assumption

Two qualifications were raised against checkpoint 14's own work before it
could be treated as closed. Both are genuine defects, not documentation
gaps, now fixed (migration 467, applied to `hrms_uat` and verified against
a fresh `000`→`467` install — 463 `.sql` files, 0 errors):

**1. Auto-LOP rejection + approval-instance closure must commit together.**
The first version of the period-locks.ts fix (earlier this checkpoint)
closed the orphaned-instance bug with two SEPARATE `supabase-js` calls — a
crash or network failure between them would recreate the exact orphan the
fix was meant to close, just via a different trigger, not close the gap.
Fixed for real: `auto_lop_reject_regularisations_atomic` (migration 467)
folds the regularisation reject and the approval_instances close into one
plpgsql function body, which runs as a single transaction by construction
— the same guarantee every other atomic RPC in this audit relies on
(`finalize_payroll_run_atomic`, `request_leave_encashment_atomic`, etc.).
This satisfies "commit together" directly, making a separate retry/
recovery path unnecessary. Wired into `period-locks.ts`'s fire-and-forget
block in place of the two raw updates. **Found and fixed along the way**:
building this surfaced a genuine gap in the LOCAL TEST GATEWAY (not the
product) — its RPC parameter serializer treated a JS array the same as a
plain object, JSON.stringify-ing a `UUID[]` parameter into a JSON-array
STRING that Postgres then rejected as a malformed array literal. Fixed
(`Array.isArray` check added before the jsonb-object JSON.stringify
branch) in `scripts/db/local-test-gateway.mjs`; re-ran the other 2 real-
HTTP scripts (`verify-approval-chain-bypass.mjs`,
`verify-encashment-idempotency-hash.mjs`) afterward to confirm zero
regression — both unchanged, all steps still pass. **Real-Postgres +
real-HTTP proof**: `verify-period-lock-auto-lop-closes-chain.mjs` (already
committed this checkpoint) re-run against the fixed RPC — same scenario as
before (a regularisation genuinely advanced to an open level-2 instance
via real HTTP, then HR locks the period via real HTTP) — now PASSES: the
regularisation reads `'rejected'` AND `approval_instances` is closed
(`final_approved=false`, `closed_at` set) in the same atomic call.

**2. Cap-policy effective-dating — "re-reading the policy live" was not
actually proof against a concurrent policy edit.** `leave_accrual_rules`
has `effective_from`/`effective_to` columns AND a unique constraint on
`(tenant_id, leave_type_id, effective_from)` — the schema is explicitly
designed to hold multiple time-scoped rule versions, not one mutable row.
`request_leave_encashment_atomic` (migration 465) and `processEncashment`'s
rule lookup (`lib/accrual-engine.ts`) both picked "the active rule with
the latest `effective_from`," full stop — with NO check that
`effective_from` had actually arrived yet, and `processEncashment`'s
`.maybeSingle()` would additionally throw outright the moment a second
active version ever existed. This contradicts both the schema's own
design and the ALREADY-CORRECT pattern used by the monthly/yearly accrual
job's own rule lookup in the very same file
(`.lte('effective_from', periodEndDate).or('effective_to.is.null,
effective_to.gte.' + periodDate)`) — migration 465's own comment had
rationalized the gap as "the product invariant is one active rule at a
time," which was never actually true. **Recorded, intended behavior,
stated explicitly per the user's ask**: a rule version governs every
encashment request or approval made on or after its `effective_from` and
before its `effective_to` (or forever, if `effective_to` is `NULL`) —
evaluated FRESH against `CURRENT_DATE` at both request time and approval
time, exactly like the accrual job's own period-scoped lookup. A
future-dated version has NO effect until that date arrives; from that
date, every NEW check picks it up — there is no separate "grandfather"
window for already-pending requests, consistent with how every other
rule-driven check in this codebase (accrual, period locks, approval
chains) already re-reads current state fresh rather than snapshotting it
at submission time. **Fixed** (migration 467): both lookups now filter
`effective_from <= CURRENT_DATE AND (effective_to IS NULL OR
effective_to >= CURRENT_DATE)` before taking the latest version;
`processEncashment`'s lookup additionally switched from `.maybeSingle()`
to `.order().limit(1)` so a second active version can never make it throw.
**Real-Postgres + real-HTTP proof**: new "Part 6" in
`scripts/db/verify-encashment-cap-atomic.mjs` — (a) a request that only
fits under a FUTURE (not-yet-effective) cap of 50 is correctly refused
against the CURRENT cap of 5; (b) a request that fits the current cap
succeeds normally; (c) once the new version's `effective_from` is moved
to today (simulating its date arriving), it correctly takes over — a
request of 40 days (3+40=43, over the old cap of 5, under the new cap of
50) succeeds; (d) via real HTTP, `POST /leave/encashment/:id/approve`
with TWO active rule versions present (one now-expired-dated-into-the-past,
one now-effective) returns 200 and applies the correct one, proving
`processEncashment` no longer throws on multiple active rows. All 4 PASS.

**Scale disclosure, stated up front so it isn't mistaken for completion:**
the API has **289 route files** across **53 route namespaces plus 1
standalone top-level file** (`setup.ts`) — see checkpoint 14's repository-
wide tracker above for the exact, Bash-verified per-namespace breakdown,
which supersedes this round-number; the web
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
| **Leave** (`routes/attendance/leave-requests.ts`, `lib/leave-request-service.ts`, `lib/approval-service.ts`, `routes/attendance/leave.ts`; `pages/leave`, `pages/ess` leave) | Partially tested | **Checkpoint 6**: `leave-requests.ts` + both service files read in full. Found + fixed a real authorization-scope defect: the Approved-tab list behind the cancel-approval action (`GET /leave-requests?status=APPROVED`, manager, no `employee_id`) and the `/approvals/pending-count` badge both scoped via the full subordinate tree while the actual cancel/approve/reject action is immediate-manager-only — narrowed both to the new `getImmediateReportIds` helper. **Upgraded to real-Postgres + real-HTTP + live-browser evidence** (see the batch-log entry above): a genuine 3-level hierarchy proves the manager-of-managers sees zero pending items and is refused 403 on direct action, the real immediate manager sees and can act on them, HR sees everything — screenshotted live in the browser. Also read `routes/attendance/leave.ts` in full: confirmed live/reachable over real HTTP (it is registered, not dead code — an earlier conclusion in this same checkpoint was wrong and corrected per the user's explicit catch), and found + fixed a real gap there too — its legacy approve handler had no hard period-lock block, unlike the canonical flow; fixed and proved 409 against a real locked-period row in Postgres. Everything else in `leave-requests.ts`/the two service files (overlap-check fail-closed, per-calendar-year balance bucketing, the elapsed-range reversal guard, the multi-level approval gate, self-approval guards, idempotency-key handling) was read and found already correct — carries forward from prior rounds' PEND-94/PEND-103/PEND-105/ISSUE-144/etc. fixes, not newly defective, but also not independently re-verified against real Postgres this round. The other ~15 `routes/attendance/leave-*.ts` files (accrual, entitlement, duration, reconciliation, collision, policy-resolve, jobs, scheduler-status) are **not yet opened**. Raise-leave-on-behalf, standalone encashment — previously tested (G12, prior rounds), not re-run this round. **Checkpoint 6's "period-lock recheck on approve/reverse was already correct" claim above was wrong and is corrected here, checkpoint 7**: reading the actual RPC bodies (not assumed) showed `approve_leave_request_atomic`/`reverse_leave_request_atomic`/`approve_regularisation_atomic` never referenced `attendance_period_locks` at all — the only enforcement was a separate, earlier JS-side check, a real TOCTOU gap against concurrent lock-creation/payroll-finalization. **Fixed, checkpoint 7**: migration 461 folds the lock-check into the same transaction as each mutation (all three canonical RPCs, plus new atomic RPCs for leave.ts's legacy approve, comp-off's claim, and overtime's claim); proved via a genuine two-connection overlapping-transaction test (`scripts/db/verify-period-lock-no-race.mjs`), not a sequential one. **Also checkpoint 7**: comparing `leave.ts`'s cancel handler against canonical surfaced and fixed two more real gaps — F1 (no period-lock check at all) and F2 (no elapsed-range guard) — via a new `cancel_legacy_leave_application_atomic` RPC plus a JS-side "already started" check; see the checkpoint 7 batch-log entry above for full detail and evidence breakdown. **Open product decision, not yet resolved**: whether to formally retire `leave.ts`'s legacy `leave_applications` pathway now that its safety-critical gaps (period-lock on approve AND cancel, elapsed-range on cancel) are closed, or keep it as a (still feature-incomplete relative to canonical) fallback. |
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

**Real stack + real HTTP + real Postgres + live browser, checkpoint 10**
(same local stack restarted this round): `scripts/db/verify-finalize-
atomic-seal.mjs` is the deterministic concurrency proof for the
finalization-race fix — two real `pg.Client` connections, `pg_locks`-
confirmed genuine blocking (not a sequential/timing-based proxy for it),
plus a deliberate negative control that hand-reproduces checkpoint 9's
broken pattern to prove the flagged gap was real before showing the fix
closes it. `scripts/db/verify-checkpoint10-bulk-retry-panel.mjs` is the
live-browser proof for the bulk-failure panel — real login, real bulk
action, real partial failure, a screenshot of the panel still showing the
failure after the toast's display window has elapsed, a real "Retry"
click, and a Postgres read-back proving the retry affected only the
retried row (`approved_at` on the other two rows is unchanged, not just
"still correct by coincidence"). Both scripts are committed for re-use.
Screenshots are ephemeral (`/tmp/claude-0/.../cp10-retry-panel/`, not
committed) — re-run the browser script to regenerate them; 2 were sent to
the user this round.

**Real stack + real HTTP + real Postgres, checkpoint 13** (same local
stack, restarted this round — `pg_ctlcluster 16 main start`, the gateway
shim, `tsx watch` auto-reloading the API on this round's source changes,
the Vite web dev server; `hrms_uat` and all committed scripts survived
from earlier in this session):
- `scripts/db/verify-approval-chain-bypass.mjs`'s new "Part B" (steps
  8–11) is the real-Postgres + real-HTTP proof for the identity-
  unresolved fail-closed fix — see the checkpoint 13 batch-log entry
  above for the full sequence. All 4 new steps pass; the original 7-step
  Part A re-runs unchanged (re-run specifically to confirm the gateway
  fix below introduced no regression).
- `scripts/db/verify-encashment-idempotency-hash.mjs` (new) is the
  real-Postgres + real-HTTP proof for the idempotency-key payload-
  fingerprint fix — same-key-different-payload refusal and lost-response
  retry replay, both read back from real Postgres, not asserted from the
  HTTP response alone. Building it surfaced and fixed a genuine gap in
  the LOCAL TEST GATEWAY itself (`/tmp/supabase-gateway.mjs`, sandbox-only,
  not part of the repo): its generic insert/update handler had no
  column-type awareness and forwarded any JS `null` as a bare SQL NULL,
  so every real `claimIdempotency()` call against a NOT-NULL jsonb column
  (`idempotency_keys.response`) failed silently via that function's own
  documented fail-safe — meaning the encashment route's real-HTTP
  Idempotency-Key behavior had never actually been exercised successfully
  end-to-end before this round (checkpoint 12's real-Postgres script
  called the RPC directly via raw `pg.Client`, deliberately routing around
  this exact limitation per its own code comment; the mocked route tests
  mock `supabase` entirely). Fixed with a small, explicitly-commented
  `JSONB_NULL_COLUMNS` allow-list in the shim (currently just
  `idempotency_keys.response`) rather than worked around in the test.
  `verify-encashment-cap-atomic.mjs` and `verify-approval-chain-bypass.mjs`
  were both re-run after this shim change specifically to confirm zero
  regression — both: unchanged, all parts/steps still pass.
- Migration 466 fresh-install: a newly created database, `scripts/db/
  bootstrap.sql`, then the complete `000`→`466` history — 462 `.sql`
  files, 0 errors, 468 tables in `public` (`pg_tables`),
  `idempotency_keys.request_hash` present as `TEXT`, nullable.

**Real stack + real HTTP + real Postgres, checkpoint 14** (tier 2 batch
1; same local stack, restarted this round — `tsx watch` auto-reloaded the
API on `corrections.ts`/`period-locks.ts`'s source changes):
- `scripts/db/verify-approval-chain-bypass.mjs`'s new "Part C" is the
  real-Postgres + real-HTTP proof for the `corrections.ts` fix — a real
  2-level `correction` chain genuinely advances then finalizes across two
  separate real HTTP approvals, and a separate correction rejected at
  level 1 finalizes immediately without advancing. All 4 new steps pass;
  the original 11 steps from Parts A/B re-run unchanged.
- `scripts/db/verify-period-lock-auto-lop-closes-chain.mjs` (new) is the
  real-Postgres + real-HTTP proof for the `period-locks.ts` fix — a
  regularisation is advanced to a genuinely open level-2
  `approval_instances` row via real HTTP, confirmed open by a Postgres
  read-back BEFORE the lock call (not assumed), then HR locks the period
  via real HTTP; after polling for the fire-and-forget auto-LOP job to
  settle, both the regularisation's `'rejected'` status and the
  previously-orphaned `approval_instances` row's new closed state
  (`final_approved=false`, `closed_at` set) are confirmed from real
  Postgres.
- Both new scripts committed for re-use.

## Explicitly still blocked / out of scope (unchanged from the prior round)

- Hosted Supabase/RLS/storage behavior — still blocked, no Supabase project access in this session. Nothing above claims to prove RLS; the local gateway described in prior rounds is a sandbox-only PostgREST-like shim.
- PMS and Travel Desk — on hold per explicit user instruction, untouched.
- `main` branch — untouched. PR #30 — unmerged.
