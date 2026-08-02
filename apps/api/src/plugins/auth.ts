import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    userId:   string
    tenantId: string
    userRole: string
    /** The employee record this user maps to (profiles.employee_id). Null for accounts not linked to an employee (e.g. some admins). */
    employeeId: string | null
  }
}

interface ProfileCacheEntry {
  tenantId:          string
  role:              string
  employeeId:        string | null
  isActive:          boolean
  isActiveCheckedAt: number  // timestamp of last DB-fresh is_active check (ISSUE-023)
  allowLogin:        boolean  // tenant.allow_login — false blocks all access for this workspace
  expiresAt:         number
}

// Per-user profile cache (5-min TTL) — avoids DB hit on every request
const profileCache    = new Map<string, ProfileCacheEntry>()
const CACHE_TTL       = 5 * 60 * 1000
// Re-verify is_active from DB this often even on cache hits — bounds the window
// during which a deactivated account can still make authenticated requests.
const IS_ACTIVE_TTL   = 60 * 1000

/**
 * Per CLAUDE.md's tenant-licensing contract: a suspended/expired/cancelled
 * tenant (or a trial past trial_ends_at) blocks writes. Pure function shared
 * by both the cache-hit and cache-miss paths below so the two can't drift —
 * ISSUE-141 was exactly that: the cache-hit path never called this logic at
 * all, so a tenant suspended mid-session could write for up to CACHE_TTL
 * (5 min) after suspension, violating the "reads fresh, never from the
 * profile cache" contract CLAUDE.md documents.
 */
function isTenantBlocked(tenant: { status: string; trial_ends_at: string | null }): { blocked: boolean; trialExpired: boolean } {
  const trialExpired = tenant.status === 'trial' && tenant.trial_ends_at != null &&
    new Date(tenant.trial_ends_at).getTime() < Date.now()
  const blocked = ['suspended', 'expired', 'cancelled'].includes(tenant.status) || trialExpired
  return { blocked, trialExpired }
}

/**
 * SYSCERT_AUDIT_2026-08-02.md Medium finding: the write-gate's `/billing`
 * and `/support` exemptions used a raw `url.startsWith('/billing')`, which
 * also matches any *unrelated* route that merely shares the prefix (e.g. a
 * future `/billingHistory` or `/billing-something` route would silently
 * bypass the subscription gate too). Match on the path segment instead —
 * exactly `/billing`/`/support`, or a sub-path of it — not any string with
 * that prefix.
 */
function isExemptFromWriteGate(url: string): boolean {
  const path = url.split('?')[0]
  return path === '/billing' || path.startsWith('/billing/') ||
    path === '/support' || path.startsWith('/support/')
}

