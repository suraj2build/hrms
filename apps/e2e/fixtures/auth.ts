import { type Page, expect } from '@playwright/test'

const EMAIL = process.env.E2E_HR_EMAIL
const PASS  = process.env.E2E_HR_PASS

if (!EMAIL || !PASS) {
  throw new Error('E2E_HR_EMAIL and E2E_HR_PASS must be set. See apps/e2e/README.md.')
}

export async function loginAsHRAdmin(page: Page) {
  await page.goto('/login')
  await page.waitForLoadState('domcontentloaded')

  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASS)
  await page.locator('button[type="submit"]').click()

  // Wait for redirect away from /login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

export async function ensureOnAdmin(page: Page) {
  if (!page.url().includes('/admin')) {
    await page.goto('/admin/control-center')
    await page.waitForLoadState('networkidle')
  }
}
