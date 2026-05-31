/**
 * Leave Management Routes
 *
 * GET    /attendance/leave/types           — list active leave types
 * POST   /attendance/leave/apply           — employee submits application
 * GET    /attendance/leave/my             — employee views own applications
 * GET    /attendance/leave/pending        — HR views pending approvals
 * POST   /attendance/leave/:id/approve   — HR approves + applies to attendance_daily
 * POST   /attendance/leave/:id/reject    — HR rejects
 *
 * On approval: each calendar day in [from_date, to_date] is upserted to
 * attendance_daily with status='leave'.  If allow_sandwich=true on the
 * leave type, adjacent weekend/holiday gaps are also marked 'leave'.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAuditLogs } from '../../lib/attendance-processor.js'
import { expandDateRange, shiftDate, validateBalance, computeWorkingLeaveDays } from '../../lib/leave-engine.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction, logBulkAction } from '../../lib/audit-service.js'
import { emitEvent } from '../../lib/event-emitter.js'
import { eventBus }  from '../../lib/event-bus.js'
import { writeLedgerEntry, dateToMonth } from '../../lib/ledger-writer.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const applySchema = z.object({
  leave_type_id: z.string().uuid('leave_type_id must be a UUID'),
  from_date:     z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
  to_date:       z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
  reason:        z.string().max(500).optional(),
})

/**
 * Sandwich leave: if a weekend/holiday falls between two approved leave periods,
 * convert those bridging days to 'leave' status as well.
 *
 * Scans up to 7 days before from_date and 7 days after to_date for bridging gaps.
 */
async function applySandwichLeave(
  fastify: FastifyInstance,
  tenantId: string,
  employeeId: string,
  fromDate: string,
  toDate:   string,
): Promise<void> {
  // Fetch approved leave days for this employee in a wide window (±30 days)
  const windowFrom = shiftDate(fromDate, -30)
  const windowTo   = shiftDate(toDate,   +30)

  const [{ data: leaveDays }, { data: holidays }] = await Promise.all([
    fastify.supabase
      .from('leave_applications')
      .select('from_date, to_date')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .gte('to_date',   windowFrom)
      .lte('from_date', windowTo),
    fastify.supabase
      .from('holiday_calendar')
      .select('date')
      .eq('tenant_id', tenantId)
      .gte('date', windowFrom)
      .lte('date', windowTo),
  ])

  // Build sets for fast O(1) lookups
  const leaveSet = new Set<string>()
  for (const app of leaveDays ?? []) {
    for (const d of expandDateRange(app.from_date as string, app.to_date as string)) {
      leaveSet.add(d)
    }
  }
  const holidaySet = new Set<string>(
    (holidays ?? []).map((h: { date: string }) => h.date)
  )

  /** Returns true when a given day is a weekend or holiday (should be bridged). */
  function isBridgeable(d: string): boolean {
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
    return dow === 0 || dow === 6 || holidaySet.has(d)
  }

  const sandwichDates: string[] = []

  // Scan backward from fromDate - 1
  let cursor = shiftDate(fromDate, -1)
  const backward: string[] = []
  for (let i = 0; i < 7; i++) {
    if (!isBridgeable(cursor)) {
      // The first non-bridgeable day before the leave — if it's also a leave day, sandwich applies
      if (leaveSet.has(cursor)) sandwichDates.push(...backward)
      break
    }
    backward.push(cursor)
    cursor = shiftDate(cursor, -1)
  }

  // Scan forward from toDate + 1
  cursor = shiftDate(toDate, +1)
  const forward: string[] = []
  for (let i = 0; i < 7; i++) {
    if (!isBridgeable(cursor)) {
      if (leaveSet.has(cursor)) sandwichDates.push(...forward)
      break
    }
    forward.push(cursor)
    cursor = shiftDate(cursor, +1)
  }

  if (sandwichDates.length === 0) return

  // Upsert sandwich days as 'leave'
  const rows = sandwichDates.map((d) => ({
    tenant_id:        tenantId,
    employee_id:      employeeId,
    date:             d,
    status:           'leave',
    work_hours:       0,
    late_minutes:     0,
    overtime_minutes: 0,
    worked_on_weekly_off: false,
    worked_on_holiday:    false,
  }))

  await fastify.supabase
    .from('attendance_daily')
    .upsert(rows, { onConflict: 'tenant_id,employee_id,date' })
}

