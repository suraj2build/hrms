# HRMS Fresh Audit Findings & Remediation Plan — 2026-08-03

**Status:** Findings captured 2026-08-03. **Phase 1 (the 3 Critical findings, C1-C3) fixed and merged to `main` same day** — see commit "Fix payroll finalize double-deduction, freeze race, and phantom statutory reconciliation (C1-C3)". Everything else below (all High/Medium/Low findings, and the rest of the remediation plan) is still open.
**Scope:** `apps/api` (288 route files, 180 lib files, 143 platform files), `apps/web` (303 pages, 245 components), `supabase/migrations` (424 files). ~292,000 LOC.
**Relationship to prior audits:** This repo already carries a 4-round, ~300-fix audit history (`AUDIT_CONSTITUTION.md`, `SYSCERT_AUDIT_2026-08-02.md`, `AUDIT_RECONCILIATION_2026-07-01.md`, `AUDIT_CLOSEOUT_SUMMARY.md`). This pass did **not** re-derive that history from scratch — it (a) verified every previously-documented fix is still in place (zero regressions found across ~40 spot-checked prior fixes), and (b) ran 10 independent fresh audits across every subsystem, surfacing net-new or materially-refined findings only. Finding IDs here (`C#`, `F#`) are local to this document — they are **not** part of the repo's existing `ISSUE-###`/`PEND-###` numbering sequence. If a finding below is fixed, it should be logged into `AUDIT_CONSTITUTION.md` under a proper `ISSUE-###` at fix time, per this repo's existing convention.

---

## Executive Summary

**Overall health:** Substantially hardened relative to a typical greenfield audit — the prior fix history holds up under fresh scrutiny. This pass still found **3 Critical**, **~13 High**, **~24 Medium**, and **~14 Low** net-new issues, concentrated in three areas:

1. The payroll finalize path has two data-corruption-class bugs that survived the recent 12-file route split (double-deduction of loan/advance recoveries at scale; a freeze/finalize race that can finalize slips underneath a supposedly-frozen run).
2. Background schedulers still have the exact UTC-vs-tenant-local bug class this codebase has fixed dozens of times elsewhere — missed in exactly two files (`leave-scheduler.ts`, `wo-credit-reconciler.ts`).
3. Automated test coverage on the highest-consequence code (the auth write-gate, all five statutory engines, the leave balance ledger) is effectively zero, despite a real CI-enforced Vitest suite existing for other code.

**What's demonstrably solid (verified, not assumed):** IDOR/tenant-isolation coverage across dozens of route families; `fetchAllRows` pagination discipline on ~90%+ of ~300 dataset-returning endpoints checked; RLS on every table sampled; CSRF/SSRF posture; the `EmployeeProfile.tsx` and `payroll/index.ts` god-file splits (verified structurally sound, zero behavior change, all prior cross-tab/cross-file cache-invalidation fixes intact).

---

## 1. Critical Issues

**✅ FIXED (2026-08-03)** — all three below are resolved in `apps/api/src/routes/payroll/runs.ts` and `statutory-recon.ts`; `tsc --noEmit` clean, both ratchet scripts unchanged, pre-existing vitest failures confirmed unrelated (verified via `git stash` before/after). Kept here, not deleted, so the reasoning and repro steps remain available for writing a regression test later (see §6 Phase 6).

### C1 — Payroll finalize can double-deduct loan/advance EMIs at scale
- **Severity:** Critical | **Category:** Data corruption / Financial
- **File:** `apps/api/src/routes/payroll/runs.ts:2504-2523`
- **Function:** `POST /payroll/runs/:id/finalize` — post-finalize "mark advance/loan recovery as paid" block
- **Description:** Two queries scanning `payroll_slips` (employee IDs, `component_breakdown`) to determine which loan/advance installments were recovered use no `.range()`/`fetchAllRows()`.
- **Root cause:** PostgREST silently caps unwindowed queries at 1,000 rows.
- **Why it's a problem:** For tenants with >1,000 finalized slips, employees beyond the cutoff whose payslip deducted a loan EMI/advance recovery never get their schedule row flipped to `recovered`.
- **Production impact:** Next month's run deducts the same "pending" installment again — a real double deduction from net pay — while the ledger under-reports what was actually collected.
- **Reproduce:** Finalize a run for a tenant with >1,000 employees where employee #1,500 has an active loan EMI; check `loan_schedules` post-finalize — stays `pending` despite the payslip showing the deduction.
- **Recommended fix:** Wrap both queries in `fetchAllRows()`, exactly as the sibling `/payroll/runs/blockers` endpoint in the same file already does.

