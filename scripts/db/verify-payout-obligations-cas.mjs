#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 19 — payroll audit, payout-batches.ts.
 *
 * POST /payroll/runs/:id/payout-obligations generated bank-disbursement
 * obligation rows guarded only by a check-then-insert ("0 existing rows for
 * this run?" read, then insert) with no DB-level guard — payroll_payout_
 * reconciliation had no unique constraint on (run_id, slip_id). Two
 * concurrent calls for the same finalized run would both pass the same
 * read and both insert a full obligation set, doubling every
 * expected_amount in the bank disbursement reconciliation. Fixed with a
 * unique index on (tenant_id, run_id, slip_id) (migration 475) plus a
 * 23505 -> 409 mapping in the route.
 *
 * This script proves, against real Postgres + real HTTP:
 *   Part A — genuine concurrency: two simultaneous real HTTP calls to
 *     generate obligations for the SAME finalized run — exactly one
 *     succeeds, the other is rejected 409, and exactly ONE obligation row
 *     per slip exists afterward (no doubled expected_amount).
 *   Part B — sequential retry after success is still correctly rejected
 *     (the pre-check's own fast path).
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'PayoutObligationsCas!1'
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

async function seedFinalizedRunWithSlips(label, numSlips) {
  const tenantId = uuid()
  const hrEmail = `payout-${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Payout Obligations CAS ${label}`, `payout-${label}-${Date.now()}`])
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`, [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)

  const runId = uuid()
  await pool.query(
    `INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count, total_gross, total_net)
     VALUES ($1,$2,'2026-10','finalized',$3, 100000, 90000)`,
    [runId, tenantId, numSlips],
  )

  const slipIds = []
  for (let i = 0; i < numSlips; i++) {
    const empId = uuid()
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
       VALUES ($1,$2,$3,'Payout','Test',$4, CURRENT_DATE - INTERVAL '2 years', 'active')`,
      [empId, tenantId, `PO-${label}-${i}`, `payout-emp-${label}-${i}-${Date.now()}@test.local`],
    )
    const slipId = uuid()
    await pool.query(
      `INSERT INTO payroll_slips (id, tenant_id, run_id, employee_id, month, net_pay, gross_pay, status)
       VALUES ($1,$2,$3,$4,'2026-10', 45000, 50000, 'finalized')`,
      [slipId, tenantId, runId, empId],
    )
    slipIds.push(slipId)
  }
  return { tenantId, hrToken, runId, slipIds }
}

async function main() {
  // ── Part A: genuine concurrency over real HTTP ──────────────────────────
  console.log('=== Part A: two simultaneous real HTTP calls to generate obligations for the same run ===')
  {
    const { runId, hrToken, slipIds } = await seedFinalizedRunWithSlips('A', 5)

    const callGenerate = () => fetch(`${API_BASE}/payroll/runs/${runId}/payout-obligations`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}` },
    }).then(async (r) => ({ status: r.status, body: await r.json() }))

    const [resA, resB] = await Promise.all([callGenerate(), callGenerate()])
    console.log('  Call A:', resA.status, JSON.stringify(resA.body))
    console.log('  Call B:', resB.status, JSON.stringify(resB.body))

    const successes = [resA, resB].filter((r) => r.status === 200 || r.status === 201)
    const conflicts  = [resA, resB].filter((r) => r.status === 409)
    check('[A] exactly one call succeeded', successes.length === 1, JSON.stringify([resA.status, resB.status]))
    check('[A] exactly one call was rejected (409 OBLIGATIONS_EXIST)', conflicts.length === 1 && conflicts[0].body.error === 'OBLIGATIONS_EXIST')

    const { rows } = await pool.query(`SELECT slip_id, count(*)::int AS c FROM payroll_payout_reconciliation WHERE run_id=$1 GROUP BY slip_id`, [runId])
    check('[A] exactly 5 distinct slip_id rows (one per slip, not doubled)', rows.length === 5, JSON.stringify(rows))
    check('[A] no slip_id has more than one obligation row', rows.every(r => r.c === 1), JSON.stringify(rows))

    const { rows: totalRows } = await pool.query(`SELECT count(*)::int AS c, sum(expected_amount)::numeric AS total FROM payroll_payout_reconciliation WHERE run_id=$1`, [runId])
    check('[A] total obligation count is exactly 5, not 10', totalRows[0]?.c === 5)
    check('[A] total expected_amount is 225000 (5 x 45000), not doubled', Number(totalRows[0]?.total) === 225000)
  }

  // ── Part B: sequential retry after success is rejected ──────────────────
  console.log('\n=== Part B: a sequential retry after success is rejected, not reapplied ===')
  {
    const { runId, hrToken } = await seedFinalizedRunWithSlips('B', 3)

    const first = await fetch(`${API_BASE}/payroll/runs/${runId}/payout-obligations`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}` },
    })
    check('[B] first call succeeds', first.status === 200 || first.status === 201)

    const second = await fetch(`${API_BASE}/payroll/runs/${runId}/payout-obligations`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}` },
    })
    const secondBody = await second.json()
    console.log('  second (sequential retry) response:', second.status, JSON.stringify(secondBody))
    check('[B] second call is rejected (409 OBLIGATIONS_EXIST)', second.status === 409 && secondBody.error === 'OBLIGATIONS_EXIST')

    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM payroll_payout_reconciliation WHERE run_id=$1`, [runId])
    check('[B] still exactly 3 obligation rows (no duplicate)', rows[0]?.c === 3)
  }

  console.log(allOk
    ? '\n✅ PROVEN: the unique index on (tenant_id, run_id, slip_id) closes the duplicate-obligation race — genuine concurrency and sequential retries both leave exactly one obligation row per slip.'
    : '\n❌ FAILED — see checks above.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
