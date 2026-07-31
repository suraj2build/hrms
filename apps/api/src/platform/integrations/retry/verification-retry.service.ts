/**
 * Verification retry policy (PEND-29/76).
 *
 * Retry state lives on `verification_records.retry_count`/`degraded_reason`
 * (migration 191) — not an in-process queue. That means it survives restarts
 * and stays consistent across horizontally-scaled instances, and "is this
 * entry due for retry" is just a query, answered by the scheduled consumer
 * in `lib/verification-retry-scanner.ts` (registered in index.ts, matching
 * the sla-scanner.ts/poll-scheduler.ts pattern) rather than a dedicated
 * enqueue/dequeue API.
 *
 * `verification-orchestrator.service.ts` writes `retry_count`/`degraded_reason`
 * directly as part of its normal upsert — see its `retryFields()` helper.
 *
 * Aadhaar is intentionally excluded from automatic retry: Aadhaar Act §8 /
 * DPDP Act require explicit consent per verification action, so only PAN and
 * bank-account entries are auto-retried by the scanner.
 */

import type { VerificationType } from '../../trust/types/trust-types.js'

/** Auto-retried types — Aadhaar requires fresh per-action consent (see module doc). */
export const AUTO_RETRY_TYPES: readonly VerificationType[] = ['pan', 'bank_account']

export const MAX_ATTEMPTS   = 3
const BASE_DELAY_MS = 30_000   // 30s
const MAX_DELAY_MS  = 300_000  // 5min

/** Exponential backoff (attempts is the retry_count AFTER the failed attempt). */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempts - 1), MAX_DELAY_MS)
}

/** Whether a degraded record with this retry_count/last-attempt time is due for another attempt now. */
export function isDueForRetry(retryCount: number, lastAttemptIso: string, now = Date.now()): boolean {
  if (retryCount <= 0 || retryCount >= MAX_ATTEMPTS) return false
  const lastAttemptMs = new Date(lastAttemptIso).getTime()
  return lastAttemptMs + backoffMs(retryCount) <= now
}
