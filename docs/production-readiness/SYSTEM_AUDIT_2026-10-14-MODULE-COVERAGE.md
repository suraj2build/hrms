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
- **Next planned batches** (not yet started — listed so a future session
  picks up here, not from zero): continue item 2's batch — tier 2 of the
  remaining ~49 unopened `routes/attendance` files (punch/corrections/
  overtime's non-scope sections/recompute/retroactive/period-locks'
  remaining non-lock-creation logic); tier 3 (rosters/shifts/holidays/
  wo-credit). Then item 3 —
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

## Explicitly still blocked / out of scope (unchanged from the prior round)

- Hosted Supabase/RLS/storage behavior — still blocked, no Supabase project access in this session. Nothing above claims to prove RLS; the local gateway described in prior rounds is a sandbox-only PostgREST-like shim.
- PMS and Travel Desk — on hold per explicit user instruction, untouched.
- `main` branch — untouched. PR #30 — unmerged.
