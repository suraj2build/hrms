#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 16 — payroll audit, runs.ts.
 *
 * DELETE /payroll/runs/:id read `status` in a SEPARATE statement from the
 * actual DELETE, which filtered only on id/tenant_id — no status in its
 * WHERE clause. Between the read and the delete, a concurrent finalize
 * (or anything else that transitions status) could land, after which this
 * route would hard-delete a now-finalized run and its real payslips,
 * completely bypassing the "finalized runs cannot be deleted" rule the
 * pre-check exists to enforce. Fixed by folding `.neq('status',
 * 'finalized').neq('status', 'processing')` into the DELETE's own WHERE
 * clause, so the guard is authoritative at the moment of deletion.
 *
 * This script proves the fix under GENUINE concurrency with two live
 * Postgres connections, the same pattern already established in this
 * codebase for its core financial RPCs (see verify-rollback-
 * concurrency.mjs): one connection holds an UPDATE...SET status=
 * 'finalized' inside an open (uncommitted) transaction on the run row;
 * while that transaction is open, the real HTTP DELETE call is fired —
 * it must block on the row lock, then (once the holding transaction
 * commits) re-evaluate its WHERE clause against the now-committed
 * 'finalized' status and correctly delete ZERO rows, returning 409
 * RUN_STATE_CHANGED rather than silently succeeding.
 *
 * Part B is the deterministic counterpart: a run already finalized
 * BEFORE the DELETE call arrives must be rejected the same way — proving
 * the WHERE-clause fix itself, independent of genuine race timing.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'RunDeleteCas!1'
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
  const hrEmail = `rundel-${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Run Delete CAS ${label}`, `rundel-${label}-${Date.now()}`])
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`, [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)
  return { tenantId, hrToken }
}

async function seedDraftRun(tenantId, month) {
  const runId = uuid()
  await pool.query(
    `INSERT INTO payroll_runs (id, tenant_id, month, status) VALUES ($1,$2,$3,'draft')`,
    [runId, tenantId, month],
  )
  return runId
}

async function httpDelete(hrToken, runId) {
  const res = await fetch(`${API_BASE}/payroll/runs/${runId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${hrToken}` },
  })
  return { status: res.status, body: await res.json() }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  // ── Part A: genuine concurrency — DELETE races a finalize-in-progress ──────
  console.log('=== Part A: genuine concurrency (finalize transitions mid-flight, holds the row lock) ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('A')
    const runId = await seedDraftRun(tenantId, '2026-05')

    const holdConn = await pool.connect()
    await holdConn.query('BEGIN')
    await holdConn.query(`UPDATE payroll_runs SET status='finalized' WHERE id=$1 AND tenant_id=$2`, [runId, tenantId])
    // Transaction left OPEN (not committed) — holds the row lock.

    const deletePromise = httpDelete(hrToken, runId)

    // Give the DELETE time to reach the DB and block on the row lock.
    await sleep(300)

    let deleteSettledEarly = false
    deletePromise.then(() => { deleteSettledEarly = true })
    await sleep(150)
    check('[A] DELETE is still blocked ~450ms in (has not returned while the finalize tx is open)', !deleteSettledEarly)

    // Now commit the finalize — the blocked DELETE should proceed, see the
    // committed 'finalized' status, match 0 rows, and return 409.
    await holdConn.query('COMMIT')
    holdConn.release()

    const delResult = await deletePromise
    console.log('  DELETE result after finalize commit:', delResult.status, JSON.stringify(delResult.body))
    check('[A] DELETE returns 409 RUN_STATE_CHANGED (not 200) once the run is finalized', delResult.status === 409 && delResult.body?.error === 'RUN_STATE_CHANGED')

    const { rows: afterRows } = await pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
    check('[A] the run row still exists (was NOT deleted)', afterRows.length === 1)
    check("[A] the run's status is still 'finalized' (untouched by the rejected delete)", afterRows[0]?.status === 'finalized')
  }

  // ── Part B: deterministic — run already finalized before DELETE arrives ───
  console.log('\n=== Part B: deterministic — run already finalized when DELETE is called ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('B')
    const runId = await seedDraftRun(tenantId, '2026-05')
    await pool.query(`UPDATE payroll_runs SET status='finalized' WHERE id=$1 AND tenant_id=$2`, [runId, tenantId])

    const delResult = await httpDelete(hrToken, runId)
    console.log('  DELETE result on an already-finalized run:', delResult.status, JSON.stringify(delResult.body))
    // The route's own pre-check (separate from the CAS fix) catches this
    // case with a friendlier RUN_FINALIZED message — confirming the
    // pre-check and the CAS guard both independently refuse to delete a
    // finalized run, belt-and-suspenders.
    check('[B] DELETE returns 409 (RUN_FINALIZED, via the pre-check) for an already-finalized run', delResult.status === 409 && delResult.body?.error === 'RUN_FINALIZED')

    const { rows: afterRows } = await pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
    check('[B] the run row still exists (was NOT deleted)', afterRows.length === 1 && afterRows[0]?.status === 'finalized')
  }

  // ── Part C: sanity — a genuinely draft run can still be deleted normally ───
  console.log('\n=== Part C: sanity — deleting a real draft run still works ===')
  {
    const { tenantId, hrToken } = await seedTenantAndHr('C')
    const runId = await seedDraftRun(tenantId, '2026-05')
    const delResult = await httpDelete(hrToken, runId)
    console.log('  DELETE result on a genuine draft run:', delResult.status, JSON.stringify(delResult.body))
    check('[C] DELETE returns 200 for a genuine draft run (fix does not break the happy path)', delResult.status === 200)
    const { rows: afterRows } = await pool.query(`SELECT 1 FROM payroll_runs WHERE id=$1`, [runId])
    check('[C] the draft run is actually gone', afterRows.length === 0)
  }

  console.log(allOk
    ? '\n✅ FIXED: the DELETE route cannot hard-delete a run that transitions to finalized/processing concurrently, proven under genuine two-connection concurrency; the happy path (deleting a real draft) is unaffected.'
    : '\n❌ STILL BROKEN — see failures above.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
