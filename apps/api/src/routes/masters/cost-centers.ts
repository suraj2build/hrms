import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const schema = z.object({
  name:        z.string().min(1, 'Name is required'),
  code:        z.string().optional(),
  description: z.string().optional(),
  is_active:   z.boolean().optional().default(true),
})

export default async function costCentersRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/', auth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/:id', auth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cost center not found' })
    return reply.send(data)
  })

  fastify.delete('/:id', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('cost_centers')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
