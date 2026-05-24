import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const schema = z.object({
  name:               z.string().min(1, 'Name is required'),
  code:               z.string().min(1, 'Code is required'),
  component_type:     z.enum(['earning', 'deduction', 'employer_contribution']),
  is_taxable:         z.boolean().optional().default(true),
  is_pf_applicable:   z.boolean().optional().default(false),
  is_esi_applicable:  z.boolean().optional().default(false),
  is_pt_applicable:   z.boolean().optional().default(false),
  is_lwf_applicable:  z.boolean().optional().default(false),
  is_variable:        z.boolean().optional().default(false),
  description:        z.string().optional(),
  display_order:      z.number().int().optional().default(0),
  is_active:          z.boolean().optional().default(true),
})

export default async function salaryComponentsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { component_type } = req.query as { component_type?: string }
    let query = fastify.supabase
      .from('salary_components')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('display_order')
      .order('name')
    if (component_type) query = query.eq('component_type', component_type)
    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/', auth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('salary_components')
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
      .from('salary_components')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Salary component not found' })
    return reply.send(data)
  })

  fastify.delete('/:id', auth, async (req: any, reply) => {
    // Check if component is used in any structure
    const { count } = await fastify.supabase
      .from('salary_structure_components')
      .select('*', { count: 'exact', head: true })
      .eq('salary_component_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (count && count > 0)
      return reply.code(409).send({ error: 'IN_USE', message: 'Component is used in salary structures' })
    const { error } = await fastify.supabase
      .from('salary_components')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
