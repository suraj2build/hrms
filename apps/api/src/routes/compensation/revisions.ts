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

  /** Resolve the caller's own employee_id from their profile (server-side, never trusted). */
  async function callerEmployeeId(req: any): Promise<string | null> {
    const { data } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    return (data as { employee_id: string | null } | null)?.employee_id ?? null
  }

  // ── GET /compensation/revisions ──────────────────────────────────────────────
  fastify.get('/compensation/revisions', auth, async (req: any, reply) => {
    const { status, employee_id, revision_type, limit = 50, offset = 0 } = req.query as {
      status?: string; employee_id?: string; revision_type?: string
      limit?: number; offset?: number
    }

    // Resolve the effective employee filter first (non-admins see only their own).
    let empFilter: string | undefined
    if (!isAdmin(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!profile?.employee_id) return reply.send({ data: [], total: 0 })
      empFilter = profile.employee_id
    } else if (employee_id) {
      empFilter = employee_id
    }

    const build = (sel: string) => {
      let q = fastify.supabase
        .from('compensation_revisions')
        .select(sel, { count: 'exact' })
        .eq('tenant_id', req.tenantId)
        .order('submitted_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1)
      if (empFilter)     q = q.eq('employee_id', empFilter)
      if (status)        q = q.eq('status', status)
      if (revision_type) q = q.eq('revision_type', revision_type)
      return q
    }

    const FULL = `
        id, revision_type, effective_date, status, reason, submitted_at, decided_at,
        before_ctc_annual, new_ctc_annual, delta_amount, delta_pct, retro_months,
        employees!inner(id, first_name, last_name, employee_code),
        requested_by_profile:profiles!requested_by(id, full_name),
        approved_by_profile:profiles!approved_by(id, full_name)
      `
    // Drop the profiles!requested_by/approved_by embeds (FKs may be missing on a
    // drifted DB → 500) but keep the employee join, which is needed for names.
    const SAFE = `
        id, revision_type, effective_date, status, reason, submitted_at, decided_at,
        before_ctc_annual, new_ctc_annual, delta_amount, delta_pct, retro_months, employee_id,
        employees!inner(id, first_name, last_name, employee_code)
      `

    let { data, error, count } = await build(FULL)
    if (error) {
      req.log.warn({ err: error }, 'compensation/revisions full embed failed — retrying without profile joins')
      ;({ data, error, count } = await build(SAFE))
      if (error) {
        req.log.warn({ err: error }, 'compensation/revisions employee embed failed — serving raw rows')
        ;({ data, error, count } = await build(`
          id, revision_type, effective_date, status, reason, submitted_at, decided_at,
          before_ctc_annual, new_ctc_annual, delta_amount, delta_pct, retro_months, employee_id
        `))
        if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch revisions' })
      }
    }

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
      .select('id, status, manager_id')
      .eq('id', d.employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Non-admin callers (managers / employees) may only raise a revision for
    // THEMSELVES or for one of their OWN direct reports. HR retains approval
    // authority — a manager-submitted revision lands as pending, exactly like any
    // other (Program 5 · P5.3). This also closes the IDOR hole where any
    // authenticated user could previously submit a revision for an arbitrary id.
    if (!isAdmin(req.userRole)) {
      const myEmpId = await callerEmployeeId(req)
      const isSelf          = myEmpId && myEmpId === d.employee_id
      const isMyDirectReport = myEmpId && (emp as any).manager_id === myEmpId
      if (!isSelf && !isMyDirectReport) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'You can only raise a compensation revision for yourself or your direct reports',
        })
      }
    }

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
    if (rev.requested_by === req.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You cannot approve a revision you raised.' })
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

    const newCTCMonthly = Number(rev.new_ctc_annual) / 12

    if (rev.component_overrides?.length) {
      // Explicit overrides provided — use them directly.
      const compComponents = (rev.component_overrides as any[]).map((ov: any, i: number) => {
        let computed_monthly: number
        let computed_annual:  number
        if (ov.calculation_type === 'fixed') {
          // ov.value IS the fixed monthly amount for fixed-type components.
          computed_monthly = Math.round(Number(ov.value ?? 0) * 100) / 100
          computed_annual  = Math.round(computed_monthly * 12 * 100) / 100
        } else {
          // percentage-based: ov.value is the percentage (e.g. 40 = 40 % of CTC)
          computed_monthly = Math.round((Number(ov.value) / 100) * newCTCMonthly * 100) / 100
          computed_annual  = Math.round(computed_monthly * 12 * 100) / 100
        }
        return {
          tenant_id:           req.tenantId,
          compensation_id:     newComp.id,
          salary_component_id: ov.salary_component_id,
          calculation_type:    ov.calculation_type,
          value:               ov.value,
          computed_monthly,
          computed_annual,
          sequence:            i + 1,
        }
      })
      await fastify.supabase.from('employee_compensation_components').insert(compComponents)
    } else {
      // No overrides — copy and proportionally scale components from the previous
      // active compensation.  This prevents the new record from having zero components
      // which would cause payroll to compute ₹0 gross for the employee.
      const previousCtcAnnual = Number(rev.before_ctc_annual ?? 0)
      const scale = previousCtcAnnual > 0 ? Number(rev.new_ctc_annual) / previousCtcAnnual : 1

      // Resolve the previous compensation ID.
      // Prefer rev.before_compensation_id (set at revision submission time) because
      // by this point the DB trigger has already closed the old record (is_active → false),
      // so querying is_active=true would return the new empty record.
      // Fallback: most recent closed record with effective_from < rev.effective_date.
      let prevCompId: string | null = rev.before_compensation_id ?? null

      if (!prevCompId) {
        const { data: closedComp } = await fastify.supabase
          .from('employee_compensations')
          .select('id')
          .eq('employee_id',  rev.employee_id)
          .eq('tenant_id',    req.tenantId)
          .eq('is_active',    false)
          .lt('effective_from', rev.effective_date)
          .order('effective_from', { ascending: false })
          .limit(1)
          .maybeSingle()
        prevCompId = (closedComp as any)?.id ?? null
      }

      if (prevCompId) {
        const { data: prevComponents } = await fastify.supabase
          .from('employee_compensation_components')
          .select('salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence')
          .eq('compensation_id', prevCompId)
          .eq('tenant_id',       req.tenantId)

        if (prevComponents?.length) {
          const scaledRows = (prevComponents as any[]).map((c: any) => {
            if (c.calculation_type === 'fixed') {
              // Fixed amounts stay the same — not scaled with CTC.
              return {
                tenant_id:           req.tenantId,
                compensation_id:     newComp.id,
                salary_component_id: c.salary_component_id,
                calculation_type:    c.calculation_type,
                value:               c.value,
                sequence:            c.sequence,
                computed_monthly:    c.computed_monthly ?? 0,
                computed_annual:     c.computed_annual  ?? 0,
              }
            }
            // Percentage-based: scale proportionally to new CTC.
            // If previous computed_monthly was 0 (structure never run through engine),
            // derive directly from value × new CTC.
            const prevMonthly   = c.computed_monthly ?? 0
            const derivedMonthly = prevMonthly > 0
              ? Math.round(prevMonthly * scale * 100) / 100
              : Math.round((Number(c.value) / 100) * newCTCMonthly * 100) / 100
            return {
              tenant_id:           req.tenantId,
              compensation_id:     newComp.id,
              salary_component_id: c.salary_component_id,
              calculation_type:    c.calculation_type,
              value:               c.value,
              sequence:            c.sequence,
              computed_monthly:    derivedMonthly,
              computed_annual:     Math.round(derivedMonthly * 12 * 100) / 100,
            }
          })
          const { error: copyErr } = await fastify.supabase
            .from('employee_compensation_components')
            .insert(scaledRows)
          if (copyErr) {
            req.log.warn({ err: copyErr }, 'Failed to copy compensation components on revision approval')
          }
        }
      }
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
  // HR admins can view any employee's revisions. Non-admins can only view their own.
  fastify.get('/compensation/revisions/employee/:empId', auth, async (req: any, reply) => {
    const { empId } = req.params as { empId: string }

    if (!isAdmin(req.userRole)) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (callerProfile?.employee_id !== empId) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'You can only view your own compensation revision history',
        })
      }
    }

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

  // ── POST /compensation/revisions/bulk ────────────────────────────────────────
  // Increment cycle (Program 5 · P5.5). Creates ONE NORMAL compensation revision
  // per selected employee — it does NOT bypass the existing workflow. Each row
  // lands as `pending` and is approved through the existing per-row approve
  // endpoint by HR. No parallel approval engine, no new table.
  //
  // The cohort is resolved server-side from filters (department / grade) and/or an
  // explicit employee_ids list. Each employee's new CTC is derived from their own
  // CURRENT active compensation (flat amount or percentage). Employees with no
  // active compensation, or who already have a pending revision, are skipped and
  // reported back — never silently dropped.
  const bulkSchema = z.object({
    employee_ids:   z.array(z.string().uuid()).optional(),
    department_id:  z.string().uuid().optional(),
    grade:          z.string().optional(),
    mode:           z.enum(['percentage', 'flat_amount']),
    value:          z.number().positive(),
    effective_date: z.string().regex(dateRe),
    revision_type:  z.enum(['increment', 'promotion', 'revision', 'correction', 'restructure', 'retro']).default('increment'),
    reason:         z.string().min(5).max(1000),
    notes:          z.string().max(2000).optional(),
    /** When true, compute the impact and return it WITHOUT inserting any rows. */
    dry_run:        z.boolean().optional().default(false),
  })

  fastify.post('/compensation/revisions/bulk', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = bulkSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const d = parsed.data
    if (!d.employee_ids?.length && !d.department_id && !d.grade) {
      return reply.code(400).send({ error: 'NO_COHORT', message: 'Provide employee_ids, department_id or grade to select a cohort' })
    }

    // ── Resolve the cohort (active employees only) ────────────────────────────
    let empQ = fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
    if (d.employee_ids?.length) empQ = empQ.in('id', d.employee_ids)
    if (d.department_id)        empQ = empQ.eq('department_id', d.department_id)
    if (d.grade)                empQ = empQ.eq('grade', d.grade)

    const { data: cohort, error: cohortErr } = await empQ
    if (cohortErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to resolve cohort' })
    if (!cohort?.length) return reply.send({ created: [], skipped: [], cohort_size: 0 })

    const empIds = cohort.map((e: any) => e.id)

    // Current active compensation + existing pending revisions, in two batched reads.
    const [{ data: comps }, { data: pendings }] = await Promise.all([
      fastify.supabase
        .from('employee_compensations')
        .select('id, employee_id, ctc_annual, ctc_monthly, salary_structure_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .in('employee_id', empIds),
      fastify.supabase
        .from('compensation_revisions')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending')
        .in('employee_id', empIds),
    ])

    const compByEmp    = new Map((comps ?? []).map((c: any) => [c.employee_id, c]))
    const pendingByEmp = new Set((pendings ?? []).map((p: any) => p.employee_id))
    const empById      = new Map(cohort.map((e: any) => [e.id, e]))

    const rowsToInsert: any[] = []
    const skipped: Array<{ employee_id: string; name: string; reason: string }> = []

    for (const empId of empIds) {
      const emp = empById.get(empId)
      const name = emp ? `${emp.first_name} ${emp.last_name}` : empId
      const comp = compByEmp.get(empId)

      if (!comp) { skipped.push({ employee_id: empId, name, reason: 'No active compensation' }); continue }
      if (pendingByEmp.has(empId)) { skipped.push({ employee_id: empId, name, reason: 'Already has a pending revision' }); continue }

      const beforeCtc = Number(comp.ctc_annual ?? 0)
      if (beforeCtc <= 0) { skipped.push({ employee_id: empId, name, reason: 'Current CTC is zero' }); continue }

      const newCtc = d.mode === 'percentage'
        ? Math.round(beforeCtc * (1 + d.value / 100))
        : Math.round(beforeCtc + d.value)
      const deltaAmount = newCtc - beforeCtc
      const deltaPct    = Math.round((deltaAmount / beforeCtc) * 10000) / 100

      rowsToInsert.push({
        tenant_id:               req.tenantId,
        employee_id:             empId,
        requested_by:            req.userId,
        revision_type:           d.revision_type,
        effective_date:          d.effective_date,
        reason:                  d.reason,
        notes:                   d.notes ?? null,
        before_compensation_id:  comp.id,
        before_ctc_annual:       beforeCtc,
        before_ctc_monthly:      Number(comp.ctc_monthly ?? Math.round(beforeCtc / 12)),
        new_salary_structure_id: comp.salary_structure_id,  // keep current structure → approve scales components
        new_ctc_annual:          newCtc,
        delta_amount:            deltaAmount,
        delta_pct:               deltaPct,
        retro_months:            0,
        status:                  'pending',
      })
    }

    const nameFor = (empId: string) => {
      const e = empById.get(empId) as any
      return e ? `${e.first_name} ${e.last_name}` : null
    }

    // Preview only — return the would-be revisions without persisting anything.
    if (d.dry_run) {
      const preview = rowsToInsert.map(r => ({
        employee_id:       r.employee_id,
        name:              nameFor(r.employee_id),
        before_ctc_annual: r.before_ctc_annual,
        new_ctc_annual:    r.new_ctc_annual,
        delta_amount:      r.delta_amount,
        delta_pct:         r.delta_pct,
      }))
      return reply.send({
        dry_run:       true,
        created:       preview,
        skipped,
        cohort_size:   empIds.length,
        created_count: preview.length,
        skipped_count: skipped.length,
      })
    }

    let created: any[] = []
    if (rowsToInsert.length) {
      const { data: inserted, error: insErr } = await fastify.supabase
        .from('compensation_revisions')
        .insert(rowsToInsert)
        .select('id, employee_id, before_ctc_annual, new_ctc_annual, delta_pct')
      if (insErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create revision rows' })
      created = (inserted ?? []).map((r: any) => ({ ...r, name: nameFor(r.employee_id) }))
    }

    return reply.code(201).send({
      created,
      skipped,
      cohort_size:   empIds.length,
      created_count: created.length,
      skipped_count: skipped.length,
    })
  })
}