### C2 — Finalize/freeze TOCTOU race reintroduces a previously-fixed split-state bug
- **Severity:** Critical | **Category:** Data corruption / Race condition
- **File:** `apps/api/src/routes/payroll/runs.ts` (freeze check line 2033; slip-finalize write line 2481; run-status update lines 2687-2692)
- **Function:** `POST /payroll/runs/:id/finalize` vs. `POST /payroll/runs/:id/freeze`
- **Description:** `checkFreezeGuard` is checked once near the top of finalize. ~650 lines later, slips flip to `finalized` unconditionally on run status; only the run's own status update is guarded by `.in('status', ['draft','partial_failed'])`.
- **Why it's a problem:** A concurrent `/freeze` call between the initial guard and the slip write flips run status to `frozen`; the slip-finalize step still succeeds (unconditional); the final run-status update matches 0 rows but Supabase doesn't error on that, so the handler returns a normal success response.
- **Production impact:** `payroll_slips` end up `finalized` while `payroll_runs` says `frozen` — the exact split-state bug this file's own comments say was already fixed once, reintroduced through a different trigger.
- **Reproduce:** Hold a finalize request mid-flight (e.g. during the synchronous stale-employee recompute loop); call `/freeze` for the same month from a second session; let the first complete.
- **Recommended fix:** Re-check `checkFreezeGuard` immediately before the slip-finalize write, or make freeze/finalize atomic against each other. Separately, make the run-status update distinguish "0 rows matched" (return a conflict) from genuine success.

### C3 — Statutory reconciliation has a phantom-success fallback
- **Severity:** Critical | **Category:** Compliance / Legal / Data corruption
- **File:** `apps/api/src/routes/payroll/statutory-recon.ts:103-117`
- **Function:** `buildStatutoryRecon`
- **Description:** When a statute's filing table (`epf_contributions`, `esi_contributions`, `ptax_contributions`, `tds_monthly_projections`) has zero rows for the month, the code sets `payable = computed`, forcing `filed = true` and `variance = 0` by construction, instead of reporting "not yet generated."
- **Why it's a problem:** `isReconciled()` and `/close` both re-derive pass/fail from this fabricated zero-variance state — a month whose filing data was never generated can still pass the "must match within ₹1" gate and get marked filed.
- **Production impact:** An HR admin can close out PF/ESI/PT/TDS for a month where the actual government-filing data was never produced, with zero code-level signal anything is wrong — a genuine compliance exposure.
- **Reproduce:** Finalize a run for a new month, don't run whatever populates the filing tables, then `GET /payroll/statutory-reconciliation` → `ready_for_filing: true` despite zero real filing rows.
- **Recommended fix:** When a statute's filing table has zero rows, report `filed: false` with an explicit "not generated" reason. Never synthesize one side from the other to manufacture zero variance.

---

## 2. High-Severity Findings

