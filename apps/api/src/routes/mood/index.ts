/**
 * Mood & Pulse routes — /mood
 *
 * Employee endpoints (authenticate):
 *   GET  /today                     — today's check-in + active pulse question
 *   POST /checkin                   — submit today's mood (idempotent per day)
 *   POST /pulse/:questionId/respond — respond to an active pulse question
 *
 * Admin endpoints (hr_admin / super_admin):
 *   GET   /admin/dashboard             — 7-day trend, distribution, active pulse stats
 *   GET   /admin/pulse                 — list pulse questions (optional ?status filter)
 *   POST  /admin/pulse                 — create pulse question (starts as draft)
 *   PATCH /admin/pulse/:id             — update status / fields
 *   GET   /admin/pulse/:id/responses   — all responses for a pulse question
 */

import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction }                   from '../../lib/audit-service.js'

export default async function moodRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function getEmployeeId(profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', profileId)
      .single()
    return data?.employee_id ?? null
  }

  function todayDate(): string {
    return new Date().toISOString().split('T')[0]
  }

  // ── GET /mood/today ──────────────────────────────────────────────────────────

  fastify.get('/today', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId    = req.tenantId
    const employeeId  = await getEmployeeId(req.user.id)
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

    const employeeId = await getEmployeeId(req.user.id)
    if (!employeeId) {
      return reply.status(400).send({ error: 'No employee profile linked to your account' })
    }

    const { error } = await supabase
      .from('mood_checkins')
      .upsert(
        {
          tenant_id:    tenantId,
          employee_id:  employeeId,
          mood:         Math.round(mood),
          note:         note ?? null,
          checkin_date: todayDate(),
        },
        { onConflict: 'tenant_id,employee_id,checkin_date' },
      )

    if (error) return reply.status(500).send({ error: error.message })
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

    const employeeId = await getEmployeeId(req.user.id)
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

    if (error) return reply.status(500).send({ error: error.message })
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

    const [checkinResult, activeResult] = await Promise.all([
      supabase
        .from('mood_checkins')
        .select('mood, checkin_date')
        .eq('tenant_id', tenantId)
        .gte('checkin_date', days[0]),
      supabase
        .from('pulse_questions')
        .select('id, question, options, status, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
    ])

    const checkins = checkinResult.data ?? []

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

    return reply.send({
      data: {
        trend,
        distribution,
        total_checkins_7d: checkins.length,
        active_pulse:      pulseStats,
      },
    })
  })

  // ── GET /mood/admin/pulse ────────────────────────────────────────────────────

  fastify.get('/admin/pulse', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { status } = req.query as { status?: string }

    const q = supabase
      .from('pulse_questions')
      .select('id, question, options, status, starts_at, ends_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (status) q.eq('status', status)

    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })

    return reply.send({ data: data ?? [] })
  })

  // ── POST /mood/admin/pulse ───────────────────────────────────────────────────

  fastify.post('/admin/pulse', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { question, options, starts_at, ends_at } = req.body as any

    if (!question?.trim()) return reply.status(400).send({ error: 'question is required' })

    const { data, error } = await supabase
      .from('pulse_questions')
      .insert({
        tenant_id:  tenantId,
        question:   question.trim(),
        options:    options ?? null,
        starts_at:  starts_at ?? null,
        ends_at:    ends_at ?? null,
        status:     'draft',
        created_by: req.user.id,
      })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    await logAction(supabase, {
      tenantId,
      tableName:   'pulse_questions',
      recordId:    data.id,
      action:      'INSERT',
      performedBy: req.user.id,
      newData:     { question },
    })

    return reply.status(201).send({ data })
  })

  // ── PATCH /mood/admin/pulse/:id ──────────────────────────────────────────────

  fastify.patch('/admin/pulse/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }
    const body     = req.body as Record<string, unknown>

    const allowed = ['question', 'options', 'status', 'starts_at', 'ends_at']
    const update: Record<string, unknown> = {}
    for (const k of allowed) {
      if (body[k] !== undefined) update[k] = body[k]
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

    if (error) return reply.status(500).send({ error: error.message })

    await logAction(supabase, {
      tenantId,
      tableName:   'pulse_questions',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.user.id,
      newData:     update,
    })

    return reply.send({ data })
  })

  // ── GET /mood/admin/pulse/:id/responses ──────────────────────────────────────

  fastify.get('/admin/pulse/:id/responses', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const { data, error } = await supabase
      .from('pulse_responses')
      .select('id, response, created_at, employee_id')
      .eq('tenant_id', tenantId)
      .eq('question_id', id)
      .order('created_at', { ascending: false })

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })
}
