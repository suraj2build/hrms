# Evidence log — this remediation pass

HEAD at time of writing: `88c60b5bdb03027673ec2d764a211b7881d3acd3`
(branch `fix/g13-numeric-coercion-sweep`, local-only, not pushed)

This is raw evidence for the claims in `STATUS.md`. Each section is something
that was actually run and its actual output, not a summary of intent.

## 1. Scanner counts, before and after this pass

Captured by running the actual checker scripts, not by re-deriving numbers
from memory.

| Checkpoint | `check-unbounded-queries.mjs` finding count | `check-tenant-isolation.mjs` violation count |
|---|---|---|
| Clean HEAD before this pass (commit `2c05101`, verified via `git stash`) | 153 | 307 (unaffected by this pass — no tenant-isolation-scanned code was touched) |
| After A1+A2 cluster fixes (`f3e4ca4`, `f1fc6d4`) | 143 | 307 |
| After ordering fix + `employee_compensation_components` discovery (`699e7c9`) | 141 | 307 |
| Current (`c782c36`, after the checker refactor — refactor itself is a no-op on counts) | 141 | 307 |

The unbounded-queries drop (153→141 = **12 fewer findings**) corresponds
exactly to 10 register-matched fixes the scanner recognizes as resolved
(`fetchAllRows()`/`.range()` pattern) plus the filing-pack.ts PAN-chunk fixes
once they were also converted to `fetchAllRows()` (see section 5 for the
exact mapping — the scanner does NOT recognize a plain chunking loop as
safe, confirmed empirically in section 5).

## 2. check-tenant-isolation.mjs / check-unbounded-queries.mjs --ratchet already fail at clean HEAD

```
$ git stash push -u -m "wip"
$ node scripts/check-unbounded-queries.mjs --ratchet
...
  ✓ 264 query(ies) fixed since baseline (267 → 153).
  → Run --save-baseline to lock in the improvement.
✗ Unbounded query ratchet: 150 NEW finding(s) not in baseline
[exit 1]

$ node scripts/check-tenant-isolation.mjs --ratchet
...
  ✓ 303 violation(s) fixed since baseline (314 → 307)
✗ Tenant isolation ratchet: 296 NEW violation(s) not in baseline
[exit 1]

$ git stash pop
```

Both ratchets were already red before this pass touched anything. Root
cause nailed down exactly:

```
$ node -e '
const fs=require("fs");
const b=JSON.parse(fs.readFileSync("scripts/unbounded-queries-baseline.json","utf8"));
console.log(b.keys.filter(k=>k.startsWith("apps/api/src/routes/attendance/anomalies.ts")));
'
[
  'apps/api/src/routes/attendance/anomalies.ts:141:employees',
  'apps/api/src/routes/attendance/anomalies.ts:159:employees',
  'apps/api/src/routes/attendance/anomalies.ts:335:employees'
]

$ node scripts/check-unbounded-queries.mjs 2>&1 | grep anomalies.ts
  apps/api/src/routes/attendance/anomalies.ts:144  table=employees  ...
  apps/api/src/routes/attendance/anomalies.ts:163  table=employees  ...
  apps/api/src/routes/attendance/anomalies.ts:339  table=employees  ...
```

Same three findings, same table, shifted +3/+4/+4 lines by an edit to that
file unrelated to this pass. This is the exact failure mode
`scripts/lib/finding-fingerprint.mjs` and its test fix (section 3).

## 3. Fingerprint fix — proof run

```
$ node --test scripts/lib/__tests__/finding-fingerprint.test.mjs
ok 1 - check-unbounded-queries: inserting unrelated lines above a finding
       does not change its stable fingerprint, but DOES change the
       line-based key
ok 2 - check-unbounded-queries: a genuinely different unsafe query gets a
       different stable fingerprint (still caught, not a universal collision)
ok 3 - check-tenant-isolation: the same line-shift-invariance property
       holds for violationKey
ok 4 - stableFingerprint normalizes whitespace/newlines in the snippet but
       not the code content
# pass 4
# fail 0
```

