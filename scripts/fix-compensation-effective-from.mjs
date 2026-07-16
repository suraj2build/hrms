#!/usr/bin/env node
/**
 * scripts/fix-compensation-effective-from.mjs
 *
 * One-shot: sets effective_from = '2026-04-01' on every is_active=true
 * employee_compensations row so payroll can be run from April 2026 onwards.
 *
 * Usage:
 *   SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres' \
 *     node scripts/fix-compensation-effective-from.mjs
 *
 *   Or just run without env var if .env.local-seed is present with SUPABASE_DB_URL.
 *
 *   Add --dry-run to preview without making changes.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const dotEnvPath = path.resolve(__dir, '..', '.env.local-seed')
if (existsSync(dotEnvPath)) {
  for (const line of readFileSync(dotEnvPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const DB_URL   = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const DRY_RUN  = process.argv.includes('--dry-run')
const NEW_DATE = '2026-04-01'

if (!DB_URL) {
  console.error('✗  SUPABASE_DB_URL is required.')
  console.error('   Set it to your Supabase connection string (URI) and re-run.')
  process.exit(1)
}

const pg   = await import('pg').then(m => m.default ?? m)
const pool = new pg.Pool({ connectionString: DB_URL, max: 1, ssl: { rejectUnauthorized: false } })

console.log('\nCognixHR — Fix compensation effective_from')
console.log('─'.repeat(55))
console.log(`  New date : ${NEW_DATE}`)
console.log(`  Mode     : ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`)
console.log()

// 1. Preview — how many rows will change?
const { rows: preview } = await pool.query(`
  SELECT
    COUNT(*)                                          AS total_active,
    COUNT(*) FILTER (WHERE effective_from <> $1)     AS will_change,
    COUNT(*) FILTER (WHERE effective_from  = $1)     AS already_correct
  FROM employee_compensations
  WHERE is_active = true
`, [NEW_DATE])

const { total_active, will_change, already_correct } = preview[0]
console.log(`  Active compensation records : ${total_active}`)
console.log(`  Already on ${NEW_DATE}      : ${already_correct}`)
console.log(`  Will be updated             : ${will_change}`)
console.log()

if (will_change === '0') {
  console.log('✓  Nothing to change — all active records already have effective_from = ' + NEW_DATE)
  await pool.end()
  process.exit(0)
}

if (DRY_RUN) {
  console.log('  (dry-run) Would update ' + will_change + ' row(s). Re-run without --dry-run to apply.')
  await pool.end()
  process.exit(0)
}

// 2. Apply
const { rowCount } = await pool.query(`
  UPDATE employee_compensations
  SET    effective_from = $1
  WHERE  is_active = true
    AND  effective_from <> $1
`, [NEW_DATE])

console.log(`✓  Updated ${rowCount} row(s) → effective_from = ${NEW_DATE}`)

// 3. Spot-check
const { rows: check } = await pool.query(`
  SELECT effective_from, COUNT(*) AS n
  FROM   employee_compensations
  WHERE  is_active = true
  GROUP  BY effective_from
  ORDER  BY effective_from
`)
console.log()
console.log('  Verification (active records by effective_from):')
for (const r of check) {
  console.log(`    ${r.effective_from}  →  ${r.n} record(s)`)
}

await pool.end()
console.log()
console.log('─'.repeat(55))
console.log('✓  Done. You can now run payroll from April 2026 onwards.')
console.log()
