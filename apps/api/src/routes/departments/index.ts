import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateUniqueCode } from '../../lib/generate-code.js'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const deptSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  parent_id: z.string().uuid().optional(),
})

const desigSchema = z.object({
  name: z.string().min(1),
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

  fastify.get('/departments/:id/usage', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId

    const [jobHistoryResult, childDeptsResult] = await Promise.all([
      fastify.supabase
        .from('job_history')
        .select('*', { count: 'exact', head: true })
        .eq('department_id', id)
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('departments')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', id)
        .eq('tenant_id', tenantId),
    ])

    if (jobHistoryResult.error) return reply.code(500).send({ error: 'DB_ERROR', message: jobHistoryResult.error.message })
    if (childDeptsResult.error) return reply.code(500).send({ error: 'DB_ERROR', message: childDeptsResult.error.message })

    const job_history = jobHistoryResult.count ?? 0
    const child_departments = childDeptsResult.count ?? 0
    return reply.send({ data: { job_history, child_departments, total: job_history + child_departments } })
  })

  fastify.post('/departments', auth, async (req, reply) => {
    const parsed = deptSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    if (!req.tenantId) return reply.code(403).send({ error: 'NO_TENANT', message: 'No tenant context' })

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'departments', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('departments')
      .insert({ ...parsed.data, code, tenant_id: req.tenantId })
      .select().single()

    if (error) {
      req.log.error({ err: error, tenant_id: req.tenantId, code }, 'department create failed')
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: `A department with code "${code}" already exists` })
      }
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
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
    const tenantId = req.tenantId
    const merge_to = (req.body as any)?.merge_to as string | undefined

    if (merge_to !== undefined && !uuidRegex.test(merge_to)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    const [jobHistoryResult, childDeptsResult] = await Promise.all([
      fastify.supabase
        .from('job_history')
        .select('*', { count: 'exact', head: true })
        .eq('department_id', id)
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('departments')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', id)
        .eq('tenant_id', tenantId),
    ])

    if (jobHistoryResult.error) return reply.code(500).send({ error: 'DB_ERROR', message: jobHistoryResult.error.message })
    if (childDeptsResult.error) return reply.code(500).send({ error: 'DB_ERROR', message: childDeptsResult.error.message })

    const usageCount = (jobHistoryResult.count ?? 0) + (childDeptsResult.count ?? 0)

    if (usageCount > 0 && !merge_to) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: 'Department is in use. Provide merge_to to reassign.',
      })
    }

    if (merge_to) {
      const [jhUpdate, childUpdate] = await Promise.all([
        fastify.supabase
          .from('job_history')
          .update({ department_id: merge_to })
          .eq('department_id', id)
          .eq('tenant_id', tenantId),
        fastify.supabase
          .from('departments')
          .update({ parent_id: merge_to })
          .eq('parent_id', id)
          .eq('tenant_id', tenantId),
      ])
      if (jhUpdate.error) return reply.code(500).send({ error: 'DB_ERROR', message: jhUpdate.error.message })
      if (childUpdate.error) return reply.code(500).send({ error: 'DB_ERROR', message: childUpdate.error.message })
    }

    const { error } = await fastify.supabase
      .from('departments').delete().eq('id', id).eq('tenant_id', tenantId)
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

  fastify.get('/designations/:id/usage', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId

    const { count, error } = await fastify.supabase
      .from('job_history')
      .select('*', { count: 'exact', head: true })
      .eq('designation_id', id)
      .eq('tenant_id', tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const job_history = count ?? 0
    return reply.send({ data: { job_history, total: job_history } })
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
    const tenantId = req.tenantId
    const merge_to = (req.body as any)?.merge_to as string | undefined

    if (merge_to !== undefined && !uuidRegex.test(merge_to)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    const { count, error: countError } = await fastify.supabase
      .from('job_history')
      .select('*', { count: 'exact', head: true })
      .eq('designation_id', id)
      .eq('tenant_id', tenantId)

    if (countError) return reply.code(500).send({ error: 'DB_ERROR', message: countError.message })

    const usageCount = count ?? 0

    if (usageCount > 0 && !merge_to) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: 'Designation is in use. Provide merge_to to reassign.',
      })
    }

    if (merge_to) {
      const { error: updateError } = await fastify.supabase
        .from('job_history')
        .update({ designation_id: merge_to })
        .eq('designation_id', id)
        .eq('tenant_id', tenantId)
      if (updateError) return reply.code(500).send({ error: 'DB_ERROR', message: updateError.message })
    }

    const { error } = await fastify.supabase
      .from('designations').delete().eq('id', id).eq('tenant_id', tenantId)
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

  fastify.get('/grades/:id/usage', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId

    const { count, error } = await fastify.supabase
      .from('job_history')
      .select('*', { count: 'exact', head: true })
      .eq('grade_id', id)
      .eq('tenant_id', tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const job_history = count ?? 0
    return reply.send({ data: { job_history, total: job_history } })
  })

  fastify.post('/grades', auth, async (req, reply) => {
    const parsed = gradeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'grades', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('grades').insert({ ...parsed.data, code, tenant_id: req.tenantId }).select().single()
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
    const tenantId = req.tenantId
    const merge_to = (req.body as any)?.merge_to as string | undefined

    if (merge_to !== undefined && !uuidRegex.test(merge_to)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    const { count, error: countError } = await fastify.supabase
      .from('job_history')
      .select('*', { count: 'exact', head: true })
      .eq('grade_id', id)
      .eq('tenant_id', tenantId)

    if (countError) return reply.code(500).send({ error: 'DB_ERROR', message: countError.message })

    const usageCount = count ?? 0

    if (usageCount > 0 && !merge_to) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: 'Grade is in use. Provide merge_to to reassign.',
      })
    }

    if (merge_to) {
      const { error: updateError } = await fastify.supabase
        .from('job_history')
        .update({ grade_id: merge_to })
        .eq('grade_id', id)
        .eq('tenant_id', tenantId)
      if (updateError) return reply.code(500).send({ error: 'DB_ERROR', message: updateError.message })
    }

    const { error } = await fastify.supabase
      .from('grades').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
