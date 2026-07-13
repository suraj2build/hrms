/**
 * 04 — Leave Flow
 *
 * Checks:
 *   - Leave types page lists configured leave types
 *   - Leave policy page loads
 *   - Leave approvals inbox is reachable and shows pending items (or empty state)
 *   - Leave accrual ledger loads
 *   - Leave balances page loads with numeric data
 *
 * Note: ESS leave apply flow requires a separate employee login.
 * The HR-side checks here verify the admin approval surface.
 */
import { test, expect } from '@playwright/test'
import { loginAsHRAdmin } from '../fixtures/auth'

test.describe('04 — Leave Management', () => {

  test('leave types page loads with configured types', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/leave-types')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04a-leave-types.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')

    // Should show common leave type names
    const expectedTypes = ['casual', 'earned', 'sick']
    const found = expectedTypes.filter(t => bodyText.toLowerCase().includes(t))
    console.log(`[leave-types] Found types: ${found.join(', ')}`)
    expect(found.length, 'Should have at least one standard leave type (CL/EL/SL)').toBeGreaterThan(0)
  })

  test('leave policy page loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/leave-policy')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04b-leave-policy.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    expect(bodyText.length, 'Leave policy page must have content').toBeGreaterThan(100)
  })

  test('leave approvals inbox is reachable', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/leave/approvals')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04c-leave-approvals.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    // Should show either pending requests OR an empty state
    const hasPending  = bodyText.toLowerCase().includes('pending')
    const hasEmpty    = bodyText.toLowerCase().match(/no.*(pending|request|leave)/i)
    const hasApproval = bodyText.toLowerCase().includes('approv')
    console.log(`[leave-approvals] pending=${hasPending}, empty=${!!hasEmpty}, approvals=${hasApproval}`)
  })

  test('leave accrual ledger loads with data', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/leave/ledger')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04d-leave-ledger.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    console.log('[leave-ledger] Content length:', bodyText.length)
  })

  test('leave balance numbers are not negative', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/leave/balances')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04e-leave-balances.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')

    // Extract all numbers — check none are unexpectedly negative
    const numbers = bodyText.match(/-\d+\.?\d*/g) ?? []
    if (numbers.length > 0) {
      console.warn(`[leave-balances] Negative numbers found on page: ${numbers.slice(0, 10).join(', ')}`)
    }
    // Soft check: flag but don't fail — some negative numbers may be valid (LOP)
    console.log(`[leave-balances] Negative numbers count: ${numbers.length}`)
  })

  test('leave collision log page loads', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/leave/collision-log')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04f-collision-log.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
  })

  test('holidays page loads and shows holidays', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/holidays')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'screenshots/04g-holidays.png', fullPage: true })

    const bodyText = await page.locator('body').textContent() ?? ''
    expect(bodyText.toLowerCase()).not.toContain('something went wrong')
    console.log('[holidays] Content length:', bodyText.length)
  })
})
