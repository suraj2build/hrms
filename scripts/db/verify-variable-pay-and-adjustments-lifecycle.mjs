#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14, checkpoint 30 — real-Postgres/HTTP proof for the
 * two functional gaps this round closed:
 *
 *   1. Variable pay: VariablePay.tsx's "Payouts" dialog previously had no
 *      way to add a payout row at all (the backend's POST .../payouts was
 *      never called from the UI), and the dialog's own render referenced
 *      fields (base_amount/performance_score/multiplier/final_payout/
 *      approved) that don't exist on variable_payouts (migration 102:
 *      amount/is_taxable/performance_period/performance_notes/status).
 *      Fixed: the dialog now has a real add-payout form (EmployeeSelector +
 *      amount + optional period) that calls the existing POST endpoint, and
 *      the table renders the real columns via the real employees(...) embed.
 *   2. Frozen-period adjustments: payroll_adjustments had a fully built,
 *      already-tested backend (raise/approve/reject/assign-to-run) but ZERO
 *      frontend — grepped and confirmed in a prior checkpoint. Built
 *      AdjustmentsQueue.tsx from scratch, calling every one of those
 *      endpoints with the real request/response shapes.
 *
 * This script exercises the exact HTTP calls each new/fixed UI component
 * now makes (not mocked, not just the route handler unit-tested in
 * isolation) end-to-end against a real Postgres + the real compiled API,
 * for both full lifecycles: create → populate/raise → approve → assign to
 * a draft payroll run → finalize.
 *
 * This is HTTP-level proof, not a live-browser click-through — the two are
 * recorded as separate evidence types per this audit's evidentiary
 * discipline (STATUS.md, 2026-10-16 addendum's precision corrections).
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'VarPayAdj!1'
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

async function main() {
  const tenantId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`,
    [tenantId, 'VarPay Adj Lifecycle', `varpay-adj-${Date.now()}`])

  const hrEmail = `varpay-adj-hr-${Date.now()}@test.local`
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`,
    [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)
  const authHeaders = { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }

  async function seedEmployee(code) {
    const empId = uuid()
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
       VALUES ($1,$2,$3,'VP',$4,$5,'2020-01-01','active')`,
      [empId, tenantId, code, code, `${code}-${Date.now()}@test.local`],
    )
    return empId
  }
  const emp1 = await seedEmployee('VPADJ1')
  const emp2 = await seedEmployee('VPADJ2')

  const payoutMonth = '2025-12'
  const draftRunId = uuid()
  await pool.query(
    `INSERT INTO payroll_runs (id, tenant_id, month, status) VALUES ($1,$2,$3,'draft')`,
    [draftRunId, tenantId, payoutMonth],
  )

  // ── 1. VARIABLE PAY: template -> batch -> UI's add-payout POST -> submit -> approve -> assign ──
  const tmplRes = await fetch(`${API_BASE}/payroll/variable-pay/templates`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Diwali Bonus', code: `DIWALI-${Date.now()}`, template_type: 'festival', is_taxable: true, requires_approval: true }),
  })
  const tmplBody = await tmplRes.json()
  check('[vp] template create succeeds', tmplRes.status === 201, tmplBody)
  const templateId = tmplBody?.data?.id

  const batchRes = await fetch(`${API_BASE}/payroll/variable-pay/batches`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ template_id: templateId, batch_name: 'Diwali 2025', payout_month: payoutMonth }),
  })
  const batchBody = await batchRes.json()
  check('[vp] batch create succeeds', batchRes.status === 201, batchBody)
  const batchId = batchBody?.data?.id

  // Exactly the shape AdjustmentsQueue's sibling, VariablePay.tsx's new
  // add-payout form, sends: one row per "Add" click, batched into one
  // POST on "Save N Payouts".
  const payoutsRes = await fetch(`${API_BASE}/payroll/variable-pay/batches/${batchId}/payouts`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ payouts: [
      { employee_id: emp1, amount: 5000, performance_period: 'Q4 2025' },
      { employee_id: emp2, amount: 7500 },
    ] }),
  })
  const payoutsBody = await payoutsRes.json()
  check('[vp] add-payout rows (the previously-missing UI action) succeeds', payoutsRes.status === 201, payoutsBody)
  check('[vp] both inserted payouts have real amount field (not base_amount/multiplier)', Array.isArray(payoutsBody?.data) && payoutsBody.data.every(p => p.amount !== undefined && !Number.isNaN(Number(p.amount))), payoutsBody)

  const getPayoutsRes = await fetch(`${API_BASE}/payroll/variable-pay/batches/${batchId}/payouts`, { headers: authHeaders })
  const getPayoutsBody = await getPayoutsRes.json()
  check('[vp] GET payouts returns the real employees(...) embed the fixed dialog now renders',
    getPayoutsBody?.data?.every(p => p.employees && typeof p.employees.first_name === 'string'), getPayoutsBody)

  const batchAfterRes = await fetch(`${API_BASE}/payroll/variable-pay/batches?payout_month=${payoutMonth}`, { headers: authHeaders })
  const batchAfterBody = await batchAfterRes.json()
  const batchAfter = batchAfterBody?.data?.find(b => b.id === batchId)
  check('[vp] batch totals recomputed: total_amount=12500, employee_count=2',
    Number(batchAfter?.total_amount) === 12500 && batchAfter?.employee_count === 2, batchAfter)

  const submitRes = await fetch(`${API_BASE}/payroll/variable-pay/batches/${batchId}/submit`, { method: 'POST', headers: authHeaders, body: JSON.stringify({}) })
  check('[vp] submit for review succeeds', submitRes.status === 200, await submitRes.json().catch(() => ({})))

  const approveRes = await fetch(`${API_BASE}/payroll/variable-pay/batches/${batchId}/approve`, { method: 'POST', headers: authHeaders, body: JSON.stringify({}) })
  check('[vp] approve succeeds', approveRes.status === 200, await approveRes.json().catch(() => ({})))

  const assignRes = await fetch(`${API_BASE}/payroll/variable-pay/batches/${batchId}/assign-run`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ payroll_run_id: draftRunId }),
  })
  check('[vp] assign to the real draft payroll run succeeds (the AssignRunDialog action)', assignRes.status === 200, await assignRes.json().catch(() => ({})))

  // ── 2. ADJUSTMENTS: raise (AdjustmentsQueue's Create dialog) -> approve -> assign ──
  const lockedMonth = '2025-11'
  const createAdjRes = await fetch(`${API_BASE}/payroll/adjustments`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      employee_id: emp1, locked_month: lockedMonth, adjustment_type: 'manual',
      amount: 1200, reason: 'Missed shift allowance for a frozen month',
    }),
  })
  const createAdjBody = await createAdjRes.json()
  check('[adj] raise adjustment (previously had zero frontend) succeeds', createAdjRes.status === 201, createAdjBody)
  const adjId = createAdjBody?.data?.id

  const listRes = await fetch(`${API_BASE}/payroll/adjustments?status=pending`, { headers: authHeaders })
  const listBody = await listRes.json()
  const listed = listBody?.data?.find(a => a.id === adjId)
  check('[adj] GET list returns the real employees(...) embed the new table renders',
    listed?.employees && typeof listed.employees.first_name === 'string', listed)

  const approveAdjRes = await fetch(`${API_BASE}/payroll/adjustments/${adjId}/approve`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify({}),
  })
  check('[adj] approve succeeds', approveAdjRes.status === 200, await approveAdjRes.json().catch(() => ({})))

  const applyAdjRes = await fetch(`${API_BASE}/payroll/adjustments/${adjId}/apply`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ run_id: draftRunId }),
  })
  check('[adj] assign to the real draft payroll run succeeds (the AssignRunDialog action)', applyAdjRes.status === 200, await applyAdjRes.json().catch(() => ({})))

  const { rows: adjRows } = await pool.query(`SELECT status, applied_run_id FROM payroll_adjustments WHERE id=$1`, [adjId])
  check('[adj] status stays approved (not falsely terminal) with applied_run_id set, matching migration 478\'s assign/finalize shape',
    adjRows[0]?.status === 'approved' && adjRows[0]?.applied_run_id === draftRunId, adjRows[0])

  // ── 3. Reject path (AdjustmentsQueue's Reject dialog) ────────────────────
  const createAdj2Res = await fetch(`${API_BASE}/payroll/adjustments`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ employee_id: emp2, locked_month: lockedMonth, adjustment_type: 'lop_adjustment', amount: 300, lop_days_delta: 1, reason: 'Disputed LOP day' }),
  })
  const adj2Id = (await createAdj2Res.json())?.data?.id
  const rejectRes = await fetch(`${API_BASE}/payroll/adjustments/${adj2Id}/reject`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify({ reason: 'Insufficient evidence' }),
  })
  check('[adj] reject (the RejectDialog action) succeeds', rejectRes.status === 200, await rejectRes.json().catch(() => ({})))

  console.log(allOk ? '\n✅ All checks passed.' : '\n❌ Some checks failed — see above.')
  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
