/**
 * Compensation Revision Workflow
 *
 * Governed, approval-safe compensation revision requests.
 * Supports full lifecycle: submit → approve/reject → auto-create compensation record.
 *
 * GET    /compensation/revisions                    — list all (admin) or own (employee)
 * GET    /compensation/revisions/:id                — revision detail + before/after diff
 * POST   /compensation/revisions                    — submit new revision request
 * POST   /compensation/revisions/:id/approve        — approve + create compensation
 * POST   /compensation/revisions/:id/reject         — reject with reason
 * POST   /compensation/revisions/:id/withdraw       — employee withdraws pending request
 * GET    /compensation/revisions/employee/:empId    — all revisions for one employee
 * POST   /compensation/revisions/:id/preview        — compute payroll impact preview
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { eventBus }             from '../../lib/event-bus.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const submitSchema = z.object({
  employee_id:             z.string().uuid(),
  revision_type:           z.enum(['increment', 'promotion', 'revision', 'correction', 'restructure', 'retro']),
  effective_date:          z.string().regex(dateRe),
  reason:                  z.string().min(5).max(1000),
  notes:                   z.string().max(2000).optional(),
  new_salary_structure_id: z.string().uuid().optional(),
  new_ctc_annual:          z.number().positive().optional(),
  component_overrides:     z.array(z.object({
    salary_component_id: z.string().uuid(),
    calculation_type:    z.enum(['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross']),
    value:               z.number().min(0),
  })).optional(),
  retro_months:            z.number().int().min(0).max(12).optional(),
})

const rejectSchema = z.object({
  rejection_reason: z.string().min(5).max(500),
})

export default async function compensationRevisionsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function isAdmin(role: string) {
    return ['super_admin', 'hr_admin'].includes(role)
  }

  // ── GET /compensation/revisions ──────────────────────────────────────────────
  fastify.get('/compensation/revisions', auth, async (req: any, reply) => {
    const { status, employee_id, revision_type, limit = 50, offset = 0 } = req.query as {
      status?: string; employee_id?: string; revision_type?: string
      limit?: number; offset?: number
    }

    let q = fastify.supabase
      .from('compensation_revisions')
      .select(`
        id, revision_type, effective_date, status, reason, submitted_at, decided_at,
        before_ctc_annual, new_ctc_annual, delta_amount, delta_pct, retro_months,
        employees!inner(id, first_name, last_name, employee_code),
        requested_by_profile:profiles!requested_by(id, full_name),
        approved_by_profile:profiles!approved_by(id, full_name)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('submitted_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    // Employees see only their own
    if (!isAdmin(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .maybeSingle()
      if (!profile?.employee_id) {
        return reply.send({ data: [], total: 0 })
      }
      q = q.eq('employee_id', profile.employee_id)
    } else if (employee_id) {
      q = q.eq('employee_id', employee_id)
    }

    if (status)        q = q.eq('status', status)
    if (revision_type) q = q.eq('revision_type', revision_type)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch revisions' })

    const rows = (data ?? []).map((r: any) => ({
      id:             r.id,
      revision_type:  r.revision_type,
      effective_date: r.effective_date,
      status:         r.status,
      reason:         r.reason,
      submitted_at:   r.submitted_at,
      decided_at:     r.decided_at,
      before_ctc_annual: r.before_ctc_annual,
      new_ctc_annual: r.new_ctc_annual,
      delta_amount:   r.delta_amount,
      delta_pct:      r.delta_pct,
      retro_months:   r.retro_months,
      employee: r.employees ? {
        id:   r.employees.id,
        name: `${r.employees.first_name} ${r.employees.last_name}`,
        code: r.employees.employee_code,
      } : null,
      requested_by_name: r.requested_by_profile?.full_name ?? null,
      approved_by_name:  r.approved_by_profile?.full_name ?? null,
    }))

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── GET /compensation/revisions/:id ─────────────────────────────────────────
  fastify.get('/compensation/revisions/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select(`
        *,
        employees!inner(id, first_name, last_name, employee_code),
        requested_by_profile:profiles!requested_by(id, full_name),
        approved_by_profile:profiles!approved_by(id, full_name),
        salary_structures(id, name, code)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch revision' })
    if (!data)  return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })

    return reply.send({ data })
  })

  // ── POST /compensation/revisions ─────────────────────────────────────────────
  fastify.post('/compensation/revisions', auth, async (req: any, reply) => {
    const parsed = submitSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const d = parsed.data

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id, status')
      .eq('id', d.employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Fetch current active compensation for before snapshot
    const { data: currentComp } = await fastify.supabase
      .from('employee_compensations')
      .select('id, ctc_annual, ctc_monthly, salary_structures(name)')
      .eq('employee_id', d.employee_id)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .maybeSingle()

    const beforeCtc   = currentComp ? Number(currentComp.ctc_annual)   : null
    const beforeMonthly = currentComp ? Number(currentComp.ctc_monthly) : null
    const beforeStructureName = (currentComp as any)?.salary_structures?.name ?? null

    // Compute delta
    const newCtc      = d.new_ctc_annual ?? null
    const deltaAmount = beforeCtc && newCtc ? newCtc - beforeCtc : null
    const deltaPct    = beforeCtc && deltaAmount ? Math.round((deltaAmount / beforeCtc) * 10000) / 100 : null

    const { data: revision, error: insertErr } = await fastify.supabase
      .from('compensation_revisions')
      .insert({
        tenant_id:               req.tenantId,
        employee_id:             d.employee_id,
        requested_by:            req.userId,
        revision_type:           d.revision_type,
        effective_date:          d.effective_date,
        reason:                  d.reason,
        notes:                   d.notes ?? null,
        before_compensation_id:  currentComp?.id ?? null,
        before_ctc_annual:       beforeCtc,
        before_ctc_monthly:      beforeMonthly,
        before_structure_name:   beforeStructureName,
        new_salary_structure_id: d.new_salary_structure_id ?? null,
        new_ctc_annual:          newCtc,
        component_overrides:     d.component_overrides ?? null,
        delta_amount:            deltaAmount,
        delta_pct:               deltaPct,
        retro_months:            d.retro_months ?? 0,
        status:                  'pending',
      })
      .select('id, status, submitted_at, delta_pct')
      .single()

    if (insertErr) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create revision request' })
    }

    return reply.code(201).send({ data: revision })
  })

  // ── POST /compensation/revisions/:id/approve ─────────────────────────────────
  fastify.post('/compensation/revisions/:id/approve', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    // Fetch revision
    const { data: rev, error: fetchErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch revision' })
    if (!rev)      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    if (rev.status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Revision is already ${rev.status}` })
    }
    if (!rev.new_ctc_annual || !rev.new_salary_structure_id) {
      return reply.code(422).send({ error: 'INCOMPLETE', message: 'new_ctc_annual and new_salary_structure_id are required to approve' })
    }

    // Create the actual compensation record using existing compensation creation pattern
    const { data: newComp, error: compErr } = await fastify.supabase
      .from('employee_compensations')
      .insert({
        tenant_id:           req.tenantId,
        employee_id:         rev.employee_id,
        salary_structure_id: rev.new_salary_structure_id,
        ctc_annual:          rev.new_ctc_annual,
        effective_from:      rev.effective_date,
        is_active:           true,
        notes:               `Approved revision: ${rev.reason}`,
        created_by:          req.userId,
        approved_by:         req.userId,
      })
      .select('id')
      .single()

    if (compErr) {
      return reply.code(500).send({ error: 'COMP_CREATE_FAILED', message: 'Failed to create compensation record' })
    }

    // Create compensation components from overrides if provided
    if (rev.component_overrides?.length) {
      const compComponents = (rev.component_overrides as any[]).map((ov: any, i: number) => ({
        tenant_id:           req.tenantId,
        compensation_id:     newComp.id,
        salary_component_id: ov.salary_component_id,
        calculation_type:    ov.calculation_type,
        value:               ov.value,
        computed_monthly:    0,
        computed_annual:     0,
        sequence:            i + 1,
      }))
      await fastify.supabase.from('employee_compensation_components').insert(compComponents)
    }

    // Update revision status
    await fastify.supabase
      .from('compensation_revisions')
      .update({
        status:                   'approved',
        approved_by:              req.userId,
        decided_at:               new Date().toISOString(),
        resulting_compensation_id: newComp.id,
      })
      .eq('id', id)

    // Emit compensation.revised event
    eventBus.emit({
      type:          'compensation.revised',
      correlationId: id,
      payload: {
        tenantId:        req.tenantId,
        employeeId:      rev.employee_id,
        revisionId:      id,
        revisionType:    rev.revision_type,
        effectiveDate:   rev.effective_date,
        beforeCtcAnnual: rev.before_ctc_annual ? Number(rev.before_ctc_annual) : null,
        afterCtcAnnual:  Number(rev.new_ctc_annual),
        deltaPct:        rev.delta_pct ? Number(rev.delta_pct) : null,
        approvedBy:      req.userId,
      },
      tenantId: req.tenantId,
    })

    return reply.send({
      message:             'Revision approved and compensation created',
      compensation_id:     newComp.id,
      revision_id:         id,
    })
  })

  // ── POST /compensation/revisions/:id/reject ──────────────────────────────────
  fastify.post('/compensation/revisions/:id/reject', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: rev } = await fastify.supabase
      .from('compensation_revisions')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!rev) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    if (rev.status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Revision is already ${rev.status}` })
    }

    await fastify.supabase
      .from('compensation_revisions')
      .update({
        status:           'rejected',
        approved_by:      req.userId,
        decided_at:       new Date().toISOString(),
        rejection_reason: parsed.data.rejection_reason,
      })
      .eq('id', id)

    return reply.send({ message: 'Revision rejected', revision_id: id })
  })

  // ── POST /compensation/revisions/:id/withdraw ────────────────────────────────
  fastify.post('/compensation/revisions/:id/withdraw', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: rev } = await fastify.supabase
      .from('compensation_revisions')
      .select('status, requested_by, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!rev) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    if (rev.status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: 'Only pending revisions can be withdrawn' })
    }
    // Only the requester or HR admin can withdraw
    if (rev.requested_by !== req.userId && !isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Cannot withdraw another user\'s revision' })
    }

    await fastify.supabase
      .from('compensation_revisions')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
      .eq('id', id)

    return reply.send({ message: 'Revision withdrawn', revision_id: id })
  })

  // ── GET /compensation/revisions/employee/:empId ──────────────────────────────
  fastify.get('/compensation/revisions/employee/:empId', auth, async (req: any, reply) => {
    const { empId } = req.params as { empId: string }

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', empId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select(`
        id, revision_type, effective_date, status, reason, notes, submitted_at, decided_at,
        before_ctc_annual, before_ctc_monthly, before_structure_name,
        new_ctc_annual, delta_amount, delta_pct, retro_months, rejection_reason,
        requested_by_profile:profiles!requested_by(full_name),
        approved_by_profile:profiles!approved_by(full_name)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', empId)
      .order('submitted_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch revisions' })

    return reply.send({ data: data ?? [], employee_id: empId })
  })

  // ── POST /compensation/revisions/:id/preview ─────────────────────────────────
  // Returns a payroll impact preview: what gross pay changes if this revision is approved.
  fastify.post('/compensation/revisions/:id/preview', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data: rev } = await fastify.supabase
      .from('compensation_revisions')
      .select('employee_id, before_ctc_annual, new_ctc_annual, effective_date, retro_months, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!rev) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })

    const beforeAnnual  = Number(rev.before_ctc_annual ?? 0)
    const afterAnnual   = Number(rev.new_ctc_annual ?? 0)
    const monthlyDelta  = Math.round((afterAnnual - beforeAnnual) / 12)
    const annualDelta   = afterAnnual - beforeAnnual
    const effectiveDate = rev.effective_date as string
    const retroMonths   = Number(rev.retro_months ?? 0)

    // Build affected months array
    const affected: Array<{ month: string; delta: number }> = []
    const effDate = new Date(`${effectiveDate}T00:00:00Z`)
    for (let i = 0; i < retroMonths; i++) {
      const d = new Date(effDate)
      d.setUTCMonth(d.getUTCMonth() - retroMonths + i)
      const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      affected.push({ month: m, delta: monthlyDelta })
    }
    // Add the effective month itself
    const effMonth = `${effDate.getUTCFullYear()}-${String(effDate.getUTCMonth() + 1).padStart(2, '0')}`
    affected.push({ month: effMonth, delta: monthlyDelta })

    const preview = {
      before_annual:  beforeAnnual,
      after_annual:   afterAnnual,
      annual_delta:   annualDelta,
      monthly_delta:  monthlyDelta,
      affected_months: affected,
      retro_total:    monthlyDelta * retroMonths,
    }

    // Persist preview to the revision record
    await fastify.supabase
      .from('compensation_revisions')
      .update({ payroll_impact_preview: preview })
      .eq('id', id)

    return reply.send({ data: preview })
  })
}
