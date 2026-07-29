import type { FastifyInstance } from 'fastify'
import { fetchFullProfile } from '../../lib/employee-profile.js'
import { SLOW_THRESHOLD_MS } from '../../lib/constants.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Light-mode rate limiter ────────────────────────────────────────────────────
// Prevents clients from polling ?light=true in a tight loop without ever
// fetching the full profile. After LIGHT_RATE_LIMIT requests within a
// LIGHT_RATE_WINDOW_MS window the endpoint automatically falls back to full
// mode and sets X-Profile-Mode: rate-limited so the client knows.
const LIGHT_RATE_LIMIT     = 10          // max light requests per window
const LIGHT_RATE_WINDOW_MS = 60_000      // 1 minute

// ── Rate-limiter map bounds ────────────────────────────────────────────────────
/**
 * Hard cap on how many (tenantId:employeeId) keys can live in the map at once.
 * When the cap is reached the oldest-inserted entry is evicted (Map insertion
 * order is guaranteed by the JS spec, so `map.keys().next()` gives the oldest).
 */
const RATE_MAP_MAX_KEYS = 10_000

/**
 * How often (ms) a background sweep removes buckets whose window has already
 * expired. Keeps the map from filling with stale entries during quiet periods.
 */
const RATE_MAP_PRUNE_INTERVAL_MS = 5 * 60_000   // every 5 minutes

interface RateBucket {
  count:               number
  windowStart:         number
  /** Cumulative count of requests that were served as full because limit was exceeded. */
  rate_limited_count:  number
}

/**
 * lightRateMap — in-process rate-limit state, keyed by "tenantId:employeeId".
 *
 * Bounded to RATE_MAP_MAX_KEYS via oldest-key eviction.
 * Stale entries are swept every RATE_MAP_PRUNE_INTERVAL_MS.
 */
const lightRateMap = new Map<string, RateBucket>()

// ── Periodic stale-bucket pruning ─────────────────────────────────────────────
// Runs in the background; does not block requests. The interval is deliberately
// unref()'d so it never prevents Node from exiting cleanly in tests.
const _pruneTimer = setInterval(() => {
  const cutoff = Date.now() - LIGHT_RATE_WINDOW_MS
  for (const [key, bucket] of lightRateMap) {
    if (bucket.windowStart < cutoff) lightRateMap.delete(key)
  }
}, RATE_MAP_PRUNE_INTERVAL_MS).unref()

// Exported for test teardown only — not part of the public API.
export { _pruneTimer }

// ── Rate-bucket helper ─────────────────────────────────────────────────────────
/**
 * Increments the rate bucket for `key` and returns whether the per-window
 * limit is exceeded along with the cumulative rate_limited_count for that key.
 *
 * Side effects:
 *   - Creates a new bucket if none exists, evicting the oldest key when at cap.
 *   - Resets an expired bucket in-place (preserves insertion order for live keys).
 *   - Increments rate_limited_count when the limit is exceeded.
 */
function checkLightRateLimit(key: string): { exceeded: boolean; rate_limited_count: number } {
  const now = Date.now()
  let bucket = lightRateMap.get(key)

  if (!bucket) {
    // Evict oldest entry before inserting a new one when at cap.
    if (lightRateMap.size >= RATE_MAP_MAX_KEYS) {
      const oldestKey = lightRateMap.keys().next().value
      if (oldestKey !== undefined) lightRateMap.delete(oldestKey)
    }
    bucket = { count: 0, windowStart: now, rate_limited_count: 0 }
  } else if (now - bucket.windowStart > LIGHT_RATE_WINDOW_MS) {
    // Window expired — reset in place to keep insertion order stable.
    bucket.count      = 0
    bucket.windowStart = now
    // rate_limited_count is cumulative; intentionally NOT reset on window expiry.
  }

  bucket.count++

  const exceeded = bucket.count > LIGHT_RATE_LIMIT
  if (exceeded) bucket.rate_limited_count++

  lightRateMap.set(key, bucket)   // re-set refreshes insertion order for this key

  return { exceeded, rate_limited_count: bucket.rate_limited_count }
}

