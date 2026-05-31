import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const structureSchema = z.object({
  name:        z.string().min(1, 'Name is required'),
  code:        z.string().min(1, 'Code is required'),
  description: z.string().optional(),
  is_active:   z.boolean().optional().default(true),
})

const componentSchema = z.object({
  salary_component_id: z.string().uuid('Invalid component ID'),
  calculation_type:    z.enum(['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross']),
  default_value:       z.number().min(0, 'Value must be >= 0'),
  sequence:            z.number().int().optional().default(0),
  is_active:           z.boolean().optional().default(true),
})

export default async function salaryStructuresRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── STRUCTURES ──────────────────────────────────────────

  // GET /masters/salary-structures
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .select('*, salary_structure_components(*, salary_components(id, name, code, component_type))')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // GET /masters/salary-structures/:id
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .select('*, salary_structure_components(*, salary_components(*))')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Salary structure not found' })
    return reply.send(data)
  })

  // POST /masters/salary-structures
  fastify.post('/', auth, async (req: any, reply) => {
    const parsed = structureSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  // PUT /masters/salary-structures/:id
  fastify.put('/:id', auth, async (req: any, reply) => {
    const parsed = structureSchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Salary structure not found' })
    return reply.send(data)
  })

  // DELETE /masters/salary-structures/:id
  fastify.delete('/:id', auth, async (req: any, reply) => {
    const { count } = await fastify.supabase
      .from('employee_compensations')
      .select('*', { count: 'exact', head: true })
      .eq('salary_structure_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (count && count > 0)
      return reply.code(409).send({ error: 'IN_USE', message: 'Structure is assigned to employees' })
    const { error } = await fastify.supabase
      .from('salary_structures')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── STRUCTURE COMPONENTS ────────────────────────────────

  // GET /masters/salary-structures/:id/components
  fastify.get('/:id/components', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('salary_structure_components')
      .select('*, salary_components(*)')
      .eq('salary_structure_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('sequence')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /masters/salary-structures/:id/components
  fastify.post('/:id/components', auth, async (req: any, reply) => {
    const parsed = componentSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('salary_structure_components')
      .insert({
        ...parsed.data,
        salary_structure_id: req.params.id,
        tenant_id: req.tenantId,
      })
      .select('*, salary_components(*)')
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  // PUT /masters/salary-structures/:id/components/:componentId
  fastify.put('/:id/components/:componentId', auth, async (req: any, reply) => {
    const parsed = componentSchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('salary_structure_components')
      .update(parsed.data)
      .eq('id', req.params.componentId)
      .eq('salary_structure_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('*, salary_components(*)')
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Component not found' })
    return reply.send(data)
  })

  // DELETE /masters/salary-structures/:id/components/:componentId
  fastify.delete('/:id/components/:componentId', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('salary_structure_components')
      .delete()
      .eq('id', req.params.componentId)
      .eq('salary_structure_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
