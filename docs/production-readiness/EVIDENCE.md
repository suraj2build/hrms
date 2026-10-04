# Evidence log — this remediation pass

HEAD at time of writing: `c782c36a2590aa21af7619262b606ea7172361b9`
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

## 6. Exact finding → fix mapping (tenant-isolation, 307-row register)

**0 of the 307 tenant-isolation findings were fixed this pass.** The 3
`CONFIRMED_DEFECT` rows (`payroll/runs.ts:1007,3273,3440`,
`payroll_validation_rules`) are deliberately left open pending the ownership
decision in `STATUS.md` — not silently resolved, not silently left
ambiguous either. No tenant filter was added to any of the three.
