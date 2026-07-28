/**
 * Benefits Enrolment — ESS-05
 *
 * Distinct from the FBP tax module. HR defines benefit plans (group health,
 * term life, accident, wellness, meal/transport) with a cost split and an
 * optional enrolment window; employees enrol or waive, and select which of
 * their dependents (employee_family rows) are covered.
 *
 * Registered at prefix '/benefits'.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { InsuranceProvider } from '../../lib/insurance-provider.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate }  from '../../lib/org-context.js'

async function tenantTodayStr(supabase: any, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

const PLAN_TYPES = ['health', 'term_life', 'accident', 'wellness', 'meal', 'transport', 'nps', 'other'] as const

async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as any)?.employee_id ?? null
}

// A plan is "open" when active and today is within its (optional) window.
function isPlanOpen(plan: any, todayIso: string): boolean {
  if (!plan.is_active) return false
  if (plan.enrollment_opens_at  && todayIso < plan.enrollment_opens_at)  return false
  if (plan.enrollment_closes_at && todayIso > plan.enrollment_closes_at) return false
  return true
}

export default async function benefitsRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMPLOYEE (ESS)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /benefits/plans — active plans filtered by employee's designation_band
  fastify.get('/plans', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)

    // Fetch employee's band and salary for ESIC eligibility
    let empBand: string | null = null
    let empSalary: number | null = null
    let isEsicEligible = false
    if (employeeId) {
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('designation_band, gross_salary')
        .eq('id', employeeId)
        .maybeSingle()
      empBand      = (emp as any)?.designation_band ?? null
      empSalary    = (emp as any)?.gross_salary ?? null
      isEsicEligible = empSalary != null && empSalary <= 21000
    }

    const { data, error } = await fastify.supabase
      .from('benefit_plans')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .order('plan_type', { ascending: true })
      .order('name', { ascending: true })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch benefit plans')

    const today = await tenantTodayStr(fastify.supabase, req.tenantId)
    const plans = ((data ?? []) as any[])
      .filter(p => {
        // Band eligibility: if plan has eligible_bands, employee must be in one of them
        if (p.eligible_bands?.length && empBand) {
          return p.eligible_bands.includes(empBand)
        }
        return true
      })
      .map(p => ({
        ...p,
        is_open:         isPlanOpen(p, today),
        is_esic:         p.plan_type === 'health' && isEsicEligible && p.name?.toLowerCase().includes('esic'),
        is_nps:          p.plan_type === 'nps',
      }))

    return reply.send({ data: plans, meta: { employee_band: empBand, esic_eligible: isEsicEligible } })
  })

  // GET /benefits/my — caller's enrolments
  fastify.get('/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const { data, error } = await fastify.supabase
      .from('benefit_enrollments')
      .select('id, plan_id, status, dependent_ids, notes, enrolled_at, updated_at, benefit_plans(name, plan_type, coverage_amount, allows_dependents)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch benefit enrollments')
    return reply.send({ data: data ?? [] })
  })

  // GET /benefits/dependents — caller's dependents (for coverage selection)
  fastify.get('/dependents', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const { data, error } = await fastify.supabase
      .from('employee_family')
      .select('id, name, dob, gender, relationship_types(name)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('is_dependent', true)
      .order('created_at', { ascending: true })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch dependents')

    const deps = ((data ?? []) as any[]).map(d => ({
      id:           d.id,
      name:         d.name,
      dob:          d.dob,
      gender:       d.gender,
      relationship: (Array.isArray(d.relationship_types) ? d.relationship_types[0]?.name : d.relationship_types?.name) ?? null,
    }))
    return reply.send({ data: deps })
  })

  // POST /benefits/enroll — enrol or waive a plan
  fastify.post('/enroll', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const schema = z.object({
      plan_id:       z.string().uuid(),
      status:        z.enum(['enrolled', 'waived']).default('enrolled'),
      dependent_ids: z.array(z.string().uuid()).default([]),
      notes:         z.string().max(2000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Plan must exist, belong to tenant, and be open for enrolment.
    const { data: plan } = await fastify.supabase
      .from('benefit_plans')
      .select('*')
      .eq('id', parsed.data.plan_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Benefit plan not found' })

    const today = await tenantTodayStr(fastify.supabase, req.tenantId)
    if (!isPlanOpen(plan, today)) {
      return reply.code(409).send({ error: 'ENROLMENT_CLOSED', message: 'This plan is not open for enrolment' })
    }

    // Dependents only allowed when the plan permits them.
    let dependentIds = (plan as any).allows_dependents && parsed.data.status === 'enrolled'
      ? parsed.data.dependent_ids
      : []

    // dependent_ids are raw UUIDs from the request body — verify each is
    // actually one of the caller's own employee_family rows, or a caller
    // could enrol another tenant's (or employee's) dependent record onto
    // their own coverage, which then ships to the insurer via
    // InsuranceProvider.syncEnrolment() as part of this enrolment.
    if (dependentIds.length > 0) {
      const { data: ownDeps } = await fastify.supabase
        .from('employee_family')
        .select('id')
        .in('id', dependentIds)
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('is_dependent', true)
      const ownDepIds = new Set(((ownDeps ?? []) as any[]).map(d => d.id))
      dependentIds = dependentIds.filter((id: string) => ownDepIds.has(id))
    }

    const { data, error } = await fastify.supabase
      .from('benefit_enrollments')
      .upsert({
        tenant_id:     req.tenantId,
        employee_id:   employeeId,
        plan_id:       parsed.data.plan_id,
        status:        parsed.data.status,
        dependent_ids: dependentIds,
        notes:         parsed.data.notes ?? null,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'tenant_id,employee_id,plan_id' })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save benefit enrollment')

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'benefit_enrollments',
      recordId:    (data as any).id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     { plan_id: parsed.data.plan_id, status: parsed.data.status, dependents: dependentIds.length },
    })

    // Sync insurance enrolment/unenrolment for health/life/accident plans
    if (['health', 'term_life', 'accident'].includes((plan as any).plan_type)) {
      const insurer = new InsuranceProvider(fastify.supabase, req.tenantId)
      if (parsed.data.status === 'enrolled') {
        await insurer.syncEnrolment(employeeId, parsed.data.plan_id, dependentIds).catch(() => { /* non-blocking */ })
      } else if (parsed.data.status === 'waived') {
        await insurer.syncUnenrolment(employeeId, parsed.data.plan_id).catch(() => { /* non-blocking */ })
      }
    }

    return reply.send({ data })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // HR ADMIN
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /benefits/admin/plans — all plans (incl. inactive) with enrollment counts
  fastify.get('/admin/plans', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('benefit_plans')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch benefit plans')

    // Counts come from a separately-paginated enrollments fetch rather than a
    // nested .select('*, benefit_enrollments(status)') embed — PostgREST's
    // 1000-row cap applies to embedded resources too, so a popular plan with
    // 1000+ enrollments would silently undercount enrolled_count/total_count
    // on this HR admin dashboard (the exact numbers used for plan funding /
    // cost-split decisions).
    const planIds = ((data ?? []) as any[]).map(p => p.id)
    const enrollments = planIds.length
      ? await fetchAllRows<{ plan_id: string; status: string }>((from, to) =>
          fastify.supabase
            .from('benefit_enrollments')
            .select('plan_id, status')
            .eq('tenant_id', req.tenantId)
            .in('plan_id', planIds)
            .range(from, to),
        )
      : []

    const countsByPlan = new Map<string, { enrolled: number; total: number }>()
    for (const e of enrollments) {
      const c = countsByPlan.get(e.plan_id) ?? { enrolled: 0, total: 0 }
      c.total += 1
      if (e.status === 'enrolled') c.enrolled += 1
      countsByPlan.set(e.plan_id, c)
    }

    const today = await tenantTodayStr(fastify.supabase, req.tenantId)
    const plans = ((data ?? []) as any[]).map(p => {
      const counts = countsByPlan.get(p.id) ?? { enrolled: 0, total: 0 }

      let window_status: 'always_open' | 'open' | 'upcoming' | 'closed'
      if (!p.enrollment_opens_at && !p.enrollment_closes_at) {
        window_status = 'always_open'
      } else if (today < (p.enrollment_opens_at ?? '')) {
        window_status = 'upcoming'
      } else if (p.enrollment_closes_at && today > p.enrollment_closes_at) {
        window_status = 'closed'
      } else {
        window_status = 'open'
      }

      return {
        ...p,
        enrolled_count: counts.enrolled,
        total_count:    counts.total,
        window_status,
        is_esic: p.plan_type === 'health' && p.name?.toLowerCase().includes('esic'),
        is_nps:  p.plan_type === 'nps',
      }
    })

    return reply.send({ data: plans })
  })

  const planSchema = z.object({
    name:                      z.string().min(2).max(160),
    plan_type:                 z.enum(PLAN_TYPES).default('health'),
    provider:                  z.string().max(160).optional(),
    description:               z.string().max(4000).optional(),
    coverage_amount:           z.number().min(0).default(0),
    employee_cost:             z.number().min(0).default(0),
    employer_cost:             z.number().min(0).default(0),
    allows_dependents:         z.boolean().default(false),
    enrollment_opens_at:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    enrollment_closes_at:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    is_active:                 z.boolean().default(true),
    eligible_bands:            z.array(z.string()).optional(),
    employee_contribution_pct: z.number().min(0).max(100).optional(),
    employer_contribution_pct: z.number().min(0).max(100).optional(),
  })

  // POST /benefits/admin/plans — create a plan
  fastify.post('/admin/plans', hrAdminAuth, async (req: any, reply) => {
    const parsed = planSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('benefit_plans')
      .insert({
        ...parsed.data,
        provider:             parsed.data.provider ?? null,
        description:          parsed.data.description ?? null,
        enrollment_opens_at:  parsed.data.enrollment_opens_at ?? null,
        enrollment_closes_at: parsed.data.enrollment_closes_at ?? null,
        tenant_id:            req.tenantId,
        created_by:           req.userId,
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create benefit plan')

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'benefit_plans',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { name: parsed.data.name, plan_type: parsed.data.plan_type },
    })

    return reply.code(201).send({ data })
  })

  // PUT /benefits/admin/plans/:id — update a plan
  fastify.put('/admin/plans/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = planSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('benefit_plans')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update benefit plan')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'benefit_plans',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data,
    })

    return reply.send({ data })
  })

  // DELETE /benefits/admin/plans/:id — soft-delete (is_active=false)
  fastify.delete('/admin/plans/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('benefit_plans')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to deactivate benefit plan')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'benefit_plans',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { is_active: false },
    })

    return reply.send({ data: { id, is_active: false } })
  })

  // GET /benefits/admin/enrollments?plan_id= — enrolments with employee + plan
  fastify.get('/admin/enrollments', hrAdminAuth, async (req: any, reply) => {
    const qs = z.object({ plan_id: z.string().uuid().optional() }).safeParse(req.query)

    let data: any[]
    try {
      data = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('benefit_enrollments')
          .select('id, plan_id, status, dependent_ids, enrolled_at, updated_at, employees(first_name, last_name, employee_code), benefit_plans(name, plan_type)')
          .eq('tenant_id', req.tenantId)
          .order('updated_at', { ascending: false })
          .range(from, to)
        if (qs.data?.plan_id) q = q.eq('plan_id', qs.data.plan_id)
        return q
      }) as any[]
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch benefit enrollments')
    }
    return reply.send({ data })
  })
}
