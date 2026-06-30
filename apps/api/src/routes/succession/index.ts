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
import Anthropic from '@anthropic-ai/sdk'
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
  const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  // ── IDP AI generator ──────────────────────────────────────────────────────

  fastify.post('/plans/:id/candidates/:cid/idp/ai-generate', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid }  = req.params as { id: string; cid: string }

    const { data: candidate } = await supabase
      .from('succession_candidates')
      .select(`strengths, gaps, readiness_level, development_plan,
        employees!succession_candidates_employee_id_fkey(first_name, last_name, designation, department)`)
      .eq('tenant_id', tenantId)
      .eq('id', cid)
      .single()

    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })
    const c = candidate as any

    const msg = await ai.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: 'You are an HR succession planning expert. Generate practical IDP actions. Return ONLY a JSON array of objects with keys: action_type (course|stretch|mentoring|project|certification), description (concise action, max 120 chars), target_months (number).',
      messages: [{
        role:    'user',
        content: `Generate 5 IDP actions for:\nName: ${c.employees?.first_name} ${c.employees?.last_name}\nRole: ${c.employees?.designation} (${c.employees?.department})\nReadiness: ${c.readiness_level}\nStrengths: ${c.strengths || 'N/A'}\nGaps: ${c.gaps || 'N/A'}\nCurrent plan: ${c.development_plan || 'None'}`,
      }],
    })

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '[]'
    let actions: any[] = []
    try { actions = JSON.parse(raw.replace(/```json|```/g, '').trim()) } catch (_) {}

    return reply.send({ data: actions })
  })

  // ── What-If scenario ──────────────────────────────────────────────────────

  fastify.post('/what-if', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { departing_employee_id } = req.body as { departing_employee_id: string }
    if (!departing_employee_id) return reply.status(400).send({ error: 'departing_employee_id is required' })

    // Fetch the departing employee's info
    const { data: deptEmployee } = await supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('id', departing_employee_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    // Find succession plans where this employee is the incumbent
    const { data: plans } = await supabase
      .from('succession_plans')
      .select(`id, position_title, department, risk_level, status`)
      .eq('tenant_id', tenantId)
      .eq('incumbent_id', departing_employee_id)
      .eq('status', 'active')

    if (!plans?.length) {
      return reply.send({
        data: {
          departing_employee: deptEmployee
            ? { id: deptEmployee.id, name: `${deptEmployee.first_name} ${deptEmployee.last_name}`, employee_code: deptEmployee.employee_code }
            : { id: departing_employee_id, name: 'Unknown', employee_code: '' },
          affected_plans: [],
        },
      })
    }

    const planIds = plans.map(p => p.id)
    const { data: candidates } = await supabase
      .from('succession_candidates')
      .select(`id, plan_id, readiness_level, readiness_score,
        score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
        employees!succession_candidates_employee_id_fkey(id, first_name, last_name, designation)`)
      .eq('tenant_id', tenantId)
      .in('plan_id', planIds)

    const candsByPlan: Record<string, any[]> = {}
    for (const c of candidates ?? []) {
      if (!candsByPlan[c.plan_id]) candsByPlan[c.plan_id] = []
      candsByPlan[c.plan_id].push({ ...c, weighted_score: computeWeightedScore(c) })
    }

    const affected_plans = plans.map(plan => {
      const sorted = (candsByPlan[plan.id] ?? []).sort((a, b) => b.weighted_score - a.weighted_score)
      const top_candidates = sorted.map((c: any) => ({
        id:              c.employees?.id ?? c.id,
        name:            c.employees ? `${c.employees.first_name} ${c.employees.last_name}` : 'Unknown',
        readiness_level: c.readiness_level,
        readiness_score: c.readiness_score ?? null,
      }))
      return {
        plan_id:        plan.id,
        position_title: plan.position_title,
        risk_level:     plan.risk_level,
        top_candidates,
      }
    })

    const departing_employee = deptEmployee
      ? { id: deptEmployee.id, name: `${deptEmployee.first_name} ${deptEmployee.last_name}`, employee_code: deptEmployee.employee_code }
      : { id: departing_employee_id, name: 'Unknown', employee_code: '' }

    return reply.send({ data: { departing_employee, affected_plans } })
  })

  // ── Calibration sessions ──────────────────────────────────────────────────

  fastify.get('/calibration', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { data, error } = await supabase
      .from('calibration_sessions')
      .select('id, title, status, created_at, created_by, closed_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/calibration', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { title, participants } = req.body as { title: string; participants?: string[] }
    if (!title?.trim()) return reply.status(400).send({ error: 'title is required' })

    const { data, error } = await supabase
      .from('calibration_sessions')
      .insert({
        tenant_id:    tenantId,
        title:        title.trim(),
        participants: participants ?? [],
        status:       'open',
        created_by:   req.user.id,
      })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send({ data })
  })

  fastify.get('/calibration/:sessionId', hrAuth, async (req: any, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const tenantId      = req.tenantId

    const [sessionResult, changesResult] = await Promise.all([
      supabase.from('calibration_sessions')
        .select('id, title, status, created_at, participants, closed_at')
        .eq('id', sessionId).eq('tenant_id', tenantId).single(),
      supabase.from('calibration_changes')
        .select(`id, field_changed, old_value, new_value, notes, created_at,
          employees!calibration_changes_candidate_id_fkey(first_name, last_name, employee_code)`)
        .eq('session_id', sessionId).eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ])

    if (sessionResult.error || !sessionResult.data) return reply.status(404).send({ error: 'Session not found' })
    return reply.send({ data: { ...sessionResult.data, changes: changesResult.data ?? [] } })
  })

  fastify.post('/calibration/:sessionId/changes', hrAuth, async (req: any, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const tenantId      = req.tenantId
    const { employee_id, field_changed, old_value, new_value, notes } = req.body as any
    if (!employee_id || !field_changed) return reply.status(400).send({ error: 'employee_id and field_changed required' })

    // Look up the succession_candidates row for this employee in this tenant
    const { data: candRow } = await supabase
      .from('succession_candidates')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
    const candidate_id = candRow?.id
    if (!candidate_id) return reply.status(404).send({ error: 'No succession candidate found for this employee' })

    const { data, error } = await supabase
      .from('calibration_changes')
      .insert({
        session_id:    sessionId,
        tenant_id:     tenantId,
        changed_by:    req.user.id,
        candidate_id,
        field_changed,
        old_value:     old_value ?? null,
        new_value:     new_value ?? null,
        notes:         notes ?? null,
      })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    // Apply the change to the candidate record
    if (field_changed && new_value !== undefined) {
      const validFields = ['readiness_level','score_performance','score_skill_gap','score_leadership','score_mobility','score_tenure','score_attrition_risk','nine_box_performance','nine_box_potential']
      if (validFields.includes(field_changed)) {
        await supabase.from('succession_candidates')
          .update({ [field_changed]: new_value })
          .eq('id', candidate_id).eq('tenant_id', tenantId)
      }
    }

    return reply.status(201).send({ data })
  })

  fastify.patch('/calibration/:sessionId/close', hrAuth, async (req: any, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const { error } = await supabase
      .from('calibration_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId).eq('tenant_id', req.tenantId)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { closed: true } })
  })

  // ── Mentor matching ────────────────────────────────────────────────────────

  fastify.get('/mentor-match/:candidateId', hrAuth, async (req: any, reply) => {
    const { candidateId } = req.params as { candidateId: string }
    const tenantId        = req.tenantId

    const { data: candidate } = await supabase
      .from('succession_candidates')
      .select('gaps, employees!succession_candidates_employee_id_fkey(department, designation)')
      .eq('id', candidateId).eq('tenant_id', tenantId).single()

    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })

    const { data: mentors } = await supabase
      .from('mentor_profiles')
      .select(`id, skill_tags, max_mentees, current_mentees, available, engagement_score,
        employees!mentor_profiles_employee_id_fkey(id, first_name, last_name, designation, department)`)
      .eq('tenant_id', tenantId)
      .eq('available', true)
      .lt('current_mentees', 9999) // filtered client-side on line below

    const cGaps: string[] = ((candidate as any).gaps ?? '').toLowerCase().split(/[,\s]+/).filter(Boolean)

    const scored = ((mentors ?? []) as any[])
      .filter(m => m.current_mentees < m.max_mentees)
      .map(m => {
        const tags: string[] = m.skill_tags ?? []
        const overlap = tags.filter(t => cGaps.some(g => t.toLowerCase().includes(g))).length
        return { ...m, match_score: overlap * 10 + (m.engagement_score ?? 0) }
      })
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 5)

    return reply.send({ data: scored })
  })

  // ── 9-Box auto-plot from appraisal data ───────────────────────────────────

  fastify.post('/nine-box/auto-plot', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    // Fetch candidates with appraisal data
    const { data: candidates } = await supabase
      .from('succession_candidates')
      .select('id, employee_id')
      .eq('tenant_id', tenantId)

    if (!candidates?.length) return reply.send({ data: { plotted: 0 } })

    let plotted = 0
    for (const c of candidates as any[]) {
      // Get latest appraisal score
      const { data: appraisal } = await supabase
        .from('appraisals')
        .select('final_rating, potential_rating')
        .eq('employee_id', c.employee_id)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!appraisal) continue
      const perf      = Math.min(3, Math.max(1, Math.ceil(((appraisal as any).final_rating ?? 3) / (10 / 3))))
      const potential = Math.min(3, Math.max(1, Math.ceil(((appraisal as any).potential_rating ?? 2) / (10 / 3))))

      await supabase.from('succession_candidates')
        .update({ nine_box_performance: perf, nine_box_potential: potential })
        .eq('id', c.id).eq('tenant_id', tenantId)
      plotted++
    }

    return reply.send({ data: { plotted } })
  })
}
