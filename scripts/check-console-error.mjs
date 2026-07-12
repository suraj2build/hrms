#!/usr/bin/env node
/**
 * Ratchet lint: flag console.error() calls added to API route files.
 *
 * API routes must use structured logging via fastify.log / req.log, not console.error.
 * console.error: (1) bypasses pino's structured JSON format so logs don't arrive in
 * the observability stack, (2) goes to stderr not the log stream, (3) lacks request
 * context (requestId, tenantId, userId, route).
 *
 * The correct pattern is req.log.error({ err }, 'message') or rely on serverError()
 * from lib/api-errors.ts which logs automatically.
 *
 * Rules:
 *   - Scans apps/api/src/routes/**\/*.ts AND apps/api/src/lib/**\/*.ts
 *   - Counts occurrences of console.error(
 *   - Compares against the saved baseline in scripts/console-error-baseline.json
 *   - Exits 1 if the count INCREASED
 *   - Exits 0 and writes a new baseline when count stayed the same or decreased
 *
 * Usage:
 *   node scripts/check-console-error.mjs          # check mode (CI)
 *   node scripts/check-console-error.mjs --update  # update baseline
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = [
  path.join(ROOT, 'apps/api/src/routes'),
  path.join(ROOT, 'apps/api/src/lib'),
]
const BASELINE  = path.join(ROOT, 'scripts/console-error-baseline.json')
const UPDATE    = process.argv.includes('--update')

const PATTERN = /console\.error\(/g

function walkTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkTs(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const files = SCAN_DIRS.flatMap(d => walkTs(d))
const findings = []

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      findings.push({ file: path.relative(ROOT, file), line: i + 1, text: lines[i].trim() })
    }
    PATTERN.lastIndex = 0
  }
}

const count = findings.length

let baseline = { count: Infinity, updatedAt: null }
if (fs.existsSync(BASELINE)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch {}
}

if (UPDATE || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2))
  console.log(`[check-console-error] Baseline updated: ${count} occurrence(s).`)
  process.exit(0)
}

if (count > baseline.count) {
  console.error(`[check-console-error] FAIL — console.error() count increased: ${baseline.count} → ${count}`)
  console.error(`New occurrences (use req.log.error({ err }, '...') or serverError() instead):`)
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`)
  process.exit(1)
}

if (count < baseline.count) {
  fs.writeFileSync(BASELINE, JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2))
  console.log(`[check-console-error] Ratchet improved: ${baseline.count} → ${count} occurrence(s). Baseline updated.`)
} else {
  console.log(`[check-console-error] OK — ${count} occurrence(s) (unchanged from baseline).`)
}
