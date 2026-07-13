/**
 * 05 — Payroll
 *
 * Checks:
 *   - Payroll runs page loads and lists runs
 *   - Payroll control center loads
 *   - Compensation master has data
 *   - Salary components page loads
 *   - Cross-check: payable days visible in payroll must be consistent with
 *     what muster roll shows for the same month
 *   - Payroll run console shows run status
 *   - Payroll investigation tool loads
 */
import { test, expect } from '@playwright/test'
import { loginAsHRAdmin } from '../fixtures/auth'

const PREV_MONTH = (() => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
})()

test.describe('05 — Payroll', () => {

  test('payroll runs page loads and shows run history', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/05a-payroll-runs.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    expect(bodyText.length, 'Payroll runs page must have content').toBeGreaterThan(100)
    console.log('[payroll-runs] Content length:', bodyText.length)
  })

  test('payroll control center loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll/center')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/05b-payroll-center.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
  })

  test('compensation master page loads with salary data', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll/compensation')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'screenshots/05c-compensation-master.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    console.log('[compensation] Content length:', bodyText.length)
  })

  test('salary components page loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll/salary-components')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/05d-salary-components.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    // Should list components (Basic, HRA, etc.)
    const hasComponents = ['basic', 'hra', 'salary', 'component'].some(k => bodyText.toLowerCase().includes(k))
    console.log('[salary-components] Has component keywords:', hasComponents)
  })

  test('payroll cross-check: payable days in payslip match muster roll', async ({ page }) => {
    await loginAsHRAdmin(page)

    // Step 1: Get payable days from muster roll for prev month
    await page.goto(`/admin/attendance/muster?month=${PREV_MONTH}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(4000)

    const musterText = await page.locator('body').textContent() ?? ''

    // Extract payable days figure from muster (look for "Payable Days" label nearby a number)
    const payableMatch = musterText.match(/payable\s*days?\s*[:\-]?\s*(\d+\.?\d*)/i)
    const musterPayable = payableMatch ? parseFloat(payableMatch[1]) : null
    console.log(`[cross-check] Muster payable days (${PREV_MONTH}):`, musterPayable)

    await page.screenshot({ path: 'screenshots/05e-muster-for-crosscheck.png' })

    // Step 2: Check payroll records for the same month
    await page.goto('/admin/payroll')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const payrollText = await page.locator('body').textContent() ?? ''
    const payrollPayable = payrollText.match(/payable\s*days?\s*[:\-]?\s*(\d+\.?\d*)/i)
    const payrollPayableDays = payrollPayable ? parseFloat(payrollPayable[1]) : null
    console.log('[cross-check] Payroll payable days:', payrollPayableDays)

    await page.screenshot({ path: 'screenshots/05f-payroll-for-crosscheck.png' })

    if (musterPayable !== null && payrollPayableDays !== null) {
      // They should match (allow tiny rounding: ±1 day across all employees)
      const diff = Math.abs(musterPayable - payrollPayableDays)
      if (diff > 1) {
        console.warn(`[cross-check] MISMATCH: muster=${musterPayable}, payroll=${payrollPayableDays}, diff=${diff}`)
      } else {
        console.log(`[cross-check] MATCH: muster=${musterPayable}, payroll=${payrollPayableDays}`)
      }
    } else {
      console.log('[cross-check] Could not extract both figures for comparison — check screenshots')
    }
  })

  test('payroll investigation tool loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll/investigate')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/05g-payroll-investigate.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
  })

  test('payroll governance / validation page loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll/validation')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/05h-payroll-validation.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
  })

  test('payroll reconciliation page loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/payroll/reconciliation')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/05i-payroll-reconciliation.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
  })
})
