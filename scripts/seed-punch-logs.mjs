#!/usr/bin/env node
/**
 * seed-punch-logs.mjs
 *
 * Backfills attendance_punch_logs (IN/OUT punches) from existing
 * attendance_daily records. Reads directly from PostgreSQL (bypasses
 * PostgREST row limit) and inserts in batches.
 *
 * Punch timing (IST = UTC+5:30):
 *   Day shift present : IN 08:50-09:10, OUT 18:00-18:30
 *   Day shift late    : IN 10:05-11:30, OUT 18:30-19:30
 *   Day shift half    : IN 09:00-09:10, OUT 13:00-13:30
 *   Night shift present: IN 20:50-21:10, OUT 06:00-06:30 (+1 day)
 *   Night shift late  : IN 21:30-22:30, OUT 06:30-07:30 (+1 day)
 *   Night shift half  : IN 21:00-21:10, OUT 01:30-02:00 (+1 day)
 *   leave / absent    : no punch records
 *
 * Usage:
 *   DATABASE_URL=postgresql://hrms_local:hrms_dev_2024@127.0.0.1:5432/hrms \
 *     SEED_TENANT_ID=b0000000-0000-0000-0000-000000000001 \
 *     node scripts/seed-punch-logs.mjs
 *
 * Optional:
 *   SEED_CLEAR=true   Delete existing SE* punch logs first (cascades from employees)
 */

import { randomUUID } from 'node:crypto'

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://hrms_local:hrms_dev_2024@127.0.0.1:5432/hrms'
const TID    = process.env.SEED_TENANT_ID ?? 'b0000000-0000-0000-0000-000000000001'
const CLEAR  = process.env.SEED_CLEAR === 'true'
const BATCH  = 1000

const pg = await import('pg').then(m => m.default ?? m)
const pool = new pg.Pool({ connectionString: DB_URL, max: 5 })

function die(msg) { console.error(`[punches] FATAL: ${msg}`); process.exit(1) }
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))

// Build a timestamp string for IST punch time on a given date
// offsetHours: hours offset from midnight IST (can be > 24 for next-day OUT)
function istPunch(date, offsetHours, offsetMinutes = 0) {
  // date is 'YYYY-MM-DD' (calendar date in IST)
  // IST = UTC+5:30, so midnight IST = 18:30 UTC previous day
  // We compute: UTC = (IST midnight) - 5h30m + offset
  const [y, m, d] = date.split('-').map(Number)
  // IST midnight as UTC: subtract 5h30m = 330 minutes
  const istMidnightUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - 330 * 60 * 1000
  const punchMs = istMidnightUtcMs + (offsetHours * 60 + offsetMinutes) * 60 * 1000
  return new Date(punchMs).toISOString()
}

// Generate IN and OUT punch timestamps for an attendance record
function punchTimes(date, status, isNight) {
  if (status === 'leave' || status === 'absent') return null

  if (!isNight) {
    // Day shift
    if (status === 'present') {
      const inH = 9, inM = randInt(-10, 10)          // 08:50–09:10
      const outH = 18, outM = randInt(0, 30)          // 18:00–18:30
      return {
        inAt:  istPunch(date, inH, inM),
        outAt: istPunch(date, outH, outM),
      }
    }
    if (status === 'late') {
      const inH = 10, inM = randInt(5, 90)            // 10:05–11:30
      const outH = 18, outM = randInt(30, 90)         // 18:30–19:30
      return {
        inAt:  istPunch(date, inH, inM),
        outAt: istPunch(date, outH, outM),
      }
    }
    if (status === 'half_day') {
      const inH = 9, inM = randInt(0, 10)             // 09:00–09:10
      const outH = 13, outM = randInt(0, 30)          // 13:00–13:30
      return {
        inAt:  istPunch(date, inH, inM),
        outAt: istPunch(date, outH, outM),
      }
    }
  } else {
    // Night shift — IN in evening, OUT next calendar day morning
    if (status === 'present') {
      const inH = 21, inM = randInt(-10, 10)          // 20:50–21:10
      const outH = 24 + 6, outM = randInt(0, 30)      // 06:00–06:30 next day
      return {
        inAt:  istPunch(date, inH, inM),
        outAt: istPunch(date, outH, outM),
      }
    }
    if (status === 'late') {
      const inH = 21, inM = randInt(30, 90)           // 21:30–22:30
      const outH = 24 + 6, outM = randInt(30, 90)     // 06:30–07:30 next day
      return {
        inAt:  istPunch(date, inH, inM),
        outAt: istPunch(date, outH, outM),
      }
    }
    if (status === 'half_day') {
      const inH = 21, inM = randInt(0, 10)            // 21:00–21:10
      const outH = 24 + 1, outM = randInt(30, 60)     // 01:30–02:00 next day
      return {
        inAt:  istPunch(date, inH, inM),
        outAt: istPunch(date, outH, outM),
      }
    }
  }
  return null
}