| ID | File | One-line description |
|----|------|----------------------|
| F1 | `attendance/corrections.ts:65-108` | ✅ FIXED (2026-08-03) — Missing self-approval guard — the only approval surface in the codebase without one; an HR admin can approve their own attendance correction. |
| F2 | `lib/approval-service.ts:403-524` | ✅ FIXED (2026-08-03) — Approved-leave reversal has no partial/date-aware handling — cancelling a partially-elapsed multi-day leave over-credits balance and retroactively marks already-taken days as unauthorized absence. |
| F7 | `lib/attendance-engine.ts:994` + `lib/leave-engine.ts:240-281` | ✅ FIXED (2026-08-03) — Fractional-leave day still bypasses real punch-pairing — any single stray punch grants full-day credit regardless of actual minutes worked; `work_hours`/`overtime_minutes` remain hardcoded to 0, corrupting downstream consumers. |
| F8 | `lib/statutory/tax-computation-engine.ts:239-246` | ✅ FIXED (2026-08-03) — DB-fallback standard deduction is regime-blind — applies the new-regime ₹75,000 figure to old-regime employees too when the config row is missing, understating taxable income by ₹25,000. |
| F13 | `routes/payroll/runs.ts` + `lib/payroll-engine.ts` | ✅ FIXED (2026-08-03) — No mid-month-joiner proration found anywhere in the payroll computation path — plausible full-month overpayment for new hires (needs live/staging confirmation before treating as certain). |
| F16 | `routes/trust/intelligence.ts` | ✅ FIXED (2026-08-03) — 4 endpoints (`/trust/scores` etc.) report a fabricated `total: data.length` from an already-capped query — silent truncation with no signal, guaranteed to trigger for any tenant of real size. |
| F17 | `routes/payroll/slips.ts` | ✅ FIXED (2026-08-03) — Slip-search employee-match query sits exactly at the 1000-row PostgREST ceiling. |
| F37 | Loan/advance approve-reject mutations (frontend) | ✅ FIXED (2026-08-03) — Missing Idempotency-Key, inconsistent with this codebase's own established pattern for financial mutations. |
| F39 | `lib/leave-scheduler.ts:301-311` | ✅ FIXED (2026-08-03) — Entire leave-job pipeline (accrual, carry-forward, CO-expiry) computes "today" once in server UTC and applies it to every tenant — never received the ISSUE-154 tenant-local-time fix applied elsewhere. |
| F40 | `lib/wo-credit-reconciler.ts:466-495` | ✅ FIXED (2026-08-03) — Identical UTC-global-date bug, driving an actual financial ledger write (weekly-off LOP/extra-pay finalization). |
| F41 | `lib/durable-queue.ts:412-448` | ✅ FIXED (2026-08-03) — Job timeout doesn't cancel in-flight work, and `send-pulse-poll`/`send-digest` have no explicit `timeoutMs` override — can produce duplicate WhatsApp/digest-email sends at scale. |
| F49 | `plugins/owner-auth.ts:61` | ✅ FIXED (2026-08-03) — JWT signature check is not constant-time — the sibling tenant-facing `auth.ts` was already hardened for this exact issue (H11), but the fix never propagated to the higher-privilege owner-portal copy. |

*(Full detail — root cause, reproduction, recommended fix — for each of the above is in the source chat transcript of this audit; summarized here for planning purposes. Expand any row before starting work on it.)*

---

## 3. Medium-Severity Findings

