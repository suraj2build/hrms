#!/usr/bin/env node
/**
 * pilot-smoke-check.mjs — Pilot-specific deployment smoke check.
 *
 * Complements the general scripts/smoke-test.mjs (which proves the API is
 * up and answering real data) with checks specific to the pilot's safety
 * contract: the financial-action gate actually blocks the pilot tenant, a
 * genuinely different (non-pilot) tenant is provably unaffected, and —
 * SYSTEM_AUDIT_2026-10-14 item 3 — none of this is accidentally "passing"
 * because the deployment is actually broken underneath the check.
 *
 * The previous version only ever asked "did I get back exactly 403
 * PILOT_TENANT_RESTRICTED?" for a guarded route, and "was I NOT blocked
 * with exactly that shape?" for an allowed one. That second question has a
 * real gap: a misconfigured deployment returning 500 (crashed), 401
 * (auth/token wiring broken) or 404 (route not actually deployed) on an
 * "allowed" action is not "wrongly blocked" by the pilot gate's own 403
 * shape — so the old logic recorded it as a PASS. A broken deployment
 * could sail through this smoke check. This version explicitly treats
 * 401/404/500 as a distinct, always-fatal outcome for EVERY check, guarded
 * or allowed, and requires an allowed action to come back with an actual
 * success status, not merely "not the specific pilot-block shape".
 *
 * It also verifies NO SIDE EFFECT for the highest-value guarded route
 * (the F&F mark-paid route — the single biggest gap the SYSTEM_AUDIT_2026-
 * 10-14-era route audit found) using a REAL employee id from this pilot's
 * own seed result (scripts/pilot/seed-pilot-tenant.mjs), not a dummy
 * all-zero UUID — a dummy id can only ever prove the gate fires before a
 * foreign-key lookup; it cannot prove the gate fires before any write is
 * attempted against a row that actually exists. When DATABASE_URL is
 * supplied, it reads separation_ff_summary directly afterward to confirm
 * nothing was written.
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
 * Optional:
 *   PILOT_SAMPLE_EMPLOYEE_ID          — a real employee id belonging to the
 *                                       pilot tenant (pilot-seed-result.json's
 *                                       mgr_employee_id or emp_employee_id).
 *                                       Falls back to a dummy all-zero UUID
 *                                       if omitted, with a clear warning that
 *                                       the side-effect check is then weaker.
 *   DATABASE_URL                      — if set, directly verifies no row was
 *                                       written to separation_ff_summary for
 *                                       PILOT_SAMPLE_EMPLOYEE_ID by the
 *                                       blocked mark-paid attempt above.
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
const DATABASE_URL        = process.env.DATABASE_URL

const DUMMY_ZERO_UUID = '00000000-0000-0000-0000-000000000000'
let SAMPLE_EMPLOYEE_ID = process.env.PILOT_SAMPLE_EMPLOYEE_ID
if (!SAMPLE_EMPLOYEE_ID) {
  console.log('[pilot-smoke-check] WARNING: PILOT_SAMPLE_EMPLOYEE_ID not set — falling back to a dummy')
  console.log('                    all-zero UUID. This can only prove the gate fires before a foreign-key')
  console.log('                    lookup, not before a write against a row that actually exists. Pass')
  console.log('                    mgr_employee_id or emp_employee_id from pilot-seed-result.json instead.')
  SAMPLE_EMPLOYEE_ID = DUMMY_ZERO_UUID
}

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

/**
 * Classifies a response for a check that EXPECTS the pilot gate to fire
 * (403 PILOT_TENANT_RESTRICTED). An unexpected 401/404/500 is always its
 * own distinct failure, not folded into "gate didn't fire" — they mean
 * different things (broken auth/routing/deployment vs. a real gate gap).
 */
function evaluateGuarded(res, body) {
  if (res.status === 403 && body?.error === 'PILOT_TENANT_RESTRICTED') return { pass: true }
  if ([401, 404, 500].includes(res.status)) {
    return { pass: false, reason: `unexpected ${res.status} — this looks like broken auth/routing/deployment, not a working-or-not-working pilot gate` }
  }
  return { pass: false, reason: `expected 403 PILOT_TENANT_RESTRICTED, got ${res.status} ${body?.error ?? ''}` }
}

/**
 * Classifies a response for a check that EXPECTS the action to succeed
 * normally for a pilot tenant (a read, or a non-financial write). Requires
 * an actual success status — NOT merely "the response wasn't the specific
 * pilot-block shape", which the old version accepted and which a 401/404/
 * 500 would also satisfy.
 */
