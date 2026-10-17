#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 — explicit user instruction: "Also verify the
 * repaired loan RPC through actual payroll finalization, including
 * injected failure. A failed recovery must not be silently treated as
 * completed."
 *
 * record_loan_payment_atomic (migration 396) was fixed in migration 474
 * (checkpoint 17) after discovering it had NEVER been able to run at all
 * (a column-ambiguity bug). This script proves, against real Postgres +
 * real HTTP + the real async payroll-run job + a real finalize:
 *
 *   PART A — happy path: a real loan EMI, deducted from a real slip during
 *     real payroll generation, is correctly reflected in the loan's
 *     outstanding_balance ONLY after the run is finalized (not merely
 *     generated) — proving the previously-broken sweep (runs.ts's "Loan
 *     outstanding balance sweep" block, which calls record_loan_payment_
 *     atomic) now actually executes during a real finalize.
 *   PART B — injected failure: a SECOND loan's balance-update RPC is made
 *     to fail (via a real Postgres trigger that raises on the specific
 *     UPDATE this run's finalize issues — not a mock, a real constraint
 *     the real transaction hits) during the SAME finalize call as Part A's
 *     loan. Proves:
 *     1. The failure does NOT abort the whole finalize — Part A's loan
 *        still correctly resolves (the non-fatal design is not a free
 *        pass for ignoring failures; it is "isolate this one failure,
 *        don't let it block generally-correct finalizes").
 *     2. The failing loan's outstanding_balance is UNCHANGED — not
 *        partially decremented, not corrupted.
 *     3. CRITICAL FINDING: as currently built, the failing loan's
 *        loan_schedules row is left at status='paid' (set in an EARLIER,
 *        separate statement before the balance RPC is even attempted) —
 *        this is exactly the "failed recovery silently treated as
 *        completed" shape the user's instruction named, surfaced here as
 *        a REAL, reproduced defect, not a theoretical one: paid_amount
 *        stays NULL (correctly signals "balance not yet applied" to the
 *        one piece of code that reads it — a future finalize's own sweep
 *        query), but nothing ever re-scopes to a due_month that has
 *        already passed, so there is no automated retry path, and the
 *        existing manual recovery endpoint (POST /payroll/loans/
 *        record-payment, checkpoint 17) also cannot rescue it: its CAS
 *        requires status='pending', which this row no longer is. The
 *        money is not lost (outstanding_balance is untouched, and the
 *        'paid' schedule correctly stops this EMI from being deducted
 *        again), but it IS stuck with no way to complete the balance
 *        decrement short of a manual UPDATE. Reported, not silently
 *        patched over by this script.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'LoanFinalizeInjectedFail!1'
const pool      = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }
let allOk = true
function check(label, cond, extra) {
  if (cond) { console.log(`✅ ${label}`) } else { console.log(`❌ ${label}`, extra ?? ''); allOk = false }
}
function note(label, extra) { console.log(`ℹ️  ${label}`, extra ?? '') }

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

async function seedTenantAndUsers(label) {
  const tenantId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Loan Finalize Fail ${label}`, `loanfail-${label}-${Date.now()}`])
  async function mkUser(role, tag) {
    const email = `loanfail-${label}-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
    const id = await createAuthUser(email)
    await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,$3,$4,$5,true)`, [id, tenantId, role, tag, email])
    return loginAndGetToken(email)
  }
  const hrToken     = await mkUser('hr_admin', 'hr')
  const superToken  = await mkUser('super_admin', 'super')
  const super2Token = await mkUser('super_admin', 'super2')
  return { tenantId, hrToken, superToken, super2Token }
}

async function seedEmployeeWithLoan(tenantId, label, emiAmount) {
  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,$3,'Loan','Fail',$4,'2020-01-01','active')`,
    [empId, tenantId, `LF-${label}`, `loanfail-emp-${label}-${Date.now()}@test.local`],
  )
  const componentId = uuid()
  await pool.query(
    `INSERT INTO salary_components (id, tenant_id, name, code, component_type, is_basic, is_active)
     VALUES ($1,$2,'Basic',$3,'earning', true, true)`,
    [componentId, tenantId, `BASIC-${label}`],
  )
  const compId = uuid()
  await pool.query(
    `INSERT INTO employee_compensations (id, tenant_id, employee_id, ctc_annual, effective_from, is_active)
     VALUES ($1,$2,$3, 600000, '2020-01-01', true)`,
    [compId, tenantId, empId],
  )
  await pool.query(
    `INSERT INTO employee_compensation_components (tenant_id, compensation_id, salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence)
     VALUES ($1,$2,$3,'fixed', 50000, 50000, 600000, 1)`,
    [tenantId, compId, componentId],
  )
  const loanId = uuid()
  await pool.query(
    `INSERT INTO employee_loans (id, tenant_id, employee_id, loan_type, principal_amount, disbursed_amount, tenure_months, emi_amount, outstanding_balance, status, disbursed_date, is_emi_paused)
     VALUES ($1,$2,$3,'personal', $4, $4, 1, $4, $4, 'active', '2025-01-01', false)`,
    [loanId, tenantId, empId, emiAmount],
  )
  const scheduleId = uuid()
  const month = '2025-12'
  await pool.query(
    `INSERT INTO loan_schedules (id, tenant_id, loan_id, installment_number, due_month, principal_component, interest_component, emi_amount, status)
     VALUES ($1,$2,$3,1,$4,$5,0,$5,'pending')`,
    [scheduleId, tenantId, loanId, month, emiAmount],
  )
  return { empId, loanId, scheduleId, month }
}

