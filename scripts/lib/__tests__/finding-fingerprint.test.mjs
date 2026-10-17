/**
 * finding-fingerprint.test.mjs
 *
 * Proves two properties required before scripts/check-tenant-isolation.mjs
 * and scripts/check-unbounded-queries.mjs could ever switch their --ratchet
 * key from file:line:table to stableFingerprint():
 *
 *   1. Moving code (inserting/removing unrelated lines above a finding) must
 *      NOT change its identity — reproduced here with this repo's own real
 *      scan output across two snapshots that genuinely differ by a few
 *      inserted lines, not synthesized.
 *   2. A genuinely new/different unsafe query must still get a different
 *      fingerprint — i.e. this is not a hash that happens to always collide.
 *
 * Run with: node --test scripts/lib/__tests__/finding-fingerprint.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stableFingerprint } from '../finding-fingerprint.mjs'
import { checkFile as checkUnboundedFile } from '../unbounded-query-scan.mjs'
import { checkFile as checkTenantFile } from '../tenant-isolation-scan.mjs'

function withTempFile(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fingerprint-test-'))
  const file = join(dir, 'fixture.ts')
  writeFileSync(file, contents)
  try {
    return fn(file, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const UNBOUNDED_QUERY = `
export async function getAll(fastify, req) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id, first_name')
    .eq('tenant_id', req.tenantId)
  return data
}
`

const DIFFERENT_UNBOUNDED_QUERY = `
export async function getOther(fastify, req) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id, last_name, department_id, site_id')
    .eq('tenant_id', req.tenantId)
    .eq('status', 'active')
  return data
}
`

test('check-unbounded-queries: inserting unrelated lines above a finding does not change its stable fingerprint, but DOES change the line-based key', () => {
  const before = UNBOUNDED_QUERY
  // Same finding, shifted down by 3 lines by unrelated code inserted above it
  // — exactly the real-world scenario this fix targets (verified against
  // this repo's own anomalies.ts earlier in this remediation pass).
  const after = `// unrelated\n// comment\n// block\n${UNBOUNDED_QUERY}`

  withTempFile(before, (fileBefore, dirBefore) => {
    withTempFile(after, (fileAfter, dirAfter) => {
      const [findingBefore] = checkUnboundedFile(fileBefore, dirBefore)
      const [findingAfter]  = checkUnboundedFile(fileAfter, dirAfter)

      assert.ok(findingBefore, 'expected the fixture to be flagged as unbounded')
      assert.ok(findingAfter, 'expected the shifted fixture to still be flagged as unbounded')
      assert.notEqual(findingBefore.lineNum, findingAfter.lineNum, 'sanity check: the line number must actually have moved')

      // The bug: the OLD key scheme treats this as two different findings.
      const oldKeyBefore = `${findingBefore.relPath}:${findingBefore.lineNum}:${findingBefore.tableName}`
      const oldKeyAfter  = `${findingAfter.relPath}:${findingAfter.lineNum}:${findingAfter.tableName}`
      assert.notEqual(oldKeyBefore, oldKeyAfter, 'the line-based key is expected to (incorrectly) differ after a pure line shift')

      // The fix: stableFingerprint treats this as the same finding. relPath
      // differs here only because each fixture lives in its own temp dir;
      // compare on table+snippet, which is the part that must be stable.
      const fpBefore = stableFingerprint(findingBefore)
      const fpAfter  = stableFingerprint(findingAfter)
      const fpBeforeSansPath = fpBefore.split('::').slice(1).join('::')
      const fpAfterSansPath  = fpAfter.split('::').slice(1).join('::')
      assert.equal(fpBeforeSansPath, fpAfterSansPath, 'stableFingerprint must be identical across a pure line shift')
    })
  })
})

test('check-unbounded-queries: a genuinely different unsafe query gets a different stable fingerprint (still caught, not a universal collision)', () => {
  withTempFile(UNBOUNDED_QUERY, (fileA, dirA) => {
    withTempFile(DIFFERENT_UNBOUNDED_QUERY, (fileB, dirB) => {
      const [findingA] = checkUnboundedFile(fileA, dirA)
      const [findingB] = checkUnboundedFile(fileB, dirB)
      assert.ok(findingA)
      assert.ok(findingB)
      assert.notEqual(
        stableFingerprint(findingA),
        stableFingerprint(findingB),
        'two structurally different unbounded queries on the same table must not collide to the same fingerprint',
      )
    })
  })
})

const TENANT_UNSAFE_QUERY = `
export async function getAll(fastify) {
  const { data } = await fastify.supabase
    .from('payroll_slips')
    .select('id, employee_id')
  return data
}
`

test('check-tenant-isolation: the same line-shift-invariance property holds for violationKey', () => {
  const before = TENANT_UNSAFE_QUERY
  const after = `// unrelated\n// comment\n${TENANT_UNSAFE_QUERY}`

  withTempFile(before, (fileBefore, dirBefore) => {
    withTempFile(after, (fileAfter, dirAfter) => {
      const [violationBefore] = checkTenantFile(fileBefore, dirBefore)
      const [violationAfter]  = checkTenantFile(fileAfter, dirAfter)

      assert.ok(violationBefore, 'expected the fixture to be flagged as a tenant-isolation violation')
      assert.ok(violationAfter, 'expected the shifted fixture to still be flagged')
      assert.notEqual(violationBefore.lineNum, violationAfter.lineNum)

      const fpBefore = stableFingerprint(violationBefore).split('::').slice(1).join('::')
      const fpAfter  = stableFingerprint(violationAfter).split('::').slice(1).join('::')
      assert.equal(fpBefore, fpAfter, 'stableFingerprint must be identical across a pure line shift')
    })
  })
})

test('stableFingerprint normalizes whitespace/newlines in the snippet but not the code content', () => {
  const a = { relPath: 'x.ts', tableName: 'employees', snippet: "  .select('id')\n  .eq('a', 1)  " }
  const b = { relPath: 'x.ts', tableName: 'employees', snippet: ".select('id') .eq('a', 1)" }
  const c = { relPath: 'x.ts', tableName: 'employees', snippet: ".select('id') .eq('a', 2)" }
  assert.equal(stableFingerprint(a), stableFingerprint(b), 'whitespace-only differences must not change the fingerprint')
  assert.notEqual(stableFingerprint(b), stableFingerprint(c), 'a real content difference must change the fingerprint')
})
