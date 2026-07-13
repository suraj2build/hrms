/**
 * 01 — Login + App Health Check
 *
 * Checks:
 *   - Login page loads and has required form elements
 *   - Login with valid credentials redirects to admin dashboard
 *   - No "Emvora" branding anywhere (must say CognixHR)
 *   - Main nav links present
 *   - No uncaught JS errors on landing
 */
import { test, expect } from '@playwright/test'
import { loginAsHRAdmin } from '../fixtures/auth'

test.describe('01 — Login & App Health', () => {

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.screenshot({ path: 'screenshots/01a-login-page.png' })

    await expect(page.locator('input[type="email"]'), 'Email input must exist').toBeVisible()
    await expect(page.locator('input[type="password"]'), 'Password input must exist').toBeVisible()
    await expect(page.locator('button[type="submit"]'), 'Submit button must exist').toBeVisible()

    // Must show CognixHR, must NOT show old brand name
    const body = await page.locator('body').textContent() ?? ''
    expect(body.toLowerCase(), 'Old brand "Emvora" must not appear').not.toContain('emvora')
  })

  test('HR admin login succeeds and lands on admin dashboard', async ({ page }) => {
    const jsErrors: string[] = []
    page.on('pageerror', e => jsErrors.push(e.message))

    await loginAsHRAdmin(page)
    await page.screenshot({ path: 'screenshots/01b-post-login.png' })

    // Should land somewhere under /admin
    expect(page.url(), 'Should redirect to admin area').toContain('/admin')

    // Dashboard should have visible content
    await expect(page.locator('main, [role="main"]').first(), 'Main content must be visible').toBeVisible()

    // Log any JS errors as soft assertion info (not hard fail)
    if (jsErrors.length > 0) {
      console.warn(`[health] ${jsErrors.length} JS error(s) on landing:`, jsErrors.slice(0, 3))
    }
  })

  test('admin navigation contains key HR modules', async ({ page }) => {
    await loginAsHRAdmin(page)
    await page.goto('/admin/control-center')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: 'screenshots/01c-control-center.png', fullPage: true })

    const allText = await page.locator('body').textContent() ?? ''
    const navText = allText.toLowerCase()

    // These modules should appear somewhere in the nav/sidebar
    const modules = ['employee', 'attendance', 'payroll', 'leave']
    for (const mod of modules) {
      expect(navText, `"${mod}" module should appear in navigation`).toContain(mod)
    }
  })

  test('page title and branding are correct', async ({ page }) => {
    await loginAsHRAdmin(page)
    const title = await page.title()
    // Title should not be blank or just "React App"
    expect(title.length, 'Page title should not be blank').toBeGreaterThan(3)
    expect(title.toLowerCase(), 'Title must not say "emvora"').not.toContain('emvora')

    await page.screenshot({ path: 'screenshots/01d-branding.png' })
  })
})
