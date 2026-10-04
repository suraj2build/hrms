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
| G01 | P0 | Leave accrual can report success while crediting nobody: all four `leave-jobs.ts` insert paths write `policy_rule_id`, but no migration ever added that column to `leave_accrual_ledger`. | **CONFIRMED STILL OPEN — re-verified this session against the real schema** (not just re-read from the audit). `SELECT column_name FROM information_schema.columns WHERE table_name='leave_accrual_ledger' AND column_name='policy_rule_id'` returns **zero rows** against a clean apply of all 438 current migrations. Traced the actual failure mode in `leave-jobs.ts:455-507`: the `leave_accrual_ledger` upsert fails (unknown column), the handler catches `ledErr`, logs it, pushes to an `errors` array, and returns `{ employees_processed: 0, total_days_credited: 0, ... }` — crediting is never attempted after a ledger-write failure. This matches the audit's described symptom. Not re-traced this session: whether the HTTP/job-run caller surfaces that `errors` array as a hard failure or masks it as "completed" (the audit's "misleading OK status" claim) — that part of the claim is carried forward as-is, not independently re-confirmed. **Out of scope to fix on this branch** (schema change + leave-engine code, unrelated to G13 numeric coercion) — flagging, not silently fixing. |
| G02 | P0 | An impossible LOP count can reduce pay to zero and still produce a finalizable slip; payroll warns but does not block. | Recovered, **not re-verified this session**. `payroll-engine.ts:444` still only emits a warning string ("LOP days exceed total working days — verify attendance data"), not re-traced further for whether a hard block was added since 27 Sep. |
| G03 | P0 | F&F approval does not require a fresh calculation; settlement engine selects the latest slip by month without a finalized-run condition. | Recovered, **not re-verified this session**. |
| G04 | P1 | Payroll maker/checker approval occurs before attendance closure/other finalize gates; a failed later gate leaves the approval consumed. | Recovered, **not re-verified this session**. |
| G05 | P1 | Clean database installation has an accepted failed migration: `016_lean_employees.sql` aborts and CI explicitly allows it via a `KNOWN_FAILING` allowlist. | **CORRECTED — RESOLVED, with current evidence, not just re-asserted.** `scripts/db/check-schema-drift.mjs`'s own `KNOWN_FAILING` set is now `new Set([])` — **empty** — with an inline comment recording that `016_lean_employees.sql` was investigated and found to apply cleanly end-to-end against a fresh database (its `DROP COLUMN manager_id` is preceded by `DROP POLICY IF EXISTS employees_manager_team`, so the abort theory in the original audit was itself based on a reading of the file that didn't hold up against actually running it). This session re-ran `check-schema-drift.mjs` against all 438 current migrations (Phase 3/4, above): **zero schema drift across 478 tables, no migration failure.** G05's clean-install risk, as described in the audit, is closed. This is the "corrected G05 finding" carried forward per the most recent instruction: the audit's original text is preserved above for the record, and the current, re-verified status supersedes it. |
| G06 | P1 | Statutory compliance report (`analytics/reports.ts`) diverges from payroll source of truth; prior UAT said "not fixed." | Recovered, **not re-verified this session**. |
| G07 | P1 | No evidence of a 2,000+ employee load/soak test; prove throughput under production-like PostgREST limits. | **Partial evidence from this session**, explicitly not a closure: `pagination-scale-check.sh` now exercises 2,200 employees across ESI/EPF/PTax against real Postgres through a from-scratch PostgREST-shim gateway (`/tmp/supabase-gateway.mjs`), not real Supabase/PostgREST. This is evidence toward G07, not proof of it — the audit's own bar is a genuine Supabase/PostgREST environment, which this sandbox cannot provide (see Phase 4/"still BLOCKED" below). |
| G08 | P1 | CI ratchets allow existing findings: 314 tenant-isolation and 267 unbounded-query static-check exceptions. | **Directly corroborated, not just cited**: the frozen baseline files (`scripts/tenant-isolation-baseline.json` / `scripts/unbounded-queries-baseline.json`, untouched this session) hold exactly `count: 314` and `count: 267` — matching the audit's own figures exactly, confirming the audit's snapshot and this repo's frozen baseline describe the same state. Live counts have since dropped (307 / 153, see Phase 1/EVIDENCE.md) through remediation in sessions before and during this engagement, but the frozen ratchet files were never regenerated to match (per the standing "never regenerate to hide findings" rule) — see Phase 3 for why the ratchet still exits 1 for an unrelated fingerprint-instability reason, not a new regression. |
| G09 | P1 | E2E is manual/weekly, not a PR gate; payroll suite mostly checks page content. | Recovered, **not re-verified this session**. |
| G10 | P1 | Backup, restore, PITR, RPO/RTO, secret rotation, rollback, incident response cannot be certified from repo files. | Recovered. **Still BLOCKED** — unchanged, this sandbox has no staging/production infrastructure to exercise any of this. |
| G11 | P2 | Profile cache retains role/tenant/employee mapping up to 5 minutes; `is_active` rechecked at most every 60s — no measured access-revocation SLA. | Recovered, **not re-verified this session**. |
| G12 | P2 | Standalone leave encashment has no employee request UI; mark-paid only changes status, no proven disbursement path. Scope question, not just a bug. | Recovered, **not re-verified this session**. Needs a product scoping decision (is this in the first customer's scope?), not just an engineering fix. |
| G13 | P1 | Repeated payroll defects share a DB NUMERIC/DECIMAL-as-string coercion failure mode (`Number()` missing at the data boundary). | **This is the subject of the entire branch.** See `FINDINGS.csv` row 1 and the rest of this document — fixed, mutation-tested, real-stack-validated for the clusters covered this engagement. Real-scale PostgREST validation (genuine Supabase, not the gateway) remains the one still-open release gate for G13 specifically, same as the rest of this document's "still BLOCKED" items. |

**What remains genuinely unresolved:** G02, G03, G04, G06, G09, G11 are
carried forward from the audit text verbatim and have **not** been
re-verified against current code this session — they are restored to the
register as real, open findings (not fabricated, not invalidated), but this
pass did not re-check whether the underlying code still matches the audit's
description. G10 and G12 are explicitly scope/infrastructure questions, not
re-verified either. Only G01, G05, G07, G08, and G13 have current-session
verification behind the status shown above.

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

**Not started** (remaining confirmed defects, see `FINDINGS.csv` `status=OPEN`):
- **28** (not 35 — see reconciliation above) other
  `check-unbounded-queries.mjs` confirmed defects, grouped by theme in
  `master-register.md`'s section A3 (enrichment-lookup-reuses-id-list ×15,
  genuinely-unbounded-scan ×7, caller-controlled-range ×3, recursive-subtree
  ×1, unchunked-sibling ×2, fails-closed-array ×3, narrow-occurrence ×1 —
  see FINDINGS.csv for the exact rows).