/**
 * GET /employees/:id/full-profile[?light=true]
 *
 * Returns the complete employee profile in a single response.
 *
 * Query params:
 *   light=true  — omits addresses, emergency_contacts, bank_statutory, and
 *                 compensation components.  Saves 4 of 8 DB queries.
 *                 Use for summary cards or page headers where full detail
 *                 is not needed.
 *
 * Profile-fetching logic lives in src/lib/employee-profile.ts so it is
 * shared with POST /employees/full-create without duplication.
 *
 * Rate limiting (light mode only):
 *   If the same tenantId:employeeId pair calls ?light=true more than
 *   LIGHT_RATE_LIMIT times within LIGHT_RATE_WINDOW_MS the request is
 *   served in full mode with X-Profile-Mode: rate-limited.
 *
 * Slow-request detection:
 *   If duration_ms > SLOW_THRESHOLD_MS the exit log is emitted at WARN level
 *   with slow_request: true and the full _timing object.
 *   Normal requests log at DEBUG with only total_ms, wave1_ms, wave2_ms.
 */
export default async function fullProfileRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/:id/full-profile', auth, async (req: any, reply) => {
    // HR admins may read any employee's profile; others may only read their own.
    const isHr = HR_ADMIN_ROLES.includes(req.userRole)
    if (!isHr) {
      const { data: callerProfile, error: callerProfileErr } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (callerProfileErr) return serverError(req, reply, callerProfileErr, ErrorCode.QUERY_FAILED, 'Failed to verify access')
      if (!callerProfile || (callerProfile as any).employee_id !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
      }
    }

    const startMs = Date.now()
    let light     = (req.query as Record<string, string>).light === 'true'

    // ── Shared log context — spread into every fastify.log call ────────────
    // route is the single source of truth; all log calls use { ...ctx, ...extra }.
    const ctx = {
      module:      'employee',
      route:       'employees/full-profile',
      tenant_id:   req.tenantId,
      employee_id: req.params.id as string,
    }

    // profile_mode tracks the effective serving mode for logs and headers.
    // Starts as the requested mode; overridden to 'rate_limited' if needed.
    let profileMode: 'light' | 'full' | 'rate_limited' = light ? 'light' : 'full'

    // ── Light-mode rate-limit check ──────────────────────────────────────────
    if (light) {
      const key = `${req.tenantId}:${req.params.id}`
      const { exceeded, rate_limited_count } = checkLightRateLimit(key)

      if (exceeded) {
        light       = false
        profileMode = 'rate_limited'
        reply.header('X-Profile-Mode', 'rate-limited')
        fastify.log.warn(
          {
            ...ctx,
            profile_mode:       profileMode,
            limit:              LIGHT_RATE_LIMIT,
            window_ms:          LIGHT_RATE_WINDOW_MS,
            rate_limited_count,
            map_size:           lightRateMap.size,
          },
          'GET /employees/:id/full-profile — light mode rate limit exceeded, serving full profile',
        )
      }
    }

    // ── Fetch ────────────────────────────────────────────────────────────────
    const result = await fetchFullProfile(
      fastify.supabase,
      req.params.id,
      req.tenantId,
      { light },
    )

    if (result && (result as any)._error) {
      return serverError(req, reply, (result as any)._error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee profile')
    }
    if (!result) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // ── Timing log: minimal by default, full on slow requests ────────────────
    const { _timing, ...profile } = result
    const duration_ms = Date.now() - startMs

    const baseLogFields = {
      ...ctx,
      profile_mode: profileMode,
      duration_ms,
      // Minimal timing always included — enough for dashboards and p95 tracking.
      timing: {
        total_ms:      _timing.total_ms,
        wave1_ms:      _timing.wave1_ms,
        wave2_ms:      _timing.wave2_ms,
        query_count:   _timing.query_count,
        skipped_count: _timing.skipped_count,
      },
    }

    if (duration_ms > SLOW_THRESHOLD_MS) {
      fastify.log.warn(
        // On slow requests attach the full per-query breakdown for diagnosis.
        { ...baseLogFields, timing: _timing, slow_request: true },
        'SLOW — GET /employees/:id/full-profile',
      )
    } else {
      fastify.log.debug(baseLogFields, 'GET /employees/:id/full-profile timing')
    }

    // ── Set X-Profile-Mode header ─────────────────────────────────────────────
    // 'rate-limited' header was already set above when applicable.
    if (profileMode === 'light') {
      reply.header('X-Profile-Mode', 'light')
    }

    return reply.send(profile)
  })
}
