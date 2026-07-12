#!/usr/bin/env node
/**
 * check-tenant-isolation.mjs — Static lint for missing tenant_id guards.
 *
 * Scans apps/api/src/routes/**\/*.ts and apps/api/src/lib/**\/*.ts for
 * PostgREST .from('table') calls on tenant-scoped tables without a
 * corresponding tenant_id reference in the immediately following query chain.
 *
 * Usage:
 *   node scripts/check-tenant-isolation.mjs             # fail on ANY violation
 *   node scripts/check-tenant-isolation.mjs --summary   # summary line only
 *   node scripts/check-tenant-isolation.mjs --save-baseline   # record current state
 *   node scripts/check-tenant-isolation.mjs --ratchet   # fail only on NEW violations
 *
 * Ratchet workflow (recommended for CI on brownfield codebases):
 *   1. Run --save-baseline once to capture the current state.
 *   2. Commit tenant-isolation-baseline.json alongside this script.
 *   3. In CI, run --ratchet: new violations fail; existing ones are allowed.
 *   4. When a violation is fixed, re-run --save-baseline and commit the update.
 *
 * Adding exceptions:
 *   · Global tables (no tenant_id column): add to GLOBAL_TABLES below.
 *   · Intentional cross-tenant reads: add to DOCUMENTED_EXCEPTIONS with a reason.
 *   · Single-site suppression: add a `// lint-tenant-ok: <reason>` comment on
 *     the line immediately before the .from() call.
 *
 * Exit codes: 0 = clean / within baseline, 1 = violations found.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative }                                        from 'node:path'
import { fileURLToPath }                                         from 'node:url'

const ROOT         = join(fileURLToPath(import.meta.url), '..', '..')
const ROUTES_DIR   = join(ROOT, 'apps', 'api', 'src', 'routes')
const LIBS_DIR     = join(ROOT, 'apps', 'api', 'src', 'lib')
const BASELINE_FILE = join(ROOT, 'scripts', 'tenant-isolation-baseline.json')

// ── Tables that have NO tenant_id column ─────────────────────────────────────
// Confirmed from supabase/migrations — queries against these are not expected
// to carry a tenant filter.
const GLOBAL_TABLES = new Set([
  'tenants',          // root tenant registry — no self-referencing tenant_id
  'ai_price_table',   // global AI pricing config
  'it_tax_slabs',     // statutory income-tax slabs, India-wide
  'states',           // state reference data
])

// ── Route file substrings for the owner/platform layer ───────────────────────
// These routes operate cross-tenant by design.
const OWNER_FILE_SUBSTRINGS = [
  '/routes/owner/',
  '/routes/support/',
  '/routes/setup.',
  '/routes/billing/',
]

// ── Documented intentional cross-tenant reads ─────────────────────────────────
// Add an entry here ONLY for tables where cross-tenant access is explicitly
// reviewed and approved.  Document the reason so future readers understand why.
const DOCUMENTED_EXCEPTIONS = new Map([
  ['platform_admins',      'nullable tenant_id — platform super-admins operate cross-tenant by design'],
  ['compliance_revision_events', 'org_id (not tenant_id) — platform-wide entries (org_id IS NULL) are served alongside tenant-specific ones; filter uses .or() pattern'],
])

// ── Configuration ─────────────────────────────────────────────────────────────
// Characters to examine AFTER each .from() call.  800 covers ~20 chain lines.
const WINDOW_CHARS = 800

// ── File walker ───────────────────────────────────────────────────────────────
function* walkTs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkTs(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}

// ── Core checker ─────────────────────────────────────────────────────────────
const FROM_RE = /\.from\(\s*(['"`])(\w+)\1\s*\)/g

function violationKey({ relPath, tableName, lineNum }) {
  return `${relPath}:${lineNum}:${tableName}`
}

function checkFile(filePath) {
  const relPath = relative(ROOT, filePath)

  // Skip platform-level routes that intentionally cross tenant boundaries
  if (OWNER_FILE_SUBSTRINGS.some(s => filePath.includes(s))) return []

  const src        = readFileSync(filePath, 'utf8')
  const violations = []

  FROM_RE.lastIndex = 0
  let match
  while ((match = FROM_RE.exec(src)) !== null) {
    const tableName = match[2]
    if (GLOBAL_TABLES.has(tableName))          continue
    if (DOCUMENTED_EXCEPTIONS.has(tableName))  continue

    // Lint-suppression comment on the line immediately before this .from() call
    const lineStart  = src.lastIndexOf('\n', match.index) + 1
    const prevLine   = src.slice(src.lastIndexOf('\n', lineStart - 2) + 1, lineStart).trimEnd()
    if (prevLine.includes('lint-tenant-ok'))   continue

    const windowStart = match.index + match[0].length
    const window      = src.slice(windowStart, windowStart + WINDOW_CHARS)

    // Accepted tenant_id reference patterns in the query chain:
    //   .eq('tenant_id', ...)      — SELECT / UPDATE / DELETE filter
    //   { tenant_id: ... }         — INSERT / UPSERT payload
    //   `tenant_id.eq.${...}`      — PostgREST URL filter string
    //   .or(`org_id.eq.${...},...`)— documented OR-filter pattern (trust tables)
    const hasTenantRef =
      window.includes("'tenant_id'")   ||
      window.includes('"tenant_id"')   ||
      window.includes('tenant_id:')    ||
      window.includes('tenant_id.eq.') ||
      window.includes('org_id.eq.')

    if (!hasTenantRef) {
      const lineNum = src.slice(0, match.index).split('\n').length
      violations.push({
        relPath,
        tableName,
        lineNum,
        snippet: window.slice(0, 120).replace(/\n/g, '↵'),
      })
    }
  }

  return violations
}

// ── Main ─────────────────────────────────────────────────────────────────────
const args        = new Set(process.argv.slice(2))
const summaryOnly = args.has('--summary')
const saveBaseline= args.has('--save-baseline')
const ratchet     = args.has('--ratchet')

const allViolations = []
for (const dir of [ROUTES_DIR, LIBS_DIR]) {
  for (const file of walkTs(dir)) {
    allViolations.push(...checkFile(file))
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
