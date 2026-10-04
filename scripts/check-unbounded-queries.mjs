#!/usr/bin/env node
/**
 * check-unbounded-queries.mjs — RC-G5-01 Static lint for unbounded PostgREST queries.
 *
 * PostgREST enforces a server-side max-rows=1000 ceiling that silently overrides
 * any .limit() value — even .limit(200_000) returns exactly 1,000 rows with no
 * error and no truncation signal. This is a silent correctness failure: HTTP 200
 * with partial data.
 *
 * This script scans apps/api/src/**\/routes\/**\/*.ts and apps/api/src/lib\/**\/*.ts
 * for queries against HIGH_CARDINALITY_TABLES that risk silent truncation.
 *
 * The actual scanning logic lives in scripts/lib/unbounded-query-scan.mjs —
 * a plain module with no top-level side effects, extracted so it can be
 * imported from tests (importing THIS file would re-run the CLI's
 * save-baseline/ratchet/scan-and-exit logic below as a side effect).
 *
 * Query intent classification
 * ───────────────────────────
 * SAFE — will not silently truncate:
 *   · fetchAllRows() wrapper detected (lookback finds fetchAllRows() or .range() in chain)
 *   · Single-row result: .single(), .maybeSingle(), .limit(1), or .eq('id', ...)
 *   · User-driven pagination: .limit(<variable>) from req.query / params
 *   · Intentional widget: hard-coded .limit(N) where N ≤ WIDGET_LIMIT_THRESHOLD (20)
 *   · Write operation: .insert() / .update() / .delete() before .select() — PostgREST
 *     row-cap applies only to GET reads, not to the return shape of write ops
 *   · Suppressed: // lint-query-ok: <reason> on the line immediately before .from()
 *
 * FLAG — risk of silent truncation:
 *   · hard-coded-limit: .limit(N) where N > 20 — PostgREST will silently cap at 1,000
 *     if N > 1,000, or may return fewer than expected on large tenants
 *   · unbounded: no .limit() at all — PostgREST silently caps at 1,000 rows
 *
 * HIGH_CARDINALITY_TABLES — tables known to exceed 1,000 rows at enterprise scale.
 * Add to this registry (in unbounded-query-scan.mjs) when a new large table is
 * introduced.
 *
 * Usage:
 *   node scripts/check-unbounded-queries.mjs                  # full scan (report all)
 *   node scripts/check-unbounded-queries.mjs --save-baseline  # record current state
 *   node scripts/check-unbounded-queries.mjs --ratchet        # CI: fail only on NEW
 *   node scripts/check-unbounded-queries.mjs --summary        # one-line summary only
 *   node scripts/check-unbounded-queries.mjs --legacy-line-key # key findings
 *     by the old file:line:table scheme instead of the stable fingerprint
 *     (see scripts/lib/finding-fingerprint.mjs). Stable-key is now the
 *     DEFAULT (G08) — unbounded-queries-baseline.json was migrated to that
 *     format; the old scheme is kept only for debugging/comparison and no
 *     longer matches the live baseline's format.
 *
 * Suppression:
 *   Add a // lint-query-ok: <reason> comment on the line immediately before the
 *   .from() call to suppress a known-safe or intentionally bounded query.
 *
 * Exit codes: 0 = clean / within baseline, 1 = violations found.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkTs, checkFile, WIDGET_LIMIT_THRESHOLD } from './lib/unbounded-query-scan.mjs'
import { stableFingerprint } from './lib/finding-fingerprint.mjs'

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = [
  path.join(ROOT, 'apps/api/src/routes'),
  path.join(ROOT, 'apps/api/src/lib'),
]
const BASELINE  = path.join(ROOT, 'scripts/unbounded-queries-baseline.json')

// ── Main ──────────────────────────────────────────────────────────────────────
const argSet       = new Set(process.argv.slice(2))
const saveBaseline = argSet.has('--save-baseline')
const ratchet      = argSet.has('--ratchet')
const summaryOnly  = argSet.has('--summary')
// G08: stable-key is now the default — unbounded-queries-baseline.json was
// migrated to this format (see apply-stable-key-baseline-migration.mjs).
// --legacy-line-key opts back into the old file:line:table scheme, which no
// longer matches the live baseline's format and is kept only for debugging.
const useStableKey = !argSet.has('--legacy-line-key')

const allFindings = SCAN_DIRS.flatMap(dir => walkTs(dir)).flatMap(f => checkFile(f, ROOT))

function findingKey(f) {
  return useStableKey ? stableFingerprint(f) : `${f.relPath}:${f.lineNum}:${f.tableName}`
}
const currentKeys = new Set(allFindings.map(findingKey))

// ── --save-baseline ───────────────────────────────────────────────────────────
if (saveBaseline) {
  const baseline = {
    generated: new Date().toISOString(),
    count:     allFindings.length,
    keys:      [...currentKeys].sort(),
    note:      'Run --save-baseline after fixing findings to lock in improvements.',
  }
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`[check-unbounded-queries] Baseline saved: ${allFindings.length} finding(s) → ${BASELINE}`)
  process.exit(0)
}

// ── --ratchet ─────────────────────────────────────────────────────────────────
if (ratchet) {
  if (!fs.existsSync(BASELINE)) {
    console.error('[check-unbounded-queries] No baseline found. Run --save-baseline first.')
    process.exit(1)
  }
  const baseline    = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const baselineSet = new Set(baseline.keys)
  const newFindings = allFindings.filter(f => !baselineSet.has(findingKey(f)))
  const fixedCount  = [...baselineSet].filter(k => !currentKeys.has(k)).length

  if (fixedCount > 0) {
    console.log(`  ✓ ${fixedCount} query(ies) fixed since baseline (${baseline.count} → ${allFindings.length}).`)
    console.log('  → Run --save-baseline to lock in the improvement.')
  }

  if (newFindings.length === 0) {
    const label = allFindings.length === 0
      ? 'no findings'
      : `${allFindings.length} known, ${fixedCount} fixed`
    console.log(`✓ Unbounded query ratchet passed — no new violations (${label}).`)
    process.exit(0)
  }

  console.error(`\n✗ Unbounded query ratchet: ${newFindings.length} NEW finding(s) not in baseline\n`)
  for (const f of newFindings) {
    const detail = f.kind === 'hard-coded-limit'
      ? `hard-coded .limit(${f.limitValue}) on high-cardinality table — risks silent cap at 1,000 rows`
      : 'unbounded SELECT — PostgREST silently caps at 1,000 rows'
    console.error(`  ${f.relPath}:${f.lineNum}  table=${f.tableName}  [${detail}]`)
    if (!summaryOnly) console.error(`    ...${f.snippet}\n`)
  }
  console.error('\nFix: use fetchAllRows() for complete datasets.')
  console.error('Suppress intentional exceptions: // lint-query-ok: <reason> before .from()\n')
  process.exit(1)
}

// ── Full scan (default) ───────────────────────────────────────────────────────
if (allFindings.length === 0) {
  console.log('✓ Unbounded query check passed — no findings.')
  process.exit(0)
}

const hardCoded = allFindings.filter(f => f.kind === 'hard-coded-limit')
const unbounded = allFindings.filter(f => f.kind === 'unbounded')

console.error(`\n✗ Unbounded query check: ${allFindings.length} finding(s) on high-cardinality tables`)
console.error(`  ${unbounded.length} unbounded (no limit), ${hardCoded.length} hard-coded limit > ${WIDGET_LIMIT_THRESHOLD}\n`)

for (const f of allFindings) {
  const label = f.kind === 'hard-coded-limit'
    ? `hard-coded .limit(${f.limitValue})`
    : 'unbounded (no limit)'
  console.error(`  ${f.relPath}:${f.lineNum}  table=${f.tableName}  [${label}]`)
  if (!summaryOnly) console.error(`    ...${f.snippet}\n`)
}

console.error('\nFix: wrap with fetchAllRows() for complete-dataset reads.')
console.error('Suppress intentional exceptions: // lint-query-ok: <reason> before .from()\n')
process.exit(1)
