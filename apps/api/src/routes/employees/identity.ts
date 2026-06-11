import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

const schema = z.object({
  identity_type_id: z.string().uuid('Invalid identity type'),
  identity_number:  z.string().min(1, 'Identity number is required'),
  issued_by:        z.string().optional(),
  issued_date:      z.string().optional(),
  expiry_date:      z.string().optional(),
  storage_path:     z.string().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function identityRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  // Government-ID PII: writes/deletes are HR-admin only.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/identity', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_identity')
      .select('*, identity_types(id, name, code)')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/employees/:id/identity', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_identity')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select('*, identity_types(id, name, code)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.delete('/employees/:id/identity/:identityId', hrAdminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('employee_identity')
      .delete()
      .eq('id', req.params.identityId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
