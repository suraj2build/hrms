#!/usr/bin/env node
/**
 * seed-pilot-tenant.mjs — Repeatable creation of the invite-only friends
 * pilot tenant and its four synthetic accounts (super_admin, hr_admin,
 * manager, employee), against any deployed CognixHR environment.
 *
 * This is the durable, parameterized version of the ad-hoc local script used
 * to first stand up the pilot tenant during development. It talks to the
 * real Supabase Auth REST API and the real CognixHR API — no shortcuts, no
 * direct table inserts for anything the real app itself can do through its
 * own endpoints. The one exception is flipping tenants.is_pilot to true,
 * which has no self-service API (by design — only platform-admin tooling or
 * direct DB access should be able to do it); see "Marking the tenant as
 * pilot" below.
 *
 * Required env vars:
 *   SUPABASE_URL          — e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY      — the project's anon/public key
 *   API_BASE_URL           — the deployed API's root, e.g. https://hrmsapi-xxx.up.railway.app
 *
 * Optional:
 *   PILOT_PASSWORD          — shared password for all 4 seeded accounts
 *                              (default: a random one is generated and printed)
 *   PILOT_COMPANY_NAME       — default: "CognixHR Friends Pilot"
 *   PILOT_EMAIL_DOMAIN       — default: "example.test" (keep it a non-routable
 *                              domain unless you actually want these emails
 *                              reachable — see the handoff doc's invite-only
 *                              section)
 *   DATABASE_URL             — direct Postgres connection string for this
 *                              deployment's Supabase project. If set, the
 *                              script marks the tenant pilot itself
 *                              (UPDATE tenants SET is_pilot = true). If
 *                              unset, the script prints the exact SQL for an
 *                              operator to run by hand instead — it will
 *                              NEVER guess or skip this step silently.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... API_BASE_URL=... \
 *     node scripts/pilot/seed-pilot-tenant.mjs
 *
 * Output: writes ./pilot-seed-result.json (gitignored — contains the
 * generated password and account ids) with everything needed to hand the
 * credentials to friends securely (e.g. pasted into a password manager
 * share, never committed, never emailed in plaintext).
 */

import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

function env(name, fallback) {
  const v = process.env[name]
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback
    console.error(`[seed-pilot-tenant] FATAL: required env var ${name} is not set`)
    process.exit(1)
  }
  return v
}

const SUPABASE_URL      = env('SUPABASE_URL').replace(/\/$/, '')
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY')
const API_BASE_URL      = env('API_BASE_URL').replace(/\/$/, '')
const COMPANY_NAME      = env('PILOT_COMPANY_NAME', 'CognixHR Friends Pilot')
const EMAIL_DOMAIN      = env('PILOT_EMAIL_DOMAIN', 'example.test')
const PASSWORD          = env('PILOT_PASSWORD', `Pilot-${randomBytes(9).toString('base64url')}!`)
const DATABASE_URL      = process.env.DATABASE_URL

const ts = Math.floor(Date.now() / 1000)
const emails = {
  admin: `pilot-admin-${ts}@${EMAIL_DOMAIN}`,
  hr:    `pilot-hr-${ts}@${EMAIL_DOMAIN}`,
  mgr:   `pilot-mgr-${ts}@${EMAIL_DOMAIN}`,
  emp:   `pilot-emp-${ts}@${EMAIL_DOMAIN}`,
}

async function supabaseSignup(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok || !json?.user?.id) {
    throw new Error(`signup failed for ${email}: ${res.status} ${JSON.stringify(json)}`)
  }
  return json
}

async function supabaseLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok || !json?.access_token) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(json)}`)
  }
  return json.access_token
}

async function api(method, path, token, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`)
  return json
}

console.log(`--- seeding pilot tenant "${COMPANY_NAME}" against ${API_BASE_URL} ---`)

console.log('--- 1. signing up super_admin via real Supabase Auth ---')
const adminSignup = await supabaseSignup(emails.admin, PASSWORD)
console.log('  admin user id:', adminSignup.user.id)

console.log('--- 2. POST /setup — real tenant onboarding path (creates tenant + super_admin profile) ---')
const setupResult = await api('POST', '/setup', null, {
  user_id:      adminSignup.user.id,
  full_name:    'Pilot Super Admin',
  company_name: COMPANY_NAME,
  industry:     'Technology',
  size_range:   '1-50',
})
const tenant = setupResult.tenant
console.log('  tenant id:', tenant.id, ' slug:', tenant.slug)

