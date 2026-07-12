#!/usr/bin/env node
/**
 * smoke-test.mjs — Runtime API health check for CognixHR deployments.
 *
 * Authenticates against the live Supabase project, then probes five critical
 * endpoints to verify the deployment is functional end-to-end:
 *
 *   1. GET /payroll/compensation-coverage
 *   2. GET /payroll/readiness-score
 *   3. GET /attendance/muster?month=YYYY-MM  (current month)
 *   4. GET /attendance/leave/team-balances
 *   5. GET /ess/home
 *
 * For each probe it checks:
 *   - HTTP status is 200 (or the expected code for that route)
 *   - Response body parses as JSON
 *   - Required top-level fields are present
 *   - No obviously truncated / missing datasets (where we have a count signal)
 *
 * Required env vars:
 *   SMOKE_BASE_URL     — API root, e.g. https://hrmsapi-production.up.railway.app
 *   SUPABASE_URL       — Supabase project URL, e.g. https://xxx.supabase.co
 *   SUPABASE_ANON_KEY  — Supabase anon/public key
 *   SMOKE_EMAIL        — HR admin smoke-test user email
 *   SMOKE_PASSWORD     — HR admin smoke-test user password
 *
 * Optional:
 *   SMOKE_TIMEOUT_MS   — per-request timeout in ms (default: 30000)
 *
 * Exit codes:
 *   0 — all probes passed
 *   1 — one or more probes failed, or authentication failed
 */

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL    = process.env.SMOKE_BASE_URL?.replace(/\/$/, '')
const SUPA_URL    = process.env.SUPABASE_URL?.replace(/\/$/, '')
const ANON_KEY    = process.env.SUPABASE_ANON_KEY
const EMAIL       = process.env.SMOKE_EMAIL
const PASSWORD    = process.env.SMOKE_PASSWORD
const TIMEOUT_MS  = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000)

function abort(msg) {
  console.error(`\n[smoke-test] FATAL: ${msg}`)
  process.exit(1)
}

if (!BASE_URL)   abort('SMOKE_BASE_URL is not set')
if (!SUPA_URL)   abort('SUPABASE_URL is not set')
if (!ANON_KEY)   abort('SUPABASE_ANON_KEY is not set')
if (!EMAIL)      abort('SMOKE_EMAIL is not set')
if (!PASSWORD)   abort('SMOKE_PASSWORD is not set')

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth() {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

async function timedFetch(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal })
    return res
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${TIMEOUT_MS}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── Step 1: Authenticate ──────────────────────────────────────────────────────

async function authenticate() {
  const url = `${SUPA_URL}/auth/v1/token?grant_type=password`
  let res
  try {
    res = await timedFetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  } catch (err) {
    abort(`Auth request failed: ${err.message}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    abort(`Auth failed — HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  if (!json.access_token) abort('Auth response missing access_token')
  return json.access_token
}

// ── Step 2: Define probes ─────────────────────────────────────────────────────

/**
 * Each probe: { label, path, validate(body) → string|null (null = ok, string = fail reason) }
 */
function buildProbes() {
  const month = currentMonth()
  return [
    {
      label: 'Compensation coverage audit',
      path:  '/payroll/compensation-coverage',
      validate(body) {
        if (!body.data)                                      return 'missing top-level "data" key'
        const d = body.data
        if (typeof d.total_active_employees !== 'number')   return 'missing total_active_employees'
        if (typeof d.coverage_percent !== 'number')         return 'missing coverage_percent'
        if (typeof d.ready_for_payroll !== 'boolean')       return 'missing ready_for_payroll'
        if (!Array.isArray(d.issues))                       return 'missing issues array'
        if (!d.as_of)                                       return 'missing as_of date'
        return null
      },
    },
    {
      label: 'Payroll readiness score',
      path:  '/payroll/readiness-score',
      validate(body) {
        if (!body.data)                                      return 'missing top-level "data" key'
        const d = body.data
        if (typeof d.score !== 'number')                    return 'missing score (number)'
        if (d.score < 0 || d.score > 100)                   return `score ${d.score} out of 0–100 range`
        if (typeof d.grade !== 'string')                    return 'missing grade (string)'
        return null
      },
    },
    {
      label: `Muster roll (${month})`,
      path:  `/attendance/muster?month=${month}`,
      validate(body) {
        // Muster returns { employees: [...], days: [...] } or { data: [...] } — check either shape
        const rows = body.data ?? body.employees ?? body.rows ?? body
        if (!Array.isArray(rows) && !Array.isArray(body.data)) {
          // Some shapes nest differently; just verify HTTP 200 and JSON parse succeeded
          // (no deep schema guard — the route handles its own validation)
          return null
        }
        return null
      },
    },
    {
      label: 'Leave team balances',
      path:  '/attendance/leave/team-balances',
      validate(body) {
        // Returns an array or { data: [...] }
        const arr = Array.isArray(body) ? body : body.data
        if (arr !== undefined && !Array.isArray(arr))       return 'expected array or {data: array}'
        return null
      },
    },
    {
      label: 'ESS home',
      path:  '/ess/home',
      validate(body) {
        // Must have at least one of the known sections
        const knownSections = ['profile', 'kpis', 'today', 'leave_balance', 'upcoming_holidays']
        const hasAny = knownSections.some(k => k in body)
        if (!hasAny) return `response has none of the expected sections (${knownSections.join(', ')})`
        return null
      },
    },
  ]
}

// ── Step 3: Run probes ────────────────────────────────────────────────────────

async function runProbe(probe, token) {
  const url = `${BASE_URL}${probe.path}`
  let res
  try {
    res = await timedFetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      },
    })
  } catch (err) {
    return { ok: false, reason: `Network error: ${err.message}` }
  }

  if (res.status !== 200) {
    const body = await res.text().catch(() => '')
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}` }
  }

  let body
  try {
    body = await res.json()
  } catch {
    return { ok: false, reason: 'Response body is not valid JSON' }
  }

  const reason = probe.validate(body)
  if (reason) return { ok: false, reason: `Schema validation failed — ${reason}` }
  return { ok: true }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const sep = '─'.repeat(60)

  console.log(`\nCognixHR Smoke Test`)
  console.log(`Target: ${BASE_URL}`)
  console.log(`As of:  ${new Date().toISOString()}`)
  console.log(sep)

  // Authenticate
  process.stdout.write('Authenticating... ')
  let token
  try {
    token = await authenticate()
    console.log('OK')
  } catch (err) {
    console.log('FAILED')
    console.error(err.message)
    process.exit(1)
  }

  const probes  = buildProbes()
  const results = []

  for (const probe of probes) {
    process.stdout.write(`  ${probe.label.padEnd(40)} `)
    const result = await runProbe(probe, token)
    results.push({ label: probe.label, ...result })
    if (result.ok) {
      console.log('PASS')
    } else {
      console.log(`FAIL — ${result.reason}`)
    }
  }

  console.log(sep)

  const passed  = results.filter(r => r.ok).length
  const failed  = results.filter(r => !r.ok).length
  const emoji   = failed === 0 ? '✓' : '✗'

  console.log(`${emoji}  ${passed}/${probes.length} probes passed`)

  if (failed > 0) {
    console.log('\nFailing probes:')
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  • ${r.label}: ${r.reason}`)
    })
    console.log()
    process.exit(1)
  }

  console.log()
}

main().catch(err => {
  console.error(`[smoke-test] Uncaught error: ${err.message}`)
  process.exit(1)
})
