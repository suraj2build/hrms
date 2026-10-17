#!/usr/bin/env node
/**
 * Real-Postgres regression check for migration 453
 * (DEFECT-03, found during the PR #30 live-screen Attendance/Leave UAT,
 * 2026-10-12).
 *
 * employee_shifts has a partial unique index, uq_employee_shifts_current
 * ON (tenant_id, employee_id) WHERE is_current = true — at most one
 * "current" shift row per employee. fn_close_previous_employee_shift()
 * flips the previous current row's is_current to false (and sets its
 * effective_to) whenever a new current row is inserted, so day-to-day
 * shift reassignment / backdated-shift-history correction never ends up
 * with two current rows.
 *
 * The trigger was originally AFTER INSERT. For a single INSERT statement,
 * Postgres checks a non-deferrable unique index's constraint immediately
 * once the new row is in place — before any AFTER trigger on that same
 * row fires. So by the time the AFTER trigger tried to close the previous
 * row, the new row had already failed insertion against the still-open
 * previous row: every shift reassignment for an employee who already had
 * a current shift failed outright with a unique-violation.
 *
 * Migration 453 changes the trigger to BEFORE INSERT, so the previous
 * row is closed before the new row's own uniqueness is checked.
 *
 * Run against a throwaway database with the full migration history (000
 * through at least 453) applied — this also re-verifies migration 453
 * applies cleanly from a fresh install, not just ad-hoc against an
 * already-running database (which is how the fix was first validated
 * during the live UAT).
 *
 * Proves, against a real Postgres transaction:
 *   A. Reassigning an employee who already has a current shift succeeds
 *      (previously: unique-violation on uq_employee_shifts_current).
 *   B. Exactly one row is left with is_current = true afterward.
 *   C. The previous row is correctly closed: is_current = false,
 *      effective_to = new row's effective_from - 1 day.
 *   D. A second reassignment (three shifts total for one employee) still
 *      works and still leaves exactly one current row — not a one-shot
 *      fix that only covers going from zero to one current rows.
 *   E. Two DIFFERENT employees each getting their first shift assignment
 *      (no previous row to close) are unaffected — the trigger's no-op
 *      branch (NEW.is_current false, or no existing row) still behaves.
 */
import pg from 'pg'

const { Client } = pg
const conn = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'shift_trigger_verify',
}

let failures = 0
function check(label, cond) {
  if (cond) console.log(`  OK   ${label}`)
  else { console.log(`  FAIL ${label}`); failures++ }
}

async function seedEmployee(client, tenantId) {
  const id = (await client.query(
    `INSERT INTO employees (tenant_id, employee_code, first_name, last_name, email, joining_date)
     VALUES ($1, $2, 'Test', 'Employee', $3, '2020-01-01') RETURNING id`,
    [tenantId, `E${Math.random().toString(36).slice(2, 8)}`, `e${Math.random().toString(36).slice(2)}@example.com`],
  )).rows[0].id
  return id
}

async function seedShift(client, tenantId, name) {
  const id = (await client.query(
    `INSERT INTO shifts (tenant_id, name, start_time, end_time) VALUES ($1, $2, '09:00', '18:00') RETURNING id`,
    [tenantId, name],
  )).rows[0].id
  return id
}

async function main() {
  const db = new Client(conn)
  await db.connect()

  const tenantId = (await db.query(
    `INSERT INTO tenants (name, slug) VALUES ('shift-trigger-verify', 'shift-trigger-verify') RETURNING id`,
  )).rows[0].id
  const shiftA = await seedShift(db, tenantId, 'General Shift')
  const shiftB = await seedShift(db, tenantId, 'Evening Shift')
  const shiftC = await seedShift(db, tenantId, 'Night Shift')

  // ── A/B/C. Reassign an employee who already has a current shift ──────────
  console.log('\n[A/B/C] Reassigning an employee who already has a current shift')
  {
    const empId = await seedEmployee(db, tenantId)
    const firstId = (await db.query(
      `INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from, is_current)
       VALUES ($1, $2, $3, '2026-01-01', true) RETURNING id`,
      [tenantId, empId, shiftA],
    )).rows[0].id

    let insertErr = null
    let secondId = null
    try {
      secondId = (await db.query(
        `INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from, is_current)
         VALUES ($1, $2, $3, '2026-10-08', true) RETURNING id`,
        [tenantId, empId, shiftB],
      )).rows[0].id
    } catch (e) {
      insertErr = e
    }

    check('reassignment INSERT succeeds (pre-453: unique-violation on uq_employee_shifts_current)', !insertErr)
    if (insertErr) console.log(`       error was: ${insertErr.message}`)

    const { rows: currentRows } = await db.query(
      `SELECT id FROM employee_shifts WHERE tenant_id = $1 AND employee_id = $2 AND is_current = true`,
      [tenantId, empId],
    )
    check('exactly one current row remains', currentRows.length === 1)
    check('the current row is the new one', currentRows[0]?.id === secondId)

    const { rows: closedRows } = await db.query(
      `SELECT is_current, effective_to FROM employee_shifts WHERE id = $1`,
      [firstId],
    )
    check('previous row closed: is_current = false', closedRows[0]?.is_current === false)
    check(
      "previous row's effective_to = new row's effective_from - 1 day (2026-10-07)",
      closedRows[0]?.effective_to instanceof Date
        ? closedRows[0].effective_to.toISOString().slice(0, 10) === '2026-10-07'
        : closedRows[0]?.effective_to === '2026-10-07',
    )

    // ── D. A second reassignment for the same employee still works ─────────
    console.log('\n[D] A second reassignment (three shifts total) still works')
    let secondReassignErr = null
    let thirdId = null
    try {
      thirdId = (await db.query(
        `INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from, is_current)
         VALUES ($1, $2, $3, '2026-10-20', true) RETURNING id`,
        [tenantId, empId, shiftC],
      )).rows[0].id
    } catch (e) {
      secondReassignErr = e
    }
    check('second reassignment INSERT also succeeds', !secondReassignErr)
    const { rows: currentRows2 } = await db.query(
      `SELECT id FROM employee_shifts WHERE tenant_id = $1 AND employee_id = $2 AND is_current = true`,
      [tenantId, empId],
    )
    check('still exactly one current row after the second reassignment', currentRows2.length === 1)
    check('the current row is now the third one', currentRows2[0]?.id === thirdId)
  }

  // ── E. Two different employees' first assignment are unaffected ──────────
  console.log('\n[E] Two different employees getting their first shift assignment')
  {
    const empX = await seedEmployee(db, tenantId)
    const empY = await seedEmployee(db, tenantId)
    let err = null
    try {
      await db.query(
        `INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from, is_current)
         VALUES ($1, $2, $3, '2026-01-01', true)`,
        [tenantId, empX, shiftA],
      )
      await db.query(
        `INSERT INTO employee_shifts (tenant_id, employee_id, shift_id, effective_from, is_current)
         VALUES ($1, $2, $3, '2026-01-01', true)`,
        [tenantId, empY, shiftA],
      )
    } catch (e) {
      err = e
    }
    check('two different employees can each get a first current shift with no collision', !err)
  }

  await db.end()
  console.log(failures === 0 ? `\nALL CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
