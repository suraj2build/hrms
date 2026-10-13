#!/usr/bin/env node
/**
 * pilot-smoke-check.mjs — Pilot-specific deployment smoke check.
 *
 * Complements the general scripts/smoke-test.mjs (which proves the API is
 * up and answering real data) with checks specific to the pilot's safety
 * contract: the financial-action gate actually blocks the pilot tenant, and
 * a genuinely different (non-pilot) tenant is provably unaffected.
 *
 * Run this immediately after deploying + seeding the pilot tenant
 * (scripts/pilot/seed-pilot-tenant.mjs) and before inviting anyone.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY   — same project the pilot was seeded into
 *   API_BASE_URL                      — the deployed API's root
 *   PILOT_HR_EMAIL, PILOT_HR_PASSWORD — a pilot-tenant hr_admin's credentials
 *                                       (from pilot-seed-result.json)
 *
 * Optional (skips the non-pilot control check if absent — logged clearly,
 * not silently):
 *   CONTROL_HR_EMAIL, CONTROL_HR_PASSWORD — a real, non-pilot tenant's
 *                                            hr_admin credentials, to prove
 *                                            the gate does NOT fire for a
 *                                            genuine tenant (the check this
 *                                            whole gate exists to never fail)
 *
 * Exit codes: 0 all checks passed; 1 any check failed or was inconclusive.
 */

function env(name) {
  const v = process.env[name]
  if (!v) { console.error(`[pilot-smoke-check] FATAL: ${name} is not set`); process.exit(1) }
  return v
}

const SUPABASE_URL      = env('SUPABASE_URL').replace(/\/$/, '')
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY')
const API_BASE_URL      = env('API_BASE_URL').replace(/\/$/, '')
const PILOT_HR_EMAIL    = env('PILOT_HR_EMAIL')
const PILOT_HR_PASSWORD = env('PILOT_HR_PASSWORD')
const CONTROL_HR_EMAIL    = process.env.CONTROL_HR_EMAIL
const CONTROL_HR_PASSWORD = process.env.CONTROL_HR_PASSWORD

async function login(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok || !json?.access_token) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(json)}`)
  return json.access_token
}

const results = []
function record(label, pass, detail) {
  results.push({ label, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? ': ' + detail : ''}`)
}

console.log(`--- pilot smoke check against ${API_BASE_URL} ---\n`)

const pilotToken = await login(PILOT_HR_EMAIL, PILOT_HR_PASSWORD)

// A representative sample of the ~31 guarded actions — not exhaustive (the
// repo's own test suite is the exhaustive check), enough to prove the gate
// is wired end to end on this live deployment across every protected area:
// filing-pack export, standalone export, GL posting, loan/advance
// disbursement, and the F&F mark-paid route.
const guardedChecks = [
  { label: 'PF ECR export (filing-pack)', method: 'GET', path: '/payroll/filing-pack/ecr?period=2026-10' },
  { label: 'EPF statutory export',        method: 'GET', path: '/payroll/exports/epf?period=2026-10' },
  { label: 'GL ledger post',              method: 'POST', path: '/payroll/ledgers/00000000-0000-0000-0000-000000000000/post', body: {} },
  { label: 'Loan disbursement',           method: 'POST', path: '/payroll/loans/00000000-0000-0000-0000-000000000000/disburse', body: { disbursed_date: '2026-10-13', disbursed_amount: 1, first_emi_month: '2026-11' } },
  { label: 'F&F mark-paid',               method: 'PATCH', path: '/employees/00000000-0000-0000-0000-000000000000/separation-ff/mark-paid', body: {} },
]

for (const check of guardedChecks) {
  const res = await fetch(`${API_BASE_URL}${check.path}`, {
    method: check.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pilotToken}` },
    body: check.body ? JSON.stringify(check.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  const pass = res.status === 403 && body.error === 'PILOT_TENANT_RESTRICTED'
  record(`pilot tenant blocked — ${check.label}`, pass, `${res.status} ${body.error ?? ''}`)
}

// Allowed actions — a pilot tenant must still be able to do these.
const allowedChecks = [
  { label: 'list payroll runs (read)',          method: 'GET', path: '/payroll/runs' },
  { label: 'create payroll run (preview)',      method: 'POST', path: '/payroll/runs', body: { period: new Date().toISOString().slice(0, 7), dry_run: true } },
]
for (const check of allowedChecks) {
  const res = await fetch(`${API_BASE_URL}${check.path}`, {
    method: check.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pilotToken}` },
    body: check.body ? JSON.stringify(check.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  const wronglyBlocked = res.status === 403 && body.error === 'PILOT_TENANT_RESTRICTED'
  record(`pilot tenant NOT blocked — ${check.label}`, !wronglyBlocked, `${res.status} ${body.error ?? ''}`)
}

if (CONTROL_HR_EMAIL && CONTROL_HR_PASSWORD) {
  const controlToken = await login(CONTROL_HR_EMAIL, CONTROL_HR_PASSWORD)
  const res = await fetch(`${API_BASE_URL}/payroll/filing-pack/ecr?period=2026-10`, {
    headers: { Authorization: `Bearer ${controlToken}` },
  })
  const body = await res.json().catch(() => ({}))
  const wronglyBlocked = res.status === 403 && body.error === 'PILOT_TENANT_RESTRICTED'
  record('non-pilot (control) tenant NOT blocked — PF ECR export', !wronglyBlocked, `${res.status} ${body.error ?? ''}`)
} else {
  console.log('SKIPPED — non-pilot control check (set CONTROL_HR_EMAIL/CONTROL_HR_PASSWORD to run it).')
  console.log('          This is the single most important check to not skip before inviting anyone:')
  console.log('          it is the only thing proving the gate has not also started blocking real tenants.')
}

const failed = results.filter(r => !r.pass)
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`)
if (failed.length) {
  console.log('FAILURES:', JSON.stringify(failed, null, 2))
  process.exit(1)
}
if (!CONTROL_HR_EMAIL) process.exit(1) // the skipped control check is mandatory before go-live, not optional
