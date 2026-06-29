import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

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

export default async function surveyRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

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
    const empId = await getEmployeeId((req.user as any).sub)
    if (!empId) return reply.send({ data: [] })

    const { data, error } = await supabase
      .from('survey_assignments')
      .select(`
        id, assigned_at, completed_at,
        survey:surveys(id, title, description, due_date, status)
      `)
      .eq('employee_id', empId)
      .order('assigned_at', { ascending: false })

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── ESS: get survey + questions (to take) ──────────────────────────────────────

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const empId = await getEmployeeId((req.user as any).sub)
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
    const { responses } = req.body as {
      responses: { question_id: string; response: unknown }[]
    }
    const empId = await getEmployeeId((req.user as any).sub)
    if (!empId) return reply.status(403).send({ error: 'Employee profile not found' })

    const { data: assignment } = await supabase
      .from('survey_assignments')
      .select('id, completed_at, tenant_id')
      .eq('survey_id', id)
      .eq('employee_id', empId)
      .maybeSingle()

    if (!assignment) return reply.status(404).send({ error: 'Survey not assigned to you' })
    if (assignment.completed_at) return reply.status(400).send({ error: 'Survey already completed' })

    const rows = responses.map(r => ({
      assignment_id: assignment.id,
      question_id:   r.question_id,
      tenant_id:     assignment.tenant_id,
      response:      r.response,
    }))

    const { error: respErr } = await supabase
      .from('survey_responses')
      .upsert(rows, { onConflict: 'assignment_id,question_id' })

    if (respErr) return reply.status(500).send({ error: respErr.message })

    await supabase
      .from('survey_assignments')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', assignment.id)

    return reply.send({ data: { ok: true } })
  })

  // ── Admin: list all surveys ────────────────────────────────────────────────────

  fastify.get('/admin', hrAuth, async (_req, reply) => {
    const { data, error } = await supabase
      .from('surveys')
      .select('id, title, description, status, due_date, created_at, survey_type, is_anonymous')
      .order('created_at', { ascending: false })

    if (error) return reply.status(500).send({ error: error.message })

    const surveyIds = (data ?? []).map(s => s.id)
    const statsMap: Record<string, { total: number; completed: number }> = {}

    if (surveyIds.length) {
      const { data: asgns } = await supabase
        .from('survey_assignments')
        .select('survey_id, completed_at')
        .in('survey_id', surveyIds)

      for (const a of asgns ?? []) {
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
    const { title, description, due_date, questions } = req.body as {
      title:       string
      description: string | null
      due_date:    string | null
      questions:   {
        question_text: string
        question_type: string
        options:       string[] | null
        required:      boolean
        order_idx:     number
      }[]
    }
    const profileId = (req.user as any).sub
    const tenantId  = await getTenantId(profileId)
    if (!tenantId) return reply.status(400).send({ error: 'Tenant not found' })

    const { data: survey, error } = await supabase
      .from('surveys')
      .insert({ title, description, due_date, created_by: profileId, tenant_id: tenantId })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })

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
      await supabase.from('survey_questions').insert(questionRows)
    }

    return reply.status(201).send({ data: { id: survey.id } })
  })

  // ── Admin: get survey detail ───────────────────────────────────────────────────

  fastify.get('/admin/:id', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }

    const { data: survey, error } = await supabase
      .from('surveys')
      .select('id, title, description, status, due_date, created_at')
      .eq('id', id)
      .maybeSingle()

    if (error || !survey) return reply.status(404).send({ error: 'Survey not found' })

    const [{ data: questions }, { data: assignments }] = await Promise.all([
      supabase
        .from('survey_questions')
        .select('id, order_idx, question_text, question_type, options, required')
        .eq('survey_id', id)
        .order('order_idx'),
      supabase
        .from('survey_assignments')
        .select('id, assigned_at, completed_at, employee:employees(id, first_name, last_name, employee_code)')
        .eq('survey_id', id)
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
    const updates = req.body as Partial<{
      title: string; description: string; status: string; due_date: string
    }>

    const { error } = await supabase
      .from('surveys')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { ok: true } })
  })

  // ── Admin: assign survey to employees ─────────────────────────────────────────

  fastify.post('/admin/:id/assign', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { employee_ids, assign_all } = req.body as {
      employee_ids?: string[]
      assign_all?:   boolean
    }
    const profileId = (req.user as any).sub
    const tenantId  = await getTenantId(profileId)
    if (!tenantId) return reply.status(400).send({ error: 'Tenant not found' })

    let empIds = employee_ids ?? []

    if (assign_all) {
      const { data: emps } = await supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
      empIds = (emps ?? []).map(e => e.id)
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

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { assigned: empIds.length } })
  })

  // ── Admin: survey results ──────────────────────────────────────────────────────

  fastify.get('/admin/:id/results', hrAuth, async (req, reply) => {
    const { id } = req.params as { id: string }

    const { data: questions } = await supabase
      .from('survey_questions')
      .select('id, order_idx, question_text, question_type, options')
      .eq('survey_id', id)
      .order('order_idx')

    const { data: assignments } = await supabase
      .from('survey_assignments')
      .select('id, completed_at')
      .eq('survey_id', id)

    const assignmentIds   = (assignments ?? []).map(a => a.id)
    const totalAssigned   = assignmentIds.length
    const totalCompleted  = (assignments ?? []).filter(a => a.completed_at).length

    const responsesByQ: Record<string, unknown[]> = {}

    if (assignmentIds.length) {
      const { data: responses } = await supabase
        .from('survey_responses')
        .select('question_id, response')
        .in('assignment_id', assignmentIds)

      for (const r of responses ?? []) {
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

    return reply.send({
      data: {
        total_assigned:   totalAssigned,
        total_completed:  totalCompleted,
        completion_rate:  totalAssigned
          ? Math.round(totalCompleted / totalAssigned * 100)
          : 0,
        questions: questionResults,
      },
    })
  })

  // ── Admin: list survey templates ───────────────────────────────────────────────

  fastify.get('/admin/templates', hrAuth, async (_req, reply) => {
    const { data } = await supabase.from('survey_templates').select('*').order('survey_type')
    return reply.send({ data: data ?? [] })
  })

  // ── Admin: create survey from template ─────────────────────────────────────────

  fastify.post('/admin/from-template', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { template_id, title, due_date, is_anonymous = false } = req.body as any

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
        created_by:  (req.user as any).sub,
      })
      .select('id')
      .single()
    if (se || !survey) return reply.status(500).send({ error: se?.message })

    const questions = (tmpl.questions as any[]).map(q => ({
      ...q,
      survey_id: survey.id,
      tenant_id: tenantId,
    }))
    await supabase.from('survey_questions').insert(questions)

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
    const { lifecycle_type, employee_ids } = req.body as {
      lifecycle_type: string
      employee_ids?:  string[]
    }

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

    const assignments = empIds.map(emp_id => ({
      survey_id:      survey.id,
      employee_id:    emp_id,
      tenant_id:      tenantId,
      respondent_type: 'self',
    }))

    const { error } = await supabase
      .from('survey_assignments')
      .upsert(assignments, { onConflict: 'survey_id,employee_id', ignoreDuplicates: true })

    if (error) return reply.status(500).send({ error: error.message })

    return reply.send({ data: { assigned: empIds.length, survey_title: survey.title } })
  })
}
