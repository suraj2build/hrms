# CognixHR Production-Readiness Remediation — STATUS

**NO-GO stands.** This document is evidence for a future review, not a release
sign-off. Nothing here should be read as GO.

## Source of truth (as of this commit)

**Correction to this document's own prior revision**, which said "0 commits
pushed... origin/fix/g13-numeric-coercion-sweep does not exist yet" — that
was stale even when written, and is contradicted by a direct fetch: the
remote branch exists and already holds commits. "Ahead of local `main`" and
"ahead of `origin`" are two different numbers; this document previously
conflated them. Both below are from actual Git output, not carried-forward
figures:

- **Branch:** `fix/g13-numeric-coercion-sweep`
- **Ahead of local `main`:** `git rev-list --count main..HEAD` → 20, as of
  the commit before this one (this doc's own commit, and the commits
  alongside it in this round, are necessarily on top of that — re-run the
  command for the true current count rather than trusting this number to
  stay in sync across further commits).
- **Ahead of `origin/fix/g13-numeric-coercion-sweep`:** after
  `git fetch origin fix/g13-numeric-coercion-sweep`,
  `git rev-list --count origin/fix/g13-numeric-coercion-sweep..HEAD` → 18,
  and `git rev-list --count HEAD..origin/...` → 0 (not behind). **The
  remote branch exists and already carries 2 of the 20 commits that
  diverge from `main`** — i.e. 2 commits were pushed in an earlier round
  before the GitHub access issue below started, and 18 are unpushed since.
  This is the correct reading of "20 ahead of main, 18 unpushed" — two
  different baselines, not a contradiction.
- **Working tree:** clean (no uncommitted changes) as of this commit.
- **Push status:** paused per standing instruction — GitHub App access for
  this session has repeatedly 403'd ("Claude doesn't have GitHub access to
  suraj2build/hrms for your organization"). Do not retry until the user
  explicitly confirms access is restored. All work in this pass is local-only.
- **PR #29:** unmerged, draft. Must stay that way until a fresh review, not
  this document, clears it.
- **Baselines:** `scripts/tenant-isolation-baseline.json` and
  `scripts/unbounded-queries-baseline.json` are **untouched** — verified via
  `git diff --stat` on both, zero changes, no `--save-baseline` ever run this
  session. (`scripts/*-baseline.stable-key.json` are new, separate files —
  proposals, not replacements — see Phase 3.)

## G01–G13 — the original audit scope, recovered

**Correction to this document's own prior revision.** A previous round
reasoned from PR #29's body text alone ("G01–G06 and the overall NO-GO
verdict from the audit are unaffected and unchanged by this PR") and
concluded the real scope was G01–G06, with G07–G12 "not appearing to have
ever existed." That conclusion was **wrong, and is retracted here**: PR #29's
body describes *that PR's own scope* (it only touched G01–G06-adjacent
material, if any), not the boundary of the original audit. The original
audit document exists, is attached to this engagement
(`COGNIXHR_PRODUCTION_READINESS_AUDIT_2026-09-27.md`, dated 27 September
2026, reviewed `main` at `1136f5544c3a2242036f497e1335d90277b1bbc2`), and
**defines G01 through G13** — all thirteen, not six. G07–G12 are real,
documented findings; they were never invalidated by PR #29 or by anything in
this repository. Treat the "G01–G06 / G07–G12 doesn't exist" framing in this
document's previous revision as the error, not the audit's scope.

The audit itself also already contains a later addendum adding **G13**
(the NUMERIC/DECIMAL string-coercion defect) as a P1 release-verification
gate — the same defect class this entire branch (`fix/g13-numeric-coercion-sweep`)
exists to close. So the full, real register is **G01–G13**, all thirteen
items below, not a 6-item subset.