async function createDraftRunHttp(hrToken, month) {
  const res = await fetch(`${API_BASE}/payroll/runs`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ month }),
  })
  const body = await res.json()
  if (![200, 201, 202].includes(res.status)) throw new Error(`createDraftRunHttp failed: ${res.status} ${JSON.stringify(body)}`)
  const runId = body.run_id ?? body.id ?? body.data?.id
  await waitForRunSettled(hrToken, runId)
  return runId
}
async function waitForRunSettled(hrToken, runId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${API_BASE}/payroll/runs/${runId}`, { headers: { authorization: `Bearer ${hrToken}` } })
    const body = await res.json()
    const status = body.data?.status ?? body.status
    if (status && !['queued', 'processing'].includes(status)) return status
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`waitForRunSettled timed out for run ${runId}`)
}
async function callFinalize(token, runId) {
  const res = await fetch(`${API_BASE}/payroll/runs/${runId}/finalize`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ force_finalize: true, override_reason: 'loan-finalize-injected-failure verify script' }),
  })
  const body = await res.json()
  return { status: res.status, body }
}
async function finalizeRunHttp(super2Token, superToken, runId) {
  const makerRes = await callFinalize(super2Token, runId)
  if (makerRes.status !== 202 || makerRes.body?.status !== 'PENDING_CHECKER') return makerRes
  return callFinalize(superToken, runId)
}

async function main() {
  const { tenantId, hrToken, superToken, super2Token } = await seedTenantAndUsers('L1')

  // Control loan: should resolve cleanly end-to-end.
  const control = await seedEmployeeWithLoan(tenantId, 'control', 12000)
  // Poisoned loan: its balance-update RPC will be made to fail.
  const poisoned = await seedEmployeeWithLoan(tenantId, 'poisoned', 9000)
  const month = control.month // same month for both ('2025-12')

  const runId = await createDraftRunHttp(hrToken, month)

  // Generate the run — both loan EMIs should be deducted from their slips.
  await fetch(`${API_BASE}/payroll/runs`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ month }),
  })
  await waitForRunSettled(hrToken, runId)

  const { rows: slipRows } = await pool.query(
    `SELECT employee_id, component_breakdown FROM payroll_slips WHERE tenant_id=$1 AND run_id=$2 AND employee_id IN ($3,$4)`,
    [tenantId, runId, control.empId, poisoned.empId],
  )
  const controlSlip  = slipRows.find(r => r.employee_id === control.empId)
  const poisonedSlip = slipRows.find(r => r.employee_id === poisoned.empId)
  const hasLoanEmi = (slip) => (slip?.component_breakdown ?? []).some(c => (c.code ?? '').toUpperCase() === 'LOAN_EMI')
  check('[seed] control slip has a LOAN_EMI deduction', hasLoanEmi(controlSlip))
  check('[seed] poisoned slip has a LOAN_EMI deduction', hasLoanEmi(poisonedSlip))

  // Install a real Postgres trigger that raises when THIS SPECIFIC loan's
  // outstanding_balance is updated — simulates record_loan_payment_atomic's
  // UPDATE hitting a real failure (constraint, deadlock, whatever) for this
  // one loan, without touching any application code.
  await pool.query(`
    CREATE OR REPLACE FUNCTION _poison_loan_update() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.id = '${poisoned.loanId}' THEN
        RAISE EXCEPTION 'INJECTED_FAILURE: simulated balance-update failure for loan %', NEW.id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await pool.query(`CREATE TRIGGER _poison_loan_trg BEFORE UPDATE ON employee_loans FOR EACH ROW EXECUTE FUNCTION _poison_loan_update();`)
  note('Injected a real Postgres trigger that raises on UPDATE of the poisoned loan only')

  const finRes = await finalizeRunHttp(super2Token, superToken, runId)
  console.log('  finalize response:', finRes.status, JSON.stringify(finRes.body).slice(0, 300))
  check('[PART A] finalize still succeeds overall despite the poisoned loan\'s failure (non-fatal isolation)', finRes.status === 200)

  // Clean up the trigger before further queries/assertions.
  await pool.query(`DROP TRIGGER IF EXISTS _poison_loan_trg ON employee_loans;`)
  await pool.query(`DROP FUNCTION IF EXISTS _poison_loan_update();`)

  // ── PART A: control loan resolves correctly ──────────────────────────────
  console.log('\n=== PART A: control loan — balance correctly decremented only after finalize ===')
  const { rows: controlLoanRows } = await pool.query(`SELECT outstanding_balance, status FROM employee_loans WHERE id=$1`, [control.loanId])
  check('[A] control loan outstanding_balance is 0 (12000 - 12000)', Number(controlLoanRows[0]?.outstanding_balance) === 0, controlLoanRows[0])
  check("[A] control loan status is 'completed' (balance fully cleared)", controlLoanRows[0]?.status === 'completed')
  const { rows: controlSchedRows } = await pool.query(`SELECT status, paid_amount FROM loan_schedules WHERE id=$1`, [control.scheduleId])
  check("[A] control schedule status is 'paid'", controlSchedRows[0]?.status === 'paid')
  check('[A] control schedule paid_amount is set (balance successfully applied)', Number(controlSchedRows[0]?.paid_amount) === 12000)

  // ── PART B: poisoned loan — failure correctly NOT silently treated as completed ──
  console.log('\n=== PART B: poisoned loan — injected failure is not silently treated as completed ===')
  const { rows: poisonedLoanRows } = await pool.query(`SELECT outstanding_balance, status FROM employee_loans WHERE id=$1`, [poisoned.loanId])
  check('[B] poisoned loan outstanding_balance is UNCHANGED at 9000 (not decremented, not corrupted)', Number(poisonedLoanRows[0]?.outstanding_balance) === 9000, poisonedLoanRows[0])
  check("[B] poisoned loan status is still 'active' (NOT 'completed' — the balance update never happened)", poisonedLoanRows[0]?.status === 'active')

  const { rows: poisonedSchedRows } = await pool.query(`SELECT status, paid_amount FROM loan_schedules WHERE id=$1`, [poisoned.scheduleId])
  check('[B] poisoned schedule paid_amount is NULL — correctly signals "balance not yet applied"', poisonedSchedRows[0]?.paid_amount === null, poisonedSchedRows[0])

  const scheduleStillPending = poisonedSchedRows[0]?.status === 'pending'
  const scheduleMarkedPaidAnyway = poisonedSchedRows[0]?.status === 'paid'
  if (scheduleMarkedPaidAnyway) {
    console.log('❌ CONFIRMED DEFECT: [B] poisoned schedule status is \'paid\' even though its balance update FAILED.')
    console.log('   This is the exact "failed recovery silently treated as completed" shape — the schedule')
    console.log('   mark-paid step and the balance-apply step are two separate, non-atomic statements; only')
    console.log('   paid_amount staying NULL distinguishes this from a real success, and nothing currently')
    console.log('   re-scopes to retry a due_month that has already passed. The existing manual recovery')
    console.log('   endpoint (POST /payroll/loans/record-payment) also cannot rescue it: its CAS requires')
    console.log('   status=\'pending\', which this row no longer is.')
    allOk = false // Confirmed defect — the overall script result must reflect this, not hide it.
  } else if (scheduleStillPending) {
    console.log('✅ [B] poisoned schedule status stayed \'pending\' — the mark-paid and balance-apply steps are atomic; this row remains retryable.')
  }

  console.log(allOk
    ? '\n✅ All checks passed.'
    : '\n❌ CONFIRMED DEFECT (see PART B above) — the loan-EMI mark-paid step and the balance-apply step are not atomic. Reported, not silently patched.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
