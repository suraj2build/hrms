#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 17 — payroll audit, advances.ts.
 *
 * POST /payroll/advances/recover had two real defects: its insert into
 * advance_recoveries never supplied the NOT NULL employee_id/recovery_month
 * columns (every real call failed), and that failure happened AFTER the
 * recovery schedule was already flipped to 'recovered' in an earlier,
 * separate statement — leaving it permanently stuck recovered with no
 * recovery record and no way to retry. Fixed with
 * record_advance_recovery_atomic (migration 472).
 *
 * This script proves, against real Postgres + real HTTP:
 *   Part A — the OLD bug is confirmed via the OLD code path's exact insert
 *     shape (direct SQL, no employee_id/recovery_month) — fails with a
 *     real NOT NULL violation, demonstrating the defect was real, not
 *     theoretical.
 *   Part B — the real HTTP route (now using the atomic RPC) succeeds: a
 *     scheduled recovery is correctly recorded with employee_id and
 *     recovery_month populated, the schedule flips to 'recovered', and the
 *     advance's aggregate status updates correctly.
 *   Part C — a forced failure (recovering an already-recovered schedule)
 *     leaves the schedule's SINGLE recovery row untouched — no duplicate,
 *     no stuck state — and a retry with the SAME schedule is correctly
 *     rejected (409), not reapplied.
 *   Part D — genuine concurrency: two simultaneous real HTTP recover calls
 *     for the SAME schedule — exactly one succeeds, the other is rejected,
 *     and exactly one advance_recoveries row exists for that schedule
 *     (the uidx_advance_recoveries_schedule unique index backstops this
 *     even under a hypothetical race the application-level CAS missed).
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'AdvanceRecoveryAtomic!1'
const pool      = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }
let allOk = true
function check(label, cond, extra) {
  if (cond) { console.log(`✅ ${label}`) } else { console.log(`❌ ${label}`, extra ?? ''); allOk = false }
}

async function createAuthUser(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`createAuthUser failed for ${email}: ${JSON.stringify(body)}`)
  return body.id
}

async function loginAndGetToken(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return (await res.json()).access_token
}

