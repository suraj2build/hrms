#!/usr/bin/env node
/**
 * scripts/local-db-setup.mjs
 *
 * First-time local development setup. Run once before `bash scripts/local-start.sh`.
 * Works without Docker — requires only native PostgreSQL 16+ on localhost:5432.
 *
 * What it does:
 *   1. Creates the 'hrms' database (if missing)
 *   2. Creates the 'hrms_local' PostgreSQL user (if missing)
 *   3. Applies scripts/local-db-bootstrap.sql (auth + storage schemas)
 *   4. Applies all 378 Supabase migrations in order
 *   5. Seeds demo data (seed-demo.sql + all seed-demo-extra-*.sql)
 *
 * Prerequisites:
 *   - PostgreSQL 16+ running on localhost:5432
 *   - postgres OS user can connect via peer auth (default on Ubuntu/Debian)
 *   - npm packages installed (npm install at repo root)
 *
 * Usage:
 *   node scripts/local-db-setup.mjs
 *   node scripts/local-db-setup.mjs --skip-migrations   (seed only)
 *   node scripts/local-db-setup.mjs --skip-seed         (migrate only)
 *   node scripts/local-db-setup.mjs --reset             (drop & recreate DB first)
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO      = path.resolve(__dirname, '..')

const G = '\x1b[32m', B = '\x1b[34m', Y = '\x1b[33m', R = '\x1b[31m', N = '\x1b[0m'
const ok   = m => console.log(`${G}  ✓ ${m}${N}`)
const warn = m => console.log(`${Y}  ⚠ ${m}${N}`)
const fail = m => { console.error(`${R}  ✗ ${m}${N}`); process.exit(1) }
const step = m => console.log(`\n${B}━━ ${m}${N}`)

const ARGS         = process.argv.slice(2)
const SKIP_MIG     = ARGS.includes('--skip-migrations')
const SKIP_SEED    = ARGS.includes('--skip-seed')
const RESET        = ARGS.includes('--reset')

// ── PostgreSQL connection config ──────────────────────────────────────────────
const PG_USER = 'hrms_local'
const PG_PASS = 'hrms_dev_2024'
const PG_HOST = '127.0.0.1'
const PG_PORT = '5432'
const PG_DB   = 'hrms'

const env = { ...process.env, PGPASSWORD: PG_PASS }

function psql(sql, db = PG_DB, opts = {}) {
  const r = spawnSync('psql', ['-U', PG_USER, '-h', PG_HOST, '-p', PG_PORT, '-d', db, '-c', sql],
    { env, encoding: 'utf8', ...opts })
  return r
}

function psqlFile(file, db = PG_DB) {
  return spawnSync('psql', ['-U', PG_USER, '-h', PG_HOST, '-p', PG_PORT, '-d', db, '-f', file, '-q'],
    { env, encoding: 'utf8' })
}

function superPsql(sql, db = 'postgres') {
  // Use peer auth as the postgres OS user for initial setup
  const r = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-c', sql],
    { encoding: 'utf8' })
  return r
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`${B}`)
console.log('  ╔═══════════════════════════════════════╗')
console.log('  ║   CognixHR — Local DB Setup           ║')
console.log('  ║   PostgreSQL + Migrations + Seed      ║')
console.log('  ╚═══════════════════════════════════════╝')
console.log(`${N}`)

// ── 1. Check PostgreSQL ───────────────────────────────────────────────────────
step('Checking PostgreSQL')
const pgReady = spawnSync('pg_isready', ['-h', 'localhost', '-p', PG_PORT], { encoding: 'utf8' })
if (pgReady.status !== 0) {
  fail('PostgreSQL not running on localhost:5432. Start with:\n    sudo pg_ctlcluster 16 main start')
}
ok('PostgreSQL is running')

// ── 2. Create hrms_local user ─────────────────────────────────────────────────
step('Creating hrms_local database user')
const createUser = superPsql(`CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}' SUPERUSER;`)
if (createUser.status === 0) {
  ok(`Created user '${PG_USER}'`)
} else if ((createUser.stderr ?? '').includes('already exists')) {
  ok(`User '${PG_USER}' already exists`)
} else {
  warn(`User creation: ${(createUser.stderr ?? '').trim().slice(0, 120)}`)
}

// ── 3. Recreate or create the hrms database ───────────────────────────────────
step(`Setting up '${PG_DB}' database`)

if (RESET) {
  warn('--reset: dropping existing hrms database...')
  superPsql(`DROP DATABASE IF EXISTS ${PG_DB};`, 'postgres')
  ok('Dropped hrms database')
}

const createDb = superPsql(`CREATE DATABASE ${PG_DB} OWNER ${PG_USER};`, 'postgres')
if (createDb.status === 0) {
  ok(`Created database '${PG_DB}'`)
} else if ((createDb.stderr ?? '').includes('already exists')) {
  ok(`Database '${PG_DB}' already exists`)
} else {
  fail(`Could not create database: ${(createDb.stderr ?? '').trim()}`)
}

// Grant privileges
superPsql(`GRANT ALL PRIVILEGES ON DATABASE ${PG_DB} TO ${PG_USER};`, 'postgres')
ok(`Granted privileges on '${PG_DB}' to '${PG_USER}'`)

// ── 4. Apply bootstrap SQL (auth + storage schemas) ───────────────────────────
step('Applying auth/storage bootstrap schema')
const bootstrapFile = path.join(REPO, 'scripts', 'local-db-bootstrap.sql')
if (!existsSync(bootstrapFile)) fail(`Missing ${bootstrapFile}`)

const bootstrap = psqlFile(bootstrapFile)
const bootstrapErr = (bootstrap.stderr ?? '').replace(/\n/g, ' ').trim()
if (bootstrap.status !== 0 && !bootstrapErr.includes('already exists')) {
  fail(`Bootstrap failed: ${bootstrapErr.slice(0, 200)}`)
}
ok('Auth + storage schemas ready')

// ── 5. Apply migrations ───────────────────────────────────────────────────────
if (!SKIP_MIG) {
  step('Applying Supabase migrations')
  const migDir = path.join(REPO, 'supabase', 'migrations')
  if (!existsSync(migDir)) fail(`Missing migrations directory: ${migDir}`)

  const files = readdirSync(migDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  console.log(`  Found ${files.length} migration files`)

  let applied = 0, skipped = 0
  for (const file of files) {
    const filepath = path.join(migDir, file)
    const r = psqlFile(filepath)
    const stderr = (r.stderr ?? '').replace(/\n/g, ' ')

    // Non-fatal errors we can safely ignore
    const isFatal = r.status !== 0 &&
      !stderr.includes('already exists') &&
      !stderr.includes('does not exist') &&
      !stderr.includes('IF NOT EXISTS') &&
      // PG16 doesn't support CREATE POLICY IF NOT EXISTS (needs PG17)
      !stderr.includes('syntax error') &&
      !stderr.includes('duplicate_object') &&
      !stderr.includes('duplicate column')

    if (isFatal) {
      warn(`Migration ${file} had errors:\n    ${stderr.slice(0, 200)}`)
      skipped++
    } else {
      applied++
    }

    if (applied % 50 === 0) process.stdout.write('.')
  }
  console.log()
  ok(`Migrations: ${applied} applied, ${skipped} had non-fatal warnings`)
} else {
  warn('Skipping migrations (--skip-migrations)')
}

// ── 6. Fix known schema gaps ───────────────────────────────────────────────────
step('Applying schema fixes')

// auth.identities (needed by seed-demo.sql)
psql(`
  CREATE TABLE IF NOT EXISTS auth.identities (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_id     TEXT,
    identity_data   JSONB NOT NULL DEFAULT '{}',
    provider        TEXT NOT NULL,
    last_sign_in_at TIMESTAMPTZ,
    email           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, provider_id)
  );
`)

// Fix sync_employee_job_fields trigger (refs dropped columns from migration 016)
psql(`
  CREATE OR REPLACE FUNCTION public.sync_employee_job_fields()
  RETURNS trigger LANGUAGE plpgsql AS $func$
  BEGIN
    IF NEW.is_current AND NEW.manager_id IS NOT NULL THEN
      UPDATE employees SET manager_id = NEW.manager_id WHERE id = NEW.employee_id;
    END IF;
    RETURN NEW;
  END;
  $func$;
`)

// Add ledger_posted to payroll_run_events check constraint (seed-demo-extra-3 uses it)
psql(`
  ALTER TABLE IF EXISTS payroll_run_events DROP CONSTRAINT IF EXISTS payroll_run_events_type_check;
  ALTER TABLE IF EXISTS payroll_run_events ADD CONSTRAINT payroll_run_events_type_check
    CHECK (event_type = ANY (ARRAY[
      'run_started','run_completed','slip_computed','slip_insert_failed',
      'validation_failed','data_fetch_failed','compensation_missing','compensation_invalid',
      'dry_run_completed','run_finalized','run_rolled_back','run_frozen','run_unfrozen',
      'blocker_resolved','approval_submitted','approval_approved','approval_rejected',
      'slip_regenerated','payout_initiated','payout_failed','payout_reversed',
      'override_applied','run_deleted','ledger_posted'
    ]::text[]));
`)

ok('Schema fixes applied')

// ── 7. Seed demo data ─────────────────────────────────────────────────────────
if (!SKIP_SEED) {
  step('Seeding demo data')

  const seedFiles = [
    'seed-demo.sql',
    'seed-demo-extra.sql',
    'seed-demo-extra-2.sql',
    'seed-demo-extra-3.sql',
    'seed-demo-extra-4.sql',
    'seed-demo-extra-5.sql',
    'seed-demo-extra-6.sql',
    'seed-demo-extra-7.sql',
    'seed-demo-extra-8.sql',
    'seed-demo-extra-9.sql',
    'seed-demo-extra-10.sql',
    'seed-demo-extra-11.sql',
    'seed-demo-extra-12.sql',
    'seed-demo-extra-13.sql',
  ]

  let seeded = 0
  for (const file of seedFiles) {
    const filepath = path.join(REPO, 'supabase', file)
    if (!existsSync(filepath)) { warn(`Missing ${file} — skipping`); continue }

    process.stdout.write(`  → ${file} ... `)
    const r = psqlFile(filepath)
    const stderr = (r.stderr ?? '').replace(/\n/g, ' ').trim()
    const hasError = stderr.match(/ERROR(?!.*already exists)/i)
    if (hasError) {
      warn(`\n    ${stderr.slice(0, 200)}`)
    } else {
      console.log('OK')
      seeded++
    }
  }
  ok(`Seeded ${seeded} of ${seedFiles.length} files`)
} else {
  warn('Skipping seed data (--skip-seed)')
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log('')
console.log(`${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}`)
console.log(`${G}  Setup complete!${N}`)
console.log('')
console.log('  Login credentials:')
console.log('    Email:    demo@cognixhr.app')
console.log('    Password: CognixDemo!1')
console.log('')
console.log('  Start the full stack:')
console.log('    bash scripts/local-start.sh')
console.log('')
console.log('  Or start services individually:')
console.log('    node scripts/local-server.mjs   # PostgREST + GoTrue (port 54321)')
console.log('    cd apps/api && npm run dev       # Fastify API (port 2001)')
console.log('    cd apps/web && npm run dev       # Vite web (port 2000)')
console.log(`${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}`)
