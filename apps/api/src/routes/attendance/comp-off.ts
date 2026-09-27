/**
 * Comp Off (Compensatory Off) Routes
 *
 * Automates the compensatory-off lifecycle:
 *   1. Detect: scan attendance_daily for worked_on_weekly_off / worked_on_holiday
 *      and create pending CO requests for each qualifying date.
 *   2. Approve: credit leave balance via leave_accrual_ledger with expiry.
 *   3. Reject: mark request as rejected; no balance change.
 *
 * Endpoints:
 *   POST /attendance/comp-off/generate
 *       Detect qualifying dates for one employee (or all employees) and create
 *       pending comp_off_requests rows.  Idempotent — existing rows are skipped.
 *
 *   GET  /attendance/comp-off
 *       List comp_off_requests.  Employees see their own; HR sees all.
 *       Supports ?status=pending|approved|rejected filter.
 *
 *   POST /attendance/comp-off/:id/approve
 *       HR/manager approves a request.  Credits days_to_credit to the employee's
 *       leave_accrual_ledger with an expiry date derived from the CO leave type's
 *       expiry_days rule (falls back to 90 days).
 *
 *   POST /attendance/comp-off/:id/reject
 *       HR/manager rejects a request with optional notes.
 *
 * Access:
 *   read  — any authenticated user (employees see own, admins see all)
 *   write — hr_admin / super_admin / manager
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { logAction }            from '../../lib/audit-service.js'
import { generateCompOffRequests } from '../../lib/comp-off-service.js'
import { resolveWoEmployees } from '../../lib/wo-credit-reconciler.js'
import {
  isHrAdmin, resolveCallerEmployeeId, getDirectReportIds, isDirectReport,
} from '../../lib/manager-scope.js'
import { assertRangeOpen, isMonthLocked, monthOf, PeriodLockedError } from '../../lib/period-lock.js'
import { isSelfApproval } from '../../lib/approval-guards.js'
import { gateApprove, gateReject } from '../../lib/approval-orchestrator.js'
import { MANAGER_ROLES } from '../../lib/rbac.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'
import { conflictError, serverError, ErrorCode } from '../../lib/api-errors.js'

const generateSchema = z.object({
  employee_id:   z.string().uuid().optional(),   // omit = all active employees
  from_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leave_type_id: z.string().uuid().optional(),   // the "Comp Off" leave type UUID
})

const approveSchema = z.object({
  notes: z.string().max(500).optional(),
})
const rejectSchema = z.object({
  notes: z.string().min(1, 'Rejection reason is required').max(500),
})

export default async function compOffRoute(fastify: FastifyInstance) {
  const auth       = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!MANAGER_ROLES.includes(req.userRole)) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin access required' })
        }
      },
    ],
  }

  /**
   * P6.0c — ownership guard. HR admins may action any comp-off request; a manager
   * may only action requests belonging to their own direct reports. Returns true
   * when authorised, otherwise sends the response and returns false.
   */
  async function authorizeCompOffTarget(req: any, reply: any, coRequestId: string): Promise<boolean> {
    if (isHrAdmin(req.userRole)) return true
    const { data: co } = await fastify.supabase
      .from('comp_off_requests')
      .select('employee_id')
      .eq('id', coRequestId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!co) {
      reply.code(404).send({ error: 'NOT_FOUND', message: 'Comp off request not found' })
      return false
    }
    const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    if (!myEmpId || !(await isDirectReport(fastify.supabase, req.tenantId, myEmpId, (co as any).employee_id))) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only action comp-off for your direct reports' })
      return false
    }
    return true
  }

  // ── POST /attendance/comp-off/generate ──────────────────────────────────
  // Scan attendance_daily for work-on-holiday / work-on-weekly-off and create
  // comp_off_requests rows.  Existing rows (same employee + worked_date) are
  // skipped due to the UNIQUE constraint — safe to call repeatedly.
  fastify.post('/attendance/comp-off/generate', hrAdminAuth, async (req: any, reply) => {
    const parsed = generateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, from_date, to_date, leave_type_id } = parsed.data

    // leave_type_id is a client-supplied UUID with no other tenant-scoping —
    // verify it belongs to this tenant before it gets written into
    // comp_off_requests and later into leave_accrual_ledger on approval,
    // since the leave_types FK itself carries no tenant check.
    if (leave_type_id) {
      const { data: lt, error: ltErr } = await fastify.supabase
        .from('leave_types')
        .select('id')
        .eq('id', leave_type_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (ltErr) return serverError(req, reply, ltErr, ErrorCode.QUERY_FAILED, 'Failed to verify leave type')
      if (!lt) return reply.code(404).send({ error: 'LEAVE_TYPE_NOT_FOUND', message: 'Leave type not found' })
    }

    // Period protection — don't mint comp-off for a month locked for payroll.
    try {
      await assertRangeOpen(fastify.supabase, req.tenantId, from_date, to_date)
    } catch (err) {
      if (err instanceof PeriodLockedError) {
        return reply.code(409).send({ error: 'PERIOD_LOCKED', message: err.message })
      }
      throw err
    }

    // Fetch qualifying attendance_daily rows
    let query = fastify.supabase
      .from('attendance_daily')
      .select('employee_id, date, worked_on_weekly_off, worked_on_holiday')
      .eq('tenant_id', req.tenantId)
      .gte('date', from_date)
      .lte('date', to_date)
      .or('worked_on_weekly_off.eq.true,worked_on_holiday.eq.true')

    if (employee_id) {
      query = query.eq('employee_id', employee_id)
    }

    const { data: qualifyingRaw, error: fetchErr } = await query
    if (fetchErr) {
      return serverError(req, reply, fetchErr, ErrorCode.QUERY_FAILED, 'Failed to fetch qualifying comp-off days')
    }

    // Mutual exclusivity: employees on a WO-credit roster do NOT earn comp-off —
    // their off accounting is owned entirely by the WO-credit reconciler.
    let woEmpIds: Set<string>
    try {
      woEmpIds = new Set((await resolveWoEmployees(fastify.supabase, req.tenantId)).map(e => e.employeeId))
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to resolve weekly-off employees')
    }
    const qualifying = (qualifyingRaw ?? []).filter((r: any) => !woEmpIds.has(r.employee_id))

    if (!qualifying.length) {
      return reply.send({ data: { created: 0, skipped: 0, message: 'No qualifying attendance records found' } })
    }

    // Delegate to the shared generator (same logic the recompute pipeline uses).
    let created = 0, skipped = 0
    try {
      const result = await generateCompOffRequests(
        fastify.supabase,
        req.tenantId,
        qualifying as Array<{ employee_id: string; date: string; worked_on_weekly_off: boolean; worked_on_holiday: boolean }>,
        req.userId,
        leave_type_id ?? null,
      )
      created = result.created
      skipped = result.skipped
    } catch (e: unknown) {
      return serverError(req, reply, e, ErrorCode.INSERT_FAILED, 'Failed to generate comp-off requests')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'comp_off_requests',
      recordId:    req.tenantId,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { created, skipped, from_date, to_date, employee_id: employee_id ?? 'all' },
    })

    return reply.code(201).send({ data: { created, skipped } })
  })

  // ── GET /attendance/comp-off ─────────────────────────────────────────────
  fastify.get('/attendance/comp-off', auth, async (req: any, reply) => {
    const statusFilter = (req.query as any).status as string | undefined

    let q = fastify.supabase
      .from('comp_off_requests')
      .select(`
        id, worked_date, worked_reason, days_to_credit, status, notes,
        created_at, reviewed_at,
        leave_types(id, name),
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .order('worked_date', { ascending: false })

    if (isHrAdmin(req.userRole)) {
      // HR admin sees the whole tenant
    } else if (req.userRole === 'manager') {
      // P6.0c — managers see only their direct reports' requests
      const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!myEmpId) return reply.send({ data: [] })
      const reportIds = await getDirectReportIds(fastify.supabase, req.tenantId, myEmpId)
      if (!reportIds.length) return reply.send({ data: [] })
      q = q.in('employee_id', reportIds)
    } else {
      // Employees see only their own requests
      const empId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!empId) return reply.send({ data: [] })
      q = q.eq('employee_id', empId)
    }

    if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
      q = q.eq('status', statusFilter)
    }

    const { data, error } = await q
    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch comp-off requests')
    }

    const rows = ((data ?? []) as any[]).map(row => ({
      id:              row.id,
      worked_date:     row.worked_date,
      worked_reason:   row.worked_reason,
      days_to_credit:  row.days_to_credit,
      status:          row.status,
      notes:           row.notes,
      created_at:      row.created_at,
      reviewed_at:     row.reviewed_at,
      leave_type:      row.leave_types ?? null,
      employee: row.employees ? {
        id:            row.employees.id,
        name:          `${row.employees.first_name} ${row.employees.last_name}`,
        employee_code: row.employees.employee_code,
      } : null,
    }))

    return reply.send({ data: rows })
  })

  // ── POST /attendance/comp-off/:id/approve ────────────────────────────────
  fastify.post('/attendance/comp-off/:id/approve', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    if (!await authorizeCompOffTarget(req, reply, id)) return

    const parsed = approveSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'comp-off-approve')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    // Fetch the CO request
    const { data: co, error: fetchErr } = await fastify.supabase
      .from('comp_off_requests')
      .select('id, employee_id, leave_type_id, worked_date, days_to_credit, status, tenant_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr || !co) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Comp off request not found' })
    }
    if ((co as any).status !== 'pending') {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: `Request is already ${(co as any).status}`,
      })
    }

    // A request with no leave_type_id cannot be credited — the balance-credit
    // block below is itself gated on `co.leave_type_id`, so approving one
    // silently marked the request 'approved' with `days_credited` in the
    // response while writing no ledger row and crediting nothing at all: a
    // false-positive success with no warning to HR (found via live UAT — see
    // docs/UAT_LIVE_AUDIT.md UAT-033). This is the common case, not an edge
    // case: generateCompOffRequests() is called from the automatic attendance
    // recompute pipeline (attendance-engine.ts) without a leave_type_id — only
    // the manual POST /attendance/comp-off/generate flow supplies one. Refuse
    // outright rather than silently approve-with-no-credit; HR must first
    // regenerate/assign a leave type for this request (e.g. via the manual
    // generate flow) before it can be approved.
    if (!(co as any).leave_type_id) {
      return reply.code(409).send({
        error:   'NO_LEAVE_TYPE_CONFIGURED',
        message: 'This comp-off request has no leave type to credit — it cannot be approved as-is. Regenerate it via a leave-type-specific comp-off generation before approving.',
      })
    }

    // Multi-level gate (engages only when a comp-off chain is configured). An
    // intermediate approval advances a level and returns without crediting balance.
    try {
      const gate = await gateApprove(fastify.supabase, {
        tenantId: req.tenantId, entityType: 'comp_off_request', entityId: id,
        actorId: req.userId, actorRole: req.userRole, targetEmployeeId: (co as any).employee_id,
      })
      if (gate.kind === 'error') {
        const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
        return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
      }
      if (gate.kind === 'advanced') {
        await logAction(fastify.supabase, {
          tenantId: req.tenantId, tableName: 'comp_off_requests', recordId: id,
          action: 'UPDATE', performedBy: req.userId,
          newData: { status: 'pending', approval_level: gate.nextLevel, total_levels: gate.totalLevels },
        })
        const responseBody = { data: { id, status: 'pending', advanced_to_level: gate.nextLevel, total_levels: gate.totalLevels } }
        if (iKey) {
          await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'comp-off-approve', 200, responseBody)
        }
        return reply.send(responseBody)
      }
      // gate.kind === 'finalize' → fall through to the credit logic below.
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to process comp-off approval')
    }

    // Segregation of duties — a user may not approve their own comp-off (F3).
    if (await isSelfApproval(fastify.supabase, req.tenantId, req.userId, (co as any).employee_id)) {
      return reply.code(403).send({
        error:   'SELF_APPROVAL_FORBIDDEN',
        message: 'You cannot approve your own comp-off request.',
      })
    }

    // Period protection — the worked day that earns this credit must not sit in
    // a locked/finalized month.
    if (await isMonthLocked(fastify.supabase, req.tenantId, monthOf((co as any).worked_date))) {
      return reply.code(409).send({
        error:   'PERIOD_LOCKED',
        message: `Attendance period ${monthOf((co as any).worked_date)} is locked for payroll — no changes allowed.`,
      })
    }

    const now = new Date().toISOString()

    // ── Determine expiry date ────────────────────────────────────────────
    // Prefer expiry_days from the linked leave_policy_rules for the CO leave type.
    // Fall back to the legacy leave_policies table, then to 90 days.
    let expiryDays = 90
    if ((co as any).leave_type_id) {
      const { data: rule } = await fastify.supabase
        .from('leave_policy_rules')
        .select('expiry_days')
        .eq('tenant_id', req.tenantId)
        .eq('leave_type_id', (co as any).leave_type_id)
        .not('expiry_days', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!(rule as any)?.expiry_days) {
        // Try legacy leave_policies
        const { data: legacyRule } = await fastify.supabase
          .from('leave_policies')
          .select('expiry_days')
          .eq('tenant_id', req.tenantId)
          .eq('leave_type_id', (co as any).leave_type_id)
          .maybeSingle()
        if ((legacyRule as any)?.expiry_days) {
          expiryDays = Number((legacyRule as any).expiry_days)
        }
      } else {
        expiryDays = Number((rule as any).expiry_days)
      }
    }

    const expiresOn = new Date(`${(co as any).worked_date}T12:00:00.000Z`)
    expiresOn.setUTCDate(expiresOn.getUTCDate() + expiryDays)
    const expiresOnStr = expiresOn.toISOString().slice(0, 10)

    // ── Atomically claim the approval FIRST (SYSCERT_AUDIT_2026-08-02.md H6) ──
    // Previously the balance credit (ledger upsert + credit_leave_balance RPC)
    // ran BEFORE this claim, decoupled from it. Under a genuine two-request
    // race, the ledger upsert (keyed on source_request_id, ignoreDuplicates)
    // and this status UPDATE...WHERE status='pending' are two INDEPENDENT
    // compare-and-swap operations that can pick DIFFERENT winners: the
    // request that won the ledger race (and credited the balance) could lose
    // the status race and roll its own credit back, while the request that
    // won the status race (and got marked 'approved') could have lost the
    // ledger race and therefore never called credit_leave_balance at all.
    // Net result: status 'approved', balance credited zero. Claiming status
    // first makes this request the single, unambiguous approver before any
    // balance side effect is attempted — the loser is rejected here with no
    // side effects at all, so there is nothing left to roll back.
    const { data: claimedRows, error: claimErr } = await fastify.supabase
      .from('comp_off_requests')
      .update({
        status:      'approved',
        reviewed_by: req.userId,
        reviewed_at: now,
        notes:       parsed.data.notes ?? null,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')

    if (claimErr) {
      return serverError(req, reply, claimErr, ErrorCode.UPDATE_FAILED, 'Failed to approve comp-off request')
    }
    if (!claimedRows?.length) {
      return conflictError(reply, 'ALREADY_ACTIONED', 'This request was already actioned by another request')
    }

    // ── Credit balance via leave_accrual_ledger ──────────────────────────
    // This request is now the confirmed sole approver of this comp-off
    // request — safe to credit without racing anyone else for it.
    if ((co as any).leave_type_id) {
      const creditYear = new Date((co as any).worked_date + 'T12:00:00Z').getFullYear()

      // source_request_id uniquely identifies this CO grant
      // (uidx_accrual_ledger_co_request, migration 264) — the ignoreDuplicates
      // upsert now only guards against a retry of THIS SAME winning request
      // (e.g. a network retry), not against a second concurrent approver
      // (that case is already excluded by the claim above).
      const { data: inserted, error: ledgerErr } = await fastify.supabase
        .from('leave_accrual_ledger')
        .upsert(
          {
            tenant_id:         req.tenantId,
            employee_id:       (co as any).employee_id,
            leave_type_id:     (co as any).leave_type_id,
            accrual_type:      'co_grant',
            days:              Number((co as any).days_to_credit),
            year:              creditYear,
            accrued_on:        (co as any).worked_date,
            expires_on:        expiresOnStr,
            is_expired:        false,
            notes:             `CO for work on ${(co as any).worked_date}`,
            source_request_id: (co as any).id,
          },
          {
            onConflict:       'tenant_id,accrual_type,source_request_id,year',
            ignoreDuplicates: true,
          },
        )
        .select('id')

      if (ledgerErr) {
        // Nothing was credited yet — revert the claim so the request goes
        // back to 'pending' and can be retried, instead of being stuck
        // 'approved' with no balance and no audit trail.
        await fastify.supabase
          .from('comp_off_requests')
          .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
          .eq('id', id)
          .eq('tenant_id', req.tenantId)
          .eq('status', 'approved')
        return serverError(req, reply, ledgerErr, ErrorCode.INSERT_FAILED, 'Failed to credit leave balance')
      }

      // Mirror into the cached balance only when a new ledger row was written.
      if ((inserted?.length ?? 0) > 0) {
        const { error: cacheErr } = await fastify.supabase.rpc('credit_leave_balance', {
          p_tenant_id:     req.tenantId,
          p_employee_id:   (co as any).employee_id,
          p_leave_type_id: (co as any).leave_type_id,
          p_days:          Number((co as any).days_to_credit),
          p_year:          creditYear,
        })
        // The ledger row (audit trail + source of truth) is already committed
        // at this point, so the approval stands — a failed cache mirror is a
        // reconciliation issue, not a reason to fail the whole approval.
        if (cacheErr) req.log.error({ err: cacheErr, id }, 'comp-off: credit_leave_balance RPC failed — balance needs manual reconciliation')
      }
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'comp_off_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      oldData:     { status: 'pending' },
      newData:     { status: 'approved', expires_on: expiresOnStr, days: (co as any).days_to_credit },
    })

    const responseBody = {
      data: {
        id,
        status:      'approved',
        expires_on:  expiresOnStr,
        days_credited: Number((co as any).days_to_credit),
      },
    }
    if (iKey) {
      await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'comp-off-approve', 200, responseBody)
    }
    return reply.send(responseBody)
  })

  // ── POST /attendance/comp-off/:id/reject ─────────────────────────────────
  fastify.post('/attendance/comp-off/:id/reject', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    if (!await authorizeCompOffTarget(req, reply, id)) return

    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'comp-off-reject')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    const { data: co } = await fastify.supabase
      .from('comp_off_requests')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!co) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Comp off request not found' })
    }
    if ((co as any).status !== 'pending') {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: `Request is already ${(co as any).status}`,
      })
    }

    // Multi-level gate — reject always finalizes but records + closes the instance
    // when a comp-off chain exists.
    try {
      const gate = await gateReject(fastify.supabase, {
        tenantId: req.tenantId, entityType: 'comp_off_request', entityId: id,
        actorId: req.userId, actorRole: req.userRole, targetEmployeeId: (co as any).employee_id,
        comments: parsed.data.notes,
      })
      if (gate.kind === 'error') {
        const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
        return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
      }
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to process comp-off rejection')
    }

    const now = new Date().toISOString()

    // .eq('status','pending') + row-count check (fresh audit finding, same
    // race class as the approve handler above): without this, a concurrent
    // approve+reject race could let reject silently overwrite an already-
    // approved (and already balance-credited) request.
    const { data: updatedRows, error: updateErr } = await fastify.supabase
      .from('comp_off_requests')
      .update({
        status:      'rejected',
        reviewed_by: req.userId,
        reviewed_at: now,
        notes:       parsed.data.notes ?? null,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')

    if (updateErr) {
      return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to reject comp-off request')
    }

    if (!updatedRows?.length) {
      return conflictError(reply, 'ALREADY_ACTIONED', 'This request was already actioned by another request')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'comp_off_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      oldData:     { status: 'pending' },
      newData:     { status: 'rejected' },
    })

    const responseBody = { data: { id, status: 'rejected' } }
    if (iKey) {
      await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'comp-off-reject', 200, responseBody)
    }
    return reply.code(200).send(responseBody)
  })
}
