import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const schema = z.object({
  name:      z.string().min(1, 'Name is required'),
  code:      z.string().optional(),
  address:   z.string().optional(),
  city:      z.string().optional(),
  state:     z.string().optional(),
  country:   z.string().optional().default('India'),
  pincode:   z.string().optional(),
  is_active: z.boolean().optional().default(true),
})

export default async function workLocationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // GET /masters/work-locations
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('work_locations')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /masters/work-locations
  fastify.post('/', auth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('work_locations')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  // PUT /masters/work-locations/:id
  fastify.put('/:id', auth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('work_locations')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Work location not found' })
    return reply.send(data)
  })

  // DELETE /masters/work-locations/:id
  fastify.delete('/:id', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('work_locations')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
