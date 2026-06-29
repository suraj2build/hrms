/**
 * Succession Planning routes — /succession
 *
 * Admin-only endpoints:
 *   GET  /plans              — list all active succession plans (with candidate counts)
 *   POST /plans              — create a new plan
 *   GET  /plans/:id          — single plan with candidates
 *   PUT  /plans/:id          — update plan fields
 *   POST /plans/:id/archive  — archive a plan
 *
 *   POST /plans/:id/candidates        — add a candidate
 *   PUT  /plans/:id/candidates/:cid   — update candidate readiness / scorecard
 *   DELETE /plans/:id/candidates/:cid — remove candidate
 *
 *   GET /nine-box            — 9-box grid grouping of all candidates
 *   GET /ai-recommendations  — top 3 candidates per plan by weighted score
 *
 *   GET    /plans/:id/candidates/:cid/idp       — list IDP actions
 *   POST   /plans/:id/candidates/:cid/idp       — add IDP action
 *   PATCH  /plans/:id/candidates/:cid/idp/:aid  — update / mark complete
 *   DELETE /plans/:id/candidates/:cid/idp/:aid  — delete IDP action
 *
 *   GET /dashboard           — summary stats (plan count, risk breakdown, ready-now count)
 */

import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'

/** Weighted readiness score (0–10 scale) from the 6 scorecard dimensions. */
function computeWeightedScore(c: {
  score_performance?:    number | null
  score_skill_gap?:      number | null
  score_leadership?:     number | null
  score_mobility?:       number | null
  score_tenure?:         number | null
  score_attrition_risk?: number | null
  readiness_score?:      number | null
}): number {
  const {
    score_performance, score_skill_gap, score_leadership,
    score_mobility, score_tenure, score_attrition_risk, readiness_score,
  } = c

  if (
    score_performance != null && score_skill_gap != null && score_leadership != null &&
    score_mobility    != null && score_tenure    != null && score_attrition_risk != null
  ) {
    return (
      score_performance    * 0.25 +
      score_skill_gap      * 0.20 +
      score_leadership     * 0.20 +
      score_mobility       * 0.15 +
      score_tenure         * 0.10 +
      score_attrition_risk * 0.10
    )
  }
  // Fallback: convert 0-100 readiness_score to 0-10 scale
  return readiness_score != null ? readiness_score / 10 : 0
}

function readinessTier(score: number): string {
  if (score >= 8) return 'Ready Now'
  if (score >= 6) return 'Ready in 12 Months'
  if (score >= 4) return 'Ready in 24 Months'
  return 'Not Yet'
}

