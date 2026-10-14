# SYSTEM_AUDIT_2026-10-14 — Findings, Fixes, and Honest Non-Coverage

This is the durable record for this audit round, requested against PR #30's
integration branch. It exists in the repository, not only in a session
transcript, for the same reason `PILOT_LOCAL_FINDINGS.md` does.

## Handoff accessibility (checked first, per instruction)

- **Frozen baseline `91a1ac52`**: confirmed — this was the HEAD of
  `integration/g13-plus-market-priorities` at the start of this round.
- **`SYSTEM_AUDIT_2026-10-14.md`** (the audit report itself): **not found**
  anywhere in this repository — not in the working tree, not in any
  branch's history (`git log --all`), not attached to this conversation.
  Nothing in this document's content is sourced from it; the fix scope
  below comes entirely from the task's own item-by-item description.
- **Branch `fix/system-audit-20261014`**: does not exist locally or on
  `origin` (`git fetch` for it fails with "couldn't find remote ref").
- **Commit `d8be07a6`**: not a valid object in this repository
  (`git cat-file -t` fails with "Not a valid object name").
- **Conclusion**: the described Codex changes are not accessible from this
  session. Every fix below was independently designed and implemented
  against this round's own investigation of the live code — none of it is
  an import of, or a claim to have reviewed, that prior work.

## Item 1 — Monthly leave accrual: real defects found and fixed

`runMonthlyAccrual()` (`apps/api/src/lib/accrual-engine.ts`) had three
compounding, confirmed defects, found by reading the pre-existing code
(not assumed from the prompt):

1. **The exact CLAUDE.md "never `.limit()` a complete dataset" failure,
   live in this file.** The pre-crediting balance pre-fetch
   (`employee_leave_balance` select) had no `.range()`/`fetchAllRows()` —
   the one query in this file never routed through the project's own
   mandatory pagination helper. Past PostgREST's 1,000-row ceiling, an
   omitted employee's real balance was read as `?? 0`, so their *existing*
   balance was overwritten to `0 + days` instead of `existing + days` —
   silent balance loss at scale, not merely a missed credit.
2. **Not transactional, and not safe to retry.** Balance write, both ledger
   writes, and run finalization were four separate, uncoordinated
   PostgREST round trips. The balance write was a client-computed
   `currentBalance + days` **overwrite**, not an atomic increment — unsafe
   against both (a) a retry after a partial failure (re-derives
   "currentBalance" from the *already-credited* value and adds `days`
   again) and (b) a genuinely concurrent leave approval/cancellation
   touching the same row (classic lost update).
3. **A crashed run could never be retried.** `claimAccrualRun()` only
   reclaimed `'partial'`/`'failed'` runs — a process that claimed a run
   (`status='running'`) and then crashed before the finalizing `UPDATE`
   left that run stuck forever, by design, because resuming it under the
   old non-idempotent crediting loop would have risked double-crediting.

### Fix

`supabase/migrations/459_monthly_accrual_atomic_batch.sql` adds
`credit_monthly_accrual_batch()`: one SQL statement per chunk that does a
true atomic increment (`INSERT ... ON CONFLICT DO UPDATE SET balance =
employee_leave_balance.balance + EXCLUDED.balance`, never a client-computed
overwrite — so Postgres's own row lock, not application code, serializes
it against `deduct_leave_balance`/`credit_leave_balance`/
`checked_deduct_leave_balance`), with a per-employee idempotency check
against `leave_accrual_ledger`'s own partial unique index **inside the same
statement** that writes to it. `accrual-engine.ts` now chunks employees
(500/call) through this function instead of the old pre-fetch/compute/
write sequence, which also **removes** the unpaginated balance pre-fetch
entirely (no read to omit any more). `claimAccrualRun()` now also reclaims
a `'running'` claim whose `ran_at` is older than 15 minutes — safe now that
resuming just re-skips already-credited employees.

### Real-Postgres proof

`scripts/db/verify-monthly-accrual-atomic.mjs` drives the actual compiled
`runMonthlyAccrual()` against a real Postgres connection (a purpose-built
shim translates its exact supabase-js call shapes into SQL — not a mock of
outcomes). **All checks pass, live-run against `hrms_uat`:**
- 2,200 employees, one run: all credited, 2,200 `employee_leave_balance`
  rows exactly `1.0` (not silently zeroed past the 1,000-row ceiling),
  balance reconciles against both ledgers for all 2,200 rows (elapsed:
  ~300-700ms).
- A pre-seeded balance is incremented (`5.0 + 1.0 = 6.0`), never overwritten.
- An injected mid-batch failure (a foreign-key violation mixed into an
  otherwise-valid batch) rolls back the **whole** statement — zero balance/
  ledger rows for any employee in that batch, including the otherwise-valid
  ones. A real retry afterward credits exactly once per employee (verified
  via ledger row counts), and a redundant retry of an already-`'success'`
  run is a clean skip.
- Two genuinely concurrent `runMonthlyAccrual()` calls for the same
  tenant+period+leave-type: exactly one credits, the other is skipped, no
  employee double-credited.
