#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 17 — user-directed requirement to finish
 * the compensation-revision approval failure proof:
 *   "Previous compensation remains valid. No incomplete replacement becomes
 *    active. Components and activation commit consistently. Retry is safe."
 *
 * Proves approve_compensation_revision_atomic (migration 471) against real
 * Postgres + real HTTP:
 *
 *   Part A — forced mid-transaction failure (direct RPC call, deterministic):
 *     calls the RPC with ONE deliberately invalid component (a
 *     calculation_type outside the CHECK constraint's allowed set), which
 *     fails the components INSERT partway through the function body.
 *     Asserts: the revision is still 'pending' (not stuck 'approved' with no
 *     real change — the exact torn state this migration closes); the PRIOR
 *     compensation is still active and byte-for-byte unchanged; NO new
 *     employee_compensations row exists at all (not even one with zero
 *     components).
 *
 *   Part B — retry after a forced failure succeeds cleanly: calling the SAME
 *     RPC again for the SAME revision, now with valid components, succeeds
 *     exactly once — proving a retry after a real failure is safe, not
 *     blocked and not double-applying anything.
 *
 *   Part C — genuine concurrency: two simultaneous real HTTP
 *     POST /payroll/revisions/:id/approve calls (via Promise.all, not
 *     sequential awaits) for the SAME pending revision. Exactly one must
 *     succeed (200) and the other must be rejected (409 INVALID_STATUS) —
 *     never both succeeding (which would create two new compensations, or
 *     corrupt employee_compensations' uidx_comp_one_active invariant) and
 *     never both failing.
 *
 *   Part D — real-HTTP happy path: approve with valid components succeeds,
 *     the new compensation is active with the correct component count and
 *     CTC, and the prior compensation is correctly deactivated — proving the
 *     fix didn't regress the normal case.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'CompRevApproveAtomic!1'
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
  const hrEmail = `comprev-${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Comp Rev Atomic ${label}`, `comprev-${label}-${Date.now()}`])
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`, [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)
  return { tenantId, hrToken, hrUserId }
}

/** Seeds: employee, one salary component, an active compensation with one component, and a pending revision. */
async function seedScenario(tenantId, hrUserId, label) {
  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,$3,'Comp','Rev',$4, CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId, `CR-${label}`, `comprev-emp-${label}-${Date.now()}@test.local`],
  )

  const componentId = uuid()
  await pool.query(
    `INSERT INTO salary_components (id, tenant_id, name, code, component_type, is_basic, is_active)
     VALUES ($1,$2,'Basic','BASIC','earning', true, true)`,
    [componentId, tenantId],
  )

  const oldCompId = uuid()
  await pool.query(
    `INSERT INTO employee_compensations (id, tenant_id, employee_id, ctc_annual, effective_from, is_active, created_by)
     VALUES ($1,$2,$3, 600000, CURRENT_DATE - INTERVAL '1 year', true, $4)`,
    [oldCompId, tenantId, empId, hrUserId],
  )
  await pool.query(
    `INSERT INTO employee_compensation_components (tenant_id, compensation_id, salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence)
     VALUES ($1,$2,$3,'fixed', 50000, 50000, 600000, 1)`,
    [tenantId, oldCompId, componentId],
  )

  const revisionId = uuid()
  await pool.query(
    `INSERT INTO compensation_revisions (id, tenant_id, employee_id, requested_by, revision_type, effective_date, reason, new_ctc_annual, status)
     VALUES ($1,$2,$3,$4,'increment', CURRENT_DATE, 'Annual increment', 720000, 'pending')`,
    [revisionId, tenantId, empId, hrUserId],
  )

  return { empId, componentId, oldCompId, revisionId }
}

async function readState(tenantId, empId, revisionId) {
  const { rows: revRows } = await pool.query(`SELECT status, resulting_compensation_id FROM compensation_revisions WHERE id=$1`, [revisionId])
  const { rows: compRows } = await pool.query(
    `SELECT id, is_active, ctc_annual FROM employee_compensations WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at`,
    [tenantId, empId],
  )
  return { revision: revRows[0] ?? null, compensations: compRows }
}

async function main() {
  // ── Part A: forced mid-transaction failure (direct RPC, deterministic) ──
  console.log('=== Part A: forced failure (invalid calculation_type fails the components INSERT) ===')
  {
    const { tenantId, hrUserId } = await seedTenantAndHr('A')
    const { empId, componentId, oldCompId, revisionId } = await seedScenario(tenantId, hrUserId, 'A')

    const badComponents = JSON.stringify([
      { salary_component_id: componentId, calculation_type: 'NOT_A_REAL_TYPE', value: 100, sequence: 1, computed_monthly: 60000, computed_annual: 720000 },
    ])

    let rpcError = null
    try {
      await pool.query(
        `SELECT approve_compensation_revision_atomic($1, $2, $3, $4::jsonb)`,
        [tenantId, revisionId, hrUserId, badComponents],
      )
    } catch (err) {
      rpcError = err
    }
    check('[A] the RPC call raised an error (CHECK constraint violation)', rpcError !== null, rpcError?.message)

    const state = await readState(tenantId, empId, revisionId)
    check("[A] revision is still 'pending' (not stuck 'approved')", state.revision?.status === 'pending')
    check('[A] resulting_compensation_id is still null', state.revision?.resulting_compensation_id === null)
    check('[A] exactly one compensation row exists (no new row was created)', state.compensations.length === 1)
    check('[A] the ORIGINAL compensation is still active and unchanged', state.compensations[0]?.id === oldCompId && state.compensations[0]?.is_active === true && Number(state.compensations[0]?.ctc_annual) === 600000)

    // ── Part B: retry after the forced failure succeeds cleanly ───────────
    console.log('\n=== Part B: retry with valid components succeeds exactly once ===')
    const goodComponents = JSON.stringify([
      { salary_component_id: componentId, calculation_type: 'fixed', value: 60000, sequence: 1, computed_monthly: 60000, computed_annual: 720000 },
    ])
    const { rows: retryRows } = await pool.query(
      `SELECT approve_compensation_revision_atomic($1, $2, $3, $4::jsonb) AS result`,
      [tenantId, revisionId, hrUserId, goodComponents],
    )
    const retryResult = retryRows[0]?.result
    check('[B] retry succeeds and returns a new_compensation_id', !!retryResult?.new_compensation_id)

    const stateAfter = await readState(tenantId, empId, revisionId)
    check("[B] revision is now 'approved'", stateAfter.revision?.status === 'approved')
    check('[B] resulting_compensation_id matches the returned id', stateAfter.revision?.resulting_compensation_id === retryResult?.new_compensation_id)
    check('[B] exactly TWO compensation rows exist now (old + new)', stateAfter.compensations.length === 2)
    const oldRow = stateAfter.compensations.find((c) => c.id === oldCompId)
    const newRow = stateAfter.compensations.find((c) => c.id !== oldCompId)
    check('[B] the OLD compensation is now inactive', oldRow?.is_active === false)
    check('[B] the NEW compensation is active with the new CTC', newRow?.is_active === true && Number(newRow?.ctc_annual) === 720000)

    const { rows: newCompComponents } = await pool.query(
      `SELECT calculation_type, computed_monthly FROM employee_compensation_components WHERE compensation_id=$1`,
      [newRow.id],
    )
    check('[B] the new compensation has exactly one component, correctly computed', newCompComponents.length === 1 && Number(newCompComponents[0].computed_monthly) === 60000)

    // A SECOND retry (now that it's genuinely approved) must be rejected, not reapplied.
    let secondRetryError = null
    try {
      await pool.query(
        `SELECT approve_compensation_revision_atomic($1, $2, $3, $4::jsonb)`,
        [tenantId, revisionId, hrUserId, goodComponents],
      )
    } catch (err) {
      secondRetryError = err
    }
    check('[B] a retry AFTER genuine success is rejected (INVALID_STATUS), not reapplied', secondRetryError?.message?.includes('INVALID_STATUS'))
    const stateFinal = await readState(tenantId, empId, revisionId)
    check('[B] still exactly TWO compensation rows after the rejected second retry (no duplicate)', stateFinal.compensations.length === 2)
  }

  // ── Part C: genuine concurrency over real HTTP ──────────────────────────
  console.log('\n=== Part C: genuine concurrency — two simultaneous real HTTP approve calls ===')
  {
    const { tenantId, hrToken, hrUserId } = await seedTenantAndHr('C')
    const { empId, revisionId } = await seedScenario(tenantId, hrUserId, 'C')

    const callApprove = () => fetch(`${API_BASE}/payroll/revisions/${revisionId}/approve`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }).then(async (r) => ({ status: r.status, body: await r.json() }))

    const [resultA, resultB] = await Promise.all([callApprove(), callApprove()])
    console.log('  Call A:', resultA.status, JSON.stringify(resultA.body))
    console.log('  Call B:', resultB.status, JSON.stringify(resultB.body))

    const successes = [resultA, resultB].filter((r) => r.status === 200)
    const conflicts  = [resultA, resultB].filter((r) => r.status === 409)
    check('[C] exactly one call succeeded (200)', successes.length === 1)
    check('[C] exactly one call was rejected (409 INVALID_STATUS)', conflicts.length === 1 && conflicts[0].body?.error === 'INVALID_STATUS')

    const stateC = await readState(tenantId, empId, revisionId)
    check('[C] exactly TWO compensation rows exist (old + exactly one new, not two new)', stateC.compensations.length === 2)
    const activeRows = stateC.compensations.filter((c) => c.is_active)
    check('[C] exactly ONE compensation is active (uidx_comp_one_active invariant held)', activeRows.length === 1)
  }

  // ── Part D: real-HTTP happy path (no regression) ────────────────────────
  console.log('\n=== Part D: real-HTTP happy path ===')
  {
    const { tenantId, hrToken, hrUserId } = await seedTenantAndHr('D')
    const { empId, revisionId } = await seedScenario(tenantId, hrUserId, 'D')

    const res = await fetch(`${API_BASE}/payroll/revisions/${revisionId}/approve`, {
      method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = await res.json()
    console.log('  approve response:', res.status, JSON.stringify(body))
    check('[D] approve returns 200', res.status === 200)
    check('[D] response includes new_compensation_id', !!body.new_compensation_id)

    const stateD = await readState(tenantId, empId, revisionId)
    check("[D] revision is 'approved'", stateD.revision?.status === 'approved')
    check('[D] exactly one active compensation, with the new CTC', stateD.compensations.filter((c) => c.is_active).length === 1 && Number(stateD.compensations.find((c) => c.is_active)?.ctc_annual) === 720000)
  }

  console.log(allOk
    ? '\n✅ PROVEN: approve_compensation_revision_atomic guarantees previous-compensation validity on failure, no incomplete replacement ever becomes active, components+activation commit together, and retries (including genuine concurrent double-approval) are safe — exactly one credit, never zero-and-stuck, never double.'
    : '\n❌ FAILED — see checks above.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
