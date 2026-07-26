import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { z } from 'zod'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:        z.string().min(1, 'Name is required'),
  code:        z.string().min(1, 'Code is required'),
  description: z.string().optional(),
  is_active:   z.boolean().optional().default(true),
})

export default async function identityTypesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('identity_types')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch identity types')
    return reply.send({ data })
  })

  fastify.post('/', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('identity_types')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create identity type')
    return reply.code(201).send(data)
  })

  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('identity_types')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update identity type')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Identity type not found' })
    return reply.send(data)
  })

  // Always soft-deactivates — employee_identity.identity_type_id REFERENCES
  // this table with no ON DELETE clause (RESTRICT), so a hard delete on an
  // in-use type throws an unhandled 23503 FK-violation. Deactivating (like
  // every sibling master) avoids that crash entirely.
  fastify.delete('/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count } = await fastify.supabase
      .from('employee_identity')
      .select('id', { count: 'exact', head: true })
      .eq('identity_type_id', id)
      .eq('tenant_id', req.tenantId)
    const inUse = (count ?? 0) > 0

    const { error } = await fastify.supabase
      .from('identity_types')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to deactivate identity type')
    return reply.send({
      deactivated: true,
      message: inUse
        ? 'Identity type deactivated — in use by existing employee records'
        : 'Identity type deactivated',
    })
  })
}
