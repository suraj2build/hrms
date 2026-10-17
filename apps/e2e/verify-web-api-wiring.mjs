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
 * actual network RESPONSES (not just requests sent) during initial load.
 *
 * Scope, precisely: this proves the page issues at least one request that
 * the checked API origin itself answers directly (not via a redirect to
 * somewhere else), during unauthenticated initial load. It does NOT drive
 * an authenticated application flow, inspect response bodies for business
 * correctness, or exercise every route the app calls — that is what the
 * full Playwright E2E suite (using real HR credentials) does, in the very
 * next step of this workflow. This check's only job is to catch a wiring
 * mismatch cheaply, before paying for that full suite.
 *
 * Checking RESPONSES rather than just requests is deliberate, and was
 * changed after testing exposed a real gap: a request-only check still
 * reports success when the checked origin immediately 302-redirects
 * everything to a different host — confirmed with a fixture server that
 * does exactly that. The checked origin never actually answered; a
 * platform rewrite or compromised/misconfigured redirect would pass
 * silently under a request-only check. This checks the response: a
 * redirect response (3xx) FROM the checked origin, whose Location header
 * points somewhere else, is reported explicitly as a failure, distinct
 * from "no request was ever sent there".
 *
 * Lives in apps/e2e/ (not scripts/) so it resolves @playwright/test from
 * this workspace's own install (`npm ci` here, which e2e.yml already runs
 * before this check) rather than depending on a root-level install existing.
 *
 * Usage: WEB_URL=https://... API_URL=https://... node verify-web-api-wiring.mjs
 *        (run with working-directory: apps/e2e, after Playwright browsers
 *        are installed)
 * Exit 0: the checked API origin itself returned a non-redirect response
 *         (any status — even an error response proves that origin, not a
 *         proxy/redirect target, actually answered) to at least one
 *         request during page load.
 * Exit 1: no request reached that origin, or every response from it was a
 *         redirect elsewhere, or WEB_URL failed to load. Details on stderr.
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

const responsesFromApiOrigin = [] // { status, redirectLocation }
const seenOrigins = new Set()
const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH })
const page = await browser.newPage()

page.on('response', (res) => {
  let origin
  try {
    origin = new URL(res.url()).origin
  } catch {
    return // unparsable response URL (e.g. data:) -- not relevant here
  }
  seenOrigins.add(origin)
  if (origin === apiOrigin) {
    const status = res.status()
    const isRedirect = status >= 300 && status < 400
    responsesFromApiOrigin.push({
      status,
      redirectLocation: isRedirect ? res.headers()['location'] : null,
    })
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

const directAnswer = responsesFromApiOrigin.find((r) => r.redirectLocation == null)
if (directAnswer) {
  console.log(`✓ web page at ${WEB_URL} issued a request that the checked API origin (${apiOrigin}) answered directly (HTTP ${directAnswer.status}, not a redirect)`)
  process.exit(0)
}

const redirectsAway = responsesFromApiOrigin.filter((r) => r.redirectLocation != null)
if (redirectsAway.length > 0) {
  console.error(`✗ the checked API origin (${apiOrigin}) never answered directly — every response from it was a redirect elsewhere:`)
  for (const r of redirectsAway) console.error(`    HTTP ${r.status} -> ${r.redirectLocation}`)
  console.error('  A build-time VITE_API_URL record or a matching commitSha does not prove this on its own —')
  console.error('  the client is talking to this origin, but something there is rerouting it, not actually serving the API.')
  process.exit(1)
}

console.error(`✗ web page at ${WEB_URL} never received any response from the checked API origin (${apiOrigin}) within ${WAIT_MS}ms`)
console.error(`  Origins actually observed: ${[...seenOrigins].join(', ') || '(none — page may have failed to load)'}`)
if (loadError) console.error(`  Page load also reported an error: ${loadError}`)
console.error('  This means the deployed client is not actually calling the API that was SHA/metadata-verified —')
console.error('  a build-time VITE_API_URL record or a matching commitSha does not prove this on its own.')
process.exit(1)
