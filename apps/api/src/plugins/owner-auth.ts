/**
 * Owner Auth Plugin
 *
 * Validates Supabase Bearer JWT locally (no network call), then checks
 * platform_admins with a 5-minute in-memory cache per user.
 *
 * Before: every request = auth.getUser() + platform_admins SELECT + UPDATE (3 Supabase hits)
 * After:  every request = local JWT verify + cache lookup (0-1 Supabase hits)
 */
import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac } from 'node:crypto'

declare module 'fastify' {
  interface FastifyInstance {
    authenticateOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateOwnerOnly: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    platformAdminId:     string
    platformAdminRole:   string
    platformAdminUserId: string
  }
}

interface AdminCacheEntry {
  adminId:           string
  role:              string
  userId:            string
  isActive:          boolean
  isActiveCheckedAt: number  // timestamp of last DB-fresh is_active check
  expiresAt:         number
}

// In-memory cache: userId → admin record (5-min TTL)
const adminCache = new Map<string, AdminCacheEntry>()
const CACHE_TTL  = 5 * 60 * 1000

// Re-verify is_active from DB this often even on cache hits — bounds the
// deactivation → block window to well under CACHE_TTL. Fresh audit finding:
// role/adminId are stable for the full CACHE_TTL, but is_active can flip at
// any moment (owner deactivates/removes an admin) — same pattern as
// plugins/auth.ts's IS_ACTIVE_TTL (ISSUE-023), applied here because a
// platform admin's access (tenant suspend/delete, admin provisioning,
// password resets) is higher-privilege than a tenant user's.
const IS_ACTIVE_TTL = 60 * 1000

function verifySupabaseJwt(token: string, secret: string): { sub: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, sigB64] = parts
    const signingInput = `${headerB64}.${payloadB64}`

    // Supabase signs with HS256
    const expected = createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64url')

    if (expected !== sigB64) return null

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    if (!payload.sub || typeof payload.sub !== 'string') return null
    // Require aud==='authenticated' unconditionally (not just when present),
    // matching plugins/auth.ts's equivalent check — this is the higher-
    // privilege owner/platform-admin path, so defense-in-depth here matters
    // more, not less.
    if (payload.aud !== 'authenticated') return null

    return { sub: payload.sub }
  } catch {
    return null
  }
}

const ownerAuthPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET ?? ''

  fastify.decorate('authenticateOwner', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'No token provided' })
      }
      const token = authHeader.slice(7)

      // Verify JWT locally first (fast path); fall back to the Supabase Auth
      // server when local HS256 verification fails (asymmetric signing keys or a
      // rotated/unset secret), so valid tokens are not wrongly rejected.
      let userId: string
      const payload = verifySupabaseJwt(token, jwtSecret)
      if (payload) {
        userId = payload.sub
      } else {
        const { data: { user }, error } = await fastify.supabase.auth.getUser(token)
        if (error || !user) {
          return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' })
        }
        userId = user.id
      }

      // Check in-memory cache first
      const cached = adminCache.get(userId)
      if (cached && cached.expiresAt > Date.now()) {
        let isActive = cached.isActive
        if (cached.isActiveCheckedAt + IS_ACTIVE_TTL < Date.now()) {
          const { data: freshAdmin } = await fastify.supabase
            .from('platform_admins')
            .select('is_active')
            .eq('user_id', userId)
            .single()
          isActive = (freshAdmin as any)?.is_active ?? false
          cached.isActive          = isActive
          cached.isActiveCheckedAt = Date.now()
        }
        if (!isActive) {
          adminCache.delete(userId)
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Platform admin account is inactive' })
        }
        request.platformAdminId     = cached.adminId
        request.platformAdminRole   = cached.role
        request.platformAdminUserId = cached.userId
        return
      }

      // Cache miss — one DB lookup
      const { data: admin, error: adminErr } = await fastify.supabase
        .from('platform_admins')
        .select('id, role, is_active')
        .eq('user_id', userId)
        .single()

      if (adminErr || !admin) {
        adminCache.delete(userId)
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a platform admin' })
      }
      if (!admin.is_active) {
        adminCache.delete(userId)
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Platform admin account is inactive' })
      }

      // Populate cache
      adminCache.set(userId, {
        adminId:           admin.id,
        role:              admin.role,
        userId,
        isActive:          true,
        isActiveCheckedAt: Date.now(),
        expiresAt:         Date.now() + CACHE_TTL,
      })

      request.platformAdminId     = admin.id
      request.platformAdminRole   = admin.role
      request.platformAdminUserId = userId
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' })
    }
  })

  fastify.decorate('authenticateOwnerOnly', async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticateOwner(request, reply)
    if (reply.sent) return

    if (request.platformAdminRole !== 'owner') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Owner-only action' })
    }
  })
}

export default fp(ownerAuthPlugin, { name: 'owner-auth' })
