import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const schema = z.object({
  contract_type: z.enum(['appointment','renewal','amendment','nda','other']),
  start_date:    z.string().min(1, 'Start date is required'),
  end_date:      z.string().optional(),
  storage_path:  z.string().optional(),
  status:        z.enum(['draft','active','expired','terminated']).optional().default('active'),
  notes:         z.string().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function contractsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/:id/contracts', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_contracts')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('start_date', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/employees/:id/contracts', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_contracts')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId, created_by: req.userId })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/contracts/:contractId', auth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_contracts')
      .update(parsed.data)
      .eq('id', req.params.contractId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Contract not found' })
    return reply.send(data)
  })

  fastify.delete('/employees/:id/contracts/:contractId', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('employee_contracts')
      .delete()
      .eq('id', req.params.contractId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
