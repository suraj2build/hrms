#!/usr/bin/env node
/**
 * Schema-drift guardrail.
 *
 * Why this exists: the HRMS API talks to a Supabase Postgres whose real shape is
 * the *partial* result of applying `supabase/migrations/*.sql` — some migrations
 * abort part-way (see KNOWN_FAILING below), so a naive "apply cleanly" rebuild
 * does NOT match production. This script reproduces production's state and then
 * checks that every column the API references actually exists.
 *
 * What it does:
 *   1. Applies every migration in order to the target Postgres, continue-on-error,
 *      recording which files fail. Fails the run if a migration that is NOT on the
 *      KNOWN_FAILING allowlist errors — i.e. it catches *new* migration breakage
 *      (the same class of bug that caused the original drift).
 *   2. Introspects information_schema.columns.
 *   3. Parses every Supabase query in apps/api/src (.select / .eq-style filters /
 *      .insert/.update/.upsert payloads) and asserts each referenced column exists
 *      on the table it is used against. Exits non-zero on any mismatch.
 *
 * Connection: standard libpq env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)
 * or PG via psql defaults. Designed to run against a throwaway database.
 *
 * Usage:  node scripts/db/check-schema-drift.mjs
 *         (set --skip-apply to reuse an already-migrated DB and only run the audit)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')
const API_SRC = path.join(ROOT, 'apps/api/src')
const SKIP_APPLY = process.argv.includes('--skip-apply')

// Migrations known to abort part-way against a clean DB. They define production's
// actual (partial) shape. A migration failing here is EXPECTED; anything else is
// new breakage and fails the build. Keep this list short and documented.
const KNOWN_FAILING = new Set([
  '015_rls_extended.sql',          // invalid `CREATE POLICY IF NOT EXISTS`
  '016_lean_employees.sql',        // manager_id drop blocked by dependency (drift source)
  '017_create_employee_with_job.sql', // superseded by 063
  '038_storage_buckets.sql',       // Supabase `storage` schema, not present in plain PG
  '068_leave_session_granularity.sql',
  '114_demo_data_cleanup.sql',
])

function psql(sql) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-tAqc', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// ── 1. apply migrations ──────────────────────────────────────────────────────
function applyMigrations() {
  // Supabase scaffolding (auth/storage/roles) the migrations assume exists.
  try {
    execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(path.dirname(fileURLToPath(import.meta.url)), 'bootstrap.sql')],
      { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    console.error(`✗ bootstrap.sql failed — ${(e.stderr?.toString() || e.message).trim()}`)
    process.exit(1)
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
  const unexpected = []
  for (const f of files) {
    try {
      execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(MIGRATIONS_DIR, f)],
        { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      const msg = (e.stderr?.toString() || e.message).trim().split('\n').slice(-1)[0]
      if (KNOWN_FAILING.has(f)) {
        console.log(`  · ${f} failed (known) — ${msg}`)
      } else {
        unexpected.push({ f, msg })
        console.error(`  ✗ ${f} failed (UNEXPECTED) — ${msg}`)
      }
    }
  }
  if (unexpected.length) {
    console.error(`\n✗ ${unexpected.length} migration(s) broke that aren't on the known-failing allowlist.`)
    console.error('  Fix the migration, or (if intentional) add it to KNOWN_FAILING with a reason.')
    process.exit(1)
  }
}

// ── 2. introspect schema ─────────────────────────────────────────────────────
function loadSchema() {
  const out = psql(
    "SELECT table_name||'|'||column_name FROM information_schema.columns " +
    "WHERE table_schema='public'")
  const schema = new Map()
  for (const line of out.trim().split('\n')) {
    const [t, c] = line.split('|'); if (!t || !c) continue
    if (!schema.has(t)) schema.set(t, new Set())
    schema.get(t).add(c.toLowerCase())
  }
  return schema
}

// Foreign-key graph as unordered table pairs — PostgREST resolves an embed
// `base.select('rel(...)')` only if an FK exists between base and rel either way.
function loadFKPairs() {
  const out = psql(
    "SELECT tc.table_name||'|'||ccu.table_name FROM information_schema.table_constraints tc " +
    "JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name " +
    "WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'")
  const fk = new Set()
  for (const line of out.trim().split('\n')) {
    const [a, b] = line.split('|'); if (!a || !b) continue
    fk.add(a + '|' + b); fk.add(b + '|' + a)
  }
  // FK constraint names — to validate `table!constraint_name(...)` embed hints
  fk.names = new Set(
    psql("SELECT conname FROM pg_constraint WHERE contype='f'").trim().split('\n').map(s => s.trim()).filter(Boolean))
  return fk
}

// ── 3. audit code against schema ─────────────────────────────────────────────
const FILTERS = ['eq','neq','gt','gte','lt','lte','like','ilike','is','in','order','match','contains','filter']
const issues = []
let FK = null   // FK pair set, populated in main

function listFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p))
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}
function endParen(src, i) {
  let d = 0, str = null, line = false, block = false
  for (; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1]
    if (line) { if (ch === '\n') line = false; continue }
    if (block) { if (ch === '*' && nx === '/') { block = false; i++ } continue }
    if (str) { if (ch === '\\') { i++; continue } if (ch === str) str = null; continue }
    if (ch === '/' && nx === '/') { line = true; i++; continue }
    if (ch === '/' && nx === '*') { block = true; i++; continue }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue }
    if (ch === '(') d++
    else if (ch === ')') { d--; if (d === 0) return i + 1 }
  }
  return i
}
const lineAt = (src, off) => src.slice(0, off).split('\n').length

function objKeys(obj) {
  const out = []; let d = 0, str = null, line = false, block = false, tok = '', expectKey = true
  for (let i = 0; i < obj.length; i++) {
    const ch = obj[i], nx = obj[i + 1]
    if (line) { if (ch === '\n') line = false; continue }
    if (block) { if (ch === '*' && nx === '/') { block = false; i++ } continue }
    if (str) { if (ch === '\\') { i++; continue } if (ch === str) str = null; continue }
    if (ch === '/' && nx === '/') { line = true; i++; continue }
    if (ch === '/' && nx === '*') { block = true; i++; continue }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') { d++; continue }
    if (ch === '}' || ch === ']' || ch === ')') { d--; continue }
    if (d !== 0) continue
    if (ch === ':') { if (expectKey) { out.push(tok.trim()); expectKey = false } tok = ''; continue }
    if (ch === ',') { tok = ''; expectKey = true; continue }
    if (expectKey) tok += ch
  }
  return out
}
// top-level comma split respecting parens (for .select strings)
function splitTop(s) {
  const out = []; let d = 0, cur = ''
  for (const ch of s) {
    if (ch === '(' ) { d++; cur += ch }
    else if (ch === ')') { d--; cur += ch }
    else if (ch === ',' && d === 0) { out.push(cur); cur = '' }
    else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

function checkCol(file, off, table, col, kind, src, schema) {
  if (!col || col.includes('.')) return
  const cols = schema.get(table); if (!cols) return
  if (!cols.has(col.toLowerCase()))
    issues.push({ file: file.replace(ROOT + '/', ''), line: lineAt(src, off), table, col: col.toLowerCase(), kind })
}

function checkSelect(file, off, table, arg, src, schema) {
  const m = arg.match(/^\s*[`'"]([\s\S]*?)[`'"]/); if (!m) return
  walkSelect(file, off, table, m[1], src, schema)
}

// Validate a select body against `table`: flat columns must exist; embedded
// relations `rel(inner)` must have an FK to `table` and their inner cols must
// exist on the embedded table (recursively).
function walkSelect(file, off, table, body, src, schema) {
  for (let tok of splitTop(body)) {
    tok = tok.trim(); if (!tok) continue
    const em = tok.match(/^(?:[a-z_]+\s*:\s*)?([a-z_]+)\s*(?:!\s*([a-z_!]+))?\s*\(([\s\S]*)\)$/i)
    if (em) {                                   // embedded relation
      const embed = em[1].toLowerCase(), hint = em[2] ? em[2].toLowerCase() : null, inner = em[3]
      const here = { file: file.replace(ROOT + '/', ''), line: lineAt(src, off), table }
      const baseCols = schema.get(table)
      // PostgREST lets you name the FK *column* as the embed (e.g. assigned_to(...))
      // — valid; we just can't resolve the target table, so skip inner checks.
      if (!schema.has(embed)) {
        if (!(baseCols && baseCols.has(embed)))
          issues.push({ ...here, col: `→ ${embed} (no table/relationship)`, kind: 'embed-rel' })
        continue
      }
      // A hint is either a column on the base (disambiguation) or an FK constraint name.
      if (hint && hint !== 'inner' && hint !== 'left' &&
          !(baseCols && baseCols.has(hint)) && FK?.names && !FK.names.has(hint)) {
        issues.push({ ...here, col: `→ ${embed}!${hint} (no such column/FK)`, kind: 'embed-rel' }); continue
      }
      if (FK && !FK.has(table + '|' + embed)) {
        issues.push({ ...here, col: `→ ${embed} (no FK relationship)`, kind: 'embed-rel' }); continue
      }
      walkSelect(file, off, embed, inner, src, schema)   // recurse into the embed
      continue
    }
    if (tok.includes('(')) continue
    if (tok === '*' || tok.startsWith('count')) continue
    let col = tok.includes(':') ? tok.split(':').pop().trim() : tok
    col = col.replace(/->.*/, '').replace(/::.*/, '').trim()
    if (/^[a-z_][a-z0-9_]*$/i.test(col)) checkCol(file, off, table, col, 'select', src, schema)
  }
}

