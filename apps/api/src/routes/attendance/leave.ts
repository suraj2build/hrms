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
import {
  expandDateRange, shiftDate, validateBalance, computeWorkingLeaveDays,
  resolveLeaveDayFraction, type LeaveSession,
} from '../../lib/leave-engine.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'
import { isSelfApproval } from '../../lib/approval-guards.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction, logBulkAction } from '../../lib/audit-service.js'
import { emitEvent } from '../../lib/event-emitter.js'
import { eventBus }  from '../../lib/event-bus.js'
import { writeLedgerEntry, dateToMonth } from '../../lib/ledger-writer.js'
import { isLeaveLedgerShadowEnabled, recordShadowDrift } from '../../lib/leave-ledger-shadow.js'
import { serverError, notFound, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

async function runConcurrent<T>(items: T[], fn: (item: T) => Promise<void>, concurrency = 10): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

const applySchema = z.object({
  leave_type_id: z.string().uuid('leave_type_id must be a UUID'),
  from_date:     z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
  to_date:       z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
  reason:        z.string().max(500).optional(),
  /** Half-day session. Hourly leave is not yet supported on this endpoint. */
  session:       z.enum(['full_day', 'first_half', 'second_half']).optional().default('full_day'),
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
      .from('leave_requests')
      .select('from_date, to_date')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('status', 'APPROVED')
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
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave types')
    }
    return reply.send(data ?? [])
  })

  // ── POST /attendance/leave/apply ──────────────────────────────────────────────
  fastify.post('/attendance/leave/apply', auth, async (req, reply) => {
    const parsed = applySchema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }

    const { from_date, to_date, session } = parsed.data
    if (from_date > to_date) {
      return validationError(reply, 'INVALID_DATES', 'from_date must be ≤ to_date')
    }

    // Half-day validation: must be a single day and the leave type must allow it.
    if (session !== 'full_day') {
      if (from_date !== to_date) {
        return validationError(reply, 'INVALID_HALF_DAY', 'A half-day leave must be for a single date (from_date = to_date)')
      }
      const { data: lt } = await fastify.supabase
        .from('leave_types')
        .select('allow_half_day')
        .eq('id', parsed.data.leave_type_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!lt?.allow_half_day) {
        return reply.code(422).send({
          error:   'HALF_DAY_NOT_ALLOWED',
          message: 'This leave type does not permit half-day leave',
        })
      }
    }

    // Resolve employee_id
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return validationError(reply, 'NO_EMPLOYEE_LINK', 'Your profile is not linked to an employee record')
    }

    // Roster-aware working-days for display (the engine is the only valid source —
    // the ESS page must never recompute duration from raw dates). Non-fatal:
    // approval recomputes authoritatively before any balance is deducted.
    let workingDaysVal: number | null = null
    try {
      const wd = await computeWorkingLeaveDays(
        fastify.supabase, req.tenantId, profile.employee_id, from_date, to_date,
        { halfDay: session !== 'full_day' },
      )
      workingDaysVal = wd.computed_days
    } catch (e) {
      req.log.warn({ err: e }, 'leave apply: working-days precompute failed (non-fatal — display only)')
    }

    // Overlap check — prevent duplicate/overlapping pending or approved applications.
    // Mirrors the canonical leave_requests overlap guard (leave-request-service.ts) —
    // this legacy leave_applications table had none, so an employee could submit the
    // same date range any number of times. (ISSUE-145)
    // Overlap condition: existing.from_date <= new.to_date AND existing.to_date >= new.from_date
    const { data: overlapping } = await fastify.supabase
      .from('leave_applications')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .in('status', ['pending', 'approved'])
      .lte('from_date', to_date)
      .gte('to_date', from_date)
      .limit(1)
      .maybeSingle()

    if (overlapping) {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: 'You already have a leave application that overlaps with this date range',
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
        session,
        working_days:  workingDaysVal,
      })
      .select('id, from_date, to_date, status, created_at')
      .single()

    if (error) {
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to submit leave application')
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
      .select('id, from_date, to_date, reason, status, approved_at, created_at, working_days, leave_types(name, is_paid)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .order('from_date', { ascending: false })

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch applications')
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
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch pending leaves')
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
      .select('id, tenant_id, employee_id, leave_type_id, from_date, to_date, status, session')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !app) {
      return notFound(reply, 'NOT_FOUND', 'Application not found')
    }
    if (app.status !== 'pending') {
      return conflictError(reply, 'ALREADY_ACTIONED', `Application is already ${app.status}`)
    }

    // Segregation of duties — a user may not approve their own leave (F3).
    if (await isSelfApproval(fastify.supabase, req.tenantId as string, (req as any).userId, app.employee_id as string)) {
      return forbidden(reply, 'SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own leave application.')
    }

    // Fetch leave type for paid flag + sandwich flag
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid, allow_sandwich')
      .eq('id', app.leave_type_id)
      .single()

    // Resolve the roster-aware working dates (excludes holidays + weekly-offs)
    // for BOTH paid and unpaid leave. Used for balance deduction AND for the
    // attendance_daily write, so a leave span never overwrites a holiday /
    // weekly-off day (which would wrongly turn a paid rest day into LOP).
    const leaveSession = (app.session as LeaveSession | null) ?? 'full_day'
    const isHalfDay    = leaveSession !== 'full_day'
    let workingDays: Awaited<ReturnType<typeof computeWorkingLeaveDays>>
    try {
      workingDays = await computeWorkingLeaveDays(
        fastify.supabase,
        app.tenant_id   as string,
        app.employee_id as string,
        app.from_date   as string,
        app.to_date     as string,
        { halfDay: isHalfDay },
      )
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to compute working leave days')
    }

    // Pre-approve balance check + atomic deduction (paid leave only).
    // C6-P1: Use checked_deduct_leave_balance instead of deduct_leave_balance.
    // The old RPC clamped silently to GREATEST(0, balance-days), which diverged
    // the ledger (full amount) from the cache (clamped amount). The new RPC deducts
    // ONLY when balance >= days and returns FALSE if the check fails — ensuring
    // the ledger and cache always move by the same delta.
    //
    // Ordering is deliberate: deduction comes BEFORE the status update so that a
    // concurrent second approval for the same employee fails atomically at the DB
    // level (race condition guard), not at the application-level validateBalance
    // check which reads a stale snapshot.
    let paidYear: number | null = null
    if (lt?.is_paid) {
      paidYear = new Date(app.from_date as string).getFullYear()
      const check = await validateBalance(
        fastify.supabase,
        app.tenant_id    as string,
        app.employee_id  as string,
        app.leave_type_id as string,
        workingDays.computed_days,
        paidYear,
      )
      if (!check.valid) {
        return reply.code(422).send({
          error:   'INSUFFICIENT_BALANCE',
          message: check.message ?? 'Insufficient leave balance',
        })
      }

      // Atomic deduction gate — only succeeds when balance >= computed_days.
      const { data: deducted, error: deductErr } = await fastify.supabase.rpc('checked_deduct_leave_balance', {
        p_tenant_id:     app.tenant_id,
        p_employee_id:   app.employee_id,
        p_leave_type_id: app.leave_type_id,
        p_days:          workingDays.computed_days,
        p_year:          paidYear,
      })
      if (deductErr) {
        return serverError(req, reply, deductErr, ErrorCode.BALANCE_DEDUCT_FAILED, 'Failed to deduct leave balance')
      }
      if (!deducted) {
        return reply.code(422).send({
          error:   'INSUFFICIENT_BALANCE',
          message: 'Insufficient leave balance (concurrent conflict — balance changed since validation)',
        })
      }
    }

    // Approve — conditioned on status still being 'pending'. The atomic RPC
    // above only guards the BALANCE against a double-deduction (it fails if
    // insufficient balance remains); it does nothing to stop two concurrent
    // approve requests for the SAME application from both passing the
    // status !== 'pending' check above and both reaching this UPDATE. Without
    // the .eq('status','pending') guard + affected-row check here, both
    // requests would deduct balance (succeeding as long as it covers 2x the
    // days) and both would write status='approved' — a real double-deduction
    // with the ledger (deduped by source_request_id below) showing only one
    // entry while the cached balance is short by 2x. Race-losing request
    // rolls back its own deduction and returns a conflict instead.
    const { data: updatedRows, error: updateError } = await fastify.supabase
      .from('leave_applications')
      .update({
        status:       'approved',
        approved_by:  req.userId,
        approved_at:  new Date().toISOString(),
        working_days: workingDays.computed_days,   // authoritative roster-aware duration
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')

    if (updateError) {
      return serverError(req, reply, updateError, ErrorCode.UPDATE_FAILED, 'Failed to approve application')
    }

    if (!updatedRows?.length) {
      // Lost the race — another request already actioned this application
      // between our initial fetch and this UPDATE. Roll back the balance
      // deduction we already made above (paid leave only) so the cache
      // doesn't stay permanently short. Mirrors the cancel handler's
      // reversal pattern (credit_leave_balance + a deduped 'reversal' ledger
      // row keyed by source_request_id) further down in this file.
      if (lt?.is_paid && paidYear !== null) {
        const { error: ledgerErr } = await fastify.supabase
          .from('leave_accrual_ledger')
          .upsert({
            tenant_id:         app.tenant_id,
            employee_id:       app.employee_id,
            leave_type_id:     app.leave_type_id,
            year:              paidYear,
            accrual_type:      'reversal',
            days:              workingDays.computed_days,
            accrued_on:        new Date().toISOString().slice(0, 10),
            is_expired:        false,
            notes:             `Reversal — lost race on concurrent approval of application ${id}`,
            source_request_id: id,
          }, { onConflict: 'tenant_id,accrual_type,source_request_id', ignoreDuplicates: true })
        if (ledgerErr) {
          req.log.error({ err: ledgerErr, id }, 'leave approve: race-rollback ledger write failed — balance may be double-deducted')
        }

        const { error: creditErr } = await fastify.supabase.rpc('credit_leave_balance', {
          p_tenant_id:     app.tenant_id,
          p_employee_id:   app.employee_id,
          p_leave_type_id: app.leave_type_id,
          p_days:          workingDays.computed_days,
          p_year:          paidYear,
        })
        if (creditErr) {
          req.log.error({ err: creditErr, id }, 'leave approve: race-rollback credit_leave_balance failed — balance may be double-deducted')
        }
      }
      return conflictError(reply, 'ALREADY_ACTIONED', 'This application was already actioned by another request')
    }

    // Apply leave days to attendance_daily — ONLY on roster working dates.
    // Holidays / weekly-offs inside the span are intentionally NOT written, so
    // they remain paid rest days (a holiday inside an UNPAID leave span must not
    // become LOP). Falls back to the full span only if roster resolution found
    // no working dates (defensive — avoids a no-op approval).
    const leaveDates = workingDays.counted_dates && workingDays.counted_dates.length > 0
      ? workingDays.counted_dates
      : expandDateRange(app.from_date as string, app.to_date as string)
    const isPaid = lt?.is_paid ?? false

    // Fetch pre-existing status + fraction so a half-day leave can MERGE with a
    // half-day present already recorded for the date (0.5 worked + 0.5 leave → 1.0)
    // rather than overwriting it.
    const { data: existingRows } = await fastify.supabase
      .from('attendance_daily')
      .select('date, status, day_fraction')
      .eq('tenant_id', app.tenant_id)
      .eq('employee_id', app.employee_id)
      .in('date', leaveDates)

    const existingStatusMap   = new Map<string, string>()
    const existingFractionMap = new Map<string, number>()
    for (const r of (existingRows ?? []) as Array<{ date: string; status: string; day_fraction: number | null }>) {
      existingStatusMap.set(r.date, r.status)
      if (r.day_fraction !== null) existingFractionMap.set(r.date, r.day_fraction)
    }

    const dailyRows = leaveDates.map((d) => {
      const resolved = resolveLeaveDayFraction({
        session:           leaveSession,
        isPaid,
        existingStatus:    existingStatusMap.get(d) ?? null,
        existingFraction:  existingFractionMap.get(d) ?? null,
      })
      return {
        tenant_id:            app.tenant_id,
        employee_id:          app.employee_id,
        date:                 d,
        status:               resolved.status,
        work_hours:           0,
        late_minutes:         0,
        overtime_minutes:     0,
        worked_on_weekly_off: false,
        worked_on_holiday:    false,
        is_payable:           resolved.is_payable,
        day_fraction:         resolved.day_fraction,
        // Mark as leave-approval origin so the engine recompute never silently
        // overwrites this intentional human decision back to a punch-derived status.
        computed_source:      'leave_approval',
      }
    })

    const { error: dailyError } = await fastify.supabase
      .from('attendance_daily')
      .upsert(dailyRows, { onConflict: 'tenant_id,employee_id,date' })

    if (dailyError) {
      req.log.warn({ err: dailyError }, 'leave daily upsert failed — approval committed')
    }

    // Write audit log for each leave day (after_status reflects the resolved
    // status, which may be 'half_day'/'present' for a merged half-day leave).
    const resolvedStatusByDate = new Map<string, string>(dailyRows.map(r => [r.date as string, r.status as string]))
    const auditChanges = leaveDates
      .filter((d) => existingStatusMap.get(d) !== resolvedStatusByDate.get(d))
      .map((d) => ({
        employee_id:   app.employee_id as string,
        date:          d,
        before_status: existingStatusMap.get(d) ?? null,
        after_status:  resolvedStatusByDate.get(d) ?? 'leave',
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

    // C6-P1: Write the signed consumption row to leave_accrual_ledger (the
    // authoritative balance ledger) AFTER the cache deduction has already
    // succeeded via checked_deduct_leave_balance above. Ledger and cache are
    // guaranteed to move by the same delta.
    if (lt?.is_paid && paidYear !== null) {
      const { error: ledgerErr } = await fastify.supabase
        .from('leave_accrual_ledger')
        .upsert({
          tenant_id:         app.tenant_id,
          employee_id:       app.employee_id,
          leave_type_id:     app.leave_type_id,
          year:              paidYear,
          accrual_type:      'consumption',
          days:              -Math.abs(workingDays.computed_days),
          accrued_on:        app.from_date,
          is_expired:        false,
          notes:             `Leave consumed ${app.from_date}…${app.to_date}`,
          source_request_id: app.id,
        }, { onConflict: 'tenant_id,accrual_type,source_request_id', ignoreDuplicates: true })
      if (ledgerErr) req.log.warn({ err: ledgerErr }, 'leave consumption ledger write failed — approval committed, balance deducted')
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

    // Payroll freeze guard — queue adjustment if leave overlaps a locked payroll period
    // Non-blocking: approval is already committed above; this is a best-effort queue entry.
    try {
      const affectedMonths = [...new Set(leaveDates.map((d: string) => d.slice(0, 7)))]
      // Batch-check all affected months in one query instead of N per-month queries
      const { data: frozenRows } = await fastify.supabase
        .from('payroll_freeze_log')
        .select('freeze_month')
        .eq('tenant_id', req.tenantId)
        .in('freeze_month', affectedMonths)
        .eq('action', 'freeze')
        .is('unfrozen_at', null)
      const frozenSet = new Set((frozenRows ?? []).map((r: { freeze_month: string }) => r.freeze_month))
      if (frozenSet.size > 0) {
        await fastify.supabase.from('payroll_adjustments').insert(
          [...frozenSet].map(month => ({
            tenant_id:       req.tenantId,
            employee_id:     app.employee_id,
            locked_month:    month,
            adjustment_type: 'lop_adjustment',
            reason:          `Leave approved for ${app.from_date}–${app.to_date} affects locked period ${month}`,
            source_type:     'leave_approval',
            source_id:       app.id,
            status:          'pending',
            created_by:      req.userId,
          }))
        )
      }
    } catch (err) {
      req.log.warn({ err }, 'payroll freeze guard check failed — approval committed')
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
      return notFound(reply, 'NOT_FOUND', 'Application not found')
    }
    if (app.status !== 'pending') {
      return conflictError(reply, 'ALREADY_ACTIONED', `Application is already ${app.status}`)
    }

    // Fold the precondition into the WHERE clause — unlike the approve handler
    // in this same file, this UPDATE had no .eq('status','pending') guard, so
    // a concurrent approve that commits first would still get silently
    // clobbered to 'rejected' here (the reject request read a stale 'pending'
    // snapshot above). Checking affected rows makes this TOCTOU-safe.
    const { data: rejectedRows, error } = await fastify.supabase
      .from('leave_applications')
      .update({ status: 'rejected' })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject application')
    }
    if (!rejectedRows?.length) {
      return conflictError(reply, 'ALREADY_ACTIONED', 'Application was already actioned by another request')
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

  // ── POST /attendance/leave/:id/cancel ────────────────────────────────────────
  // Cancels an already-approved leave application, reverses the attendance_daily
  // rows it created, and restores the leave balance.
  //
  // Accessible by: HR admins (any leave) and the leave-owning employee (self).
  // A cancelled leave is permanent — it cannot be re-approved.
  fastify.post('/attendance/leave/:id/cancel', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)

    const { data: app, error: fetchError } = await fastify.supabase
      .from('leave_applications')
      .select('id, tenant_id, employee_id, leave_type_id, from_date, to_date, status, session')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !app) {
      return notFound(reply, 'NOT_FOUND', 'Application not found')
    }
    if (app.status !== 'approved') {
      return conflictError(reply, 'INVALID_STATE', `Only approved leaves can be cancelled (current status: ${app.status})`)
    }

    // Non-admins may only cancel their own leave
    if (!isHrAdmin) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (!callerProfile?.employee_id || callerProfile.employee_id !== app.employee_id) {
        return forbidden(reply, 'FORBIDDEN', 'You may only cancel your own leave applications')
      }
    }

    // Fetch leave type to know if this is a paid leave (balance must be restored)
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid')
      .eq('id', app.leave_type_id)
      .single()

    // Look up the original consumption ledger row to determine exact days consumed.
    // This is more reliable than recomputing since the roster may have changed.
    let daysToRestore: number | null = null
    const { data: consumptionRow } = await fastify.supabase
      .from('leave_accrual_ledger')
      .select('days')
      .eq('tenant_id', app.tenant_id)
      .eq('source_request_id', app.id)
      .eq('accrual_type', 'consumption')
      .maybeSingle()

    if (consumptionRow) {
      // consumption rows are negative; days to restore = absolute value
      daysToRestore = Math.abs(Number(consumptionRow.days))
    } else if (lt?.is_paid) {
      // Pre-C6 approval — no consumption ledger row exists. Recompute.
      try {
        const wd = await computeWorkingLeaveDays(
          fastify.supabase,
          app.tenant_id   as string,
          app.employee_id as string,
          app.from_date   as string,
          app.to_date     as string,
          { halfDay: (app.session as string | null) !== 'full_day' },
        )
        daysToRestore = wd.computed_days
      } catch {
        req.log.warn({ appId: id }, 'cancel: could not recompute working days — balance will not be restored')
      }
    }

    // Mark as cancelled. Fold the precondition into the WHERE clause — this
    // UPDATE had no .eq('status','approved') guard, so a concurrent approve
    // (which correctly locks/rechecks status) or reject that lands between
    // our fetch above and this write would otherwise be silently clobbered to
    // 'cancelled' with no balance/ledger reconciliation on that other path.
    const { data: cancelledRows, error: cancelErr } = await fastify.supabase
      .from('leave_applications')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'approved')
      .select('id')

    if (cancelErr) {
      return serverError(req, reply, cancelErr, ErrorCode.UPDATE_FAILED, 'Failed to cancel application')
    }
    if (!cancelledRows?.length) {
      return conflictError(reply, 'ALREADY_ACTIONED', 'Application was already actioned by another request')
    }

    // Reverse attendance_daily rows that were created by this leave approval.
    // Rows with computed_source='leave_approval' within the leave date range are
    // deleted so the attendance engine can reprocess them from punch data.
    const allDates = expandDateRange(app.from_date as string, app.to_date as string)
    const { error: dailyErr } = await fastify.supabase
      .from('attendance_daily')
      .delete()
      .eq('tenant_id', app.tenant_id)
      .eq('employee_id', app.employee_id)
      .eq('computed_source', 'leave_approval')
      .in('date', allDates)

    if (dailyErr) {
      req.log.warn({ err: dailyErr }, 'leave cancel: attendance_daily reversal failed — cancellation committed')
    }

    // Restore leave balance and write reversal ledger row (paid leave only)
    if (lt?.is_paid && daysToRestore && daysToRestore > 0) {
      const year = new Date(app.from_date as string).getFullYear()

      // C6: idempotent reversal row in leave_accrual_ledger.
      // source_request_id = original leave application id, accrual_type = 'reversal'
      // ensures at most one reversal per leave. This block is now reachable
      // at most once per application — the cancel UPDATE above only succeeds
      // once (folded status='approved' precondition) — so credit_leave_balance
      // (which is not itself idempotent) can't be double-invoked via a retry.
      const { error: ledgerErr } = await fastify.supabase
        .from('leave_accrual_ledger')
        .upsert({
          tenant_id:         app.tenant_id,
          employee_id:       app.employee_id,
          leave_type_id:     app.leave_type_id,
          year,
          accrual_type:      'reversal',
          days:              daysToRestore,
          accrued_on:        new Date().toISOString().slice(0, 10),
          is_expired:        false,
          notes:             `Leave reversal — cancelled application ${app.from_date}…${app.to_date}`,
          source_request_id: app.id,
        }, { onConflict: 'tenant_id,accrual_type,source_request_id', ignoreDuplicates: true })

      if (ledgerErr) {
        req.log.warn({ err: ledgerErr }, 'leave cancel: reversal ledger write failed — cancellation committed')
      }

      // Restore cache balance
      const { error: creditErr } = await fastify.supabase.rpc('credit_leave_balance', {
        p_tenant_id:     app.tenant_id,
        p_employee_id:   app.employee_id,
        p_leave_type_id: app.leave_type_id,
        p_days:          daysToRestore,
        p_year:          year,
      })
      if (creditErr) {
        req.log.warn({ err: creditErr }, 'leave cancel: credit_leave_balance failed — cancellation committed, ledger reversed')
      }
    }

    return reply.send({
      message:          'Leave cancelled successfully',
      days_restored:    daysToRestore ?? 0,
    })
  })

  // ── GET /attendance/leave/balance/:employeeId ─────────────────────────────────
  fastify.get('/attendance/leave/balance/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const year = new Date().getFullYear()
    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)

    // Non-admin callers may only view their own leave balance.
    // Resolve the caller's employee_id and enforce ownership before touching DB.
    if (!isHrAdmin) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (!callerProfile?.employee_id) {
        return forbidden(reply, 'NO_EMPLOYEE_LINK', 'Profile not linked to an employee record')
      }
      if (callerProfile.employee_id !== employeeId) {
        return forbidden(reply, 'FORBIDDEN', 'You can only view your own leave balance')
      }
    }

    // Verify employee belongs to tenant (still needed for admin path + defence-in-depth)
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return notFound(reply, 'NOT_FOUND', 'Employee not found')

    // C6 feature flag: LEAVE_LEDGER_AUTHORITATIVE (default OFF).
    // When ON: balance is derived from Σ(leave_accrual_ledger) rather than
    // the employee_leave_balance cache.  Keep OFF until shadow-read validation
    // confirms zero discrepancies across a full reconciliation window.
    const useLedger = process.env.LEAVE_LEDGER_AUTHORITATIVE === 'true'

    if (useLedger) {
      // Derive balance from the authoritative ledger (Σ of signed days, non-expired).
      const { data: ledgerRows, error: ledgerErr } = await fastify.supabase
        .from('leave_accrual_ledger')
        .select('leave_type_id, days, leave_types(id, name, is_paid)')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('year', year)
        .eq('is_expired', false)

      if (ledgerErr) return serverError(req, reply, ledgerErr, ErrorCode.QUERY_FAILED, 'Failed to fetch leave balances from ledger')

      const balMap: Record<string, { balance: number; entitlement: number; lt: any }> = {}
      for (const row of (ledgerRows ?? []) as any[]) {
        const ltid = row.leave_type_id
        if (!balMap[ltid]) balMap[ltid] = { balance: 0, entitlement: 0, lt: row.leave_types }
        const d = Number(row.days)
        balMap[ltid].balance += d
        if (d > 0) balMap[ltid].entitlement += d
      }

      const enrichedLedger = Object.entries(balMap).map(([ltid, v]) => ({
        leave_type_id:      ltid,
        balance:            Math.round(v.balance * 100) / 100,
        year,
        leave_types:        v.lt,
        annual_entitlement: Math.round(v.entitlement * 100) / 100 || null,
        _source:            'ledger',
      }))

      return reply.send({ data: enrichedLedger })
    }

    // Default (cache) path — reads employee_leave_balance.
    const [{ data, error }, { data: accrualRows }] = await Promise.all([
      fastify.supabase
        .from('employee_leave_balance')
        .select('id, leave_type_id, balance, year, leave_types(id, name, is_paid)')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('year', year),

      // Sum of all positive accrual entries this year per leave type — gives total entitlement
      fastify.supabase
        .from('leave_accrual_ledger')
        .select('leave_type_id, days')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('year', year)
        .gt('days', 0),
    ])

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave balances')

    // Build a lookup: leave_type_id → total accrued days this year
    const accrualByType: Record<string, number> = {}
    for (const row of (accrualRows ?? []) as any[]) {
      accrualByType[row.leave_type_id] = (accrualByType[row.leave_type_id] ?? 0) + Number(row.days)
    }

    const enriched = (data ?? []).map((b: any) => ({
      ...b,
      // annual_entitlement: total credited this year; null when ledger is empty (pre-accrual)
      annual_entitlement: accrualByType[b.leave_type_id] ?? null,
    }))

    // C6 Phase 1: passive shadow comparison — record any cache↔ledger drift
    // without altering the served (cache) response. Gated behind LEAVE_LEDGER_SHADOW.
    if (isLeaveLedgerShadowEnabled()) {
      void recordShadowDrift(
        fastify.supabase,
        req.tenantId as string,
        employeeId,
        year,
        (data ?? []).map((b: any) => ({ leave_type_id: b.leave_type_id, balance: Number(b.balance) })),
        req.log,
      )
    }

    return reply.send({ data: enriched })
  })

  // ── GET /attendance/leave/team-balances ──────────────────────────────────────
  // Manager-facing: returns leave balances for all direct reports of the caller.
  // Also accessible to hr_admin / super_admin (unrestricted).
  // P6.10: hierarchy fixed to use employees.manager_id (canonical P6.0a model).
  // P6.10: ?include_liability=true computes liability_value = balance × daily_rate
  //        (daily_rate = ctc_monthly / 26) using existing employee_compensations.
  fastify.get('/attendance/leave/team-balances', auth, async (req: any, reply) => {
    const year             = new Date().getFullYear()
    const tenantId         = req.tenantId as string
    const isHrAdmin        = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
    const includeLiability = (req.query as any).include_liability === 'true'

    let teamEmployeeIds: string[] = []

    if (isHrAdmin) {
      // HR admin: all active employees in tenant. fetchAllRows() (not a
      // plain query) — fresh audit finding: a >1,000-employee tenant would
      // otherwise silently show balances for only the first 1,000 (in
      // whatever order PostgREST returns them), the same Muster Roll bug
      // class CLAUDE.md's Supabase pagination rule documents.
      let allEmps: any[]
      try {
        allEmps = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('employees')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('status', 'active')
            .range(from, to),
        )
      } catch (err: any) {
        return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch team balances')
      }
      teamEmployeeIds = allEmps.map((e: any) => e.id)
    } else {
      // Manager: use the canonical hierarchy (employees.manager_id / status)
      // that is the single source of truth established in P6.0a.
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', tenantId)
        .single()

      if (!callerProfile?.employee_id) {
        return forbidden(reply, 'NO_EMPLOYEE_LINK', 'Profile not linked to an employee record')
      }

      const { data: directReports } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('manager_id', callerProfile.employee_id)
        .eq('status', 'active')

      teamEmployeeIds = ((directReports ?? []) as any[]).map(e => e.id)
    }

    if (teamEmployeeIds.length === 0) {
      return reply.send({ data: [] })
    }

    // Bulk fetch leave balances + employee info + accrual totals for the team
    const [{ data: employees }, { data: balances }, { data: accrualRows }] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code, departments(name)')
        .eq('tenant_id', tenantId)
        .in('id', teamEmployeeIds),

      fastify.supabase
        .from('employee_leave_balance')
        .select('employee_id, leave_type_id, balance, year, leave_types(id, name, is_paid)')
        .eq('tenant_id', tenantId)
        .in('employee_id', teamEmployeeIds)
        .eq('year', year),

      fastify.supabase
        .from('leave_accrual_ledger')
        .select('employee_id, leave_type_id, days')
        .eq('tenant_id', tenantId)
        .in('employee_id', teamEmployeeIds)
        .eq('year', year)
        .gt('days', 0),
    ])

    // Optional: fetch compensation to compute leave liability value
    const compData = includeLiability
      ? (await fastify.supabase
          .from('employee_compensations')
          .select('employee_id, ctc_monthly')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .in('employee_id', teamEmployeeIds)).data
      : null

    // ctc_monthly lookup: employee_id → daily_rate (ctc_monthly / 26)
    const dailyRateByEmp: Record<string, number> = {}
    if (includeLiability && compData) {
      for (const c of (compData as any[])) {
        if (c.ctc_monthly) dailyRateByEmp[c.employee_id] = Number(c.ctc_monthly) / 26
      }
    }

    // Build accrual lookup: employeeId → leaveTypeId → total days
    const accrualMap: Record<string, Record<string, number>> = {}
    for (const row of (accrualRows ?? []) as any[]) {
      if (!accrualMap[row.employee_id]) accrualMap[row.employee_id] = {}
      accrualMap[row.employee_id][row.leave_type_id] =
        (accrualMap[row.employee_id][row.leave_type_id] ?? 0) + Number(row.days)
    }

    // Group balances by employee
    const balanceByEmp: Record<string, any[]> = {}
    for (const b of (balances ?? []) as any[]) {
      if (!balanceByEmp[b.employee_id]) balanceByEmp[b.employee_id] = []
      const bal   = Number(b.balance)
      const daily = dailyRateByEmp[b.employee_id] ?? null
      const row: Record<string, any> = {
        leave_type_id:     b.leave_type_id,
        leave_type_name:   (b.leave_types as any)?.name ?? 'Unknown',
        is_paid:           (b.leave_types as any)?.is_paid ?? false,
        balance:           bal,
        annual_entitlement: accrualMap[b.employee_id]?.[b.leave_type_id] ?? null,
        used:              (accrualMap[b.employee_id]?.[b.leave_type_id] ?? 0) - bal,
      }
      if (includeLiability) {
        row.daily_rate     = daily !== null ? Math.round(daily * 100) / 100 : null
        row.liability_value = daily !== null ? Math.round(bal * daily * 100) / 100 : null
      }
      balanceByEmp[b.employee_id].push(row)
    }

    // Assemble final response
    const result = ((employees ?? []) as any[]).map(emp => {
      const dept = Array.isArray(emp.departments) ? emp.departments[0] : emp.departments
      const empBalances = balanceByEmp[emp.id] ?? []
      const entry: Record<string, any> = {
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        name:          `${emp.first_name} ${emp.last_name}`,
        department:    dept?.name ?? null,
        balances:      empBalances,
      }
      if (includeLiability) {
        const daily = dailyRateByEmp[emp.id] ?? null
        entry.daily_rate       = daily !== null ? Math.round(daily * 100) / 100 : null
        entry.total_liability  = daily !== null
          ? Math.round(empBalances.reduce((s: number, b: any) => s + (b.is_paid ? b.balance : 0), 0) * daily * 100) / 100
          : null
      }
      return entry
    })

    return reply.send({ data: result, year })
  })

  // ── GET /attendance/leave/whos-off ────────────────────────────────────────────
  // ESS "Team Who's Off": approved leave for the caller's DEPARTMENT teammates,
  // overlapping a [from, to] date window. Available to every employee (not just
  // managers). Scope is the caller's department (incl. self); falls back to self
  // only when the caller has no department.
  fastify.get('/attendance/leave/whos-off', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const q = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
      to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
    }).safeParse(req.query)
    if (!q.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, q.error.issues[0]?.message ?? 'Validation failed')
    }
    const { from, to } = q.data

    // Resolve caller → employee + department
    const { data: callerProfile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const myEmpId = (callerProfile as any)?.employee_id as string | null
    if (!myEmpId) {
      return reply.send({ data: { members: [], leave: [], department: null } })
    }

    const { data: me } = await fastify.supabase
      .from('employees')
      .select('id, job_history!job_history_employee_id_fkey(department_id, is_current)')
      .eq('id', myEmpId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const _meJh = ((me as any)?.job_history ?? []).find((j: any) => j.is_current) ?? ((me as any)?.job_history ?? [])[0] ?? null
    const myDeptId = (_meJh?.department_id ?? null) as string | null

    // Team = active employees in the same department (incl. self). No department → self only.
    let memberQuery = fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
    memberQuery = myDeptId
      ? memberQuery.eq('department_id', myDeptId)
      : memberQuery.eq('id', myEmpId)

    const { data: members } = await memberQuery
    const memberIds = ((members ?? []) as any[]).map(m => m.id)

    const deptRel = (me as any)?.departments
    const department = (Array.isArray(deptRel) ? deptRel[0]?.name : deptRel?.name) ?? null

    if (memberIds.length === 0) {
      return reply.send({ data: { members: [], leave: [], department } })
    }

    // Approved leave overlapping the window: from_date <= to AND to_date >= from
    const { data: leave } = await fastify.supabase
      .from('leave_requests')
      .select('id, employee_id, from_date, to_date, half_day, computed_days, leave_types(name)')
      .eq('tenant_id', tenantId)
      .in('employee_id', memberIds)
      .eq('status', 'APPROVED')
      .lte('from_date', to)
      .gte('to_date', from)

    const leaveOut = ((leave ?? []) as any[]).map(l => ({
      id:          l.id,
      employee_id: l.employee_id,
      from_date:   l.from_date,
      to_date:     l.to_date,
      half_day:    l.half_day,
      days:        Number(l.computed_days),
      leave_type:  (Array.isArray(l.leave_types) ? l.leave_types[0]?.name : l.leave_types?.name) ?? 'Leave',
    }))

    const membersOut = ((members ?? []) as any[]).map(m => ({
      employee_id:   m.id,
      name:          `${m.first_name} ${m.last_name}`.trim(),
      employee_code: m.employee_code,
      is_self:       m.id === myEmpId,
    }))

    return reply.send({ data: { members: membersOut, leave: leaveOut, department } })
  })


  fastify.put('/attendance/leave/balance', hrAdminAuth, async (req, reply) => {
    const balanceSchema = z.object({
      employee_id:   z.string().uuid(),
      leave_type_id: z.string().uuid(),
      balance:       z.number().min(0).max(365),
      year:          z.number().int().optional(),
    })
    const parsed = balanceSchema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
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

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to set leave balance')

    // Audit log — balance set/updated by HR admin on behalf of employee
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_leave_balance',
      recordId:    parsed.data.employee_id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  parsed.data.employee_id,   // HR admin always acts on behalf of target employee
      newData:     {
        employee_id:   parsed.data.employee_id,
        leave_type_id: parsed.data.leave_type_id,
        balance:       parsed.data.balance,
        year,
      },
    })

    return reply.send({ data })
  })

  // ── POST /attendance/leave/opening-balance ───────────────────────────────────
  // HR-admin: set ONE employee's opening balance for ONE leave type + year.
  // Writes cache + ledger consistently via the set_opening_balance RPC.
  fastify.post('/attendance/leave/opening-balance', hrAdminAuth, async (req, reply) => {
    const schema = z.object({
      employee_id:   z.string().uuid(),
      leave_type_id: z.string().uuid(),
      days:          z.number().min(0).max(365),
      year:          z.number().int().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const year = parsed.data.year ?? new Date().getFullYear()
    const { error } = await fastify.supabase.rpc('set_opening_balance', {
      p_tenant_id:     req.tenantId,
      p_employee_id:   parsed.data.employee_id,
      p_leave_type_id: parsed.data.leave_type_id,
      p_days:          parsed.data.days,
      p_year:          year,
    })
    if (error) {
      return serverError(req, reply, error, ErrorCode.OPENING_BALANCE_FAILED, 'Failed to set opening balance')
    }
    return reply.send({ data: { ...parsed.data, year } })
  })

  // ── POST /attendance/leave/opening-balance/bulk ──────────────────────────────
  // HR-admin: bulk opening-balance upload for migration/onboarding.
  // Rows reference employees by employee_code (or id) and leave types by name
  // (or id); both are resolved within the caller's tenant. A per-row result list
  // is returned so the UI can show which rows succeeded / failed.
  fastify.post('/attendance/leave/opening-balance/bulk', hrAdminAuth, async (req, reply) => {
    const rowSchema = z.object({
      employee_code: z.string().trim().min(1).optional(),
      employee_id:   z.string().uuid().optional(),
      leave_type:    z.string().trim().min(1).optional(),
      leave_type_id: z.string().uuid().optional(),
      days:          z.number().min(0).max(365),
    })
      .refine(r => r.employee_code || r.employee_id, { message: 'employee_code or employee_id required' })
      .refine(r => r.leave_type || r.leave_type_id, { message: 'leave_type or leave_type_id required' })
    const schema = z.object({
      year: z.number().int().optional(),
      rows: z.array(rowSchema).min(1).max(5000),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const year = parsed.data.year ?? new Date().getFullYear()

    // Resolve codes/names → ids once for the tenant. employees can exceed
    // PostgREST's 1,000-row max-rows ceiling, which a plain .select() hits
    // silently — rows past 1,000 would report as "Unknown employee" even
    // though they're valid, purely due to truncation.
    let empRows: Array<{ id: string; employee_code: string }>
    let ltRows: Array<{ id: string; name: string }>
    try {
      ;[empRows, ltRows] = await Promise.all([
        fetchAllRows<{ id: string; employee_code: string }>((from, to) =>
          fastify.supabase.from('employees').select('id, employee_code').eq('tenant_id', req.tenantId).range(from, to),
        ),
        fetchAllRows<{ id: string; name: string }>((from, to) =>
          fastify.supabase.from('leave_types').select('id, name').eq('tenant_id', req.tenantId).range(from, to),
        ),
      ])
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.LOOKUP_FAILED, 'Failed to load employees / leave types')
    }
    const empByCode = new Map(empRows.map((e) => [String(e.employee_code).toLowerCase(), e.id]))
    const empIds    = new Set(empRows.map((e) => e.id))
    const ltByName  = new Map(ltRows.map((l) => [String(l.name).toLowerCase(), l.id]))
    const ltIds     = new Set(ltRows.map((l) => l.id))

    const results: Array<{ row: number; ok: boolean; message?: string }> = []
    let succeeded = 0
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i]
      const empId = (r.employee_id && empIds.has(r.employee_id))
        ? r.employee_id
        : (r.employee_code ? empByCode.get(r.employee_code.toLowerCase()) : undefined)
      const ltId = (r.leave_type_id && ltIds.has(r.leave_type_id))
        ? r.leave_type_id
        : (r.leave_type ? ltByName.get(r.leave_type.toLowerCase()) : undefined)
      if (!empId) { results.push({ row: i + 1, ok: false, message: `Unknown employee "${r.employee_code ?? r.employee_id}"` }); continue }
      if (!ltId)  { results.push({ row: i + 1, ok: false, message: `Unknown leave type "${r.leave_type ?? r.leave_type_id}"` }); continue }
      const { error } = await fastify.supabase.rpc('set_opening_balance', {
        p_tenant_id: req.tenantId, p_employee_id: empId, p_leave_type_id: ltId, p_days: r.days, p_year: year,
      })
      if (error) { results.push({ row: i + 1, ok: false, message: error.message }); continue }
      succeeded++
      results.push({ row: i + 1, ok: true })
    }
    return reply.send({
      data: { total: parsed.data.rows.length, succeeded, failed: parsed.data.rows.length - succeeded, year, results },
    })
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
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const { employee_ids, leave_type_id, from_date, to_date, reason } = parsed.data

    if (from_date > to_date) {
      return validationError(reply, 'INVALID_DATES', 'from_date must be ≤ to_date')
    }

    // Verify leave type belongs to tenant
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid')
      .eq('id', leave_type_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!lt) return notFound(reply, 'NOT_FOUND', 'Leave type not found')

    // Fresh audit finding (cross-tenant IDOR): employee_ids was never
    // checked against tenant — unlike leave_type_id just above — before
    // being used to insert auto-approved leave_requests + attendance_daily
    // rows. A caller could pass a UUID belonging to another tenant's
    // employee and create auto-approved leave for it under this tenant.
    const uniqueEmpIds = [...new Set(employee_ids)]
    const { data: validEmps } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .in('id', uniqueEmpIds)
    if ((validEmps?.length ?? 0) !== uniqueEmpIds.length) {
      return validationError(reply, 'INVALID_EMPLOYEES', 'One or more employees were not found in your organisation')
    }

    const dates = expandDateRange(from_date, to_date)
    const now   = new Date().toISOString()

    // Create auto-approved leave on the canonical leave_requests table.
    // computed_days / requested_by are NOT NULL there; APPROVED requires
    // approved_by + approved_at (lr_approved_fields CHECK).
    const appRows = employee_ids.map((emp_id) => ({
      tenant_id:     req.tenantId,
      employee_id:   emp_id,
      leave_type_id,
      from_date,
      to_date,
      computed_days: dates.length,
      reason:        reason ?? null,
      status:        'APPROVED',
      requested_by:  req.userId,
      approved_by:   req.userId,
      approved_at:   now,
    }))
    const { data: insertedApps, error: appErr } = await fastify.supabase
      .from('leave_requests').insert(appRows).select('id, employee_id')
    if (appErr) {
      return serverError(req, reply, appErr, ErrorCode.INSERT_FAILED, 'Failed to create leave requests')
    }
    // employee → application id, for keying idempotent consumption ledger rows.
    const appIdByEmp = new Map<string, string>(
      ((insertedApps ?? []) as Array<{ id: string; employee_id: string }>).map(a => [a.employee_id, a.id]),
    )

    // Build attendance_daily rows PER EMPLOYEE on their roster WORKING dates only
    // (holidays/weekly-offs inside the span stay paid rest days — never converted to
    // LOP), stamp computed_source='leave_approval' so an engine recompute won't revert,
    // and deduct leave balance for paid leave. (Was: raw calendar expansion, no balance,
    // no source flag — turned rest days into LOP and skipped balance.)
    const dailyRows: Array<Record<string, unknown>> = []
    await runConcurrent(employee_ids, async (emp_id) => {
      let workingDates: string[] = dates
      try {
        const wd = await computeWorkingLeaveDays(fastify.supabase, req.tenantId, emp_id, from_date, to_date)
        workingDates = (wd.counted_dates && wd.counted_dates.length > 0) ? wd.counted_dates : dates
        if (lt.is_paid && wd.computed_days > 0) {
          const year = new Date(from_date).getFullYear()
          // C6-P1: atomic deduction via checked_deduct_leave_balance (no silent clamp).
          // For bulk-assign the deduction is best-effort — the admin has already
          // approved the span; a balance shortfall is logged for manual remediation
          // rather than rolling back the whole batch.
          const { data: deducted, error: deductErr } = await fastify.supabase.rpc('checked_deduct_leave_balance', {
            p_tenant_id: req.tenantId, p_employee_id: emp_id, p_leave_type_id: leave_type_id,
            p_days: wd.computed_days, p_year: year,
          })
          if (deductErr) {
            req.log.warn({ err: deductErr, emp_id }, 'bulk-assign checked_deduct_leave_balance failed — leave committed without deduction')
          } else if (!deducted) {
            req.log.warn({ emp_id, days: wd.computed_days }, 'bulk-assign insufficient balance — leave committed, balance unchanged')
          } else {
            // Deduction succeeded — write ledger row to keep authoritative store in sync.
            const appId = appIdByEmp.get(emp_id)
            if (appId) {
              const { error: ledgerErr } = await fastify.supabase
                .from('leave_accrual_ledger')
                .upsert({
                  tenant_id: req.tenantId, employee_id: emp_id, leave_type_id, year,
                  accrual_type: 'consumption', days: -Math.abs(wd.computed_days),
                  accrued_on: from_date, is_expired: false,
                  notes: `Leave consumed ${from_date}…${to_date} (bulk)`, source_request_id: appId,
                }, { onConflict: 'tenant_id,accrual_type,source_request_id', ignoreDuplicates: true })
              if (ledgerErr) req.log.warn({ err: ledgerErr, emp_id }, 'bulk-assign consumption ledger write failed — balance deducted')
            }
          }
        }
      } catch (e) {
        req.log.warn({ err: e, emp_id }, 'bulk-assign working-day resolution failed — using full span')
      }
      for (const d of workingDates) {
        const resolved = resolveLeaveDayFraction({ session: 'full_day', isPaid: lt.is_paid })
        dailyRows.push({
          tenant_id: req.tenantId, employee_id: emp_id, date: d,
          status: resolved.status, work_hours: 0, late_minutes: 0, overtime_minutes: 0,
          worked_on_weekly_off: false, worked_on_holiday: false,
          is_payable: resolved.is_payable, day_fraction: resolved.day_fraction,
          computed_source: 'leave_approval',
        })
      }
    })
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

    // Audit log — bulk leave assignment by HR admin on behalf of multiple employees
    await logBulkAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_requests',
      action:      'INSERT',
      performedBy: req.userId,
      // onBehalfOf not set for bulk — multiple targets captured in summary.employee_ids
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

    const isAdmin  = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
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
        return forbidden(reply, 'FORBIDDEN', 'You may only view your own ledger')
      }
    }

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return notFound(reply, 'NOT_FOUND', 'Employee not found')

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

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch ledger')

    return reply.send({
      data:   data ?? [],
      total:  count ?? 0,
      limit,
      offset,
    })
  })

  // ── GET /attendance/leave/ledger-reconciliation ──────────────────────────────
  // C6 verification tool. Read-only comparison of the cached employee_leave_balance
  // against the authoritative ledger sum (Σ non-expired days) per
  // (employee, leave_type, year). Surfaces any drift so the ledger read-cutover
  // can be made with confidence. Scoped to one year (default: current).
  fastify.get('/attendance/leave/ledger-reconciliation', hrAdminAuth, async (req: any, reply) => {
    const year = Number((req.query as any)?.year) || new Date().getFullYear()

    // fetchAllRows() on both (not plain queries) — fresh audit finding: this
    // is the tool HR uses to verify cache↔ledger drift before the
    // ledger-as-authority cutover; a >1,000-row tenant (employee × leave-type
    // combinations, easily exceeded at enterprise scale) would otherwise
    // silently under-report discrepancies past PostgREST's max-rows ceiling,
    // giving false confidence that the ledger and cache are in sync.
    let balances: any[], ledger: any[]
    try {
      ;[balances, ledger] = await Promise.all([
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('employee_leave_balance')
            .select('employee_id, leave_type_id, balance')
            .eq('tenant_id', req.tenantId)
            .eq('year', year)
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('leave_accrual_ledger')
            .select('employee_id, leave_type_id, days')
            .eq('tenant_id', req.tenantId)
            .eq('year', year)
            .eq('is_expired', false)
            .range(from, to),
        ),
      ])
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch ledger reconciliation data')
    }

    // Σ ledger days per (employee, leave_type).
    const ledgerSum = new Map<string, number>()
    for (const r of (ledger ?? []) as Array<{ employee_id: string; leave_type_id: string; days: number }>) {
      const k = `${r.employee_id}:${r.leave_type_id}`
      ledgerSum.set(k, (ledgerSum.get(k) ?? 0) + Number(r.days))
    }

    const seen = new Set<string>()
    const discrepancies: Array<Record<string, unknown>> = []
    for (const b of (balances ?? []) as Array<{ employee_id: string; leave_type_id: string; balance: number }>) {
      const k = `${b.employee_id}:${b.leave_type_id}`
      seen.add(k)
      const led = ledgerSum.get(k) ?? 0
      const cache = Number(b.balance)
      if (Math.abs(led - cache) > 0.01) {
        discrepancies.push({ employee_id: b.employee_id, leave_type_id: b.leave_type_id, cache_balance: cache, ledger_balance: led, delta: Math.round((led - cache) * 100) / 100 })
      }
    }
    // Ledger keys with no cache row (ledger says non-zero, cache missing).
    for (const [k, led] of ledgerSum) {
      if (!seen.has(k) && Math.abs(led) > 0.01) {
        const [employee_id, leave_type_id] = k.split(':')
        discrepancies.push({ employee_id, leave_type_id, cache_balance: null, ledger_balance: led, delta: Math.round(led * 100) / 100 })
      }
    }

    return reply.send({
      year,
      checked:       (balances ?? []).length,
      discrepancies: discrepancies.length,
      in_sync:       discrepancies.length === 0,
      rows:          discrepancies,
    })
  })
}
