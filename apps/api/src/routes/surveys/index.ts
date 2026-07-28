import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Sentiment helpers ──────────────────────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  'good','great','excellent','amazing','love','like','happy','satisfied','helpful',
  'easy','positive','better','best','wonderful','fantastic','awesome','clear',
  'efficient','supportive','collaborative','comfortable','fair','transparent',
  'motivated','engaged','proud','enjoy','excited','appreciate','smooth','quick',
  'effective','well','nice','perfect','outstanding','impressive','flexible',
  'inclusive','respect','trust','growth','opportunity','learn','improve','strong',
])

const NEGATIVE_WORDS = new Set([
  'bad','poor','terrible','awful','hate','dislike','unhappy','unsatisfied',
  'difficult','hard','negative','worse','worst','frustrating','unclear','slow',
  'confusing','boring','stressed','stress','pressure','unfair','lack','missing',
  'issue','problem','concern','complaint','disappointed','overwhelmed','burnout',
  'toxic','micromanage','micromanaging','rigid','bureaucratic','chaotic','messy',
  'bias','biased','discriminate','ignore','ignored','overwork','overloaded',
  'underpaid','unappreciated','turnover','leave','quit','resign','waste',
])

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','must','shall',
  'and','or','but','if','because','so','yet','for','nor','as','at','by','in',
  'of','on','to','up','it','its','i','we','you','he','she','they','my','our',
  'your','his','her','their','this','that','these','those','what','which','who',
  'how','when','where','why','all','more','some','any','no','not','very','just',
  'also','with','from','about','into','than','then','there','here','can','get',
])

function analyseSentiment(texts: string[]): {
  positive: number; neutral: number; negative: number; keywords: string[]
} {
  let pos = 0, neg = 0, neu = 0
  const wordFreq: Record<string, number> = {}

  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
    let p = 0, n = 0
    for (const w of words) {
      if (POSITIVE_WORDS.has(w)) p++
      if (NEGATIVE_WORDS.has(w)) n++
      if (!STOP_WORDS.has(w) && w.length > 3) {
        wordFreq[w] = (wordFreq[w] ?? 0) + 1
      }
    }
    if (p > n)      pos++
    else if (n > p) neg++
    else            neu++
  }

  const keywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)

  return { positive: pos, neutral: neu, negative: neg, keywords }
}

// ── Body schemas ─────────────────────────────────────────────────────────────

const SubmitSurveySchema = z.object({
  responses: z.array(z.object({
    question_id: z.string(),
    response: z.unknown(),
  })),
})

const CreateSurveySchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  questions: z.array(z.object({
    question_text: z.string(),
    question_type: z.enum(['text', 'rating', 'single', 'multi']),
    options: z.array(z.string()).nullable().optional(),
    required: z.boolean().optional(),
    order_idx: z.number().optional(),
  })).optional(),
})

const UpdateSurveySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
  due_date: z.string().optional(),
})

const AssignSurveySchema = z.object({
  employee_ids: z.array(z.string()).optional(),
  assign_all: z.boolean().optional(),
})

const FromTemplateSchema = z.object({
  template_id: z.string().min(1, 'template_id is required'),
  title: z.string().optional(),
  due_date: z.string().nullable().optional(),
  is_anonymous: z.boolean().optional(),
})

const TriggerLifecycleSchema = z.object({
  lifecycle_type: z.string().min(1, 'lifecycle_type is required'),
  employee_ids: z.array(z.string()).optional(),
})

const Setup360Schema = z.object({
  peer_count: z.number().int().min(1).optional(),
  deadline_days: z.number().int().min(1).optional(),
  self_review: z.boolean().optional(),
  manager_review: z.boolean().optional(),
})

const Approve360Schema = z.object({
  nominator_ids: z.array(z.string()),
  status: z.enum(['open', 'nomination_open', 'approved', 'surveys_sent', 'closed']).optional(),
})

const Nominate360Schema = z.object({
  employee_ids: z.array(z.string()).min(1, 'employee_ids is required'),
})

