/**
 * unbounded-query-scan.mjs
 *
 * Pure scanning logic for check-unbounded-queries.mjs (RC-G5-01), extracted
 * into a module with no top-level side effects so it can be imported from
 * tests. The CLI script (check-unbounded-queries.mjs) is a thin wrapper
 * around this module — its own behavior is unchanged by this extraction.
 */
import fs from 'node:fs'
import path from 'node:path'

// ── Registry of tables that exceed 1,000 rows at enterprise scale ─────────────
// Any SELECT against these tables that is NOT fetchAllRows() / .range()-paginated
// and NOT single-row / widget-bounded risks silent truncation at 1,000 rows.
// Add new large tables here as the schema grows.
export const HIGH_CARDINALITY_TABLES = new Set([
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
export const WIDGET_LIMIT_THRESHOLD = 20

// Chars to scan AFTER .from() to read the query chain.
const WINDOW_CHARS = 1200
// Chars to scan BEFORE .from() to detect fetchAllRows() wrapper call.
const LOOKBACK_CHARS = 300

// Test files use mocked supabase clients (see e.g.
// routes/intelligence/__tests__/search-missing-pan.test.ts,
// routes/surveys/__tests__/trigger-lifecycle-ownership-chunking.test.ts) —
// a `.from('table')` call in a mock's own implementation is not a real
// PostgREST query and cannot silently truncate or leak cross-tenant data.
// Scanning them is a category error that produces permanent false
// positives in both the unbounded-query and tenant-isolation registers.
function isTestFile(name) {
  return name.endsWith('.test.ts') || name.endsWith('.spec.ts')
}

export function walkTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue
      walkTs(full, out)
    } else if (e.name.endsWith('.ts') && !isTestFile(e.name)) out.push(full)
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
 * @param {number} matchEnd   - index immediately after the .from() match
 * @param {string} prevLine   - the source line immediately before this .from() call
 * @returns {{ kind: string, limitValue: number|null } | null}
 */
export function classifyQuery(src, matchIndex, matchEnd, prevLine) {
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

/**
 * @param {string} filePath absolute path to the .ts file to scan
 * @param {string} root     repo root, used to compute the finding's relPath
 */
export function checkFile(filePath, root) {
  const relPath  = path.relative(root, filePath)
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
