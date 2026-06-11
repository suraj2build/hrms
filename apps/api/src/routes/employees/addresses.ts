import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

const schema = z.object({
  address_type:          z.enum(['current','permanent','correspondence']),
  line1:                 z.string().min(1, 'Address line 1 is required'),
  line2:                 z.string().optional(),
  city:                  z.string().min(1, 'City is required'),
  state:                 z.string().min(1, 'State is required'),
  country:               z.string().optional().default('India'),
  pincode:               z.string().optional(),
  is_same_as_permanent:  z.boolean().optional().default(false),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function addressesRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/addresses', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_addresses')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('address_type')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST/PUT: upsert by address_type
  fastify.post('/employees/:id/addresses', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_addresses')
      .upsert(
        { ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId },
        { onConflict: 'tenant_id,employee_id,address_type' }
      )
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })

  fastify.delete('/employees/:id/addresses/:addressId', hrAdminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('employee_addresses')
      .delete()
      .eq('id', req.params.addressId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
