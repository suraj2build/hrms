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
 *   PUT  /plans/:id/candidates/:cid   — update candidate readiness
 *   DELETE /plans/:id/candidates/:cid — remove candidate
 *
 *   GET /dashboard           — summary stats (plan count, risk breakdown, ready-now count)
 */

import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'

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

  // ── Update candidate ──────────────────────────────────────────────────────

  fastify.put('/plans/:id/candidates/:cid', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { cid } = req.params as { id: string; cid: string }
    const body = req.body as Record<string, unknown>
    const allowed = ['readiness_level', 'readiness_score', 'strengths', 'gaps', 'development_plan', 'notes']
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
}