console.log('CognixHR Punch Log Seed')
console.log(`Tenant: ${TID}`)
console.log('─'.repeat(60))

// ── Clear existing punch logs for SE* employees ────────────────────────────────
if (CLEAR) {
  console.log('Clearing existing punch logs for SE* employees...')
  const { rowCount } = await pool.query(`
    DELETE FROM attendance_punch_logs
    WHERE tenant_id = $1
      AND employee_id IN (
        SELECT id FROM employees WHERE tenant_id = $1 AND employee_code LIKE 'SE%'
      )
  `, [TID])
  console.log(`  Deleted ${rowCount} punch log rows\n`)
}

// ── Fetch attendance_daily for this tenant ─────────────────────────────────────
console.log('Reading attendance_daily...')
const { rows: attRows } = await pool.query(`
  SELECT ad.employee_id, ad.date, ad.status,
         e.employee_code
  FROM attendance_daily ad
  JOIN employees e ON e.id = ad.employee_id AND e.tenant_id = $1
  WHERE ad.tenant_id = $1
    AND ad.status IN ('present', 'late', 'half_day')
  ORDER BY ad.employee_id, ad.date
`, [TID])
console.log(`  Found ${attRows.length.toLocaleString()} attendance rows with punches\n`)

if (attRows.length === 0) {
  console.log('No attendance rows found. Run seed-enterprise.mjs first.')
  process.exit(0)
}

// ── Determine night shift employees from attendance pattern ───────────────────
// Night shift employees tend to have work_hours > 8.5 — but we don't have that
// in the query above. Use employee_code to approximate: every 8th SE* employee
// is night shift (matches the ~12% in the main seeder, deterministically).
function isNightShiftEmp(employeeCode) {
  const num = parseInt(employeeCode.replace('SE', ''), 10)
  return !isNaN(num) && (num % 8 === 0)
}

// ── Generate and insert punch logs in batches ─────────────────────────────────
console.log('Generating punch logs...')

let totalInserted = 0
let totalSkipped  = 0
const buf = []
let batchNum = 0

async function flushPunches(force = false) {
  while (buf.length >= BATCH || (force && buf.length > 0)) {
    const chunk = buf.splice(0, BATCH)
    // Use ON CONFLICT DO NOTHING (unique index covers tenant+emp+time+direction)
    const cols   = ['id', 'tenant_id', 'employee_id', 'punched_at', 'direction', 'source']
    const vals   = []
    const valSets = chunk.map(row => {
      const placeholders = cols.map(c => { vals.push(row[c]); return `$${vals.length}` })
      return `(${placeholders.join(', ')})`
    })
    await pool.query(
      `INSERT INTO attendance_punch_logs (${cols.join(', ')})
       VALUES ${valSets.join(', ')}
       ON CONFLICT (tenant_id, employee_id, punched_at, direction) DO NOTHING`,
      vals
    )
    totalInserted += chunk.length
    batchNum++
    process.stdout.write(`\r  attendance_punch_logs: ${totalInserted.toLocaleString()} inserted  `)
  }
}

for (const row of attRows) {
  const night = isNightShiftEmp(row.employee_code)
  const dateStr = typeof row.date === 'string' ? row.date : row.date.toISOString().slice(0, 10)
  const times = punchTimes(dateStr, row.status, night)
  if (!times) { totalSkipped++; continue }

  buf.push({
    id: randomUUID(), tenant_id: TID, employee_id: row.employee_id,
    punched_at: times.inAt, direction: 'IN', source: 'device',
  })
  buf.push({
    id: randomUUID(), tenant_id: TID, employee_id: row.employee_id,
    punched_at: times.outAt, direction: 'OUT', source: 'device',
  })

  await flushPunches()
}
await flushPunches(true)
console.log()

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('✓  Punch log seed complete')
console.log(`   Tenant:          ${TID}`)
console.log(`   Attendance rows: ${attRows.length.toLocaleString()}`)
console.log(`   Punch logs:      ${totalInserted.toLocaleString()} (2 per working day)`)
console.log(`   Night shift:     ~${Math.round(attRows.length / 8 / attRows.length * 100)}% employees on night schedule`)
console.log()

await pool.end()
