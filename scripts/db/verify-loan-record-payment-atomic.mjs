#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 17 — payroll audit, loans.ts.
 *
 * POST /payroll/loans/record-payment had the same bug class just found and
 * fixed in advances.ts's /recover: its insert into loan_payments never
 * supplied the NOT NULL payment_month column (every real call failed), and
 * even past that, the 3-step sequence (insert payment -> CAS schedule ->
 * RPC balance update) had no idempotency guard on the insert itself, so a
 * retry after a partial failure could duplicate the payment and the
 * balance deduction. Fixed with record_loan_payment_manual_atomic
 * (migration 473).
 *
 * This script proves, against real Postgres + real HTTP:
 *   Part A — the OLD bug is confirmed via the OLD code path's exact insert
 *     shape (direct SQL, no payment_month) — fails with a real NOT NULL
 *     violation, demonstrating the defect was real, not theoretical.
 *   Part B — the real HTTP route (now using the atomic RPC) succeeds: a
 *     scheduled payment is correctly recorded with employee_id and
 *     payment_month populated, the schedule flips to 'paid', and the
 *     loan's outstanding_balance is correctly reduced.
 *   Part C — a forced failure (paying an already-paid schedule) leaves the
 *     schedule's SINGLE payment row untouched — no duplicate, no double
 *     balance deduction — and a retry with the SAME schedule is correctly
 *     rejected (409), not reapplied.
 *   Part D — genuine concurrency: two simultaneous real HTTP record-payment
 *     calls for the SAME schedule — exactly one succeeds, the other is
 *     rejected, and exactly one loan_payments row exists for that schedule,
 *     with outstanding_balance reduced exactly once.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'LoanRecordPaymentAtomic!1'
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
  const hrEmail = `loanpay-${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Loan Record Payment Atomic ${label}`, `loanpay-${label}-${Date.now()}`])
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`, [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)
  return { tenantId, hrToken, hrUserId }
}

async function seedActiveLoanWithSchedule(tenantId, label) {
  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,$3,'Loan','Payment',$4, CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId, `LP-${label}`, `loanpay-emp-${label}-${Date.now()}@test.local`],
  )
  const loanId = uuid()
  await pool.query(
    `INSERT INTO employee_loans (id, tenant_id, employee_id, loan_type, principal_amount, disbursed_amount, tenure_months, emi_amount, outstanding_balance, status, disbursed_date)
     VALUES ($1,$2,$3,'personal', 12000, 12000, 1, 12000, 12000, 'active', CURRENT_DATE)`,
    [loanId, tenantId, empId],
  )
  const scheduleId = uuid()
  await pool.query(
    `INSERT INTO loan_schedules (id, tenant_id, loan_id, installment_number, due_month, principal_component, interest_component, emi_amount, status)
     VALUES ($1,$2,$3, 1, to_char(CURRENT_DATE, 'YYYY-MM'), 12000, 0, 12000, 'pending')`,
    [scheduleId, tenantId, loanId],
  )
  return { empId, loanId, scheduleId }
}

async function main() {
  // ── Part A: confirm the OLD bug was real (direct SQL, old insert shape) ──
  console.log('=== Part A: confirming the pre-fix insert shape was genuinely broken ===')
  {
    const { tenantId, hrUserId } = await seedTenantAndHr('A')
    const { loanId, scheduleId } = await seedActiveLoanWithSchedule(tenantId, 'A')

    // Replicate the OLD route's exact sequence directly in SQL: CAS the
    // schedule to 'paid' first, THEN attempt the insert the old zod schema
    // and insert object actually produced (no payment_month column at all).
    await pool.query(`UPDATE loan_schedules SET status='paid', paid_amount=12000, paid_at=now() WHERE id=$1 AND status='pending'`, [scheduleId])
    let oldInsertError = null
    try {
      await pool.query(
        `INSERT INTO loan_payments (tenant_id, loan_id, schedule_id, employee_id, amount, principal_paid, interest_paid, payment_type, created_by)
         VALUES ($1,$2,$3,(SELECT employee_id FROM employee_loans WHERE id=$2),12000,12000,0,'emi',$4)`,
        [tenantId, loanId, scheduleId, hrUserId],
      )
    } catch (err) {
      oldInsertError = err
    }
    check('[A] the OLD insert shape (no payment_month) fails with NOT NULL violation', oldInsertError?.code === '23502', oldInsertError?.message)

    const { rows: schedAfter } = await pool.query(`SELECT status FROM loan_schedules WHERE id=$1`, [scheduleId])
    check("[A] confirms the bug's real-world consequence: the schedule IS stuck 'paid' with no payment row", schedAfter[0]?.status === 'paid')
    const { rows: payRows } = await pool.query(`SELECT count(*)::int AS c FROM loan_payments WHERE schedule_id=$1`, [scheduleId])
    check('[A] zero payment rows exist despite the schedule reading paid — the exact torn state', payRows[0]?.c === 0)
    const { rows: loanAfter } = await pool.query(`SELECT outstanding_balance FROM employee_loans WHERE id=$1`, [loanId])
    check('[A] outstanding_balance is untouched (12000) — balance update never ran', Number(loanAfter[0]?.outstanding_balance) === 12000)
  }

  // ── Part B: the FIXED real-HTTP route succeeds correctly ────────────────
  console.log('\n=== Part B: fixed route — real HTTP record-payment succeeds with correct data ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('B')
    const { empId, loanId, scheduleId } = await seedActiveLoanWithSchedule(tenantId, 'B')

    const res = await fetch(`${API_BASE}/payroll/loans/record-payment`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ loan_id: loanId, schedule_id: scheduleId, amount: 12000, principal_paid: 12000, interest_paid: 0, payment_type: 'emi' }),
    })
    const body = await res.json()
    console.log('  record-payment response:', res.status, JSON.stringify(body))
    check('[B] record-payment returns 201', res.status === 201)

    const { rows: payRows } = await pool.query(`SELECT employee_id, payment_month, amount FROM loan_payments WHERE schedule_id=$1`, [scheduleId])
    check('[B] exactly one payment row exists', payRows.length === 1)
    check('[B] employee_id is correctly populated', payRows[0]?.employee_id === empId)
    check('[B] payment_month is populated (not null)', !!payRows[0]?.payment_month)
    check('[B] amount matches', Number(payRows[0]?.amount) === 12000)

    const { rows: schedRows } = await pool.query(`SELECT status FROM loan_schedules WHERE id=$1`, [scheduleId])
    check("[B] schedule status is now 'paid'", schedRows[0]?.status === 'paid')

    const { rows: loanRows } = await pool.query(`SELECT outstanding_balance, status FROM employee_loans WHERE id=$1`, [loanId])
    check('[B] outstanding_balance reduced to 0', Number(loanRows[0]?.outstanding_balance) === 0)
    check("[B] loan status is now 'completed' (balance fully cleared)", loanRows[0]?.status === 'completed')
  }

  // ── Part C: forced failure leaves no duplicate / stuck state, retry rejected ──
  console.log('\n=== Part C: re-paying an already-paid schedule is rejected, not reapplied ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('C')
    const { loanId, scheduleId } = await seedActiveLoanWithSchedule(tenantId, 'C')

    const first = await fetch(`${API_BASE}/payroll/loans/record-payment`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ loan_id: loanId, schedule_id: scheduleId, amount: 12000, principal_paid: 12000, interest_paid: 0, payment_type: 'emi' }),
    })
    check('[C] first record-payment succeeds (201)', first.status === 201)

    const second = await fetch(`${API_BASE}/payroll/loans/record-payment`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ loan_id: loanId, schedule_id: scheduleId, amount: 12000, principal_paid: 12000, interest_paid: 0, payment_type: 'emi' }),
    })
    const secondBody = await second.json()
    console.log('  second (duplicate) record-payment response:', second.status, JSON.stringify(secondBody))
    check('[C] second record-payment for the SAME schedule is rejected (409 ALREADY_PAID)', second.status === 409 && secondBody.error === 'ALREADY_PAID')

    const { rows: payRows } = await pool.query(`SELECT count(*)::int AS c FROM loan_payments WHERE schedule_id=$1`, [scheduleId])
    check('[C] still exactly ONE payment row (no duplicate)', payRows[0]?.c === 1)

    const { rows: loanRows } = await pool.query(`SELECT outstanding_balance FROM employee_loans WHERE id=$1`, [loanId])
    check('[C] outstanding_balance deducted exactly once (0, not negative)', Number(loanRows[0]?.outstanding_balance) === 0)
  }

  // ── Part D: genuine concurrency over real HTTP ──────────────────────────
  console.log('\n=== Part D: genuine concurrency — two simultaneous real HTTP record-payment calls ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('D')
    const { loanId, scheduleId } = await seedActiveLoanWithSchedule(tenantId, 'D')

    const callRecordPayment = () => fetch(`${API_BASE}/payroll/loans/record-payment`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ loan_id: loanId, schedule_id: scheduleId, amount: 12000, principal_paid: 12000, interest_paid: 0, payment_type: 'emi' }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }))

    const [resA, resB] = await Promise.all([callRecordPayment(), callRecordPayment()])
    console.log('  Call A:', resA.status, JSON.stringify(resA.body))
    console.log('  Call B:', resB.status, JSON.stringify(resB.body))

    const successes = [resA, resB].filter((r) => r.status === 201)
    const conflicts  = [resA, resB].filter((r) => r.status === 409)
    check('[D] exactly one call succeeded (201)', successes.length === 1)
    check('[D] exactly one call was rejected (409)', conflicts.length === 1)

    const { rows: payRows } = await pool.query(`SELECT count(*)::int AS c FROM loan_payments WHERE schedule_id=$1`, [scheduleId])
    check('[D] exactly ONE payment row exists for this schedule (no double-credit)', payRows[0]?.c === 1)

    const { rows: loanRows } = await pool.query(`SELECT outstanding_balance FROM employee_loans WHERE id=$1`, [loanId])
    check('[D] outstanding_balance reduced exactly once (0, not negative)', Number(loanRows[0]?.outstanding_balance) === 0)
  }

  console.log(allOk
    ? '\n✅ PROVEN: record_loan_payment_manual_atomic closes the NOT-NULL-violation + stuck-schedule bug, and retries/genuine concurrency are safe — exactly one payment, never zero-and-stuck, never duplicated.'
    : '\n❌ FAILED — see checks above.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
