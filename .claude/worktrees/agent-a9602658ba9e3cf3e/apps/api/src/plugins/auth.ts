import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    userId: string
    tenantId: string
    userRole: string
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'No token provided' })
      }
      const token = authHeader.slice(7)

      const { data: { user }, error } = await fastify.supabase.auth.getUser(token)
      if (error || !user) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' })
      }

      request.userId = user.id
      request.userRole = 'authenticated'
      request.tenantId = ''

      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('tenant_id, role')
        .eq('id', user.id)
        .single()

      if (!profile) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'User profile not found. Please complete registration or contact your administrator.',
        })
      }

      request.tenantId = profile.tenant_id
      request.userRole = profile.role
    } catch {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }
  })
}

export default fp(authPlugin, { name: 'auth' })