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

## 8. Exact finding → fix mapping (tenant-isolation, 307-row register)

**0 of the 307 tenant-isolation findings were fixed this pass.** The 3
`CONFIRMED_DEFECT` rows (`payroll/runs.ts:1007,3273,3440`,
`payroll_validation_rules`) are deliberately left open pending the ownership
decision in `STATUS.md` — not silently resolved, not silently left
ambiguous either. No tenant filter was added to any of the three.
