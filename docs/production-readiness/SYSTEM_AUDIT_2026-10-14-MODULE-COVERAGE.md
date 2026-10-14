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
  validation error, and a real concurrent-insert race; audited the
  **Employees module end-to-end** (`routes/employees/index.ts`,
  `user-account.ts`) against all 6 of item 2's categories and found +
  fixed a real defect: `PUT /employees/:id` could transition status to
  `'separated'` (reachable from `EmployeeProfile.tsx`'s Overview tab, not
  only the dedicated Separation Workflow) without revoking the employee's
  login — a 6th code path the AF-001 remediation (`user-account-service.ts`)
  had documented covering only 5. Verified the real Postgres SQLSTATE for
  the setup.ts race (`23505`) against an actual local Postgres 16 instance,
  separate from the mocked unit tests.
- **Next planned batches** (not yet started — listed so a future session
  picks up here, not from zero): Leave (`routes/employees` leave
  sub-routes, `ess` leave endpoints), Approvals, Payroll authorization
  (beyond the nav-link pass already done), Masters, Documents, Assets,
  Recruitment/Careers, Compensation, remaining `employees/*` sub-routes
  (bank-statutory.ts, personal-info.ts, identity.ts, contracts.ts and the
  ~20 other files in that directory not yet opened this round).

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
| **Attendance** (`routes/attendance`, `pages/attendance`) | Partially tested | Nav links fixed: `EmployeeShifts.tsx` dead `<a href="/shift-master">` → `<Link to="/admin/shift-master">`; `MusterRoll.tsx`'s `/admin/payroll/readiness` → `/admin/payroll-readiness`. **Admin attendance-processing gap closed for real** (checkpoint 2): read `apps/api/src/routes/attendance/process.ts` and confirmed the backend already correctly authorizes `hr_admin`/`super_admin` for `POST /attendance/process` (two-layer advisory+table locking, TTL takeover, period-lock guard — this route itself needed no fix). The gap was purely frontend: `AdminDashboard.tsx`'s two "Process Attendance" actions pointed at a route with no trigger UI. Checkpoint 1 had pointed them at `/admin/operational-health` (read-only observability — still not a real fix, correctly called out). Found that `Attendance.tsx` is role-aware (not route-gated): `isAdmin = ['super_admin','hr_admin'].includes(role)` unconditionally renders the real trigger button (date picker, force checkbox, `processMutation` → `POST /attendance/process`) whenever an admin views it, and the page is reachable by admins at `/manager/team/attendance` (`ManagerShell` only blocks `role === 'employee'` — the file's own comment documents "hr_admin/super_admin reach manager pages via RoleSwitcher"). Re-pointed both AdminDashboard actions there instead — zero new code, reuses the existing authorized workflow, verified by reading the exact JSX that renders the button and confirming the route guard doesn't exclude admins. API-level correctness (processing idempotency, anomaly reconciliation) last verified in the Round 2026-10-11 de-emphasis work and the earlier UAT scenario matrix (W/WO/H/X/P/L-series), not re-run this round. |
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
- Checkpoint 2: **526/526 passed, 61/61 files**, 0 regressions — adds the feedback-screenshot-path allowlist unit tests (17), the hardened route-level bypass tests (9 + 9 new cases across the support/owner screenshot-path tests), the setup.ts interrupted-retry/USER_NOT_FOUND/validation/concurrency tests (4 new), and the PUT /employees/:id revocation regression (3 new).
- `npx tsc --noEmit` on both `apps/web` and `apps/api` — **0 errors** on both, checkpoint 2.

**Real Postgres** (separate from the mocks above, run against an actual local Postgres 16 instance started this round — `pg_ctlcluster 16 main start`, stopped again after): a minimal `profiles`/`tenants` schema was created and two genuinely concurrent `psql` transactions were raced against the same `profiles.id` primary key. Confirmed the loser receives a real `duplicate key value violates unique constraint` error with **SQLSTATE 23505** — the exact code `setup.ts`'s race-handling branch checks for — so the mocked concurrency test's assumption is empirically grounded, not merely asserted. No other real-Postgres work was done this batch (the full 450-migration history was not re-applied this round; checkpoint 1's prior rounds already did that for the leave-accrual/payroll-rollback work).

**Local browser journeys**: **not run this batch.** The sandbox PostgREST-like gateway shim used in prior rounds (`/tmp/supabase-gateway.mjs`) was explicitly local-sandbox-only and does not persist across sessions — this session started in a fresh container with no running gateway/API/web stack. Rebuilding that shim from scratch was judged lower-value for this batch's specific fixes (nav-link string targets, verified more strongly by route-table cross-reference than a visual click would add; the attendance-processing fix, verified by reading the exact render-gated JSX) than continuing the source+test audit of unexamined modules. This is a disclosed scope decision for this batch, not a silent skip — browser journeys remain planned for whichever future batch produces a finding that genuinely needs visual confirmation to resolve.

## Explicitly still blocked / out of scope (unchanged from the prior round)

- Hosted Supabase/RLS/storage behavior — still blocked, no Supabase project access in this session. Nothing above claims to prove RLS; the local gateway described in prior rounds is a sandbox-only PostgREST-like shim.
- PMS and Travel Desk — on hold per explicit user instruction, untouched.
- `main` branch — untouched. PR #30 — unmerged.
