#!/usr/bin/env node
/**
 * Dynamic web→API wiring check — the gap a review correctly flagged in the
 * static version: a web build's version.json records what VITE_API_URL was
 * at BUILD time, but that is metadata the build script wrote, not a fact
 * about what the running client actually does. It would miss a platform
 * rewrite/redirect (e.g. a vercel.json rewrite), a runtime config override
 * fetched after load, or a build that silently used a stale cached bundle
 * with a different embedded value.
 *
 * This loads the real deployed page in a real browser and watches the
 * network requests it actually issues, so the result reflects runtime
 * behavior, not a side-channel file.
 *
 * Lives in apps/e2e/ (not scripts/) so it resolves @playwright/test from
 * this workspace's own install (`npm ci` here, which e2e.yml already runs
 * before this check) rather than depending on a root-level install existing.
 *
 * Usage: WEB_URL=https://... API_URL=https://... node verify-web-api-wiring.mjs
 *        (run with working-directory: apps/e2e, after Playwright browsers
 *        are installed)
 * Exit 0: at least one request during page load/initial interaction targeted
 *         API_URL's origin.
 * Exit 1: no such request was observed within the wait window, or WEB_URL
 *         failed to load. Either way, details are printed to stderr.
 */
import { chromium } from '@playwright/test'

const WEB_URL = process.env.WEB_URL
const API_URL = process.env.API_URL
const WAIT_MS = Number(process.env.WIRING_CHECK_WAIT_MS || 8000)
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

if (!WEB_URL || !API_URL) {
  console.error('✗ WEB_URL and API_URL must both be set.')
  process.exit(1)
}

let apiOrigin
try {
  apiOrigin = new URL(API_URL).origin
} catch {
  console.error(`✗ API_URL is not a valid absolute URL: ${API_URL}`)
  process.exit(1)
}

const seenOrigins = new Set()
const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH })
const page = await browser.newPage()

page.on('request', (req) => {
  try {
    seenOrigins.add(new URL(req.url()).origin)
  } catch {
    // ignore unparsable request URLs (e.g. data:)
  }
})

let loadError = null
try {
  await page.goto(WEB_URL, { waitUntil: 'load', timeout: WAIT_MS })
  await page.waitForTimeout(Math.min(WAIT_MS, 5000))
} catch (e) {
  loadError = e.message
}

await browser.close()

if (seenOrigins.has(apiOrigin)) {
  console.log(`✓ web page at ${WEB_URL} issued a real request to the checked API origin (${apiOrigin})`)
  process.exit(0)
}

console.error(`✗ web page at ${WEB_URL} never issued a request to the checked API origin (${apiOrigin}) within ${WAIT_MS}ms`)
console.error(`  Origins actually observed: ${[...seenOrigins].join(', ') || '(none — page may have failed to load)'}`)
if (loadError) console.error(`  Page load also reported an error: ${loadError}`)
console.error('  This means the deployed client is not actually calling the API that was SHA/metadata-verified —')
console.error('  a build-time VITE_API_URL record or a matching commitSha does not prove this on its own.')
process.exit(1)
