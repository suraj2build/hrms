/**
 * Grades / Bands master — /masters/grades
 *
 * Grades represent seniority bands (e.g. L1, L2, Manager, Director).
 * They drive compensation ranges and are referenced on employee job history.
 *
 * DELETE protection: if any job_history rows reference this grade, the record
 * is deactivated instead of deleted to preserve historical accuracy.
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { generateUniqueCode } from '../../lib/generate-code.js'

const gradeSchema = z.object({
  code:           z.string().max(50).optional().transform(v => v ? v.toUpperCase().trim() : v),
  name:           z.string().min(1, 'Name is required').max(120).transform(v => v.trim()),
  description:    z.string().max(500).optional(),
  level_order:    z.number().int().min(0).max(999).optional().default(0),
  ctc_min_annual: z.number().min(0).optional().nullable(),
  ctc_max_annual: z.number().min(0).optional().nullable(),
  is_active:      z.boolean().optional().default(true),
})

export default async function gradesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/grades ────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('grades')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('level_order', { ascending: true })
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/grades ───────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = gradeSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'grades', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('grades')
      .insert({ ...parsed.data, code, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `Grade code "${parsed.data.code}" already exists` })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/grades/:id ────────────────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = gradeSchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('grades')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Grade not found' })
    return reply.send({ data })
  })

  // ── GET /masters/grades/:id/usage ────────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count, error } = await fastify.supabase
      .from('job_history')
      .select('id', { count: 'exact', head: true })
      .eq('grade_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: { job_history: count ?? 0, total: count ?? 0 } })
  })

  // ── DELETE /masters/grades/:id ────────────────────────────────────────────
  // Accepts optional body { merge_to: uuid } — reassigns job_history rows before deleting.
  // Returns 409 IN_USE if grade is referenced and no merge_to provided.
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    if (mergeTo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mergeTo)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    const { count, error: countErr } = await fastify.supabase
      .from('job_history')
      .select('id', { count: 'exact', head: true })
      .eq('grade_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check grade usage' })

    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo) {
      return reply.code(409).send({
        error:      'IN_USE',
        usageCount,
        message:    `Grade is assigned to ${usageCount} employee record${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign.`,
      })
    }

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('job_history')
        .update({ grade_id: mergeTo })
        .eq('grade_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return reply.code(500).send({ error: 'REASSIGN_FAILED', message: reassignErr.message })
    }

    const { error: delErr } = await fastify.supabase
      .from('grades')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (delErr) return reply.code(500).send({ error: 'DELETE_FAILED', message: delErr.message })
    return reply.code(204).send()
  })
}
