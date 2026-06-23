/**
 * Compensation Revisions Routes
 * Salary revision lifecycle with approval and snapshots.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'
import { EventType, MODULE } from '../../platform/events/index.js'

export default async function compensationRevisionsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/revisions ────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { limit, offset } = parsed.data

    let q = fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('effective_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.from_date) q = q.gte('effective_date', parsed.data.from_date)
    if (parsed.data.to_date) q = q.lte('effective_date', parsed.data.to_date)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/revisions/:id ────────────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    return reply.send({ data })
  })

  // ── POST /payroll/revisions ───────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id:      z.string().uuid(),
      revision_type:    z.string(),
      reason:           z.string().min(1),
      effective_date:   z.string(),
      new_ctc_annual:   z.number().positive(),
      before_ctc_annual: z.number().optional(),
      notes:            z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .insert({
        ...parsed.data,
        tenant_id:    req.tenantId,
        status:       'pending',
        requested_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.COMPENSATION_REVISION_CREATED,
      module:      MODULE.COMPENSATION,
      entity_type: 'compensation_revision',
      entity_id:   (data as any).id,
      org_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { employee_id: parsed.data.employee_id, new_ctc_annual: parsed.data.new_ctc_annual, revision_type: parsed.data.revision_type },
      correlation_id: req.correlationId ?? undefined,
    })
    return reply.code(201).send({ data })
  })

  // ── POST /payroll/revisions/:id/approve ──────────────────────────────────────
  fastify.post('/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: revision, error: fetchErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !revision) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    }

    const rev = revision as any
    if (rev.status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Cannot approve revision with status '${rev.status}'` })
    }

    const now = new Date().toISOString()

    // Update status to approved
    const { error: updateErr } = await fastify.supabase
      .from('compensation_revisions')
      .update({
        status: 'approved',
        approved_by: req.userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })

    // ── Fetch current active compensation + components BEFORE creating snapshots ──
    // This allows accurate gross/net computation from real component breakdown
    // instead of applying a fabricated percentage multiplier.
    const { data: currentComp } = await fastify.supabase
      .from('employee_compensations')
      .select('id, ctc_annual, ctc_monthly, salary_structure_id')
      .eq('employee_id', rev.employee_id)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Fetch components with component_type so we can split earnings vs deductions
    const { data: prevComponents } = currentComp
      ? await fastify.supabase
          .from('employee_compensation_components')
          .select('salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence, salary_components(component_type)')
          .eq('compensation_id', (currentComp as any).id)
      : { data: null }

    // ── Compute accurate gross/net from component breakdown ───────────────────
    // Earnings = sum of earning components.  Net = gross − deductions.
    // Falls back to CTC/12 gross (null net) when no component data exists yet.
    const prevEarnings   = (prevComponents ?? []).filter((c: any) => c.salary_components?.component_type === 'earning')
    const prevDeductions = (prevComponents ?? []).filter((c: any) => c.salary_components?.component_type === 'deduction')
    const prevGrossMonthly  = prevEarnings.reduce((s: number, c: any) => s + (c.computed_monthly ?? 0), 0)
    const prevDeductMonthly = prevDeductions.reduce((s: number, c: any) => s + (c.computed_monthly ?? 0), 0)
    const prevNetMonthly    = Math.max(0, prevGrossMonthly - prevDeductMonthly)

    // Scale components proportionally for the after-snapshot
    const previousCtcAnnual = Number((currentComp as any)?.ctc_annual ?? rev.before_ctc_annual ?? 0)
    const scale = previousCtcAnnual > 0 ? Number(rev.new_ctc_annual) / previousCtcAnnual : 1
    const newGrossMonthly  = prevEarnings.reduce((s: number, c: any) => {
      const m = c.calculation_type === 'fixed' ? (c.computed_monthly ?? 0) : (c.computed_monthly ?? 0) * scale
      return s + m
    }, 0)
    const newDeductMonthly = prevDeductions.reduce((s: number, c: any) => {
      const m = c.calculation_type === 'fixed' ? (c.computed_monthly ?? 0) : (c.computed_monthly ?? 0) * scale
      return s + m
    }, 0)
    const newNetMonthly = Math.max(0, newGrossMonthly - newDeductMonthly)

    // Fallback gross when no component breakdown exists (newly onboarded employee)
    const hasComponents    = (prevComponents?.length ?? 0) > 0
    const fallbackNewGross = Number(rev.new_ctc_annual) / 12
    const fallbackPrevGross = previousCtcAnnual / 12

    // ── Create compensation snapshots with component-derived values ───────────
    const snapshots = [
      {
        tenant_id:     req.tenantId,
        employee_id:   rev.employee_id,
        revision_id:   id,
        snapshot_type: 'revision_before',
        snapshot_date: now,
        gross_salary:  Math.round((hasComponents ? prevGrossMonthly : fallbackPrevGross) * 100) / 100,
        net_salary:    hasComponents ? Math.round(prevNetMonthly * 100) / 100 : 0,
        ctc_annual:    previousCtcAnnual,
        created_by:    req.userId,
      },
      {
        tenant_id:     req.tenantId,
        employee_id:   rev.employee_id,
        revision_id:   id,
        snapshot_type: 'revision_after',
        snapshot_date: now,
        gross_salary:  Math.round((hasComponents ? newGrossMonthly : fallbackNewGross) * 100) / 100,
        net_salary:    hasComponents ? Math.round(newNetMonthly * 100) / 100 : 0,
        ctc_annual:    rev.new_ctc_annual,
        created_by:    req.userId,
      },
    ]

    const { error: snapErr } = await fastify.supabase
      .from('compensation_snapshots')
      .insert(snapshots)

    if (snapErr) {
      req.log.warn({ err: snapErr }, 'Failed to create compensation snapshots')
    }

    // ── Create the payroll-effective employee_compensations record ────────────
    const { data: newComp, error: compInsertErr } = await fastify.supabase
      .from('employee_compensations')
      .insert({
        employee_id:         rev.employee_id,
        tenant_id:           req.tenantId,
        salary_structure_id: (currentComp as any)?.salary_structure_id ?? null,
        ctc_annual:          rev.new_ctc_annual,
        effective_from:      rev.effective_date,
        is_active:           true,
        notes:               `${rev.revision_type} revision approved`,
        approved_by:         req.userId,
        created_by:          req.userId,
      })
      .select('id')
      .single()

    if (compInsertErr) {
      req.log.warn({ err: compInsertErr }, 'Failed to create employee_compensations on revision approval')
    } else if (newComp) {
      // Copy and proportionally scale components from the previous active compensation.
      // prevComponents already fetched above — reuse to avoid duplicate DB round-trip.
      if (prevComponents?.length) {
        const newCTCMonthly = Number(rev.new_ctc_annual) / 12

        const newComponentRows = (prevComponents as any[]).map((c: any) => {
          if (c.calculation_type === 'fixed') {
            return {
              compensation_id:     (newComp as any).id,
              salary_component_id: c.salary_component_id,
              calculation_type:    c.calculation_type,
              value:               c.value,
              sequence:            c.sequence,
              tenant_id:           req.tenantId,
              computed_monthly:    c.computed_monthly ?? 0,
              computed_annual:     c.computed_annual  ?? 0,
            }
          }

          // For percentage-type components, scale from previous computed amount.
          // If previous computed_monthly was 0 (e.g. newly created structure that
          // was never run through the engine), derive from value * new CTC directly.
          const prevMonthly = c.computed_monthly ?? 0
          const derivedMonthly = prevMonthly > 0
            ? Math.round(prevMonthly * scale * 100) / 100
            : Math.round((Number(c.value) / 100) * newCTCMonthly * 100) / 100

          return {
            compensation_id:     (newComp as any).id,
            salary_component_id: c.salary_component_id,
            calculation_type:    c.calculation_type,
            value:               c.value,
            sequence:            c.sequence,
            tenant_id:           req.tenantId,
            computed_monthly:    derivedMonthly,
            computed_annual:     Math.round(derivedMonthly * 12 * 100) / 100,
          }
        })
        const { error: compCompErr } = await fastify.supabase
          .from('employee_compensation_components')
          .insert(newComponentRows)
        if (compCompErr) req.log.warn({ err: compCompErr }, 'Failed to copy components on revision approval')
      }

      // Link revision to the resulting compensation record.
      await fastify.supabase
        .from('compensation_revisions')
        .update({ resulting_compensation_id: (newComp as any).id })
        .eq('id', id)
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'compensation_revisions',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  rev.employee_id ?? null,
      newData:     { status: 'approved', new_ctc_annual: rev.new_ctc_annual, effective_date: rev.effective_date },
    })

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.COMPENSATION_REVISION_APPROVED,
      module:      MODULE.COMPENSATION,
      entity_type: 'compensation_revision',
      entity_id:   id,
      org_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { employee_id: rev.employee_id, new_ctc_annual: rev.new_ctc_annual, effective_date: rev.effective_date },
      correlation_id: req.correlationId ?? undefined,
    })
    return reply.send({ message: 'Revision approved', revision_id: id })
  })

  // ── POST /payroll/revisions/:id/reject ───────────────────────────────────────
  fastify.post('/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Fetch revision to enforce status guard and get employee_id for audit
    const { data: revision, error: fetchErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !revision) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    }
    if ((revision as any).status !== 'pending') {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Cannot reject revision with status '${(revision as any).status}'`,
      })
    }

    const { error } = await fastify.supabase
      .from('compensation_revisions')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'compensation_revisions',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (revision as any).employee_id ?? null,
      newData:     { status: 'rejected', rejection_reason: parsed.data.rejection_reason },
    })

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.COMPENSATION_REVISION_REJECTED,
      module:      MODULE.COMPENSATION,
      entity_type: 'compensation_revision',
      entity_id:   id,
      org_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { employee_id: (revision as any).employee_id, rejection_reason: parsed.data.rejection_reason },
      correlation_id: req.correlationId ?? undefined,
    })
    return reply.send({ message: 'Revision rejected' })
  })

  // ── GET /payroll/revisions/employee/:employeeId ───────────────────────────────
  // HR admin can view any employee's revisions.
  // Employees (and managers) can only view their own revision history.
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    if (!isHrAdmin) {
      // Resolve the caller's employee_id and verify ownership
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (callerProfile?.employee_id !== employeeId) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'You can only view your own compensation revision history',
        })
      }
    }

    const paginationSchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const pg = paginationSchema.safeParse(req.query)
    if (!pg.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: pg.error.issues[0]?.message })
    }
    const { limit, offset } = pg.data

    const { data, error, count } = await fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)', { count: 'exact' })
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('effective_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/revisions/snapshots/:employeeId ──────────────────────────────
  fastify.get('/snapshots/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const paginationSchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const pg = paginationSchema.safeParse(req.query)
    if (!pg.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: pg.error.issues[0]?.message })
    }
    const { limit, offset } = pg.data

    // Narrow the select to only the columns consumers need — avoids pulling
    // any large JSONB payload columns that may exist in the snapshots table.
    const { data, error, count } = await fastify.supabase
      .from('compensation_snapshots')
      .select('id, snapshot_type, snapshot_date, gross_salary, net_salary, created_by', { count: 'exact' })
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('snapshot_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })
}