export default async function surveyRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }
  const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  async function getEmployeeId(profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('employees')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle()
    return data?.id ?? null
  }

  async function getTenantId(profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', profileId)
      .maybeSingle()
    return data?.tenant_id ?? null
  }

  // ── ESS: list my assigned surveys ──────────────────────────────────────────────

  fastify.get('/my', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const empId = await getEmployeeId((req as any).userId)
    if (!empId) return reply.send({ data: [] })

    const { data, error } = await supabase
      .from('survey_assignments')
      .select(`
        id, assigned_at, completed_at,
        survey:surveys(id, title, description, due_date, status)
      `)
      .eq('employee_id', empId)
      .order('assigned_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch your surveys')
    return reply.send({ data: data ?? [] })
  })

  // ── ESS: get survey + questions (to take) ──────────────────────────────────────

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const empId = await getEmployeeId((req as any).userId)
    if (!empId) return reply.status(403).send({ error: 'Employee profile not found' })

    const { data: assignment } = await supabase
      .from('survey_assignments')
      .select('id, completed_at')
      .eq('survey_id', id)
      .eq('employee_id', empId)
      .maybeSingle()

    if (!assignment) return reply.status(404).send({ error: 'Survey not assigned to you' })

    const { data: survey, error } = await supabase
      .from('surveys')
      .select('id, title, description, due_date, status')
      .eq('id', id)
      .maybeSingle()

    if (error || !survey) return reply.status(404).send({ error: 'Survey not found' })
    if (survey.status !== 'active') return reply.status(400).send({ error: 'Survey is not active' })

    const { data: questions } = await supabase
      .from('survey_questions')
      .select('id, order_idx, question_text, question_type, options, required')
      .eq('survey_id', id)
      .order('order_idx')

    return reply.send({
      data: {
        ...survey,
        assignment_id: assignment.id,
        completed:     !!assignment.completed_at,
        questions:     questions ?? [],
      },
    })
  })

  // ── ESS: submit survey responses ───────────────────────────────────────────────

  fastify.post('/:id/submit', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = SubmitSurveySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { responses } = parsed.data
    const empId = await getEmployeeId((req as any).userId)
    if (!empId) return reply.status(403).send({ error: 'Employee profile not found' })

    const { data: assignment } = await supabase
      .from('survey_assignments')
      .select('id, completed_at, tenant_id')
      .eq('survey_id', id)
      .eq('employee_id', empId)
      .maybeSingle()

    if (!assignment) return reply.status(404).send({ error: 'Survey not assigned to you' })
    if (assignment.completed_at) return reply.status(400).send({ error: 'Survey already completed' })

    // survey_responses.employee_id/response_value/response_type/survey_type
    // (migration 351) are denormalized fields the intelligence scanner's
    // onboarding-score-degradation query reads directly — without populating
    // them here, that scanner's queries always return zero rows and can
    // never detect a real Day-30 → Day-60 score drop.
    const [{ data: surveyRow, error: surveyErr }, { data: qRows, error: qErr }] = await Promise.all([
      supabase.from('surveys').select('survey_type').eq('id', id).maybeSingle(),
      supabase.from('survey_questions').select('id, question_type').in('id', responses.map(r => r.question_id)),
    ])
    if (surveyErr) return serverError(req, reply, surveyErr, ErrorCode.QUERY_FAILED, 'Failed to fetch survey')
    if (qErr) return serverError(req, reply, qErr, ErrorCode.QUERY_FAILED, 'Failed to fetch survey questions')

    const surveyType = (surveyRow as any)?.survey_type ?? null
    const questionTypeMap = new Map(((qRows ?? []) as any[]).map(q => [q.id, q.question_type]))

    const rows = responses.map(r => ({
      assignment_id:  assignment.id,
      question_id:    r.question_id,
      tenant_id:      assignment.tenant_id,
      response:       r.response,
      employee_id:    empId,
      response_type:  questionTypeMap.get(r.question_id) ?? 'text',
      response_value: r.response == null ? null : (typeof r.response === 'string' ? r.response : JSON.stringify(r.response)),
      survey_type:    surveyType,
    }))

    const { error: respErr } = await supabase
      .from('survey_responses')
      .upsert(rows, { onConflict: 'assignment_id,question_id' })

    if (respErr) return serverError(req, reply, respErr, ErrorCode.INSERT_FAILED, 'Failed to save survey responses')

    // Fold the completed_at guard into this UPDATE's own WHERE clause — the
    // earlier SELECT above is a separate query, so two concurrent submits
    // could both pass it before either writes. This UPDATE only succeeds for
    // whichever request gets there first.
    const { error: completeErr } = await supabase
      .from('survey_assignments')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', assignment.id)
      .is('completed_at', null)

    if (completeErr) return serverError(req, reply, completeErr, ErrorCode.UPDATE_FAILED, 'Responses saved but failed to mark survey complete')

    // LLM sentiment analysis for text responses (best-effort, async)
    const textResponses = responses
      .filter(r => typeof r.response === 'string' && (r.response as string).trim().length > 10)
      .map(r => r.response as string)

    if (textResponses.length > 0) {
      ;(async () => {
        try {
          const msg = await ai.messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: 'You are an HR analytics assistant. Analyze survey text responses and return JSON only.',
            messages: [{
              role:    'user',
              content: `Analyze these survey text responses and return ONLY JSON with keys: sentiment ("positive"|"neutral"|"negative"), urgency ("low"|"medium"|"high"), themes (array of max 3 short strings).\n\nResponses:\n${textResponses.join('\n---\n')}`,
            }],
          })
          const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '{}'
          const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())

          // Store analysis for each text response
          for (const r of rows.filter(rr => typeof rr.response === 'string' && (rr.response as string).trim().length > 10)) {
            const { data: savedResp } = await supabase
              .from('survey_responses')
              .select('id')
              .eq('assignment_id', assignment.id)
              .eq('question_id', r.question_id)
              .maybeSingle()
            if (savedResp?.id) {
              await supabase.from('survey_response_analysis').upsert({
                response_id: savedResp.id,
                tenant_id:   assignment.tenant_id,
                sentiment:   parsed.sentiment ?? 'neutral',
                themes:      parsed.themes ?? [],
                urgency:     parsed.urgency ?? 'low',
              }, { onConflict: 'response_id' })
            }
          }
        } catch (_) { /* non-blocking */ }
      })()
    }

    return reply.send({ data: { ok: true } })
  })

  // ── Admin: list all surveys ────────────────────────────────────────────────────

  fastify.get('/admin', hrAuth, async (req: any, reply) => {
    const { data, error } = await supabase
      .from('surveys')
      .select('id, title, description, status, due_date, created_at, survey_type, is_anonymous')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch surveys')

    const surveyIds = (data ?? []).map(s => s.id)
    const statsMap: Record<string, { total: number; completed: number }> = {}

    if (surveyIds.length) {
      // A tenant running several assign-all surveys can have assignment
      // counts well past PostgREST's 1,000-row cap — an unbounded .select()
      // would silently under-report total_assigned/total_completed here.
      const asgns = await fetchAllRows<{ survey_id: string; completed_at: string | null }>((from, to) =>
        supabase
          .from('survey_assignments')
          .select('survey_id, completed_at')
          .eq('tenant_id', req.tenantId)
          .in('survey_id', surveyIds)
          .range(from, to),
      )

      for (const a of asgns) {
        if (!statsMap[a.survey_id]) statsMap[a.survey_id] = { total: 0, completed: 0 }
        statsMap[a.survey_id].total++
        if (a.completed_at) statsMap[a.survey_id].completed++
      }
    }

    return reply.send({
      data: (data ?? []).map(s => ({
        ...s,
        total_assigned:  statsMap[s.id]?.total    ?? 0,
        total_completed: statsMap[s.id]?.completed ?? 0,
      })),
    })
  })

  // ── Admin: create survey ───────────────────────────────────────────────────────

  fastify.post('/admin', hrAuth, async (req, reply) => {
    const parsed = CreateSurveySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { title, description, due_date, questions } = parsed.data
    const profileId = (req as any).userId
    const tenantId  = await getTenantId(profileId)
    if (!tenantId) return reply.status(400).send({ error: 'Tenant not found' })

    const { data: survey, error } = await supabase
      .from('surveys')
      .insert({ title, description, due_date, created_by: profileId, tenant_id: tenantId })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create survey')

    if (questions?.length) {
      const questionRows = questions.map((q, i) => ({
        survey_id:     survey.id,
        tenant_id:     tenantId,
        order_idx:     q.order_idx ?? i,
        question_text: q.question_text,
        question_type: q.question_type,
        options:       q.options?.length ? q.options : null,
        required:      q.required ?? true,
      }))
      const { error: qErr } = await supabase.from('survey_questions').insert(questionRows)
      if (qErr) return serverError(req, reply, qErr, ErrorCode.INSERT_FAILED, 'Survey created but failed to save questions')
    }

    return reply.status(201).send({ data: { id: survey.id } })
  })

  // ── Admin: get survey detail ───────────────────────────────────────────────────

  fastify.get('/admin/:id', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = (req as any).tenantId

    const { data: survey, error } = await supabase
      .from('surveys')
      .select('id, title, description, status, due_date, created_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error || !survey) return reply.status(404).send({ error: 'Survey not found' })

    const [{ data: questions }, { data: assignments }] = await Promise.all([
      supabase
        .from('survey_questions')
        .select('id, order_idx, question_text, question_type, options, required')
        .eq('survey_id', id)
        .eq('tenant_id', tenantId)
        .order('order_idx'),
      supabase
        .from('survey_assignments')
        .select('id, assigned_at, completed_at, employee:employees(id, first_name, last_name, employee_code)')
        .eq('survey_id', id)
        .eq('tenant_id', tenantId)
        .order('assigned_at', { ascending: false }),
    ])

    return reply.send({
      data: {
        ...survey,
        questions:   questions   ?? [],
        assignments: assignments ?? [],
      },
    })
  })

  // ── Admin: update survey ───────────────────────────────────────────────────────

  fastify.patch('/admin/:id', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = UpdateSurveySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const updates = parsed.data

    const { error } = await supabase
      .from('surveys')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', (req as any).tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update survey')
    return reply.send({ data: { ok: true } })
  })

  // ── Admin: assign survey to employees ─────────────────────────────────────────

  fastify.post('/admin/:id/assign', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = AssignSurveySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { employee_ids, assign_all } = parsed.data
    const profileId = (req as any).userId
    const tenantId  = await getTenantId(profileId)
    if (!tenantId) return reply.status(400).send({ error: 'Tenant not found' })

    const { data: survey } = await supabase
      .from('surveys')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!survey) return reply.status(404).send({ error: 'Survey not found' })

    let empIds = employee_ids ?? []

    if (!assign_all && empIds.length) {
      // employee_ids is caller-supplied — verify every id belongs to this
      // tenant before it's used, otherwise survey_assignments rows could be
      // created referencing another tenant's employee under this tenant_id.
      const uniqueEmpIds = [...new Set(empIds)]
      const { data: validEmps } = await supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', uniqueEmpIds)
      if ((validEmps?.length ?? 0) !== uniqueEmpIds.length) {
        return reply.status(400).send({ error: 'INVALID_EMPLOYEES', message: 'One or more employees were not found in your organisation' })
      }
    }

    if (assign_all) {
      // Paginated — an unbounded .select() truncates at PostgREST's 1,000-row
      // ceiling, so "assign to all" would silently only reach the first 1,000
      // active employees for a larger tenant with no error or indication.
      const emps = await fetchAllRows<{ id: string }>((from, to) =>
        supabase
          .from('employees')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .range(from, to),
      )
      empIds = emps.map(e => e.id)
    }

    if (!empIds.length) return reply.status(400).send({ error: 'No employees to assign' })

    const rows = empIds.map(eid => ({
      survey_id:   id,
      employee_id: eid,
      tenant_id:   tenantId,
    }))

    const { error } = await supabase
      .from('survey_assignments')
      .upsert(rows, { onConflict: 'survey_id,employee_id', ignoreDuplicates: true })

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to assign survey')
    return reply.send({ data: { assigned: empIds.length } })
  })

  // ── Admin: survey results ──────────────────────────────────────────────────────

  fastify.get('/admin/:id/results', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = (req as any).tenantId

    const { data: survey } = await supabase
      .from('surveys')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!survey) return reply.status(404).send({ error: 'Survey not found' })

    const { data: questions } = await supabase
      .from('survey_questions')
      .select('id, order_idx, question_text, question_type, options')
      .eq('survey_id', id)
      .eq('tenant_id', tenantId)
      .order('order_idx')

    // Assign-all surveys can generate assignment counts well past
    // PostgREST's 1,000-row cap — an unbounded .select() would silently
    // undercount total_assigned/total_completed with no error.
    const assignments = await fetchAllRows<{ id: string; completed_at: string | null }>((from, to) =>
      supabase
        .from('survey_assignments')
        .select('id, completed_at')
        .eq('survey_id', id)
        .eq('tenant_id', tenantId)
        .range(from, to),
    )

    const assignmentIds   = assignments.map(a => a.id)
    const totalAssigned   = assignmentIds.length
    const totalCompleted  = assignments.filter(a => a.completed_at).length

    const responsesByQ: Record<string, unknown[]> = {}

    if (assignmentIds.length) {
      // Response rows = assignments × questions, so this can exceed 1,000
      // even faster than the assignments query above.
      const responses = await fetchAllRows<{ question_id: string; response: unknown }>((from, to) =>
        supabase
          .from('survey_responses')
          .select('question_id, response')
          .eq('tenant_id', tenantId)
          .in('assignment_id', assignmentIds)
          .range(from, to),
      )

      for (const r of responses) {
        if (!responsesByQ[r.question_id]) responsesByQ[r.question_id] = []
        responsesByQ[r.question_id].push(r.response)
      }
    }

    const questionResults = (questions ?? []).map(q => {
      const responses = responsesByQ[q.id] ?? []
      let summary: unknown

      if (q.question_type === 'rating') {
        const nums = responses.filter(r => typeof r === 'number') as number[]
        const avg  = nums.length
          ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length * 10) / 10
          : null
        const dist = [1, 2, 3, 4, 5].map(n => ({ score: n, count: nums.filter(v => v === n).length }))
        summary = { avg, count: nums.length, distribution: dist }
      } else if (q.question_type === 'single' || q.question_type === 'multi') {
        const flat = q.question_type === 'multi'
          ? (responses as string[][]).flat()
          : (responses as string[])
        const counts: Record<string, number> = {}
        for (const v of flat) counts[v] = (counts[v] ?? 0) + 1
        summary = { counts, total: flat.length }
      } else {
        const answers = responses as string[]
        const sentiment = answers.length ? analyseSentiment(answers) : null
        summary = { answers, count: answers.length, sentiment }
      }

      return { ...q, response_count: responses.length, summary }
    })

    // Location breakdown
    const assignedEmps = await fetchAllRows<any>((from, to) =>
      supabase
        .from('survey_assignments')
        .select('id, completed_at, employee_id, employees(work_location_id, work_locations(id, name))')
        .eq('survey_id', id)
        .eq('tenant_id', tenantId)
        .range(from, to),
    )
    const locMap: Record<string, { name: string; total: number; completed: number }> = {}
    for (const a of assignedEmps) {
      const locId   = a.employees?.work_location_id ?? '__none__'
      const locName = a.employees?.work_locations?.name ?? 'Unassigned'
      if (!locMap[locId]) locMap[locId] = { name: locName, total: 0, completed: 0 }
      locMap[locId].total++
      if (a.completed_at) locMap[locId].completed++
    }
    const location_breakdown = Object.entries(locMap).map(([id, v]) => ({
      location_id: id === '__none__' ? null : id,
      location_name: v.name,
      total: v.total,
      completed: v.completed,
      rate: v.total > 0 ? Math.round(v.completed / v.total * 100) : 0,
    }))

    return reply.send({
      data: {
        total_assigned:   totalAssigned,
        total_completed:  totalCompleted,
        completion_rate:  totalAssigned
          ? Math.round(totalCompleted / totalAssigned * 100)
          : 0,
        questions:         questionResults,
        location_breakdown,
      },
    })
  })

  // ── Admin: list survey templates ───────────────────────────────────────────────

  fastify.get('/admin/templates', hrAuth, async (_req, reply) => {
    const { data } = await supabase.from('survey_templates').select('*').order('survey_type').limit(200)
    return reply.send({ data: data ?? [] })
  })

  // ── Admin: create survey from template ─────────────────────────────────────────

  fastify.post('/admin/from-template', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const parsed = FromTemplateSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { template_id, title, due_date, is_anonymous = false } = parsed.data

    const { data: tmpl, error: te } = await supabase
      .from('survey_templates')
      .select('*')
      .eq('id', template_id)
      .single()
    if (te || !tmpl) return reply.status(404).send({ error: 'Template not found' })

    const { data: survey, error: se } = await supabase
      .from('surveys')
      .insert({
        tenant_id:   tenantId,
        title:       title || tmpl.name,
        description: tmpl.description,
        status:      'draft',
        survey_type: tmpl.survey_type,
        is_anonymous,
        due_date:    due_date || null,
        created_by:  (req as any).userId,
      })
      .select('id')
      .single()
    if (se || !survey) return serverError(req, reply, se, ErrorCode.INSERT_FAILED, 'Failed to create survey from template')

    const questions = (tmpl.questions as any[]).map(q => ({
      ...q,
      survey_id: survey.id,
      tenant_id: tenantId,
    }))
    const { error: qErr } = await supabase.from('survey_questions').insert(questions)
    if (qErr) return serverError(req, reply, qErr, ErrorCode.INSERT_FAILED, 'Survey created but failed to save questions')

    return reply.status(201).send({
      data: { id: survey.id, title: title || tmpl.name, survey_type: tmpl.survey_type },
    })
  })

  // ── Admin: engagement report for annual_engagement surveys ─────────────────────

  fastify.get('/admin/engagement-report/:id', hrAuth, async (req: any, reply) => {
    const { id }      = req.params as { id: string }
    const tenantId    = req.tenantId

    const { data: survey } = await supabase
      .from('surveys')
      .select('title, survey_type, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!survey) return reply.status(404).send({ error: 'Survey not found' })

    // Fetch questions (dimension stored in options JSONB or top-level)
    const { data: questions } = await supabase
      .from('survey_questions')
      .select('id, question_text, question_type, options')
      .eq('survey_id', id)

    // Fetch responses via assignment join
    const { data: assignments } = await supabase
      .from('survey_assignments')
      .select('id')
      .eq('survey_id', id)

    const assignmentIds = (assignments ?? []).map((a: any) => a.id)
    let responses: { question_id: string; response: unknown }[] = []

    if (assignmentIds.length) {
      const { data: resp } = await supabase
        .from('survey_responses')
        .select('question_id, response')
        .in('assignment_id', assignmentIds)
      responses = resp ?? []
    }

    // Build question map — dimension may be a top-level field (from template JSONB) or inside options
    const qMap = new Map((questions ?? []).map((q: any) => [q.id, q]))
    const dimScores: Record<string, number[]> = {}

    for (const r of responses) {
      const q = qMap.get(r.question_id) as any
      if (!q || q.question_type !== 'rating') continue
      const dim = q.options?.dimension ?? (q.options as any)?.dimension ?? 'general'
      if (!dimScores[dim]) dimScores[dim] = []
      if (typeof r.response === 'number') dimScores[dim].push(r.response)
    }

    const dimensions = Object.entries(dimScores).map(([key, scores]) => ({
      dimension:      key,
      avg_score:      scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null,
      response_count: scores.length,
    }))

    const totalScores    = Object.values(dimScores).flat()
    const engagement_index = totalScores.length
      ? Math.round((totalScores.reduce((a, b) => a + b, 0) / totalScores.length) * 10)
      : 0

    return reply.send({
      data: {
        survey,
        dimensions,
        engagement_index,
        total_responses: responses.length,
      },
    })
  })

  // ── Admin: trigger lifecycle survey for employees ──────────────────────────────

  fastify.post('/admin/trigger-lifecycle', hrAuth, async (req: any, reply) => {
    const tenantId                     = req.tenantId
    const parsed = TriggerLifecycleSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { lifecycle_type, employee_ids } = parsed.data

    // Find active survey of this type for this tenant
    const { data: survey } = await supabase
      .from('surveys')
      .select('id, title')
      .eq('tenant_id', tenantId)
      .eq('survey_type', lifecycle_type)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!survey) {
      return reply.status(404).send({
        error: 'No active survey of this type. Create and activate one first.',
      })
    }

    const empIds = employee_ids ?? []
    if (empIds.length === 0) return reply.status(400).send({ error: 'employee_ids required' })

    // employee_ids is caller-supplied — verify every id belongs to this
    // tenant before it's used, matching the same check on /admin/:id/assign
    // and /my/360/:roundId/nominate. Without it, survey_assignments rows
    // could be created referencing another tenant's employee under this
    // tenant_id, corrupting completion stats and potentially exposing survey
    // content to a foreign employee.
    const uniqueEmpIds = [...new Set(empIds)]
    const { data: validEmps } = await supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', uniqueEmpIds)
    if ((validEmps?.length ?? 0) !== uniqueEmpIds.length) {
      return reply.status(400).send({ error: 'INVALID_EMPLOYEES', message: 'One or more employees were not found in your organisation' })
    }

    const assignments = empIds.map(emp_id => ({
      survey_id:      survey.id,
      employee_id:    emp_id,
      tenant_id:      tenantId,
      respondent_type: 'self',
    }))

    const { error } = await supabase
      .from('survey_assignments')
      .upsert(assignments, { onConflict: 'survey_id,employee_id', ignoreDuplicates: true })

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to trigger lifecycle survey')

    return reply.send({ data: { assigned: empIds.length, survey_title: survey.title } })
  })

  // ── 360° Feedback: Admin setup round ─────────────────────────────────────────

  fastify.post('/admin/:id/360/setup', hrAuth, async (req: any, reply) => {
    const { id }        = req.params as { id: string }
    const tenantId      = req.tenantId
    const parsed = Setup360Schema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })

    const { data: survey } = await supabase
      .from('surveys')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!survey) return reply.status(404).send({ error: 'Survey not found' })

    const { peer_count = 3, deadline_days, self_review, manager_review } = parsed.data

    const deadline_at = deadline_days
      ? new Date(Date.now() + Number(deadline_days) * 86400000).toISOString()
      : null

    const insertRow: Record<string, unknown> = {
      survey_id:      id,
      tenant_id:      tenantId,
      peers_required: Number(peer_count),
      status:         'open',
    }
    if (deadline_at    !== null)      insertRow.deadline_at     = deadline_at
    if (self_review    !== undefined) insertRow.self_review     = Boolean(self_review)
    if (manager_review !== undefined) insertRow.manager_review  = Boolean(manager_review)

    const { data: round, error } = await supabase
      .from('feedback_360_rounds')
      .insert(insertRow)
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to set up 360 feedback round')
    return reply.status(201).send({ data: round })
  })

  fastify.get('/admin/360/:roundId/approve', hrAuth, async (req: any, reply) => {
    const { roundId } = req.params as { roundId: string }
    const tenantId    = req.tenantId

    const { data: nominators } = await supabase
      .from('feedback_360_nominators')
      .select('id, employee_id, type, employees(first_name, last_name, employee_code)')
      .eq('round_id', roundId)
      .eq('tenant_id', tenantId)

    return reply.send({ data: nominators ?? [] })
  })

  fastify.post('/admin/360/:roundId/approve', hrAuth, async (req: any, reply) => {
    const { roundId } = req.params as { roundId: string }
    const tenantId    = req.tenantId
    const parsed = Approve360Schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { nominator_ids, status = 'approved' } = parsed.data

    const { error } = await supabase
      .from('feedback_360_rounds')
      .update({ status })
      .eq('id', roundId)
      .eq('tenant_id', tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve 360 round')
    return reply.send({ data: { ok: true, approved: nominator_ids?.length ?? 0 } })
  })

  fastify.get('/admin/:id/360-report/:employeeId', hrAuth, async (req: any, reply) => {
    const { id, employeeId } = req.params as { id: string; employeeId: string }
    const tenantId           = req.tenantId

    const { data: round } = await supabase
      .from('feedback_360_rounds')
      .select('id, peers_required, status, nominee_id')
      .eq('survey_id', id)
      .eq('nominee_id', employeeId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!round) return reply.status(404).send({ error: '360 round not found' })

    const { data: nominators } = await supabase
      .from('feedback_360_nominators')
      .select('id, employee_id, type, employees(first_name, last_name)')
      .eq('round_id', (round as any).id)
      .eq('tenant_id', tenantId)

    return reply.send({ data: { round, nominators: nominators ?? [] } })
  })

  // ── 360°: ESS — submit nominations ───────────────────────────────────────────

  fastify.get('/my/360/nominations', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    const empId    = await getEmployeeId((req as any).userId)
    const tenantId = (req.user as any).tenantId ?? req.tenantId
    if (!empId) return reply.status(403).send({ error: 'Employee profile not found' })

    const { data } = await supabase
      .from('feedback_360_rounds')
      .select('id, status, peers_required, deadline_at, survey_id, surveys(title)')
      .eq('nominee_id', empId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    const rounds = data ?? []

    // Fetch peer nominations already submitted by this employee for each round
    const roundIds = rounds.map((r: any) => r.id)
    let nominatorMap: Record<string, string[]> = {}
    if (roundIds.length) {
      const { data: nominators } = await supabase
        .from('feedback_360_nominators')
        .select('round_id, employee_id')
        .in('round_id', roundIds)
        .eq('tenant_id', tenantId)
      for (const n of nominators ?? []) {
        if (!nominatorMap[(n as any).round_id]) nominatorMap[(n as any).round_id] = []
        nominatorMap[(n as any).round_id].push((n as any).employee_id)
      }
    }

    const mapped = rounds.map((r: any) => ({
      ...r,
      peer_count:     r.peers_required,
      survey:         r.surveys,
      my_nominations: nominatorMap[r.id] ?? [],
    }))

    return reply.send({ data: mapped })
  })

  fastify.post('/my/360/:roundId/nominate', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    const { roundId } = req.params as { roundId: string }
    const tenantId    = (req.user as any).tenantId ?? req.tenantId
    const empId       = await getEmployeeId((req as any).userId)
    if (!empId) return reply.status(403).send({ error: 'Employee profile not found' })

    const parsed = Nominate360Schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { employee_ids } = parsed.data

    const { data: round } = await supabase
      .from('feedback_360_rounds')
      .select('nominee_id, peers_required, status')
      .eq('id', roundId)
      .eq('tenant_id', tenantId)
      .single()

    if (!round || (round as any).nominee_id !== empId) {
      return reply.status(403).send({ error: 'Round not found or not yours' })
    }
    if ((round as any).status !== 'open') {
      return reply.status(400).send({ error: 'Nominations are closed' })
    }

    // employee_ids (peer nominees) is caller-supplied — verify every id
    // belongs to this tenant. Without this, an employee could nominate a
    // foreign tenant's employee_id, and the HR 360-report endpoint's
    // employees(first_name, last_name) join would then surface that
    // foreign tenant's employee name inside this tenant's report.
    const uniquePeerIds = [...new Set(employee_ids)]
    const { data: validPeers } = await supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', uniquePeerIds)
    if ((validPeers?.length ?? 0) !== uniquePeerIds.length) {
      return reply.status(400).send({ error: 'INVALID_EMPLOYEES', message: 'One or more nominated peers were not found in your organisation' })
    }

    const rows = employee_ids.map(pid => ({
      round_id:    roundId,
      tenant_id:   tenantId,
      employee_id: pid,
      type:        'peer',
    }))

    const { error } = await supabase
      .from('feedback_360_nominators')
      .upsert(rows, { onConflict: 'round_id,employee_id', ignoreDuplicates: true })

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to submit 360 nominations')
    return reply.send({ data: { nominated: rows.length } })
  })
}
