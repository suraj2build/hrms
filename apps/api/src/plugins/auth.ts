import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac } from 'node:crypto'

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
  tenantId:   string
  role:       string
  employeeId: string | null
  isActive:   boolean
  expiresAt:  number
}

// Per-user profile cache (5-min TTL) — avoids DB hit on every request
const profileCache = new Map<string, ProfileCacheEntry>()
const CACHE_TTL    = 5 * 60 * 1000

function verifySupabaseJwt(token: string, secret: string): { sub: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sigB64] = parts
    const expected = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')
    if (expected !== sigB64) return null
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
        if (!cached.isActive) {
          return reply.code(401).send({ error: 'Unauthorized', message: 'Account is deactivated' })
        }
        request.tenantId   = cached.tenantId
        request.userRole   = cached.role
        request.employeeId = cached.employeeId
        return
      }

      // Cache miss — one DB lookup
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

      profileCache.set(userId, {
        tenantId:   profile.tenant_id,
        role:       profile.role,
        employeeId: (profile as any).employee_id ?? null,
        isActive:   (profile as any).is_active ?? true,
        expiresAt:  Date.now() + CACHE_TTL,
      })

      request.tenantId = profile.tenant_id
      request.userRole = profile.role
      request.employeeId = (profile as any).employee_id ?? null

      // ── Subscription / trial gate ──────────────────────────────────────────
      // Suspended / expired / cancelled tenants (and trials past their end date)
      // keep READ access — so they can still see the app and the billing page —
      // but cannot MUTATE. Billing routes are always allowed so an admin can
      // re-subscribe to recover. Owner routes use a separate auth and are
      // unaffected.
      const method = request.method
      const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
      if (isWrite && !request.url.startsWith('/billing') && !request.url.startsWith('/support')) {
        const { data: tenant } = await fastify.supabase
          .from('tenants')
          .select('status, trial_ends_at')
          .eq('id', profile.tenant_id)
          .single()
        if (tenant) {
          const trialExpired = tenant.status === 'trial' && tenant.trial_ends_at != null &&
            new Date(tenant.trial_ends_at).getTime() < Date.now()
          const blocked = ['suspended', 'expired', 'cancelled'].includes(tenant.status) || trialExpired
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
