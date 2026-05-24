import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const schema = z.object({
  card_number:   z.string().min(1, 'Card number is required'),
  issued_date:   z.string().optional(),
  returned_date: z.string().optional(),
  status:        z.enum(['active','returned','lost','deactivated']).optional().default('active'),
  notes:         z.string().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function accessCardsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/:id/access-cards', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_access_cards')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('issued_date', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/employees/:id/access-cards', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_access_cards')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select().single()
    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'Card number already in use' })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/access-cards/:cardId', auth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_access_cards')
      .update(parsed.data)
      .eq('id', req.params.cardId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Access card not found' })
    return reply.send(data)
  })
}
