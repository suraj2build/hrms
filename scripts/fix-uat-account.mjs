#!/usr/bin/env node
/**
 * scripts/fix-uat-account.mjs
 *
 * One-shot fix: creates/repairs the UAT tenant + uatsuraj@gmail.com login.
 * Connects directly to PostgreSQL — does NOT need local-server running.
 *
 * Usage:
 *   node scripts/fix-uat-account.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const dotEnvPath = path.resolve(__dir, '..', '.env.local-seed')
if (existsSync(dotEnvPath)) {
  for (const line of readFileSync(dotEnvPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://hrms_local:hrms_dev_2024@127.0.0.1:5432/hrms'
const TID    = 'b0000000-0000-0000-0000-000000000001'
const UID    = 'a1000000-0000-0000-0000-000000000001'
const ADMIN  = 'a2000000-0000-0000-0000-000000000001'
const EMAIL  = 'uatsuraj@gmail.com'
const PASS   = 'CognixDemo!1'

const pg = await import('pg').then(m => m.default ?? m)
const pool = new pg.Pool({ connectionString: DB_URL, max: 1 })

console.log('\nCognixHR — UAT Account Fix')
console.log('─'.repeat(50))

// 1. UAT tenant
await pool.query(`
  INSERT INTO tenants (id, name, slug, plan, country, timezone, status, trial_ends_at, created_at)
  VALUES ($1, 'CognixHR UAT', 'cognixhr-uat', 'enterprise', 'IN',
          'Asia/Kolkata', 'active', now() + interval '3650 days', now())
  ON CONFLICT (id) DO UPDATE
    SET status = 'active', trial_ends_at = now() + interval '3650 days'
`, [TID])
console.log('✓  UAT tenant created/updated')

// 2. auth.users
const bcryptjs = await import('bcryptjs').then(m => m.default ?? m)
const hash = await bcryptjs.hash(PASS, 10)
await pool.query(`
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    $1, 'authenticated', 'authenticated', $2, $3,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Suraj (UAT)"}'
  )
  ON CONFLICT (id) DO UPDATE
    SET email = $2, encrypted_password = $3, updated_at = now()
`, [UID, EMAIL, hash])
console.log(`✓  auth.users: ${EMAIL}`)

// 3. platform_admins
await pool.query(`
  INSERT INTO platform_admins (id, user_id, name, email, role, is_active, created_at)
  VALUES ($1, $2, 'Suraj (UAT)', $3, 'owner', true, now())
  ON CONFLICT (user_id) DO UPDATE
    SET name = 'Suraj (UAT)', email = $3, role = 'owner', is_active = true
`, [ADMIN, UID, EMAIL])
console.log('✓  platform_admins: owner')

// 4. profile → links user to UAT tenant as super_admin
await pool.query(`
  INSERT INTO profiles (id, tenant_id, role, is_active, full_name, email)
  VALUES ($1, $2, 'super_admin', true, 'Suraj (UAT)', $3)
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = $2, role = 'super_admin', is_active = true,
        full_name = 'Suraj (UAT)', email = $3
`, [UID, TID, EMAIL])
console.log('✓  profile: super_admin on UAT tenant')

await pool.end()
console.log()
console.log('─'.repeat(50))
console.log('✓  All done!')
console.log()
console.log('  Login at:  http://localhost:2000')
console.log(`  Email:     ${EMAIL}`)
console.log(`  Password:  ${PASS}`)
console.log()
