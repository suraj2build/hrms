import { chromium } from 'playwright'
import pg from 'pg'

const WEB_BASE = 'http://localhost:2000'
const PASSWORD = 'ScopeVerify!1'
const OUT_DIR = '/tmp/bulk-mixed-screens'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'

const API_BASE = 'http://localhost:2001'
const AUTH_BASE = 'http://localhost:9000'
const MANAGER_EMAIL = process.env.MANAGER_EMAIL
const REG_B_ID = process.env.REG_B_ID
const TENANT_ID = process.env.TENANT_ID
const pool = new pg.Pool({ connectionString: DB_URL })

async function loginAndGetToken(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })
  return (await res.json()).access_token
}

async function makeHrAdminForLocking(tenantId) {
  // The manager account can't call /attendance/period-locks (hr_admin only) —
  // create a throwaway hr_admin profile in the SAME tenant to lock the month
  // for real through the actual API, exactly as HR would.
  const hrEmail = `bulk-mix2-hr-${Date.now()}@test.local`
  const res = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: hrEmail, password: PASSWORD }) })
  const hrUserId = (await res.json()).id
  const hrEmpId = crypto.randomUUID()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'MIXHR','Mix2','HR','bulk-mix2-hr@test.local', CURRENT_DATE, 'active')`, [hrEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'hr_admin','Mix2 HR',$4,true)`, [hrUserId, tenantId, hrEmpId, hrEmail])
  return hrEmail
}

async function main() {
  await import('node:fs/promises').then(fs => fs.mkdir(OUT_DIR, { recursive: true }))
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true })
  const page = await browser.newPage()

  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', MANAGER_EMAIL)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)
  console.log('after login, url=', page.url())

  await page.goto(`${WEB_BASE}/manager/team/regularisation`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  console.log('on page, url=', page.url())
  await page.screenshot({ path: `${OUT_DIR}/1-before-select.png`, fullPage: true })

  const bodyText1 = (await page.textContent('body').catch(() => '')) ?? ''
  console.log('page text snippet (first 1500):', bodyText1.replace(/\s+/g, ' ').slice(0, 1500))

  // Select-all checkbox (header) — selects all 3 pending rows.
  const headerCheckbox = page.locator('thead input[type="checkbox"]').first()
  const headerCount = await headerCheckbox.count()
  console.log('header checkbox count:', headerCount)
  if (headerCount > 0) {
    await headerCheckbox.click()
  } else {
    // Fallback: click every row checkbox individually.
    const rowCheckboxes = page.locator('tbody input[type="checkbox"]')
    const n = await rowCheckboxes.count()
    console.log('fallback: row checkboxes found:', n)
    for (let i = 0; i < n; i++) await rowCheckboxes.nth(i).click()
  }
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT_DIR}/2-after-select.png`, fullPage: true })

  // Find the Bulk Approve button.
  const approveBtn = page.getByRole('button', { name: /approve/i }).first()
  console.log('approve button found:', await approveBtn.count())

  // RACE: lock regB's month (2026-08) through the REAL period-locks API,
  // as HR genuinely would, right before clicking — the manager selected
  // all three while genuinely pending; by the time the click's network
  // request reaches the server, regB's period has just been closed.
  // regA/regC are dated 2026-09 (left open) so only regB is affected —
  // this is the transient-but-still-pending failure class (PERIOD_LOCKED),
  // distinct from "already actioned", so regB's row should still be
  // 'pending' and visible after this bulk-approve settles.
  const hrEmail = await makeHrAdminForLocking(TENANT_ID)
  const hrToken = await loginAndGetToken(hrEmail)
  const lockRes = await fetch(`${API_BASE}/attendance/period-locks/2026-08/lock`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'race test' }),
  })
  console.log('locked 2026-08 via real API:', lockRes.status, await lockRes.json())
  console.log('clicking Bulk Approve now')

  await approveBtn.click()
  await page.waitForTimeout(500)
  // Capture the toast immediately (it's transient).
  await page.screenshot({ path: `${OUT_DIR}/3-toast.png`, fullPage: true })
  const toastText = (await page.textContent('body').catch(() => '')) ?? ''
  console.log('toast-moment page text snippet:', toastText.replace(/\s+/g, ' ').match(/.{0,30}(approved|failed).{0,60}/gi))

  await page.waitForTimeout(3000) // let the toast fade and the refetch settle
  await page.screenshot({ path: `${OUT_DIR}/4-after-settle.png`, fullPage: true })
  const settledText = (await page.textContent('body').catch(() => '')) ?? ''
  console.log('settled page text snippet (first 2000):', settledText.replace(/\s+/g, ' ').slice(0, 2000))

  // Persisted DB check — what actually happened to all three.
  const { rows } = await pool.query(`SELECT id, status FROM attendance_regularisation WHERE tenant_id = (SELECT tenant_id FROM attendance_regularisation WHERE id=$1)`, [REG_B_ID])
  console.log('persisted statuses:', rows)

  await browser.close()
  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
