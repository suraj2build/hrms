# CognixHR Production-Readiness Remediation — STATUS

**NO-GO stands.** This document is evidence for a future review, not a release
sign-off. Nothing here should be read as GO.

## Source of truth (as of this commit)

- **Branch:** `fix/g13-numeric-coercion-sweep`
- **HEAD:** `88c60b5bdb03027673ec2d764a211b7881d3acd3`
- **Remote:** `origin` = `https://github.com/suraj2build/hrms` — this branch has
  **0 commits pushed**; `origin/fix/g13-numeric-coercion-sweep` does not exist yet.
- **Working tree:** clean (no uncommitted changes) as of this commit.
- **Unpushed commits:** 15, measured as `git log --oneline main..HEAD` (the
  correct base — this branch's divergence point from local `main`, not an
  arbitrary earlier point in this conversation). The 7 most recent, from this
  remediation pass — `f3e4ca4`, `f1fc6d4`, `699e7c9`, `c20669d`, `c782c36`,
  `0bbeb3a`, `88c60b5` — are the ones with evidence in EVIDENCE.md.
- **Push status:** paused per standing instruction — GitHub App access for
  this session has repeatedly 403'd ("Claude doesn't have GitHub access to
  suraj2build/hrms for your organization"). Do not retry until the user
  explicitly confirms access is restored. All work in this pass is local-only.
- **PR #29:** unmerged, draft. Must stay that way until a fresh review, not
  this document, clears it.
- **Baselines:** `scripts/tenant-isolation-baseline.json` and
  `scripts/unbounded-queries-baseline.json` are **untouched** — verified via
  `git diff --stat` on both, zero changes, no `--save-baseline` ever run this
  session.

## What "G01–G13" means here (read this before trusting any G-numbered row)

The instruction to "commit the complete finding register: original G01–G13"
assumes a document with that numbering exists. It does not, in this repo, as
a committed artifact: `grep -rl "G01\|G13\|RC-G5"` across every `.md` file in
the repository returns **nothing**. "G13" (numeric coercion) and "G05-adjacent
/ RC-G5-01" (unbounded queries) are labels that came from this conversation's
own prior-session history, not from a file anyone else can open.

The repository's own committed audit, `SYSCERT_AUDIT_2026-08-02.md`, uses a
**different** scheme entirely — C1–C9 (critical) plus High/Medium/Low — and
was not re-verified this session. Some of its items are thematically close to
this session's work (its **C6**, "statutory compliance GET/export endpoints
unpaginated," is the same failure class as this session's entire A1/A2
pagination fix; its **C8**, unbatched leave-accrual loops, is unrelated). No
mapping between "G01–G12" and "C1–C9" has been verified — `FINDINGS.csv`
marks G01–G12 as `OUT_OF_SCOPE_THIS_SESSION` / `NOT_RE_VERIFIED` rather than
asserting a correspondence that hasn't been checked. G13 itself (numeric
coercion) is real, fixed in prior commits on this branch, and detailed in
`FINDINGS.csv`.

**Action needed from a human:** point this session (or the next one) at
whatever document actually defines G01–G12, or confirm there isn't one and
C1–C9 is the real list. Until then, "all G01–G13 findings closed" cannot be
asserted and this document does not assert it.

## Phase status

### Phase 1 — Source of truth: PARTIAL
- HEAD/branch/working-tree/unpushed-commits: done, above.
- Complete finding register: done for tenant-isolation (307) and
  unbounded-queries (153) — reconciled exactly against the checkers' own
  current output, not agent self-reported counts. G13: done. **G01–G12: not
  done** — no source document identified (see above).
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

**Not started** (remaining confirmed defects, see `FINDINGS.csv` `status=OPEN`):
- 35 other `check-unbounded-queries.mjs` confirmed defects, grouped by theme
  in `master-register.md`'s section A3 (enrichment-lookup-reuses-id-list ×15,
  genuinely-unbounded-scan ×8, caller-controlled-range ×3, recursive-subtree
  ×1, unchunked-sibling ×2, fails-closed-array ×3, narrow-occurrence ×1 — the
  count here is pre-fix; see FINDINGS.csv for which exact rows remain).
- 3 tenant-isolation confirmed defects (`payroll_validation_rules` in
  `runs.ts`) — **explicitly not fixed**, see "Tenant vs. global ownership"
  below. Not silently resolved either way.
