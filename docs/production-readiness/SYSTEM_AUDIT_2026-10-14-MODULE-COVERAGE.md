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
- **Next planned batches** (not yet started — listed so a future session
  picks up here, not from zero): Leave (`routes/employees` leave
  sub-routes, `ess` leave endpoints), Approvals, Payroll authorization
  (beyond the nav-link pass already done), Masters, Documents, Assets,
  Recruitment/Careers, Compensation, remaining `employees/*` sub-routes
  (bank-statutory.ts, personal-info.ts, identity.ts, contracts.ts and the
  ~20 other files in that directory not yet opened this round). Also
  recommended, not yet done: delete the confirmed-100%-dead
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
| **Leave** (`routes/employees` leave endpoints, `pages/leave`, `pages/ess` leave) | Not examined this round | Raise-leave-on-behalf, cancellation, encashment all previously tested (G12, prior rounds). Settings.tsx's "Leave Types & Balances" and "Leave Accrual Jobs" nav links fixed this round; `RightRail.tsx`'s leave-types link fixed. No new API-level leave audit performed this round. |
| **Employees / People Directory** (`routes/employees`, `pages/employees`) | Partially tested | **2 of ~30 route files read end-to-end against all 6 item-2 categories this round: `index.ts` (core CRUD — search/org-tree/list/get/create/patch-me/put/delete) and `user-account.ts` (account provisioning/suspend/reactivate/reset-password).** `index.ts` is otherwise well-hardened from prior rounds (tenant-scoped everywhere, object-level auth on `GET /:id`, cross-tenant FK validation + circular-reference guard on `PUT /:id`'s manager fields, optimistic concurrency, `fetchAllRows` on the unbounded org-tree query) — but had one real defect, now fixed: **`PUT /employees/:id` could set `status: 'separated'` (reachable from `EmployeeProfile.tsx`'s Overview tab) without revoking the employee's auth access**, unlike `DELETE /employees/:id` and the dedicated separation routes. Fixed to call `revokeEmployeeAuth` on the transition into `separated` (not on a no-op resubmission), with 3 new regression tests. `user-account.ts` read in full — no defect found (tenant-scoped, role-gated, rollback-on-partial-failure for both invite and direct-create paths, auth ban/unban kept in sync with `profiles.is_active`, version-conflict handling). **Remaining ~27 files not yet opened this round**: `bank-statutory.ts`, `personal-info.ts`, `identity.ts`, `contracts.ts`, `addresses.ts`, `education.ts`, `emergency-contacts.ts`, `employee-documents.ts`, `exit-interview.ts`, `family.ts`, `full-create.ts`, `full-profile.ts`, `important-dates.ts`, `job-history.ts`, `manager.ts`, `nominations.ts`, `onboarding-status.ts`, `options.ts`, `org-context.ts`, `passport-visa.ts`, `previous-employment.ts`, `probation-confirmations.ts` (tested in a prior round per CLAUDE.md), `separation.ts`/`separation-workflow.ts` (spot-checked this round only for the `revokeEmployeeAuth` call sites — confirmed both already correct, not otherwise re-audited), `shift-history.ts`, `trust.ts`, `access-cards.ts`, `context-data.ts`. |
| **Approvals** (`routes/approvals`, `pages/approvals`) | Partially tested | `Settings.tsx`'s Governance Matrix link fixed (`/admin/approvals/governance` → `/admin/approvals/governance-matrix`). `OperationalInbox.tsx`'s stale `/approvals/inbox` → `/admin/approvals/inbox` fixed (prior turn, this audit). Underlying approval-hierarchy/on-behalf logic last verified in the UAT round recorded in CLAUDE.md/STATUS.md. |
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

**Real Postgres**, checkpoint 2 (isolated): a minimal `profiles`/`tenants` schema was created and two genuinely concurrent `psql` transactions were raced against the same `profiles.id` primary key, confirming SQLSTATE 23505. The user correctly noted this alone doesn't prove the whole workflow — superseded by checkpoint 3's live-stack test below, kept as evidence that the raw Postgres-level assumption was independently verified before building on it.

**Real stack, checkpoint 3** (Postgres 16 + the PostgREST-compatible gateway shim + the compiled, freshly-rebuilt API server, all brought up this round — `pg_ctlcluster 16 main start`, `node /tmp/supabase-gateway.mjs`, `node --env-file=.env dist/index.js`; the `hrms_uat` database and its full migration history survived from earlier in this session): `scripts/db/verify-setup-concurrency-live.mjs` fires real, concurrent HTTP `POST /setup` requests at the real API and inspects the real database afterward — **all 4 checks pass**: exactly one profile/tenant pair survives the race with both callers agreeing on it, zero orphaned tenant rows, a real 20-minutes-later interrupted retry recovers the same tenant/profile via the genuine metadata-match code path (not simulated — the gateway shim was patched to actually persist `user_metadata`, which it previously discarded), and a stranger who only knows the `user_id` is still refused for an existing profile. This script is committed (not a throwaway) so a future session can re-run it without rebuilding the test.

**Local browser journeys, checkpoint 3**: real Chromium (Playwright, the environment's pre-installed browser) against the live stack above, `scripts/db/browser-test-attendance-processing.mjs`, run against a freshly seeded 4-role tenant. Found and fixed the dead-code misdirection described in the checkpoint 3 batch log above as a direct result of this browser run (the test's first pass navigated to the WRONG page and immediately surfaced that checkpoints 1–2 had fixed unreachable code). After the fix: super_admin and hr_admin both get navigation → visible control → real processing → a persisted "Processing Complete" result visible on screen (screenshotted); employee gets neither the control nor server-side permission. This script is also committed for re-use. Screenshots are ephemeral (`/tmp/attendance-browser-evidence/`, not committed) — re-run the script to regenerate them.

## Explicitly still blocked / out of scope (unchanged from the prior round)

- Hosted Supabase/RLS/storage behavior — still blocked, no Supabase project access in this session. Nothing above claims to prove RLS; the local gateway described in prior rounds is a sandbox-only PostgREST-like shim.
- PMS and Travel Desk — on hold per explicit user instruction, untouched.
- `main` branch — untouched. PR #30 — unmerged.
