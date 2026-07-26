/**
 * Mood & Pulse routes — /mood
 *
 * Employee endpoints (authenticate):
 *   GET  /today                     — today's check-in + active pulse question
 *   POST /checkin                   — submit today's mood (idempotent per day)
 *   POST /pulse/:questionId/respond — respond to an active pulse question
 *
 * Admin endpoints (hr_admin / super_admin):
 *   GET   /admin/dashboard             — 7-day trend, distribution, active pulse stats, sentiment summary
 *   GET   /admin/pulse                 — list pulse questions (optional ?status filter)
 *   POST  /admin/pulse                 — create pulse question (starts as draft)
 *   PATCH /admin/pulse/:id             — update status / fields
 *   GET   /admin/pulse/:id/responses   — all responses for a pulse question
 *   GET   /admin/store-breakdown       — monthly mood scores by store/location
 *   GET   /admin/sentiment-report      — sentiment distribution + recent negatives
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction }                   from '../../lib/audit-service.js'
import { resolveAssistantChain }       from '../../lib/ai/config.js'
import { chatCompleteWithFallback }    from '../../lib/ai/llm.js'
import { fetchAllRows }                from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode }      from '../../lib/api-errors.js'

export default async function moodRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function getEmployeeId(profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', profileId)
      .maybeSingle()
    return data?.employee_id ?? null
  }

  function todayDate(): string {
    return new Date().toISOString().split('T')[0]
  }

  function detectSentiment(note: string | null | undefined): 'positive' | 'neutral' | 'negative' | null {
    if (!note?.trim()) return null
    const t = note.toLowerCase()
    const posWords = ['great','good','happy','excellent','love','amazing','wonderful','fantastic','proud','motivated','enjoy','positive','satisfied','better','best','excited']
    const negWords = ['bad','awful','terrible','unhappy','stressed','frustrated','unfair','angry','worst','hate','horrible','disappointed','tired','exhausted','toxic','leave','quit','resign']
    const posCount = posWords.filter(w => t.includes(w)).length
    const negCount = negWords.filter(w => t.includes(w)).length
    if (negCount > posCount) return 'negative'
    if (posCount > negCount) return 'positive'
    return 'neutral'
  }

  // ── GET /mood/today ──────────────────────────────────────────────────────────

  fastify.get('/today', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId    = req.tenantId
    const employeeId  = await getEmployeeId(req.userId)
    const today       = todayDate()

    let checkin: Record<string, unknown> | null = null
    if (employeeId) {
      const { data } = await supabase
        .from('mood_checkins')
        .select('mood, note, checkin_date')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
        .eq('checkin_date', today)
        .maybeSingle()
      checkin = data
    }

    // Most-recent active pulse question
    const { data: pulseQ } = await supabase
      .from('pulse_questions')
      .select('id, question, options')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let pulseResponded = false
    if (pulseQ && employeeId) {
      const { data: resp } = await supabase
        .from('pulse_responses')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('question_id', pulseQ.id)
        .eq('employee_id', employeeId)
        .maybeSingle()
      pulseResponded = !!resp
    }

    return reply.send({
      data: {
        checkin,
        pulse: pulseQ ? { ...pulseQ, responded: pulseResponded } : null,
      },
    })
  })

  // ── POST /mood/checkin ───────────────────────────────────────────────────────

  fastify.post('/checkin', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId  = req.tenantId
    const { mood, note } = req.body as { mood: number; note?: string }

    if (!mood || mood < 1 || mood > 5) {
      return reply.status(400).send({ error: 'mood must be an integer between 1 and 5' })
    }

    const employeeId = await getEmployeeId(req.userId)
    if (!employeeId) {
      return reply.status(400).send({ error: 'No employee profile linked to your account' })
    }

    const sentiment_label = detectSentiment(note)

    // LLM-based theme categorization (best-effort, async)
    let sentiment_category: string | null = null
    if (note?.trim()) {
      try {
        const chain = await resolveAssistantChain(supabase, tenantId)
        const { content: moodResult } = await chatCompleteWithFallback(chain, { messages: [
          {
            role: 'system',
            content: 'Categorize this employee feedback into ONE of: Manager Quality, Workload, Compensation, Work Environment, Career Growth, Team Dynamics, Personal, Other. Return ONLY the category name, nothing else.',
          },
          { role: 'user', content: note.slice(0, 500) },
        ] })
        const cat = moodResult.content?.trim()
        const valid = ['Manager Quality','Workload','Compensation','Work Environment','Career Growth','Team Dynamics','Personal','Other']
        if (valid.includes(cat ?? '')) sentiment_category = cat ?? null
      } catch { /* non-blocking */ }
    }

    const { error } = await supabase
      .from('mood_checkins')
      .upsert(
        {
          tenant_id:          tenantId,
          employee_id:        employeeId,
          mood:               Math.round(mood),
          note:               note ?? null,
          sentiment_label:    sentiment_label,
          sentiment_category: sentiment_category,
          checkin_date:       todayDate(),
        },
        { onConflict: 'tenant_id,employee_id,checkin_date' },
      )

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save mood check-in')
    return reply.send({ data: { saved: true } })
  })

  // ── POST /mood/pulse/:questionId/respond ─────────────────────────────────────

  fastify.post('/pulse/:questionId/respond', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId    = req.tenantId
    const { questionId } = req.params as { questionId: string }
    const { response }   = req.body as { response: string }

    if (!response?.trim()) {
      return reply.status(400).send({ error: 'response is required' })
    }

    const employeeId = await getEmployeeId(req.userId)
    if (!employeeId) {
      return reply.status(400).send({ error: 'No employee profile linked to your account' })
    }

    const { data: q, error: qErr } = await supabase
      .from('pulse_questions')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('id', questionId)
      .single()

    if (qErr || !q) return reply.status(404).send({ error: 'Pulse question not found' })
    if (q.status !== 'active') return reply.status(400).send({ error: 'Pulse question is not active' })

    const { error } = await supabase
      .from('pulse_responses')
      .upsert(
        {
          tenant_id:   tenantId,
          question_id: questionId,
          employee_id: employeeId,
          response:    response.trim(),
        },
        { onConflict: 'tenant_id,question_id,employee_id' },
      )

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save pulse response')
    return reply.send({ data: { saved: true } })
  })

  // ── GET /mood/admin/dashboard ────────────────────────────────────────────────

  fastify.get('/admin/dashboard', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    // Build last-7-days date list
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push(d.toISOString().split('T')[0])
    }

    const since30d = new Date()
    since30d.setDate(since30d.getDate() - 7)
    const since7dStr = since30d.toISOString().split('T')[0]

    // mood_checkins can easily exceed 1000 rows within a 7-day window for a
    // tenant with a few hundred daily-active employees (fresh audit finding)
    // — a plain unranged select silently truncated trend/distribution/
    // total_checkins_7d with no error surfaced.
    const [checkins, activeResult, sentimentRows] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from('mood_checkins')
          .select('mood, checkin_date')
          .eq('tenant_id', tenantId)
          .gte('checkin_date', days[0])
          .range(from, to)
      ) as Promise<any[]>,
      supabase
        .from('pulse_questions')
        .select('id, question, options, status, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      fetchAllRows((from, to) =>
        supabase
          .from('mood_checkins')
          .select('sentiment_label')
          .eq('tenant_id', tenantId)
          .gte('checkin_date', since7dStr)
          .not('sentiment_label', 'is', null)
          .range(from, to)
      ) as Promise<any[]>,
    ])

    // 7-day trend: daily average mood
    const trendMap: Record<string, { total: number; count: number }> = {}
    for (const day of days) trendMap[day] = { total: 0, count: 0 }
    for (const c of checkins) {
      if (trendMap[c.checkin_date]) {
        trendMap[c.checkin_date].total += c.mood
        trendMap[c.checkin_date].count += 1
      }
    }
    const trend = days.map(d => ({
      date:  d,
      avg:   trendMap[d].count > 0
        ? Math.round((trendMap[d].total / trendMap[d].count) * 10) / 10
        : null,
      count: trendMap[d].count,
    }))

    // Mood distribution (1-5) across all 7 days
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const c of checkins) {
      distribution[c.mood] = (distribution[c.mood] ?? 0) + 1
    }

    // Active pulse questions with response counts
    const activeQuestions = activeResult.data ?? []
    const pulseStats = await Promise.all(
      activeQuestions.map(async (q) => {
        const { count } = await supabase
          .from('pulse_responses')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('question_id', q.id)
        return { ...q, response_count: count ?? 0 }
      }),
    )

    // Sentiment summary for last 7 days
    const sentCounts = { positive: 0, neutral: 0, negative: 0, total_with_notes: sentimentRows.length }
    for (const r of sentimentRows) {
      if (r.sentiment_label === 'positive') sentCounts.positive++
      else if (r.sentiment_label === 'neutral') sentCounts.neutral++
      else if (r.sentiment_label === 'negative') sentCounts.negative++
    }

    // Participation rate (current month)
    const currentMonthStart = new Date().toISOString().slice(0, 7) + '-01'
    const [respondentRows, totalEmpResult] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase.from('mood_checkins').select('employee_id')
          .eq('tenant_id', tenantId).gte('checkin_date', currentMonthStart)
          .range(from, to)
      ),
      supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('status', 'active'),
    ])
    const distinctRespondents = new Set(respondentRows.map((r: any) => r.employee_id)).size
    const totalActive         = totalEmpResult.count ?? 0
    const participation_rate  = totalActive > 0
      ? Math.round((distinctRespondents / totalActive) * 100)
      : 0

    const participationData = { rate: participation_rate, respondents: distinctRespondents, total: totalActive, target: 70 }

    return reply.send({
      data: {
        trend,
        distribution,
        total_checkins_7d:    checkins.length,
        active_pulse:         pulseStats,
        sentiment_summary:    sentCounts,
        participation_rate_7d: participationData.rate,
        total_employees:      participationData.total,
        participation_rate:   participationData,
      },
    })
  })

  // ── GET /mood/admin/store-breakdown ─────────────────────────────────────────

  fastify.get('/admin/store-breakdown', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { month } = req.query as { month?: string }  // YYYY-MM format, defaults to current month
    const targetMonth = month ? month + '-01' : new Date().toISOString().slice(0, 7) + '-01'

    const nextMonthDate = new Date(new Date(targetMonth).getTime() + 32 * 86400000)
    const nextMonthStr = nextMonthDate.toISOString().slice(0, 7) + '-01'

    const { data } = await supabase
      .from('mood_store_monthly')
      .select('work_location_id, score_month, avg_score_100, response_count')
      .eq('tenant_id', tenantId)
      .gte('score_month', targetMonth)
      .lt('score_month', nextMonthStr)

    // Get location names
    const locIds = [...new Set((data ?? []).map((r: any) => r.work_location_id).filter(Boolean))]
    const locationNames: Record<string, string> = {}
    if (locIds.length > 0) {
      const { data: locs } = await supabase
        .from('work_locations')
        .select('id, name')
        .in('id', locIds)
      ;(locs ?? []).forEach((l: any) => { locationNames[l.id] = l.name })
    }

    return reply.send({
      data: (data ?? []).map((r: any) => ({
        ...r,
        location_name: locationNames[r.work_location_id] || 'Unknown Store',
      })).sort((a: any, b: any) => a.avg_score_100 - b.avg_score_100),  // sorted low to high (low = needs attention)
    })
  })

  // ── GET /mood/admin/sentiment-report ────────────────────────────────────────

  fastify.get('/admin/sentiment-report', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const since30d = new Date()
    since30d.setDate(since30d.getDate() - 30)
    const since30dStr = since30d.toISOString().split('T')[0]

    const [sentimentRows, negativeNotesResult] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from('mood_checkins')
          .select('sentiment_label')
          .eq('tenant_id', tenantId)
          .gte('checkin_date', since30dStr)
          .not('sentiment_label', 'is', null)
          .range(from, to)
      ),
      supabase
        .from('mood_checkins')
        .select('note, checkin_date, employee_id')
        .eq('tenant_id', tenantId)
        .eq('sentiment_label', 'negative')
        .gte('checkin_date', since30dStr)
        .not('note', 'is', null)
        .order('checkin_date', { ascending: false })
        .limit(10),
    ])

    const rows = sentimentRows
    const total_with_notes = rows.length
    let positive = 0, neutral = 0, negative = 0
    for (const r of rows) {
      if (r.sentiment_label === 'positive') positive++
      else if (r.sentiment_label === 'neutral') neutral++
      else if (r.sentiment_label === 'negative') negative++
    }

    const positive_pct = total_with_notes > 0 ? Math.round((positive / total_with_notes) * 100) : 0
    const neutral_pct  = total_with_notes > 0 ? Math.round((neutral  / total_with_notes) * 100) : 0
    const negative_pct = total_with_notes > 0 ? Math.round((negative / total_with_notes) * 100) : 0

    // Anonymized recent negatives (note + date, no employee name)
    const recent_negatives = (negativeNotesResult.data ?? []).map((r: any) => ({
      note:         r.note,
      checkin_date: r.checkin_date,
    }))

    return reply.send({
      data: {
        positive_pct,
        neutral_pct,
        negative_pct,
        total_with_notes,
        positive,
        neutral,
        negative,
        recent_negatives,
      },
    })
  })

  // ── GET /mood/admin/pulse ────────────────────────────────────────────────────

  fastify.get('/admin/pulse', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { status } = req.query as { status?: string }

    const q = supabase
      .from('pulse_questions')
      .select('id, question, options, status, poll_category, starts_at, ends_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (status) q.eq('status', status)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch pulse questions')

    return reply.send({ data: data ?? [] })
  })

  // ── POST /mood/admin/pulse ───────────────────────────────────────────────────

  // Must match the pulse_questions.poll_category CHECK constraint
  // (migration 333_mood_intelligence.sql) — a value zod lets through but the
  // DB rejects would otherwise surface as an opaque 500 instead of a clean
  // 400 VALIDATION_ERROR.
  const POLL_CATEGORIES = [
    'weekly_pulse', 'manager_quality', 'post_appraisal',
    'onboarding', 'post_transfer', 'festival', 'custom',
  ] as const

  const CreatePulseSchema = z.object({
    question:      z.string().min(1),
    options:       z.array(z.unknown()).optional().nullable(),
    starts_at:     z.string().optional().nullable(),
    ends_at:       z.string().optional().nullable(),
    poll_category: z.enum(POLL_CATEGORIES).optional(),
  })

  const UpdatePulseSchema = z.object({
    question:      z.string().min(1).optional(),
    options:       z.array(z.unknown()).optional().nullable(),
    status:        z.enum(['draft', 'active', 'closed']).optional(),
    starts_at:     z.string().optional().nullable(),
    ends_at:       z.string().optional().nullable(),
    poll_category: z.enum(POLL_CATEGORIES).optional(),
  })

  fastify.post('/admin/pulse', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const parsed = CreatePulseSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { question, options, starts_at, ends_at, poll_category } = parsed.data

    const { data, error } = await supabase
      .from('pulse_questions')
      .insert({
        tenant_id:     tenantId,
        question:      question.trim(),
        options:       options ?? null,
        starts_at:     starts_at ?? null,
        ends_at:       ends_at ?? null,
        poll_category: poll_category ?? 'weekly_pulse',
        status:        'draft',
        created_by:    req.userId,
      })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create pulse question')

    await logAction(supabase, {
      tenantId,
      tableName:   'pulse_questions',
      recordId:    data.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { question, poll_category: poll_category ?? 'weekly_pulse' },
    })

    return reply.status(201).send({ data })
  })

  // ── PATCH /mood/admin/pulse/:id ──────────────────────────────────────────────

  fastify.patch('/admin/pulse/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }
    const parsed   = UpdatePulseSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })

    const allowed = ['question', 'options', 'status', 'starts_at', 'ends_at', 'poll_category']
    const update: Record<string, unknown> = {}
    for (const k of allowed) {
      if ((parsed.data as any)[k] !== undefined) update[k] = (parsed.data as any)[k]
    }

    if (Object.keys(update).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' })
    }

    const { data, error } = await supabase
      .from('pulse_questions')
      .update(update)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('id, status')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update pulse question')

    await logAction(supabase, {
      tenantId,
      tableName:   'pulse_questions',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     update,
    })

    return reply.send({ data })
  })

  // ── GET /mood/admin/pulse/:id/responses ──────────────────────────────────────

  fastify.get('/admin/pulse/:id/responses', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const qs = z.object({
      limit:  z.coerce.number().int().min(1).max(500).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).safeParse(req.query)

    const limit  = qs.success ? qs.data.limit  : 50
    const offset = qs.success ? qs.data.offset : 0

    const { data, count, error } = await supabase
      .from('pulse_responses')
      .select('id, response, created_at, employee_id', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('question_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch pulse responses')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /mood/admin/cluster-breakdown ────────────────────────────────────────

  fastify.get('/admin/cluster-breakdown', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { month } = req.query as { month?: string }
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)

    const { data, error } = await supabase
      .from('mood_cluster_monthly')
      .select('cluster_id, month, avg_mood, respondent_count')
      .eq('tenant_id', tenantId)
      .eq('month', targetMonth)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch cluster breakdown')
    return reply.send({ data: data ?? [] })
  })

  // ── GET /mood/admin/region-breakdown ─────────────────────────────────────────

  fastify.get('/admin/region-breakdown', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { month } = req.query as { month?: string }
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)

    const { data, error } = await supabase
      .from('mood_region_monthly')
      .select('region_id, month, avg_mood, respondent_count')
      .eq('tenant_id', tenantId)
      .eq('month', targetMonth)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch region breakdown')
    return reply.send({ data: data ?? [] })
  })
}