function handleCall(file, callOff, table, name, args, src, schema) {
  if (name === 'select') { checkSelect(file, callOff, table, args, src, schema); return }
  if (FILTERS.includes(name)) {
    const m = args.match(/^\s*'([a-zA-Z0-9_.]+)'/); if (m) checkCol(file, callOff, table, m[1], 'filter:' + name, src, schema); return
  }
  if (name === 'insert' || name === 'update' || name === 'upsert') {
    // Only the FIRST argument is the payload. The first '{' must precede the first
    // top-level comma; otherwise the payload is a variable and the '{' we'd find is
    // the options object (e.g. .upsert(rows, { onConflict })) — skip it.
    let k = -1, depth = 0, str = null, ln = false, blk = false, commaPos = -1
    for (let i = 0; i < args.length; i++) {
      const ch = args[i], nx = args[i + 1]
      if (ln) { if (ch === '\n') ln = false; continue }
      if (blk) { if (ch === '*' && nx === '/') { blk = false; i++ } continue }
      if (str) { if (ch === '\\') { i++; continue } if (ch === str) str = null; continue }
      if (ch === '/' && nx === '/') { ln = true; i++; continue }
      if (ch === '/' && nx === '*') { blk = true; i++; continue }
      if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue }
      if (ch === '{' && k < 0) { k = i }
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
      else if (ch === ',' && depth === 0) { commaPos = i; break }
    }
    if (k < 0 || (commaPos >= 0 && k > commaPos)) return
    let d = 0, s2 = null, line = false, block = false, end = -1
    for (let i = k; i < args.length; i++) {
      const ch = args[i], nx = args[i + 1]
      if (line) { if (ch === '\n') line = false; continue }
      if (block) { if (ch === '*' && nx === '/') { block = false; i++ } continue }
      if (s2) { if (ch === '\\') { i++; continue } if (ch === s2) s2 = null; continue }
      if (ch === '/' && nx === '/') { line = true; i++; continue }
      if (ch === '/' && nx === '*') { block = true; i++; continue }
      if (ch === '"' || ch === "'" || ch === '`') { s2 = ch; continue }
      if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) { end = i; break } }
    }
    if (end < 0) return
    for (let raw of objKeys(args.slice(k + 1, end))) {
      raw = raw.trim(); if (!raw || raw.startsWith('...')) continue
      const kk = (raw.match(/^['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?$/) || [])[1]
      if (kk) checkCol(file, callOff, table, kk, name, src, schema)
    }
  }
}

function auditFile(file, schema) {
  const src = fs.readFileSync(file, 'utf8')
  const reFrom = /\.from\(\s*'([a-z0-9_]+)'\s*\)/g
  let m
  while ((m = reFrom.exec(src))) {
    const table = m[1].toLowerCase()
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    const pre = src.slice(lineStart, m.index)
    let bvar = null
    const am = pre.match(/(?:^|;)\s*(?:let|const|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*[^=]*$/)
    if (am && !pre.includes('{')) bvar = am[1]
    let i = m.index + m[0].length
    while (true) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src[i] !== '.') break
      const mm = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i)); if (!mm) break
      const name = mm[1], pOpen = i + mm[0].length - 1, pEnd = endParen(src, pOpen)
      handleCall(file, i, table, name, src.slice(pOpen + 1, pEnd - 1), src, schema)
      i = pEnd
    }
    if (bvar) {
      const reUse = new RegExp(`(?<![\\w$])${bvar}\\s*\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'); reUse.lastIndex = i
      const boundary = src.slice(i).search(/fastify\.(get|post|put|patch|delete)\(|\n\s*(async\s*\()/)
      const end = boundary < 0 ? src.length : i + boundary
      let u
      while ((u = reUse.exec(src)) && u.index < end) {
        const name = u[1]; if (name === 'from') break
        const realOpen = src.indexOf('(', u.index), pEnd = endParen(src, realOpen)
        if (FILTERS.includes(name) || ['insert','update','upsert','select'].includes(name))
          handleCall(file, u.index, table, name, src.slice(realOpen + 1, pEnd - 1), src, schema)
      }
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
if (!SKIP_APPLY) { console.log('Applying migrations…'); applyMigrations() }
console.log('Introspecting schema…')
const schema = loadSchema()
FK = loadFKPairs()
console.log(`  ${schema.size} tables`)
console.log('Auditing apps/api/src + seed script against schema…')
const targets = listFiles(API_SRC)
const seed = path.join(ROOT, 'scripts/seed-demo.ts')
if (fs.existsSync(seed)) targets.push(seed)
for (const f of targets) auditFile(f, schema)

// dedupe
const seen = new Set(), out = []
for (const i of issues) { const k = `${i.file}:${i.line}:${i.table}:${i.col}:${i.kind}`; if (!seen.has(k)) { seen.add(k); out.push(i) } }

if (out.length === 0) {
  console.log('\n✓ No schema drift: every referenced column exists.')
  process.exit(0)
}
console.error(`\n✗ ${out.length} column reference(s) not found in the schema:\n`)
for (const i of out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
  console.error(`  ${(i.table + '.' + i.col).padEnd(46)} [${i.kind}] ${i.file}:${i.line}`)
process.exit(1)
