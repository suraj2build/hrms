#!/usr/bin/env node
/**
 * check-duplicate-formatters.mjs
 *
 * Ratchet lint: flags local reimplementations of lib/utils.ts's date/currency/
 * initials formatters (fmtDate, fmtDateShort, fmtMonthYear, fmtDateTime,
 * formatDate, formatCurrency, getInitials) instead of importing the canonical
 * versions, plus bare toLocaleDateString()/Intl.NumberFormat() calls that
 * bypass them entirely. This is the audit's F14 finding (Phase 6) — the
 * ~92-168 file duplication that produces visibly inconsistent date/currency
 * formatting depending on which page a user happens to be on.
 *
 * Unlike check-raw-colors.mjs (zero-tolerance), this is a RATCHET like
 * scripts/check-manual-500s.mjs: the codebase starts with a large known
 * count, and a scripted/manual cleanup pass reduces it batch by batch. CI
 * only fails if the count goes UP — it does not require reaching zero.
 *
 * Usage:
 *   node scripts/check-duplicate-formatters.mjs          # check mode (CI)
 *   node scripts/check-duplicate-formatters.mjs --update  # update baseline after a cleanup batch
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT     = join(fileURLToPath(import.meta.url), '..', '..', 'src')
const BASELINE = join(fileURLToPath(import.meta.url), '..', 'duplicate-formatters-baseline.json')
const UPDATE   = process.argv.includes('--update')

// ── Patterns ──────────────────────────────────────────────────────────────────

const CANONICAL_NAMES = [
  'fmtDate', 'fmtDateShort', 'fmtMonthYear', 'fmtDateTime',
  'formatDate', 'fmtCurrency', 'formatCurrency', 'getInitials',
]

// function fmtDate(...) / const fmtDate = (...) / const fmtDate: Type = (...)
const NAMED_DUPLICATE_PATTERN = new RegExp(
  '\\bfunction\\s+(' + CANONICAL_NAMES.join('|') + ')\\s*\\(' +
  '|\\bconst\\s+(' + CANONICAL_NAMES.join('|') + ')\\s*[:=]',
)

const INLINE_CALL_PATTERNS = [
  { name: 'toLocaleDateString', pattern: /\.toLocaleDateString\(/ },
  { name: 'Intl.NumberFormat',  pattern: /Intl\.NumberFormat\(/ },
]

const SKIP_PATTERNS = [
  /node_modules/,
  /\.d\.ts$/,
  /\.(test|spec)\.(ts|tsx)$/,
  /src\/lib\/utils\.ts$/,   // the canonical source itself
]

// ── File walker ───────────────────────────────────────────────────────────────

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (!SKIP_PATTERNS.some((p) => p.test(full))) walk(full, files)
    } else if (['.ts', '.tsx'].includes(extname(full))) {
      if (!SKIP_PATTERNS.some((p) => p.test(full))) files.push(full)
    }
  }
  return files
}

// ── Scanner ───────────────────────────────────────────────────────────────────

const findings = { namedDuplicate: [], inlineCall: [] }

for (const file of walk(ROOT)) {
  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  lines.forEach((line, idx) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return

    const namedMatch = NAMED_DUPLICATE_PATTERN.exec(line)
    if (namedMatch) {
      findings.namedDuplicate.push({
        file: relative(ROOT, file), line: idx + 1,
        name: namedMatch[1] ?? namedMatch[2],
      })
    }

    for (const { name, pattern } of INLINE_CALL_PATTERNS) {
      if (pattern.test(line)) {
        findings.inlineCall.push({ file: relative(ROOT, file), line: idx + 1, name })
      }
    }
  })
}

const namedCount  = findings.namedDuplicate.length
const inlineCount = findings.inlineCall.length
const count       = namedCount + inlineCount

// ── Baseline (ratchet) ──────────────────────────────────────────────────────

let baseline = { count: Infinity, updatedAt: null }
if (existsSync(BASELINE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) } catch {}
}

function writeBaseline() {
  writeFileSync(BASELINE, JSON.stringify({
    count, namedCount, inlineCount, updatedAt: new Date().toISOString(),
  }, null, 2))
}

if (UPDATE || !existsSync(BASELINE)) {
  writeBaseline()
  console.log(`[check-duplicate-formatters] Baseline updated: ${count} occurrence(s) (${namedCount} named duplicates, ${inlineCount} inline calls).`)
  process.exit(0)
}

if (count > baseline.count) {
  console.error(`[check-duplicate-formatters] FAIL — duplicate-formatter count increased: ${baseline.count} → ${count}`)
  console.error('New or re-introduced occurrences (import from lib/utils.ts instead of reimplementing):')
  for (const f of findings.namedDuplicate) console.error(`  ${f.file}:${f.line}  local ${f.name}(...)`)
  for (const f of findings.inlineCall)      console.error(`  ${f.file}:${f.line}  ${f.name}(...)`)
  process.exit(1)
}

if (count < baseline.count) {
  writeBaseline()
  console.log(`[check-duplicate-formatters] Ratchet improved: ${baseline.count} → ${count} occurrence(s). Baseline updated.`)
} else {
  console.log(`[check-duplicate-formatters] OK — ${count} occurrence(s) (unchanged from baseline).`)
}
