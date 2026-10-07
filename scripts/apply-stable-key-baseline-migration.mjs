#!/usr/bin/env node
/**
 * apply-stable-key-baseline-migration.mjs — G08: completes the
 * exception-preserving stable-fingerprint migration that
 * migrate-baseline-to-stable-keys.mjs prepared as a proposal.
 *
 * What this does NOT do: `node check-*.mjs --save-baseline --stable-key`
 * against current HEAD. That would silently (a) drop any currently-known
 * finding whose nearest-line match the migration script could not confidently
 * make, and (b) accept any newly-introduced finding that happens to exist in
 * the codebase right now as "already known" — exactly the "regenerate to
 * hide findings" behaviour the standing instruction forbids.
 *
 * What this DOES do: takes the migration script's `keys` output —
 * EXCLUSIVELY the stable-key fingerprints of the 358 old baseline entries
 * (267+314 original, minus 223 unresolved) that could be confidently traced
 * forward to a still-existing current finding — as the new live baseline.
 * Every one of the 223 entries the migration script could NOT trace
 * (`unresolved`) has since been individually reconciled by hand, row by row,
 * in docs/production-readiness/baseline-reconciliation-223-rows.csv, and
 * EVERY one of those 223 was classified FIXED or MOVED_AND_FIXED — none
 * "still open" or "needs its own re-scan". This script re-verifies that
 * tally against the CSV before writing anything, and refuses to proceed if
 * it doesn't match (if the CSV has drifted, or a future entry is added
 * without being classified, this must fail loudly, not silently baseline
 * whatever is on disk).
 *
 * Net effect: the new live baseline accepts exactly the same set of
 * real-world findings the old one did (identified by stable content instead
 * of line number), no more, no less — it carries forward existing accepted
 * debt under a format immune to the line-shift instability documented in
 * scripts/lib/finding-fingerprint.mjs (ADD-004), without baselining a single
 * thing that wasn't already accepted.
 *
 * Usage: node scripts/apply-stable-key-baseline-migration.mjs [--write]
 *   (no flag) dry-run: prints what would change, writes nothing.
 *   --write   writes the new scripts/{unbounded-queries,tenant-isolation}-baseline.json
 *             (old line-keyed versions are preserved alongside as
 *             *.pre-stable-key.json for audit trail — never deleted).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

function readCsv(p) {
  const text = fs.readFileSync(p, 'utf8').trim()
  const [headerLine, ...lines] = text.split('\n')
  const headers = parseCsvLine(headerLine)
  return lines.map(line => {
    const cells = parseCsvLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = cells[i] })
    return row
  })
}

// Minimal RFC4180-ish CSV line parser — handles quoted fields with embedded commas.
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else cur += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

const REGISTERS = [
  {
    label:        'unbounded-queries',
    proposalPath: path.join(ROOT, 'scripts/unbounded-queries-baseline.stable-key.json'),
    livePath:     path.join(ROOT, 'scripts/unbounded-queries-baseline.json'),
  },
  {
    label:        'tenant-isolation',
    proposalPath: path.join(ROOT, 'scripts/tenant-isolation-baseline.stable-key.json'),
    livePath:     path.join(ROOT, 'scripts/tenant-isolation-baseline.json'),
  },
]

const csvRows = readCsv(path.join(ROOT, 'docs/production-readiness/baseline-reconciliation-223-rows.csv'))

let allOk = true

for (const reg of REGISTERS) {
  console.log(`\n=== ${reg.label} ===`)
  const proposal = readJson(reg.proposalPath)
  const csvForRegister = csvRows.filter(r => r.register === reg.label)

  console.log(`  proposal: original=${proposal.original_count} resolved=${proposal.resolved_count} unresolved=${proposal.unresolved_count}`)
  console.log(`  reconciliation CSV rows for this register: ${csvForRegister.length}`)

  if (csvForRegister.length !== proposal.unresolved_count) {
    console.error(`  ✗ MISMATCH: proposal has ${proposal.unresolved_count} unresolved entries but the CSV has ${csvForRegister.length} rows for '${reg.label}'. Refusing to proceed — reconcile the CSV before re-running.`)
    allOk = false
    continue
  }

  const badRows = csvForRegister.filter(r => r.final_classification !== 'FIXED' && r.final_classification !== 'MOVED_AND_FIXED')
  if (badRows.length > 0) {
    console.error(`  ✗ ${badRows.length} CSV row(s) for '${reg.label}' are classified neither FIXED nor MOVED_AND_FIXED — these represent findings that may STILL BE OPEN and must not be silently dropped from the baseline:`)
    for (const r of badRows.slice(0, 10)) console.error(`      entry=${r.entry} classification=${r.final_classification}`)
    allOk = false
    continue
  }

  console.log(`  ✓ all ${csvForRegister.length} unresolved entries reconciled as FIXED/MOVED_AND_FIXED — none still open, none skipped`)
  console.log(`  → new live baseline will carry forward ${proposal.keys.length} stable-key finding(s) (the resolved/matched set only)`)

  if (WRITE) {
    const preStableKeyPath = reg.livePath.replace(/\.json$/, '.pre-stable-key.json')
    if (!fs.existsSync(preStableKeyPath)) {
      fs.copyFileSync(reg.livePath, preStableKeyPath)
      console.log(`  archived old line-keyed baseline → ${path.relative(ROOT, preStableKeyPath)}`)
    } else {
      console.log(`  (old line-keyed baseline already archived at ${path.relative(ROOT, preStableKeyPath)} — leaving it)`)
    }
    const newBaseline = {
      generated: new Date().toISOString(),
      count:     proposal.keys.length,
      format:    'stable-key',
      keys:      [...proposal.keys].sort(),
      note:      `Migrated from the line-keyed baseline (G08). Carries forward exactly the ${proposal.resolved_count} previously-accepted findings that could be confidently traced to their current stable identity; the ${proposal.unresolved_count} that could not be traced were individually reconciled in docs/production-readiness/baseline-reconciliation-223-rows.csv and confirmed FIXED/MOVED_AND_FIXED, not carried forward. See scripts/apply-stable-key-baseline-migration.mjs and scripts/migrate-baseline-to-stable-keys.mjs for provenance.`,
    }
    fs.writeFileSync(reg.livePath, JSON.stringify(newBaseline, null, 2) + '\n')
    console.log(`  ✓ wrote new stable-key live baseline → ${path.relative(ROOT, reg.livePath)}`)
  }
}

if (!allOk) {
  console.error('\n✗ Migration NOT applied — see mismatches above.')
  process.exit(1)
}

if (!WRITE) {
  console.log('\nDry run complete — no files written. Re-run with --write to apply.')
} else {
  console.log('\n✓ Migration applied to both live baseline files.')
}
