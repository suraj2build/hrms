# CognixHR Production-Readiness — Final Qualification Report

**Branch:** `fix/g13-numeric-coercion-sweep` (PR #29, `suraj2build/hrms`)
**HEAD at report time:** `c622a08ce2d946d14d08eaeb51ba458a63f500b8`
**Ahead of `origin/main`:** 62 commits (0 behind)
**Unpushed vs `origin/fix/g13-numeric-coercion-sweep`:** 0 commits — **pushed**
**PR #29 state:** open, **draft**, not merged, base `main` — unchanged this round
**Push status:** done. Pushed `0d798014..4d8b006b` then `4d8b006b..c622a08c`. Real CI ran on `4d8b006b` (6 of 7 checks green, same E2E gap) and on `c622a08c` via manual dispatch (see §4, Gate 1 — this round fixed a correctness bug in the verifier itself and confirmed the current actual secrets state directly from the job log, not from an unverified claim).

This report is the single source of truth for "what is actually true right
now." Where it disagrees with an earlier narrative elsewhere in this
directory, this document is newer and wins — but nothing here was produced
by regenerating a baseline or deleting evidence; every claim below cites the
script/commit that backs it.

**Revision note:** the first version of this report said "one hard blocker
left," which understated what's actually outstanding. This revision corrects
that: §4 below lists four standing release gates, none of them satisfied yet,
exactly as named in review feedback — not a single blocker with everything
else downgraded to a footnote. It also corrects an accounting error from the
first version: the G08 fix-sweep's "96 findings... fixed or
justified-suppressed" blurred two different things together. The real,
register-backed split (`g08-sweep-findings-register.csv`, built from the
actual commit diff, not from memory) is **39 true positives genuinely
repaired** and **59 false positives justified and suppressed — not repairs,
not counted toward anything "fixed."** The exact mechanism for 96→98 (two
specific lines whose fingerprint changed register when their *other*
register's gap was fixed — `EVIDENCE.md`'s new subsection) and an
independent spot-verification of 7 of the 59 suppressions against the
actual code/migrations (zero overturned) are both now documented rather
than asserted.

---

## 1. What this round closed

Continuing the standing engagement (G01–G13 individual findings, the 223-row
baseline reconciliation, cross-role UAT), this round's explicit mandate was:
close the remaining financial-semantics gaps a review flagged as
insufficient, complete the release-check migration, broaden UAT, run local
load/recovery tests, and report G07–G09/G11 status. Completed in full:

| Item | Status | Evidence |
|---|---|---|
| G02 (excessive LOP) correction | **FIXED** — blocks by default, override persisted | `scripts/g02-lop-exceeds-working-days-check.sh`, 19/19 |
| G03 (F&F staleness) correction + extension | **FIXED** — now covers salary basis AND gratuity/leave-encashment/notice | `scripts/g03-fnf-settlement-last-finalized-slip-check.sh`, 12/12 |
| G04 (maker-checker ordering) correction | **FIXED** — commit moved to after Step 2's atomic seal; downstream failure/retry/concurrency tested | `scripts/g04-maker-checker-approval-ordering-check.sh`, 22/22 |
| G06 (statutory report) frontend wiring | **FIXED** — real browser verification | `scripts/g06-statutory-report-real-contributions-check.sh`, 6/6 |
| G08 (ratchet mechanism) | **FIXED** — stable-key migration complete; of 98 surfaced findings, 39 genuinely repaired + 59 justified-suppressed (not repairs) | both ratchets, 0 new findings; register: `g08-sweep-findings-register.csv` |
| G09 (E2E not a PR gate) | **FIXED** | `e2e.yml` + `05-payroll.spec.ts` |
| G11 (revocation latency) | **FIXED, measured** | `scripts/g11-access-revocation-latency-check.sh`, 9/9 |
| Full financial-chain reconciliation | **Done** — one real bug found (PTax) and fixed | `scripts/ptax-filing-slip-reconciliation-check.sh`, 2/2 |
| Broader UAT (3rd journey) | **Done** — reimbursement-claim approval | `scripts/cross-role-reimbursement-approval-uat.sh`, 13/13 |
| Local load/scale test | **Re-confirmed at 2,200 employees** | `scripts/pagination-scale-check.sh`, 15/15 |
| Local concurrency/retry test | **Re-confirmed** | `scripts/concurrency-retry-check.sh`, 7/7 |
| Local backup/restore rehearsal | **New, done** | `scripts/backup-restore-rehearsal-check.sh`, 18/18 |
| Real PostgREST / real Supabase validation | **Still blocked** — infrastructure access this sandbox cannot provide | unchanged |

---

## 2. Complete real-stack check results

Every script below drives the real Fastify API against real Postgres
through the real auth gateway — not mocks, not direct DB writes to the
workflow state under test. All 16 were re-run clean, in sequence, against
the same HEAD as this report, immediately before this report was written.

| Script | Assertions | Result |
|---|---|---|
| `g01-leave-accrual-ledger-check.sh` | 4 | ✅ 4/4 |
| `g02-lop-exceeds-working-days-check.sh` | 19 | ✅ 19/19 |
| `g03-fnf-settlement-last-finalized-slip-check.sh` | 12 | ✅ 12/12 |
| `g04-maker-checker-approval-ordering-check.sh` | 22 | ✅ 22/22 |
| `g06-statutory-report-real-contributions-check.sh` | 6 | ✅ 6/6 |
| `g11-access-revocation-latency-check.sh` | 9 | ✅ 9/9 |
| `g13-reconciliation-check.sh` | 21 | ✅ 21/21 |
| `finalized-slip-value-lockdown-check.sh` | 5 | ✅ 5/5 |
| `validation-rules-tenant-override-check.sh` | 13 | ✅ 13/13 |
| `attendance-survey-truncation-check.sh` | 7 | ✅ 7/7 |
| `cross-role-ess-payslip-uat.sh` | 7 | ✅ 7/7 |
| `cross-role-leave-approval-uat.sh` | 7 | ✅ 7/7 |
| `cross-role-reimbursement-approval-uat.sh` | 13 | ✅ 13/13 |
| `ptax-filing-slip-reconciliation-check.sh` | 2 | ✅ 2/2 |
| `concurrency-retry-check.sh` | 7 | ✅ 7/7 |
| `pagination-scale-check.sh` | 15 | ✅ 15/15 |
| **Total** | **169** | **✅ 169/169** |

Plus, unit/type level:
- `cd apps/api && npx tsc --noEmit` — clean.
- `cd apps/api && npx vitest run` — **41 files / 334 tests passing**.
- `node scripts/check-unbounded-queries.mjs --ratchet` — **0 new findings** (stable-key).
- `node scripts/check-tenant-isolation.mjs --ratchet` — **0 new findings** (stable-key).

Every fix landing in this round was mutation-tested (revert → confirm RED
against the real stack → restore → confirm GREEN) before being counted as
closed; see the individual commit messages and EVIDENCE.md for each
before/after pair.

---

## 3. Workflow / journey coverage

**Cross-role UAT (3 journeys, 12 distinct real identities across them, all
through real HTTP endpoints — not direct DB manipulation of the workflow
under test):**
1. ESS payslip isolation (hr_admin + employee self-service) — `cross-role-ess-payslip-uat.sh`.
2. Leave-request manager approval (employee + 2 managers + hr_admin; tests `validateApprover()`'s direct manager_id scoping) — `cross-role-leave-approval-uat.sh`.
3. Reimbursement-claim approval (5 identities incl. cross-tenant; tests the independent `gateApprove()`/`isSelfApproval()` authorization path, a different mechanism from #2) — `cross-role-reimbursement-approval-uat.sh`.

**Financial-chain reconciliation**, traced end to end: leave → payroll →
TDS/EPF/ESI/PTax → arrears/advances/reimbursements → leave encashment → F&F
→ accounting ledger → filing pack. EPF/ESI/TDS/accounting were already
"slip is source of truth" (closing the exact G06 failure mode at each
stage); PTax was not — found and fixed this round (§1).

**Scale / concurrency / recovery:**
- 2,200 employees, ESI+EPF+PTax compute, independent SQL read-back (not
  just the API's own claim) confirming zero truncation signature.
- 2 concurrent + 1 serial retry of the same ESI compute request — idempotent, not corrupted.
- G04's own script separately covers concurrent/duplicate finalize-approve
  calls and a downstream-failure-then-retry sequence for payroll finalize specifically.
- Local Postgres backup (`pg_dump -Fc`, 4.6s/3.5MB) → restore into a fresh
  DB (7.8s) → independently verified: every sampled table's row count AND
  a full content checksum of `payroll_slips` match exactly.

**Not covered / explicitly out of scope for a local sandbox:** a true
multi-instance *production* deployment behind a load balancer (G11 was
measured across 2 local instances, not N); "background jobs" under
interrupted-process conditions (kill -9 mid-write) — the maker-checker
downstream-failure test (G04 §6/§7) is the closest real analogue reproduced
without actually killing a process.

---

## 4. Four standing release gates — none satisfied yet

These are explicit, named release gates. Local remediation being
substantially complete does not close any of them; each needs its own
distinct action, and none of them are optional caution.

**Gate 1 — Push the commits and pass real CI on the exact release
candidate.** Status: **partially done; the verifier itself had four real
defects, caught by review before any secret had ever made it fire — all
four now fixed and independently re-tested.**

Pushed and ran real CI on `4d8b006b`: **6 of 7 checks passed** — Schema
drift, Data correctness ratchet (RC-G5-01), Tenant isolation ratchet,
Typecheck & tests, Error hygiene ratchet, Vercel Preview Comments —
directly validating this round's fixes against real infrastructure, not
just this sandbox. **End-to-End Lifecycle Tests failed**, root-caused via
the actual job log: all required secrets are unset. This is not a
regression from this PR — every prior run of this workflow (9 of 9,
`schedule`-triggered on `main`, back to 2026-08-10) failed identically;
it's been silently red for two months, and this PR's own G09 fix
(`pull_request` trigger) is what made it visible for the first time.

The next review correctly identified that the candidate-verification
infrastructure built in `0d798014` had not actually been exercised against
real secrets yet, and found four concrete gaps in it before it could be
trusted as qualification evidence. All four are fixed in `c622a08c`, with
direct (not just reasoned-through) re-verification for each:

1. **Wrong target commit.** `EXPECTED_SHA` was `github.sha`, which on a
   `pull_request` run is GitHub's ephemeral `refs/pull/N/merge` commit —
   confirmed concretely from this PR's own CI run (job `37339052239`):
   `github.sha` there was `18362fd5...`, a merge commit that exists on no
   branch Vercel/Railway ever deploy, while the PR's real head was
   `4d8b006b`. Even a staging environment correctly deployed at the exact
   candidate commit would have been reported as a mismatch. Fixed: use
   `github.event.pull_request.head.sha` (falls back to `github.sha` for
   `workflow_dispatch`/`schedule` runs on a real branch, where it IS the
   deployed commit).
2. **DB check was optional and latest-only.** Fixed: `STAGING_PG*` secrets
   are now required (fails the job the same as a missing URL does, not a
   silent skip), and the check now walks every file in
   `supabase/migrations/` and reports exactly which are missing from
   `supabase_migrations.schema_migrations`, not just whether the latest
   one is present — a DB with migration 441 applied but missing 250 now
   fails instead of passing.
3. **Missing secrets don't prove staging doesn't exist — so that claim was
   checked, not assumed.** Re-ran the workflow manually
   (`workflow_dispatch`, run `37351301793`, on this HEAD `c622a08c`) to get
   a direct answer instead of relying on an unverified statement either
   way. The job log shows, byte for byte: **all nine required secrets are
   currently empty** — `E2E_BASE_URL`, `E2E_API_URL`, `E2E_HR_EMAIL`,
   `E2E_HR_PASS`, `STAGING_PGHOST`, `STAGING_PGPORT`, `STAGING_PGUSER`,
   `STAGING_PGPASSWORD`, `STAGING_PGDATABASE` (`[ -z "" ]` evaluated true
   for every one of them). If `E2E_BASE_URL` was set on this repository at
   some point, it is not set now, as of 2026-10-05T17:49Z — this needs
   reconciling with whoever expected it to already be configured, not
   assumed either way from here.
4. **The local DB-check test only proved the script's own SQL, not real
   Supabase compatibility.** Re-tested against a table a real
   `supabase db push --db-url` run actually populated (not a hand-built
   fixture): confirmed `schema_migrations.version` is the exact
   zero-padded numeric prefix and `.name` excludes it, tightened the query
   from a `LIKE`-prefix match to exact equality on `version` (a prefix
   match could wrongly treat "25" as satisfied by version "250"), and
   confirmed both directions — a deleted mid-history row (441 present, 250
   missing) correctly fails; full history correctly passes. (Applying all
   437 migrations end-to-end via the real CLI was not possible in this
   sandbox — most reference `auth.users`, which only exists under the full
   Supabase stack, which needs Docker, which this sandbox's container
   can't run — but that limitation is irrelevant to what was being
   verified: the tracking table's real shape and the query's correctness
   against it, both confirmed.)

A fifth, independently raised gap — that matching web and API SHAs do not
prove the web app actually calls the API that was checked — is also closed
in `c622a08c`: `write-build-info.mjs` now records the build-time
`VITE_API_URL` in `version.json`, and the verifier's new check 3 fails if
that recorded value doesn't match the `API_URL` under test. Verified with
a deliberate fixture: both SHAs matching while the web build points at a
different API host correctly fails; a consistent fixture correctly passes.

**Still blocked on an administrator**, not on anything further I can do
unilaterally: adding the nine secrets above requires GitHub repo-admin
access my GitHub App permissions don't expose as a tool, and confirming
what environment those URLs should actually point at (a dedicated staging
deployment of this exact candidate, with its migrations applied — not a
shared "alpha" environment that may not reflect this PR) is an infra
decision, not a code one. The verifier is now ready to actually validate
that deployment the moment it exists; it has not been able to do so yet,
because the secrets it needs have never been present when it ran.

**Gate 2 — Validate against actual Supabase/PostgREST**: migrations, RLS,
authentication, pagination, and financial reconciliation at 2,200+
employees. Status: **not done.** Every real-stack script in this entire
engagement (§2's 169 assertions, the 2,200-employee pagination test, the
PTax reconciliation fix) runs against this sandbox's own Postgres plus a
hand-built PostgREST-compatible gateway (`/tmp/supabase-gateway.mjs`), not
genuine managed Supabase. That gateway faithfully reproduces the specific
behavior this engagement cares about (`max-rows=1000`, NUMERIC-as-string)
but has never been checked against the real service's actual RLS
enforcement, auth token validation, or wire behavior at scale. This
sandbox has no network path to a real Supabase project — it cannot be
closed by any amount of further local work, only by running this same
battery (or the equivalent) against a real staging project.

**Gate 3 — Production qualification**: representative concurrent-user
load and managed backup/restore evidence. Status: **not done — distinct
risk from what's covered.** This round's `pagination-scale-check.sh`
(2,200 employees) and `concurrency-retry-check.sh` (2 concurrent requests)
prove data-volume and narrow-concurrency correctness, not production-scale
concurrent-user load (many simultaneous distinct users/sessions hitting
the API together) or Supabase's own managed backup/restore/PITR tooling.
`backup-restore-rehearsal-check.sh` proves the *data* survives a local
`pg_dump`/`pg_restore` cycle with integrity (18/18, row+checksum verified)
— it does not exercise Supabase's operational recovery path at all. Both
need a real staging environment.

**Gate 4 — Resolve G12 scope**: complete standalone leave encashment, or
explicitly exclude and disable it for launch. Status: **not done — this
is a decision only the product owner can make, not something to default
on.** The two concrete paths:
  - *Complete it*: build the missing employee-initiated request UI and a
    proven disbursement path (currently "mark paid" only flips a status
    column with no verified payment execution behind it) — a real feature
    build, not a quick fix, and needs product requirements this report
    cannot supply on its own.
  - *Explicitly disable it*: feature-flag or remove the standalone
    encashment entry points for this launch, with that exclusion stated
    in release notes/scope docs, not left ambiguous.
  Neither has been chosen yet. **I have not picked one unilaterally** — if
  you want the "disable" path executed, that's a bounded engineering task
  I can do on explicit instruction; the "complete it" path needs product
  requirements first.

None of the four gates are closed by this round's local work, and none of
them can be closed by more local work of the same kind — each needs either
external access (Gates 1–3) or an explicit decision (Gate 4).

---

## 5. GO / NO-GO recommendation

**NO-GO for production launch. Unchanged verdict. All four gates in §4
remain open — this is not "one hard blocker," it is four, and none of
them are fully satisfied yet.**

What this round actually changed: the financial-semantics gaps a review
correctly identified as insufficient (G02/G03/G04 corrections) are closed
and mutation-tested; G08's ratchet mechanism is fixed with every surfaced
finding individually accounted for (39 repaired, 59 justified-suppressed
— see §1 revision note); G09's CI gate and G11's revocation SLA are fixed
and measured; a real financial-chain reconciliation bug (PTax filing
drift) was found and fixed, not just asserted absent; UAT coverage
broadened to a third, structurally different authorization path; local
load, concurrency, and backup/restore are all green at the scale this
sandbox can produce; **the branch is now actually pushed and has run real
CI** — 6 of 7 checks pass on real infrastructure, and the one failure
(E2E) was root-caused to a pre-existing, two-month-old credentials gap,
not a regression. The candidate-verification infrastructure built to gate
E2E on the right deployment was itself found to have four real defects on
review — a merge-SHA bug that would have falsely rejected a correctly
deployed candidate, an optional/latest-only DB check, an unverified "no
staging exists" claim, and a fixture that tested the script but not real
Supabase — all four fixed and re-verified this round (§4, Gate 1), plus a
fifth check added (web↔API wiring) that two independently-matching SHAs
do not by themselves prove. A direct re-run (`workflow_dispatch`, not
inference) confirms the actual current state: all nine required secrets
are unset. This is real, substantiated progress against Gate 1
specifically — the verifier is now trustworthy once a staging environment
exists — but it still does not satisfy Gates 2–4, and does not move the
verdict.

**Recommended path, in order:** (1) an administrator adds
`E2E_BASE_URL`/`E2E_API_URL`/`E2E_HR_EMAIL`/`E2E_HR_PASS`/`STAGING_PGHOST`/
`STAGING_PGPORT`/`STAGING_PGUSER`/`STAGING_PGPASSWORD`/`STAGING_PGDATABASE`
as real repository secrets, pointed at a dedicated staging deployment
actually running this exact candidate's web+API+migrations — not a shared
"alpha" environment, and confirms the PR head SHA (not a merge SHA) is
what's deployed; (2) re-run the E2E job and confirm all 7 checks are green
on this exact HEAD, including the now-mandatory full-migration-history and
web↔API wiring checks; (3) run this same real-stack script battery (or the
equivalent) against a real staging Supabase project — Gate 2; (4) run
representative concurrent-user load and exercise Supabase's managed
backup/restore tooling — Gate 3; (5) get an explicit decision on Gate 4
and execute it. PR #29 stays unmerged throughout. NO-GO stands until all
four gates pass, not until local work runs out.

---

## 6. Traceability

Every claim in this report is backed by a script, a commit, or both:

- Commits this round (newest first): `c622a08c` (fixed the verifier's
  merge-SHA bug, made the DB check mandatory + full-history, added the
  web↔API wiring check, re-tested DB logic against a real
  `supabase db push`-populated table), `0d798014` (E2E candidate-SHA
  verification + fail-clear fix — first version, since corrected),
  `2ac092db`, `a6bed7c8` (G08 accounting correction), `ed8f2063`,
  `ffc4efb7`, `32f12e32`, `031f10f2`, `e2057ed1`, `c36a4853`, `629cb456`,
  `295338ac`, `f914f4fd`, `55eeb9d4`, plus the earlier correction-round
  commits `c315f76d` back through `1994b607` (G02/G03/G04/G06
  corrections, 223-row reconciliation). Pushed to
  `origin/fix/g13-numeric-coercion-sweep` as `9ab87791..07a08d8d`,
  `07a08d8d..0d798014`, `0d798014..4d8b006b`, then `4d8b006b..c622a08c`.
- CI run `37339052239` (job logs) — source of the merge-SHA discovery
  (`github.sha` = `18362fd5...` ≠ PR head `4d8b006b`) and of the original
  E2E secrets-missing finding. `workflow_dispatch` run `37351301793` on
  `c622a08c` — source of the current verified secrets state (all nine
  unset, confirmed directly from the job log, not inferred).
- PR #29 comment (`issuecomment-5997073960`) — the E2E root-cause analysis
  posted after checking all 9 prior workflow runs, not asserted from the
  one failure alone.
- `docs/production-readiness/STATUS.md` — findings-table narrative, phase status.
- `docs/production-readiness/EVIDENCE.md` — §9/§9b (G01-G06 corrections),
  §13 (financial-chain reconciliation), plus the original numbered sections
  for everything predating this round.
- `docs/production-readiness/FINDINGS.csv` — per-finding ID, status, fix
  commit, regression test, remaining validation (481 rows).
- `docs/production-readiness/baseline-reconciliation-223-rows.csv` —
  row-level basis for the G08 stable-key migration's "nothing silently
  dropped or added" claim.
- `docs/production-readiness/g08-sweep-findings-register.csv` — the
  per-finding register this revision's correction is built on: 98 rows,
  each with its file/line, register, TRUE_POSITIVE_REPAIRED/FALSE_POSITIVE
  classification, and the exact justification text (for suppressions,
  extracted verbatim from the `// lint-*-ok:` comment; for repairs, the
  commit that made the real code change) — extracted programmatically
  from the actual diff of commits `32f12e32`/`c36a4853`, not reconstructed
  from memory or agent-reported prose.
