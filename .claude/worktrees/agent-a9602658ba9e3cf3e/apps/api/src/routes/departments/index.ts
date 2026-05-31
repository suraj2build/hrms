import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const deptSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  parent_id: z.string().uuid().optional(),
})

const desigSchema = z.object({
  name: z.string().min(1),
  level: z.number().int().optional(),
  department_id: z.string().uuid().optional(),
})

const gradeSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  min_salary: z.number().optional(),
  max_salary: z.number().optional(),
})

export default async function orgRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── Departments ───────────────────────────────────────────────────────────
  fastify.get('/departments', auth, async (req, reply) => {
    const { data, error } = await fastify.supabase
      .from('departments')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/departments', auth, async (req, reply) => {
    const parsed = deptSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const { data, error } = await fastify.supabase
      .from('departments')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select().single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/departments/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = deptSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const { data, error } = await fastify.supabase
      .from('departments').update(parsed.data).eq('id', id).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })

  fastify.delete('/departments/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('departments').delete().eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Designations ──────────────────────────────────────────────────────────
  fastify.get('/designations', auth, async (req, reply) => {
    const { data, error } = await fastify.supabase
      .from('designations').select('*').eq('tenant_id', req.tenantId).order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/designations', auth, async (req, reply) => {
    const parsed = desigSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const { data, error } = await fastify.supabase
      .from('designations').insert({ ...parsed.data, tenant_id: req.tenantId }).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/designations/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = desigSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const { data, error } = await fastify.supabase
      .from('designations').update(parsed.data).eq('id', id).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })

  fastify.delete('/designations/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('designations').delete().eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Grades ────────────────────────────────────────────────────────────────
  fastify.get('/grades', auth, async (req, reply) => {
    const { data, error } = await fastify.supabase
      .from('grades').select('*').eq('tenant_id', req.tenantId).order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/grades', auth, async (req, reply) => {
    const parsed = gradeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const { data, error } = await fastify.supabase
      .from('grades').insert({ ...parsed.data, tenant_id: req.tenantId }).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/grades/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = gradeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const { data, error } = await fastify.supabase
      .from('grades').update(parsed.data).eq('id', id).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })

  fastify.delete('/grades/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('grades').delete().eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
