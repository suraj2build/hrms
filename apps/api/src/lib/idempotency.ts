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

interface CachedResponse {
  status_code: number
  response:    unknown
}

/**
 * Look up a cached response.
 * Returns null if the key has not been seen before.
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

  if (error || !data) return null
  return { status_code: data.status_code, response: data.response }
}

/**
 * Store a successful response so future retries receive the same result.
 * Silently swallows DB errors (idempotency is best-effort; the primary
 * response has already been sent to the client).
 */
export async function storeIdempotency(
  supabase:    SupabaseClient,
  tenantId:    string,
  key:         string,
  scope:       string,
  statusCode:  number,
  responseBody: unknown,
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
      },
      { onConflict: 'tenant_id,key' },
    )
    .select('key')
    .maybeSingle()
  // Errors are intentionally ignored — the primary operation succeeded.
}
