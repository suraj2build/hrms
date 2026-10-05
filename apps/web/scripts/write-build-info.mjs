#!/usr/bin/env node
/**
 * Writes public/version.json before the Vite build, so the deployed static
 * site serves its own commit SHA at /version.json — the web half of
 * verifying a release-qualification run (e.g. CI's E2E gate) is actually
 * testing the candidate commit, not a stale deployment.
 *
 * Vercel sets VERCEL_GIT_COMMIT_SHA automatically at build time. Falls back
 * to GIT_COMMIT_SHA (other hosts) then `git rev-parse HEAD` (local builds).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const publicDir = path.join(ROOT, 'public')
mkdirSync(publicDir, { recursive: true })
writeFileSync(
  path.join(publicDir, 'version.json'),
  JSON.stringify({ commitSha: resolveSha(), builtAt: new Date().toISOString() }, null, 2) + '\n',
)
console.log(`[write-build-info] wrote public/version.json (commitSha=${resolveSha()})`)