- A real concurrent `checked_deduct_leave_balance()` call races the accrual
  batch on the **same** employee row: final balance reconciles exactly
  (10.0 opening + 2.0 accrual − 3.0 deduction = 9.0) regardless of
  interleaving — no lost update either direction.
- A stale (2h-old) `'running'` claim is reclaimed and completes; a fresh one
  (claimed moments ago) is correctly left alone.

Existing unit tests (`accrual-engine.test.ts`, `accrual-engine-defects.test.ts`,
`accrual-run-claim.test.ts`) updated for the new call shape — all pass, plus
the full API suite (475 tests, 0 regressions).

## Item 2 — Payroll rollback: real defect found and fixed

Confirmed exactly the defect the task described. `rollback_payroll_run_atomic`
(migration 452) locked the run, validated, flipped status to `'draft'`, and
**returned** — then `POST /payroll/runs/:id/rollback` did slip deletion,
totals resync, leave-encashment revert, and GL-ledger cleanup as **separate,
uncoordinated calls after that commit**. A crash between any two of them
left a torn, "rolled back" run with the old finalized state's remainder
still attached — most seriously, a leave-encashment request that could stay
marked `'paid'` for a run whose slip no longer existed.

### Fix

`supabase/migrations/460_payroll_rollback_fully_atomic.sql` folds every one
of those steps **into** `rollback_payroll_run_atomic`'s own transaction:
slip deletion, totals zeroed, `fn_revert_leave_encashments_for_rollback`
called in-transaction, unposted-ledger cleanup (entries → cost allocations
→ headers, FK order), and snapshot archival — all after the same row lock
that already re-validates every guard (processing, authorization,
posted-ledger, filed-statutory). Unlike the accrual engine, there is no
scale reason to chunk this: one run's slip count is bounded by one
tenant's headcount. The JS route was simplified accordingly (freeze-lift
deliberately kept as a separate step — it is period-lock state, not
financial data, and was not one of the four things this item named).

### Real-Postgres proof

`scripts/db/verify-payroll-rollback-atomic.mjs`, live-run against `hrms_uat`:
- Happy path: one call atomically flips status, deletes slips, zeroes
  totals, reverts a `'paid'` encashment, deletes an unposted ledger + its
  entries + cost allocations, and archives the snapshot.
- Every guard still blocks (posted ledger, filed statutory, processing,
  non-super-admin on a finalized run) **and leaves nothing touched** —
  verified by re-reading the run/slip state after each blocked attempt.
- Real concurrency: `rollback_payroll_run_atomic` raced against
  `mark_ledger_posted_atomic` for the same run via `Promise.all` on two
  separate Postgres connections. Whichever acquires the row lock first
  fully completes before the other proceeds; the loser always sees fresh,
  post-commit state and correctly refuses — never a torn "posted AND
  rolled back" outcome.
- Idempotent retry: rolling back an already-`'draft'` run is a safe no-op
  (succeeds, reverts nothing further, no double-anything).
- A 500-slip run rolls back correctly in ~9ms.

Full API suite re-run after this change too: 478 tests (475 + the 3 new
`setup.test.ts` tests below), 0 regressions.

## Item 3 — Pilot deployment tooling

While investigating resumability, found and fixed a real, previously
unnoticed defect that was exactly the mechanism blocking "interrupted
setup recovery": `POST /setup`'s anti-hijack guards (the 15-minute account-
age window and the `full_name` match) ran **before** its own idempotency
check. A legitimate retry of an already-completed setup — the first call
succeeded but the caller never saw the response — failed with
`SETUP_WINDOW_EXPIRED` once more than 15 minutes had passed since the
*original* signup, even though the real work was already done. Fixed by
reordering: idempotency first (an existing profile for this exact user_id
carries no hijack risk regardless of age or name — whatever protected its
creation already ran at that earlier call). Three regression tests added
(`apps/api/src/routes/__tests__/setup.test.ts`): idempotent retry past the
window succeeds; a genuine CREATE attempt still enforces both guards.

`scripts/pilot/seed-pilot-tenant.mjs` rewritten:
- **Stable identifier**: `PILOT_RUN_ID` (default `"default"`) replaces
  `Date.now()`-derived emails — re-running with the same value resumes
  instead of creating a second tenant.
- **Deterministic password** derived from `PILOT_RUN_ID` alone (not
  `Math.random()`) so a re-run with no `PILOT_PASSWORD` override still logs
  back into the same accounts instead of generating a fresh, unusable one.
- **Idempotent at every step**: signup failure classified as
  "already registered" → logs in instead of aborting; manager/employee
  creation checks `GET /employees?search=<email>` first; login-account
  creation checks `GET /employees/:id/user-account` first; the hr_admin
  profile insert uses `ON CONFLICT (id) DO NOTHING`.
- **Credential handoff gated on a confirmed `is_pilot=true`**: the password
  is written to `pilot-seed-result.json` **only** after a fresh `SELECT`
  (not "the UPDATE didn't error") confirms it. Without `DATABASE_URL`, the
  script now writes a credential-**free** pending file (`credentials_
  withheld: true`, no password field at all) instead of handing out a
  password before the gate is actually live for that tenant.