function verifySupabaseJwt(token: string, secret: string): { sub: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sigB64] = parts
    const expected = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')
    // Constant-time compare (SYSCERT_AUDIT_2026-08-02.md H11) — a plain `!==`
    // string comparison short-circuits on the first differing byte, leaking a
    // timing side-channel an attacker could use to forge a valid signature
    // byte-by-byte. Matches the same pattern already used for the billing
    // webhook's HMAC check in routes/billing/index.ts.
    const expectedBuf = Buffer.from(expected)
    const sigBuf      = Buffer.from(sigB64)
    if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    if (!payload.sub || typeof payload.sub !== 'string') return null
    if (payload.aud !== 'authenticated') return null
    return { sub: payload.sub }
  } catch {
    return null
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET ?? ''

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'No token provided' })
      }
      const token = authHeader.slice(7)

      // Verify JWT locally first (fast path, zero network) — valid for the legacy
      // HS256 shared secret. If that fails (project signs tokens with asymmetric
      // keys, or SUPABASE_JWT_SECRET is unset/rotated), fall back to validating
      // against the Supabase Auth server so genuinely-valid tokens are not wrongly
      // rejected as "Invalid token".
      let userId: string
      const payload = verifySupabaseJwt(token, jwtSecret)
      if (payload) {
        userId = payload.sub
      } else {
        const { data: { user }, error } = await fastify.supabase.auth.getUser(token)
        if (error || !user) {
          return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' })
        }
        userId = user.id
      }
      request.userId   = userId
      request.userRole = 'authenticated'
      request.tenantId = ''
      request.employeeId = null

      // Check cache first
      const cached = profileCache.get(userId)
      if (cached && cached.expiresAt > Date.now()) {
        // allow_login is an operational setting — cached for the full CACHE_TTL (5 min).
        // If an admin disables login for the workspace the effect lands within 5 minutes.
        if (!cached.allowLogin) {
          return reply.code(403).send({ error: 'TENANT_LOGIN_DISABLED', message: 'Login is not available for this workspace.' })
        }
        // Role/tenantId are stable for the full CACHE_TTL, but is_active can change
        // at any moment (admin deactivates account). Re-check it from DB every
        // IS_ACTIVE_TTL (60 s) so the deactivation → block window stays tight. (ISSUE-023)
        let isActive = cached.isActive
        if (cached.isActiveCheckedAt + IS_ACTIVE_TTL < Date.now()) {
          const { data: freshProfile } = await fastify.supabase
            .from('profiles')
            .select('is_active')
            .eq('id', userId)
            .single()
          isActive = (freshProfile as any)?.is_active ?? false
          profileCache.set(userId, { ...cached, isActive, isActiveCheckedAt: Date.now() })
        }
        if (!isActive) {
          return reply.code(401).send({ error: 'Unauthorized', message: 'Account is deactivated' })
        }
        request.tenantId   = cached.tenantId
        request.userRole   = cached.role
        request.employeeId = cached.employeeId

        // Subscription / trial gate (ISSUE-141) — same contract as the
        // cache-miss path below: read tenants.status/trial_ends_at fresh on
        // every write, never from the profile cache. Reads stay open
        // regardless (unaffected, same as the miss path) so a lapsed tenant
        // can still reach the billing page.
        const hitMethod = request.method
        const hitIsWrite = hitMethod === 'POST' || hitMethod === 'PUT' || hitMethod === 'PATCH' || hitMethod === 'DELETE'
        if (hitIsWrite && !isExemptFromWriteGate(request.url)) {
          const { data: freshTenant, error: tenantErr } = await fastify.supabase
            .from('tenants')
            .select('status, trial_ends_at')
            .eq('id', cached.tenantId)
            .single()
          // Fail closed, matching the is_active recheck above — a query
          // error here must not be treated as "not blocked", or a transient
          // DB blip silently lets a suspended/expired tenant write through
          // with no gate at all.
          if (tenantErr || !freshTenant) {
            request.log.error({ err: tenantErr, tenantId: cached.tenantId }, 'auth: subscription recheck failed')
            return reply.code(402).send({
              error:   'SUBSCRIPTION_CHECK_FAILED',
              message: 'Unable to verify your subscription status. Please try again shortly.',
            })
          }
          const { blocked, trialExpired } = isTenantBlocked(freshTenant)
          if (blocked) {
            return reply.code(402).send({
              error: 'SUBSCRIPTION_REQUIRED',
              message: trialExpired
                ? 'Your free trial has ended. Please subscribe to continue.'
                : `Your workspace is ${freshTenant.status}. Please update your subscription to continue.`,
            })
          }
        }
        return
      }

      // Cache miss — load profile then tenant (allow_login + subscription state)
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('tenant_id, role, employee_id, is_active')
        .eq('id', userId)
        .single()

      if (!profile) {
        return reply.code(401).send({
          error:   'Unauthorized',
          message: 'User profile not found. Please complete registration or contact your administrator.',
        })
      }

      if (!profile.tenant_id) {
        return reply.code(403).send({
          error:   'NO_TENANT',
          message: 'This account is not linked to a tenant workspace.',
        })
      }

      if (!(profile as any).is_active) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Account is deactivated' })
      }

      // Load tenant — needed for allow_login check (all requests) and subscription
      // gate (write requests). One query covers both; avoids a second round-trip on
      // first-request writes.
      const { data: tenant } = await fastify.supabase
        .from('tenants')
        .select('allow_login, status, trial_ends_at')
        .eq('id', profile.tenant_id)
        .single()

      if (!tenant?.allow_login) {
        return reply.code(403).send({
          error:   'TENANT_LOGIN_DISABLED',
          message: 'Login is not available for this workspace.',
        })
      }

      profileCache.set(userId, {
        tenantId:          profile.tenant_id,
        role:              profile.role,
        employeeId:        (profile as any).employee_id ?? null,
        isActive:          (profile as any).is_active ?? true,
        isActiveCheckedAt: Date.now(),
        allowLogin:        tenant.allow_login,
        expiresAt:         Date.now() + CACHE_TTL,
      })

      request.tenantId   = profile.tenant_id
      request.userRole   = profile.role
      request.employeeId = (profile as any).employee_id ?? null

      // ── Subscription / trial gate ──────────────────────────────────────────
      // Suspended / expired / cancelled tenants (and trials past their end date)
      // keep READ access — so they can still see the app and the billing page —
      // but cannot MUTATE. Billing routes are always allowed so an admin can
      // re-subscribe to recover. Owner routes use a separate auth and are
      // unaffected.
      const method = request.method
      const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
      if (isWrite && !isExemptFromWriteGate(request.url)) {
        // Reuse the tenant row already fetched above — saves a second round-trip
        // on write requests that hit this (cache-miss) path.
        if (tenant) {
          const { blocked, trialExpired } = isTenantBlocked(tenant)
          if (blocked) {
            return reply.code(402).send({
              error: 'SUBSCRIPTION_REQUIRED',
              message: trialExpired
                ? 'Your free trial has ended. Please subscribe to continue.'
                : `Your workspace is ${tenant.status}. Please update your subscription to continue.`,
            })
          }
        }
      }
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }
  })
}

export default fp(authPlugin, { name: 'auth' })
