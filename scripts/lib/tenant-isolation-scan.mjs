/**
 * tenant-isolation-scan.mjs
 *
 * Pure scanning logic for check-tenant-isolation.mjs, extracted into a
 * module with no top-level side effects so it can be imported from tests.
 * The CLI script (check-tenant-isolation.mjs) is a thin wrapper around this
 * module — its own behavior is unchanged by this extraction.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// ── Tables that have NO tenant_id column ─────────────────────────────────────
// Confirmed from supabase/migrations — queries against these are not expected
// to carry a tenant filter.
export const GLOBAL_TABLES = new Set([
  'tenants',          // root tenant registry — no self-referencing tenant_id
  'ai_price_table',   // global AI pricing config
  'it_tax_slabs',     // statutory income-tax slabs, India-wide
  'states',           // state reference data
])

// ── Route file substrings for the owner/platform layer ───────────────────────
// These routes operate cross-tenant by design.
export const OWNER_FILE_SUBSTRINGS = [
  '/routes/owner/',
  '/routes/support/',
  '/routes/setup.',
  '/routes/billing/',
]

// ── Documented intentional cross-tenant reads ─────────────────────────────────
// Add an entry here ONLY for tables where cross-tenant access is explicitly
// reviewed and approved.  Document the reason so future readers understand why.
export const DOCUMENTED_EXCEPTIONS = new Map([
  ['platform_admins',      'nullable tenant_id — platform super-admins operate cross-tenant by design'],
  ['compliance_revision_events', 'org_id (not tenant_id) — platform-wide entries (org_id IS NULL) are served alongside tenant-specific ones; filter uses .or() pattern'],
])

// ── Configuration ─────────────────────────────────────────────────────────────
// Characters to examine AFTER each .from() call.  800 covers ~20 chain lines.
const WINDOW_CHARS = 800

// ── File walker ───────────────────────────────────────────────────────────────
export function* walkTs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkTs(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}

// ── Core checker ─────────────────────────────────────────────────────────────
const FROM_RE = /\.from\(\s*(['"`])(\w+)\1\s*\)/g

/**
 * @param {string} filePath absolute path to the .ts file to scan
 * @param {string} root     repo root, used to compute the violation's relPath
 */
export function checkFile(filePath, root) {
  const relPath = relative(root, filePath)

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
