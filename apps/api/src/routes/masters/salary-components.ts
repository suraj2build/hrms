/**
 * Salary Components master routes — /masters/salary-components
 *
 * Thin HTTP layer. All CRUD logic lives in lib/salary-config-store.ts so this
 * surface can never drift from /payroll/compensation/components.
 *
 * Auth: reads require any authenticated user; writes require hr_admin / super_admin.
 * Response shape preserved (bare object on create/update, { data } on list).
 */
import type { FastifyInstance } from 'fastify'
import {
  listComponents, createComponent, updateComponent, deleteComponent,
} from '../../lib/salary-config-store.js'

export default async function salaryComponentsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }
  const writeAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { component_type } = req.query as { component_type?: string }
    const r = await listComponents(fastify.supabase, req.tenantId, { component_type })
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  fastify.post('/', writeAuth, async (req: any, reply) => {
    const r = await createComponent(fastify.supabase, req.tenantId, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send(r.data)
  })

  fastify.put('/:id', writeAuth, async (req: any, reply) => {
    const r = await updateComponent(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send(r.data)
  })

  fastify.delete('/:id', writeAuth, async (req: any, reply) => {
    const r = await deleteComponent(fastify.supabase, req.tenantId, req.params.id)
    if (r.error) return reply.code(r.status).send(r.error)
    if (r.status === 204) return reply.code(204).send()
    return reply.send(r.data)   // soft-delete → { message }
  })
}
