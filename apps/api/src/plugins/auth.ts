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
    /** The employee record this user maps to (profiles.employee_id). Null for accounts not linked to an employee (e.g. some admins). */
    employeeId: string | null
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
      request.employeeId = null

      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('tenant_id, role, employee_id')
        .eq('id', user.id)
        .single()

      if (!profile) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'User profile not found. Please complete registration or contact your administrator.',
        })
      }

      // A profile without a tenant (e.g. a platform-owner account, or a row
      // provisioned with a null tenant_id) must NOT fall through with an empty
      // tenantId — that produces confusing 500s (invalid-uuid / not-null) on
      // every tenant-scoped write. Fail clearly instead.
      if (!profile.tenant_id) {
        return reply.code(403).send({
          error: 'NO_TENANT',
          message: 'This account is not linked to a tenant workspace.',
        })
      }

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