#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10, point 2 — live-browser proof that
 * the persistent FailedItem panel (ManagerTeamRegularisation.tsx) replaces
 * checkpoint 9's toast-only fix, AND that retrying a failed item does not
 * repeat already-succeeded items.
 *
 * Seeds its own tenant/manager/3 direct reports/3 pending regularisation
 * requests (self-contained — no dependency on a prior session's seed
 * script). Bulk-approves all 3 while B's period is LOCKED (written directly
 * to attendance_period_locks, not via the real lock endpoint — that
 * endpoint also fires a background auto-reject-pending-as-LOP job, a
 * different feature whose terminal 'rejected' outcome a retry can never
 * undo; this test targets the transient, retry-after-resolution race
 * instead), screenshots the PERSISTENT panel (not a toast — the toast has
 * already faded by the time we screenshot), reopens the period, clicks
 * "Retry" on B's row in the panel, and proves via Postgres read-back that:
 *   - A and C were approved on the first bulk action and NOT touched again
 *     (approved_at timestamp unchanged across the retry)
 *   - B was still 'pending' after the first bulk action, then 'approved'
 *     only after the explicit per-row retry
 *   - the panel cleared B's row after the retry succeeded
 */
import { chromium } from 'playwright'
import pg from 'pg'

const WEB_BASE = 'http://localhost:2000'
const API_BASE = 'http://localhost:2001'
const AUTH_BASE = 'http://localhost:9000'
const PASSWORD = 'Checkpoint10Verify!1'
const OUT_DIR = '/tmp/claude-0/-home-user-hrms/73455263-0ad6-56bc-95c6-95c75dd0d601/scratchpad/cp10-retry-panel'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }

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
  await import('node:fs/promises').then(fs => fs.mkdir(OUT_DIR, { recursive: true }))

  const stamp = Date.now()
  const tenantId  = uuid()
  const managerEmpId = uuid()
  const managerEmail = `cp10-mgr-${stamp}@test.local`

  console.log('=== SEED ===')
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Checkpoint10 Retry Verify','cp10-${stamp}','active')`, [tenantId])

  const managerUserId = await createAuthUser(managerEmail)
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'CP10MGR','Mgr','Ten','${managerEmail}', CURRENT_DATE, 'active')`,
    [managerEmpId, tenantId],
  )
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'manager','Mgr Ten',$4,true)`,
    [managerUserId, tenantId, managerEmpId, managerEmail],
  )

  // Three direct reports, A/B/C, each with one pending regularisation.
  // A and C are dated in an OPEN month; B is dated in the month we will
  // lock right before the bulk-approve click lands.
  const empA = uuid(), empB = uuid(), empC = uuid()
  const regA = uuid(), regB = uuid(), regC = uuid()
  const OPEN_MONTH   = '2101-02'
  const LOCKED_MONTH = '2101-03'

  for (const [empId, code, first, dateStr, regId] of [
    [empA, 'CP10A', 'Asha', `${OPEN_MONTH}-10`, regA],
    [empB, 'CP10B', 'Bala', `${LOCKED_MONTH}-10`, regB],
    [empC, 'CP10C', 'Chitra', `${OPEN_MONTH}-11`, regC],
  ]) {
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, manager_id)
       VALUES ($1,$2,$3,$4,'Report','${code.toLowerCase()}-${stamp}@test.local', CURRENT_DATE, 'active', $5)`,
      [empId, tenantId, code, first, managerEmpId],
    )
    await pool.query(
      `INSERT INTO attendance_regularisation (id, tenant_id, employee_id, date, reason, status, regularization_type)
       VALUES ($1,$2,$3,$4,'Missed punch — forgot to clock in','pending','missed_punch')`,
      [regId, tenantId, empId, dateStr],
    )
  }
  console.log('seeded tenant', tenantId, '| regA (open month)', regA, '| regB (to be locked)', regB, '| regC (open month)', regC)

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true })
  const page = await browser.newPage()

  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', managerEmail)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2500)
  console.log('logged in as manager, url=', page.url())

  await page.goto(`${WEB_BASE}/manager/team/regularisation`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT_DIR}/1-before-select.png`, fullPage: true })

  // Select all three (the "Select all" checkbox lives in the bulk-action
  // toolbar above the table in this file, not in a <thead>).
  const headerCheckbox = page.locator('label:has-text("Select all") input[type="checkbox"]').first()
  await headerCheckbox.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT_DIR}/2-after-select-all.png`, fullPage: true })

  const approveBtn = page.getByRole('button', { name: /approve 3/i }).first()
  console.log('approve button found:', await approveBtn.count())

  // Lock B's period directly in attendance_period_locks — NOT via the real
  // POST /attendance/period-locks/:month/lock endpoint, which also fires a
  // background auto-reject-pending-as-LOP job (a different, intentional
  // feature). That would flip B straight to a terminal 'rejected' state,
  // which a retry correctly can never undo — not the transient,
  // retry-after-resolution race this test targets. Writing the lock state
  // directly still exercises the real code path under test: approve-
  // RegularisationEngine's own `attendance_period_locks` read inside
  // approveRegularisation() (apps/api/src/lib/approval-service.ts).
  await pool.query(
    `INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'LOCKED')`,
    [tenantId, LOCKED_MONTH],
  )
  console.log(`locked ${LOCKED_MONTH} directly (simulating HR locking it mid-flight, without the auto-LOP side effect)`)

  console.log('clicking Approve 3 now (B should fail: period locked)')
  await approveBtn.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT_DIR}/3-toast-moment.png`, fullPage: true })

  // Let the toast fade — this is exactly where checkpoint 9's fix lost all
  // detail. The PANEL must still be visible after this.
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${OUT_DIR}/4-panel-after-toast-fades.png`, fullPage: true })
  const panelText = (await page.textContent('body').catch(() => '')) ?? ''
  const panelVisible = /need attention/i.test(panelText) && panelText.includes('Bala')
  console.log('persistent panel still showing the failed item by name after the toast window elapsed:', panelVisible ? 'PASS' : 'FAIL')

  const { rows: midRows } = await pool.query(
    `SELECT id, status, approved_at FROM attendance_regularisation WHERE id IN ($1,$2,$3) ORDER BY id`,
    [regA, regB, regC],
  )
  console.log('persisted status after first bulk action:', midRows)
  const aApprovedAt = midRows.find(r => r.id === regA)?.approved_at
  const cApprovedAt = midRows.find(r => r.id === regC)?.approved_at
  const firstRoundCorrect =
    midRows.find(r => r.id === regA)?.status === 'approved' &&
    midRows.find(r => r.id === regC)?.status === 'approved' &&
    midRows.find(r => r.id === regB)?.status === 'pending'
  console.log('A and C approved, B still pending after first bulk action:', firstRoundCorrect ? 'PASS' : 'FAIL')

  // Now resolve the transient cause and retry B via the panel's per-row button.
  await pool.query(
    `UPDATE attendance_period_locks SET state = 'OPEN' WHERE tenant_id = $1 AND period_month = $2`,
    [tenantId, LOCKED_MONTH],
  )
  console.log(`reopened ${LOCKED_MONTH} directly`)

  const retryBtn = page.getByRole('button', { name: /retry/i }).first()
  console.log('retry button found:', await retryBtn.count())
  await retryBtn.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT_DIR}/5-after-retry.png`, fullPage: true })

  const afterRetryText = (await page.textContent('body').catch(() => '')) ?? ''
  const panelClearedForB = !afterRetryText.includes('Bala') || !/need attention/i.test(afterRetryText)
  console.log('panel no longer shows Bala\'s failure after a successful retry:', panelClearedForB ? 'PASS' : 'FAIL')

  const { rows: finalRows } = await pool.query(
    `SELECT id, status, approved_at FROM attendance_regularisation WHERE id IN ($1,$2,$3) ORDER BY id`,
    [regA, regB, regC],
  )
  console.log('persisted status after retry:', finalRows)
  const bNowApproved = finalRows.find(r => r.id === regB)?.status === 'approved'
  const aUnchanged = finalRows.find(r => r.id === regA)?.approved_at?.getTime?.() === aApprovedAt?.getTime?.()
  const cUnchanged = finalRows.find(r => r.id === regC)?.approved_at?.getTime?.() === cApprovedAt?.getTime?.()
  console.log('B approved via retry, A/C approved_at unchanged (not re-touched/duplicated):',
    bNowApproved && aUnchanged && cUnchanged ? 'PASS' : 'FAIL')

  const allOk = panelVisible && firstRoundCorrect && panelClearedForB && bNowApproved && aUnchanged && cUnchanged
  console.log(allOk ? '\nALL CHECKS PASS' : '\nFAIL')

  await browser.close()
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
