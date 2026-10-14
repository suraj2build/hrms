#!/usr/bin/env node
/**
 * seed-pilot-tenant.mjs — Repeatable, resumable creation of the invite-only
 * friends pilot tenant and its four synthetic accounts (super_admin,
 * hr_admin, manager, employee), against any deployed CognixHR environment.
 *
 * SYSTEM_AUDIT_2026-10-14 item 3 rewrite. The previous version derived
 * every email from `Date.now()` — re-running it, for ANY reason (an
 * interrupted step, a typo in a flag, wanting to re-check something),
 * created a SECOND, entirely separate pilot tenant rather than resuming the
 * first. This version is keyed off a single stable identifier,
 * PILOT_RUN_ID, so re-running with the SAME value:
 *   - reuses an already-signed-up auth account instead of erroring
 *     ("already registered") or creating a duplicate;
 *   - calls POST /setup again safely — it is idempotent per user_id (and,
 *     as of this audit round, correctly stays idempotent even if retried
 *     more than 15 minutes after the original signup — see setup.ts);
 *   - looks up an already-created manager/employee by email before
 *     creating a new one, and checks for an already-linked login account
 *     via GET /employees/:id/user-account before calling POST;
 *   - re-applies the hr_admin profile insert and the is_pilot flip with
 *     ON CONFLICT DO NOTHING / a plain idempotent UPDATE, so a second run
 *     never errors on a duplicate key.
 * None of this requires the operator to track what already happened —
 * every step independently checks "does this already exist?" before
 * acting, which is what makes an INTERRUPTED run (killed between any two
 * steps) safe to simply re-invoke with the same PILOT_RUN_ID.
 *
 * CREDENTIAL HANDOFF IS GATED ON A CONFIRMED is_pilot=true (SYSTEM_AUDIT_
 * 2026-10-14 item 3): the previous version wrote the real shared password
 * to pilot-seed-result.json unconditionally, even along the path where
 * DATABASE_URL was not provided and the pilot restriction had only been
 * PRINTED as manual SQL, not actually applied or confirmed. This version
 * writes the password to disk ONLY after a fresh SELECT (not just "the
 * UPDATE didn't error") confirms tenants.is_pilot = true for this exact
 * tenant. Without DATABASE_URL, it writes a credential-free pending file
 * instead and tells the operator exactly what to run; re-invoking the
 * script afterward (with DATABASE_URL now set, or once the SQL has been
 * applied by hand and DATABASE_URL is supplied for the confirming read)
 * completes the handoff. A password that was never written to disk or
 * printed cannot be handed to a friend before the financial-action gate is
 * actually live for that tenant.
 *
 * Required env vars:
 *   SUPABASE_URL          — e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY      — the project's anon/public key
 *   API_BASE_URL           — the deployed API's root, e.g. https://hrmsapi-xxx.up.railway.app
 *
 * Optional:
 *   PILOT_RUN_ID             — stable identifier for this pilot (default: "default").
 *                              Change it only to stand up a SECOND, separate
 *                              pilot tenant alongside an existing one.
 *   PILOT_PASSWORD           — shared password for all 4 seeded accounts.
 *                              Default: deterministically derived from
 *                              PILOT_RUN_ID, so re-running without setting
 *                              this still logs back into the SAME accounts
 *                              instead of generating a fresh password every
 *                              time (which would break resumability).
 *   PILOT_COMPANY_NAME       — default: "CognixHR Friends Pilot"
 *   PILOT_EMAIL_DOMAIN       — default: "example.test" (keep it a non-routable
 *                              domain unless you actually want these emails
 *                              reachable — see the handoff doc's invite-only
 *                              section)
 *   DATABASE_URL             — direct Postgres connection string for this
 *                              deployment's Supabase project. If set, the
 *                              script completes the hr_admin profile link
 *                              and the is_pilot flip itself, CONFIRMS
 *                              is_pilot=true with a fresh read, and only
 *                              then writes the credentials file. If unset,
 *                              the script prints the exact SQL for an
 *                              operator to run by hand and writes a
 *                              credential-free pending file instead — it
 *                              will NEVER guess, skip, or hand off
 *                              credentials before that confirmation.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... API_BASE_URL=... PILOT_RUN_ID=friends1 \
 *     node scripts/pilot/seed-pilot-tenant.mjs
 *
 * Output: writes ./pilot-seed-result.json (gitignored). Contains the real
 * password ONLY once is_pilot is confirmed true; otherwise contains
 * `credentials_withheld: true` and no password field at all.
 */

