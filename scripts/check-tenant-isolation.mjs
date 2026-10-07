#!/usr/bin/env node
/**
 * check-tenant-isolation.mjs — Static lint for missing tenant_id guards.
 *
 * Scans apps/api/src/routes/**\/*.ts and apps/api/src/lib/**\/*.ts for
 * PostgREST .from('table') calls on tenant-scoped tables without a
 * corresponding tenant_id reference in the immediately following query chain.
 *
 * The actual scanning logic lives in scripts/lib/tenant-isolation-scan.mjs —
 * a plain module with no top-level side effects, extracted so it can be
 * imported from tests (importing THIS file would re-run the CLI's
 * save-baseline/ratchet/scan-and-exit logic below as a side effect).
 *
 * Usage:
 *   node scripts/check-tenant-isolation.mjs             # fail on ANY violation
 *   node scripts/check-tenant-isolation.mjs --summary   # summary line only
 *   node scripts/check-tenant-isolation.mjs --save-baseline   # record current state
 *   node scripts/check-tenant-isolation.mjs --ratchet   # fail only on NEW violations
 *   node scripts/check-tenant-isolation.mjs --legacy-line-key # key violations
 *     by the old file:line:table scheme instead of the stable fingerprint
 *     (see scripts/lib/finding-fingerprint.mjs). Stable-key is now the
 *     DEFAULT (G08) — tenant-isolation-baseline.json was migrated to that
 *     format; the old scheme is kept only for debugging/comparison and no
 *     longer matches the live baseline's format.
 *
 * Ratchet workflow (recommended for CI on brownfield codebases):
 *   1. Run --save-baseline once to capture the current state.
 *   2. Commit tenant-isolation-baseline.json alongside this script.
 *   3. In CI, run --ratchet: new violations fail; existing ones are allowed.
 *   4. When a violation is fixed, re-run --save-baseline and commit the update.
 *
 * Adding exceptions:
 *   · Global tables (no tenant_id column): add to GLOBAL_TABLES in
 *     tenant-isolation-scan.mjs.
 *   · Intentional cross-tenant reads: add to DOCUMENTED_EXCEPTIONS there, with
 *     a reason.
 *   · Single-site suppression: add a `// lint-tenant-ok: <reason>` comment on
 *     the line immediately before the .from() call.
 *
 * Exit codes: 0 = clean / within baseline, 1 = violations found.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join }                                     from 'node:path'
import { fileURLToPath }                            from 'node:url'
import { walkTs, checkFile }                        from './lib/tenant-isolation-scan.mjs'
import { stableFingerprint }                        from './lib/finding-fingerprint.mjs'

const ROOT         = join(fileURLToPath(import.meta.url), '..', '..')
const ROUTES_DIR   = join(ROOT, 'apps', 'api', 'src', 'routes')
const LIBS_DIR      = join(ROOT, 'apps', 'api', 'src', 'lib')
const BASELINE_FILE = join(ROOT, 'scripts', 'tenant-isolation-baseline.json')

function violationKey(f) {
  return useStableKey ? stableFingerprint(f) : `${f.relPath}:${f.lineNum}:${f.tableName}`
}

// ── Main ─────────────────────────────────────────────────────────────────────
const args        = new Set(process.argv.slice(2))
const summaryOnly = args.has('--summary')
const saveBaseline= args.has('--save-baseline')
const ratchet      = args.has('--ratchet')
// G08: stable-key is now the default — tenant-isolation-baseline.json was
// migrated to this format (see apply-stable-key-baseline-migration.mjs).
// --legacy-line-key opts back into the old file:line:table scheme, which no
// longer matches the live baseline's format and is kept only for debugging.
const useStableKey = !args.has('--legacy-line-key')

const allViolations = []
for (const dir of [ROUTES_DIR, LIBS_DIR]) {
  for (const file of walkTs(dir)) {
    allViolations.push(...checkFile(file, ROOT))
  }
}

const currentKeys = new Set(allViolations.map(violationKey))

// ── --save-baseline ───────────────────────────────────────────────────────────
if (saveBaseline) {
  const baseline = {
    generated: new Date().toISOString(),
    count:     allViolations.length,
    keys:      [...currentKeys].sort(),
  }
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`Baseline saved: ${allViolations.length} known violations → ${BASELINE_FILE}`)
  process.exit(0)
}

// ── --ratchet ─────────────────────────────────────────────────────────────────
if (ratchet) {
  if (!existsSync(BASELINE_FILE)) {
    console.error('No baseline found. Run --save-baseline first.')
    process.exit(1)
  }
  const baseline    = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  const baselineSet = new Set(baseline.keys)
  const newViolations = allViolations.filter(v => !baselineSet.has(violationKey(v)))
  const fixedCount    = [...baselineSet].filter(k => !currentKeys.has(k)).length

  if (fixedCount > 0) {
    console.log(`  ✓ ${fixedCount} violation(s) fixed since baseline (${baseline.count} → ${allViolations.length})`)
    console.log('  → Run --save-baseline to update the baseline and lock in the improvement.')
  }

  if (newViolations.length === 0) {
    console.log(`✓ Tenant isolation ratchet passed — no new violations (${allViolations.length} known, ${fixedCount} fixed).`)
    process.exit(0)
  }

  console.error(`\n✗ Tenant isolation ratchet: ${newViolations.length} NEW violation(s) not in baseline\n`)
  for (const { relPath, tableName, lineNum, snippet } of newViolations) {
    console.error(`  ${relPath}:${lineNum} — ${tableName}`)
    if (!summaryOnly) console.error(`    ${snippet}\n`)
  }
  process.exit(1)
}

// ── Full scan (default) ───────────────────────────────────────────────────────
if (allViolations.length === 0) {
  console.log('✓ Tenant isolation check passed — no violations found.')
  process.exit(0)
}

console.error(`\n✗ Tenant isolation check: ${allViolations.length} potential violation(s)\n`)
if (!summaryOnly) {
  for (const { relPath, tableName, lineNum, snippet } of allViolations) {
    console.error(`  ${relPath}:${lineNum} — ${tableName}`)
    console.error(`    ${snippet}\n`)
  }
  console.error('Fix: add .eq(\'tenant_id\', req.tenantId) to the query chain,')
  console.error('or add to DOCUMENTED_EXCEPTIONS / use // lint-tenant-ok: <reason>.')
}
process.exit(1)