Refactor verified behavior-preserving (CLI output identical modulo this
pass's own real fixes moving the count, not the refactor itself):

```
$ node scripts/check-unbounded-queries.mjs --summary   # → 141 findings, exit 1
$ node scripts/check-tenant-isolation.mjs --summary    # → 307 violations, exit 1
$ cd apps/api && npx tsc --noEmit                       # exit 0
$ npx vitest run                                        # 38 files / 325 tests pass
```

**Not done, and deliberately not done:** regenerating either baseline under
`--stable-key`. That is a one-time migration a human needs to authorize —
see STATUS.md.

## 3b. Exception-preserving baseline migration — prepared and tested

`node scripts/migrate-baseline-to-stable-keys.mjs` output against this repo
(trimmed; full output reproducible by re-running it):

```
=== unbounded-queries-baseline.json ===
  original baseline: 267 findings
  ✓ resolved exact (same line):    3
  ⚠ resolved nearest (line drift):  113
  ✗ unresolved (no current match):  151 — needs manual reconciliation
  ⚠ 3 duplicate-query collision(s)
  → wrote scripts/unbounded-queries-baseline.stable-key.json

=== tenant-isolation-baseline.json ===
  original baseline: 314 findings
  ✓ resolved exact (same line):    11
  ⚠ resolved nearest (line drift):  231
  ✗ unresolved (no current match):  72 — needs manual reconciliation
  ⚠ 8 duplicate-query collision(s)
  → wrote scripts/tenant-isolation-baseline.stable-key.json
```

Internal-consistency check (every original entry accounted for exactly
once, mapped or unresolved, nothing dropped or double-counted):

```
$ node -e '... mapped.length + unresolved.length === original_count ...'
unbounded-queries-baseline.stable-key.json  original_count=267 mapped=116 unresolved=151 sum=267 matches=true
tenant-isolation-baseline.stable-key.json   original_count=314 mapped=242 unresolved=72  sum=314 matches=true
```

Duplicate-collision example (two baseline entries that would silently
collapse into one if keyed by snippet+table+file alone — reported instead
of merged):

```
apps/api/src/lib/whatsapp-provider.ts::whatsapp_outbox::↵ .update({ status: 'sent', ... })↵ .eq('id', outboxId) ...
  <- apps/api/src/lib/whatsapp-provider.ts:96:whatsapp_outbox  (nearest, Δline=7)
  <- apps/api/src/lib/whatsapp-provider.ts:165:whatsapp_outbox (nearest, Δline=14)
```

See STATUS.md Phase 3 for why a historical-commit-reproduction approach was
tried first and abandoned (the baseline's line numbers are stale relative
to every commit in this repo's history, not just HEAD).

## 4. Mutation testing — every new regression test, reverted and restored

For each test below: the pre-fix file (commit `2c05101`, this branch's state
before this remediation pass) was copied over the fixed file, the test was
run and its failure recorded, then the fixed file was restored via
`git checkout HEAD -- <file>` and the test re-run to confirm it passes again.

| Test file | Pre-fix result (RED) | Post-restore result |
|---|---|---|
| `tds-reconciliation-pagination.test.ts` | `high_variance` 70 (expected 120) | PASS (2/2) |
| `filing-pack-readiness-pagination.test.ts` | `missing_uan` 25 (expected 60) | PASS (2/2) |
| `filing-pack-24q-pagination.test.ts` | HTTP 500 (simulated request-line overflow on the unchunked `.in()`) | PASS (1/1) |
| `filing-pack-ecr-pagination.test.ts` | HTTP 500 (same) | PASS (2/2) |
| `esi-wage-base-pagination.test.ts` | `esi_wages` 0 (expected 9500/9000) | PASS (1/1) |
| `epf-wage-base-pagination.test.ts` | `pf_wages` **15000** (the `config.wageCeiling` fallback — a silently plausible-looking wrong number, not an obvious zero) (expected 9500/9000) | PASS (1/1) |
| `ptax-wage-base-pagination.test.ts` | `gross_salary` 0 (expected 9500/9000) | PASS (1/1) |
| `esi-stale-cleanup-chunking.test.ts` | (new fix, pre-fix code throws before the test's assertions — see §7's real-stack run for the actual pre-fix failure mode) | PASS (1/1) |
| `scripts/pagination-scale-check.sh` (real stack, not vitest) | HTTP 500 `DELETE_FAILED` against 1,200 real employees — see §7 | PASS (6/6) |

Each row above is the actual `AssertionError` message from the real
pre-fix run, not a prediction.

Full suite after every restoration: 38 files / 325 tests pass,
`tsc --noEmit` exit 0.

## 5. Exact finding → fix mapping (unbounded-queries, 153-row register)

Every one of the 47 `CONFIRMED_DEFECT` rows in
`raw-unbounded-queries-classification.csv`, cross-referenced against what
actually got fixed this pass and what the scanner now reports:

| File:Line (at classification time) | Table | Fixed this pass? | Fix commit | Test | Scanner recognizes as resolved? |
|---|---|---|---|---|---|
| `filing-pack.ts:114` | employee_bank_statutory | Yes | `f1fc6d4` (chunk) + `699e7c9` (converted to `fetchAllRows` per chunk) | `filing-pack-24q-pagination.test.ts` | **No** after `f1fc6d4` alone (confirmed: scanner doesn't recognize a bare chunking loop — only `fetchAllRows()`/`.range()`); **Yes** after `699e7c9` |
| `filing-pack.ts:265` | epf_contributions | Yes | `f1fc6d4` | `filing-pack-readiness-pagination.test.ts` | Yes |
| `filing-pack.ts:290` | payroll_slips | Yes | `f1fc6d4` | `filing-pack-readiness-pagination.test.ts` | Yes |
| `filing-pack.ts:302` | employee_bank_statutory | Yes | `f1fc6d4` (chunk) + `699e7c9` (fetchAllRows per chunk) | `filing-pack-readiness-pagination.test.ts` | Same as :114 — No then Yes |
| `statutory-recon.ts:76` | epf_contributions | Yes | `f3e4ca4` | none dedicated (sum-correctness not covered by a test this pass) | Yes |
| `epf.ts:382` | employee_compensations | Yes | `f3e4ca4` | `epf-wage-base-pagination.test.ts` | Yes |
| `epf.ts:423` | payroll_slips | Yes | `f3e4ca4` | `epf-wage-base-pagination.test.ts` | Yes |
| `esi.ts:404` | payroll_slips | Yes | `f3e4ca4` | `esi-wage-base-pagination.test.ts` | Yes |
| `esi.ts:437` | employee_compensations | Yes | `f3e4ca4` | `esi-wage-base-pagination.test.ts` | Yes |
| `ptax.ts:494` | payroll_slips | Yes | `f3e4ca4` | `ptax-wage-base-pagination.test.ts` | Yes |
| `ptax.ts:512` | employee_compensations | Yes | `f3e4ca4` | `ptax-wage-base-pagination.test.ts` | Yes |
| `tds-bulk.ts:483` | payroll_slips | Yes | `f3e4ca4` | `tds-reconciliation-pagination.test.ts` | Yes |
| *(all other 35 CONFIRMED_DEFECT rows)* | various | **No** | — | — | still flagged |

**Fixed beyond the 153-row register (`check-unbounded-queries.mjs` never
flagged these — confirmed: `employee_compensation_components` and
`epf_eligibility_overrides` are absent from `HIGH_CARDINALITY_TABLES` in the
checker source):**

| Finding | Fixed this pass? | Fix commit | Test |
|---|---|---|---|
| `epf.ts`/`esi.ts`/`ptax.ts` `employee_compensation_components` lookup (3 files, found during the ordering-gap review) | Yes | `699e7c9` | `epf-/esi-/ptax-wage-base-pagination.test.ts` (same tests as the primary wage-base fixes — same endpoint) |
| `filing-pack.ts` readiness+ecr `epf_eligibility_overrides` UAN chunk (2 sites) | Yes | `699e7c9` | `filing-pack-readiness-pagination.test.ts`, `filing-pack-ecr-pagination.test.ts` |

**Net result:** 12 of 47 register-listed CONFIRMED_DEFECT rows fixed, plus 2
additional defects (covering 5 call sites) found and fixed outside the
register's scope. 35 register-listed CONFIRMED_DEFECT rows remain open — see
`FINDINGS.csv` for the exact list (`status=OPEN`).

## 6. Keyset pagination + 3,4,5. real-stack scale extended to 2,200 (ESI+EPF+PTax)

Reviewer correction: a deterministic `.order('id')` resolves *ambiguous*
ordering between identical requests, but offset/.range() pagination can
still skip or duplicate rows when the underlying table is written to WHILE
pagination is in flight — a concurrent finalize inserting/deleting a row
anywhere at or before the current page boundary shifts every row after it,
regardless of how stable the sort key is, since `id` is a random UUID that
can land inside an already-read page.

**Proof, not just a design argument** —
`apps/api/src/lib/__tests__/supabase-paginate.test.ts` simulates a live,
mutating table and asserts the actual behavior:
```
✓ fetchAllRows() duplicates a row when a new row is inserted into an
  already-read page (asserted: makeId(990) appears twice, makeId(5) is
  silently missing — a real duplicate AND a real omission in the SAME run,
  not a prediction)
✓ fetchAllRows() skips a row when an already-read row is deleted mid-
  pagination (asserted: makeId(1000) is silently missing)
✓ fetchAllRowsByKeyset() is unaffected by the identical insert (250→251
  rows, zero duplicates, the late insert correctly excluded rather than
  silently duplicating a DIFFERENT row)
✓ fetchAllRowsByKeyset() is unaffected by the identical delete
```
All 4 pass. `fetchAllRowsByKeyset()` (new in `supabase-paginate.ts`) pages by
value (`WHERE id > lastSeenId`) instead of position, migrated into the
financial-critical reads: `epf.ts`/`esi.ts`/`ptax.ts`'s authoritative
`payroll_slips` wage base, `tds-bulk.ts`'s actual-TDS sum, and
`statutory-recon.ts`'s four "payable" reconciliation sums.
`tds_declaration_snapshots` (business-ordered by `created_at`, which doesn't
compose with a single-column keyset cursor) and `filing-pack.ts`'s
readiness/24Q/ECR reporting reads stay on `fetchAllRows()` — a scoping
decision stated plainly, not an oversight.

**Real-stack scale run extended to 2,200 employees (past the originally
tested 1,200, clearing the 2,000+ bar) and to EPF and PTax, not just ESI** —
`scripts/pagination-scale-check.sh`. Running it at this scale surfaced
**three more real, previously undetected bugs**, each found only by driving
the real HTTP/Postgres stack, fixed, and re-verified:

1. **`epf.ts`'s `employee_compensations` lookup ran for every active
   employee** (not gated behind "missing slip" the way `esi.ts`/`ptax.ts`'s
   equivalent is), with a single unchunked `.in()` over the full 2,200-id
   headcount. First run: `HTTP 500`, `err: ""` (empty — the request died
   before producing a usable error, same shape as the `esi.ts` stale-cleanup
   bug from the previous commit). Fixed: chunked by 100.
2. **`esi.ts`/`ptax.ts`'s own "missing slip" compensation lookup had the
   identical unchunked-`.in()` bug** — invisible in the original 1,200-scale
   test because every employee there had a slip, so `empsMissingSlip` was
   empty; worth re-checking once the `epf.ts` sibling turned up broken.
   Fixed: chunked by 100.
3. **`ptax.ts`'s `ptax_state_config`/`lwf_state_config` state-resolution
   reads were completely unpaginated.** At 2,200 employees:
   ```
   "computed_count":1000,"skipped_no_state":1200,"total_active":2200
   ```
   1,200 employees — everyone past the 1,000-row cap — came back with
   `state: null` and were silently excluded from PTax entirely, with no
   error. Fixed: wrapped both reads in `fetchAllRows()`.

Mutation-tested #3 directly against the real stack (restored the pre-fix
`ptax.ts` from commit `88c60b5`, re-ran the scale script, got the identical
`skipped_no_state: 1200` failure back, restored the fix, re-ran clean).
#1 and #2 were fixed together with #3 and verified via the same full
15/15-assertion clean run below, but not separately mutation-tested in
isolation under this scale script (that would need a fixture where some
employees lack a slip, which this script's current fixture doesn't exercise
— `wages_fallback: 0` in every run below confirms the fallback path, including
its own chunking, was not what was exercised here; it's covered instead by
the `epf-/esi-/ptax-wage-base-pagination.test.ts` vitest mutation tests).

Final clean run, all three statutory engines, 2,200 employees:
```
=== 1. ESI compute === computed_count: 2200 ✓
=== 2. Independent SQL read-back === persisted count 2200, sum(employee_contribution) 156750.00,
       zero-wage count 0, distinct-wage-value 1 — all ✓
=== 3. EPF compute === computed_count: 2200 ✓
=== 4. EPF independent SQL read-back === persisted count 2200, sum 2508000.00, zero-wage 0, distinct 1 — all ✓
=== 5. PTax compute === computed_count: 2200 ✓
=== 6. PTax independent SQL read-back === persisted count 2200, sum(ptax_amount) 440000.00, zero-gross 0 — all ✓
=== RESULT: 15 passed, 0 failed ===
```
`g13-reconciliation-check.sh` re-run clean (21/21) immediately after, to
confirm no regression from this round's changes. Full vitest suite: 40 files
/ 330 tests pass; `tsc --noEmit` clean.

**Still not real Supabase/PostgREST** — same caveat as before, stated again
rather than left to go stale: the gateway is a from-scratch reimplementation,
not the genuine service. 2,200 clears the "2,000+" figure quoted in the
remediation instruction, but the instruction's actual ask — a genuine
Supabase/PostgREST **staging** project — remains unavailable in this sandbox
and is reported as blocked, not satisfied by this substitute.

## 6c. Keyset pagination is NOT a snapshot — correction, gap closed, tested

A review correctly pushed back on §6's framing: keyset pagination prevents a
multi-page read from skipping or duplicating a ROW under concurrent
insert/delete, but it is **not** a consistent point-in-time snapshot. If a
row already returned on an earlier page has a financial column changed by a
concurrent UPDATE before a later page is read, the aggregate total mixes a
stale pre-update value for that row with current values for everything
else — a different failure mode, and keyset pagination alone does not
prevent it. `supabase-paginate.ts`'s doc comment previously implied
"snapshot-safe" by association; corrected to state the limitation
explicitly and point at the real guarantee.

**Proven generically** (mock-level, deterministic): new vitest suite
"`fetchAllRowsByKeyset() is NOT a consistent snapshot`" in
`supabase-paginate.test.ts`. A 250-row table, batch size 100; after page 1,
row 0's `amount` is updated from 100 to 500 before page 3 is requested.

```
sumFromPagination = 250 * 100         // every page read before the mutation settles on the stale value
trueCurrentSum    = 249 * 100 + 500   // the table's real current total
expect(sumFromPagination).not.toBe(trueCurrentSum)   // ✓ passes — proves the gap
```

**Closed, for the specific reads this engagement migrated to keyset**
(ESI/EPF/PTax wage base, TDS actual-TDS, statutory-recon's 4 payable sums —
all filtered to `payroll_slips.status = 'finalized'`), not by a pagination
technique but by a DB-enforced immutability guarantee: new migration
`438_payroll_slip_finalized_value_lockdown.sql` adds a trigger that rejects
any `UPDATE` changing a financial column on a slip while its own `status`
stays `'finalized'` on both sides of the write. Before this migration that
immutability was only an application convention — verified first, not
assumed: the one `UPDATE` call site on `payroll_slips` in `runs.ts` (the
stale-attendance recompute) is gated `.eq('status', 'draft')`, and the
finalize step itself only flips `status` (never touches another column) —
so no current code path violates it, but nothing in the DB stopped a future
one from doing so.

Real-stack proof, mutation-tested (not just argued):
`scripts/finalized-slip-value-lockdown-check.sh` against real Postgres —

```
=== 1. Legitimate: finalize the slip (draft -> finalized) === ✓
=== 2. BLOCKED: direct UPDATE of gross_pay on a finalized slip ===
  ✓ UPDATE correctly rejected: ERROR:  PAYROLL_FINALIZED: slip ... is finalized — financial columns cannot be updated in place
  ✓ gross_pay unchanged after the blocked UPDATE = 50000.00
=== 3. BLOCKED: UPDATE of component_breakdown (jsonb) === ✓
=== 4. Legitimate: rollback path (run -> draft, then DELETE slip) still works === ✓
=== RESULT: 5 passed, 0 failed ===
```

Mutation test: dropped the trigger, re-ran the same script —

```
=== 2. BLOCKED: direct UPDATE of a financial column on a finalized slip ===
  ✗ UPDATE was NOT rejected (expected PAYROLL_FINALIZED exception):
  ✗ gross_pay unchanged after the blocked UPDATE: expected '50000.00', got '999999.00'
=== RESULT: 2 passed, 3 failed ===
```

— confirmed RED without the fix, restored the trigger, reconfirmed GREEN
(5/5). This closes the value-mutation gap for exactly the rows these
queries read; it does not make an in-flight DRAFT read consistent, and it
is specific to this schema/table, not a general property of
`fetchAllRowsByKeyset()` itself (which remains, correctly, not a snapshot).

## 6d. Tenant vs. global ownership for payroll_validation_rules — decided and built

Decision (product, this session): global defaults with explicit tenant
override by rule `code`, never a field-by-field merge. Implementation:
migration `439_payroll_validation_rules_tenant_override.sql` (replaces
`UNIQUE(code)` with `UNIQUE NULLS NOT DISTINCT (tenant_id, code)`; seeds the
previously-missing `UNKNOWN_FAILURE` global default) +
`apps/api/src/lib/payroll-validation-rules.ts` (`fetchResolvedValidationRules`,
`upsertTenantValidationRuleOverride`), wired into all 3 unscoped reads in
`runs.ts` and into a rewritten `GET`/`PATCH /payroll/validation-rules`
(route param changed `/:id` → `/:code`; `PayrollValidation.tsx` updated to
match, plus an "is_override" badge).

Real-stack proof, not unit tests alone — `scripts/validation-rules-tenant-override-check.sh`
against real Postgres + the real API, a real `super_admin` and a real
`hr_admin`:

```
=== 1. GET returns platform defaults, none overridden ===
  ✓ GET returns at least 12 resolved rules (11 original + seeded UNKNOWN_FAILURE) = yes
  ✓ UNKNOWN_FAILURE is present = UNKNOWN_FAILURE
  ✓ no rule is tagged is_override before any PATCH = 0
=== 2. hr_admin PATCH is rejected (403) === ✓
=== 3. super_admin PATCH creates a TENANT override, not a global edit ===
  ✓ PATCH response is tagged is_override=true = true
  ✓ global COMP_MISSING row severity UNTOUCHED (still critical) = critical
  ✓ global COMP_MISSING row enabled UNTOUCHED (still true) = t
  ✓ exactly one tenant override row now exists for COMP_MISSING = 1
=== 4. GET after PATCH shows the override, not the global default ===
  ✓ exactly one COMP_MISSING row in the resolved list = 1
  ✓ resolved COMP_MISSING.enabled reflects the override (false) = false
  ✓ resolved COMP_MISSING.severity reflects the override (warning) = warning
  ✓ resolved COMP_MISSING.is_override = true = true
=== 5. PATCH for a nonexistent code 404s === ✓
=== RESULT: 13 passed, 0 failed ===
```

Cleanup confirmed (tenant, profiles, auth users all removed). Full API
suite re-run after this change: `tsc --noEmit` clean, `vitest run` 40 files
/ 331 tests pass (330 → 331: the new §6c keyset-consistency test).

## 6e. Remaining 28 `check-unbounded-queries.mjs` defects — closed

Re-read each of the 28 remaining CONFIRMED_DEFECT rows' current code before
touching anything — the same discipline that caught 6 already-fixed rows
earlier in this pass.

**24 fixed** — migrated to `fetchAllRows()` (tenant-wide scans with no
employee filter: `assistant-tools.ts` payroll cost, `intelligence-scanner.ts`
mood check-ins ×2, `anomalies.ts` active-headcount, `comp-off.ts` qualifying
days, `confidence.ts` confidence issues, `executive/index.ts` leave-liability
compensation, `recognition/index.ts` work-anniversary alerts) or chunked by
100 (`.in()` lookups against a caller-controlled or tenant-wide id list —
13 more files, two of them fails-closed validation checks in
`surveys/index.ts`, same pattern as `arrears.ts`/`variable-pay.ts`).

**1 reconciled** (`UNB-096`, `team-payroll-cost.ts`): already fixed in a
prior round — register was stale, same documentation-lag pattern as the 6
rows caught earlier.

**3 reclassified `FALSE_POSITIVE`, not force-fixed** (each with a concrete
code citation in `FINDINGS.csv`, not a bare reclassification):

```
UNB-010  attendance-engine.ts:1319 — .eq('employee_id', employee_id).in('date', dates)
         single employee, bounded date list. Count bounded by dates.length, never headcount.
UNB-042  confidence.ts:88          — .eq('employee_id', employeeId).gte('date', from)
         single employee, date range. Count bounded by the range (~366/year max).
UNB-044  context.ts:70             — .limit(50) on a "missing punches today" widget.
         Exactly CLAUDE.md's own stated exception: a capped top-N list where
         truncation is the intended UX, not a correctness risk.
```

These three looked like genuine classification inconsistencies in the
original batch pass, not deliberate judgment calls — their `evidence`
column was empty, same as their immediate FALSE_POSITIVE neighbors in the
same files (e.g. `attendance-engine.ts:1203`/`1381`), with no documented
reasoning distinguishing why these specific rows were marked
CONFIRMED_DEFECT instead.

Verification: `tsc --noEmit` clean, `vitest run` 40 files / 331 tests pass
— zero regressions from all 24 fixes, no new per-site test (the
`fetchAllRows()`/chunk-by-100 pattern itself is already tested; this
matches how every other mechanical pagination fix in this engagement was
handled). Re-ran `g13-reconciliation-check.sh` (21/21),
`finalized-slip-value-lockdown-check.sh` (5/5) and
`validation-rules-tenant-override-check.sh` (13/13) against the real stack
after this batch — all still pass, confirming no regression in the
financial/validation-rules paths this round's earlier commits added.

**Result: zero open CONFIRMED_DEFECT rows remain in either checker's
findings** (tenant-isolation's 3 were already closed by §6d above).

## 6f. Correction: UNB-010/UNB-042 were wrongly reclassified; UNB-044 had a real bug; query-error paths hardened

A review correctly rejected §6e's reclassification of `UNB-010` and
`UNB-042` as `FALSE_POSITIVE`. The reasoning ("single-employee scope
bounds the result") was wrong: employee scope bounds the SHAPE (one row
per date), not the COUNT, which depends on the date SPAN — and neither
`attendance-engine.ts`'s `recomputeRange()` nor `confidence.ts`'s GET
endpoint capped that span anywhere (checked all 6+ `recomputeRange` call
sites). Both are now genuinely fixed with `fetchAllRows()`.

Mutation-tested, not just argued — reverted `confidence.ts`, re-seeded a
real 1,200-row single-employee fixture:
```
total_days:    expected 1200, got 1000
critical_days: expected 120,  got 100
```
Restored, reconfirmed correct.

`UNB-044`'s `.limit(50)` display cap was legitimate, but fixing it
surfaced a real bug the first pass missed: the endpoint returned
`count: employees.length` — a total DERIVED from the capped 50 rows. Fixed
with an independent `count:'exact', head:true` query.

**New real-stack script**, `scripts/attendance-survey-truncation-check.sh`,
7/7 against real Postgres + the real API:
```
=== 1. UNB-042: 1,200-row single-employee fixture ===
  ✓ total_days = 1200 (not the 1,000-row cap)
  ✓ critical_days = 120
=== 2. UNB-044: 60-employee missing-punches fixture ===
  ✓ employees.length = 50 (capped display, intentional)
  ✓ count = 60 (TRUE total, not the capped length)
  ✓ truncated = true
=== 3. Fails-closed ownership, 105 ids (104 real + 1 foreign at position 105) ===
  ✓ POST /surveys/admin/:id/360/setup rejects INVALID_EMPLOYEES
    (foreign id past the first 100-id chunk boundary is still caught)
=== RESULT: 7 passed, 0 failed ===
```

**Query-error-path hardening**: the first pass's 26 fixes mostly discarded
each chunk's `error` (matching a pre-existing, widespread convention in
this codebase — not newly introduced, but worth closing for the code this
round touched). Every chunk loop and `fetchAllRows()` call across all 26
sites now explicitly checks and surfaces its error. New mock test,
`surveys/__tests__/trigger-lifecycle-ownership-chunking.test.ts` (3 tests,
using a scripted mock whose `.in()` call-index persists ACROSS repeated
`.from('employees')` calls — the first draft of this mock reset the
counter every call and silently never triggered the simulated error):
```
✓ accepts 150 valid ids spanning 2 chunks
✓ rejects a foreign-tenant id placed in the SECOND chunk
✓ surfaces a 500 when a later chunk's query itself errors
  (not silently rejected as INVALID_EMPLOYEES)
```

Full re-verification after this round's corrections: `tsc --noEmit` clean,
`vitest run` 41 files / 334 tests pass. Re-ran all 4 real-stack scripts
from this session (`g13-reconciliation-check.sh` 21/21,
`finalized-slip-value-lockdown-check.sh` 5/5,
`validation-rules-tenant-override-check.sh` 13/13,
`attendance-survey-truncation-check.sh` 7/7) — all still pass.

## 6g. G02/G03/G04/G06/G09/G11 re-verified against current code

Direct code citations, not re-assertions of the audit text:

```
G02  payroll-engine.ts: buildPayrollSlipPreview() — the function containing
     the lop_days > total_working_days warning the audit cited — has ZERO
     callers anywhere in the repo (grepped), including tests. Dead code.
     The real finalize path (runs.ts -> computePayrollSlip) has no
     equivalent check at all (grepped repo-wide for the same condition).
     Worse than "warns but doesn't block": for the real path, no warning
     either, dead or alive.

G03  fnf-settlement-engine.ts:121-129 — comment says "last FINALIZED
     payroll slip"; the query has no .eq('status','finalized') at all.
     Confirmed by direct read.

G04  runs.ts — four-eyes maker_checker_log approval is committed (~line
     2125) before the attendance-staleness guard and freeze-recheck gate
     that run later (~line 2370+); a failure there returns an error with
     no rollback of the already-approved log row.

G06  analytics/reports.ts — zero references to payroll_slips (grepped).
     pf_employee/esi_employee are formula approximations from compensation
     config (ctc_monthly * rate), not the actual finalized deduction.

G09  .github/workflows/e2e.yml triggers: workflow_dispatch + schedule only,
     no pull_request. 05-payroll.spec.ts:108 console.warn()s a muster/
     payroll mismatch instead of failing the assertion.

G11  apps/api/src/plugins/auth.ts: CACHE_TTL = 5*60*1000, IS_ACTIVE_TTL =
     60*1000 — both match the audit's description exactly, unchanged.
```

All six: **confirmed still open**, G02 found to be a more severe gap than
the audit's own text describes.

## 6h. Baseline-migration spot-check (12 of 223 unresolved entries)

Sampled 6 from each of `unbounded-queries-baseline.stable-key.json` and
`tenant-isolation-baseline.stable-key.json`'s `unresolved` lists (seeded
random sample, not cherry-picked) and read the current code at each:

```
filing-pack.ts:112 (employee_bank_statutory)   -> FIXED (chunked + fetchAllRows)
forecast.ts:50 (employee_compensations)         -> FIXED (fetchAllRows)
overtime.ts:302 (attendance_daily)              -> FIXED (fetchAllRows, now ~line 321)
lwf.ts:251 (sites)                              -> present, not chunked — inconclusive,
                                                    not the same occurrence verified
lifecycle-expiry.ts:138 (employee_certifications) -> FIXED (fetchAllRows)
context.ts:102 (payroll_slips)                  -> FIXED (fetchAllRows, x2)
shift-resolution-engine.ts:295 (sites, tenant-isolation) -> FIXED this session (UNB-036)
```

5 of 7 checked cleanly confirmed already-fixed (same stale-register pattern
found repeatedly this engagement); 1 inconclusive (different occurrence,
not individually traced); the rest of the 12-sample and all other entries
not yet checked. Separately: **29 of the 223** unresolved entries cite
`apps/api/src/routes/payroll/index.ts`, now confirmed to be only 57 lines
(down from a multi-thousand-line monolith per its own header comment,
"split out of the former monolithic routes/payroll/index.ts") — these 29
need tracing to wherever that code actually moved, not a simple
present/absent check in the original file.

**This is a 12-of-223 (5%) sample, explicitly not a full audit.** The
pattern is strong and consistent with everything else found this
engagement (stale registers, not silent breakage), but asserting all 223
are closed on this sample size would repeat exactly the kind of
unsupported closure claim this audit has corrected before.

## 6i. First cross-role UAT journey — real Postgres, 4 distinct identities

`scripts/cross-role-ess-payslip-uat.sh`: 1 hr_admin + 3 employees, each
with their own real signed-up auth identity (not simulated roles on one
token). hr_admin finalizes a 2-employee payroll run; each employee calls
`GET /payroll/my-slips` with their own token:

```
=== 1. hr_admin sees the finalized run === ✓
=== 2. Employee A sees exactly their own slip (gross_pay=60000), not B's === ✓✓✓
=== 3. Employee B sees exactly their own slip (gross_pay=45000) === ✓✓
=== 4. Employee C (draft-only slip) sees ZERO slips via ESS === ✓
=== RESULT: 7 passed, 0 failed ===
```

Had to extend the cleanup trap to step `payroll_runs` off `'finalized'`
before deleting — migration 263's lockdown trigger blocks a direct delete
otherwise, the same fix already applied in `g13-reconciliation-check.sh`
and `finalized-slip-value-lockdown-check.sh`. This is one journey (ESS
payslip isolation across roles), not the full admin/HR/manager/employee
matrix Phase 5 still calls for — reported as a start, not completion.

## 7. Real-stack validation — Postgres + PostgREST-shim gateway + real API

Earlier in this pass, `check-schema-drift.mjs` and any real-DB script were
reported as "blocked — Postgres not running." That was imprecise: Postgres
was simply never started, and needs `postgres` OS-user peer auth, not root.
Corrected by actually bringing the stack up:

```
$ service postgresql start
$ sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
$ node /tmp/supabase-gateway.mjs &          # PostgREST-shim, MAX_ROWS=1000 enforced
$ cd apps/api && npx tsx watch --env-file=.env src/index.ts &
$ curl http://localhost:2001/health          # {"status":"ok",...}
```

**Schema drift**, re-run clean:
```
$ sudo -u postgres node scripts/db/check-schema-drift.mjs
Applying migrations…
Introspecting schema…
  478 tables
Auditing apps/api/src + seed script against schema…
✓ No schema drift: every referenced column exists.
```

**g13-reconciliation-check.sh**, re-run clean:
```
$ PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=hrms \
  API_URL=http://localhost:2001 GATEWAY_URL=http://localhost:9000 \
  ./scripts/g13-reconciliation-check.sh
...
=== RESULT: 21 passed, 0 failed ===
=== cleanup ===
tenant ..., auth user ... and its identity row all confirmed removed.
```

**New: scripts/pagination-scale-check.sh** — 1,200 employees (> the 1,000-row
cap), real ESI compute, independent SQL read-back. First run (before the
fix below existed) failed with a genuinely new bug:

```
=== 1. ESI compute against 1200 employees (> the 1,000-row cap) ===
  ✗ HTTP 500 from POST http://localhost:2001/payroll/statutory/esi/contributions/compute
    body: {"error":"DELETE_FAILED","message":"Failed to clean up stale ESI contributions","requestId":"req-6"}
```

Root cause: `esi.ts`'s stale-contribution cleanup
(`.not('employee_id','in', (id1,...,id1200))`) encodes every kept id into
one URL query parameter — ~44,000 characters at 1,200 employees. The
gateway's own log shows nothing for this request at all; it died before
reaching the server. This is `ADD-005` in FINDINGS.csv — fixed in commit
`88c60b5` (chunk the exclusion into `.in()` calls of 100), which also fixed
the identical pattern in `ptax.ts`. Re-run after the fix:

```
=== 0. Fixtures: 1200 employees + finalized slips ===
  ✓ fixture employee count = 1200

=== 1. ESI compute against 1200 employees (> the 1,000-row cap) ===
  compute response: {"computed_count":1200,...,"wages_from_slip":1200,"wages_fallback":0,"month":"2026-12"}
  ✓ computed_count (API response) = 1200

=== 2. Independent SQL read-back (not just the API's own claim) ===
  ✓ persisted esi_contributions row count = 1200
  ✓ sum(employee_contribution) across all 1200 rows = 85500.00
  ✓ employees with esi_wages=0 (the pre-fix truncation signature) = 0
  ✓ distinct esi_wages value (every employee has the same real 9500, not a mix of real + fallback-zero) = 1

=== RESULT: 6 passed, 0 failed ===
=== cleanup ===
tenant ..., 1200 employees, auth user ... and its identity row all confirmed removed.
```

Mutation-tested the same way as the vitest tests: the pre-fix `esi.ts` was
restored (as the committed state at `0bbeb3a`, before `88c60b5`), the script
re-run, confirmed the same `DELETE_FAILED` 500, then the fix was restored
and the script re-run clean a second time to confirm.

**Caveat, stated plainly:** this is real Postgres and a real HTTP transport,
which is why it caught a bug mocks could not. It is still not real
Supabase/PostgREST — `/tmp/supabase-gateway.mjs` is an explicitly-labeled
from-scratch reimplementation of PostgREST's wire behavior (NUMERIC-as-
string, MAX_ROWS=1000, Content-Range headers), not the genuine Supabase
service. The 2,000+ employee real-staging gate in STATUS.md remains open.

