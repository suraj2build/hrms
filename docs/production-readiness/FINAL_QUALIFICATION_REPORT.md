# CognixHR Production-Readiness — Final Qualification Report

**Branch:** `fix/g13-numeric-coercion-sweep` (PR #29, `suraj2build/hrms`)
**HEAD at report time:** `ed8f2063da33af6b0903717038eeeb97503cb96b`
**Ahead of `origin/main`:** 54 commits (0 behind)
**Unpushed vs `origin/fix/g13-numeric-coercion-sweep`:** 52 commits
**PR #29 state:** open, **draft**, not merged, base `main` — unchanged this round
**Push status:** paused per standing instruction pending explicit confirmation that GitHub App access is restored. All 52 commits exist only in this local checkout until that push happens.

This report is the single source of truth for "what is actually true right
now." Where it disagrees with an earlier narrative elsewhere in this
directory, this document is newer and wins — but nothing here was produced
by regenerating a baseline or deleting evidence; every claim below cites the
script/commit that backs it.

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
| G08 (ratchet mechanism) | **FIXED** — stable-key migration complete, 96 surfaced findings triaged | both ratchets, 0 new findings |
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

## 4. Unresolved blockers (genuine — infrastructure or business decisions, not left undone by omission)

1. **Real Supabase/PostgREST validation (G07, G10, and G13's remaining
   gate).** Every local real-stack script in this engagement runs against
   this sandbox's own Postgres plus a hand-built PostgREST-compatible
   gateway (`/tmp/supabase-gateway.mjs`), not genuine managed Supabase. That
   gateway faithfully reproduces the specific behaviors this engagement
   cares about (max-rows=1000 ceiling, NUMERIC-as-string) but is not proof
   of wire-identical behavior at enterprise scale on the real service. This
   sandbox has no network path to a real Supabase project — it cannot be
   closed from here under any amount of further local work.
2. **Supabase-managed backup/restore/PITR/cross-region failover (rest of
   G10).** The local rehearsal (§1) proves the data itself is
   backup/restore-safe; it does not exercise Supabase's own operational
   tooling, which needs a real project.
3. **G12 (leave encashment scope)** — a product decision (is standalone
   encashment in the first customer's scope at all?), not an engineering
   task. Unchanged, not re-traced this round.
4. **Baseline file resave (`--save-baseline --stable-key`)** — attempted
   after the 96-finding sweep to shrink the live baseline further; blocked
   by this environment's own tooling-level guard against modifying shared
   baseline files. Not a problem for correctness (both ratchets already
   pass clean without it) — flagging only because it was attempted and
   explicitly refused, not silently skipped.
5. **Git push** — 52 commits are local-only. Standing instruction: do not
   retry push until the user explicitly confirms GitHub App access is
   restored. Nothing in this round changes that instruction.

None of the above block any of the *other* work in this engagement — each
was identified, attempted where attemptable, and reported, per the
standing "complete every independent task, batch only genuine blockers"
instruction.

---

## 5. GO / NO-GO recommendation

**NO-GO for production launch, unchanged from the standing verdict — but
on substantially narrower grounds than before this round.**

What changed: the financial-semantics gaps a review correctly identified
as insufficient (G02/G03/G04 corrections) are now closed and mutation-
tested; G08/G09/G11 are closed; a real financial-chain reconciliation bug
(PTax filing drift) was found and fixed, not just asserted absent; UAT
coverage broadened to a third, structurally different authorization path;
local load, concurrency, and backup/restore are all green at the scale
this sandbox can produce.

What still stands between here and GO:

- **No genuine Supabase/PostgREST validation has ever been run for this
  entire engagement.** Every "real-stack" result in this report and its
  predecessors is real Postgres + a hand-built gateway. The single most
  important remaining gate is running this same battery of scripts (or
  the equivalent) against an actual staging Supabase project at
  realistic scale. This is not optional caution — the original Muster
  Roll production incident this whole engagement traces back to was
  exactly a real-PostgREST behavior (`max-rows=1000`) that a local mock
  would not have caught, which is precisely why this caveat is repeated
  on every relevant finding rather than quietly dropped.
- **G10's Supabase-managed recovery tooling** has never been exercised at all.
- **G12** needs a product scoping decision before it can be called done or explicitly out of scope.
- **This branch has never been pushed or run through real CI** since the
  51 commits before this report's final two were made — the new
  `pull_request` trigger on `e2e.yml` has never actually fired.

**Recommended path to GO:** get explicit confirmation to restore push
access, push this branch, watch the resulting CI run (including the newly
pull_request-gated E2E suite) to green, then run this same script battery
once against a real staging Supabase project before considering the
verdict anything other than NO-GO. PR #29 stays unmerged, as instructed.

---

## 6. Traceability

Every claim in this report is backed by a script, a commit, or both:

- Commits this round (newest first): `ed8f2063`, `ffc4efb7`, `32f12e32`,
  `031f10f2`, `e2057ed1`, `c36a4853`, `629cb456`, `295338ac`, `f914f4fd`,
  `55eeb9d4`, plus the earlier correction-round commits `c315f76d` back
  through `1994b607` (G02/G03/G04/G06 corrections, 223-row reconciliation).
- `docs/production-readiness/STATUS.md` — findings-table narrative, phase status.
- `docs/production-readiness/EVIDENCE.md` — §9/§9b (G01-G06 corrections),
  §13 (financial-chain reconciliation), plus the original numbered sections
  for everything predating this round.
- `docs/production-readiness/FINDINGS.csv` — per-finding ID, status, fix
  commit, regression test, remaining validation (481 rows).
- `docs/production-readiness/baseline-reconciliation-223-rows.csv` —
  row-level basis for the G08 stable-key migration's "nothing silently
  dropped or added" claim.