function evaluateAllowed(res, body) {
  if (res.status === 403 && body?.error === 'PILOT_TENANT_RESTRICTED') {
    return { pass: false, reason: 'wrongly blocked by the pilot gate — this action should be allowed' }
  }
  if (res.status >= 200 && res.status < 300) return { pass: true }
  return { pass: false, reason: `expected a 2xx success, got ${res.status} ${body?.error ?? ''}` }
}

console.log(`--- pilot smoke check against ${API_BASE_URL} ---\n`)

const pilotToken = await login(PILOT_HR_EMAIL, PILOT_HR_PASSWORD)

// A representative sample of the ~31 guarded actions — not exhaustive (the
// repo's own test suite is the exhaustive check), enough to prove the gate
// is wired end to end on this live deployment across every protected area:
// filing-pack export, standalone export, GL posting, loan/advance
// disbursement, and the F&F mark-paid route (using a REAL employee id,
// see the file header).
const guardedChecks = [
  { label: 'PF ECR export (filing-pack)', method: 'GET', path: '/payroll/filing-pack/ecr?month=2026-10' },
  { label: 'EPF statutory export',        method: 'GET', path: '/payroll/exports/epf?month=2026-10' },
  { label: 'GL ledger post',              method: 'POST', path: '/payroll/ledgers/00000000-0000-0000-0000-000000000000/post', body: {} },
  { label: 'Loan disbursement',           method: 'POST', path: '/payroll/loans/00000000-0000-0000-0000-000000000000/disburse', body: { disbursed_date: '2026-10-13', disbursed_amount: 1, first_emi_month: '2026-11' } },
  { label: 'F&F mark-paid (real employee id)', method: 'PATCH', path: `/employees/${SAMPLE_EMPLOYEE_ID}/separation-ff/mark-paid`, body: {} },
]

for (const check of guardedChecks) {
  const res = await fetch(`${API_BASE_URL}${check.path}`, {
    method: check.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pilotToken}` },
    body: check.body ? JSON.stringify(check.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  const { pass, reason } = evaluateGuarded(res, body)
  record(`pilot tenant blocked — ${check.label}`, pass, reason ?? `${res.status} ${body.error ?? ''}`)
}

// Side-effect verification for the highest-value guarded route, using the
// real employee id above — a dummy id can only prove the gate fires before
// a foreign-key lookup; this proves it fires before any row for a REAL
// employee is touched.
if (DATABASE_URL && SAMPLE_EMPLOYEE_ID !== DUMMY_ZERO_UUID) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM separation_ff_summary WHERE employee_id = $1`,
      [SAMPLE_EMPLOYEE_ID],
    )
    record('F&F mark-paid left NO row in separation_ff_summary for the real employee', Number(rows[0].n) === 0, `${rows[0].n} row(s) found`)
  } finally {
    await client.end()
  }
} else {
  console.log('SKIPPED — F&F side-effect DB verification (set DATABASE_URL and PILOT_SAMPLE_EMPLOYEE_ID to run it).')
}

// Allowed actions — a pilot tenant must still be able to do these, and must
// get back an ACTUAL success, not merely "not pilot-blocked" (see evaluateAllowed).
const allowedChecks = [
  { label: 'list payroll runs (read)',          method: 'GET', path: '/payroll/runs' },
  { label: 'create payroll run (preview)',      method: 'POST', path: '/payroll/runs', body: { month: new Date().toISOString().slice(0, 7), dry_run: true } },
]
for (const check of allowedChecks) {
  const res = await fetch(`${API_BASE_URL}${check.path}`, {
    method: check.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pilotToken}` },
    body: check.body ? JSON.stringify(check.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  const { pass, reason } = evaluateAllowed(res, body)
  record(`pilot tenant NOT blocked — ${check.label}`, pass, reason ?? `${res.status} ${body.error ?? ''}`)
}

if (CONTROL_HR_EMAIL && CONTROL_HR_PASSWORD) {
  const controlToken = await login(CONTROL_HR_EMAIL, CONTROL_HR_PASSWORD)
  const res = await fetch(`${API_BASE_URL}/payroll/filing-pack/ecr?month=2026-10`, {
    headers: { Authorization: `Bearer ${controlToken}` },
  })
  const body = await res.json().catch(() => ({}))
  const { pass, reason } = evaluateAllowed(res, body)
  record('non-pilot (control) tenant NOT blocked — PF ECR export', pass, reason ?? `${res.status} ${body.error ?? ''}`)
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