## 7b. Concurrency + retry/idempotency — local, not staging-dependent

Per the explicit instruction that local business-flow, concurrency, and
retry testing doesn't need to wait for staging access: added
`scripts/concurrency-retry-check.sh`, run against the same real stack
(Postgres + gateway + API). Fires the identical ESI compute request twice
CONCURRENTLY for the same tenant+month (50 employees), then a third time
serially, and checks the real database state after each — not just the two
HTTP responses.

```
=== 1. Two concurrent compute requests === HTTP 200 / HTTP 200 ✓
=== 2. Post-concurrency database state ===
  persisted row count = 50 (not 100) ✓
  employees with >1 esi_contributions row for the month = 0 ✓
  sum(employee_contribution) = 3562.50 (correct) ✓
=== 3. Serial retry (idempotency) ===
  retry computed_count = 50 ✓
  persisted row count after retry = 50 (unchanged) ✓
  sum(employee_contribution) unchanged after retry ✓
=== RESULT: 7 passed, 0 failed ===
```

Both concurrent requests completed with `HTTP 200`, and the upsert
(`onConflict: 'tenant_id,employee_id,contribution_month'`) correctly
resolved the race with no duplicate rows and the correct total — not
asserted from reasoning about the code, but from the actual row count and
per-employee duplicate check after a real race against real Postgres. The
serial retry confirms idempotency: re-running compute for an unchanged month
does not change the persisted row count or total.