export default async function leaveRoute(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /attendance/leave/types ───────────────────────────────────────────────
  fastify.get('/attendance/leave/types', auth, async (req, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid, allow_sandwich')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .order('name')

    if (error) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch leave types' })
    }
    return reply.send(data ?? [])
  })

  // ── POST /attendance/leave/apply ──────────────────────────────────────────────
  fastify.post('/attendance/leave/apply', auth, async (req, reply) => {
    const parsed = applySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { from_date, to_date } = parsed.data
    if (from_date > to_date) {
      return reply.code(400).send({ error: 'INVALID_DATES', message: 'from_date must be ≤ to_date' })
    }

    // Resolve employee_id
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({
        error:   'NO_EMPLOYEE_LINK',
        message: 'Your profile is not linked to an employee record',
      })
    }

    const { data, error } = await fastify.supabase
      .from('leave_applications')
      .insert({
        tenant_id:     req.tenantId,
        employee_id:   profile.employee_id,
        leave_type_id: parsed.data.leave_type_id,
        from_date,
        to_date,
        reason:        parsed.data.reason ?? null,
      })
      .select('id, from_date, to_date, status, created_at')
      .single()

    if (error) {
      req.log.error({ err: error }, 'leave apply insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to submit leave application' })
    }

    return reply.code(201).send({ data })
  })

  // ── GET /attendance/leave/my ──────────────────────────────────────────────────
  fastify.get('/attendance/leave/my', auth, async (req, reply) => {
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) return reply.send([])

    const { data, error } = await fastify.supabase
      .from('leave_applications')
      .select('id, from_date, to_date, reason, status, approved_at, created_at, leave_types(name, is_paid)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .order('from_date', { ascending: false })

    if (error) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch applications' })
    }
    return reply.send(data ?? [])
  })

  // ── GET /attendance/leave/pending ─────────────────────────────────────────────
  fastify.get('/attendance/leave/pending', hrAdminAuth, async (req, reply) => {

    const { data, error } = await fastify.supabase
      .from('leave_applications')
      .select(`
        id, from_date, to_date, reason, status, created_at,
        leave_types(name, is_paid, allow_sandwich),
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch pending leaves' })
    }

    const rows = (data ?? []).map((r: Record<string, unknown>) => {
      const emp  = r.employees as { id: string; first_name: string; last_name: string; employee_code: string } | null
      const lt   = r.leave_types as { name: string; is_paid: boolean; allow_sandwich: boolean } | null
      return {
        id:              r.id,
        from_date:       r.from_date,
        to_date:         r.to_date,
        reason:          r.reason,
        status:          r.status,
        created_at:      r.created_at,
        leave_type:      lt?.name   ?? null,
        is_paid:         lt?.is_paid ?? null,
        allow_sandwich:  lt?.allow_sandwich ?? false,
        employee_id:     emp?.id ?? null,
        employee_name:   emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:   emp?.employee_code ?? null,
      }
    })

    return reply.send(rows)
  })

  // ── POST /attendance/leave/:id/approve ───────────────────────────────────────
  fastify.post('/attendance/leave/:id/approve', hrAdminAuth, async (req, reply) => {

    const { id } = req.params as { id: string }

    const { data: app, error: fetchError } = await fastify.supabase
      .from('leave_applications')
      .select('id, tenant_id, employee_id, leave_type_id, from_date, to_date, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !app) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Application not found' })
    }
    if (app.status !== 'pending') {
      return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: `Application is already ${app.status}` })
    }

    // Fetch leave type for paid flag + sandwich flag
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid, allow_sandwich')
      .eq('id', app.leave_type_id)
      .single()

    // Pre-approve balance check (paid leave only)
    // Use working days (excluding holidays + weekly-offs) for balance check & deduction
    let workingDays = { computed_days: 0, payable_days: 0 }
    if (lt?.is_paid) {
      workingDays = await computeWorkingLeaveDays(
        fastify.supabase,
        app.tenant_id   as string,
        app.employee_id as string,
        app.from_date   as string,
        app.to_date     as string,
      )
      const year  = new Date(app.from_date as string).getFullYear()
      const check = await validateBalance(
        fastify.supabase,
        app.tenant_id    as string,
        app.employee_id  as string,
        app.leave_type_id as string,
        workingDays.computed_days,
        year,
      )
      if (!check.valid) {
        return reply.code(422).send({
          error:   'INSUFFICIENT_BALANCE',
          message: check.message ?? 'Insufficient leave balance',
        })
      }
    }

    // Approve
    const { error: updateError } = await fastify.supabase
      .from('leave_applications')
      .update({
        status:      'approved',
        approved_by: req.userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      req.log.error({ err: updateError }, 'leave approve update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to approve application' })
    }

    // Apply leave days to attendance_daily
    const leaveDates = expandDateRange(app.from_date as string, app.to_date as string)
    const isPaid        = lt?.is_paid ?? false
    const dayFractionV  = isPaid ? 1.0 : 0.0

    // Fetch pre-existing statuses for audit comparison (one query for all dates)
    const { data: existingRows } = await fastify.supabase
      .from('attendance_daily')
      .select('date, status')
      .eq('tenant_id', app.tenant_id)
      .eq('employee_id', app.employee_id)
      .in('date', leaveDates)

    const existingStatusMap = new Map<string, string>(
      (existingRows ?? []).map((r: { date: string; status: string }) => [r.date, r.status])
    )

    const dailyRows = leaveDates.map((d) => ({
      tenant_id:            app.tenant_id,
      employee_id:          app.employee_id,
      date:                 d,
      status:               'leave',
      work_hours:           0,
      late_minutes:         0,
      overtime_minutes:     0,
      worked_on_weekly_off: false,
      worked_on_holiday:    false,
      is_payable:           isPaid,
      day_fraction:         dayFractionV,
    }))

    const { error: dailyError } = await fastify.supabase
      .from('attendance_daily')
      .upsert(dailyRows, { onConflict: 'tenant_id,employee_id,date' })

    if (dailyError) {
      req.log.warn({ err: dailyError }, 'leave daily upsert failed — approval committed')
    }

    // Write audit log for each leave day
    const auditChanges = leaveDates
      .filter((d) => existingStatusMap.get(d) !== 'leave')
      .map((d) => ({
        employee_id:   app.employee_id as string,
        date:          d,
        before_status: existingStatusMap.get(d) ?? null,
        after_status:  'leave',
      }))
    await writeAuditLogs(
      fastify.supabase,
      app.tenant_id as string,
      'leave',
      auditChanges,
      req.userId,
      { application_id: id },
      req.log,
    )

    // Deduct leave balance for paid leave types (use working_days, not calendar days)
    if (lt?.is_paid) {
      const year = new Date(app.from_date as string).getFullYear()
      try {
        await fastify.supabase.rpc('deduct_leave_balance', {
          p_tenant_id:     app.tenant_id,
          p_employee_id:   app.employee_id,
          p_leave_type_id: app.leave_type_id,
          p_days:          workingDays.computed_days,
          p_year:          year,
        })
      } catch (err) {
        req.log.warn({ err }, 'leave balance deduction failed — approval committed')
      }
    }

    // Sandwich leave: apply bridging if allowed
    if (lt?.allow_sandwich) {
      try {
        await applySandwichLeave(
          fastify,
          app.tenant_id as string,
          app.employee_id as string,
          app.from_date  as string,
          app.to_date    as string,
        )
      } catch (err) {
        req.log.warn({ err }, 'sandwich leave calculation failed')
      }
    }

    // DB-level event + notification fan-out (non-blocking)
    emitEvent({
      supabase:   fastify.supabase,
      tenantId:   app.tenant_id as string,
      eventType:  'leave.approved',
      payload:    { application_id: app.id, from_date: app.from_date, to_date: app.to_date, leave_type_id: app.leave_type_id },
      actorId:    req.userId,
      targetType: 'employee',
      targetId:   app.employee_id as string,
    }).catch(() => {/* non-fatal */})

    // In-process event bus — drives automation, SLA monitoring, analytics invalidation
    eventBus.emit({
      type:          'leave.approved',
      tenantId:      app.tenant_id as string,
      correlationId: req.correlationId,
      payload: {
        tenantId:    app.tenant_id as string,
        employeeId:  app.employee_id as string,
        leaveId:     app.id as string,
        approverId:  req.userId,
        leaveTypeId: app.leave_type_id as string,
        fromDate:    app.from_date   as string,
        toDate:      app.to_date     as string,
        days:        leaveDates.length,
      },
    })

    // Write explainability ledger entry (non-fatal)
    void writeLedgerEntry(fastify.supabase, {
      tenant_id:          app.tenant_id as string,
      employee_id:        app.employee_id as string,
      month:              dateToMonth(app.from_date as string),
      event_type:         lt?.is_paid ? 'leave_deducted' : 'payable_days_changed',
      event_description:  lt?.is_paid
        ? `${lt.name} approved for ${app.from_date} – ${app.to_date} (${workingDays.computed_days} day${workingDays.computed_days !== 1 ? 's' : ''}). Balance deducted.`
        : `Unpaid leave (${lt?.name ?? 'leave'}) approved for ${app.from_date} – ${app.to_date} (${leaveDates.length} day${leaveDates.length !== 1 ? 's' : ''}). No balance deducted.`,
      impact_type:        lt?.is_paid ? 'lop' : 'payable_days_changed',
      impact_amount:      lt?.is_paid ? undefined : -(leaveDates.length),
      source_entity_type: 'leave_application',
      source_entity_id:   id,
      created_by:         req.userId,
    }, req.log).catch(() => {/* non-fatal */})

    return reply.send({
      message:              'Approved successfully',
      days_applied:         leaveDates.length,
      working_days_applied: workingDays.computed_days,
    })
  })

  // ── POST /attendance/leave/:id/reject ────────────────────────────────────────
  fastify.post('/attendance/leave/:id/reject', hrAdminAuth, async (req, reply) => {

    const { id } = req.params as { id: string }

    const { data: app, error: fetchError } = await fastify.supabase
      .from('leave_applications')
      .select('id, tenant_id, employee_id, from_date, to_date, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !app) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Application not found' })
    }
    if (app.status !== 'pending') {
      return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: `Application is already ${app.status}` })
    }

    const { error } = await fastify.supabase
      .from('leave_applications')
      .update({ status: 'rejected' })
      .eq('id', id)

    if (error) {
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to reject application' })
    }

    // DB-level event (non-blocking)
    emitEvent({
      supabase:   fastify.supabase,
      tenantId:   app.tenant_id as string,
      eventType:  'leave.rejected',
      payload:    { application_id: app.id, from_date: app.from_date, to_date: app.to_date },
      actorId:    req.userId,
      targetType: 'employee',
      targetId:   app.employee_id as string,
    }).catch(() => {/* non-fatal */})

    // In-process event bus
    eventBus.emit({
      type:          'leave.rejected',
      tenantId:      app.tenant_id as string,
      correlationId: req.correlationId,
      payload: {
        tenantId:   app.tenant_id  as string,
        employeeId: app.employee_id as string,
        leaveId:    app.id          as string,
        approverId: req.userId,
      },
    })

    return reply.send({ message: 'Rejected successfully' })
  })

  // ── GET /attendance/leave/balance/:employeeId ─────────────────────────────────
  fastify.get('/attendance/leave/balance/:employeeId', auth, async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const year = new Date().getFullYear()

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('employee_leave_balance')
      .select('id, leave_type_id, balance, year, leave_types(id, name, is_paid)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('year', year)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch leave balances' })
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /attendance/leave/balance ─────────────────────────────────────────────
  fastify.put('/attendance/leave/balance', hrAdminAuth, async (req, reply) => {
    const balanceSchema = z.object({
      employee_id:   z.string().uuid(),
      leave_type_id: z.string().uuid(),
      balance:       z.number().min(0).max(365),
      year:          z.number().int().optional(),
    })
    const parsed = balanceSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const year = parsed.data.year ?? new Date().getFullYear()
    const { data, error } = await fastify.supabase
      .from('employee_leave_balance')
      .upsert({
        tenant_id:     req.tenantId,
        employee_id:   parsed.data.employee_id,
        leave_type_id: parsed.data.leave_type_id,
        balance:       parsed.data.balance,
        year,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })
      .select('id, balance, year')
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to set leave balance' })

    // Audit log — balance set/updated by HR admin
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_leave_balance',
      recordId:    parsed.data.employee_id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     {
        employee_id:   parsed.data.employee_id,
        leave_type_id: parsed.data.leave_type_id,
        balance:       parsed.data.balance,
        year,
      },
    })

    return reply.send({ data })
  })

  // ── POST /attendance/leave/bulk-assign ───────────────────────────────────────
  // Admin-only: auto-approve leave for multiple employees at once.
  fastify.post('/attendance/leave/bulk-assign', hrAdminAuth, async (req, reply) => {
    // Idempotency — replay cached response for duplicate submissions
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'bulk-assign')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    const bulkSchema = z.object({
      employee_ids:  z.array(z.string().uuid()).min(1).max(200),
      leave_type_id: z.string().uuid(),
      from_date:     z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
      to_date:       z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
      reason:        z.string().max(500).optional(),
    })
    const parsed = bulkSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { employee_ids, leave_type_id, from_date, to_date, reason } = parsed.data

    if (from_date > to_date) {
      return reply.code(400).send({ error: 'INVALID_DATES', message: 'from_date must be ≤ to_date' })
    }

    // Verify leave type belongs to tenant
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid')
      .eq('id', leave_type_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!lt) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Leave type not found' })

    const dates = expandDateRange(from_date, to_date)
    const now   = new Date().toISOString()

    // Create leave applications (auto-approved)
    const appRows = employee_ids.map((emp_id) => ({
      tenant_id:     req.tenantId,
      employee_id:   emp_id,
      leave_type_id,
      from_date,
      to_date,
      reason:        reason ?? null,
      status:        'approved',
      approved_by:   req.userId,
      approved_at:   now,
    }))
    const { error: appErr } = await fastify.supabase.from('leave_applications').insert(appRows)
    if (appErr) {
      req.log.error({ err: appErr }, 'bulk-assign leave applications insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create leave applications' })
    }

    // Upsert attendance_daily rows for all employees × all dates
    const dailyRows = employee_ids.flatMap((emp_id) =>
      dates.map((d) => ({
        tenant_id:            req.tenantId,
        employee_id:          emp_id,
        date:                 d,
        status:               'leave',
        work_hours:           0,
        late_minutes:         0,
        overtime_minutes:     0,
        worked_on_weekly_off: false,
        worked_on_holiday:    false,
        is_payable:           lt.is_paid,
        day_fraction:         lt.is_paid ? 1.0 : 0.0,
      }))
    )
    const { error: dailyErr } = await fastify.supabase
      .from('attendance_daily')
      .upsert(dailyRows, { onConflict: 'tenant_id,employee_id,date' })
    if (dailyErr) {
      req.log.warn({ err: dailyErr }, 'bulk-assign daily upsert failed — applications committed')
    }

    const responseBody = {
      message:         `Leave assigned to ${employee_ids.length} employees for ${dates.length} days`,
      employees_count: employee_ids.length,
      days_count:      dates.length,
    }

    // Cache response so duplicate submissions with the same Idempotency-Key are replayed
    if (iKey) {
      await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'bulk-assign', 200, responseBody)
    }

    // Audit log — bulk leave assignment by HR admin
    await logBulkAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_applications',
      action:      'INSERT',
      performedBy: req.userId,
      summary: {
        employee_ids:     employee_ids,
        employees_count:  employee_ids.length,
        leave_type_id,
        leave_type_name:  lt.name,
        from_date,
        to_date,
        days_count:       dates.length,
        is_paid:          lt.is_paid,
      },
    })

    return reply.send(responseBody)
  })

  // ── GET /attendance/leave/ledger/:employeeId ─────────────────────────────────
  // Returns accrual ledger entries for one employee.
  // Non-admins may only fetch their own employee_id (via profiles lookup).
  // Query params: leave_type_id?, year?, accrual_type?, limit?, offset?
  fastify.get('/attendance/leave/ledger/:employeeId', auth, async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const q = req.query as {
      leave_type_id?: string
      year?:          string
      accrual_type?:  string
      limit?:         string
      offset?:        string
    }

    const isAdmin  = ['super_admin', 'hr_admin'].includes(req.userRole)
    const limit    = Math.min(parseInt(q.limit  ?? '50', 10), 200)
    const offset   = Math.max(parseInt(q.offset ?? '0',  10), 0)

    // Non-admin: verify they are fetching their own record
    if (!isAdmin) {
      const { data: prof } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (!prof?.employee_id || prof.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You may only view your own ledger' })
      }
    }

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    let dbq = fastify.supabase
      .from('leave_accrual_ledger')
      .select(
        'id, accrual_type, days, year, accrued_on, expires_on, is_expired, notes, leave_types(id, name, is_paid)',
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('accrued_on', { ascending: false })
      .range(offset, offset + limit - 1)

    if (q.leave_type_id) dbq = dbq.eq('leave_type_id', q.leave_type_id)
    if (q.year)          dbq = dbq.eq('year', parseInt(q.year, 10))
    if (q.accrual_type)  dbq = dbq.eq('accrual_type', q.accrual_type)

    const { data, error, count } = await dbq

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch ledger' })

    return reply.send({
      data:   data ?? [],
      total:  count ?? 0,
      limit,
      offset,
    })
  })
}