console.log('--- 3. logging in as super_admin ---')
const adminToken = await supabaseLogin(emails.admin, PASSWORD)

console.log('--- 4. signing up + linking hr_admin (no self-service HR-admin API — direct profile link) ---')
// There is deliberately no API to self-provision an hr_admin (only employee
// and manager roles can be created via POST /employees/:id/user-account —
// see PILOT_DEPLOYMENT_HANDOFF.md's "Known product gap" note). This mirrors
// exactly what the development-time seed did: sign up the auth account for
// real, then link it with a direct profiles insert. This one step requires
// DATABASE_URL — if unset, it's deferred to the printed manual-SQL block at
// the end, same as the is_pilot flip below.
const hrSignup = await supabaseSignup(emails.hr, PASSWORD)
console.log('  hr user id:', hrSignup.user.id)

console.log('--- 5. creating manager employee + login account (real API) ---')
const mgrEmp = await api('POST', '/employees', adminToken, {
  first_name: 'Priya', last_name: 'Manager', email: emails.mgr, joining_date: new Date().toISOString().slice(0, 10),
})
const mgrAcct = await api('POST', `/employees/${mgrEmp.id}/user-account`, adminToken, {
  email: emails.mgr, role: 'manager', temporary_password: PASSWORD, send_invite: false, is_active: true,
})
console.log('  manager employee id:', mgrEmp.id, ' user id:', mgrAcct.auth_user_id)

console.log('--- 6. creating employee + login account, linked to the manager (real API) ---')
const emp = await api('POST', '/employees', adminToken, {
  first_name: 'Rahul', last_name: 'TeamMember', email: emails.emp, joining_date: new Date().toISOString().slice(0, 10),
})
await api('PUT', `/employees/${emp.id}`, adminToken, { manager_id: mgrEmp.id })
const empAcct = await api('POST', `/employees/${emp.id}/user-account`, adminToken, {
  email: emails.emp, role: 'employee', temporary_password: PASSWORD, send_invite: false, is_active: true,
})
console.log('  employee id:', emp.id, ' user id:', empAcct.auth_user_id)

const manualSql = []
manualSql.push(
  `-- hr_admin profile link (no self-service API for this role — see handoff doc)`,
  `INSERT INTO profiles (id, tenant_id, role, full_name, is_active)`,
  `VALUES ('${hrSignup.user.id}', '${tenant.id}', 'hr_admin', 'Pilot HR Admin', true);`,
  ``,
  `-- mark this tenant as a pilot tenant (blocks real-money/statutory routes server-side)`,
  `UPDATE tenants SET is_pilot = true WHERE id = '${tenant.id}';`,
)

let dbStepsCompleted = false
if (DATABASE_URL) {
  console.log('--- 7. DATABASE_URL set — completing the hr_admin link + is_pilot flip directly ---')
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `INSERT INTO profiles (id, tenant_id, role, full_name, is_active) VALUES ($1, $2, 'hr_admin', 'Pilot HR Admin', true)`,
      [hrSignup.user.id, tenant.id],
    )
    await client.query(`UPDATE tenants SET is_pilot = true WHERE id = $1`, [tenant.id])
    dbStepsCompleted = true
    console.log('  done.')
  } finally {
    await client.end()
  }
} else {
  console.log('--- 7. DATABASE_URL not set — run this SQL by hand against the deployment\'s Postgres: ---')
  console.log(manualSql.join('\n'))
}

const result = {
  tenant_id:    tenant.id,
  tenant_slug:  tenant.slug,
  company_name: COMPANY_NAME,
  password:     PASSWORD,
  emails,
  admin_user_id: adminSignup.user.id,
  hr_user_id:    hrSignup.user.id,
  mgr_employee_id: mgrEmp.id,
  emp_employee_id: emp.id,
  db_steps_completed: dbStepsCompleted,
  manual_sql_if_db_steps_not_completed: dbStepsCompleted ? null : manualSql.join('\n'),
}
writeFileSync('./pilot-seed-result.json', JSON.stringify(result, null, 2))
console.log('\n=== Saved ./pilot-seed-result.json (DO NOT COMMIT — contains the shared password) ===')
if (!dbStepsCompleted) {
  console.log('\n!!! Pilot restrictions are NOT yet active — run the printed SQL before inviting anyone. !!!')
}
