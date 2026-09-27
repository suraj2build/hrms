/**
 * Compensation Revisions Routes
 * Salary revision lifecycle with approval and snapshots.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'
import { EventType, MODULE } from '../../platform/events/index.js'
import { eventBus } from '../../lib/event-bus.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'

// compensation_revisions.revision_type CHECK constraint (migration 078) — the
// ground truth for valid revision types. The frontend's REVISION_TYPES union
// (CompensationRevisions.tsx) already matches this exactly.
const REVISION_TYPES = ['increment', 'promotion', 'revision', 'correction', 'restructure', 'retro'] as const

export default async function compensationRevisionsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      forbidden(reply, 'FORBIDDEN', 'HR admin access required')
      return
    }
    done()
  }

  // ── GET /payroll/revisions ────────────────────────────────────────────────────
  fastify.get('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
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
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
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
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation revisions')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/revisions/:id ────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return notFound(reply, 'NOT_FOUND', 'Revision not found')
    return reply.send({ data })
  })

  // ── POST /payroll/revisions ───────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id:      z.string().uuid(),
      revision_type:    z.enum(REVISION_TYPES),
      reason:           z.string().min(1),
      effective_date:   z.string(),
      new_ctc_annual:   z.number().positive(),
      before_ctc_annual: z.number().optional(),
      notes:            z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }

    // employee_id is caller-supplied — fastify.supabase is a service-role
    // client that bypasses RLS, and employees(id) has no tenant-compound FK,
    // so without this check an HR admin could raise a revision (and, once
    // approved, a phantom active compensation row) against another tenant's
    // employee.
    const { data: empRow, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', parsed.data.employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to verify employee')
    if (!empRow) return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

    // Idempotency: prevents a double-submit (network retry, double-click) from
    // creating two pending revisions for the same employee.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'compensation-revision-create')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
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

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create compensation revision')

    // PEND-94: governance rule 'compensation.revision-frequency' needs this
    // count to fire — non-rejected revisions (including the one just
    // created) for this employee in the trailing 12 months. Fire-and-forget
    // like the publish below; a count-query failure must never block the
    // (already-committed) revision creation itself.
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const { count: revisionsIn12m } = await fastify.supabase
      .from('compensation_revisions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', parsed.data.employee_id)
      .neq('status', 'rejected')
      .gte('created_at', twelveMonthsAgo)
      .then(res => ({ count: res.error ? null : res.count }))

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.COMPENSATION_REVISION_CREATED,
      module:      MODULE.COMPENSATION,
      entity_type: 'compensation_revision',
      entity_id:   (data as any).id,
      tenant_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     {
        employee_id:     parsed.data.employee_id,
        new_ctc_annual:  parsed.data.new_ctc_annual,
        revision_type:   parsed.data.revision_type,
        revisions_in_12m: revisionsIn12m ?? undefined,
      },
      correlation_id: req.correlationId ?? undefined,
    })
    const responseBody = { data }
    if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'compensation-revision-create', 201, responseBody)
    return reply.code(201).send(responseBody)
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
      return notFound(reply, 'NOT_FOUND', 'Revision not found')
    }

    const rev = revision as any
    if (rev.status !== 'pending') {
      return conflictError(reply, 'INVALID_STATUS', `Cannot approve revision with status '${rev.status}'`)
    }

    const now = new Date().toISOString()

    // Update status to approved — re-assert the pending precondition in the
    // WHERE clause itself (not just the earlier SELECT check) so a second
    // concurrent approve/reject can't both pass the read and both proceed
    // into the downstream compensation-creation logic below.
    const { data: approvedRow, error: updateErr } = await fastify.supabase
      .from('compensation_revisions')
      .update({
        status: 'approved',
        approved_by: req.userId,
        decided_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (updateErr) return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to update revision status')
    if (!approvedRow) return conflictError(reply, 'INVALID_STATUS', 'Revision is no longer pending')

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
    // computed_monthly is NUMERIC — coerce or 2+ components corrupt these sums into
    // NaN, writing a broken compensation_snapshots row on approval (G13 sweep).
    const prevGrossMonthly  = prevEarnings.reduce((s: number, c: any) => s + Number(c.computed_monthly ?? 0), 0)
    const prevDeductMonthly = prevDeductions.reduce((s: number, c: any) => s + Number(c.computed_monthly ?? 0), 0)
    const prevNetMonthly    = Math.max(0, prevGrossMonthly - prevDeductMonthly)

    // Scale components proportionally for the after-snapshot
    const previousCtcAnnual = Number((currentComp as any)?.ctc_annual ?? rev.before_ctc_annual ?? 0)
    const scale = previousCtcAnnual > 0 ? Number(rev.new_ctc_annual) / previousCtcAnnual : 1
    const newGrossMonthly  = prevEarnings.reduce((s: number, c: any) => {
      const m = c.calculation_type === 'fixed' ? Number(c.computed_monthly ?? 0) : Number(c.computed_monthly ?? 0) * scale
      return s + m
    }, 0)
    const newDeductMonthly = prevDeductions.reduce((s: number, c: any) => {
      const m = c.calculation_type === 'fixed' ? Number(c.computed_monthly ?? 0) : Number(c.computed_monthly ?? 0) * scale
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

    // ── Supersede the prior active compensation ───────────────────────────────
    // Only one active compensation per employee is allowed (uidx_comp_one_active,
    // migration 014). Deactivate the current active record before inserting the
    // new one — mirrors the established pattern in employees/compensation.ts.
    // Without this, the insert below hits a 23505 unique-violation for any
    // employee who already has active compensation (i.e. virtually every real
    // revision), which was previously only req.log.warn'd and swallowed: HR saw
    // "Revision approved" while the employee's pay never actually changed.
    if (currentComp) {
      const { error: supersedeErr } = await fastify.supabase
        .from('employee_compensations')
        .update({ is_active: false })
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', rev.employee_id)
        .eq('is_active', true)
      if (supersedeErr) {
        return serverError(req, reply, supersedeErr, ErrorCode.UPDATE_FAILED, 'Revision status set to approved, but failed to supersede prior compensation. Compensation was NOT changed — contact support before retrying.')
      }
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
      // Previously silently warned + returned success — HR would see "Revision
      // approved" with the employee's compensation never actually updated.
      // Surface it: the revision row is already 'approved', but the underlying
      // compensation change did not happen and needs manual follow-up.
      return serverError(req, reply, compInsertErr, ErrorCode.INSERT_FAILED, 'Revision status set to approved, but failed to create the new compensation record. Compensation was NOT changed — contact support before retrying.')
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

    // PEND-94: derived here (not read from rev.delta_pct, which is typically
    // null for revisions created via this file's own POST / — see comment
    // below) so both the governance-rule payload and the eventBus payload
    // get a real value. Feeds 'payroll.pf-eligibility-mismatch' and
    // 'compensation.spike-detection' (both listen for delta_pct on
    // COMPENSATION_REVISION_APPROVED) plus drift-detection's
    // policy_inconsistency signal.
    const deltaPct = previousCtcAnnual > 0
      ? ((Number(rev.new_ctc_annual) - previousCtcAnnual) / previousCtcAnnual) * 100
      : null

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.COMPENSATION_REVISION_APPROVED,
      module:      MODULE.COMPENSATION,
      entity_type: 'compensation_revision',
      entity_id:   id,
      tenant_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { employee_id: rev.employee_id, new_ctc_annual: rev.new_ctc_annual, effective_date: rev.effective_date, delta_pct: deltaPct },
      correlation_id: req.correlationId ?? undefined,
    })

    // In-process event bus (PEND-75 follow-up) — this route and
    // compensation/revisions.ts both write compensation_revisions and are
    // both live (HR-admin/profile-page approvals here; the standalone
    // revisions admin page + manager submission flow there), but only the
    // latter emitted on eventBus — meaning approvals made through here never
    // reached event-bus-automation.ts's employee-notification handler or the
    // webhook allow-list.
    eventBus.emit({
      type:          'compensation.revised',
      tenantId:      req.tenantId,
      correlationId: req.correlationId,
      payload: {
        tenantId:        req.tenantId,
        employeeId:      rev.employee_id,
        revisionId:      id,
        revisionType:    rev.revision_type,
        effectiveDate:   rev.effective_date,
        beforeCtcAnnual: previousCtcAnnual > 0 ? previousCtcAnnual : null,
        afterCtcAnnual:  Number(rev.new_ctc_annual),
        deltaPct,
        approvedBy:      req.userId,
      },
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
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }

    // Fetch revision to enforce status guard and get employee_id for audit
    const { data: revision, error: fetchErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !revision) {
      return notFound(reply, 'NOT_FOUND', 'Revision not found')
    }
    if ((revision as any).status !== 'pending') {
      return conflictError(reply, 'INVALID_STATUS', `Cannot reject revision with status '${(revision as any).status}'`)
    }

    const { data: rejectedRow, error } = await fastify.supabase
      .from('compensation_revisions')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject revision')
    if (!rejectedRow) return conflictError(reply, 'INVALID_STATUS', 'Revision is no longer pending')

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
      tenant_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { employee_id: (revision as any).employee_id, rejection_reason: parsed.data.rejection_reason },
      correlation_id: req.correlationId ?? undefined,
    })

    // In-process event bus (PEND-75 follow-up) — mirrors this route's own
    // approve handler emitting 'compensation.revised'; drives the employee
    // notification + webhook fan-out that only fired on approve until now.
    eventBus.emit({
      type:          'compensation.rejected',
      tenantId:      req.tenantId,
      correlationId: req.correlationId,
      payload: {
        tenantId:   req.tenantId,
        employeeId: (revision as any).employee_id,
        revisionId: id,
        rejectedBy: req.userId,
        reason:     parsed.data.rejection_reason,
      },
    })
    return reply.send({ message: 'Revision rejected' })
  })

  // ── GET /payroll/revisions/employee/:employeeId ───────────────────────────────
  // HR admin can view any employee's revisions.
  // Employees (and managers) can only view their own revision history.
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)

    if (!isHrAdmin) {
      // Resolve the caller's employee_id and verify ownership
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (callerProfile?.employee_id !== employeeId) {
        return forbidden(reply, 'FORBIDDEN', 'You can only view your own compensation revision history')
      }
    }

    const paginationSchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const pg = paginationSchema.safeParse(req.query)
    if (!pg.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, pg.error.issues[0]?.message)
    }
    const { limit, offset } = pg.data

    const { data, error, count } = await fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)', { count: 'exact' })
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('effective_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation revision history')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/revisions/snapshots/:employeeId ──────────────────────────────
  fastify.get('/snapshots/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    // Unlike the sibling /employee/:employeeId route above, this had no
    // ownership check — any employee could read another employee's
    // gross/net salary snapshot history.
    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
    if (!isHrAdmin) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (callerProfile?.employee_id !== employeeId) {
        return forbidden(reply, 'FORBIDDEN', 'You can only view your own compensation snapshots')
      }
    }

    const paginationSchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const pg = paginationSchema.safeParse(req.query)
    if (!pg.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, pg.error.issues[0]?.message)
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

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation snapshots')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })
}
