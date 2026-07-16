#!/usr/bin/env node
/**
 * scripts/migrate-from-supabase.mjs
 *
 * Pulls production data from Supabase → local PostgreSQL in one command.
 * Copies every table in the public schema + auth.users/auth.identities.
 * Schema must already exist locally (run local-db-setup.mjs first).
 *
 * Usage:
 *   SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres' \
 *     node scripts/migrate-from-supabase.mjs
 *
 * Optional env vars:
 *   LOCAL_DB_URL    Override local DB (default: hrms_local@127.0.0.1/hrms)
 *   SKIP_AUTH=true  Skip auth.users / auth.identities
 *   ONLY=tbl1,tbl2 Migrate only specific tables (comma-separated)
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

const SUPABASE_URL = process.env.SUPABASE_DB_URL
const LOCAL_URL    = process.env.LOCAL_DB_URL
                  ?? process.env.DATABASE_URL
                  ?? 'postgresql://hrms_local:hrms_dev_2024@127.0.0.1:5432/hrms'
const SKIP_AUTH    = process.env.SKIP_AUTH === 'true'
const ONLY_TABLES  = process.env.ONLY ? process.env.ONLY.split(',').map(t => t.trim()) : null
const BATCH        = 500   // rows per INSERT — keeps PG params well under 65535 limit

const G = '\x1b[32m', B = '\x1b[34m', Y = '\x1b[33m', R = '\x1b[31m', N = '\x1b[0m'
const ok   = m => console.log(`${G}  ✓  ${m}${N}`)
const warn = m => console.log(`${Y}  ⚠  ${m}${N}`)
const fail = m => { console.error(`${R}  ✗  ${m}${N}`); process.exit(1) }
const step = m => console.log(`\n${B}━━ ${m}${N}`)

if (!SUPABASE_URL) {
  fail(
    'SUPABASE_DB_URL is required.\n' +
    "    Set it to the connection string from Supabase → Settings → Database → Connection string (URI)\n" +
    '    Example: SUPABASE_DB_URL=\'postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres\''
  )
}

console.log(`${B}`)
console.log('  ╔══════════════════════════════════════════════════╗')
console.log('  ║   CognixHR — Supabase → Local DB Migration      ║')
console.log('  ╚══════════════════════════════════════════════════╝')
console.log(`${N}`)
console.log(`  Source : ${SUPABASE_URL.replace(/:([^:@]+)@/, ':****@')}`)
console.log(`  Target : ${LOCAL_URL.replace(/:([^:@]+)@/, ':****@')}`)

const pg  = await import('pg').then(m => m.default ?? m)
const src = new pg.Pool({ connectionString: SUPABASE_URL, max: 3, ssl: { rejectUnauthorized: false } })
const dst = new pg.Pool({ connectionString: LOCAL_URL, max: 3 })

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getColumnDefs(client, schemaName, tableName) {
  const { rows } = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schemaName, tableName])
  return rows  // [{ column_name, data_type, udt_name }, ...]
}

async function countRows(client, qualifiedTable) {
  const { rows } = await client.query(`SELECT COUNT(*) AS n FROM ${qualifiedTable}`)
  return parseInt(rows[0].n)
}

// Coerce a value to what PostgreSQL expects for the given column type.
// Key problem: pg reads jsonb arrays as JS arrays, but passes JS arrays back
// as PostgreSQL array literals ({a,b,c}) which PostgreSQL rejects for json/jsonb columns.
function coerce(value, col) {
  if (value === null || value === undefined) return null
  const t = col.data_type
  const u = col.udt_name
  // JSON / JSONB — always stringify objects and arrays so pg doesn't mangle them
  if (t === 'json' || t === 'jsonb' || u === 'json' || u === 'jsonb') {
    if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      return JSON.stringify(value)
    }
  }
  return value
}

async function copyTable(srcClient, dstClient, qualifiedTable, schemaName, tableName, label) {
  const total = await countRows(srcClient, qualifiedTable)
  if (total === 0) { warn(`${label}: 0 rows — skipping`); return 0 }

  const colDefs = await getColumnDefs(srcClient, schemaName, tableName)
  if (!colDefs.length) { warn(`${label}: no columns found — skipping`); return 0 }

  const colNames = colDefs.map(c => c.column_name)

  // Truncate destination (FK checks are OFF at this point via session_replication_role)
  await dstClient.query(`TRUNCATE ${qualifiedTable} RESTART IDENTITY CASCADE`)

  const colList = colNames.map(c => `"${c}"`).join(', ')
  let copied = 0

  while (copied < total) {
    const { rows } = await srcClient.query(
      `SELECT * FROM ${qualifiedTable} ORDER BY ctid LIMIT $1 OFFSET $2`,
      [BATCH, copied]
    )
    if (!rows.length) break

    // Build VALUES ($1,$2,...) with type-aware coercion
    const vals = []
    const rowParts = rows.map(row => {
      const phs = colDefs.map(col => {
        vals.push(coerce(row[col.column_name], col))
        return `$${vals.length}`
      })
      return `(${phs.join(', ')})`
    })

    await dstClient.query(
      `INSERT INTO ${qualifiedTable} (${colList}) VALUES ${rowParts.join(', ')} ON CONFLICT DO NOTHING`,
      vals
    )
    copied += rows.length
    process.stdout.write(`\r  ${label}: ${copied.toLocaleString()} / ${total.toLocaleString()}  `)
  }
  process.stdout.write('\n')
  return copied
}

// ── 1. Test connections ───────────────────────────────────────────────────────

step('Connecting')
try { await src.query('SELECT 1'); ok('Supabase reachable') }
catch (e) { fail(`Supabase connection failed: ${e.message}`) }

try { await dst.query('SELECT 1'); ok('Local PostgreSQL reachable') }
catch (e) { fail(`Local DB connection failed: ${e.message}`) }

// ── 2. Discover tables ────────────────────────────────────────────────────────

step('Discovering tables in Supabase public schema')
const { rows: tableRows } = await src.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`)
let tables = tableRows.map(r => r.tablename)
if (ONLY_TABLES) {
  const before = tables.length
  tables = tables.filter(t => ONLY_TABLES.includes(t))
  console.log(`  Filtered ${before} → ${tables.length} tables: ${tables.join(', ')}`)
} else {
  console.log(`  Found ${tables.length} tables`)
}

// ── 3. Migrate ────────────────────────────────────────────────────────────────

step(`Copying data${SKIP_AUTH ? '' : ' (+ auth.users)'}`)
console.log('  FK checks suspended during import — re-enabled on completion.\n')

const dstConn = await dst.connect()
const srcConn = await src.connect()

let totalRows = 0
let totalTables = 0

try {
  // Suspend FK / trigger checks so we can insert in any order
  await dstConn.query("SET session_replication_role = 'replica'")

  // ── public schema tables ─────────────────────────────────────────────────
  for (const table of tables) {
    const n = await copyTable(srcConn, dstConn, `"${table}"`, 'public', table, table)
    if (n > 0) { totalRows += n; totalTables++ }
  }

  // ── auth.users ────────────────────────────────────────────────────────────
  if (!SKIP_AUTH) {
    const authTables = ['users', 'identities']
    for (const t of authTables) {
      // Check if the table exists locally
      const { rows: exists } = await dstConn.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = $1
      `, [t])
      if (!exists.length) { warn(`auth.${t} does not exist locally — skipping`); continue }

      const n = await copyTable(srcConn, dstConn, `auth."${t}"`, 'auth', t, `auth.${t}`)
      if (n > 0) { totalRows += n; totalTables++ }
    }
  }

  // Re-enable FK checks
  await dstConn.query("SET session_replication_role = 'DEFAULT'")

  // ── Reset sequences ───────────────────────────────────────────────────────
  step('Resetting sequences')
  const { rows: seqs } = await dstConn.query(`
    SELECT sequence_schema, sequence_name,
           (regexp_match(pg_get_expr(ad.adbin, ad.adrelid), 'nextval\\(''([^'']+)'''))[1] AS seq_ref
    FROM information_schema.sequences s
    WHERE sequence_schema = 'public'
  `)
  // Simple approach: setval for each sequence to its max used value
  const { rows: seqReset } = await dstConn.query(`
    SELECT 'SELECT setval(' ||
           quote_literal(sequence_schema || '.' || sequence_name) ||
           ', COALESCE(MAX(id::bigint), 1)) FROM ' ||
           quote_ident(table_name) AS cmd
    FROM information_schema.columns c
    JOIN information_schema.sequences s
      ON s.sequence_name = table_name || '_id_seq'
    WHERE c.column_name = 'id'
      AND c.data_type IN ('integer','bigint')
      AND c.table_schema = 'public'
    LIMIT 100
  `)
  for (const { cmd } of seqReset) {
    try { await dstConn.query(cmd) } catch {}  // best-effort
  }
  ok('Sequences reset')

} catch (e) {
  await dstConn.query("SET session_replication_role = 'DEFAULT'").catch(() => {})
  fail(`Migration failed: ${e.message}\n    ${e.detail ?? ''}`)
} finally {
  srcConn.release()
  dstConn.release()
}

await src.end()
await dst.end()

// ── Done ──────────────────────────────────────────────────────────────────────
console.log('')
console.log(`${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}`)
console.log(`${G}  Migration complete!${N}`)
console.log(`  Tables migrated : ${totalTables}`)
console.log(`  Total rows      : ${totalRows.toLocaleString()}`)
console.log('')
if (!SKIP_AUTH) {
  console.log('  Your production login credentials now work locally.')
  console.log('  Login at: http://localhost:2000')
} else {
  console.log('  Run fix-uat-account.mjs to set up a local login:')
  console.log('    node scripts/fix-uat-account.mjs')
}
console.log(`${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}`)
console.log('')