import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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
const RUN_ID            = env('PILOT_RUN_ID', 'default').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
const COMPANY_NAME      = env('PILOT_COMPANY_NAME', 'CognixHR Friends Pilot')
const EMAIL_DOMAIN      = env('PILOT_EMAIL_DOMAIN', 'example.test')
const DATABASE_URL      = process.env.DATABASE_URL

// Deterministic default password — derived from PILOT_RUN_ID alone, not
// Math.random()/Date.now(), so a second invocation with no PILOT_PASSWORD
// override still arrives at the SAME password and can log back into
// accounts the first invocation already created. PILOT_PASSWORD always
// wins if the operator sets it explicitly.
function derivedPassword(runId) {
  const digest = createHash('sha256').update(`cognixhr-pilot-seed:${runId}`).digest('hex')
  return `Pilot-${digest.slice(0, 20)}-Aa1!`
}
const PASSWORD = env('PILOT_PASSWORD', derivedPassword(RUN_ID))

const emails = {
  admin: `pilot-admin-${RUN_ID}@${EMAIL_DOMAIN}`,
  hr:    `pilot-hr-${RUN_ID}@${EMAIL_DOMAIN}`,
  mgr:   `pilot-mgr-${RUN_ID}@${EMAIL_DOMAIN}`,
  emp:   `pilot-emp-${RUN_ID}@${EMAIL_DOMAIN}`,
}

function looksLikeSignupsDisabled(message) {
  const m = (message || '').toLowerCase()
  return m.includes('signup') && (m.includes('disabled') || m.includes('not allowed')) || m.includes('email_provider_disabled')
}
function looksLikeAlreadyRegistered(message) {
  const m = (message || '').toLowerCase()
  return m.includes('already registered') || m.includes('already exists') || m.includes('user_already_exists')
}

async function supabaseSignup(email, password, fullName) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    // data.full_name mirrors exactly what Signup.tsx sends at signUp() time —
    // POST /setup's ownership guard (apps/api/src/routes/setup.ts) treats a
    // matching user_metadata.full_name as proof this call is the genuine
    // account owner, usable to resume setup long after the 15-minute
    // freshness window. Omitting it here (as this script previously did)
    // meant /setup could only ever treat this script's OWN retries as
    // "fresh enough", which stops being true once more than 15 minutes pass
    // between an interruption and a resume.
    body: JSON.stringify({ email, password, data: { full_name: fullName } }),
  })
  const json = await res.json()
  if (!res.ok || !json?.user?.id) {
    const message = json?.msg || json?.error_description || json?.message || JSON.stringify(json)
    if (looksLikeSignupsDisabled(message)) {
      throw new Error(
        `signups appear to be disabled at the Supabase project level for ${email} (${message}). ` +
        `This may be a deliberate invite-only hardening — if so, this script's self-service-signup ` +
        `provisioning path cannot be used; create the auth user directly (Supabase dashboard, or the ` +
        `admin API with the service-role key) and re-run this script with PILOT_RUN_ID unchanged so it ` +
        `picks up the existing account instead of trying to sign up again.`,
      )
    }
    if (looksLikeAlreadyRegistered(message)) {
      return { alreadyRegistered: true }
    }
    throw new Error(`signup failed for ${email}: ${res.status} ${message}`)
  }
  return { alreadyRegistered: false, user: json.user }
}

