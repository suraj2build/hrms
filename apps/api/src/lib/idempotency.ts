/**
 * Idempotency helpers — built on the existing idempotency_keys table
 * (created in migration 018_idempotency_and_indexes.sql).
 *
 * Usage pattern in a route handler:
 *
 *   const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
 *   if (iKey) {
 *     const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'bulk-assign')
 *     if (cached) {
 *       reply.header('Idempotency-Replayed', 'true')
 *       return reply.code(cached.status_code).send(cached.response)
 *     }
 *   }
 *
 *   // ... do the work ...
 *
 *   const responseBody = { employees_count: ..., days_count: ... }
 *   if (iKey) {
 *     await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'bulk-assign', 200, responseBody)
 *   }
 *   return reply.send(responseBody)
 *
 * The `scope` prefix keeps the same Idempotency-Key used on different endpoints
 * from colliding within the same tenant.  Key TTL: 24 hours (enforced by a
 * periodic cleanup job; old rows don't affect correctness, only storage).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

interface CachedResponse {
  status_code: number
  response:    unknown
}

// SYSTEM_AUDIT_2026-10-14 checkpoint 13 — surfaced while reviewing the
// encashment-request route's idempotency handling for "same-key reuse
// with a different payload": nothing in this module ever compared the
// CURRENT request body against whatever was stored under a reused key —
// checkIdempotency replays the first request's response unconditionally.
// A client that reuses an Idempotency-Key across two meaningfully
// different submissions (a genuine bug, or an accidental key collision)
// silently gets back the FIRST request's result describing a DIFFERENT
// request than the one it just sent, and the second request is silently
// dropped — never inserted, never reported as rejected either.
//
// hashIdempotencyPayload + getStoredRequestHash are opt-in additions
// (claimIdempotency/storeIdempotency gained an optional trailing
// `requestHash` param; checkIdempotency's signature and return type are
// UNCHANGED) — every one of this module's ~136 existing call sites that
// doesn't pass a hash keeps behaving exactly as before. A caller that
// wants this protection calls getStoredRequestHash BEFORE checkIdempotency
// and refuses with 409 on a mismatch, instead of ever reaching the replay
// path.

/** Stable fingerprint of a request payload for idempotency-key reuse detection. */
export function hashIdempotencyPayload(payload: unknown): string {
  // Sort object keys recursively so semantically-identical payloads with
  // different key ordering (e.g. different JSON.stringify input order from
  // different clients) still hash identically.
  const canonical = JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((acc: Record<string, unknown>, k) => {
        acc[k] = (value as Record<string, unknown>)[k]
        return acc
      }, {})
    }
    return value
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Read back the request_hash stored for a key (from a prior claimIdempotency/
 * storeIdempotency call that supplied one), without disturbing anything.
 * Returns null if the key has never been seen, or was stored by a caller
 * that didn't opt into hashing.
 */
export async function getStoredRequestHash(
  supabase: SupabaseClient,
  tenantId: string,
  key:      string,
  scope:    string,
): Promise<string | null> {
  const scopedKey = `${scope}::${key}`
  const { data } = await supabase
    .from('idempotency_keys')
    .select('request_hash')
    .eq('tenant_id', tenantId)
    .eq('key', scopedKey)
    .maybeSingle()
  return (data as { request_hash: string | null } | null)?.request_hash ?? null
}

// Sentinel status_code written by claimIdempotency() while the real work is
// still in flight — never a genuine HTTP status a route would store, so it's
// safe to use as a marker distinguishing "claimed, not yet complete" from a
// real cached response.
const CLAIM_IN_PROGRESS_STATUS = 0

/**
 * Look up a cached response.
 * Returns null if the key has not been seen before, or if it's currently
 * claimed-but-not-yet-complete (see claimIdempotency).
 */
export async function checkIdempotency(
  supabase:  SupabaseClient,
  tenantId:  string,
  key:       string,
  scope:     string,
): Promise<CachedResponse | null> {
  const scopedKey = `${scope}::${key}`
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('status_code, response')
    .eq('tenant_id', tenantId)
    .eq('key', scopedKey)
    .maybeSingle()

  if (error || !data || data.status_code === CLAIM_IN_PROGRESS_STATUS) return null
  return { status_code: data.status_code, response: data.response }
}

/**
 * Atomically claim a key before doing non-idempotent work, for operations
 * where two concurrent requests carrying the same Idempotency-Key (a fast
 * client retry, or a genuine double-click) must not both proceed — the
 * plain check-then-work-then-store pattern above has a race window between
 * the check and the eventual storeIdempotency() call, wide enough for both
 * requests to see no cached hit and both do the work (e.g. both crediting a
 * batch leave-accrual job, double-crediting every employee).
 *
 * Returns true if this call won the claim (the caller should proceed with
 * the work); false if another request already holds it (the caller should
 * reject with 409, not proceed). On a win, the caller MUST eventually call
 * either storeIdempotency() (on success) or releaseIdempotencyClaim() (on
 * failure) with the same key/scope — otherwise the claim row is stuck as
 * "in progress" until the key's normal TTL cleanup runs.
 */
export async function claimIdempotency(
  supabase:    SupabaseClient,
  tenantId:    string,
  key:         string,
  scope:       string,
  requestHash?: string,
): Promise<boolean> {
  const scopedKey = `${scope}::${key}`
  const { error } = await supabase
    .from('idempotency_keys')
    .insert({
      tenant_id:    tenantId,
      key:          scopedKey,
      status_code:  CLAIM_IN_PROGRESS_STATUS,
      response:     null,
      ...(requestHash !== undefined ? { request_hash: requestHash } : {}),
    })
  if (!error) return true
  if (error.code === '23505') return false  // another request already holds this key
  // Any other insert failure (transient DB error) — fail safe by not
  // claiming; the caller should treat this as "couldn't verify, reject".
  return false
}

/**
 * Release a claim taken by claimIdempotency() after the work failed, so the
 * key becomes available for a genuine retry instead of being stuck as
 * "in progress" until TTL cleanup.
 */
export async function releaseIdempotencyClaim(
  supabase: SupabaseClient,
  tenantId: string,
  key:      string,
  scope:    string,
): Promise<void> {
  const scopedKey = `${scope}::${key}`
  await supabase
    .from('idempotency_keys')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('key', scopedKey)
    .eq('status_code', CLAIM_IN_PROGRESS_STATUS)
  // Errors intentionally ignored — best-effort cleanup; TTL will reclaim it.
}

/**
 * Store a successful response so future retries receive the same result.
 * Silently swallows DB errors (idempotency is best-effort; the primary
 * response has already been sent to the client).
 */
export async function storeIdempotency(
  supabase:     SupabaseClient,
  tenantId:     string,
  key:          string,
  scope:        string,
  statusCode:   number,
  responseBody: unknown,
  requestHash?: string,
): Promise<void> {
  const scopedKey = `${scope}::${key}`
  await supabase
    .from('idempotency_keys')
    .upsert(
      {
        tenant_id:   tenantId,
        key:         scopedKey,
        status_code: statusCode,
        response:    responseBody,
        ...(requestHash !== undefined ? { request_hash: requestHash } : {}),
      },
      { onConflict: 'tenant_id,key' },
    )
    .select('key')
    .maybeSingle()
  // Errors are intentionally ignored — the primary operation succeeded.
}
