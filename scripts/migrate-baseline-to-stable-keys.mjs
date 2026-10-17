#!/usr/bin/env node
/**
 * migrate-baseline-to-stable-keys.mjs
 *
 * Prepares (does NOT apply) a traceable, exception-preserving conversion of
 * both frozen baseline files from the old line-keyed format
 * (`${file}:${line}:${table}`) to the new stable-key format
 * (`stableFingerprint()`, see scripts/lib/finding-fingerprint.mjs).
 *
 * Why this is NOT "run --save-baseline --stable-key against HEAD": that
 * would regenerate the baseline from a FRESH scan, silently dropping any
 * finding whose line moved far enough to look unrelated and silently
 * adding any newly-introduced one — exactly the "regenerate to hide
 * findings" the standing instruction forbids. This script instead traces
 * EVERY existing baseline entry forward to its current position and
 * reports, per entry, whether that trace is confident or needs a human:
 * nothing is silently dropped, nothing is silently added.
 *
 * An earlier version of this script tried to reproduce the EXACT historical
 * commit the baseline was generated from and diff key sets 1:1. That
 * approach was tried and abandoned here, not silently replaced: it failed
 * verification (263 of 267 unbounded-queries keys unreproducible) because
 * the baseline's own line numbers are already stale relative to EVERY
 * commit in this repo's history, not just current HEAD — confirmed by
 * EVIDENCE.md section 2's anomalies.ts example (baseline says line 141;
 * even the commit that the baseline file was committed in shows line 144
 * for the same finding). There is no git commit whose tree matches the
 * baseline's line numbers, so "find the right historical commit" is not a
 * solvable problem — the baseline must have been generated from an
 * uncommitted working-tree state at some point, then committed later
 * without being regenerated to match.
 *
 * Algorithm (per checker, run against CURRENT HEAD — the only tree that
 * actually exists to scan):
 *   1. Run today's live scan -> currentFindings (relPath, tableName,
 *      lineNum, snippet).
 *   2. Group currentFindings by (relPath, tableName).
 *   3. For each baseline key (old file:line:table), look in that group:
 *        - an entry at the EXACT same line -> confidence "exact"
 *        - else the nearest not-yet-consumed entry in that group ->
 *          confidence "nearest" (greedy bipartite matching, processed in
 *          ascending original-line order so closer old entries claim their
 *          nearest current entry first)
 *        - else (group empty / fully consumed) -> UNRESOLVED: likely fixed
 *          or the table/file changed; listed explicitly, not silently
 *          dropped and not silently counted as still-open.
 *   4. Compute stableFingerprint() from whichever current finding was
 *      matched. Record the old-key -> new-key mapping with its confidence.
 *   5. Detect duplicate-query collisions: two different old keys resolving
 *      to the same new key (e.g. two copy-pasted identical query chains in
 *      the same file) — reported explicitly, never silently merged.
 *
 * Output (written under scripts/, never overwriting the live baseline):
 *   scripts/tenant-isolation-baseline.stable-key.json
 *   scripts/unbounded-queries-baseline.stable-key.json
 *   Each has { generated, count, original_count, keys, mapping (old -> new
 *   key + confidence), unresolved (old keys with no current match),
 *   duplicates }. These are proposals for human review. Flipping either
 *   checker's default ratchet/save-baseline to --stable-key and replacing
 *   the live baseline with one of these (after resolving every
 *   `unresolved` entry by hand) is the one-time migration left for
 *   explicit human sign-off per docs/production-readiness/STATUS.md.
 *
 * Usage: node scripts/migrate-baseline-to-stable-keys.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkFile as checkUnbounded, walkTs as walkUnbounded } from './lib/unbounded-query-scan.mjs'
import { checkFile as checkTenantIso, walkTs as walkTenantIso } from './lib/tenant-isolation-scan.mjs'
import { stableFingerprint } from './lib/finding-fingerprint.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseOldKey(key) {
  const lastColon = key.lastIndexOf(':')
  const secondLastColon = key.lastIndexOf(':', lastColon - 1)
  return {
    relPath: key.slice(0, secondLastColon),
    lineNum: Number(key.slice(secondLastColon + 1, lastColon)),
    tableName: key.slice(lastColon + 1),
  }
}

function migrateOne({ label, baselinePath, checkFile, walkTs, scanDirs }) {
  console.log(`\n=== ${label} ===`)

  const currentFindings = scanDirs.flatMap(dir => [...walkTs(dir)]).flatMap(f => checkFile(f, ROOT))

  // Group current findings by "relPath::tableName" -> sorted-by-line array
  const groups = new Map()
  for (const f of currentFindings) {
    const gk = `${f.relPath}::${f.tableName}`
    if (!groups.has(gk)) groups.set(gk, [])
    groups.get(gk).push(f)
  }
  for (const arr of groups.values()) arr.sort((a, b) => a.lineNum - b.lineNum)

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const oldKeys = [...baseline.keys].sort((a, b) => parseOldKey(a).lineNum - parseOldKey(b).lineNum)

  const mapping = {}      // oldKey -> { newKey, confidence, currentLine }
  const unresolved = []   // oldKey, no current match available

  for (const oldKey of oldKeys) {
    const { relPath, lineNum, tableName } = parseOldKey(oldKey)
    const gk = `${relPath}::${tableName}`
    const candidates = groups.get(gk) ?? []

    if (candidates.length === 0) {
      unresolved.push(oldKey)
      continue
    }

    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < candidates.length; i++) {
      const dist = Math.abs(candidates[i].lineNum - lineNum)
      if (dist < bestDist) { bestDist = dist; bestIdx = i }
    }

    const match = candidates.splice(bestIdx, 1)[0]
    mapping[oldKey] = {
      newKey:      stableFingerprint(match),
      confidence:  bestDist === 0 ? 'exact' : 'nearest',
      currentLine: match.lineNum,
      lineDelta:   match.lineNum - lineNum,
    }
  }

  // ── Duplicate-query collision detection ──────────────────────────────────
  const newKeyToOldKeys = new Map()
  for (const [oldKey, m] of Object.entries(mapping)) {
    if (!newKeyToOldKeys.has(m.newKey)) newKeyToOldKeys.set(m.newKey, [])
    newKeyToOldKeys.get(m.newKey).push(oldKey)
  }
  const duplicates = [...newKeyToOldKeys.entries()]
    .filter(([, olds]) => olds.length > 1)
    .map(([newKey, olds]) => ({ newKey, oldKeys: olds }))

  const exactCount   = Object.values(mapping).filter(m => m.confidence === 'exact').length
  const nearestCount = Object.values(mapping).filter(m => m.confidence === 'nearest').length

  console.log(`  original baseline: ${oldKeys.length} findings`)
  console.log(`  ✓ resolved exact (same line):    ${exactCount}`)
  console.log(`  ⚠ resolved nearest (line drift):  ${nearestCount}`)
  console.log(`  ✗ unresolved (no current match):  ${unresolved.length} — needs manual reconciliation, NOT auto-counted as fixed or open`)
  if (duplicates.length) {
    console.log(`  ⚠ ${duplicates.length} duplicate-query collision(s) — two+ old keys share one new stable key:`)
    for (const d of duplicates) {
      console.log(`    ${d.newKey}`)
      for (const ok of d.oldKeys) console.log(`      <- ${ok} (${mapping[ok].confidence}, Δline=${mapping[ok].lineDelta})`)
    }
  } else {
    console.log('  ✓ no duplicate-query collisions among resolved entries')
  }
  if (unresolved.length) {
    console.log(`  Unresolved keys (first 10 of ${unresolved.length}):`)
    for (const k of unresolved.slice(0, 10)) console.log(`    ${k}`)
  }

  const out = {
    generated:      new Date().toISOString(),
    note:           'Proposal only — not wired into any checker default. Every `unresolved` entry needs manual reconciliation before this can replace the live baseline. See script header comment.',
    original_count: oldKeys.length,
    resolved_count: Object.keys(mapping).length,
    unresolved_count: unresolved.length,
    keys:           [...new Set(Object.values(mapping).map(m => m.newKey))],
    mapping,
    unresolved,
    duplicates,
  }
  const outPath = baselinePath.replace(/\.json$/, '.stable-key.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
  console.log(`  → wrote ${path.relative(ROOT, outPath)}`)

  return { ok: true, unresolvedCount: unresolved.length, duplicateCount: duplicates.length }
}

const results = [
  migrateOne({
    label:        'unbounded-queries-baseline.json',
    baselinePath: path.join(ROOT, 'scripts/unbounded-queries-baseline.json'),
    checkFile:    checkUnbounded,
    walkTs:       walkUnbounded,
    scanDirs:     [path.join(ROOT, 'apps/api/src/routes'), path.join(ROOT, 'apps/api/src/lib')],
  }),
  migrateOne({
    label:        'tenant-isolation-baseline.json',
    baselinePath: path.join(ROOT, 'scripts/tenant-isolation-baseline.json'),
    checkFile:    checkTenantIso,
    walkTs:       walkTenantIso,
    scanDirs:     [path.join(ROOT, 'apps/api/src/routes'), path.join(ROOT, 'apps/api/src/lib')],
  }),
]

const totalUnresolved = results.reduce((s, r) => s + r.unresolvedCount, 0)
const totalDuplicates = results.reduce((s, r) => s + r.duplicateCount, 0)
console.log(`\n${totalUnresolved} total unresolved entries, ${totalDuplicates} total duplicate-query collisions across both files.`)
console.log('Review scripts/*-baseline.stable-key.json — every `unresolved` entry needs a human decision (confirmed fixed? renamed/moved? needs its own re-scan?) before either file can replace the live baseline.')