export default async function successionRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  fastify.get('/dashboard', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const [plansResult, candidatesResult] = await Promise.all([
      supabase.from('succession_plans')
        .select('id, risk_level')
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),
      supabase.from('succession_candidates')
        .select('readiness_level')
        .eq('tenant_id', tenantId),
    ])

    const plans = plansResult.data ?? []
    const candidates = candidatesResult.data ?? []

    const riskBreakdown = { critical: 0, high: 0, medium: 0, low: 0 }
    plans.forEach(p => { riskBreakdown[p.risk_level as keyof typeof riskBreakdown]++ })

    const readyNow = candidates.filter(c => c.readiness_level === 'ready_now').length

    return reply.send({
      data: {
        total_plans:    plans.length,
        risk_breakdown: riskBreakdown,
        total_candidates: candidates.length,
        ready_now:      readyNow,
        coverage_rate:  plans.length > 0 ? Math.round((plans.filter(p => p.risk_level !== 'critical' || readyNow > 0).length / plans.length) * 100) : 0,
      },
    })
  })

  // ── List plans ────────────────────────────────────────────────────────────

  fastify.get('/plans', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { status = 'active' } = req.query as { status?: string }

    const { data, error } = await supabase
      .from('succession_plans')
      .select(`
        id, position_title, department, risk_level, status, notes, created_at,
        employees!succession_plans_incumbent_id_fkey(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', tenantId)
      .eq('status', status)
      .order('risk_level', { ascending: false })
      .order('position_title')

    if (error) return reply.status(500).send({ error: error.message })

    // Attach candidate counts
    const planIds = (data ?? []).map(p => p.id)
    const countMap: Record<string, number> = {}
    if (planIds.length > 0) {
      const { data: counts } = await supabase
        .from('succession_candidates')
        .select('plan_id')
        .eq('tenant_id', tenantId)
        .in('plan_id', planIds)
      ;(counts ?? []).forEach(c => { countMap[c.plan_id] = (countMap[c.plan_id] ?? 0) + 1 })
    }

    return reply.send({ data: (data ?? []).map(p => ({ ...p, candidate_count: countMap[p.id] ?? 0 })) })
  })

  // ── Get single plan with candidates ──────────────────────────────────────

  fastify.get('/plans/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }

    const [planResult, candidatesResult] = await Promise.all([
      supabase.from('succession_plans')
        .select(`id, position_title, department, risk_level, status, notes, created_at, updated_at,
          employees!succession_plans_incumbent_id_fkey(id, first_name, last_name, employee_code, designation)`)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single(),
      supabase.from('succession_candidates')
        .select(`id, readiness_level, readiness_score, strengths, gaps, development_plan, notes, created_at,
          nine_box_performance, nine_box_potential,
          score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
          attrition_risk_flag,
          employees!succession_candidates_employee_id_fkey(id, first_name, last_name, employee_code, designation, department)`)
        .eq('tenant_id', tenantId)
        .eq('plan_id', id)
        .order('readiness_level')
        .order('readiness_score', { ascending: false }),
    ])

    if (planResult.error || !planResult.data) return reply.status(404).send({ error: 'Plan not found' })

    return reply.send({ data: { ...planResult.data, candidates: candidatesResult.data ?? [] } })
  })

  // ── Create plan ───────────────────────────────────────────────────────────

  fastify.post('/plans', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { position_title, department, incumbent_id, risk_level = 'medium', notes } = req.body as any
    if (!position_title?.trim()) return reply.status(400).send({ error: 'position_title is required' })

    const { data, error } = await supabase
      .from('succession_plans')
      .insert({ tenant_id: tenantId, position_title: position_title.trim(), department, incumbent_id: incumbent_id || null, risk_level, notes, created_by: req.user.id })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    await logAction(supabase, { tenantId, tableName: 'succession_plans', recordId: data.id, action: 'INSERT', performedBy: req.user.id, newData: { position_title, risk_level } })
    return reply.status(201).send({ data })
  })

  // ── Update plan ───────────────────────────────────────────────────────────

  fastify.put('/plans/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }
    const body = req.body as Record<string, unknown>
    const allowed = ['position_title', 'department', 'incumbent_id', 'risk_level', 'notes']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k] }
    if (Object.keys(update).length === 0) return reply.status(400).send({ error: 'No fields to update' })

    const { error } = await supabase.from('succession_plans').update(update).eq('tenant_id', tenantId).eq('id', id)
    if (error) return reply.status(500).send({ error: error.message })
    await logAction(supabase, { tenantId, tableName: 'succession_plans', recordId: id, action: 'UPDATE', performedBy: req.user.id, newData: update })
    return reply.send({ data: { updated: true } })
  })

  // ── Archive plan ──────────────────────────────────────────────────────────

  fastify.post('/plans/:id/archive', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }
    const { error } = await supabase.from('succession_plans').update({ status: 'archived' }).eq('tenant_id', tenantId).eq('id', id)
    if (error) return reply.status(500).send({ error: error.message })
    await logAction(supabase, { tenantId, tableName: 'succession_plans', recordId: id, action: 'UPDATE', performedBy: req.user.id, newData: { status: 'archived' } })
    return reply.send({ data: { archived: true } })
  })

  // ── Add candidate ─────────────────────────────────────────────────────────

  fastify.post('/plans/:id/candidates', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id: plan_id } = req.params as { id: string }
    const { employee_id, readiness_level = 'ready_3_5_years', readiness_score, strengths, gaps, development_plan, notes } = req.body as any
    if (!employee_id) return reply.status(400).send({ error: 'employee_id is required' })

    const { data, error } = await supabase
      .from('succession_candidates')
      .insert({ tenant_id: tenantId, plan_id, employee_id, readiness_level, readiness_score: readiness_score ?? null, strengths, gaps, development_plan, notes, nominated_by: req.user.id })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    await logAction(supabase, { tenantId, tableName: 'succession_candidates', recordId: data.id, action: 'INSERT', performedBy: req.user.id, newData: { plan_id, employee_id, readiness_level } })
    return reply.status(201).send({ data })
  })

  // ── Update candidate (readiness + scorecard fields) ───────────────────────

  fastify.put('/plans/:id/candidates/:cid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const body = req.body as Record<string, unknown>
    const allowed = [
      'readiness_level', 'readiness_score', 'strengths', 'gaps', 'development_plan', 'notes',
      'nine_box_performance', 'nine_box_potential',
      'score_performance', 'score_skill_gap', 'score_leadership',
      'score_mobility', 'score_tenure', 'score_attrition_risk',
      'attrition_risk_flag',
    ]
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k] }
    if (Object.keys(update).length === 0) return reply.status(400).send({ error: 'No fields to update' })

    const { error } = await supabase.from('succession_candidates').update(update).eq('tenant_id', tenantId).eq('id', cid)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  // ── Remove candidate ──────────────────────────────────────────────────────

  fastify.delete('/plans/:id/candidates/:cid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const { error } = await supabase.from('succession_candidates').delete().eq('tenant_id', tenantId).eq('id', cid)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { deleted: true } })
  })

  // ── 9-Box Grid ────────────────────────────────────────────────────────────

  fastify.get('/nine-box', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const { data, error } = await supabase
      .from('succession_candidates')
      .select(`
        id, nine_box_performance, nine_box_potential, readiness_level, readiness_score,
        employees!succession_candidates_employee_id_fkey(id, first_name, last_name, employee_code, designation, department)
      `)
      .eq('tenant_id', tenantId)

    if (error) return reply.status(500).send({ error: error.message })

    const grid: Record<string, any[]> = {}
    const ungrouped: any[] = []

    for (const c of (data ?? [])) {
      if (c.nine_box_performance != null && c.nine_box_potential != null) {
        const key = `${c.nine_box_performance},${c.nine_box_potential}`
        if (!grid[key]) grid[key] = []
        grid[key].push(c)
      } else {
        ungrouped.push(c)
      }
    }

    return reply.send({ data: { grid, ungrouped } })
  })

  // ── AI Recommendations ────────────────────────────────────────────────────

  fastify.get('/ai-recommendations', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const { data: plans, error: plansError } = await supabase
      .from('succession_plans')
      .select('id, position_title, department, risk_level')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    if (plansError) return reply.status(500).send({ error: plansError.message })

    const planIds = (plans ?? []).map(p => p.id)
    if (planIds.length === 0) return reply.send({ data: [] })

    const { data: candidates, error: candError } = await supabase
      .from('succession_candidates')
      .select(`
        id, plan_id, readiness_level, readiness_score,
        score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
        attrition_risk_flag,
        employees!succession_candidates_employee_id_fkey(id, first_name, last_name, employee_code, designation, department)
      `)
      .eq('tenant_id', tenantId)
      .in('plan_id', planIds)

    if (candError) return reply.status(500).send({ error: candError.message })

    const candsByPlan: Record<string, any[]> = {}
    for (const c of (candidates ?? [])) {
      if (!candsByPlan[c.plan_id]) candsByPlan[c.plan_id] = []
      candsByPlan[c.plan_id].push(c)
    }

    const result = (plans ?? []).map(plan => {
      const planCandidates = (candsByPlan[plan.id] ?? [])
        .map(c => ({
          ...c,
          weighted_score: computeWeightedScore(c),
        }))
        .sort((a, b) => b.weighted_score - a.weighted_score)
        .slice(0, 3)
        .map(c => ({
          candidate:      c,
          employee:       c.employees,
          weighted_score: Math.round(c.weighted_score * 10) / 10,
          readiness_tier: readinessTier(c.weighted_score),
        }))

      return { plan, recommendations: planCandidates }
    })

    return reply.send({ data: result })
  })

  // ── IDP Actions: list ─────────────────────────────────────────────────────

  fastify.get('/plans/:id/candidates/:cid/idp', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }

    const { data, error } = await supabase
      .from('succession_idp_actions')
      .select('id, action_type, description, target_date, completed_at, created_at, created_by')
      .eq('tenant_id', tenantId)
      .eq('candidate_id', cid)
      .order('created_at')

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── IDP Actions: add ──────────────────────────────────────────────────────

  fastify.post('/plans/:id/candidates/:cid/idp', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const { action_type = 'course', description, target_date } = req.body as any
    if (!description?.trim()) return reply.status(400).send({ error: 'description is required' })

    const { data, error } = await supabase
      .from('succession_idp_actions')
      .insert({
        tenant_id:    tenantId,
        candidate_id: cid,
        action_type:  action_type || 'course',
        description:  description.trim(),
        target_date:  target_date || null,
        created_by:   req.user.id,
      })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send({ data })
  })

  // ── IDP Actions: update / mark complete ───────────────────────────────────

  fastify.patch('/plans/:id/candidates/:cid/idp/:aid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { aid } = req.params as { id: string; cid: string; aid: string }
    const body = req.body as Record<string, unknown>
    const allowed = ['completed_at', 'description', 'target_date', 'action_type']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k] }
    if (Object.keys(update).length === 0) return reply.status(400).send({ error: 'No fields to update' })

    const { error } = await supabase
      .from('succession_idp_actions')
      .update(update)
      .eq('tenant_id', tenantId)
      .eq('id', aid)

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  // ── IDP Actions: delete ───────────────────────────────────────────────────

  fastify.delete('/plans/:id/candidates/:cid/idp/:aid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { aid } = req.params as { id: string; cid: string; aid: string }

    const { error } = await supabase
      .from('succession_idp_actions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', aid)

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { deleted: true } })
  })
}