`scripts/pilot/pilot-smoke-check.mjs` rewritten: both guarded and allowed
checks now explicitly distinguish an unexpected 401/404/500 (broken auth/
routing/deployment) from the pilot gate's own 403 shape, instead of folding
every non-403 outcome into "not wrongly blocked" (the old logic would have
silently passed a crashed deployment on every "allowed" check). The F&F
mark-paid guarded check now uses a **real** employee id from the pilot
tenant's own seed result (not an all-zero dummy UUID that can only prove
the gate fires before a foreign-key lookup), with an optional direct
`separation_ff_summary` read-back (via `DATABASE_URL`) proving zero rows
were written.

### Real, end-to-end proof (not a mock)

Ran the actual rewritten scripts against a **live local stack** — real
Postgres (`hrms_uat`), the local test gateway (patched to add a
`created_at` column + field to its `auth.users` shim, which had none at
all — a genuine local-sandbox gap, not a product one; `setup.ts`'s
anti-hijack age check needs it), and the real compiled API server:
- **First seed**: full 7-step flow completes, `is_pilot` confirmed `true`,
  credentials written.
- **Repeat seed, same `PILOT_RUN_ID`**: zero duplicates — exactly 1 tenant,
  1 manager employee, 1 employee, 4 profiles, confirmed by direct count
  queries before and after.
- **Interrupted recovery**: the process was killed (`timeout 0.4s`)
  mid-way through employee-account creation. Re-running with the same
  `PILOT_RUN_ID` correctly detected the already-created manager and
  employee (skipped, no duplicate), created only the missing login
  account, and completed the hr_admin link + `is_pilot` confirmation —
  credentials written only on this second, completing call.
- **Withheld-credentials path**: running without `DATABASE_URL` produced a
  result file with `credentials_withheld: true` and no password field.
- **Smoke-check hardening caught a real, pre-existing bug in the smoke-check
  tooling itself**: both the guarded and allowed checks' query-param names
  (`period=`) didn't match what the real routes actually expect (`month=`
  — confirmed by reading `apps/api/src/routes/payroll/{exports,runs,
  filing-pack}.ts`'s own zod schemas). This had been invisible because the
  non-pilot control check — the one check proving the gate isn't also
  blocking real tenants — is almost always skipped (its own output says
  so) and the pilot-tenant side never reached parameter validation (the
  gate fires first). Fixed the param names; all guarded/allowed checks for
  the pilot tenant now pass for real.

**One honestly disclosed remaining gap from this same run**: with the
param names fixed, the non-pilot **control** check still fails — a real
500 from the EPF filing-pack/ecr route for a freshly-seeded control tenant.
Traced to the error message (`"Invalid identifier: employees(employee_code)"`)
and the real route code (`apps/api/src/routes/payroll/exports.ts:79`,
`.order('employees(employee_code)', …)` — ordering by an embedded
resource's column, a real, valid PostgREST feature). This points at the
**local test gateway's** custom REST-engine not supporting that specific
order-by-embedded-column syntax (its own header comment already discloses
it is "not audited against the full PostgREST spec") — not a confirmed
product defect. This specific check needs re-verification against a real
Supabase/PostgREST project, which does support this syntax; it is listed
as unverified, not as passing, in the coverage table below.

## Items 4 & 5 — honestly not executed this round

**Item 4 (complete system audit)**: inventorying every active module,
screen, route and workflow across configuration, employee lifecycle,
attendance, leave, compensation, payroll, statutory, loans/advances,
reimbursements, F&F, approvals, reports, imports/exports, ESS, manager and
owner portals — and checking each for broken links, request/response
mismatches, tenant isolation, pagination, atomicity, concurrency,
audit preservation, file-privacy and finalized-payroll protection — is a
multi-day, whole-codebase effort. This round used its available scope on
the three financial/operational-correctness items explicitly named first,
going deep (real defects, real fixes, real Postgres proof) rather than
wide. **This document does not claim item 4 is done, partially sampled, or
safe to assume clean.** It is unexecuted, not passing.

**Item 5 (real environment validation)**: unchanged from every prior round
of this engagement — this sandbox has no real Supabase project. RLS,
storage privacy, and `auth.uid()` cannot be exercised correctly here (see
`PILOT_LOCAL_FINDINGS.md`'s full root-cause explanation, still current).
The browser-journey and Attendance/Leave-matrix work from earlier rounds
stands as application-layer evidence only, exactly as that document already
states — nothing in this round changes that.

## What this round's fixes do NOT establish

- Items 1–3's real-Postgres proof is against this sandbox's local Postgres
  and (for item 3) a patched local test gateway — not the real managed
  Supabase project item 5 still requires.
- No claim is made that main is touched (it is not) or that PR #30 is
  merged (it is not).
- No claim is made that the system is "audited" or "ready" — see the
  consolidated report's coverage table for the explicit tested/untested/
  blocked breakdown.