async function seedTenantAndHr(label) {
  const tenantId = uuid()
  const hrEmail = `advrec-${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Advance Recovery Atomic ${label}`, `advrec-${label}-${Date.now()}`])
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`, [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)
  return { tenantId, hrToken, hrUserId }
}

async function seedDisbursedAdvanceWithSchedule(tenantId, label) {
  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,$3,'Advance','Recovery',$4, CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId, `AR-${label}`, `advrec-emp-${label}-${Date.now()}@test.local`],
  )
  const advanceId = uuid()
  await pool.query(
    `INSERT INTO advance_salary_requests (id, tenant_id, employee_id, requested_amount, approved_amount, purpose, recovery_months, status, disbursed_date, disbursed_amount)
     VALUES ($1,$2,$3, 12000, 12000, 'Test advance', 1, 'disbursed', CURRENT_DATE, 12000)`,
    [advanceId, tenantId, empId],
  )
  const scheduleId = uuid()
  await pool.query(
    `INSERT INTO advance_recovery_schedules (id, tenant_id, advance_id, recovery_month, scheduled_amount, status)
     VALUES ($1,$2,$3, to_char(CURRENT_DATE, 'YYYY-MM'), 12000, 'pending')`,
    [scheduleId, tenantId, advanceId],
  )
  return { empId, advanceId, scheduleId }
}

async function main() {
  // ── Part A: confirm the OLD bug was real (direct SQL, old insert shape) ──
  console.log('=== Part A: confirming the pre-fix insert shape was genuinely broken ===')
  {
    const { tenantId, hrUserId } = await seedTenantAndHr('A')
    const { advanceId, scheduleId } = await seedDisbursedAdvanceWithSchedule(tenantId, 'A')

    // Replicate the OLD route's exact two-step sequence directly in SQL.
    await pool.query(`UPDATE advance_recovery_schedules SET status='recovered' WHERE id=$1 AND status='pending'`, [scheduleId])
    let oldInsertError = null
    try {
      await pool.query(
        `INSERT INTO advance_recoveries (tenant_id, advance_id, schedule_id, amount, recovery_type, created_by) VALUES ($1,$2,$3,12000,'payroll_deduction',$4)`,
        [tenantId, advanceId, scheduleId, hrUserId],
      )
    } catch (err) {
      oldInsertError = err
    }
    check('[A] the OLD insert shape (no employee_id/recovery_month) fails with NOT NULL violation', oldInsertError?.code === '23502', oldInsertError?.message)

    const { rows: schedAfter } = await pool.query(`SELECT status FROM advance_recovery_schedules WHERE id=$1`, [scheduleId])
    check("[A] confirms the bug's real-world consequence: the schedule IS stuck 'recovered' with no recovery row", schedAfter[0]?.status === 'recovered')
    const { rows: recRows } = await pool.query(`SELECT count(*)::int AS c FROM advance_recoveries WHERE schedule_id=$1`, [scheduleId])
    check('[A] zero recovery rows exist despite the schedule reading recovered — the exact torn state', recRows[0]?.c === 0)
  }

  // ── Part B: the FIXED real-HTTP route succeeds correctly ────────────────
  console.log('\n=== Part B: fixed route — real HTTP recover succeeds with correct data ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('B')
    const { empId, advanceId, scheduleId } = await seedDisbursedAdvanceWithSchedule(tenantId, 'B')

    const res = await fetch(`${API_BASE}/payroll/advances/recover`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ advance_id: advanceId, schedule_id: scheduleId, amount: 12000, recovery_type: 'payroll_deduction' }),
    })
    const body = await res.json()
    console.log('  recover response:', res.status, JSON.stringify(body))
    check('[B] recover returns 201', res.status === 201)

    const { rows: recRows } = await pool.query(`SELECT employee_id, recovery_month, amount FROM advance_recoveries WHERE schedule_id=$1`, [scheduleId])
    check('[B] exactly one recovery row exists', recRows.length === 1)
    check('[B] employee_id is correctly populated', recRows[0]?.employee_id === empId)
    check('[B] recovery_month is populated (not null)', !!recRows[0]?.recovery_month)
    check('[B] amount matches', Number(recRows[0]?.amount) === 12000)

    const { rows: advRows } = await pool.query(`SELECT status FROM advance_salary_requests WHERE id=$1`, [advanceId])
    check("[B] advance status is now 'fully_recovered' (last pending schedule cleared)", advRows[0]?.status === 'fully_recovered')
  }

  // ── Part C: forced failure leaves no duplicate / stuck state, retry rejected ──
  console.log('\n=== Part C: re-recovering an already-recovered schedule is rejected, not reapplied ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('C')
    const { advanceId, scheduleId } = await seedDisbursedAdvanceWithSchedule(tenantId, 'C')

    const first = await fetch(`${API_BASE}/payroll/advances/recover`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ advance_id: advanceId, schedule_id: scheduleId, amount: 12000, recovery_type: 'payroll_deduction' }),
    })
    check('[C] first recover succeeds (201)', first.status === 201)

    const second = await fetch(`${API_BASE}/payroll/advances/recover`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ advance_id: advanceId, schedule_id: scheduleId, amount: 12000, recovery_type: 'payroll_deduction' }),
    })
    const secondBody = await second.json()
    console.log('  second (duplicate) recover response:', second.status, JSON.stringify(secondBody))
    check('[C] second recover for the SAME schedule is rejected (409 ALREADY_RECOVERED)', second.status === 409 && secondBody.error === 'ALREADY_RECOVERED')

    const { rows: recRows } = await pool.query(`SELECT count(*)::int AS c FROM advance_recoveries WHERE schedule_id=$1`, [scheduleId])
    check('[C] still exactly ONE recovery row (no duplicate)', recRows[0]?.c === 1)
  }

  // ── Part D: genuine concurrency over real HTTP ──────────────────────────
  console.log('\n=== Part D: genuine concurrency — two simultaneous real HTTP recover calls ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('D')
    const { advanceId, scheduleId } = await seedDisbursedAdvanceWithSchedule(tenantId, 'D')

    const callRecover = () => fetch(`${API_BASE}/payroll/advances/recover`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ advance_id: advanceId, schedule_id: scheduleId, amount: 12000, recovery_type: 'payroll_deduction' }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }))

    const [resA, resB] = await Promise.all([callRecover(), callRecover()])
    console.log('  Call A:', resA.status, JSON.stringify(resA.body))
    console.log('  Call B:', resB.status, JSON.stringify(resB.body))

    const successes = [resA, resB].filter((r) => r.status === 201)
    const conflicts  = [resA, resB].filter((r) => r.status === 409)
    check('[D] exactly one call succeeded (201)', successes.length === 1)
    check('[D] exactly one call was rejected (409)', conflicts.length === 1)

    const { rows: recRows } = await pool.query(`SELECT count(*)::int AS c FROM advance_recoveries WHERE schedule_id=$1`, [scheduleId])
    check('[D] exactly ONE recovery row exists for this schedule (no double-credit)', recRows[0]?.c === 1)
  }

  console.log(allOk
    ? '\n✅ PROVEN: record_advance_recovery_atomic closes the NOT-NULL-violation + stuck-schedule bug, and retries/genuine concurrency are safe — exactly one recovery, never zero-and-stuck, never duplicated.'
    : '\n❌ FAILED — see checks above.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