| ID | Sev | Finding (from the original audit) | Status as of this commit |
|---|---|---|---|
| G01 | P0 | Leave accrual can report success while crediting nobody: all four `leave-jobs.ts` insert paths write `policy_rule_id`, but no migration ever added that column to `leave_accrual_ledger`. | **FIXED, mutation-tested, real-stack-validated.** Migration `440_leave_accrual_ledger_policy_rule_id.sql` adds the column. A second, independently-discovered bug in the same code path was found and fixed while reproducing this through the real job: migration `163_replay_infrastructure.sql`'s `uidx_lal_cycle_key` was a PARTIAL unique index (`WHERE cycle_key IS NOT NULL`), which Postgres cannot match against an `ON CONFLICT(cycle_key)` target with no `WHERE` clause — this broke every cycle_key-based upsert in the accrual ledger independent of the missing-column bug; migration `441_leave_accrual_ledger_cycle_key_full_unique.sql` replaces it with a full unique index. `scripts/g01-leave-accrual-ledger-check.sh` invokes the real `monthlyAccrualJob()` against the real stack; mutation-tested (reverting the column fix reproduces `employees_processed: 0`; restoring returns 4/4 green). |
| G02 | P0 | An impossible LOP count can reduce pay to zero and still produce a finalizable slip; payroll warns but does not block. | **FIXED, mutation-tested, real-stack-validated — CORRECTED after a review rejected the first pass.** The first pass (a non-blocking `LOP_EXCESSIVE` warning) closed the "silent" half of the finding but left finalize free to proceed regardless, which a review correctly rejected as insufficient for a P0 release blocker. `LOP_EXCESSIVE` is now `severity='critical'/blocking=true` (`payroll-blocker-engine.ts`) — the same classification every other data-integrity rule carries — so `runs.ts`'s existing Open-blockers gate rejects finalize with 422 by default. The override path is `force_finalize`+`override_reason` (super_admin-gated under dual control), and using it now **persists** onto the specific blocker row (`status='ignored'`, `resolved_by`, `resolved_at`, `resolution_note`) rather than only a log line. Two more real bugs were found and fixed while reproducing this through the real `POST /payroll/runs` endpoint: (a) `statutory-payroll.ts`'s wage-base computations had no floor at 0, producing a negative `employer_contributions` that crashed the run — fixed with `Math.max(0, ...)`; (b) the `LOP_EXCESSIVE` classification regex never matched the real message text — fixed the pattern. `scripts/g02-lop-exceeds-working-days-check.sh` now drives the real finalize endpoint end to end: a maker proposes, the checker's first attempt is genuinely REJECTED (422, run stays draft, no false approval), and only the explicit override succeeds, after which the blocker row carries the persisted override. Mutation-tested twice (deduction/net-pay reconciliation, then separately the blocking-rule flip): 19/19 green, reverting either reproduces the exact pre-fix gap. |
| G03 | P0 | F&F approval does not require a fresh calculation; settlement engine selects the latest slip by month without a finalized-run condition. | **FIXED, mutation-tested, real-stack-validated — CORRECTED after a review flagged the first pass as incomplete.** The first pass (`.eq('status','finalized')` on the salary-basis query) fixed which slip gets read but left the audit's other half open: nothing re-validated an already-computed, not-yet-approved F&F record if the inputs changed afterward. `separation-workflow.ts`'s `PATCH /approve` now re-runs `computeFnfSettlement()` (when the record was produced by `/compute` — a pure manual entry has nothing to recompute) and compares its salary basis against what's stored; a mismatch is rejected `409 STALE_CALCULATION` with both figures in the body. `scripts/g03-fnf-settlement-last-finalized-slip-check.sh` now also finalizes a second slip after compute, asserts the real approve endpoint rejects the stale approval, then recomputes and asserts approval succeeds once the stored basis matches reality. Mutation-tested twice (salary-source filter, then separately the staleness check): 9/9 green. |
| G04 | P1 | Payroll maker/checker approval occurs before attendance closure/other finalize gates; a failed later gate leaves the approval consumed. | **FIXED, mutation-tested, real-stack-validated — CORRECTED after a review caught the fix was still incomplete.** The first pass moved the approval commit to "right before Step 1," which closed the gate-ordering gap but left the exact same class of bug one layer deeper: a Step 1 or Step 2 (the atomic `payroll_runs` status seal) failure downstream of that point could still leave `maker_checker_log` claiming "approved" for a finalize that didn't durably happen. The commit is now deferred until immediately AFTER Step 2's atomic success check — the only point the finalize is guaranteed to have genuinely gone through. A failure there is logged forensically (never fails the response — finalize already succeeded by then) rather than surfaced as an error. `scripts/g04-maker-checker-approval-ordering-check.sh` gained two new sections per the review's explicit demand to test "downstream failure, retry, and concurrency, not just passing the pre-flight gates": §6 forces Step 2 to lose its race (flips the run to `'processing'` mid-flight) and proves the checker's attempt fails cleanly with no false approval, then that a genuine retry succeeds; §7 fires two simultaneous approve calls and proves exactly one wins with no duplicated/corrupted `maker_checker_log` row. Mutation-tested against the exact prior-round code the review flagged: 22/22 green, reverting reproduces the false-approval state. |
| G05 | P1 | Clean database installation has an accepted failed migration: `016_lean_employees.sql` aborts and CI explicitly allows it via a `KNOWN_FAILING` allowlist. | **CORRECTED — RESOLVED, with current evidence, not just re-asserted.** `scripts/db/check-schema-drift.mjs`'s own `KNOWN_FAILING` set is now `new Set([])` — **empty** — with an inline comment recording that `016_lean_employees.sql` was investigated and found to apply cleanly end-to-end against a fresh database (its `DROP COLUMN manager_id` is preceded by `DROP POLICY IF EXISTS employees_manager_team`, so the abort theory in the original audit was itself based on a reading of the file that didn't hold up against actually running it). This session re-ran `check-schema-drift.mjs` against all 438 current migrations (Phase 3/4, above): **zero schema drift across 478 tables, no migration failure.** G05's clean-install risk, as described in the audit, is closed. This is the "corrected G05 finding" carried forward per the most recent instruction: the audit's original text is preserved above for the record, and the current, re-verified status supersedes it. |
| G06 | P1 | Statutory compliance report (`analytics/reports.ts`) diverges from payroll source of truth; prior UAT said "not fixed." | **FIXED, mutation-tested, real-stack-validated, AND frontend-verified — a review correctly flagged the first pass as backend-only.** `/reports/statutory` requires a `month` param and reads the REAL `epf_contributions`/`esi_contributions` rows for that month, keyed by employee_id — replacing the CTC-formula approximation entirely. The frontend (`apps/web/.../Reports.tsx`'s `StatutoryReport` tab) is the endpoint's only real consumer and had no month state at all, which would have 400'd every request; wired in `usePayrollMonthState()` (the same anchor-based hook 5 other tabs on the same page already use — defaults to the latest month with a finalized payroll run, directly answering "does it reconcile to the intended finalized payroll period"). Verified in a real browser, not just `tsc`: logged in through the actual login form with a freshly signed-up hr_admin, navigated to the tab, and confirmed against seeded real contribution rows that the month defaults correctly and the real PF/ESI figures render (ESI shown as applicable at a CTC level the old formula would have called inapplicable — visual proof the real source is wired in). `scripts/g06-statutory-report-real-contributions-check.sh`: 6/6 green, mutation-tested. |
| G07 | P1 | No evidence of a 2,000+ employee load/soak test; prove throughput under production-like PostgREST limits. | **Partial evidence from this session**, explicitly not a closure: `pagination-scale-check.sh` now exercises 2,200 employees across ESI/EPF/PTax against real Postgres through a from-scratch PostgREST-shim gateway (`/tmp/supabase-gateway.mjs`), not real Supabase/PostgREST. This is evidence toward G07, not proof of it — the audit's own bar is a genuine Supabase/PostgREST environment, which this sandbox cannot provide (see Phase 4/"still BLOCKED" below). |
| G08 | P1 | CI ratchets allow existing findings: 314 tenant-isolation and 267 unbounded-query static-check exceptions. | **Directly corroborated, not just cited**: the frozen baseline files (`scripts/tenant-isolation-baseline.json` / `scripts/unbounded-queries-baseline.json`, untouched this session) hold exactly `count: 314` and `count: 267` — matching the audit's own figures exactly, confirming the audit's snapshot and this repo's frozen baseline describe the same state. **All CONFIRMED_DEFECT rows in both checkers' live registers are now closed this session** (see Phase 2/2b below) — but the frozen ratchet baselines themselves are unchanged (314/267, per the standing never-regenerate rule) and the ratchet still exits 1 for the unrelated fingerprint-instability reason (`ADD-004`), not a new regression. G08 as the audit describes it (the ratchet mechanism allowing stale exceptions) is **still open** — closing the live findings behind it doesn't change the ratchet's own fingerprint-stability defect. |
| G09 | P1 | E2E is manual/weekly, not a PR gate; payroll suite mostly checks page content. | **CONFIRMED STILL OPEN — re-verified this session against current code.** `.github/workflows/e2e.yml`'s triggers are `workflow_dispatch` (manual) and `schedule` only — no `pull_request` trigger. `apps/e2e/tests/05-payroll.spec.ts:108` does `console.warn('[cross-check] MISMATCH: ...')` on a muster/payroll discrepancy rather than failing the assertion — confirmed by direct read, exactly as the audit describes. |
| G10 | P1 | Backup, restore, PITR, RPO/RTO, secret rotation, rollback, incident response cannot be certified from repo files. | Recovered. **Still BLOCKED** — unchanged, this sandbox has no staging/production infrastructure to exercise any of this. |
| G11 | P2 | Profile cache retains role/tenant/employee mapping up to 5 minutes; `is_active` rechecked at most every 60s — no measured access-revocation SLA. | **CONFIRMED STILL OPEN (unchanged) — re-verified this session against current code.** `apps/api/src/plugins/auth.ts`: `CACHE_TTL = 5 * 60 * 1000` (5 min) and `IS_ACTIVE_TTL = 60 * 1000` (60s) — both constants match the audit's description exactly, character for character. Still a bounded, documented delay, not a bypass — same characterization the audit itself gave. No measured access-revocation SLA has been established. |
| G12 | P2 | Standalone leave encashment has no employee request UI; mark-paid only changes status, no proven disbursement path. Scope question, not just a bug. | Recovered, **not re-verified this session**. Needs a product scoping decision (is this in the first customer's scope?), not just an engineering fix. |
| G13 | P1 | Repeated payroll defects share a DB NUMERIC/DECIMAL-as-string coercion failure mode (`Number()` missing at the data boundary). | **REMEDIATED LOCALLY; STAGING VALIDATION PENDING** — not unqualified FIXED. See `FINDINGS.csv` row 1 and the rest of this document: every cluster covered this engagement is fixed and mutation-tested against the local real-stack harness (real Postgres + a hand-built PostgREST-shim gateway, not real Supabase/PostgREST). That local validation is real but it is not the same thing as proof against genuine PostgREST's actual wire behavior at scale — the one gate this engagement's sandbox cannot provide. Until that real-scale PostgREST validation runs, G13 is remediated-not-yet-proven-in-the-target-environment; this document and `FINDINGS.csv` use that qualified phrase everywhere instead of an unqualified "FIXED" for this item. |

**Closure ledger — every one of the 13 accounted for explicitly, absence
from an "open" list is never treated as closure:**

| ID | Status | Re-verified this session? |
|---|---|---|
| G01 | **FIXED**, mutation-tested, real-stack-validated | Yes — migrations 440/441 + `scripts/g01-leave-accrual-ledger-check.sh` against the real job |
| G02 | **FIXED**, mutation-tested, real-stack-validated — CORRECTED (blocker now `blocking=true`, override persisted to the row, not just a visible warning) | Yes — `scripts/g02-lop-exceeds-working-days-check.sh` through the real `POST /payroll/runs` endpoint, 19/19 |
| G03 | **FIXED**, mutation-tested, real-stack-validated — CORRECTED (staleness recompute+compare added to `/approve`, not just the finalized-slip filter) | Yes — `scripts/g03-fnf-settlement-last-finalized-slip-check.sh` through the real F&F compute endpoint, 9/9 |
| G04 | **FIXED**, mutation-tested, real-stack-validated — CORRECTED (commit moved to after Step 2's atomic seal, not just before Step 1) | Yes — `scripts/g04-maker-checker-approval-ordering-check.sh` through the real finalize endpoint, incl. downstream-failure/retry/concurrency, 22/22 |
| G05 | **FIXED** | Yes — re-ran check-schema-drift.mjs against all 438 migrations |
| G06 | **FIXED**, mutation-tested, real-stack-validated, AND frontend-verified — CORRECTED (first pass was backend-only; `usePayrollMonthState()` now wired into the report tab, verified in a real browser) | Yes — `scripts/g06-statutory-report-real-contributions-check.sh` through the real `/reports/statutory` endpoint, 6/6 |
| G07 | **PARTIAL EVIDENCE**, not closed | Yes — real-stack scale test, not real Supabase |
| G08 | **OPEN** (ratchet mechanism itself; underlying live findings now closed) | Yes — baseline file inspection + live-register status |
| G09 | **OPEN** (confirmed) | Yes — CI config + spec file read |
| G10 | **BLOCKED**, not closed | No — infrastructure access this sandbox cannot provide |
| G11 | **OPEN** (confirmed, unchanged) | Yes — constant values read directly |
| G12 | **OPEN** — product scope question | No — needs a scoping decision, not re-traced |
| G13 | **REMEDIATED LOCALLY; STAGING VALIDATION PENDING** for the clusters this branch covers — not unqualified FIXED; real-scale PostgREST validation against genuine Supabase is the one still-open release gate | Yes — this entire branch's subject |

Every item above is either re-verified this session with cited evidence, or
explicitly marked as not re-verified and why (infrastructure-blocked or a
pending product decision) — none are closed by omission.

### Milestone status report: G07, G08, G09, G11 (explicitly requested)

None of these four are closed. Restated plainly, per finding:

- **G07 (unbounded-query pagination) — PARTIAL EVIDENCE, not closure.** A
  2,200-employee scale test was run and passed against this sandbox's local
  Supabase-gateway stand-in, not real Supabase/PostgREST. That stand-in does
  not enforce PostgREST's server-side `max-rows=1000` ceiling the way the
  real service does (the exact defect class that caused the original Muster
  Roll incident), so a pass here is evidence `fetchAllRows()` is wired in
  correctly, not proof the 1000-row ceiling is actually being paginated
  around in production. Real-PostgREST validation remains the open gate —
  see G10 below, which blocks it for the same infrastructure reason.
- **G08 (finding-register ratchet mechanism) — OPEN.** The live
  CONFIRMED_DEFECT findings this ratchet exists to track are now closed
  (G01–G06 this session, modulo the corrections above), but the ratchet
  mechanism itself — the frozen baseline files `check-manual-500s.mjs` and
  `check-console-error.mjs` compare against — is unchanged, and the
  fingerprint-instability defect (ADD-004: the same finding can get a
  different stable-key hash across runs, silently defeating the ratchet's
  ability to track it) is unresolved by default. This is a mechanism-level
  gap, independent of any individual finding's fix status.
- **G09 (e2e / payroll regression gating in CI) — OPEN, confirmed
  unchanged.** `e2e.yml` still has no `pull_request` trigger, so these tests
  do not run as a PR gate at all — only on whatever trigger it does have.
  `05-payroll.spec.ts` still only `console.warn`s on a payroll-figure
  mismatch rather than failing the test, so even when the suite does run, a
  regression in payroll output would not fail CI. Neither was touched this
  session; both were re-confirmed by direct file read.
- **G11 (session/permission cache revocation latency) — OPEN, confirmed
  unchanged.** `auth.ts` still has `CACHE_TTL=5min` and `IS_ACTIVE_TTL=60s`
  for the profile/permission cache, and there is still no measured
  access-revocation SLA (i.e., no test asserting "a deactivated user's
  existing session loses access within N seconds"). Re-confirmed by reading
  the actual constant values; not touched this session.

None of the four above should be read as downgraded, deferred, or
deprioritized by the G01–G06 corrections above — they are simply out of this
session's scope, and remain open exactly as previously reported.

## Phase status

### Phase 1 — Source of truth: PARTIAL
- HEAD/branch/working-tree/unpushed-commits: done, above.
- Complete finding register: done for tenant-isolation (307) and
  unbounded-queries (153) — reconciled exactly against the checkers' own
  current output, not agent self-reported counts. G13: done — see above.
  **G01–G12: recovered this session** (the source document exists —
  `COGNIXHR_PRODUCTION_READINESS_AUDIT_2026-09-27.md` — see "G01–G13" above);
  G01 and G05 re-verified against current code, G02/G03/G04/G06/G09/G11
  restored to the register verbatim but not re-verified, G10/G12 are
  scope/infrastructure questions carried forward unchanged.
- Stable IDs / evidence / severity / status / fix commit / regression test /
  remaining validation per finding: done — `FINDINGS.csv`.

### Phase 2 — Complete remediation: PARTIAL
Fixed this pass (local commits, not pushed):
- **A1 statutory wage-base cluster** (highest priority per explicit
  instruction): `epf.ts`, `esi.ts`, `ptax.ts`, `statutory-recon.ts`,
  `tds-bulk.ts` — all confirmed pagination defects in this cluster fixed,
  plus an additional defect found during review (`employee_compensation_components`
  unchunked lookup, not caught by either checker) in all three of epf/esi/ptax.
- **A2 filing-pack cluster**: all 4 confirmed defects fixed, plus 2 additional
  chunking fixes (UAN lookups) found during review.
- **Pagination correctness hardening**: every `fetchAllRows()` call site
  touched in this pass (new and pre-existing) now has a deterministic
  `.order()` — PostgREST's `.range()` compiles to OFFSET/LIMIT, which is not
  guaranteed stable across separate page requests without one; a concurrent
  write between pages could otherwise skip or duplicate a row.
- 7 new regression tests, **all mutation-verified** (reverted to the pre-fix
  code, confirmed RED, restored, confirmed GREEN again) — see EVIDENCE.md for
  the exact before/after numbers.
- **Keyset pagination for financial-critical reads — corrected claim, gap
  closed, not just reworded.** A deterministic `.order('id')` resolves
  ambiguous ordering between identical requests, but does not prevent
  offset pagination from skipping/duplicating a ROW when the table is
  written to WHILE pagination is in flight. Added `fetchAllRowsByKeyset()`
  and proved its row-level correctness property against a real simulated
  concurrent mutation. **This function is NOT a consistent snapshot** —
  proven directly, not just stated: a new vitest case
  (`supabase-paginate.test.ts`, "is NOT a consistent snapshot" suite) shows
  a concurrent UPDATE to an already-read row's value produces a paginated
  sum that does not equal the table's true current total, a distinct
  failure mode from skip/duplicate that keyset pagination alone does not
  prevent. `supabase-paginate.ts`'s doc comment was corrected to say this
  explicitly and never describe a keyset-built read as snapshot-safe on that
  basis alone.
  For the specific reads migrated this engagement (ESI/EPF/PTax wage base,
  TDS actual-TDS, statutory-recon's 4 payable sums — all filtered to
  `payroll_slips.status = 'finalized'`), the actual consistency strategy is
  a **DB-enforced immutability guarantee**, not keyset pagination itself:
  new migration `438_payroll_slip_finalized_value_lockdown.sql` adds a
  trigger that rejects any UPDATE changing a financial column on a slip
  while its own `status` stays `'finalized'` on both sides of the write —
  closing the exact value-mutation gap, for exactly the rows these queries
  read. Before this migration, that immutability was only an application
  convention (verified: the one UPDATE call site on `payroll_slips` in
  `runs.ts` is gated `.eq('status', 'draft')`, never touching a finalized
  row) — real, but not DB-enforced, so a future code path or ad-hoc query
  could have silently violated it. Tested against real Postgres, both
  mutation-tested (dropped the trigger, confirmed the bad UPDATE goes
  through unblocked, restored, reconfirmed blocked) and for regression
  (confirmed the legitimate draft→finalized transition and the existing
  rollback break-glass path both still work): `scripts/finalized-slip-value-lockdown-check.sh`,
  **5/5 assertions pass**, cleanup confirmed. See EVIDENCE.md §6 and §6c.
- **3 more real bugs found and fixed via real-stack scale testing at 2,200
  employees** (not mocks): epf.ts's and esi.ts/ptax.ts's
  `employee_compensations` fallback lookups were unchunked against the full
  headcount (`ADD-006`, `ADD-007`); ptax.ts's state-resolution reads
  (`ptax_state_config`/`lwf_state_config`) were completely unpaginated and
  silently dropped 1,200 of 2,200 employees from PTax entirely (`ADD-008`).
  All three fixed, re-verified at scale; the state-resolution one
  mutation-tested directly against the real stack. See EVIDENCE.md §6.

**Register reconciliation this round** (per the standing instruction to
reconcile the confirmed-defect backlog exactly against register IDs, not
just re-state the pre-existing count): re-checked all 35 remaining
`check-unbounded-queries.mjs` CONFIRMED_DEFECT rows against current code
before touching anything. **6 were already fixed in a prior round and
FINDINGS.csv simply hadn't been updated to say so** — `UNB-105`/`UNB-106`
(`arrears.ts`), `UNB-119` (`ops-dashboard.ts`), `UNB-121`/`UNB-124`
(`runs.ts`), `UNB-142` (`variable-pay.ts`) all already use
`fetchAllRows()`/chunking; verified by reading the current source at each
cited line, not assumed. Corrected in `FINDINGS.csv` (documentation fix, no
code change). One more, `UNB-122` (`runs.ts`'s finalize-time staleness
guard — a genuinely unbounded `leave_requests` scan with no pagination at
all), was found still genuinely open and **fixed this round**: migrated to
`fetchAllRows()`. This also fixed a latent test-mock bug it exposed —
`runs-finalize.test.ts`'s `leave_requests` mock didn't respect `.range()`
(same class of bug documented in "Errors and fixes" for the keyset
migration), causing an infinite loop / test timeout; fixed by passing
`{ paged: true }`, matching the mock's own existing convention for
`attendance_daily`. Full suite re-run clean after: `tsc --noEmit` exit 0,
`vitest run` 40 files / 331 tests pass.

**All 28 remaining `check-unbounded-queries.mjs` CONFIRMED_DEFECT rows closed
this round** (grouped by theme in `master-register.md`'s section A3:
enrichment-lookup-reuses-id-list ×15, genuinely-unbounded-scan ×7,
caller-controlled-range ×3, recursive-subtree ×1, unchunked-sibling ×2,
fails-closed-array ×3, narrow-occurrence ×1). Re-read each one's current
code before touching anything, same discipline as the earlier 6-row
reconciliation:
- **26 fixed**: migrated to `fetchAllRows()` (genuinely unbounded tenant-wide
  scans — `assistant-tools.ts`, `intelligence-scanner.ts` ×2, `anomalies.ts`,
  `comp-off.ts`, `confidence.ts`, `executive/index.ts`, `recognition/index.ts`,
  and `attendance-engine.ts`'s `recomputeRange()` — see correction below) or
  chunked by 100 (`.in()` lookups against a caller-controlled or tenant-wide
  id list — `absconding-engine.ts`, `import-engine/validator.ts` ×2,
  `org-context.ts`, `shift-resolution-engine.ts`, `health-index.ts`,
  `leave.ts` ×2, `overtime.ts`, `wo-credit.ts`, `work-sessions.ts`,
  `compensation/revisions.ts`, `leave-policy-assignments.ts`, `surveys/index.ts`
  ×2 — two of these are fails-closed validation checks, same pattern as
  `arrears.ts`/`variable-pay.ts` earlier in this engagement).
- **1 reconciled** (`UNB-096`, `team-payroll-cost.ts`): already fixed in a
  prior round, register was stale — same documentation-lag pattern as the
  6 rows reconciled earlier.
- **1 reclassified `FALSE_POSITIVE`, not force-fixed**: `UNB-044` — the
  `.limit(50)` display cap on a "missing punches today" widget is legitimate
  (CLAUDE.md's own stated exception). But fixing it uncovered a REAL bug
  the original pass over this list missed: the endpoint returned
  `count: employees.length` — a total DERIVED from the capped 50-row
  result. Fixed to fetch the true total independently via
  `count:'exact', head:true`. See correction below.

**Correction, from review, to this document's own earlier text in this
round**: an earlier draft of this section reclassified `UNB-010`
(`attendance-engine.ts` recompute) and `UNB-042` (`confidence.ts`) as
`FALSE_POSITIVE` on the reasoning that single-employee scope bounds the
result. **That reasoning was wrong and is retracted, not just softened**:
employee scope bounds the SHAPE of the result (one row per date, enforced
by `attendance_daily`'s `UNIQUE(tenant_id, employee_id, date)`), but not
the COUNT — that depends on the date SPAN, and neither call site capped
the span. Both `from_date`/`to_date` (recompute) and `from`/`to`
(confidence) are caller-supplied with only date-FORMAT validation, no
maximum-span check, at every call site (checked all 6+ for `recomputeRange`).
A span over ~2.7 years produces >1,000 calendar dates. Both are now
genuinely fixed with `fetchAllRows()`, not reclassified:
- `attendance-engine.ts`'s `recomputeRange()`: an unbounded span would have
  silently truncated the existing-rows map used for recompute-protection,
  risking a silent overwrite of a protected date past the cap.
- `confidence.ts`: an unbounded span would have silently truncated
  `total_days`/`avg_score`/`critical_days`/`low_days` — stats computed from
  `rows.length`.

**Mutation-tested, not just argued** — reverted `confidence.ts` to the
pre-fix query, re-seeded a real 1,200-row single-employee fixture, and
reproduced the exact predicted failure:
```
total_days:    expected 1200, got 1000
critical_days: expected 120,  got 100
```
Restored, reconfirmed correct. See `scripts/attendance-survey-truncation-check.sh`
and EVIDENCE.md §6f.

**New real-stack evidence for the review's three verification points** (not
just `tsc`/`vitest` against the statutory scripts, which don't exercise
attendance/surveys/recognition at all) —
`scripts/attendance-survey-truncation-check.sh`, 7/7 assertions against
real Postgres + the real API:
1. A real 1,200-row single-employee `attendance_daily` fixture proves
   `confidence.ts` no longer truncates at 1,000 (mutation-tested above).
2. A real 60-employee "missing punches today" fixture proves `count: 60`
   (true total) alongside a 50-row capped display list and
   `truncated: true`.
3. A real cross-tenant ownership check: 104 real employee ids + 1
   foreign-tenant id placed at position 105 (past the first 100-id chunk
   boundary) — `POST /surveys/admin/:id/360/setup` still rejects it with
   `INVALID_EMPLOYEES`, proving the fails-closed check isn't blind to a
   later chunk.

**Query-error-path evidence, added this round, not present in the first
pass**: every chunk loop and `fetchAllRows()` call added across all 26
fixed call sites now explicitly checks and surfaces its error (via
`serverError()` in route handlers, `throw` in lib functions with an
existing safety net) instead of silently proceeding with a partial
result — this was a real gap in the first pass, where most chunk loops
discarded `error` entirely (matching a pre-existing, widespread convention
in this codebase, not something newly introduced, but still worth closing
for the code this round touched). New mock-level regression test,
`surveys/__tests__/trigger-lifecycle-ownership-chunking.test.ts` (3 tests):
proves (a) 150 valid ids across 2 chunks are all accepted, (b) a
foreign-tenant id in the second chunk is still rejected, and (c) a chunk
query that errors (not just "no match") surfaces as `500`, never silently
treated as `INVALID_EMPLOYEES`.

Full verification after all 26 fixes plus the error-handling hardening:
`tsc --noEmit` clean, `vitest run` 41 files / 334 tests pass (40/331 → 41/334:
the new surveys chunking test) — zero regressions. Real-stack scripts
re-run clean after this round: `g13-reconciliation-check.sh` (21/21),
`finalized-slip-value-lockdown-check.sh` (5/5),
`validation-rules-tenant-override-check.sh` (13/13),
`attendance-survey-truncation-check.sh` (7/7).

**Result: zero open CONFIRMED_DEFECT rows remain in either
`check-unbounded-queries.mjs` or `check-tenant-isolation.mjs`'s findings**
(the tenant-isolation 3 were closed by the `payroll_validation_rules`
change above). `ADD-004` (checker fingerprint instability) remains
correctly open — its migration is prepared and tested, not yet defaulted,
per the standing sign-off requirement.

### Phase 3 — Repair release checks: PARTIAL
- `check-schema-drift.mjs`: **ran successfully** — `sudo -u postgres node
  scripts/db/check-schema-drift.mjs` → `✓ No schema drift: every referenced
  column exists.` (478 tables). The earlier "could not be run — Postgres not
  running" note in an prior version of this document was wrong: Postgres
  was simply never started this pass (`service postgresql start`) and the
  script needs to run as the `postgres` OS user (peer auth), not `root`.
  Corrected here rather than left standing.
- `check-tenant-isolation.mjs --ratchet` / `check-unbounded-queries.mjs --ratchet`:
  both **already exit 1 at clean HEAD**, before any change in this pass —
  verified via `git stash`. Root cause identified and reproduced exactly (see
  EVIDENCE.md): both scripts key findings as `` `${file}:${line}:${table}` ``,
  which is not stable under unrelated edits to the same file. This is
  `ADD-004` in `FINDINGS.csv`.
  **Replacement fingerprint implemented and tested, not yet made the
  default**: `scripts/lib/finding-fingerprint.mjs` (`stableFingerprint()`)
  plus `scripts/lib/__tests__/finding-fingerprint.test.mjs`, proving both
  required properties — moving code preserves identity, a genuinely new
  unsafe query still gets a different fingerprint and is still caught (see
  EVIDENCE.md §3). Both checkers now accept an opt-in `--stable-key` flag
  (default off) using it; CLI behavior with the flag omitted is unchanged
  (verified identical before/after the extraction refactor). **Not yet
  flipped to default** — doing so requires regenerating both baseline files
  under the new key scheme, which is an explicit one-time migration left for
  human sign-off, not bundled into this pass per the standing instruction
  not to regenerate baselines to hide findings.
  **The exception-preserving migration itself is now prepared and tested**
  (per the most recent instruction — "an opt-in fingerprint leaves the
  failing default CI behavior unresolved... prepare and test an
  exception-preserving migration, including duplicate-query detection"):
  `scripts/migrate-baseline-to-stable-keys.mjs`. It does **not** regenerate
  either baseline from a fresh scan (which would silently drop or add
  findings) — it traces every one of the 267 + 314 existing baseline
  entries forward to its current position in the codebase (exact-line match
  where possible, nearest-line-in-the-same-file-and-table where the line
  has drifted) and computes that entry's stable key from what it finds
  there. An earlier version of this script tried to find the exact
  historical git commit the baseline was generated from and diff key sets
  1:1 — tried, verified, and abandoned (not silently swapped out): it failed
  its own verification because the baseline's line numbers turn out to be
  stale relative to **every** commit in this repo's history, not just
  current HEAD (the anomalies.ts 141-vs-144 example in EVIDENCE.md §2 holds
  even at the commit the baseline file was itself committed in — it must
  have been generated from an uncommitted working-tree state at some point
  and never regenerated after).
  Run against this repo: **116 of 267** unbounded-queries entries resolved
  (3 exact-line, 113 line-drifted-but-unambiguous) and **242 of 314**
  tenant-isolation entries resolved (11 exact, 231 drifted); **151 and 72
  respectively are UNRESOLVED** (no current `.from(table)` call found
  anywhere in that file — plausibly fixed/removed/renamed, but not asserted
  as such; each is listed by name in the output, not silently counted
  either way) and need a human to reconcile before this can replace the
  live baseline. **Duplicate-query detection**: found and reported 3 + 8 = 11
  real collisions (two different baseline entries in the same file, same
  table, with byte-identical normalized query shape — e.g. a copy-pasted
  `.from('employees')...` chain repeated at two call sites in
  `routes/intelligence/index.ts`) where naively keying by snippet+table+file
  alone would have silently collapsed two distinct findings into one; this
  script reports each collision's full old-key list instead of merging it.
  Output: `scripts/unbounded-queries-baseline.stable-key.json`,
  `scripts/tenant-isolation-baseline.stable-key.json` — proposals only,
  verified internally consistent (`mapped + unresolved === original_count`
  for both files, checked directly), not wired into any checker default.
- Baselines: untouched, confirmed above (including after the checker
  refactor — `git diff --stat` on both baseline JSON files is empty).

### Phase 4 — Prove correctness: SUBSTANTIAL PROGRESS, one gate still genuinely blocked
- Regression tests: 11 new test files added this pass (7 pagination + 1
  stale-cleanup-chunking unit test + the 24Q/ECR/readiness set + the keyset-
  vs-offset concurrent-write proof), all mutation-verified (see
  EVIDENCE.md). Full suite: 40 files / 330 tests pass, `tsc --noEmit` clean.
- `check-schema-drift.mjs`: ran, clean (see Phase 3 — corrected from an
  earlier wrong "blocked" note).
- Release checks (`--ratchet`): both exit 1 for the pre-existing fingerprint
  reason (section 2 of EVIDENCE.md), not for a new regression introduced
  this pass (verified: the unbounded-queries finding count dropped 153→141
  across this pass's fixes; no new table/file this pass introduced a finding
  that wasn't already a line-shifted pre-existing one — spot-checked, not
  exhaustively re-verified for every one of the ~140 "new" entries).
- **Real Postgres read-back reconciliation**: Postgres, the PostgREST-shim
  gateway, and the real API were all brought up in this container this pass.
  `scripts/g13-reconciliation-check.sh` re-run twice (once per round of
  fixes): **21/21 assertions pass both times, cleanup confirmed.**
- **Real-scale pagination validation — ran, not blocked, extended to 2,200
  employees and to EPF+PTax, still not real Supabase**:
  `scripts/pagination-scale-check.sh` (new this pass, then extended) seeds
  2,200 employees + finalized slips in real Postgres and drives the real
  ESI, EPF, and PTax compute endpoints through the gateway, which enforces
  the same `MAX_ROWS=1000` real PostgREST does. **This found FOUR real,
  previously undetected bugs across two rounds** (the esi.ts/ptax.ts
  stale-cleanup DELETE, plus three more at the 2,200-employee scale — see
  EVIDENCE.md §6-7) that no vitest mock surfaced; all four fixed and
  re-verified: **15/15 assertions pass, independent SQL read-back confirms
  all 2,200 rows correct for all three statutory engines.** This is
  genuinely stronger evidence than mocks, and real bugs were found by it —
  but it is **still not real Supabase/PostgREST**: the gateway is a
  from-scratch reimplementation (see its own header comment), not the
  genuine article, and filing-pack.ts / the 35 remaining open defects were
  not exercised at this scale.
- **Real Supabase/PostgREST staging validation at 2,000+ employees**: **still
  BLOCKED, not passed.** This sandbox has no staging Supabase/PostgREST
  access — that gap is unchanged by the local-Postgres work above, which is
  a meaningfully stronger proxy, not a substitute, and 2,200 is a different
  (lower) bar than a genuine Supabase project. Reported as a blocker, not
  silently skipped or assumed-fine.

**New finding from the real-scale run — `ADD-005` (see FINDINGS.csv):**
`esi.ts` and `ptax.ts`'s stale-contribution-row cleanup built a single
`.not('employee_id', 'in', (id1,id2,...))` with every kept employee id for
the month encoded into one URL query parameter. At 1,200 employees that's a
~44,000-character filter value — the request died before reaching the
gateway at all (empty error, nothing in the gateway's own log), and the
whole compute call 500'd. **Fixed** (commit `88c60b5`): compute the actual
stale ids (existing rows minus kept, fetched with `fetchAllRows`) and delete
them in `.in()`-chunks of 100. This is a genuinely new class of defect this
pass's earlier work had not covered — a request-size failure on a DELETE's
exclusion filter, not a response-truncation risk on a SELECT, and not
something either static checker scans for (neither looks at `.delete()`
chains). Found ONLY by running against a real HTTP transport at scale;
caught by no unit test before this pass, now covered by both a mutation-
verified real-stack run and a dedicated vitest regression test.

### Phase 5 — Enterprise qualification: PARTIAL

**Done, local, not staging-dependent:** `scripts/concurrency-retry-check.sh`
(new this pass) fires two concurrent ESI-compute requests at the same
tenant+month against real Postgres, then a serial retry, and checks the
actual database state (not just the HTTP responses) after each: **7/7
assertions pass** — no duplicate rows from the race, correct totals, and a
retry is a true no-op (same row count, same sum). See EVIDENCE.md §7b.

**First real cross-role UAT journey, this round**: `scripts/cross-role-ess-payslip-uat.sh`
— real Postgres + real API + real auth gateway, **4 distinct authenticated
identities** (1 hr_admin, 3 employees), not a single-role endpoint check:
hr_admin finalizes a payroll run for 2 employees; each employee, logged in
as themselves, calls `GET /payroll/my-slips` and sees exactly their own
slip with their own figures — never a co-worker's; a third employee whose
only slip is still in a draft (unfinalized) run sees zero slips via ESS.
**7/7 assertions pass**, cleanup confirmed (had to extend the cleanup to
step `payroll_runs` off `'finalized'` before deleting — migration 263's
lockdown trigger blocks it otherwise, same fix pattern as this round's
other new scripts). This is one journey, not the full admin/HR/manager/
employee matrix — reported as a start, not completion.

**Still not attempted, reported as blocked rather than claimed passing:**
- The rest of the admin/HR/manager/employee journey matrix beyond the one
  ESS payslip-isolation journey above.
- Concurrency/retry testing on any endpoint besides ESI compute.
- Fault injection / mid-failure recovery (what happens if the process dies
  mid-chunk-loop, mid-upsert, etc.) — genuinely untested.
- Backup/restore drills — need an actual backup/restore mechanism and
  procedure to exercise, which is a staging/production-infrastructure
  concern, not something this sandbox's throwaway Postgres can stand in for.

## Tenant vs. global ownership — DECIDED AND IMPLEMENTED this pass

**Decision (made by the user as product owner, implemented here):** global
defaults, with tenant-specific overrides, resolved explicitly by rule code.
Tenant admins can never modify a platform default directly; they can create
their own override for a given `code`, which shadows the global row for
their tenant only. This closes both the 3 `runs.ts` tenant-isolation
findings and the separate `ADD-003` functional defect in
`validation-rules.ts` in the same change.

**What was built** (migration `439_payroll_validation_rules_tenant_override.sql`
+ `apps/api/src/lib/payroll-validation-rules.ts`):
- Replaced the old `UNIQUE(code)` constraint (which made it structurally
  impossible for any tenant to ever own a row sharing a global rule's code)
  with `UNIQUE NULLS NOT DISTINCT (tenant_id, code)` — exactly one global row
  per code, exactly one override per `(tenant_id, code)` for any tenant.
- Seeded the previously-missing `UNKNOWN_FAILURE` global default — the one
  `classifyFailureRuleCode()` fallback with no corresponding row, closing
  the specific gap the "possible isolation risk" finding was about.
- `fetchResolvedValidationRules(supabase, tenantId)`: fetches global rows
  and this tenant's own rows, merges by `code` with tenant rows shadowing
  global ones. Wired into all 3 `runs.ts` read sites that previously read
  `payroll_validation_rules` with no tenant scoping at all (blocker
  build, blocker-detail enrichment, retry-failed rebuild).
- `upsertTenantValidationRuleOverride(supabase, tenantId, code, patch)`:
  writes ONLY a tenant-owned override row (never the global row), cloning
  the global default's name/description/stage/remediation_route on first
  override so the new row is complete.
- `GET /payroll/validation-rules` now returns the resolved view (previously
  returned `[]` for every tenant — this was `ADD-003`: filtered by
  `tenant_id = req.tenantId` against a table where every seeded row has
  `tenant_id = NULL`, so it could never match anything).
- `PATCH /payroll/validation-rules/:id` → `PATCH /payroll/validation-rules/:code`
  (route param changed from a row id to the rule code, since the route now
  creates-or-updates an override rather than editing a specific row) —
  `PayrollValidation.tsx` updated to match, plus an "is_override" badge so
  HR admins can see which rules they've customized vs. inherited.
- **Real-stack proof, not just unit tests**: `scripts/validation-rules-tenant-override-check.sh`
  — real Postgres + real API, super_admin creates an override, hr_admin is
  rejected (403), the global row is independently confirmed untouched in
  the DB, the resolved GET reflects the override and tags `is_override:true`,
  PATCH for an unknown code 404s. **13/13 assertions pass**, cleanup
  confirmed. Full API test suite (`tsc --noEmit` + `vitest run`, 40 files /
  331 tests) still green after the change.

The `validation.ts` `/rules` CRUD feature (a genuinely separate concern —
`rule_code`/`category`/`is_active`/`threshold_config`, migration 105,
tenant-owned custom rules that were never ambiguous) was **not** touched;
it shares the same physical table but a disjoint column set and was already
correctly tenant-scoped end to end.

<details>
<summary>Original architectural-fork writeup (resolved above, kept for the record)</summary>

`payroll_validation_rules` (3 tenant-isolation findings in `runs.ts`, plus the
separate `ADD-003` functional defect in `validation-rules.ts`) sat on a real,
previously-unresolved architectural fork:

- Migration 105 created it tenant-scoped.
- Migration 143 redesigned it platform-level (global), seeded 11 rows with
  `tenant_id = NULL`.
- Migration 394 (a later, apparently-unaware blanket RLS sweep) re-added
  tenant-scoped write policies, contradicting 143.
- `runs.ts` reads it with no tenant filter (works, because 143's intent holds
  in the data).
- `validation-rules.ts` reads/writes it WITH a tenant filter (broken, because
  no row has a non-null `tenant_id` to match).
- `classifyFailureRuleCode()` has one return code, `UNKNOWN_FAILURE`, not
  claimed by any of the 11 seeded global rows — the one gap through which a
  hypothetical tenant-owned row (if one were ever created — nothing in the
  current codebase does, but the schema and migration-394 RLS policies don't
  structurally prevent it) could leak into another tenant's blocker
  enrichment. This is why the 3 `runs.ts` findings are classified
  **CONFIRMED DEFECT** in `FINDINGS.csv` — it is a possible isolation risk
  established by this gap, **not an observed leak**; no code path today
  actually creates such a row.

Two options were laid out here (make it fully global, vs. build real
per-tenant override support) without choosing between them. **Option (b) is
what was decided and built** — see the top of this section for the
implementation and its real-stack proof.

</details>

## What a human needs to do next

1. ~~Point this session at the real G01–G12 source document~~ — **done**:
   `COGNIXHR_PRODUCTION_READINESS_AUDIT_2026-09-27.md` recovered, G01–G13
   restored with real text. ~~Re-verify G02/G03/G04/G06/G09/G11~~ — **done
   this round**: all re-verified directly against current code (see the
   closure ledger above). ~~Fix and prove G01/G02/G03/G04/G06~~ — **done a
   later round**: all five are now FIXED, mutation-tested, and
   real-stack-validated (see the closure ledger above and EVIDENCE.md §9).
   G09/G11 remain confirmed-still-open (not in scope for that round).
   G10/G12 remain product-scope/infrastructure questions, not an
   engineering re-verification.
2. `payroll_validation_rules` / `UNKNOWN_FAILURE`: implemented this session
   per direction — global-default-with-tenant-override, resolved explicitly
   by rule code. See "Tenant vs. global ownership" below for what was built.
3. Confirm GitHub push access is restored when ready to push.
4. Provide (or provision) real staging Supabase/PostgREST access for the
   2,000+ employee validation gate — this cannot be done from this sandbox.
5. `scripts/*-baseline.stable-key.json`: a 12-entry spot-check across both
   files' `unresolved` lists this round found **every single one already
   fixed** in an earlier commit (chunked/paginated correctly — e.g.
   `filing-pack.ts`, `forecast.ts`, `overtime.ts`, `lifecycle-expiry.ts`,
   `context.ts`), same stale-register pattern found repeatedly throughout
   this engagement — NOT evidence of silent breakage. This is a 12-of-223
   sample, not a full audit — a human (or a future session) should extend
   this spot-check or do the full manual pass before treating the other
   ~211 as closed. One distinct sub-pattern: **29 of the 223** (`routes/payroll/index.ts`)
   are attributable to that file being split into `runs.ts`/`validation-rules.ts`/etc.
   in an earlier refactor (confirmed: it's now 57 lines, down from
   presumably thousands) — these need tracing to whichever file the code
   actually moved to, not a simple "still there or not" check in the
   original file. Resolve the 11 duplicate-query collisions, then decide
   whether to flip `--stable-key` to default and replace the live
   baselines with the reconciled result.
6. Extend `scripts/cross-role-ess-payslip-uat.sh` (new this round — one
   ESS payslip-isolation journey) into the fuller admin/HR/manager/employee
   journey matrix Phase 5 still calls for.
7. ~~Fix and prove G01, G02, G03, G04, G06~~ — **done**: see the closure
   ledger above and `EVIDENCE.md` §9 for the real-endpoint reproduction +
   mutation-testing evidence for each. **G13 relabeled** throughout this
   document and `FINDINGS.csv` from unqualified "FIXED" to "remediated
   locally; staging validation pending" — local real-stack validation
   (real Postgres + the hand-built PostgREST-shim gateway) is real
   evidence, but it is not the same claim as proof against genuine
   Supabase/PostgREST at scale, which remains item 4 above.
8. ~~A coverage-mapping table tying each of the individually-fixed
   unbounded-query findings (UNB-ids) to its specific supporting
   test/evidence, rather than one blanket claim from
   `attendance-survey-truncation-check.sh`~~ — **done**: `EVIDENCE.md` §10
   maps all 47 `FIXED` `UNB-*` rows individually into dedicated-test (11),
   real-stack-script (3, one of which — `UNB-150` — corrects an earlier
   "no dedicated test" mislabel), self-documented-uncovered (1), and
   generic-suite-only (32, honestly flagged as not individually verified)
   buckets. `FINDINGS.csv`'s `UNB-149`/`UNB-150` rows were corrected to
   credit the real coverage found.
9. ~~The COMPLETE reconciliation of all 223 baseline-migration "unresolved"
   entries (item 5 above was only a 12-entry sample)~~ — **done**:
   `EVIDENCE.md` §11, `scripts/reconcile-baselines.py`. All 223 (151
   unbounded-queries + 72 tenant-isolation) individually accounted for:
   163 resolved by a deterministic script matching current code against
   the real fetchAllRows()/tenant_id pattern, 31 read directly after the
   script couldn't resolve them (every one already fixed or never a
   defect at that drifted line), and the 29 `payroll/index.ts` entries
   traced to wherever the 2026 route-file split actually moved that code
   (all 12 split files checked by table name) — **zero genuine open
   defects found across all 223**. The frozen baseline files themselves
   are deliberately untouched (never-regenerate-to-hide-findings); this is
   a reconciliation report against them, not an edit to them. Whether to
   now regenerate the live baselines given this result is left to a human
   — not decided here.
10. ~~Cross-role UAT beyond the single ESS-payslip-isolation journey~~ —
    **done**: `scripts/cross-role-leave-approval-uat.sh` (new), 4 distinct
    real identities (Employee A, her manager, an unrelated manager, hr_admin)
    exercising the leave-request manager-approval workflow end to end,
    including an authorization boundary the payslip journey never touches —
    an unrelated manager's approval attempt is rejected 403 FORBIDDEN, only
    the employee's real manager can approve, the employee's own balance
    reflects the deduction, and hr_admin retains full visibility regardless
    of the manager chain. 7/7 against the real stack; see `EVIDENCE.md` §12.
11. Still open — not infrastructure/scope-blocked, just not reached this
    round: further journeys Phase 5's full admin/HR/manager/employee matrix
    still calls for (e.g. attendance regularisation approval, expense/
    reimbursement approval, compensation revision approval — the same
    manager-authorization-boundary pattern proven here, applied to each).
    G10 (infrastructure evidence) and G12 (product-scope decision) remain
    explicitly blocked, per the standing instruction that neither should
    stop the independent work above.