- `ADD-003`: the `payroll/validation-rules.ts` admin feature (separate from
  the above — this is the *consumer* of the table being broken for every
  tenant) — also blocked on the same ownership decision.

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
- Baselines: untouched, confirmed above (including after the checker
  refactor — `git diff --stat` on both baseline JSON files is empty).

### Phase 4 — Prove correctness: SUBSTANTIAL PROGRESS, one gate still genuinely blocked
- Regression tests: 9 new tests added this pass (7 pagination + 1 stale-
  cleanup-chunking unit test + the 24Q/ECR/readiness set), all
  mutation-verified (see EVIDENCE.md). Full suite: 39 files / 326 tests pass,
  `tsc --noEmit` clean.
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
  `scripts/g13-reconciliation-check.sh` re-run: **21/21 assertions pass,
  cleanup confirmed.**
- **Real-scale pagination validation — ran, not blocked, but not real
  Supabase**: `scripts/pagination-scale-check.sh` (new this pass) seeds
  1,200 employees + finalized slips in real Postgres and drives the real ESI
  compute endpoint through the gateway, which enforces the same
  `MAX_ROWS=1000` real PostgREST does. **This run found a real, previously
  undetected bug** (below) that no vitest mock surfaced, fixed it, and
  re-ran clean: 6/6 assertions, independent SQL read-back confirms all 1,200
  rows correct. This is genuinely stronger evidence than mocks — but it is
  **still not real Supabase/PostgREST**: the gateway is a from-scratch
  reimplementation (see its own header comment), not the genuine article,
  and this was done for ESI only, not EPF/PTax/filing-pack/the 35 remaining
  open defects, and not at 2,000+ scale (1,200 was enough to exceed the
  1,000-row cap and did not need to go further).
- **Real Supabase/PostgREST staging validation at 2,000+ employees**: **still
  BLOCKED, not passed.** This sandbox has no staging Supabase/PostgREST
  access — that gap is unchanged by the local-Postgres work above, which is
  a meaningfully stronger proxy, not a substitute. Reported as a blocker,
  not silently skipped or assumed-fine.

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

### Phase 5 — Enterprise qualification: BLOCKED, not started
End-to-end UAT (admin/HR/manager/employee), concurrency/retry/failure-recovery
testing, and backup/restore drills all require a running staging environment
this sandbox does not have. **Not attempted — reporting this honestly as
blocked, not claiming it passed.**

## Tenant vs. global ownership — the one decision this pass deliberately did NOT make

`payroll_validation_rules` (3 tenant-isolation findings in `runs.ts`, plus the
separate `ADD-003` functional defect in `validation-rules.ts`) sits on a real,
unresolved architectural fork:

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

**Two options, not chosen for you:**

**(a) Make it fully global.** Drop the tenant filter from
`validation-rules.ts` (matching `runs.ts`'s actual working behavior and
migration 143's stated intent). Revert migration 394's tenant-scoped RLS
write policies on this table back to platform-admin-only. Simplest, matches
current data, but removes any possibility of a tenant ever overriding a rule.

**(b) Build real per-tenant override support.** Change the uniqueness model
so a tenant CAN own a row with the same `code` as a global default (e.g.
`UNIQUE(COALESCE(tenant_id, '00000000-...'), code)` or an explicit
`is_tenant_override` flag), give `validation-rules.ts` a real write path that
creates an override instead of trying to `UPDATE` the global row, and decide
precedence (does a tenant override shadow the global rule, or merge with it?
What happens to `UNKNOWN_FAILURE` specifically — does it get its own global
seed row to close the gap outright, regardless of which option is picked?).

**Either way:** a defensive tenant filter (e.g.
`.or('tenant_id.is.null,tenant_id.eq.' + tenantId)`) was considered and
explicitly NOT applied this pass, because filtering by tenant alone — without
first deciding (a) vs (b) — risks hiding the legitimate global default rules
`runs.ts` depends on if applied inconsistently between the two files. This
needs the product decision above first, batched with the `UNKNOWN_FAILURE`
seed-row question, not three separate micro-decisions.

## What a human needs to do next

1. Point this session at the real G01–G12 source document (or confirm there
   isn't one).
2. Decide (a) vs (b) above for `payroll_validation_rules` / `UNKNOWN_FAILURE`.
3. Confirm GitHub push access is restored when ready to push these 10 local
   commits.
4. Provide (or provision) real staging Supabase/PostgREST access for the
   2,000+ employee validation gate — this cannot be done from this sandbox.
