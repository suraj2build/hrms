#!/usr/bin/env node
/**
 * Writes public/version.json before the Vite build, so the deployed static
 * site serves its own commit SHA at /version.json — the web half of
 * verifying a release-qualification run (e.g. CI's E2E gate) is actually
 * testing the candidate commit, not a stale deployment.
 *
 * Vercel sets VERCEL_GIT_COMMIT_SHA automatically at build time. Falls back
 * to GIT_COMMIT_SHA (other hosts) then `git rev-parse HEAD` (local builds).
 *
 * Also records the VITE_API_URL this build was compiled with (same env var
 * apps/web/src/lib/api/client.ts inlines into the bundle at build time).
 * Two deployments independently reporting the right commitSha does NOT prove
 * the web app is actually wired to call the API that was checked — it only
 * proves both exist. Recording the build-time API target here lets the
 * staging verifier confirm the web build was actually compiled to call the
 * specific API_URL it just checked, not some other host.
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
const commitSha = resolveSha()
const apiUrl = process.env.VITE_API_URL || null
writeFileSync(
  path.join(publicDir, 'version.json'),
  JSON.stringify({ commitSha, apiUrl, builtAt: new Date().toISOString() }, null, 2) + '\n',
)
console.log(`[write-build-info] wrote public/version.json (commitSha=${commitSha}, apiUrl=${apiUrl ?? '(proxy/unset)'})`)
