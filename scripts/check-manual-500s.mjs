#!/usr/bin/env node
/**
 * Ratchet lint: flag any NEW raw reply.code(500).send() calls added to API routes.
 *
 * The conversion to api-errors.ts (Gate 4 Phase B) removed these from the 6 core
 * UAT modules. This script prevents regression: every new route file must use
 * serverError() instead of reply.code(500).send({ error: '...', message: error.message }).
 *
 * Rules:
 *   - Scans apps/api/src/routes/**\/*.ts
 *   - Counts occurrences of the raw 500 anti-pattern
 *   - Compares against the saved baseline in scripts/manual-500s-baseline.json
 *   - Exits 1 if the count INCREASED (ratchet: only allows decrease)
 *   - Exits 0 and writes a new baseline when count stayed the same or decreased
 *
 * Usage:
 *   node scripts/check-manual-500s.mjs          # check mode (CI)
 *   node scripts/check-manual-500s.mjs --update  # update baseline after a batch conversion
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROUTES    = path.join(ROOT, 'apps/api/src/routes')
const BASELINE  = path.join(ROOT, 'scripts/manual-500s-baseline.json')
const UPDATE    = process.argv.includes('--update')

// Pattern: reply.code(500).send({ ... message: <anything> })
// The risk is leaking error.message; we flag the entire reply.code(500).send() pattern.
const PATTERN = /reply\.code\(500\)\.send\(/g

function walkTs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkTs(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const files = walkTs(ROUTES)
const findings = []

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      findings.push({ file: path.relative(ROOT, file), line: i + 1, text: lines[i].trim() })
    }
    PATTERN.lastIndex = 0  // reset stateful regex
  }
}

const count = findings.length

// Load or create baseline
let baseline = { count: Infinity, updatedAt: null }
if (fs.existsSync(BASELINE)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch {}
}

if (UPDATE || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2))
  console.log(`[check-manual-500s] Baseline updated: ${count} occurrence(s).`)
  process.exit(0)
}

if (count > baseline.count) {
  console.error(`[check-manual-500s] FAIL — raw reply.code(500).send() count increased: ${baseline.count} → ${count}`)
  console.error(`New or re-introduced occurrences (use serverError() from lib/api-errors.ts instead):`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`)
  process.exit(1)
}

if (count < baseline.count) {
  // Auto-ratchet downward so baseline always reflects the current best state
  fs.writeFileSync(BASELINE, JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2))
  console.log(`[check-manual-500s] Ratchet improved: ${baseline.count} → ${count} occurrence(s). Baseline updated.`)
} else {
  console.log(`[check-manual-500s] OK — ${count} occurrence(s) (unchanged from baseline).`)
}
