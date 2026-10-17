/**
 * finding-fingerprint.mjs
 *
 * Stable, line-number-independent identity for a static-scan finding.
 *
 * check-tenant-isolation.mjs and check-unbounded-queries.mjs both key their
 * baseline entries as `${file}:${line}:${table}`. That key is NOT stable
 * under unrelated edits: any change that shifts line numbers in a file —
 * even one that has nothing to do with the finding itself — changes the key,
 * so --ratchet reports the finding as both "fixed" (the old line/key is
 * gone) and "new" (the same finding now appears at a different line/key).
 *
 * Verified concretely against this repo's own baseline: before any edit in
 * this remediation pass, scripts/unbounded-queries-baseline.json already
 * contained `apps/api/src/routes/attendance/anomalies.ts:141:employees`,
 * while a fresh scan reported `apps/api/src/routes/attendance/anomalies.ts:144:employees`
 * — the exact same finding, shifted 3 lines by an unrelated earlier edit to
 * that file. See docs/production-readiness/EVIDENCE.md.
 *
 * stableFingerprint() keys on the file, the table, and the NORMALIZED
 * query-chain snippet captured around the .from() call instead of the line
 * number. Whitespace/indentation differences are collapsed (so pure
 * reformatting elsewhere in the file, or moving the exact same query to a
 * different position, does not change the fingerprint); the snippet's actual
 * code content still fully determines it, so a genuinely different or newly
 * introduced unsafe query — different columns, different filters, different
 * table — gets a different fingerprint and is still caught.
 *
 * This is NOT wired into either checker's default --ratchet/--save-baseline
 * path. Swapping the production key requires regenerating both baseline
 * files under the new scheme, which changes what format
 * scripts/*-baseline.json is in — that is a decision for a human to make
 * explicitly, not something to flip silently. Pass --stable-key to either
 * checker to see its effect now, in isolation, before that decision is made.
 */

/**
 * @param {{ relPath: string, tableName: string, snippet: string }} finding
 * @returns {string}
 */
export function stableFingerprint({ relPath, tableName, snippet }) {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  return `${relPath}::${tableName}::${normalized}`
}