| ID | Area | One-line description |
|----|------|----------------------|
| F3 | Separation | No scheduled job catches `on_notice` employees past their `last_working_date` while clearance/F&F lags — auth stays live during the gap. |
| F4 | `system/jobs.ts` | `module-health` route gated on `hr_admin`, but the underlying table's own RLS restricts it to `super_admin` — any tenant's hr_admin can read platform-wide infra data. |
| F5 | `import/index.ts:604` | TOCTOU on legacy import-job cancel (SELECT-then-UPDATE, not folded into the UPDATE's WHERE clause). |
| F9 | `lib/leave-request-service.ts` / `approval-service.ts` | Leave overlap check is a self-documented TOCTOU gap; approval never re-checks cross-request overlap — can double-deduct balance if two overlapping requests are both later approved. |
| F10 | `lib/absconding-engine.ts` | Scan ignores `employees.status` (can escalate a case for someone already separated) and ignores in-flight PENDING leave requests (slow approval can trigger auto-escalation). |
| F15 | `employees/org-context.ts:102` | One query missing a tenant filter (not currently reachable, but inconsistent with the rest of the file). |
| F18 | `platform/intelligence/index.ts` | Several observations report a truncated `.limit()` count as the real number, even though sibling observations in the same file were already fixed. |
| F19 | `platform/governance/intelligence.ts` | `/risk/summary`'s reported total was fixed but the underlying event fetch is still `.limit(100)` — risk scores computed from an incomplete window. |
| F20 | `payroll/statutory/tax-governance.ts` | `/compliance` high-risk employee list capped at 50, no total reported. |
| F22 | `succession/index.ts` | `/nine-box/auto-plot` — N+1 query per candidate. |
| F25 | `attendance/roster-api.ts` | Bulk-assign has no cap on `employee_ids` × date-range — potential large in-memory build with no guard. |
| F26 | `routes/policy/index.ts` | 3 raw `reply.status(500)` calls — invisible to `check-manual-500s.mjs`'s ratchet, which only regexes `reply.code(500)`. |
| F28 | `routes/billing/index.ts:159` | Webhook writes `tenants.status` directly — re-flags an already-investigated architectural question (prior round ruled it intentional/self-serve-billing-specific; the enterprise-vs-self-serve conflict-resolution question is still genuinely open per that round's own notes). |
| F31–F36 | Frontend caching (Surveys, Policy Library, Optional Holiday Pool, Holidays) | 6 distinct cache-fragmentation gaps + 1 stale-closure race in a holiday-toggle handler — same bug class as ~15 already-fixed instances in this codebase, just not yet swept from these newer features. |
| F38 | Comp-off / leave / regularisation approve-reject (frontend) | ✅ FIXED (2026-08-03) — Missing Idempotency-Key, same pattern as F37 but lower financial stakes. |
| F42 | `lib/digest-scheduler.ts` | "Due" gate uses UTC calendar while content uses tenant-local calendar (self-documented simplification; no outright miss found in the ±14h/−12h range checked). |
| F43 | `lib/intelligence-scanner.ts` | 18 parallel scans silently discard rejected results — zero logging on any scan failure, unlike every sibling job file. |
| F44 | `lib/verification-retry-scanner.ts` | Swallows PAN/bank verification retry errors with no logging. |
| F45 | `lib/attendance-api-scheduler.ts:44-49` | Unpaginated cross-tenant scan of `attendance_api_sources`. |
| F46 | `lib/sla-scanner.ts:106-111` | One unpaginated per-tenant query missed, though sibling queries in the same file were already fixed. |
| Cascade-delete | Multiple financial/audit tables | `ON DELETE CASCADE` from `employees`/`tenants` on payroll/compensation/audit tables — not live-exploitable (app never hard-deletes an employee today) but no DB-level guardrail against a future admin tool doing so. |

---

## 4. Low-Severity / Informational Findings

- **F6** — `npm run lint` currently fails on trunk (41 errors/36 warnings, concentrated in `AdminTalentMarketplace.tsx`, `AdminRecognition.tsx`, `AdminSuccession.tsx`, `PayrollRuns.tsx`) — pre-existing, unrelated to the recent `EmployeeProfile` split, but the zero-tolerance gate is red right now.
- **F11** — `roster-calendar-engine.ts` date math not tenant/UTC-anchored (portability risk only if the process's own `TZ` observes DST; not confirmed live under the standard `TZ=UTC` deployment).
- **F14** — 92 files reimplement `lib/utils.ts`'s date/currency/initials formatters instead of importing them, including a fresh instance written today in the `EmployeeProfile` split's `shared.tsx`; produces a real user-visible inconsistency (two different date formats shown depending on page).
- **F21** — `ess/signals.ts`/`ess/team.ts` understate counts via small hard caps.
- **F23/F24** — Two small, bounded N+1 patterns (`payroll/runs.ts` advance-status sweep, `leave-accrual-lifecycle.ts` bulk-release).
- **F27** — `system/webhooks.ts` uses raw `reply.code(N)` instead of typed helpers (not exploitable today, consistency drift only).
- **F29/F30** — Frontend: empty/error-state conflation in a few pages (ESS Surveys, ESS WFH, executive dashboards); one button missing `isPending` double-click protection.
- **F47/F48** — Unbounded in-memory dedup `Set`s in two scheduler files (slow leak, resets on restart); inconsistent server-local vs. tenant-local date labels in scan dedup keys (cosmetic — affects notification cadence only, not business data).
- Documentation-integrity note: `AUDIT_CLOSEOUT_SUMMARY.md` and `AUDIT_CONSTITUTION.md` §11.3 both still contain a stale, self-contradicted "closed 2026-07-03" claim for AF-001/PD-1 that the constitution's own §1/§9 already superseded (genuinely fixed 2026-07-25). Not a code bug — worth a docs cleanup pass so future audits don't have to re-resolve the contradiction.

---

## 5. Verified Clean (re-checked this pass, no action needed)

- All ~40 previously-documented fixes spot-checked show **zero regressions**: tenant-licensing fresh-read (ISSUE-141), auth revocation on all 5 separation paths, `.single()`/`.maybeSingle()` 404-handling, RLS on 130+ tables (migrations 391/394), EPF admin-charge floor, PostgREST `.or()` filter sanitization, all 7 previously-fixed frontend cache-fragmentation bugs, comp-off/regularisation/overtime self-approval + status-transition guards, SSRF guard coverage, CSRF posture (Bearer-JWT-only, appropriate for this architecture).
- `EmployeeProfile.tsx` / `payroll/index.ts` splits: verified structurally sound — zero unused imports, zero duplicate types, exact prop-contract matches, `tsc --noEmit` clean, no circular dependencies anywhere in `apps/web/src` (660 files).
- IDOR spot-check across recognition, succession, assets, helpdesk, onboarding: no new gap found.
- 301 `.limit()` call sites classified across 116 route files: >90% legitimately bounded; every `.range()` usage is a correct pagination pattern.
- Hardcoded-secrets sweep: clean across both trees; `.env` files git-ignored.

---

## 6. Remediation Plan

Sequencing follows this repo's own established pipeline for every fix: **grep-confirm the exact code → make the change → `tsc --noEmit` clean → run the relevant ratchet script → `git diff` review → stage only the touched files → commit with a descriptive message → push → merge**. Treat each numbered phase as a batch; don't start a phase until the previous one's checks are green, but items *within* a phase can be parallelized across sessions/agents since they touch different files.

### Phase 0 — Before touching any code (safety net)
1. Confirm **F13** (mid-month joiner proration) with a live/staging repro: seed a new hire mid-month, run payroll, inspect `lop_days` and gross pay. This determines whether F13 graduates to a confirmed High-severity fix or gets closed as a non-issue.
2. For any tenant already at >1,000 employees in production, spot-check `loan_schedules`/`advance_recovery_schedules` for stuck `pending` rows that should be `recovered` — **C1** may already have caused live drift that needs manual reconciliation, separate from the code fix.
3. Snapshot/backup `payroll_runs`/`payroll_slips` state before touching finalize/freeze logic (**C2**), given the financial sensitivity of that code path.

### Phase 1 — Critical fixes (target: immediate, before next production deploy) — ✅ DONE (2026-08-03)
1. ~~**C1** — wrap both unpaginated finalize-time loan/advance queries in `fetchAllRows()`.~~ Done — also applied the same fix to the adjacent attendance-completeness gate (`draftSlips`/`attRows`), a High-severity instance of the identical bug class found in the same handler during implementation.
2. ~~**C2** — re-check `checkFreezeGuard` immediately before the slip-finalize write; make the run-status update return/check affected-row count so a losing caller gets a conflict response instead of a silent 200.~~ Done.
3. ~~**C3** — replace the phantom-success fallback in `buildStatutoryRecon` with an explicit "not generated" state; never synthesize `payable` from `computed` or vice versa.~~ Done.
4. Verification completed: `tsc --noEmit` clean, `check-manual-500s.mjs`/`check-console-error.mjs` both unchanged at 0, and the pre-existing vitest suite's 12 failures (3 unrelated files) confirmed identical with/without this diff via `git stash`. **Still outstanding**: no automated regression test was added for the >1,000-employee finalize scenario or the concurrent-freeze-during-finalize race — tracked in Phase 6's test-coverage buildout, not closed by this fix.

### Phase 2 — High severity (target: this week) — ✅ DONE (2026-08-03)
1. ~~**F49** — apply `auth.ts`'s existing `timingSafeEqual` pattern to `owner-auth.ts` (mechanical, low risk, copy an already-solved fix).~~ Done.
2. ~~**F8** — make the TDS standard-deduction fallback regime-aware (`regime === 'new' ? 75_000 : 50_000`).~~ Done.
3. ~~**F39, F40** — apply the existing `fetchTenantTz`+`getLocalDate` pattern (already used in `digest-builder.ts`, `poll-scheduler.ts`, `intelligence-scanner.ts`, `absconding-engine.ts`) to `leave-scheduler.ts` and `wo-credit-reconciler.ts`.~~ Done — `leave-scheduler.ts` needed a widened ±1-day UTC boundary window + dayKey-based re-triggering (not just a naive per-tenant date swap) to avoid silently skipping tenants whose local clock lags UTC; `wo-credit-reconciler.ts` was simpler since its jobs are already fully idempotent.
4. ~~**F1** — add the same `isSelfApproval()` guard used everywhere else to `corrections.ts`'s `authoriseApprover`.~~ Done.
5. ~~**F37, F38** — add Idempotency-Key handling to loan/advance/comp-off/leave/regularisation approve-reject mutations, mirroring the pattern already used elsewhere in this codebase.~~ Done — wired `advances.ts`, `loans.ts`, `leave-requests.ts`, `regularisation.ts` (incl. bulk-approve/bulk-reject), and `comp-off.ts` end-to-end (backend check/store + frontend header). Adjacent bug found and fixed alongside F37: `advances.ts`'s `/approve` endpoint's status-guarded UPDATE never checked for a 0-row match, silently returning success on a concurrent duplicate request.
6. ~~**F41** — set explicit, generous `timeoutMs` values on the `send-pulse-poll`/`send-digest` enqueue calls.~~ Done.
7. ~~**F16, F17** — apply `fetchAllRows()`/paired exact-count to `trust/intelligence.ts`'s 4 endpoints and `payroll/slips.ts`'s slip search.~~ Done.
8. ~~**F7** — run real punch-pairing (`pairPunches()`) unconditionally before the fractional-leave branch in `computeDay()`; derive the worked-remainder status from actual worked minutes, not `punches.length > 0`. **Flag as the highest-complexity item in this phase** — it touches core attendance computation with several downstream consumers (Muster Roll, overtime detection, `wo-credit-reconciler.ts`); budget extra review time and re-verify each consumer after the change.~~ Done — moved the existing punch-pairing/status-derivation block to run before the leave check so the fractional-leave branch shares the same real, threshold-derived `status`/`day_fraction` (and now-real `work_hours`/`late_minutes`/`overtime_minutes`) as the plain punch-based path. Full-day leave is unaffected (punches never influenced its outcome). Verified downstream: `wo-credit-reconciler.ts` and Muster Roll were already reading `status` (unaffected); `payroll-engine.ts`'s LOP/payable-days math reads `day_fraction`, not `work_hours` (unaffected); the overtime summary/manual-OT-request routes can now surface real overtime on a worked leave-day remainder — flagged as new-but-correct behavior (mirrors how worked-on-weekly-off/worked-on-holiday already work), not a regression.
9. ~~**F13** — once Phase 0's repro confirms the bug is real, cap the eligible-days window per employee at `max(date_of_joining, month_start)` in the LOP/working-days computation.~~ Done.
10. ~~**F2** — as a first-pass mitigation, block reversal of an approved leave request once any date in its range is in the past (tenant-local); treat true partial-reversal (crediting back only the unconsumed remainder) as a follow-up design task, not part of this phase.~~ Done — blocks reversal once `from_date` is before tenant-local "today"; true partial reversal remains a follow-up design task.

### Phase 3 — Process/tooling fixes (parallel track, cheap, do alongside Phase 1–2) — ✅ DONE (2026-08-04)
1. ~~**F6** — fix the 3 files causing the currently-red `npm run lint` gate; this is blocking hygiene and should not wait.~~ Done — the actual scope was larger than the finding's "3 files" estimate: ESLint alone was 41 errors/36 warnings across 11 files, and running `check-raw-colors.mjs` directly (it never runs while ESLint is red, since `npm run lint` short-circuits on the `&&`) surfaced 209 further raw-Tailwind-color violations across 4 files. Fixed the full actual scope — 15 files total — so `npm run lint` is genuinely green (zero errors, zero warnings) rather than narrowly satisfying the "3 files" phrasing.
2. ~~Widen `scripts/check-manual-500s.mjs`'s regex to also match `reply.status(500)`, closing the exact blind spot **F26** found (this protects against the same class recurring anywhere else, not just `policy/index.ts`).~~ Done — regex now matches `reply.(?:code|status)(500).send(`. A repo-wide grep confirmed no `reply.status(500)` sites exist outside `policy/index.ts`.
3. ~~**F26, F27** — convert the raw `reply.status(500)`/`reply.code(N)` call sites to the typed helpers while the ratchet script is being widened.~~ Done — converted all 3 sites in `policy/index.ts` (`GET /`, `GET /admin/list`, `POST /`) to `serverError()`, removing the now-redundant manual `req.log.error` calls it already performs.
4. ~~Export `isTenantBlocked()`, `isExemptFromWriteGate()`, `verifySupabaseJwt()` from `auth.ts` and write unit tests for each (see Phase 6) — the single highest risk-reduction-per-effort item in the whole audit, and cheap to do now that the functions are already correct (this just adds a regression net).~~ Done — all three exported; added `apps/api/src/plugins/__tests__/auth.test.ts` with 26 tests covering tenant-status/trial-expiry branches, the exact-path-vs-prefix-collision case the SYSCERT_AUDIT H-finding fixed, and JWT signature/expiry/audience/malformed-token validation.

### Phase 4 — Medium severity (target: next sprint)
1. **F9** — add a Postgres `EXCLUDE USING gist` constraint on `(tenant_id, employee_id)` over the leave date range for PENDING/APPROVED rows, or re-check overlap inside the atomic approve RPC.
2. **F10** — add an active-employee filter to the absconding scan/re-evaluation queries; check for overlapping PENDING leave requests before escalating; auto-resolve open cases when leave is later approved for covered dates.
3. **F3** — add a scheduled scan for `on_notice` employees past `last_working_date` to flag/force-revoke access.
4. **F4** — tighten `system/jobs.ts`'s `module-health` route guard to platform-admin-only.
5. **F5** — fold the status precondition into the UPDATE's WHERE clause for the legacy `import/index.ts` job-cancel endpoint.
6. **F15** — add the missing tenant filter in `org-context.ts` for consistency (not currently exploitable, but cheap to close).
7. **F18, F19, F20, F22, F25, F45, F46** — remaining pagination/N+1 items; batch these together since they're all the same mechanical `fetchAllRows()`/batching fix applied to a different file.
8. **F31–F36** — frontend cache-fragmentation fixes (Surveys, Policy Library, Optional Holiday Pool, Holidays) plus the stale-closure race in the holiday-toggle handler; batch together since they're the same bug class.
9. **F42, F43, F44** — digest-scheduler due-gate consistency, and add logging to the two silent-failure sites in `intelligence-scanner.ts`/`verification-retry-scanner.ts`.
10. **F28** — not a unilateral code fix; raise the enterprise-vs-self-serve billing-contract question to product for a decision, per the prior audit round's own note that this remains genuinely unanswered.
11. Cascade-delete guardrails — decide (as a deliberate product/eng call, not a silent fix) whether `RESTRICT`/`SET NULL` should replace `CASCADE` on payroll/compensation/audit tables, given the app itself never hard-deletes today.

### Phase 5 — Low severity / cleanup (opportunistic — batch when touching nearby code, not a dedicated round)
- F11, F21, F23, F24, F27, F29, F30, F47, F48 — fix opportunistically whenever the surrounding file is next touched for another reason; none of these justify a standalone session.
- The stale AF-001/PD-1 documentation contradiction noted in §4 — a 10-minute docs cleanup whenever someone is next in `AUDIT_CONSTITUTION.md`.

### Phase 6 — Larger, dedicated-round items (do not block any deploy on these)
1. **F14** — the 92-file duplicate-formatter cleanup. Scope as a scripted codemod (find-and-replace to import from `lib/utils.ts`, delete local copies), not a manual pass, given the file count.
2. **Test coverage buildout**, in priority order:
   - Unit tests for `auth.ts`'s three now-exported pure functions (see Phase 3.4).
   - A write-gate integration test proving the tenant-licensing fresh-read contract holds under a cache-hit request.
   - Unit tests for each statutory engine (EPF and ESI first — highest volume/consequence), covering threshold/slab/rounding logic.
   - Integration tests for leave approve→ledger-write (happy path, partial-failure path, cancel/reversal idempotency).
   - A payroll-finalize dual-control enforcement test and a gross-to-net invariant end-to-end test through the real route handler (not just the already-tested pure engine) — this pair directly guards against C1/C2 regressing.
   - A route-registration smoke test for the payroll split, and a render-smoke test for `EmployeeProfile.tsx`.
3. Already-tracked, still-correctly-deferred items from the prior audit round (no new angle found this pass, listed here only so this plan doesn't lose track of them): **PEND-103**'s leave year-boundary balance-bucket split (needs a migration widening `uidx_accrual_ledger_request` + two RPC rewrites), the EPF-vs-ESI rounding-convention question (needs real EPFO ECR 2.0 spec confirmation before touching either engine), **PEND-105**'s optimistic-locking/CAS gap across 27+ masters/profile endpoints, and **PEND-94**'s one remaining unwireable governance rule (`leave.policy-mismatch`, blocked on an undefined product concept).

---

## 7. What NOT to spend further audit cycles on right now

IDOR/tenant-isolation posture, RLS coverage, CSRF/SSRF handling, hardcoded-secrets hygiene, and the recent god-file splits are all in genuinely good shape per this pass's fresh verification — re-auditing those specific areas again soon would have low marginal value versus working through the phases above.
