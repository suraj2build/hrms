#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 6 — live browser evidence that the
 * approvals inbox agrees with the fixed scope, for a real login as each of
 * MGR_TOP (manager-of-managers), MGR_MID (immediate manager), and HR_ADMIN.
 */
import { chromium } from 'playwright'

const WEB_BASE = 'http://localhost:2000'
const PASSWORD = 'ScopeVerify!1'
const OUT_DIR = '/tmp/scope-verify-screens'

const accounts = JSON.parse(process.env.ACCOUNTS_JSON)

async function loginAndScreenshot(browser, label, email, filename) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', email)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)
  console.log(`[${label}] after login, url=${page.url()}`)

  const approvalsPath = label === 'HR_ADMIN' ? '/admin/approvals/inbox' : '/manager/approvals'
  await page.goto(`${WEB_BASE}${approvalsPath}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT_DIR}/${filename}`, fullPage: true })
  console.log(`[${label}] screenshot saved: ${filename}, url=${page.url()}`)

  // Capture the pending-count badge text if visible anywhere on the page
  const bodyText = await page.textContent('body').catch(() => '')
  console.log(`[${label}] page title: ${await page.title()}`)

  return { context, page }
}

async function main() {
  await import('node:fs/promises').then(fs => fs.mkdir(OUT_DIR, { recursive: true }))

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true })

  const { page: mgrTopPage } = await loginAndScreenshot(browser, 'MGR_TOP', accounts.mgrTopEmail, '1-mgr-top-inbox.png')
  const { page: mgrMidPage } = await loginAndScreenshot(browser, 'MGR_MID', accounts.mgrMidEmail, '2-mgr-mid-inbox.png')
  const { page: hrPage }     = await loginAndScreenshot(browser, 'HR_ADMIN', accounts.hrEmail, '3-hr-admin-inbox.png')

  // Try to read the pending/leave/reg counts shown on each page via common
  // badge/tab text patterns, logged as plain text for the report.
  for (const [label, page] of [['MGR_TOP', mgrTopPage], ['MGR_MID', mgrMidPage], ['HR_ADMIN', hrPage]]) {
    const text = await page.textContent('body').catch(() => '')
    const snippet = text?.replace(/\s+/g, ' ').slice(0, 2000)
    console.log(`\n=== ${label} page text (first 2000 chars) ===`)
    console.log(snippet)
  }

  await browser.close()
}

main().catch((err) => { console.error(err); process.exit(1) })
