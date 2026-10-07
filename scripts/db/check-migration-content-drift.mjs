#!/usr/bin/env node
/**
 * Migration content-drift check.
 *
 * Why this exists: `supabase_migrations.schema_migrations` having a row for
 * version X only proves something recorded as "250_notification_
 * preferences.sql" was applied once -- it does not prove the CURRENT
 * contents of that file are what actually ran. A migration file edited
 * after being applied (a typo fix, a column type change, anything) would
 * still show that version as "present" in a presence-only check, while the
 * staging database's actual schema reflects the OLD content, not the
 * current one.
 *
 * Supabase CLI's `db push` records the exact applied SQL statements in
 * schema_migrations.statements (confirmed empirically against a real
 * `supabase db push` run, not assumed from docs). This script compares
 * that recorded text against the current migration file, normalized
 * (comments and semicolons stripped, whitespace collapsed) so formatting-
 * only edits don't false-positive, and reports any migration whose
 * semantic content has actually changed since it was applied.
 *
 * Connection: standard libpq env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/
 * PGDATABASE), same as scripts/db/check-schema-drift.mjs.
 *
 * Usage: node scripts/db/check-migration-content-drift.mjs
 * Exit 0: every applied migration's recorded content matches its current
 *         file (or no supabase_migrations table / no rows -- nothing to
 *         compare, not a failure of this check itself).
 * Exit 1: at least one applied migration's file has been edited since.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')

function psql(sql) {
  // maxBuffer: the full-history query below returns every migration file's
  // raw content in one JSON blob (tens of MB across 400+ files) -- the
  // default 1MB Node buffer throws ENOBUFS on a real repo this size.
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-tAqc', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 200,
  })
}

// A naive regex-based comment/semicolon strip is unsafe for SQL: `--` or `;`
// occurring INSIDE a string literal is real data, not a comment or statement
// separator, and blindly stripping it can make two genuinely different
// migrations normalize to the same text. Confirmed empirically before
// writing this (both were real, not hypothetical):
//   VALUES ('safe--value-A')  vs  VALUES ('safe--value-B')
//   -> both collapsed to the same string under a plain `/--.*$/` strip.
//   VALUES ('alpha;beta')     vs  VALUES ('alpha beta')
//   -> both collapsed to the same string under a plain global `;` -> ' '.
// This scans character by character and only treats `--`/`/* */` as
// comments and `;` as a statement separator OUTSIDE single-quoted strings
// ('...', with '' as the escaped quote), double-quoted identifiers ("...",
// same escaping), and Postgres dollar-quoted strings ($tag$...$tag$,
// including the bare $$...$$ form actually used in this repo's plpgsql
// functions) -- content inside any of those is copied through untouched,
// including any `--`, `;` or `/*` it contains.
// Known accepted limitation: whitespace WITHIN a string literal is still
// collapsed by the final whitespace-collapse pass (e.g. 'a  b' and 'a b'
// normalize equal) -- correctness there would need full SQL literal
// parsing, out of proportion to what this check needs. Comments and
// statement-separator semicolons were the concrete, demonstrated risks and
// are what this fixes.
function normalize(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const two = text.slice(i, i + 2)
    if (ch === "'" || ch === '"') {
      const quote = ch
      let j = i + 1
      out += ch
      while (j < n) {
        if (text[j] === quote) {
          if (text[j + 1] === quote) { out += quote + quote; j += 2; continue }
          out += quote; j++; break
        }
        out += text[j]; j++
      }
      i = j
      continue
    }
    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(text.slice(i))
      if (tagMatch) {
        const tag = tagMatch[0]
        const end = text.indexOf(tag, i + tag.length)
        const stop = end === -1 ? n : end + tag.length
        out += text.slice(i, stop)
        i = stop
        continue
      }
    }
    if (two === '--') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    out += ch === ';' ? ' ' : ch
    i++
  }
  return out.replace(/\s+/g, ' ').trim()
}

const tableExists = psql(
  "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL",
).trim()
if (tableExists !== 't') {
  console.log('(skipped — supabase_migrations.schema_migrations does not exist on this database)')
  process.exit(0)
}

const rowsJson = psql(
  "SELECT coalesce(json_agg(json_build_object('version', version, 'name', name, 'statements', statements)), '[]') " +
  'FROM supabase_migrations.schema_migrations',
)
const rows = JSON.parse(rowsJson)
if (rows.length === 0) {
  console.log('(no applied migrations recorded — nothing to compare)')
  process.exit(0)
}

const localFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
const changed = []
const unverifiable = []
for (const row of rows) {
  const match = localFiles.find((f) => f.startsWith(row.version + '_'))
  if (!match) continue // covered separately by the full-history presence check
  // A NULL/missing statements value is NOT evidence the file is unchanged --
  // it means there is no recorded baseline to compare against at all. Report
  // this distinctly from a confirmed content mismatch: both fail the check
  // (neither is silently treated as a pass), but "we have no record" and
  // "the record disagrees with the file" are different findings and this
  // script must not blur them into one claim.
  if (row.statements == null || row.statements.length === 0) {
    unverifiable.push(match)
    continue
  }
  const fileContent = fs.readFileSync(path.join(MIGRATIONS_DIR, match), 'utf8')
  const recorded = normalize(row.statements.join(' '))
  const current = normalize(fileContent)
  if (recorded !== current) changed.push(match)
}

if (unverifiable.length > 0) {
  console.error(`✗ ${unverifiable.length} applied migration(s) have no recorded statements to compare against — content cannot be verified, so this does NOT count as a pass:`)
  for (const f of unverifiable) console.error(`  - ${f}`)
}
if (changed.length > 0) {
  console.error(`✗ ${changed.length} applied migration(s) have been edited since they ran — the staging schema reflects the OLD content, not the current file:`)
  for (const f of changed) console.error(`  - ${f}`)
}
if (unverifiable.length > 0 || changed.length > 0) process.exit(1)
console.log(`✓ All ${rows.length} applied migration(s) match their recorded content — no post-apply edits detected.`)