**Fixed this round, not "not started":**
- The 3 tenant-isolation confirmed defects (`payroll_validation_rules` in
  `runs.ts`) and `ADD-003` (the `validation-rules.ts` admin feature, broken
  for every tenant) — both closed by the same change, see "Tenant vs.
  global ownership" below for the decision and its real-stack proof.

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

**Still not attempted, reported as blocked rather than claimed passing:**
- End-to-end UAT across admin/HR/manager/employee roles as actual user
  journeys (the concurrency check above drives one endpoint, not a journey).
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

1. ~~Point this session at the real G01–G12 source document~~ — **done this
   session**: `COGNIXHR_PRODUCTION_READINESS_AUDIT_2026-09-27.md` recovered,
   G01–G13 restored to the register above. What's still needed: G02, G03,
   G04, G06, G09, G11 have not been re-verified against current code (only
   G01/G05/G07/G08/G13 have); and G10/G12 need a product scoping decision,
   not an engineering fix.
2. `payroll_validation_rules` / `UNKNOWN_FAILURE`: implemented this session
   per direction — global-default-with-tenant-override, resolved explicitly
   by rule code. See "Tenant vs. global ownership" below for what was built.
3. Confirm GitHub push access is restored when ready to push.
4. Provide (or provision) real staging Supabase/PostgREST access for the
   2,000+ employee validation gate — this cannot be done from this sandbox.
5. Review `scripts/*-baseline.stable-key.json` (new this session — see
   Phase 3): reconcile the 151 + 72 `unresolved` entries by hand (confirm
   each is genuinely fixed/removed, or find where it moved to), resolve the
   11 duplicate-query collisions, then decide whether to flip `--stable-key`
   to default and replace the live baselines with the reconciled result.