async function supabaseLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok || !json?.access_token) {
    const message = json?.error_description || json?.msg || JSON.stringify(json)
    throw new Error(
      `login failed for ${email}: ${res.status} ${message} — if this account already exists with a ` +
      `DIFFERENT password than this run's PILOT_PASSWORD (e.g. it was seeded earlier with an explicit ` +
      `override that wasn't repeated this time), either pass the same PILOT_PASSWORD again or use a new ` +
      `PILOT_RUN_ID to seed a fresh pilot instead.`,
    )
  }
  return { token: json.access_token, userId: json.user.id }
}

/** Signs up if new, or logs in to recover the existing user id — the core idempotency primitive every account uses. */
async function signupOrRecover(email, password, fullName) {
  const result = await supabaseSignup(email, password, fullName)
  if (!result.alreadyRegistered) {
    console.log(`  created: ${email} (user ${result.user.id})`)
    return result.user.id
  }
  console.log(`  already registered: ${email} — logging in to recover the existing account`)
  const { userId } = await supabaseLogin(email, password)
  return userId
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

/** Finds an existing employee by exact email (case-insensitive), or null. */
async function findEmployeeByEmail(token, email) {
  const list = await api('GET', `/employees?search=${encodeURIComponent(email)}&limit=50`, token)
  const match = (list.data ?? []).find((e) => (e.email ?? '').toLowerCase() === email.toLowerCase())
  return match ?? null
}

/** Creates the employee + login account for a role, or reuses what already exists (idempotent). */
async function ensureEmployeeWithAccount(token, { email, firstName, lastName, role, managerId }) {
  let emp = await findEmployeeByEmail(token, email)
  if (emp) {
    console.log(`  employee already exists: ${email} (${emp.id})`)
  } else {
    emp = await api('POST', '/employees', token, {
      first_name: firstName, last_name: lastName, email, joining_date: new Date().toISOString().slice(0, 10),
    })
    console.log(`  created employee: ${email} (${emp.id})`)
  }
  if (managerId) {
    await api('PUT', `/employees/${emp.id}`, token, { manager_id: managerId })
  }

  const accountStatus = await api('GET', `/employees/${emp.id}/user-account`, token)
  let authUserId = null
  if (accountStatus.status === 'no_account') {
    const created = await api('POST', `/employees/${emp.id}/user-account`, token, {
      email, role, temporary_password: PASSWORD, send_invite: false, is_active: true,
    })
    authUserId = created.auth_user_id
    console.log(`  created login account for ${email} (user ${authUserId})`)
  } else {
    authUserId = accountStatus.profile.id
    console.log(`  login account already exists for ${email} (status: ${accountStatus.status})`)
  }

  return { employeeId: emp.id, authUserId }
}

async function main() {
  console.log(`--- seeding pilot tenant "${COMPANY_NAME}" (run id: ${RUN_ID}) against ${API_BASE_URL} ---`)

  console.log('--- 1. super_admin: sign up or recover ---')
  const adminUserId = await signupOrRecover(emails.admin, PASSWORD, 'Pilot Super Admin')

  console.log('--- 2. POST /setup — idempotent per user_id (tenant + super_admin profile) ---')
  const setupResult = await api('POST', '/setup', null, {
    user_id:      adminUserId,
    full_name:    'Pilot Super Admin',
    company_name: COMPANY_NAME,
    industry:     'Technology',
    size_range:   '1-50',
  })
  const tenant = setupResult.tenant
  console.log(`  tenant id: ${tenant.id}  slug: ${tenant.slug}`)

  console.log('--- 3. logging in as super_admin ---')
  const { token: adminToken } = await supabaseLogin(emails.admin, PASSWORD)

  console.log('--- 4. hr_admin: sign up or recover (profile link happens in step 7, requires DATABASE_URL) ---')
  const hrUserId = await signupOrRecover(emails.hr, PASSWORD, 'Pilot HR Admin')

  console.log('--- 5. manager: ensure employee + login account exist ---')
  const mgr = await ensureEmployeeWithAccount(adminToken, {
    email: emails.mgr, firstName: 'Priya', lastName: 'Manager', role: 'manager',
  })

  console.log('--- 6. employee: ensure employee + login account exist, linked to the manager ---')
  const emp = await ensureEmployeeWithAccount(adminToken, {
    email: emails.emp, firstName: 'Rahul', lastName: 'TeamMember', role: 'employee', managerId: mgr.employeeId,
  })

  const manualSql = [
    `-- hr_admin profile link (no self-service API for this role — see handoff doc)`,
    `INSERT INTO profiles (id, tenant_id, role, full_name, is_active)`,
    `VALUES ('${hrUserId}', '${tenant.id}', 'hr_admin', 'Pilot HR Admin', true)`,
    `ON CONFLICT (id) DO NOTHING;`,
    ``,
    `-- mark this tenant as a pilot tenant (blocks real-money/statutory routes server-side)`,
    `UPDATE tenants SET is_pilot = true WHERE id = '${tenant.id}';`,
    ``,
    `-- confirm before handing out credentials — re-run this script with DATABASE_URL set`,
    `-- (or run this SELECT yourself and only then share the password) and check it returns true:`,
    `SELECT is_pilot FROM tenants WHERE id = '${tenant.id}';`,
  ].join('\n')

  let isPilotConfirmed = false
  if (DATABASE_URL) {
    console.log('--- 7. DATABASE_URL set — completing the hr_admin link + is_pilot flip, then confirming ---')
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: DATABASE_URL })
    await client.connect()
    try {
      await client.query(
        `INSERT INTO profiles (id, tenant_id, role, full_name, is_active) VALUES ($1, $2, 'hr_admin', 'Pilot HR Admin', true)
         ON CONFLICT (id) DO NOTHING`,
        [hrUserId, tenant.id],
      )
      await client.query(`UPDATE tenants SET is_pilot = true WHERE id = $1`, [tenant.id])
      // Confirm with a FRESH READ — not just "the UPDATE didn't error" — before
      // this function is allowed to hand out the real password below.
      const { rows } = await client.query(`SELECT is_pilot FROM tenants WHERE id = $1`, [tenant.id])
      isPilotConfirmed = rows[0]?.is_pilot === true
      console.log(`  is_pilot confirmed: ${isPilotConfirmed}`)
    } finally {
      await client.end()
    }
  } else {
    console.log('--- 7. DATABASE_URL not set — run this SQL by hand, then re-run this script with DATABASE_URL set to confirm and unlock the credentials file: ---')
    console.log(manualSql)
  }

  const baseResult = {
    pilot_run_id:  RUN_ID,
    tenant_id:     tenant.id,
    tenant_slug:   tenant.slug,
    company_name:  COMPANY_NAME,
    emails,
    admin_user_id: adminUserId,
    hr_user_id:    hrUserId,
    mgr_employee_id: mgr.employeeId,
    emp_employee_id: emp.employeeId,
    is_pilot_confirmed: isPilotConfirmed,
  }

  if (isPilotConfirmed) {
    writeFileSync('./pilot-seed-result.json', JSON.stringify({ ...baseResult, password: PASSWORD }, null, 2))
    console.log('\n=== Saved ./pilot-seed-result.json WITH credentials — is_pilot is confirmed true. ===')
    console.log('    Hand the password to friends out of band (a password manager share, never email/Slack).')
  } else {
    writeFileSync('./pilot-seed-result.json', JSON.stringify({
      ...baseResult,
      credentials_withheld: true,
      manual_sql_to_run: manualSql,
    }, null, 2))
    console.log('\n!!! CREDENTIALS WITHHELD — pilot-seed-result.json has NO password. !!!')
    console.log('!!! is_pilot is not yet confirmed true for this tenant. Run the manual_sql_to_run above')
    console.log('!!! (or re-run this script with DATABASE_URL set, same PILOT_RUN_ID) before inviting anyone.')
  }
}

main().catch((err) => {
  console.error('[seed-pilot-tenant] FATAL:', err.message)
  process.exit(1)
})
