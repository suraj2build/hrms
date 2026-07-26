/**
 * Structured exit interview — configurable questionnaire, responses, analytics.
 *
 *   HR manage template:  GET /exit-interview/template, POST/PUT/DELETE /exit-interview/questions
 *   Fill (HR or self):   GET/POST /employees/:id/exit-interview, POST .../submit
 *   Analytics (HR):      GET /separations/exit-analytics
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { isHrAdmin, resolveCallerEmployeeId } from '../../lib/manager-scope.js'
import { logAction } from '../../lib/audit-service.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const SEED_QUESTIONS = [
  { category: 'reason',       question_text: 'What is the primary reason for your departure?', response_type: 'single_choice', options: ['Better opportunity','Compensation & benefits','Work-life balance','Relationship with manager','Career growth','Relocation','Personal reasons','Other'], is_required: true },
  { category: 'job_role',     question_text: 'How satisfied were you with your role and responsibilities?', response_type: 'rating', is_required: true },
  { category: 'manager',      question_text: 'How would you rate your relationship with your manager?', response_type: 'rating' },
  { category: 'manager',      question_text: 'Did you receive regular feedback and support?', response_type: 'rating' },
  { category: 'culture',      question_text: 'How would you rate the company culture and work environment?', response_type: 'rating' },
  { category: 'compensation', question_text: 'How satisfied were you with your compensation and benefits?', response_type: 'rating' },
  { category: 'growth',       question_text: 'Were there adequate opportunities for learning and growth?', response_type: 'rating' },
  { category: 'work_life',    question_text: 'How would you rate your work-life balance?', response_type: 'rating' },
  { category: 'other',        question_text: 'What did you like most about working here?', response_type: 'text' },
  { category: 'other',        question_text: 'What could we have done better?', response_type: 'text' },
] as const

const questionSchema = z.object({
  category:      z.enum(['job_role','manager','culture','compensation','growth','work_life','reason','other']),
  question_text: z.string().min(1),
  response_type: z.enum(['rating','text','single_choice','boolean']),
  options:       z.array(z.string()).optional().default([]),
  display_order: z.number().int().optional(),
  is_required:   z.boolean().optional().default(false),
})

const responsesSchema = z.object({
  responses: z.array(z.object({
    question_id:   z.string().uuid(),
    rating:        z.number().int().min(1).max(5).nullable().optional(),
    response_text: z.string().nullable().optional(),
    choice:        z.string().nullable().optional(),
  })).default([]),
  overall_comments: z.string().nullable().optional(),
  would_recommend:  z.boolean().nullable().optional(),
})

export default async function exitInterviewRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  /** Get the tenant's active template + active questions, seeding a standard one if none exists. */
  async function getOrCreateTemplate(tenantId: string) {
    let { data: tpl } = await fastify.supabase
      .from('exit_interview_templates')
      .select('id, name, is_active')
      .eq('tenant_id', tenantId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()

    if (!tpl) {
      const { data: created } = await fastify.supabase
        .from('exit_interview_templates')
        .insert({ tenant_id: tenantId, name: 'Standard Exit Interview' })
        .select('id, name, is_active').single()
      tpl = created
      if (tpl) {
        await fastify.supabase.from('exit_interview_questions').insert(
          SEED_QUESTIONS.map((q, i) => ({
            tenant_id: tenantId, template_id: tpl!.id,
            category: q.category, question_text: q.question_text, response_type: q.response_type,
            options: ('options' in q ? q.options : []) ?? [], display_order: i,
            is_required: ('is_required' in q ? q.is_required : false) ?? false,
          })),
        )
      }
    }

    const { data: questions } = await fastify.supabase
      .from('exit_interview_questions')
      .select('*').eq('tenant_id', tenantId).eq('template_id', tpl!.id).eq('is_active', true)
      .order('display_order', { ascending: true })
    return { template: tpl!, questions: questions ?? [] }
  }

  async function canAccessEmployee(req: any, employeeId: string): Promise<boolean> {
    if (isHrAdmin(req.userRole)) return true
    return (await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)) === employeeId
  }

  // ── HR: template + question management ────────────────────────────────────
  fastify.get('/exit-interview/template', hrAdminAuth, async (req: any, reply) => {
    return reply.send({ data: await getOrCreateTemplate(req.tenantId) })
  })

  fastify.post('/exit-interview/questions', hrAdminAuth, async (req: any, reply) => {
    const parsed = questionSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { template } = await getOrCreateTemplate(req.tenantId)
    const { data, error } = await fastify.supabase
      .from('exit_interview_questions')
      .insert({ ...parsed.data, tenant_id: req.tenantId, template_id: template.id })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create exit interview question')
    return reply.code(201).send({ data })
  })

  fastify.put('/exit-interview/questions/:qid', hrAdminAuth, async (req: any, reply) => {
    const parsed = questionSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('exit_interview_questions')
      .update(parsed.data).eq('id', req.params.qid).eq('tenant_id', req.tenantId)
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update exit interview question')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Question not found' })
    return reply.send({ data })
  })

  fastify.delete('/exit-interview/questions/:qid', hrAdminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('exit_interview_questions')
      .update({ is_active: false }).eq('id', req.params.qid).eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to delete exit interview question')
    return reply.code(204).send()
  })

  // ── Fill (HR or the separating employee) ──────────────────────────────────
  fastify.get('/employees/:id/exit-interview', auth, async (req: any, reply) => {
    if (!await canAccessEmployee(req, req.params.id))
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not allowed' })

    const { data: sep } = await fastify.supabase
      .from('employee_separation')
      .select('id, exit_interview_status, exit_interview_overall_comments, exit_interview_would_recommend, exit_interview_done, exit_interview_date')
      .eq('employee_id', req.params.id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!sep) return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record for this employee' })

    const { template, questions } = await getOrCreateTemplate(req.tenantId)
    const { data: responses } = await fastify.supabase
      .from('exit_interview_responses')
      .select('question_id, rating, response_text, choice')
      .eq('tenant_id', req.tenantId).eq('separation_id', sep.id)

    return reply.send({ data: {
      separation_id:    sep.id,
      status:           sep.exit_interview_status,
      overall_comments: sep.exit_interview_overall_comments,
      would_recommend:  sep.exit_interview_would_recommend,
      submitted:        sep.exit_interview_done,
      submitted_date:   sep.exit_interview_date,
      template, questions, responses: responses ?? [],
    } })
  })

  async function upsertResponses(tenantId: string, separationId: string, responses: any[]) {
    if (!responses.length) return null
    const rows = responses.map(r => ({
      tenant_id: tenantId, separation_id: separationId, question_id: r.question_id,
      rating: r.rating ?? null, response_text: r.response_text ?? null, choice: r.choice ?? null,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await fastify.supabase
      .from('exit_interview_responses')
      .upsert(rows, { onConflict: 'separation_id,question_id' })
    return error
  }

  fastify.post('/employees/:id/exit-interview', auth, async (req: any, reply) => {
    if (!await canAccessEmployee(req, req.params.id))
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not allowed' })
    const parsed = responsesSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data: sep } = await fastify.supabase
      .from('employee_separation')
      .select('id, exit_interview_status, exit_interview_template_id')
      .eq('employee_id', req.params.id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!sep) return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record for this employee' })
    if (sep.exit_interview_status === 'submitted')
      return reply.code(409).send({ error: 'ALREADY_SUBMITTED', message: 'Exit interview already submitted' })

    const { template } = await getOrCreateTemplate(req.tenantId)
    const err = await upsertResponses(req.tenantId, sep.id, parsed.data.responses)
    if (err) return serverError(req, reply, err, ErrorCode.UPDATE_FAILED, 'Failed to save exit interview responses')

    await fastify.supabase.from('employee_separation').update({
      exit_interview_status:           'draft',
      exit_interview_template_id:      sep.exit_interview_template_id ?? template.id,
      exit_interview_overall_comments: parsed.data.overall_comments ?? null,
      exit_interview_would_recommend:  parsed.data.would_recommend ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', sep.id).eq('tenant_id', req.tenantId)

    return reply.send({ message: 'Saved', status: 'draft' })
  })

  fastify.post('/employees/:id/exit-interview/submit', auth, async (req: any, reply) => {
    if (!await canAccessEmployee(req, req.params.id))
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not allowed' })
    const parsed = responsesSchema.safeParse(req.body ?? {})

    const { data: sep } = await fastify.supabase
      .from('employee_separation')
      .select('id, exit_interview_status, exit_interview_template_id')
      .eq('employee_id', req.params.id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!sep) return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record' })
    if (sep.exit_interview_status === 'submitted')
      return reply.code(409).send({ error: 'ALREADY_SUBMITTED', message: 'Already submitted' })

    const { template, questions } = await getOrCreateTemplate(req.tenantId)
    if (parsed.success && parsed.data.responses.length) {
      const err = await upsertResponses(req.tenantId, sep.id, parsed.data.responses)
      if (err) return serverError(req, reply, err, ErrorCode.UPDATE_FAILED, 'Failed to save exit interview responses')
    }

    // Required-field guard
    const { data: existing } = await fastify.supabase
      .from('exit_interview_responses')
      .select('question_id, rating, response_text, choice')
      .eq('tenant_id', req.tenantId).eq('separation_id', sep.id)
    const answered = new Map((existing ?? []).map((r: any) => [r.question_id, r]))
    const missing = questions.filter((q: any) => {
      if (!q.is_required) return false
      const a = answered.get(q.id)
      if (!a) return true
      if (q.response_type === 'rating')        return a.rating == null
      if (q.response_type === 'single_choice') return !a.choice
      if (q.response_type === 'boolean')       return a.choice == null
      return !a.response_text
    })
    if (missing.length) return reply.code(400).send({ error: 'REQUIRED', message: `Please answer all required questions (${missing.length} pending)` })

    const overall  = parsed.success ? parsed.data.overall_comments : undefined
    const wouldRec = parsed.success ? parsed.data.would_recommend : undefined
    const { error: submitErr } = await fastify.supabase.from('employee_separation').update({
      exit_interview_status:      'submitted',
      exit_interview_done:        true,
      exit_interview_date:        new Date().toISOString().slice(0, 10),
      exit_interview_template_id: sep.exit_interview_template_id ?? template.id,
      exit_interview_submitted_by: req.userId,
      ...(overall  !== undefined ? { exit_interview_overall_comments: overall } : {}),
      ...(wouldRec !== undefined ? { exit_interview_would_recommend: wouldRec } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', sep.id).eq('tenant_id', req.tenantId)
    // If this fails, exit_interview_status silently stays 'draft' forever — the
    // candidate would be told submission succeeded, and the ALREADY_SUBMITTED
    // guard above would never trigger, leaving resubmission unprotected.
    if (submitErr) return serverError(req, reply, submitErr, ErrorCode.UPDATE_FAILED, 'Failed to mark exit interview as submitted')

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { exit_interview: 'submitted' },
    })
    return reply.send({ message: 'Exit interview submitted', status: 'submitted' })
  })

  // ── Analytics (HR) ────────────────────────────────────────────────────────
  fastify.get('/separations/exit-analytics', hrAdminAuth, async (req: any, reply) => {
    // Both queries below can exceed PostgREST's 1,000-row cap for a
    // long-lived enterprise tenant (separations/responses accumulate over
    // the company's lifetime), silently truncating by_category/top_reasons
    // with no error.
    const seps = await fetchAllRows<any>((from, to) =>
      fastify.supabase
        .from('employee_separation')
        .select('id, exit_interview_would_recommend')
        .eq('tenant_id', req.tenantId).eq('exit_interview_status', 'submitted')
        .range(from, to),
    )
    const sepIds = seps.map((s: any) => s.id)
    if (sepIds.length === 0) {
      return reply.send({ data: { total: 0, would_recommend_pct: null, by_category: [], top_reasons: [] } })
    }

    const [responses, { data: questions }] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        fastify.supabase.from('exit_interview_responses').select('separation_id, question_id, rating, choice')
          .eq('tenant_id', req.tenantId).in('separation_id', sepIds).range(from, to),
      ),
      fastify.supabase.from('exit_interview_questions').select('id, category, response_type').eq('tenant_id', req.tenantId),
    ])
    const qById = new Map((questions ?? []).map((q: any) => [q.id, q]))
    const catAgg: Record<string, { sum: number; n: number }> = {}
    const reasonAgg: Record<string, number> = {}
    for (const r of responses) {
      const q = qById.get(r.question_id); if (!q) continue
      if (q.response_type === 'rating' && r.rating != null) {
        catAgg[q.category] ??= { sum: 0, n: 0 }
        catAgg[q.category].sum += r.rating; catAgg[q.category].n++
      }
      if (q.category === 'reason' && r.choice) reasonAgg[r.choice] = (reasonAgg[r.choice] ?? 0) + 1
    }
    const by_category = Object.entries(catAgg).map(([category, v]) => ({ category, avg_rating: Math.round((v.sum / v.n) * 10) / 10, responses: v.n }))
    const top_reasons = Object.entries(reasonAgg).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
    const recVals = (seps ?? []).map((s: any) => s.exit_interview_would_recommend).filter((v: any) => v != null)
    const would_recommend_pct = recVals.length ? Math.round((recVals.filter((v: boolean) => v).length / recVals.length) * 100) : null

    return reply.send({ data: { total: sepIds.length, would_recommend_pct, by_category, top_reasons } })
  })
}