**Scope, stated plainly:** this is one endpoint (ESI compute) at a small
scale (50 employees) with no fault injection — it demonstrates that the
upsert-based retry/concurrency design works under contention on local
Postgres, not that every endpoint in the system is safe under concurrency,
and not backup/restore or mid-failure recovery (those remain genuinely
untested — see STATUS.md Phase 5).

## 8. Exact finding → fix mapping (tenant-isolation, 307-row register)

**0 of the 307 tenant-isolation findings were fixed this pass.** The 3
`CONFIRMED_DEFECT` rows (`payroll/runs.ts:1007,3273,3440`,
`payroll_validation_rules`) are deliberately left open pending the ownership
decision in `STATUS.md` — not silently resolved, not silently left
ambiguous either. No tenant filter was added to any of the three.

## 9. G01, G02, G03, G04, G06 — fixed, mutation-tested, real-stack-validated

Per the explicit later-round instruction ("the original financial blockers
are still open... prioritize those now"), §6g's five re-verified-but-not-fixed
findings (G02/G03/G04/G06, plus G01 traced earlier) were actually fixed and
proven this round — not just traced. Each fix was found and proven by
running the REAL code path (an HTTP endpoint, or an internally-scheduled job
invoked directly when no HTTP route exists), not by inspection alone, and
each has a dedicated `scripts/gNN-*.sh` real-stack reproduction script that
was mutation-tested: run GREEN against the fix, the fix reverted via
`git stash` to confirm RED against the exact failure the audit described,
then restored and re-confirmed GREEN.

### G01 — `leave_accrual_ledger.policy_rule_id` missing column

**The actual patches, not a paraphrase** (both committed, applied to the
live schema, and exercised by the real-stack script below — reproduced
here verbatim rather than described, per the explicit request for patches
and row-level evidence over narration):

`supabase/migrations/440_leave_accrual_ledger_policy_rule_id.sql`:
```sql
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS policy_rule_id UUID REFERENCES leave_policy_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_accrual_ledger_policy_rule_id
  ON leave_accrual_ledger (policy_rule_id)
  WHERE policy_rule_id IS NOT NULL;
```
Closes the missing column `leave-jobs.ts`'s four insert paths always wrote.
Migration 163 added a same-named column to a *different* table
(`leave_policy_snapshots`) — confirmed by reading 163's own `CREATE TABLE`
statement — `leave_accrual_ledger` itself never received it.

`supabase/migrations/441_leave_accrual_ledger_cycle_key_full_unique.sql`:
```sql
DROP INDEX IF EXISTS uidx_lal_cycle_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_lal_cycle_key
  ON leave_accrual_ledger (cycle_key);
```
**A second, independently-discovered bug in the same code path**, found
while building the real-stack reproduction below: migration 163's
`uidx_lal_cycle_key` was a PARTIAL unique index
(`WHERE cycle_key IS NOT NULL`) — Postgres cannot match a partial index to
an `ON CONFLICT(cycle_key)` target with no `WHERE` clause (PostgREST's
generated upsert has no such clause), so every cycle_key-based upsert
across `leave-jobs.ts`'s monthly/yearly accrual (L497, L849) and
`leave-ledger-service.ts`'s `writeAccrualEntry()` (L504) was broken
independent of the missing column — the exact "reports success while
crediting nobody" failure mode, via an independent root cause. A full
(non-partial) index has identical semantics for NULL rows (standard
Postgres unique-index behavior already treats every NULL as distinct) and
fixes ON CONFLICT inference for the non-null rows that matter.
- `scripts/g01-leave-accrual-ledger-check.sh` invokes the real
  `monthlyAccrualJob()` (not a unit test — the actual function the scheduler
  calls) against a real tenant/employee/policy fixture:
  ```
  job result: {"job_id":"unknown","job_type":"monthly_accrual","status":"completed",
    "employees_processed":1,"total_days_credited":2,"skipped":0,"errors":[],"duration_ms":89}
  ✓ employees_processed = 1 (the real eligible employee) = 1
  ✓ total_days_credited = 2 (24 days/year / 12 months) = 2
  ✓ leave_accrual_ledger has exactly one row crediting 2 days = 2.0
  ✓ employee_leave_balance reflects the credited 2 days = 2.0
  RESULT: 4 passed, 0 failed
  ```
  Mutation test (`--simulate-missing-column` drops the column, re-adds it
  after): RED (`employees_processed: 0`) with the column dropped, GREEN
  (4/4) restored.

### G02 — impossible LOP (`lop_days > total_working_days`) had no live warning path

- `buildPayrollSlipPreview()` (the function the audit's citation points to)
  is confirmed dead code (zero callers repo-wide, §6g). The real finalize
  path had NO equivalent check. `runs.ts` now raises a non-blocking
  `LOP_EXCESSIVE` `payroll_run_blocker` for the affected employee using the
  existing (previously unreachable) blocker mechanism, without excluding
  them from the run or affecting finalize eligibility.
- **Two more real bugs found and fixed while reproducing this through the
  real `POST /payroll/runs` endpoint** (found by running into them, not
  assumed):
  - `statutory-payroll.ts`'s `grossWages`/`payableFraction`/`pfWages` (wage
    base feeding EPF/ESI/PTax/LWF) were computed as `gross_pay - lop_amount`
    with no floor at 0 — once `lop_amount` exceeds `gross_pay` (this exact
    scenario), the wage base goes negative, producing a genuinely negative
    `employer_contributions` that failed slip validation and crashed the
    whole run for that employee. Fixed with `Math.max(0, ...)` at both
    wage-base computations.
  - `payroll-blocker-engine.ts`'s `LOP_EXCESSIVE` classification pattern
    (`/lop_days.*exceed/i`) required a literal underscore and never matched
    the actual human-readable message text ("LOP days (X) exceed..."), so
    the new blocker fell through to the critical/blocking `PAYROLL_NAN`
    fallback instead of the intended warning/non-blocking rule. Fixed the
    pattern to match both phrasings.
- A **test-infrastructure-only** bug was also found and fixed (not a product
  defect, not committed to the repo): `/tmp/supabase-gateway.mjs` (this
  sandbox's local PostgREST stand-in) mishandled RPC calls to
  scalar-JSON-returning Postgres functions, which broke
  `get_active_employees_for_payroll` and revealed that `POST /payroll/runs`
  — the main per-employee payroll engine — had never actually been exercised
  end to end through the real HTTP API by any script in this entire
  engagement before this one.
- `scripts/g02-lop-exceeds-working-days-check.sh` seeds "absent" attendance
  for every calendar day of a month (weekends included), drives the real
  `POST /payroll/runs`, polls to completion, and reconciles the persisted
  slip plus the new blocker's row and classification:
  ```
  persisted slip: lop_days=30.00 total_working_days=22 gross_pay=30000.00
    total_deductions=30000.00 net_pay=0.00 employer_contributions=0.00
  ✓ lop_days (30.00) > total_working_days (22) — reproduced via the real endpoint
  ✓ total_deductions is capped at gross_pay = 30000.00
  ✓ net_pay is floored at 0 = 0.00
  ✓ employer_contributions wage base is floored at 0 = 0.00
  ✓ payroll_run_blockers has a LOP_EXCESSIVE row, blocking=false, status=open
  ✓ a slip was created for this employee (warn, not exclude) = 1
  ✓ no OPEN blocking=true blockers remain — finalize's Open-blockers gate would NOT reject it
  RESULT: 11 passed, 0 failed
  ```
  Mutation test (all three fixes reverted together via `git stash`): RED —
  the run fails outright (`final run status: failed`), 10/11 assertions red,
  exactly reproducing the negative-wage-base crash. Restored: 11/11 green.

### G03 — F&F salary basis could read a draft slip instead of the finalized one

- `fnf-settlement-engine.ts`'s salary-basis query selected the most recent
  `payroll_slips` row by month with **no status filter**, despite the
  adjacent comment saying "last **finalized** payroll slip" — a newer DRAFT
  slip could outrank an older FINALIZED slip purely by month. Fixed by
  adding `.eq('status', 'finalized')`.
- `scripts/g03-fnf-settlement-last-finalized-slip-check.sh` seeds an older
  finalized slip (gross=50000, BASIC=25000) and a newer draft slip
  (gross=99999, BASIC=77777) for the same employee, then drives the real
  `POST /employees/:id/separation-ff/compute`:
  ```
  ✓ salary_basis_gross reflects the finalized slip (50000), not the newer draft (99999) = 50000
  ✓ salary_basis_basic reflects the finalized slip's BASIC (25000), not the newer draft's (77777) = 25000
  RESULT: 2 passed, 0 failed
  ```
  Mutation test: reverting the `.eq('status','finalized')` filter reproduces
  the draft slip winning (`salary_basis_gross=99999`, 0/2 red); restored:
  2/2 green.

### G04 — maker-checker approval was committed before gates that could still reject finalize

- `runs.ts` wrote the maker-checker approval/auto-approval row to
  `maker_checker_log` BEFORE the attendance-closure, attendance-completeness,
  open-blockers, validation-run, and staleness-recompute gates — any of
  which (plus the freeze-recheck immediately before the real mutation) can
  still reject the finalize request, leaving a log row claiming "approved"
  for a finalize that never happened, with no rollback. Fixed by splitting
  the block: validation (reject fast for `AWAITING_DIFFERENT_CHECKER` /
  `PREPARER_CANNOT_APPROVE`) stays early since those are true regardless of
  later gates; the actual commit is deferred into a closure
  (`commitMakerCheckerApproval`) invoked only immediately before Step 1 (the
  real slip/run mutation), once every other gate has passed. No rollback is
  needed because the row is never written until finalize is genuinely about
  to succeed.
- `scripts/g04-maker-checker-approval-ordering-check.sh` drives the real
  endpoint through the exact failure mode: a maker proposes finalize on a
  run whose month's attendance isn't locked; a distinct checker's approval
  attempt is rejected by the attendance-closure gate (423); the script then
  clears the remaining gates and has the same checker retry, which
  genuinely succeeds:
  ```
  maker call: HTTP 202 — PENDING_CHECKER
  ✓ maker_checker_log is 'pending' after the proposal
  checker call (attendance open): HTTP 423 — ATTENDANCE_NOT_LOCKED
  ✓ maker_checker_log is STILL 'pending' (not falsely flipped to approved)
  ✓ checker_id is still unset (no approval was committed)
  ✓ the run itself is still 'draft'
  checker retry (attendance locked, validation cleared): HTTP 200
  ✓ the run is now genuinely finalized
  ✓ ONLY NOW does maker_checker_log flip to 'approved'
  ✓ checker_id correctly records the checker who actually caused the finalize to succeed
  RESULT: 10 passed, 0 failed
  ```
  Mutation test: reverting the fix reproduces `maker_checker_log` flipping
  to `approved` immediately after the maker's proposal, even though the
  checker's call was then rejected by the attendance gate (5/10 red);
  restored: 10/10 green.
- **Incidental discovery, noted not fixed (out of scope):** a tenant that
  reaches a genuine finalize success cannot be hard-deleted afterward —
  `fastify.eventPublisher.publish(...)` in the finalize success path writes
  an immutable `platform_events` row, and `trg_platform_events_no_delete`
  blocks ANY delete of it, even one cascading from `DELETE FROM tenants` via
  `platform_events_tenant_fk`'s `ON DELETE CASCADE`. This is a real,
  by-design append-only audit log, not a test defect — but it means
  hard-delete-tenant (`owner/index.ts`) is structurally unable to fully
  remove any tenant that has ever finalized a payroll run. Flagged for a
  human decision, not fixed here — out of scope for G04.

### G06 — statutory compliance report used a CTC formula guess instead of real contributions

- `/reports/statutory` computed PF as "~50% of CTC as basic (capped at
  15,000) × 12%" and ESI as "0.75%/3.25% of CTC if ≤ 21,000" — a formula
  approximation off `employee_compensations.ctc_monthly` — instead of
  reading the REAL contribution amounts already computed and persisted in
  `epf_contributions`/`esi_contributions` (the same tables `filing-pack.ts`
  reads for actual EPFO/ESIC filing). Fixed by requiring a `month` query
  param and reading those tables for that month, keyed by employee_id.
- `scripts/g06-statutory-report-real-contributions-check.sh` seeds an
  employee whose CTC (50,000) would produce PF=1800/1800 and "ESI not
  applicable" under the old formula, plus a REAL contribution row for the
  report month with deliberately different numbers (as if arrears/LOP/a
  statutory override made the real computation diverge):
  ```
  ✓ pf_employee_monthly = REAL 2500 (NOT the formula's 1800) = 2500
  ✓ pf_employer_monthly = REAL 1916 total employer (1300+541+75) (NOT the formula's 1800) = 1916
  ✓ esi_applicable = true (REAL is_eligible, even though CTC is above the naive 21000 cutoff) = true
  ✓ esi_employee_monthly = REAL 135 (the formula would have said ESI does not apply at all) = 135
  ✓ esi_employer_monthly = REAL 585 (the formula would have said ESI does not apply at all) = 585
  RESULT: 6 passed, 0 failed
  ```
  Mutation test: reverting the fix reproduces the exact formula numbers
  (PF 1800/1800, ESI not applicable, 0/6 red); restored: 6/6 green.

### Full regression sweep after all five fixes

`cd apps/api && npx tsc --noEmit` clean and `npx vitest run` — 41 files /
334 tests passing, unchanged — after each individual fix, and again after
all five together. All nine real-stack scripts (the five `gNN-*.sh` scripts
above, plus `g13-reconciliation-check.sh`,
`finalized-slip-value-lockdown-check.sh`,
`validation-rules-tenant-override-check.sh`,
`attendance-survey-truncation-check.sh`, and
`cross-role-ess-payslip-uat.sh`) were re-run against the same live stack
after the last fix landed: **all nine green, zero regressions**
(70 total assertions across the four pre-existing scripts, 33 across the
five new ones).

**One sandbox-specific gotcha surfaced and worth recording:** this
environment's `tsx watch` file-watcher silently stopped picking up file
changes partway through this round (confirmed by comparing a restart
timestamp in its own log against the edited file's actual mtime) — several
early mutation-test cycles were run against stale code without that being
obvious from the outside (the health endpoint still returns 200 either
way). Fixed by explicitly `pkill -f "tsx watch"` + relaunch (as two separate
shell calls, never combined — combining has previously been found to
silently fail the relaunch) before every subsequent mutation-test cycle,
and by cross-checking the restart log's timestamp against the edited file's
`stat` mtime before trusting a "confirmed RED/GREEN" result. Any earlier
run in this round that looked anomalously unchanged should be treated as
possibly stale; the final RED→GREEN pairs recorded above were all taken
after this was caught and corrected.

## 9b. Correction round — G02/G03/G04/G06 first passes were insufficient; closed properly

A review of §9 above correctly rejected all four of G02/G03/G04/G06 as
reported there: each first pass fixed only the half of the finding that was
easiest to reach, and left the half that actually mattered — blocking
behaviour, stale-calculation invalidation, exact commit ordering under
failure, and the frontend consumer — either unfixed or untested. This
section documents what changed in response. §9 above is left unmodified as
the historical record of the first pass; this section is the current,
correct state and supersedes it wherever the two disagree.

### G02 — correction: a visible warning is not a release blocker

The §9 fix left `LOP_EXCESSIVE` as `severity:'warning'`/`blocking:false` —
finalize could proceed regardless of how impossible the LOP count was. That
is not what a P0 release blocker requires. Fixed in
`payroll-blocker-engine.ts`:

```ts
LOP_EXCESSIVE: {
  code: 'LOP_EXCESSIVE',
  name: 'Excessive LOP Days',
  description: 'LOP days exceed total working days for the period.',
  severity: 'critical',
  blocking: true,
  stage: 'slip_validation',
  remediation_route: '/admin/attendance/muster-roll',
},
```

This routes it through `runs.ts`'s existing Open-blockers gate, which now
rejects finalize with `422 OPEN_BLOCKERS` by default. The escape hatch is
the pre-existing `force_finalize` + `override_reason` mechanism
(super_admin-gated, dual-control — the maker cannot be the one who
overrides). Using it now persists onto the specific blocker row, not just a
log line:

```ts
const { error: overrideBlockerErr } = await fastify.supabase
  .from('payroll_run_blockers')
  .update({
    status:          'ignored',
    resolved_by:     req.userId,
    resolved_at:     new Date().toISOString(),
    resolution_note: `force_finalize override: ${override_reason ?? '(no reason provided)'}`,
  })
  .in('id', openBlockers!.map((b: any) => b.id))
```

`scripts/g02-lop-exceeds-working-days-check.sh` was rewritten to drive this
through the real endpoint with two distinct `super_admin` identities (maker
and checker), pre-clearing the attendance-lock and validation-run gates so
the test isolates `LOP_EXCESSIVE` specifically:

```
maker call: HTTP 202 — PENDING_CHECKER
checker call (no override): HTTP 422 — OPEN_BLOCKERS
✓ checker's unprivileged attempt is REJECTED — run stays draft, maker_checker_log stays pending
checker call (force_finalize + override_reason): HTTP 200 — finalized
✓ payroll_run_blockers row: status=ignored, resolved_by=<checker>, resolution_note contains the override reason
RESULT: 19 passed, 0 failed
```

Mutation test (reverting `blocking:true`→`false`): the checker's
unprivileged call now wrongly returns 200 instead of 422 — RED; restored:
19/19 green.

### G03 — correction: proving staleness invalidation, not just the salary source

The §9 fix stopped `fnf-settlement-engine.ts` from reading a draft slip
instead of a finalized one, but did nothing about a settlement that was
already computed and is pending approval when a LATER change (a correction,
or a slip that gets finalized afterward) invalidates the numbers it was
computed from. `separation-workflow.ts`'s `PATCH /approve` now re-runs
`computeFnfSettlement()` when the record has a `computed_at` (nothing to
recompute for a pure manual entry) and compares the fresh salary basis
against what's stored:

```ts
if (ff.computed_at) {
  const fresh = await computeFnfSettlement(fastify.supabase, req.tenantId, req.params.id)
  if ('error' in fresh) {
    return reply.code(409).send({ error: 'RECOMPUTE_FAILED', message: `Cannot verify this settlement is still current: ${fresh.error}. Resolve the issue and recompute before approving.` })
  }
  const basisChanged =
    Math.abs(Number(fresh.salary_basis_gross) - Number(ff.salary_basis_gross ?? 0)) > 0.01 ||
    Math.abs(Number(fresh.salary_basis_basic) - Number(ff.salary_basis_basic ?? 0)) > 0.01
  if (basisChanged) {
    return reply.code(409).send({
      error: 'STALE_CALCULATION',
      message: 'The settlement inputs have changed since this was last computed (e.g. a corrected or newly finalized payroll slip). Recompute via POST /separation-ff/compute and review the updated figures before approving.',
      stored_salary_basis_gross: ff.salary_basis_gross,
      stored_salary_basis_basic: ff.salary_basis_basic,
      current_salary_basis_gross: fresh.salary_basis_gross,
      current_salary_basis_basic: fresh.salary_basis_basic,
    })
  }
}
```

`scripts/g03-fnf-settlement-last-finalized-slip-check.sh` was extended:
after the original compute (picks up the finalized slip, gross=50000), the
previously-draft slip is finalized with divergent numbers (gross=99999),
then:

```
PATCH /approve (before recompute): HTTP 409 — STALE_CALCULATION
  stored_salary_basis_gross=50000.00 current_salary_basis_gross=99999.00
✓ approval is rejected; F&F record stays 'draft', not falsely approved
POST /compute (recompute): picks up 99999
PATCH /approve (after recompute): HTTP 200 — status=approved
RESULT: 9 passed, 0 failed
```

Mutation test (reverting the staleness block): the first `PATCH /approve`
call wrongly returns 200 against the stale 50000 basis instead of 409 — RED;
restored: 9/9 green.

### G04 — correction: the commit was still one failure point too early

The §9 fix moved the maker-checker commit from "before all the finalize
gates" to "immediately before Step 1" — which closed the original gap but
left the *same class* of bug one layer deeper: a failure in Step 1 itself,
or in Step 2 (the atomic `payroll_runs` status seal,
`.in('status',['draft','partial_failed'])` + row-count check), could still
leave `maker_checker_log` claiming "approved" for a finalize that did not
durably happen. The commit is now deferred until immediately AFTER Step 2's
success check — the only point at which finalize is guaranteed to have
actually gone through — in `runs.ts`:

```ts
// G04: commit the maker-checker approval/auto-approval NOW — only here,
// after Step 1 AND Step 2 have both durably succeeded.
{
  const { error: mcCommitError } = await commitMakerCheckerApproval()
  if (mcCommitError) {
    req.log.error({ err: mcCommitError, run_id: id }, 'payroll finalize: four-eyes approval commit failed AFTER the run was durably finalized (non-fatal)')
    await logRunEvent(fastify.supabase, req.log, {
      tenant_id: tenantId, run_id: id, event_type: 'maker_checker_commit_failed',
      payload: { stage: 'finalize_post_seal' },
      error_details: { message: String((mcCommitError as any)?.message ?? mcCommitError) },
    })
  }
}
```

placed right after the `RUN_STATE_CHANGED` conflict-check that follows
Step 2's atomic update, and before the statutory-contributions step. A
failure there is forensic-logged only — finalize has already genuinely
succeeded by then, and `ALREADY_FINALIZED` blocks re-entry, so there is no
retry path for the commit itself to fail into.

`scripts/g04-maker-checker-approval-ordering-check.sh` gained two new
sections, exactly matching the review's demand to test "downstream failure,
retry, and concurrency, not just passing preliminary gates":

- **§6 (downstream failure + retry):** every finalize gate pre-cleared, then
  `payroll_runs.status` is flipped to `'processing'` by direct SQL between
  the maker's proposal and the checker's call — a value that passes the
  top-of-handler checks but fails Step 2's `draft`/`partial_failed` filter:
  ```
  checker approve while run is mid-flight (status=processing): HTTP 409 — RUN_STATE_CHANGED
  ✓ maker_checker_log is STILL pending — the downstream Step 2 failure did not commit a false approval
  checker retry after the run is restored to draft: HTTP 200 — finalized
  ✓ ONLY on the successful retry does maker_checker_log flip to approved
  ```
- **§7 (concurrency):** two simultaneous `curl` calls to the same
  checker-approve endpoint on the same run:
  ```
  concurrent call A: HTTP 200 — finalized
  concurrent call B: HTTP 409 — RUN_STATE_CHANGED
  ✓ exactly one of the two concurrent approve calls won (200)
  ✓ run ends up finalized exactly once
  ✓ exactly one maker_checker_log row exists for this run, and it is 'approved' — not duplicated by the race
  ```
- Full result: `RESULT: 22 passed, 0 failed`.

Mutation test against the exact prior-round code the review flagged
(commit call restored to immediately before "Step 1: Finalize draft
slips"): §6 and §7 both go RED — the mid-flight failure and the losing
concurrent call both leave `maker_checker_log` already flipped to approved
even though Step 2 rejected them; restored: 22/22 green.

### G06 — correction: a backend fix nobody could actually reach

The §9 fix made `/reports/statutory` require a `month` param and read the
real contribution tables, but its only real consumer —
`apps/web/.../Reports.tsx`'s `StatutoryReport` tab — had no month state at
all, so every request from the actual UI would have 400'd. Wired in
`usePayrollMonthState()` (the same anchor-based hook five other tabs on the
same page already use; backed by `GET /datasets/payroll-cost/anchor`, "the
latest month that actually has finalized payroll slips" — directly
answering "does it reconcile to the intended finalized payroll period"):

```tsx
function StatutoryReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [month, setMonth] = usePayrollMonthState()
  ...
  <FilterField label="Contribution month">
    <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs w-36" />
  </FilterField>
```

Verified in a real browser (Playwright against the pre-installed chromium
binary, not a `tsc`/lint pass): signed up a fresh `hr_admin` through the
real signup flow, logged in through the real login form, navigated to the
tab, and confirmed against seeded real contribution rows (deliberately
divergent from the old CTC formula) that the month input defaults correctly
and the rendered PF/ESI figures are the real ones — ESI shown as applicable
at a CTC level the old formula would have excluded, visible proof the real
backend contract is actually wired into the page a user would load, not
just a passing type-check.

### Net effect

All four corrections were verified the same way as every other fix in this
engagement: reproduce the exact gap the review named against the real
stack, write/extend a script that proves it, confirm RED on the
pre-correction code, confirm GREEN after. None of the four are now reported
as closed solely on the strength of the §9 narration above — §9's own
evidence only ever covered half of each finding, which is exactly what the
review caught.

## 10. Coverage mapping — every FIXED `UNB-*` finding, individually, not a blanket claim

Per the explicit instruction: "the attendance/survey script validates
selected workflows, not all 24 fixes. Keep evidence mapped to individual
findings." §6e's "24 fixed... no new per-site test... this matches how
every other mechanical pagination fix was handled" was true as written but
easy to over-read as "the attendance/survey script covers this batch" — it
doesn't, except for the two findings (`UNB-042`, `UNB-044`) it was written
for. This section maps **all 47** `FIXED` `UNB-*` rows in `FINDINGS.csv`
individually, not just the 24-ish batch, and corrects two rows whose
blanket "no dedicated per-site test" label undersold real coverage that
exists elsewhere.

**Category A — dedicated per-site test (named, exercises this exact
file:line's endpoint):**

| UNB-id | File:Line | Test |
|---|---|---|
| UNB-112 | `filing-pack.ts:114` | `filing-pack-24q-pagination.test.ts` |
| UNB-113 | `filing-pack.ts:265` | `filing-pack-readiness-pagination.test.ts` |
| UNB-114 | `filing-pack.ts:290` | `filing-pack-readiness-pagination.test.ts` |
| UNB-115 | `filing-pack.ts:302` | `filing-pack-readiness-pagination.test.ts` |
| UNB-128 | `statutory/epf.ts:382` | `epf-wage-base-pagination.test.ts` |
| UNB-129 | `statutory/epf.ts:423` | `epf-wage-base-pagination.test.ts` |
| UNB-131 | `statutory/esi.ts:404` | `esi-wage-base-pagination.test.ts` |
| UNB-132 | `statutory/esi.ts:437` | `esi-wage-base-pagination.test.ts` |
| UNB-134 | `statutory/ptax.ts:494` | `ptax-wage-base-pagination.test.ts` |
| UNB-135 | `statutory/ptax.ts:512` | `ptax-wage-base-pagination.test.ts` |
| UNB-137 | `statutory/tds-bulk.ts:483` | `tds-reconciliation-pagination.test.ts` |
| UNB-149 | `surveys/index.ts:806` (`/admin/trigger-lifecycle`) | `trigger-lifecycle-ownership-chunking.test.ts` (3 cases: 150 ids/2 chunks, foreign-tenant id in 2nd chunk rejected, chunk-query error surfaced as 500) — **correction**: `FINDINGS.csv`'s "no dedicated per-site test" label for this row is wrong; this test targets `POST /admin/trigger-lifecycle` directly. |

**Category B — real-stack script coverage (named step, real Postgres + real
API, not a mock):**

| UNB-id | File:Line | Script : step |
|---|---|---|
| UNB-042 | `attendance/confidence.ts:88` | `attendance-survey-truncation-check.sh` §1 — 1,200-row single-employee fixture, asserts `total_days=1200`/`critical_days=120` (not the 1,000-row cap); mutation-tested RED (1000/100) → GREEN |
| UNB-044 | `attendance/context.ts:70` | `attendance-survey-truncation-check.sh` §2 — 60-employee missing-punches fixture, asserts `count=60` (true total) ≠ `employees.length=50` (capped display) |
| UNB-150 | `surveys/index.ts:854` (`/admin/:id/360/setup`) | `attendance-survey-truncation-check.sh` §3 — 105 ids (104 real + 1 foreign at position 105, past the first 100-id chunk boundary), asserts `POST /admin/:id/360/setup` still rejects `INVALID_EMPLOYEES` — **correction**: `FINDINGS.csv` doesn't currently credit this row with the script at all; it does cover it. |

**Category C — self-documented as NOT covered (already honest in
`FINDINGS.csv`, no correction needed):**

| UNB-id | File:Line | Why |
|---|---|---|
| UNB-127 | `statutory-recon.ts:76` | `FINDINGS.csv`'s own note: "sum-correctness only, not yet covered." Confirmed: `g13-reconciliation-check.sh` exercises ESI/EPF/PTax wage-base and filing-pack challan endpoints, but never calls `GET /payroll/statutory-reconciliation` (the endpoint this line belongs to) — the self-assessment is accurate, not a gap this pass closes. |

**Category D — generic suite only (`tsc --noEmit` + `vitest run`, 41
files/334 tests, plus the shared `fetchAllRows()`/chunk-by-100 helper's own
tests in `supabase-paginate.test.ts`) — no test exercises this specific
file:line's endpoint:**

```
UNB-003  absconding-engine.ts:904        UNB-006  assistant-tools.ts:786
UNB-010  attendance-engine.ts:1319       UNB-022  import-engine/validator.ts:1265
UNB-023  import-engine/validator.ts:1298 UNB-024  intelligence-scanner.ts:625
UNB-026  intelligence-scanner.ts:899     UNB-030  org-context.ts:358
UNB-036  shift-resolution-engine.ts:323  UNB-038  attendance/anomalies.ts:144
UNB-039  attendance/anomalies.ts:163     UNB-041  attendance/comp-off.ts:141
UNB-043  attendance/confidence.ts:205    UNB-047  attendance/health-index.ts:499
UNB-053  attendance/leave.ts:1147        UNB-054  attendance/leave.ts:1171
UNB-061  attendance/overtime.ts:345      UNB-063  attendance/wo-credit.ts:208
UNB-064  attendance/work-sessions.ts:65  UNB-068  compensation/revisions.ts:826
UNB-083  executive/index.ts:1037         UNB-096  manager/team-payroll-cost.ts:127
UNB-097  masters/leave-policy-assignments.ts:119
UNB-105  payroll/arrears.ts:157          UNB-106  payroll/arrears.ts:243
UNB-119  payroll/ops-dashboard.ts:490    UNB-121  payroll/runs.ts:2228
UNB-122  payroll/runs.ts:2367            UNB-124  payroll/runs.ts:3421
UNB-142  payroll/variable-pay.ts:242     UNB-146  recognition/index.ts:873
```
(32 rows.) These are mechanical conversions (unbounded tenant-wide scan →
`fetchAllRows()`, or an unbounded `.in()` lookup → chunk-by-100) using a
pattern already proven correct by the tests in Category A, but **that does
not substitute for per-site verification**: a copy-paste error in any one
of these 32 call sites (wrong column name, wrong tenant filter, an
off-by-one in the chunk loop) would not be caught by any test in this
repository today. This is the honest state of coverage, not a blanket
"tested" claim.

**Net correction to §6e/6f's framing:** 11 rows have a dedicated unit test,
3 have real-stack-script coverage (one of which, UNB-150, was previously
uncredited), 1 is self-documented as genuinely uncovered, and 32 rely
entirely on the generic suite plus the shared pattern's own tests. A human
deciding whether to treat "all 47 UNB fixes" as release-ready should weigh
those 32 differently from the 15 with direct evidence.

## 11. COMPLETE reconciliation of all 223 baseline-migration "unresolved" entries

§6h's 12-of-223 spot-check explicitly said a human or future session should
extend it before treating the rest as closed. This section is that
extension, done completely, not sampled: all 151 `unresolved` entries in
`unbounded-queries-baseline.stable-key.json` plus all 72 in
`tenant-isolation-baseline.stable-key.json` (151+72 = 223), individually.

**Row-level evidence, not narration**:
`docs/production-readiness/baseline-reconciliation-223-rows.csv` — all 223
entries, one row each, with `automated_classification` (what
`scripts/reconcile-baselines.py` found), `final_classification` (`FIXED` or
`MOVED_AND_FIXED`), `verification_method` (`automated-regex-match` for 163,
`manual-code-read` for the 60 the script couldn't resolve), and for every
one of those 60 a `manual_note` citing exactly what the cited line turned
out to be and where the real, fixed query actually lives. This is the file
to open to check any individual entry's basis — the prose below is a
summary of it, not a substitute for it.

**Method** (`scripts/reconcile-baselines.py`, committed): file:line:table
keys drift as files are edited (already documented as ADD-004's own
finding-fingerprint-instability bug — confirmed concretely here too: dozens
of cited lines now land on blank lines, comments, or unrelated code). So
rather than trust the cited line, the script finds every `.from('TABLE')`
occurrence in the current file and checks a ±25-line window around each
for `fetchAllRows()`/`.range()`/chunk-by-100 (unbounded-queries) or
`.eq('tenant_id', ...)` (tenant-isolation). This is a deterministic,
full-coverage pass — not a sample — but it is pattern-matching, not human
judgment, so every entry it couldn't confidently resolve was then read
directly:

```
unbounded-queries (151):     tenant-isolation (72):
  FIXED_LIKELY:  114           FIXED_LIKELY:  49
  STILL_OPEN:     23           STILL_OPEN:     8
  NO_FROM_MATCH:  14           NO_FROM_MATCH: 15
```
163 FIXED_LIKELY (deterministic regex match against current code — a real
verification, not a trust-the-register claim), 29 NO_FROM_MATCH (all 29 are
`apps/api/src/routes/payroll/index.ts` — the file the barrel comment at the
top of the current `payroll/index.ts` confirms "used to hold all payroll
run/slip/accounting/forensics routes directly (5,783 lines, 58 routes)"
before being split into 12 sibling files), and 31 STILL_OPEN that the
regex window missed.

**All 31 STILL_OPEN entries were then read directly** (not sampled) —
every single one turned out to be a heuristic false negative, for one of
three reasons, never a genuine remaining defect:

```
1. Severe line drift — the cited line now lands on unrelated code (a blank
   line, a comment, an adjacent zod schema field); the real query sits
   elsewhere in the same file, already tenant-scoped/paginated. E.g.
   ess/team.ts:121 (cited line is blank — the real employees queries at
   lines 54-82 are tenant_id-scoped AND the roster's "N people" count comes
   from a dedicated count:exact query, not the capped display array — a
   comment there cites this directly as "F21"); helpdesk/index.ts:482
   (cited line is the response for a DIFFERENT table's query (profiles);
   the real helpdesk_tickets UPDATE at line 428 is `.eq('id', id).eq(
   'tenant_id', req.tenantId)`); recruitment/index.ts, succession/index.ts,
   intelligence/index.ts, datasets/payroll-cost.ts, datasets/statutory.ts,
   ops-dashboard.ts, epf.ts, filing-pack.ts, lwf.ts, assistant-tools.ts,
   variable-pay.ts, compensation/revisions.ts, pre-joinee.ts, surveys/
   index.ts — same pattern, every one checked directly against current code.
2. Single-row operations that were never a real unbounded-scan risk at that
   exact line to begin with (an `.insert()`/`.update()`/`.select()...
   maybeSingle()` scoped by a primary key or a unique id), which the
   original checker's static pattern-match flagged structurally but which
   cannot return more than one row regardless of tenant size.
3. A deliberately bounded, capped-with-explicit-truncation-signal design —
   the exact F21/UNB-044 pattern, just at a different site:
   `intelligence/index.ts`'s AI-assistant natural-language employee-filter
   tool caps every branch at `.limit(50)` and returns `count:
   normalizedEmployees.length`, which looks exactly like UNB-044's bug on
   first read — but the response also carries `truncated: normalizedEmployees.
   length === 50` with a comment citing exactly this risk ("a tenant with 80
   matches would otherwise silently show '50 results found'"), so the
   undercount is signaled, not silent. Not a defect.
```

**The 29 `NO_FROM_MATCH` (`payroll/index.ts`) entries** were traced by
table name across all 12 split files (`runs.ts`, `slips.ts`,
`validation-rules.ts`, `forensics.ts`, `statutory-recon.ts`,
`approval-stages.ts`, `payout-batches.ts`, `snapshots.ts`, `integrity.ts`,
`run-ledgers.ts`, `accounting.ts`, `run-diagnostics.ts`) plus two files
registered separately from the barrel but handling the same tables
(`validation.ts`, `lib/payroll-validation-rules.ts`). Every table this
batch cites — `payroll_slips`, `attendance_daily`, `employees`,
`leave_requests`, `payroll_validation_rules`, `payroll_run_blockers`,
`payroll_runs`, `profiles`, `statutory_filing_closures`, `epf_contributions`
— was checked at its new home(s):

```
payroll_slips    -> slips.ts (4x), run-diagnostics.ts (2x), payout-batches.ts (2x),
                    statutory-recon.ts (1x) -- every one fetchAllRows()/maybeSingle()
                    + .eq('tenant_id', ...)
attendance_daily -> runs.ts's finalize attendance-completeness gate (already read
                    directly for the G04 fix, this engagement) -- fetchAllRows()
employees        -> runs.ts's same gate -- chunked by 100, .eq('tenant_id', ...)
leave_requests   -> runs.ts's staleness guard (already read directly for G04) --
                    fetchAllRows()
payroll_validation_rules -> validation.ts / lib/payroll-validation-rules.ts --
                    both .eq('tenant_id', ...) (or the deliberate global/tenant
                    split built for ADD-003)
payroll_run_blockers -> runs.ts, 5 occurrences, all .eq('tenant_id', tenantId)
payroll_runs     -> runs.ts, 20+ of 30 occurrences tenant_id-scoped within 3 lines
profiles         -> forensics.ts -- .in(actorIds) against an already-bounded,
                    internally-sourced id list, not a tenant-wide scan
statutory_filing_closures -> statutory-recon.ts -- .eq('tenant_id', tenantId)
epf_contributions -> exports.ts / filing-pack.ts / ops-dashboard.ts, each
                    fetchAllRows() + .eq('tenant_id', ...)
```
All 29 are FIXED in their new home. None required a new fix this pass —
the split-and-rewrite that created `runs.ts`/`slips.ts`/etc. already
applied the same `fetchAllRows()`/chunk-by-100/`tenant_id` conventions
used everywhere else in this codebase.

**Net result — every one of the 223 entries accounted for, none closed by
omission:**

| Bucket | Count | Disposition |
|---|---|---|
| FIXED_LIKELY (deterministic regex match) | 163 | Already fixed; register is stale |
| STILL_OPEN → read directly, all resolved | 31 | Already fixed or never a defect at that line (see 3 reasons above); register is stale |
| NO_FROM_MATCH → traced to its new file | 29 | Moved during the `payroll/index.ts` split, already fixed there |
| **Total** | **223** | **Zero genuine open defects found** |

**This does not mean the frozen baseline files should be edited.** Per the
standing never-regenerate-to-hide-findings rule, `unbounded-queries-
baseline.json`/`.stable-key.json` and `tenant-isolation-baseline.json`/
`.stable-key.json` are untouched by this pass — this section is a
reconciliation report against them, not a change to them. A human still
needs to decide whether to act on this (e.g. regenerate the live baselines
now that every unresolved entry has been individually traced, closing
item 5/`ADD-004`'s "flip `--stable-key` to default" question from
`STATUS.md`) — that decision is deliberately left to a human, not made
here.

**Honesty about method, not a claim of infallibility:** the 163
`FIXED_LIKELY` entries were verified by a deterministic script reading
actual current file content, not by a human reading each one — that is
real evidence (stronger than trusting a stale register), but a regex match
is not the same thing as a human confirming the fix is semantically
correct for that exact finding; a small number of false positives there
(a bounding pattern present nearby but for a different, unrelated query
against the same table) remain possible and were not individually
re-read. The 31+29 = 60
entries the heuristic couldn't resolve confidently were read directly,
one by one, and every single one came back fixed/not-a-defect — a 60/60
result, not a sample — which is the strongest evidence yet in this
engagement that the frozen baselines are comprehensively stale rather than
hiding any remaining real defect.

## 12. Second cross-role UAT journey — leave-request manager approval, 4 real identities

Extends §6i's single ESS-payslip-isolation journey with a different
workflow and a different authorization boundary: the payslip journey
proves tenant/role data isolation (an employee sees only their own slip);
this one proves the manager-scoping boundary on an approval action (a
manager can only approve their OWN direct reports' requests), which
nothing else in this engagement's real-stack scripts exercises.

`scripts/cross-role-leave-approval-uat.sh`: 4 distinct real auth
identities (Employee A, her actual manager M, an unrelated Manager N,
hr_admin) against real Postgres + the real API:

```
=== 1. Employee A submits a leave request through the REAL POST /leave-requests endpoint ===
  ✓ leave request submitted (201) = 201

=== 2. Manager N (NOT Employee A's manager) tries to approve — must be rejected ===
  Manager N's attempt: HTTP 403 — {"error":"FORBIDDEN","message":"Only the employee's
    direct manager or an HR admin may approve this request"}
  ✓ an unrelated manager is rejected (403 FORBIDDEN) = 403
  ✓ request is still PENDING after the rejected attempt = PENDING

=== 3. Employee A's REAL manager M approves — must succeed ===
  ✓ Employee A's real manager succeeds (200) = 200
  ✓ response reports status=APPROVED = APPROVED

=== 4. Employee A's own balance (her own token) reflects the deduction ===
  ✓ Employee A's CRL Earned Leave balance is 9.0 (10.0 - 1 day approved) = 9.0

=== 5. hr_admin sees the approved request in the tenant-wide list ===
  ✓ hr_admin sees the request, status=APPROVED = APPROVED

RESULT: 7 passed, 0 failed
```

This proves, through real HTTP calls (not mocks, not direct DB writes to
the workflow tables themselves — only fixtures are seeded directly), that
`validateApprover()` (`apps/api/src/lib/approval-service.ts`) correctly
enforces `employees.manager_id` scoping: Manager N's token is a perfectly
valid, authenticated `manager`-role session in the SAME tenant, and is
still rejected because N is not THIS employee's manager — the authorization
check is per-relationship, not per-role.

**Incidental discovery, same shape as G04's, not fixed (out of scope):**
leave approval also publishes through `fastify.eventPublisher` (
`EventType.LEAVE_REQUESTED`/`LEAVE_APPROVED`), which writes an immutable
`platform_events` row — so a tenant that has ever had a leave request
submitted or approved also cannot be hard-deleted afterward, for the exact
same reason already flagged for payroll finalize in §9/G04. This is now
confirmed to be a general property of `fastify.eventPublisher.publish()`
itself (not specific to payroll), affecting hard-delete-tenant for any
tenant that has exercised ANY event-publishing code path. Flagged for a
human decision, not fixed here.
