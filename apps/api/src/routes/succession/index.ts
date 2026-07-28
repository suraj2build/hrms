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

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, notFound, validationError, ErrorCode } from '../../lib/api-errors.js'

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

// ── Body schemas ─────────────────────────────────────────────────────────────

const CreatePlanSchema = z.object({
  position_title: z.string().min(1, 'position_title is required'),
  department: z.string().optional().nullable(),
  incumbent_id: z.string().uuid().optional().nullable(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  notes: z.string().optional().nullable(),
})

const UpdatePlanSchema = z.object({
  position_title: z.string().optional(),
  department: z.string().optional().nullable(),
  incumbent_id: z.string().uuid().optional().nullable(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  notes: z.string().optional().nullable(),
})

const READINESS_LEVELS = ['ready_now', 'ready_1_2_years', 'ready_3_5_years'] as const

const AddCandidateSchema = z.object({
  employee_id: z.string().uuid('employee_id must be a valid UUID'),
  readiness_level: z.enum(READINESS_LEVELS).optional(),
  readiness_score: z.number().min(0).max(100).optional().nullable(),
  strengths: z.string().optional().nullable(),
  gaps: z.string().optional().nullable(),
  development_plan: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const UpdateCandidateSchema = z.object({
  readiness_level: z.enum(READINESS_LEVELS).optional(),
  readiness_score: z.number().min(0).max(100).optional().nullable(),
  strengths: z.string().optional().nullable(),
  gaps: z.string().optional().nullable(),
  development_plan: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  nine_box_performance: z.number().int().min(1).max(3).optional().nullable(),
  nine_box_potential: z.number().int().min(1).max(3).optional().nullable(),
  // .int() — these columns are SMALLINT (migration 330); a fractional value
  // (e.g. 7.5) previously passed zod validation and failed at the DB layer
  // with an opaque type-cast error instead of a clean 400.
  score_performance: z.number().int().min(0).max(10).optional().nullable(),
  score_skill_gap: z.number().int().min(0).max(10).optional().nullable(),
  score_leadership: z.number().int().min(0).max(10).optional().nullable(),
  score_mobility: z.number().int().min(0).max(10).optional().nullable(),
  score_tenure: z.number().int().min(0).max(10).optional().nullable(),
  score_attrition_risk: z.number().int().min(0).max(10).optional().nullable(),
  attrition_risk_flag: z.boolean().optional().nullable(),
})

// succession_idp_actions.action_type CHECK constraint (migration 330) — the
// ground truth for valid action types. Matches the frontend's ActionType
// union (AdminSuccession.tsx).
const ACTION_TYPES = ['course', 'assignment', 'mentoring', 'certification', 'coaching'] as const

const AddIdpActionSchema = z.object({
  action_type: z.enum(ACTION_TYPES).optional(),
  description: z.string().min(1, 'description is required'),
  target_date: z.string().optional().nullable(),
})

const UpdateIdpActionSchema = z.object({
  completed_at: z.string().optional().nullable(),
  description: z.string().optional(),
  target_date: z.string().optional().nullable(),
  action_type: z.enum(ACTION_TYPES).optional(),
})

const CreateCalibrationSchema = z.object({
  title: z.string().min(1, 'title is required'),
  participants: z.array(z.string().uuid()).optional(),
})

const CalibrationChangeSchema = z.object({
  employee_id: z.string().uuid('employee_id must be a valid UUID'),
  field_changed: z.enum([
    'readiness_level', 'score_performance', 'score_skill_gap', 'score_leadership',
    'score_mobility', 'score_tenure', 'score_attrition_risk',
    'nine_box_performance', 'nine_box_potential',
  ]),
  old_value: z.unknown().optional(),
  new_value: z.unknown().optional(),
  notes: z.string().optional().nullable(),
})

const WhatIfSchema = z.object({
  departing_employee_id: z.string().uuid('departing_employee_id must be a valid UUID'),
})

export default async function successionRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }
  const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── Dashboard ─────────────────────────────────────────────────────────────

  fastify.get('/dashboard', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const [plans, candidates] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        supabase.from('succession_plans')
          .select('id, risk_level')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .range(from, to)),
      fetchAllRows<any>((from, to) =>
        supabase.from('succession_candidates')
          .select('plan_id, readiness_level')
          .eq('tenant_id', tenantId)
          .range(from, to)),
    ])

    const riskBreakdown = { critical: 0, high: 0, medium: 0, low: 0 }
    plans.forEach(p => { riskBreakdown[p.risk_level as keyof typeof riskBreakdown]++ })

    const readyNow = candidates.filter(c => c.readiness_level === 'ready_now').length
    // Which specific plans have at least one ready-now candidate — coverage
    // must be judged per plan, not by whether ANY plan tenant-wide has one
    // (that previously let a single unrelated ready-now candidate make every
    // critical-risk plan report as "covered").
    const plansWithReadyNow = new Set(
      candidates.filter(c => c.readiness_level === 'ready_now').map(c => c.plan_id),
    )

    return reply.send({
      data: {
        total_plans:    plans.length,
        risk_breakdown: riskBreakdown,
        total_candidates: candidates.length,
        ready_now:      readyNow,
        coverage_rate:  plans.length > 0 ? Math.round((plans.filter(p => p.risk_level !== 'critical' || plansWithReadyNow.has(p.id)).length / plans.length) * 100) : 0,
      },
    })
  })

  // ── List plans ────────────────────────────────────────────────────────────

  fastify.get('/plans', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { status = 'active' } = req.query as { status?: string }

    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('succession_plans')
          .select(`id, position_title, department, risk_level, status, notes, created_at, employees!succession_plans_incumbent_id_fkey(id, first_name, last_name, employee_code)`)
          .eq('tenant_id', tenantId)
          .eq('status', status)
          .order('risk_level', { ascending: false })
          .order('position_title')
          .range(from, to),
      )
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch succession plans')
    }

    // Attach candidate counts
    const planIds = data.map(p => p.id)
    const countMap: Record<string, number> = {}
    if (planIds.length > 0) {
      let counts: any[]
      try {
        counts = await fetchAllRows<any>((from, to) =>
          supabase
            .from('succession_candidates')
            .select('plan_id')
            .eq('tenant_id', tenantId)
            .in('plan_id', planIds)
            .range(from, to))
      } catch (err: any) {
        return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch candidate counts')
      }
      counts.forEach(c => { countMap[c.plan_id] = (countMap[c.plan_id] ?? 0) + 1 })
    }

    return reply.send({ data: data.map(p => ({ ...p, candidate_count: countMap[p.id] ?? 0 })) })
  })

  // ── Get single plan with candidates ──────────────────────────────────────

  fastify.get('/plans/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }

    const [planResult, candidatesResult] = await Promise.all([
      supabase.from('succession_plans')
        .select(`id, position_title, department, risk_level, status, notes, created_at, updated_at,
          employees!succession_plans_incumbent_id_fkey(id, first_name, last_name, employee_code, designation:designations(name))`)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single(),
      supabase.from('succession_candidates')
        .select(`id, readiness_level, readiness_score, strengths, gaps, development_plan, notes, created_at,
          nine_box_performance, nine_box_potential,
          score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
          attrition_risk_flag,
          employees!succession_candidates_employee_id_fkey(id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name))`)
        .eq('tenant_id', tenantId)
        .eq('plan_id', id)
        .order('readiness_level')
        .order('readiness_score', { ascending: false })
        .limit(200),
    ])

    if (planResult.error || !planResult.data) return reply.status(404).send({ error: 'Plan not found' })
    if (candidatesResult.error) return serverError(req, reply, candidatesResult.error, ErrorCode.QUERY_FAILED, 'Failed to fetch succession candidates')

    return reply.send({ data: { ...planResult.data, candidates: candidatesResult.data ?? [] } })
  })

  // ── Create plan ───────────────────────────────────────────────────────────

  fastify.post('/plans', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const parsed = CreatePlanSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { position_title, department, incumbent_id, risk_level = 'medium', notes } = parsed.data

    // Fresh audit finding (cross-tenant IDOR): incumbent_id was inserted
    // with no tenant check, then echoed back unfiltered via GET /plans/:id's
    // employees!succession_plans_incumbent_id_fkey join — leaking a foreign
    // tenant's employee identity.
    if (incumbent_id) {
      const { data: incumbent } = await supabase
        .from('employees').select('id').eq('id', incumbent_id).eq('tenant_id', tenantId).maybeSingle()
      if (!incumbent) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Incumbent not found in your organisation' })
    }

    const { data, error } = await supabase
      .from('succession_plans')
      .insert({ tenant_id: tenantId, position_title: position_title.trim(), department, incumbent_id: incumbent_id || null, risk_level, notes, created_by: req.userId })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create succession plan')

    await logAction(supabase, { tenantId, tableName: 'succession_plans', recordId: data.id, action: 'INSERT', performedBy: req.userId, newData: { position_title, risk_level } })
    return reply.status(201).send({ data })
  })

  // ── Update plan ───────────────────────────────────────────────────────────

  fastify.put('/plans/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }
    const parsed = UpdatePlanSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const body = parsed.data as Record<string, unknown>
    const allowed = ['position_title', 'department', 'incumbent_id', 'risk_level', 'notes']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k] }
    if (Object.keys(update).length === 0) return reply.status(400).send({ error: 'No fields to update' })

    // Same cross-tenant IDOR guard as POST /plans above — incumbent_id can
    // also be set via this update path.
    if (update.incumbent_id) {
      const { data: incumbent } = await supabase
        .from('employees').select('id').eq('id', update.incumbent_id as string).eq('tenant_id', tenantId).maybeSingle()
      if (!incumbent) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Incumbent not found in your organisation' })
    }

    const { data: updated, error } = await supabase.from('succession_plans').update(update).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update succession plan')
    if (!updated) return notFound(reply, 'PLAN_NOT_FOUND', 'Succession plan not found')
    await logAction(supabase, { tenantId, tableName: 'succession_plans', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: update })
    return reply.send({ data: { updated: true } })
  })

  // ── Archive plan ──────────────────────────────────────────────────────────

  fastify.post('/plans/:id/archive', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }
    const { data: archived, error } = await supabase.from('succession_plans').update({ status: 'archived' }).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to archive succession plan')
    if (!archived) return notFound(reply, 'PLAN_NOT_FOUND', 'Succession plan not found')
    await logAction(supabase, { tenantId, tableName: 'succession_plans', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status: 'archived' } })
    return reply.send({ data: { archived: true } })
  })

  // ── Add candidate ─────────────────────────────────────────────────────────

  fastify.post('/plans/:id/candidates', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id: plan_id } = req.params as { id: string }
    const parsed = AddCandidateSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { employee_id, readiness_level = 'ready_3_5_years', readiness_score, strengths, gaps, development_plan, notes } = parsed.data

    // Fresh audit finding (cross-tenant IDOR): employee_id was inserted
    // with no tenant check, then echoed back unfiltered via GET /plans/:id's
    // employees!succession_candidates_employee_id_fkey join.
    const { data: candidateEmp } = await supabase
      .from('employees').select('id').eq('id', employee_id).eq('tenant_id', tenantId).maybeSingle()
    if (!candidateEmp) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Employee not found in your organisation' })

    // Fresh audit finding (cross-tenant IDOR): plan_id comes straight from the
    // URL with no check that the plan belongs to this tenant — a guessed
    // foreign-tenant plan UUID would silently attach this candidate to it.
    const { data: plan } = await supabase
      .from('succession_plans').select('id').eq('id', plan_id).eq('tenant_id', tenantId).maybeSingle()
    if (!plan) return notFound(reply, 'PLAN_NOT_FOUND', 'Succession plan not found')

    const { data, error } = await supabase
      .from('succession_candidates')
      .insert({ tenant_id: tenantId, plan_id, employee_id, readiness_level, readiness_score: readiness_score ?? null, strengths, gaps, development_plan, notes, nominated_by: req.userId })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return reply.status(409).send({ error: 'CONFLICT', message: 'This employee is already a candidate for this plan' })
      if (error.code === '23514') return validationError(reply, ErrorCode.VALIDATION_ERROR, 'Invalid value for one or more scorecard fields')
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to add succession candidate')
    }
    await logAction(supabase, { tenantId, tableName: 'succession_candidates', recordId: data.id, action: 'INSERT', performedBy: req.userId, newData: { plan_id, employee_id, readiness_level } })
    return reply.status(201).send({ data })
  })

  // ── Update candidate (readiness + scorecard fields) ───────────────────────

  fastify.put('/plans/:id/candidates/:cid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const parsed = UpdateCandidateSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const body = parsed.data as Record<string, unknown>
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

    const { data: updated, error } = await supabase.from('succession_candidates').update(update).eq('tenant_id', tenantId).eq('id', cid).select('id').maybeSingle()
    if (error) {
      if (error.code === '23514') return validationError(reply, ErrorCode.VALIDATION_ERROR, 'Invalid value for one or more scorecard fields')
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update succession candidate')
    }
    if (!updated) return notFound(reply, 'CANDIDATE_NOT_FOUND', 'Succession candidate not found')
    return reply.send({ data: { updated: true } })
  })

  // ── Remove candidate ──────────────────────────────────────────────────────

  fastify.delete('/plans/:id/candidates/:cid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const { data: deleted, error } = await supabase.from('succession_candidates').delete().eq('tenant_id', tenantId).eq('id', cid).select('id').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to remove succession candidate')
    if (!deleted) return notFound(reply, 'CANDIDATE_NOT_FOUND', 'Succession candidate not found')
    return reply.send({ data: { deleted: true } })
  })

  // ── 9-Box Grid ────────────────────────────────────────────────────────────

  fastify.get('/nine-box', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId

    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('succession_candidates')
          .select(`
            id, nine_box_performance, nine_box_potential, readiness_level, readiness_score,
            employees!succession_candidates_employee_id_fkey(id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name))
          `)
          .eq('tenant_id', tenantId)
          .range(from, to)
      ) as any[]
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch succession candidates')
    }

    const grid: Record<string, any[]> = {}
    const ungrouped: any[] = []

    for (const c of data) {
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

    let plans: any[]
    let candidates: any[]
    try {
      plans = await fetchAllRows((from, to) =>
        supabase
          .from('succession_plans')
          .select('id, position_title, department, risk_level')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .range(from, to)
      ) as any[]
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch succession plans')
    }

    const planIds = plans.map(p => p.id)
    if (planIds.length === 0) return reply.send({ data: [] })

    try {
      candidates = await fetchAllRows((from, to) =>
        supabase
          .from('succession_candidates')
          .select(`
            id, plan_id, readiness_level, readiness_score,
            score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
            attrition_risk_flag,
            employees!succession_candidates_employee_id_fkey(id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name))
          `)
          .eq('tenant_id', tenantId)
          .in('plan_id', planIds)
          .range(from, to)
      ) as any[]
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch succession candidates')
    }

    const candsByPlan: Record<string, any[]> = {}
    for (const c of candidates) {
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
      .limit(100)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch IDP actions')
    return reply.send({ data: data ?? [] })
  })

  // ── IDP Actions: add ──────────────────────────────────────────────────────

  fastify.post('/plans/:id/candidates/:cid/idp', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const parsed = AddIdpActionSchema.safeParse(req.body)
    if (!parsed.success) return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Invalid request body')
    const { action_type = 'course', description, target_date } = parsed.data

    // Fresh audit finding (cross-tenant IDOR): cid comes straight from the URL
    // with no check that the succession_candidates row belongs to this tenant
    // — a guessed foreign-tenant candidate id would silently attach this IDP
    // action to it.
    const { data: candidate } = await supabase
      .from('succession_candidates').select('id').eq('id', cid).eq('tenant_id', tenantId).maybeSingle()
    if (!candidate) return notFound(reply, 'CANDIDATE_NOT_FOUND', 'Succession candidate not found')

    const { data, error } = await supabase
      .from('succession_idp_actions')
      .insert({
        tenant_id:    tenantId,
        candidate_id: cid,
        action_type:  action_type || 'course',
        description:  description.trim(),
        target_date:  target_date || null,
        created_by:   req.userId,
      })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to add IDP action')
    return reply.status(201).send({ data })
  })

  // ── IDP Actions: update / mark complete ───────────────────────────────────

  fastify.patch('/plans/:id/candidates/:cid/idp/:aid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { aid } = req.params as { id: string; cid: string; aid: string }
    const parsed = UpdateIdpActionSchema.safeParse(req.body)
    if (!parsed.success) return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Invalid request body')
    const body = parsed.data as Record<string, unknown>
    const allowed = ['completed_at', 'description', 'target_date', 'action_type']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k] }
    if (Object.keys(update).length === 0) return validationError(reply, ErrorCode.VALIDATION_ERROR, 'No fields to update')

    const { data: updated, error } = await supabase
      .from('succession_idp_actions')
      .update(update)
      .eq('tenant_id', tenantId)
      .eq('id', aid)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update IDP action')
    if (!updated) return notFound(reply, 'IDP_ACTION_NOT_FOUND', 'IDP action not found')
    return reply.send({ data: { updated: true } })
  })

  // ── IDP Actions: delete ───────────────────────────────────────────────────

  fastify.delete('/plans/:id/candidates/:cid/idp/:aid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { aid } = req.params as { id: string; cid: string; aid: string }

    const { data: deleted, error } = await supabase
      .from('succession_idp_actions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', aid)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete IDP action')
    if (!deleted) return notFound(reply, 'IDP_ACTION_NOT_FOUND', 'IDP action not found')
    return reply.send({ data: { deleted: true } })
  })

  // ── IDP AI generator ──────────────────────────────────────────────────────

  fastify.post('/plans/:id/candidates/:cid/idp/ai-generate', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid }  = req.params as { id: string; cid: string }

    const { data: candidate } = await supabase
      .from('succession_candidates')
      .select(`strengths, gaps, readiness_level, development_plan,
        employees!succession_candidates_employee_id_fkey(first_name, last_name, designation:designations(name), department:departments!department_id(name))`)
      .eq('tenant_id', tenantId)
      .eq('id', cid)
      .single()

    if (!candidate) return notFound(reply, 'NOT_FOUND', 'Candidate not found')
    const c = candidate as any

    if (!process.env.ANTHROPIC_API_KEY) return reply.status(503).send({ error: 'AI_NOT_CONFIGURED', message: 'AI generation is not available in this environment' })

    let actions: any[] = []
    try {
      const msg = await ai.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: `You are an HR succession planning expert. Generate practical IDP actions. Return ONLY a JSON array of objects with keys: action_type (${ACTION_TYPES.join('|')}), description (concise action, max 120 chars), target_months (number).`,
        messages: [{
          role:    'user',
          content: `Generate 5 IDP actions for:\nName: ${c.employees?.first_name} ${c.employees?.last_name}\nRole: ${c.employees?.designation} (${c.employees?.department})\nReadiness: ${c.readiness_level}\nStrengths: ${c.strengths || 'N/A'}\nGaps: ${c.gaps || 'N/A'}\nCurrent plan: ${c.development_plan || 'None'}`,
        }],
      })
      const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '[]'
      try { actions = JSON.parse(raw.replace(/```json|```/g, '').trim()) } catch (_) {}
    } catch (err: any) {
      fastify.log.error({ err, cid }, 'succession/idp/ai-generate: AI call failed')
      return reply.status(502).send({ error: 'AI_ERROR', message: 'AI generation failed — try again or add actions manually' })
    }

    return reply.send({ data: actions })
  })

  // ── What-If scenario ──────────────────────────────────────────────────────

  fastify.post('/what-if', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const parsed = WhatIfSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { departing_employee_id } = parsed.data

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
        employees!succession_candidates_employee_id_fkey(id, first_name, last_name, designation:designations(name))`)
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
      .limit(200)
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch calibration sessions')
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/calibration', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const parsed = CreateCalibrationSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { title, participants } = parsed.data

    const { data, error } = await supabase
      .from('calibration_sessions')
      .insert({
        tenant_id:    tenantId,
        title:        title.trim(),
        participants: participants ?? [],
        status:       'open',
        created_by:   req.userId,
      })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create calibration session')
    return reply.status(201).send({ data })
  })

  fastify.get('/calibration/:sessionId', hrAuth, async (req: any, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const tenantId      = req.tenantId

    const changesData = await fetchAllRows((from, to) =>
      supabase.from('calibration_changes')
        .select(`id, field_changed, old_value, new_value, notes, created_at, employee:employees!employee_id(first_name, last_name, employee_code)`)
        .eq('session_id', sessionId).eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to),
    ).catch(() => [] as any[])

    const [sessionResult] = await Promise.all([
      supabase.from('calibration_sessions')
        .select('id, title, status, created_at, participants, closed_at')
        .eq('id', sessionId).eq('tenant_id', tenantId).single(),
    ])

    if (sessionResult.error || !sessionResult.data) return reply.status(404).send({ error: 'Session not found' })
    return reply.send({ data: { ...sessionResult.data, changes: changesData } })
  })

  // Mirrors the DB CHECK constraints on succession_candidates (migration 330)
  // so an out-of-range new_value is rejected before it's ever written to the
  // audit trail — without this, the UPDATE below would fail the CHECK
  // silently (error not checked) while the calibration_changes row already
  // claims the change was applied, and the endpoint still returned 201.
  function validateCandidateFieldValue(field: string, value: unknown): string | null {
    if (field === 'readiness_level') {
      return ['ready_now', 'ready_1_2_years', 'ready_3_5_years'].includes(value as string)
        ? null
        : 'readiness_level must be one of ready_now, ready_1_2_years, ready_3_5_years'
    }
    const n = Number(value)
    if (field === 'nine_box_performance' || field === 'nine_box_potential') {
      return Number.isInteger(n) && n >= 1 && n <= 3 ? null : `${field} must be an integer between 1 and 3`
    }
    return Number.isInteger(n) && n >= 0 && n <= 10 ? null : `${field} must be an integer between 0 and 10`
  }

  fastify.post('/calibration/:sessionId/changes', hrAuth, async (req: any, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const tenantId      = req.tenantId
    const parsed = CalibrationChangeSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { employee_id, field_changed, old_value, new_value, notes } = parsed.data

    if (field_changed && new_value !== undefined) {
      const validationErr = validateCandidateFieldValue(field_changed, new_value)
      if (validationErr) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: validationErr })
    }

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

    // Fresh audit finding: sessionId was inserted with no tenant-ownership
    // check, giving any tenant an existence oracle for other tenants' session UUIDs.
    const { data: sessionRow } = await supabase
      .from('calibration_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!sessionRow) return notFound(reply, 'CALIBRATION_SESSION_NOT_FOUND', 'Calibration session not found')

    const { data, error } = await supabase
      .from('calibration_changes')
      .insert({
        session_id:    sessionId,
        tenant_id:     tenantId,
        changed_by:    req.userId,
        candidate_id,
        employee_id,
        field_changed,
        old_value:     old_value ?? null,
        new_value:     new_value ?? null,
        notes:         notes ?? null,
      })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to record calibration change')

    // Apply the change to the candidate record
    if (field_changed && new_value !== undefined) {
      const validFields = ['readiness_level','score_performance','score_skill_gap','score_leadership','score_mobility','score_tenure','score_attrition_risk','nine_box_performance','nine_box_potential']
      if (validFields.includes(field_changed)) {
        const { error: applyErr } = await supabase.from('succession_candidates')
          .update({ [field_changed]: new_value })
          .eq('id', candidate_id).eq('tenant_id', tenantId)
        if (applyErr) {
          return serverError(req, reply, applyErr, ErrorCode.UPDATE_FAILED, 'Change was logged but failed to apply to the candidate record')
        }
      }
    }

    return reply.status(201).send({ data })
  })

  fastify.patch('/calibration/:sessionId/close', hrAuth, async (req: any, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const { data: closed, error } = await supabase
      .from('calibration_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId).eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to close calibration session')
    if (!closed) return notFound(reply, 'SESSION_NOT_FOUND', 'Calibration session not found')
    return reply.send({ data: { closed: true } })
  })

  // ── Mentor matching ────────────────────────────────────────────────────────

  fastify.get('/mentor-match/:candidateId', hrAuth, async (req: any, reply) => {
    const { candidateId } = req.params as { candidateId: string }
    const tenantId        = req.tenantId

    const { data: candidate } = await supabase
      .from('succession_candidates')
      .select('gaps, employees!succession_candidates_employee_id_fkey(department:departments!department_id(name), designation:designations(name))')
      .eq('id', candidateId).eq('tenant_id', tenantId).single()

    if (!candidate) return reply.status(404).send({ error: 'Candidate not found' })

    const { data: mentors } = await supabase
      .from('mentor_profiles')
      .select(`id, skill_tags, max_mentees, current_mentees, available, engagement_score,
        employees!mentor_profiles_employee_id_fkey(id, first_name, last_name, designation:designations(name), department:departments!department_id(name))`)
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
    const candidates = await fetchAllRows<any>((from, to) =>
      supabase.from('succession_candidates')
        .select('id, employee_id')
        .eq('tenant_id', tenantId)
        .range(from, to))

    if (!candidates.length) return reply.send({ data: { plotted: 0 } })

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

      const { error: updateErr } = await supabase.from('succession_candidates')
        .update({ nine_box_performance: perf, nine_box_potential: potential })
        .eq('id', c.id).eq('tenant_id', tenantId)
      if (!updateErr) plotted++
    }

    return reply.send({ data: { plotted } })
  })
}
