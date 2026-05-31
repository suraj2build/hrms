/**
 * Owner Auth Plugin
 *
 * Validates Supabase Bearer JWT then checks the platform_admins table.
 * Owner routes use fastify.authenticateOwner instead of fastify.authenticate.
 *
 * Decorates request:
 *   request.platformAdminId   — UUID from platform_admins.id
 *   request.platformAdminRole — 'owner' | 'admin'
 */
import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticateOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateOwnerOnly: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    platformAdminId:   string
    platformAdminRole: string
    platformAdminUserId: string
  }
}

const ownerAuthPlugin: FastifyPluginAsync = async (fastify) => {
  // ── authenticateOwner — accepts both 'owner' and 'admin' roles ───────────────
  fastify.decorate('authenticateOwner', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'No token provided' })
      }
      const token = authHeader.slice(7)

      const { data: { user }, error } = await fastify.supabase.auth.getUser(token)
      if (error || !user) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token' })
      }

      // Check platform_admins — NOT profiles
      const { data: admin, error: adminErr } = await fastify.supabase
        .from('platform_admins')
        .select('id, role, is_active')
        .eq('user_id', user.id)
        .single()

      if (adminErr || !admin) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a platform admin' })
      }
      if (!admin.is_active) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Platform admin account is inactive' })
      }

      request.platformAdminId     = admin.id
      request.platformAdminRole   = admin.role
      request.platformAdminUserId = user.id

      // Update last_login_at (fire and forget)
      void Promise.resolve(
        fastify.supabase
          .from('platform_admins')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', admin.id)
      ).catch(() => {})
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' })
    }
  })

  // ── authenticateOwnerOnly — accepts only 'owner' role ────────────────────────
  fastify.decorate('authenticateOwnerOnly', async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticateOwner(request, reply)
    if (reply.sent) return  // already replied with error

    if (request.platformAdminRole !== 'owner') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Owner-only action' })
    }
  })
}

export default fp(ownerAuthPlugin, { name: 'owner-auth' })
