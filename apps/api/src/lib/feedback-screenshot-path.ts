/**
 * The real upload flow (uploadFeedbackScreenshot, apps/web/src/lib/
 * supabase-storage.ts) only ever writes to exactly
 * `${tenantId}/feedback/${timestamp}-${randomId}.${ext}`. A prefix +
 * "no literal .." blacklist check (the SYSTEM_AUDIT_2026-10-14 first pass)
 * is bypassable by percent-encoded traversal sequences, backslashes, an
 * empty filename (the prefix alone, with nothing after it), or any other
 * value that merely avoids the two literal characters "..". Validating
 * against an allowlist of the actual filename shape closes all of these
 * at once instead of chasing individual bypasses.
 */
const FEEDBACK_FILENAME_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,250}[A-Za-z0-9])?$/

export function isValidFeedbackScreenshotPath(path: string, tenantId: string): boolean {
  const prefix = `${tenantId}/feedback/`
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  if (rest.includes('/') || rest.includes('\\')) return false
  return FEEDBACK_FILENAME_RE.test(rest)
}
