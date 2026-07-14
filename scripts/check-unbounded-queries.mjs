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
 * Add to this registry when a new large table is introduced.
 *
 * Usage:
 *   node scripts/check-unbounded-queries.mjs                  # full scan (report all)
 *   node scripts/check-unbounded-queries.mjs --save-baseline  # record current state
 *   node scripts/check-unbounded-queries.mjs --ratchet        # CI: fail only on NEW
 *   node scripts/check-unbounded-queries.mjs --summary        # one-line summary only
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

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = [
  path.join(ROOT, 'apps/api/src/routes'),
  path.join(ROOT, 'apps/api/src/lib'),
]
const BASELINE  = path.join(ROOT, 'scripts/unbounded-queries-baseline.json')

// ── Registry of tables that exceed 1,000 rows at enterprise scale ─────────────
// Any SELECT against these tables that is NOT fetchAllRows() / .range()-paginated
// and NOT single-row / widget-bounded risks silent truncation at 1,000 rows.
// Add new large tables here as the schema grows.
const HIGH_CARDINALITY_TABLES = new Set([
  // Core workforce
  'employees',
  'draft_employee_profiles',
  'employee_compensations',
  'employee_bank_statutory',
  'employee_certifications',
  'employee_documents',
  // Attendance
  'attendance_daily',
  'attendance_logs',
  'attendance_anomalies',
  'attendance_punch_logs',
  'raw_punches',
  // Leave
  'leave_requests',
  'leave_balances',
  // Payroll
  'payroll_records',
  'payroll_slips',
  'payroll_adjustments',
  'payroll_payout_reconciliation',
  'variable_payouts',
  'arrear_records',
  'epf_contributions',
  // Talent / succession
  'succession_plans',
  'talent_roles',
  'mood_checkins',
  // Assets / docs / recognition
  'asset_assignments',
  // Recruitment
  'applications',
  'pre_joinee_invitations',
  // Operations / infrastructure
  'sites',
  'audit_logs',
  'api_usage_log',
  'ai_usage_log',
  'helpdesk_tickets',
  'notifications',
])

// Hard-coded .limit(N) at or below this value is presumed intentional:
// "Top 5 recent items", "Last 10 notifications", dashboard widget previews, etc.
// Above this threshold a hard-coded limit on a high-cardinality table is flagged.
const WIDGET_LIMIT_THRESHOLD = 20

// Chars to scan AFTER .from() to read the query chain.
const WINDOW_CHARS = 1200
// Chars to scan BEFORE .from() to detect fetchAllRows() wrapper call.
const LOOKBACK_CHARS = 300

// ── Helpers ───────────────────────────────────────────────────────────────────
function walkTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkTs(full, out)
    else if (e.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// ── Core classifier ───────────────────────────────────────────────────────────
const FROM_RE = /\.from\(\s*(['"`])(\w+)\1\s*\)/g

/**
 * Given a .from('table') match, classify the query and return a finding or null.
 *
 * @param {string} src        - full file source
 * @param {number} matchIndex - index where the .from() match starts
 * @param {string} prevLine   - the source line immediately before this .from() call
 * @returns {{ kind: string, limitValue: number|null } | null}
 */
function classifyQuery(src, matchIndex, matchEnd, prevLine) {
  // 1. Suppression comment on the preceding line
  if (prevLine.includes('lint-query-ok')) return null

  const window = src.slice(matchEnd, matchEnd + WINDOW_CHARS)
  const lookback = src.slice(Math.max(0, matchIndex - LOOKBACK_CHARS), matchIndex)

  // 2. fetchAllRows() wrapper — the .from() call lives inside the callback
  if (lookback.includes('fetchAllRows(')) return null

  // 3. .range() in the query chain — fetchAllRows pagination pattern
  if (window.includes('.range(')) return null

  // 4. Single-row terminal methods
  if (/\.(?:single|maybeSingle)\(/.test(window)) return null

  // 4b. COUNT-only HEAD request — PostgREST returns a header count with no rows.
  //     Pattern: .select('...', { count: 'exact', head: true })
  if (/head:\s*true/.test(window)) return null

  // 5. Write operation — .insert() / .update() / .delete() before the .select()
  //    PostgREST row-cap only applies to GET reads, not to the return-shape
  //    of writes.  We detect this by finding a write method before .select().
  const selectIdx = window.indexOf('.select(')
  const writeIdx  = Math.min(
    window.includes('.insert(') ? window.indexOf('.insert(') : Infinity,
    window.includes('.update(') ? window.indexOf('.update(') : Infinity,
    window.includes('.delete(') ? window.indexOf('.delete(') : Infinity,
  )
  const isWriteOp = writeIdx !== Infinity && (selectIdx === -1 || writeIdx < selectIdx)
  if (isWriteOp) return null

  // If there's no .select() at all it's also a write op (e.g. bare .delete())
  if (selectIdx === -1 && writeIdx !== Infinity) return null

  // 6. Primary-key lookup — .eq('id', <expr>) narrows to at most one row
  if (/\.eq\(\s*['"`]id['"`]/.test(window)) return null

  // 7. Inspect .limit() usage
  //    a) .limit(1) exactly → single-row lookup
  //    b) .limit(<variable>) → user-driven pagination, assume safe
  //    c) .limit(N) where N is a number literal > threshold → flag
  //    d) .limit(N) where N ≤ threshold → intentional widget, safe
  const numMatch = /\.limit\(\s*(\d+)\s*[),]/.exec(window)
  if (numMatch) {
    const n = parseInt(numMatch[1], 10)
    if (n <= 1) return null                          // single-row lookup
    if (n <= WIDGET_LIMIT_THRESHOLD) return null     // intentional widget
    return { kind: 'hard-coded-limit', limitValue: n }
  }

  // .limit(<non-numeric>) → variable / req.query driven → safe
  if (window.includes('.limit(')) return null

  // 8. No limit, no pagination, not a write, not single-row → unbounded SELECT
  return { kind: 'unbounded', limitValue: null }
}

function checkFile(filePath) {
  const relPath  = path.relative(ROOT, filePath)
  const src      = fs.readFileSync(filePath, 'utf8')
  const findings = []

  FROM_RE.lastIndex = 0
  let m
  while ((m = FROM_RE.exec(src)) !== null) {
    const tableName = m[2]
    if (!HIGH_CARDINALITY_TABLES.has(tableName)) continue

    const lineNum    = src.slice(0, m.index).split('\n').length
    const lineStart  = src.lastIndexOf('\n', m.index) + 1
    const prevStart  = src.lastIndexOf('\n', lineStart - 2) + 1
    const prevLine   = src.slice(prevStart, lineStart).trimEnd()

    const issue = classifyQuery(src, m.index, m.index + m[0].length, prevLine)
    if (!issue) continue

    const snippet = src
      .slice(m.index + m[0].length, m.index + m[0].length + 120)
      .replace(/\n/g, '↵')

    findings.push({ relPath, tableName, lineNum, kind: issue.kind, limitValue: issue.limitValue, snippet })
  }

  return findings
}

// ── Main ──────────────────────────────────────────────────────────────────────
const argSet      = new Set(process.argv.slice(2))
const saveBaseline = argSet.has('--save-baseline')
const ratchet      = argSet.has('--ratchet')
const summaryOnly  = argSet.has('--summary')

const allFindings = SCAN_DIRS.flatMap(dir => walkTs(dir)).flatMap(checkFile)

function findingKey({ relPath, tableName, lineNum }) {
  return `${relPath}:${lineNum}:${tableName}`
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
