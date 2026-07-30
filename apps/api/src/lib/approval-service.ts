/**
 * ApprovalService — central handler for all approval/rejection workflows.
 *
 * Architecture (after hardening):
 *
 *  Step 1 — Transaction atomicity
 *    Critical mutations (status UPDATE + balance deduction) are delegated to
 *    PostgreSQL stored procedures via Supabase RPC so they execute inside a
 *    single DB transaction with a pessimistic FOR UPDATE row-lock.
 *    Non-transactional steps (attendance_daily upsert, audit, notification)
 *    run after the transaction commits; each is idempotent or non-fatal.
 *
 *  Step 2 — Status guard (double-checked)
 *    The app layer pre-checks status before calling the RPC (fast 404/409
 *    without touching the lock).  The RPC re-checks under the FOR UPDATE lock
 *    so concurrent approval races are serialised at the DB level.
 *    CONFLICT exceptions from the DB are parsed and surfaced as structured
 *    { type: 'CONFLICT', message } errors — never raw DB errors.
 *
 *  Step 3 — Event emission
 *    After each successful DB transaction, eventService.emit() fires the
 *    corresponding event (leave.approved, leave.rejected, etc.).
 *    emit() is synchronous and fire-and-forget — handlers run as microtasks;
 *    an error in any handler never rolls back the approval or delays the
 *    HTTP response.
 *
 * Error contract: all exported functions return { ok, value | error } — no throws.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateBalance, expandDateRange }     from './leave-engine.js'
import { logAction }                            from './audit-service.js'
import { eventService }                         from './event-service.js'
import { eventBus }                             from './event-bus.js'
import { getLeaveRequest }                      from './leave-request-service.js'
import { recomputeRange }                       from './attendance-engine.js'
import { isSelfApproval }                       from './approval-guards.js'
import { gateApprove, gateReject }              from './approval-orchestrator.js'

// ── Shared types ───────────────────────────────────────────────────────────────

export type ApprovalError =
  | { type: 'NOT_FOUND';            message: string }
  | { type: 'FORBIDDEN';            message: string }
  | { type: 'CONFLICT';             message: string }
  | { type: 'INSUFFICIENT_BALANCE'; message: string; currentBalance: number }
  | { type: 'DB_ERROR';             message: string }

export type ApprovalResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: ApprovalError }

// ── RPC error parser ───────────────────────────────────────────────────────────

/**
 * Postgres RAISE EXCEPTION messages from migration 042 are prefixed with
 * 'NOT_FOUND: ' or 'CONFLICT: '.  Parse these into structured errors.
 * Anything else becomes DB_ERROR.
 */
function parseRpcError(rpcError: { message?: string }): ApprovalError {
  const msg = rpcError.message ?? ''
  if (msg.includes('NOT_FOUND:')) {
    return { type: 'NOT_FOUND', message: msg.replace(/^.*NOT_FOUND:\s*/, '') }
  }
  if (msg.includes('CONFLICT:')) {
    return { type: 'CONFLICT', message: msg.replace(/^.*CONFLICT:\s*/, '') }
  }
  if (msg.includes('INSUFFICIENT_BALANCE:')) {
    // The RPC raises this when the strict deduct matches no row (balance < days
    // or no balance row). The live balance isn't carried on the exception.
    return { type: 'INSUFFICIENT_BALANCE', message: msg.replace(/^.*INSUFFICIENT_BALANCE:\s*/, ''), currentBalance: 0 }
  }
  return { type: 'DB_ERROR', message: 'Transaction failed' }
}

// ── Approver validation ────────────────────────────────────────────────────────

interface ApproverContext {
  approverId:   string    // profiles.id of the person taking action
  approverRole: string    // req.userRole
  tenantId:     string
}

/**
 * Determine whether the caller may approve/reject a request owned by employeeId.
 *
 * Authorised if:
 *   a) role is super_admin or hr_admin, OR
 *   b) approver's own employee record is the direct manager of the target
 *      (employees.manager_id === approverEmployeeId).
 */
async function validateApprover(
  supabase:   SupabaseClient,
  ctx:        ApproverContext,
  employeeId: string,
): Promise<ApprovalResult<true>> {
  const { approverId, approverRole, tenantId } = ctx

  if (['super_admin', 'hr_admin'].includes(approverRole)) {
    return { ok: true, value: true }
  }

  const { data: approverProfile } = await supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', approverId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const approverEmployeeId = (approverProfile as { employee_id: string | null } | null)?.employee_id

  if (!approverEmployeeId) {
    return {
      ok:    false,
      error: { type: 'FORBIDDEN', message: 'Approver has no linked employee record' },
    }
  }

  const { data: targetEmp } = await supabase
    .from('employees')
    .select('manager_id')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const targetManagerId = (targetEmp as { manager_id: string | null } | null)?.manager_id

  if (targetManagerId !== approverEmployeeId) {
    return {
      ok:    false,
      error: {
        type:    'FORBIDDEN',
        message: "Only the employee's direct manager or an HR admin may approve this request",
      },
    }
  }

  return { ok: true, value: true }
}

// ── Leave Request approval ─────────────────────────────────────────────────────

export interface LeaveApprovalOpts {
  tenantId:  string
  requestId: string
  ctx:       ApproverContext
}

/**
 * Approve a PENDING leave request.
 *
 * App layer:
 *   1. Fetch the row (NOT_FOUND guard).
 *   2. Status pre-check → CONFLICT (fast path, no lock needed).
 *   3. Authorise the approver → FORBIDDEN.
 *   4. Balance validation for paid leaves → INSUFFICIENT_BALANCE.
 *
 * DB transaction (RPC approve_leave_request_atomic):
 *   5. FOR UPDATE lock → re-validate status → UPDATE APPROVED → deduct balance.
 *
 * Post-transaction (idempotent / non-fatal):
 *   6. Upsert attendance_daily rows.
 *   7. Audit log.
 *   8. Notification.
 */
export async function approveLeaveRequest(
  supabase: SupabaseClient,
  opts:     LeaveApprovalOpts,
): Promise<ApprovalResult<{ id: string; status: string }>> {
  const { tenantId, requestId, ctx } = opts

  // ── 1. Fetch ────────────────────────────────────────────────────────────────
  const fetchResult = await getLeaveRequest(supabase, tenantId, requestId)
  if (!fetchResult.ok) {
    return { ok: false, error: { type: 'NOT_FOUND', message: fetchResult.error.message } }
  }
  const req = fetchResult.value

  // ── 2. Status pre-check (Step 2) ────────────────────────────────────────────
  if (req.status !== 'PENDING') {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: `Request is already ${req.status}` },
    }
  }

  // ── 3. Multi-level gate (engages only when a chain is configured) ────────────
  // With no chain, this returns { finalize, authorized:false } and we fall through
  // to the legacy validateApprover + atomic finalize — identical to before.
  const gate = await gateApprove(supabase, {
    tenantId,
    entityType:       'leave_request',
    entityId:         requestId,
    actorId:          ctx.approverId,
    actorRole:        ctx.approverRole,
    targetEmployeeId: req.employee_id,
  })
  if (gate.kind === 'error') {
    return { ok: false, error: { type: gate.error.type, message: gate.error.message } }
  }
  if (gate.kind === 'advanced') {
    // Intermediate approval recorded in approval_actions; the request stays PENDING
    // for the next level. No balance is deducted until the final approval.
    await logAction(supabase, {
      tenantId,
      tableName:   'leave_requests',
      recordId:    requestId,
      action:      'UPDATE',
      performedBy: ctx.approverId,
      oldData:     { status: 'PENDING', approval_level: gate.level },
      newData:     { status: 'PENDING', approval_level: gate.nextLevel, total_levels: gate.totalLevels },
    })
    return { ok: true, value: { id: requestId, status: 'PENDING' } }
  }
  // gate.kind === 'finalize' — run the legacy approver check only when the per-level
  // gate did not already authorize this actor (i.e. the no-chain legacy path).
  if (!gate.authorized) {
    if (await isSelfApproval(supabase, tenantId, ctx.approverId, req.employee_id)) {
      return {
        ok:    false,
        error: { type: 'FORBIDDEN', message: 'You cannot approve your own leave request.' },
      }
    }
    const authResult = await validateApprover(supabase, ctx, req.employee_id)
    if (!authResult.ok) return authResult
  }

  // ── 4. Balance validation (paid leaves only) ─────────────────────────────────
  const lt = req.leave_types as { id: string; name: string; is_paid: boolean; allow_sandwich: boolean } | null
  if (lt?.is_paid) {
    const year  = new Date(req.from_date).getFullYear()
    const check = await validateBalance(
      supabase, tenantId, req.employee_id, req.leave_type_id, req.computed_days, year,
    )
    if (!check.valid) {
      return {
        ok:    false,
        error: {
          type:           'INSUFFICIENT_BALANCE',
          message:        check.message ?? 'Insufficient leave balance',
          currentBalance: check.currentBalance,
        },
      }
    }
  }

  // ── 5. Atomic DB transaction (RPC) ──────────────────────────────────────────
  const now  = new Date().toISOString()
  const year = new Date(req.from_date).getFullYear()

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'approve_leave_request_atomic',
    {
      p_tenant_id:     tenantId,
      p_request_id:    requestId,
      p_approver_id:   ctx.approverId,
      p_approved_at:   now,
      p_is_paid:       lt?.is_paid ?? false,
      p_employee_id:   req.employee_id,
      p_leave_type_id: req.leave_type_id,
      p_days:          req.computed_days,
      p_year:          year,
    },
  )

  if (rpcErr) {
    return { ok: false, error: parseRpcError(rpcErr) }
  }

  const approved = rpcData as { id: string; status: string }

  // ── 6. Recompute attendance via AttendanceEngine (idempotent) ───────────────
  // The engine reads the approved leave from leave_requests and sets status=LEAVE
  // for each date in the range.  Non-fatal — log on error so the approval itself
  // is not rolled back (the RPC already committed).
  try {
    await recomputeRange(supabase, {
      tenant_id:   tenantId,
      employee_id: req.employee_id,
      from_date:   req.from_date,
      to_date:     req.to_date,
      changed_by:  ctx.approverId,
    })
  } catch (engineErr: unknown) {
    // Log but do not fail — approval already committed in the RPC.
    // Write structured JSON to stderr so production log aggregation (Datadog / CloudWatch / Loki)
    // captures context fields.  approval-service is a lib module without access to a
    // request-scoped fastify logger, so we use process.stderr directly.
    const errMsg = engineErr instanceof Error ? engineErr.message : String(engineErr)
    process.stderr.write(JSON.stringify({
      level:            'error',
      time:             new Date().toISOString(),
      service:          'approval-service',
      fn:               'approveLeaveRequest',
      msg:              'attendance recompute failed after leave approval — leave is committed but attendance_daily may be stale for this period',
      tenant_id:        tenantId,
      employee_id:      req.employee_id,
      leave_request_id: requestId,
      from_date:        req.from_date,
      to_date:          req.to_date,
      err:              errMsg,
    }) + '\n')
  }

  // ── 7. Audit (non-fatal) ─────────────────────────────────────────────────────
  const isHrAdminApprove = ['super_admin', 'hr_admin'].includes(ctx.approverRole)
  await logAction(supabase, {
    tenantId,
    tableName:   'leave_requests',
    recordId:    requestId,
    action:      'UPDATE',
    performedBy: ctx.approverId,
    onBehalfOf:  isHrAdminApprove ? req.employee_id : null,
    oldData:     { status: 'PENDING' },
    newData:     { status: 'APPROVED', approved_by: ctx.approverId, approved_at: now },
  })

  // ── 8. Event emission (fire-and-forget — runs after DB transaction commits) ──
  eventService.emit('leave.approved', {
    tenant_id:     tenantId,
    employee_id:   req.employee_id,
    request_id:    requestId,
    type:          'leave',
    computed_days: req.computed_days,
    actor_id:      ctx.approverId,
    leave_type:    lt?.name,
    from_date:     req.from_date,
    to_date:       req.to_date,
  })

  // Also emit on the in-process eventBus (PEND-75) — this is the system that
  // actually drives tenant-configured webhook fan-out (WEBHOOK_EVENT_TYPES
  // includes 'leave.approved') and the SLA/balance-low automation in
  // event-bus-automation.ts. This route previously only published through
  // EventPublisher (→ platform_events, an admin observability sink with no
  // webhook/automation subscribers), so approvals made through this —
  // the actual UI-driven approval path — silently produced zero webhook
  // deliveries and zero SLA/balance escalation, unlike the other (unused by
  // the web UI) /attendance/leave/:id/approve route which already emits here.
  eventBus.emit({
    type:          'leave.approved',
    tenantId,
    correlationId: 'system',
    payload: {
      tenantId,
      employeeId:  req.employee_id,
      leaveId:     requestId,
      approverId:  ctx.approverId,
      leaveTypeId: req.leave_type_id,
      fromDate:    req.from_date,
      toDate:      req.to_date,
      days:        req.computed_days,
    },
  })

  return { ok: true, value: approved }
}

/**
 * Reverse an APPROVED leave request (cancel-after-approval).
 *
 * Restores the deducted balance and writes a credit-back ledger row, then clears
 * the leave-approval attendance rows so the engine reprocesses those dates. The
 * balance/ledger/status change is atomic (RPC reverse_leave_request_atomic);
 * attendance cleanup + recompute are post-transaction and non-fatal, mirroring
 * approveLeaveRequest.
 */
export async function reverseApprovedLeaveRequest(
  supabase: SupabaseClient,
  opts:     LeaveApprovalOpts,
): Promise<ApprovalResult<{ id: string; status: string }>> {
  const { tenantId, requestId, ctx } = opts

  // ── 1. Fetch ────────────────────────────────────────────────────────────────
  const fetchResult = await getLeaveRequest(supabase, tenantId, requestId)
  if (!fetchResult.ok) {
    return { ok: false, error: { type: 'NOT_FOUND', message: fetchResult.error.message } }
  }
  const req = fetchResult.value

  // ── 2. Status pre-check — only an APPROVED request can be reversed ────────────
  if (req.status !== 'APPROVED') {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: `Only an APPROVED request can be reversed (current: ${req.status})` },
    }
  }

  // ── 3. Authorise (same approver chain as approve) ────────────────────────────
  // Segregation of duties — an HR admin/manager who is also linked to an
  // employee record must not be able to reverse their OWN approved leave and
  // restore their own balance. Mirrors the same guard on approveLeaveRequest
  // above (fresh audit finding — this path had validateApprover's unconditional
  // super_admin/hr_admin authorization with no ownership check, unlike approve).
  if (await isSelfApproval(supabase, tenantId, ctx.approverId, req.employee_id)) {
    return {
      ok:    false,
      error: { type: 'FORBIDDEN', message: 'You cannot reverse your own leave approval.' },
    }
  }
  const authResult = await validateApprover(supabase, ctx, req.employee_id)
  if (!authResult.ok) return authResult

  const lt   = req.leave_types as { id: string; name: string; is_paid: boolean } | null
  const year = new Date(req.from_date).getFullYear()

  // ── 4. Atomic reversal (status + credit-back + ledger) ───────────────────────
  const { data: rpcData, error: rpcErr } = await supabase.rpc('reverse_leave_request_atomic', {
    p_tenant_id:     tenantId,
    p_request_id:    requestId,
    p_actor_id:      ctx.approverId,
    p_is_paid:       lt?.is_paid ?? false,
    p_employee_id:   req.employee_id,
    p_leave_type_id: req.leave_type_id,
    p_days:          req.computed_days,
    p_year:          year,
  })
  if (rpcErr) return { ok: false, error: parseRpcError(rpcErr) }
  const reversed = rpcData as { id: string; status: string }

  // ── 5. Reverse attendance (non-fatal) ────────────────────────────────────────
  // Delete the leave-approval rows then recompute so the engine reprocesses those
  // dates from punch data instead of leaving them stuck on status=LEAVE.
  try {
    await supabase
      .from('attendance_daily')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('employee_id', req.employee_id)
      .eq('computed_source', 'leave_approval')
      .gte('date', req.from_date)
      .lte('date', req.to_date)
    await recomputeRange(supabase, {
      tenant_id:   tenantId,
      employee_id: req.employee_id,
      from_date:   req.from_date,
      to_date:     req.to_date,
      changed_by:  ctx.approverId,
    })
  } catch (engineErr: unknown) {
    const errMsg = engineErr instanceof Error ? engineErr.message : String(engineErr)
    process.stderr.write(JSON.stringify({
      level: 'error', time: new Date().toISOString(), service: 'approval-service',
      fn: 'reverseApprovedLeaveRequest',
      msg: 'attendance recompute failed after leave reversal — reversal is committed but attendance_daily may be stale',
      tenant_id: tenantId, employee_id: req.employee_id, leave_request_id: requestId, err: errMsg,
    }) + '\n')
  }

  // ── 6. Audit (non-fatal) ─────────────────────────────────────────────────────
  await logAction(supabase, {
    tenantId,
    tableName:   'leave_requests',
    recordId:    requestId,
    action:      'UPDATE',
    performedBy: ctx.approverId,
    oldData:     { status: 'APPROVED' },
    newData:     { status: 'CANCELLED' },
  })

  // ── 7. Event emission (fire-and-forget) ──────────────────────────────────────
  eventService.emit('leave.cancelled', {
    tenant_id:   tenantId,
    employee_id: req.employee_id,
    request_id:  requestId,
    from_date:   req.from_date,
    to_date:     req.to_date,
    leave_type:  lt?.name,
  })

  return { ok: true, value: reversed }
}

/**
 * Reject a PENDING leave request.
 *
 * Steps:
 *   1. Fetch + pre-check + auth (same as approve, no balance step).
 *   2. Atomic RPC: FOR UPDATE → status guard → UPDATE REJECTED.
 *   3. Audit + notification.
 */
export async function rejectLeaveRequest(
  supabase: SupabaseClient,
  opts:     LeaveApprovalOpts & { rejectionReason?: string },
): Promise<ApprovalResult<{ id: string; status: string }>> {
  const { tenantId, requestId, ctx, rejectionReason } = opts

  // 1. Fetch + pre-check + auth
  const fetchResult = await getLeaveRequest(supabase, tenantId, requestId)
  if (!fetchResult.ok) {
    return { ok: false, error: { type: 'NOT_FOUND', message: fetchResult.error.message } }
  }
  const req = fetchResult.value

  // Status pre-check (Step 2)
  if (req.status !== 'PENDING') {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: `Request is already ${req.status}` },
    }
  }

  // Multi-level gate. Reject always finalizes (any level may reject → REJECTED),
  // but records the action + closes the instance when a chain exists.
  const gate = await gateReject(supabase, {
    tenantId,
    entityType:       'leave_request',
    entityId:         requestId,
    actorId:          ctx.approverId,
    actorRole:        ctx.approverRole,
    targetEmployeeId: req.employee_id,
    comments:         rejectionReason,
  })
  if (gate.kind === 'error') {
    return { ok: false, error: { type: gate.error.type, message: gate.error.message } }
  }
  if (gate.kind === 'finalize' && !gate.authorized) {
    const authResult = await validateApprover(supabase, ctx, req.employee_id)
    if (!authResult.ok) return authResult
  }

  // 2. Atomic RPC
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'reject_leave_request_atomic',
    {
      p_tenant_id:        tenantId,
      p_request_id:       requestId,
      p_rejection_reason: rejectionReason ?? null,
    },
  )

  if (rpcErr) {
    return { ok: false, error: parseRpcError(rpcErr) }
  }

  const rejected = rpcData as { id: string; status: string }

  // 3. Audit
  const isHrAdminReject = ['super_admin', 'hr_admin'].includes(ctx.approverRole)
  await logAction(supabase, {
    tenantId,
    tableName:   'leave_requests',
    recordId:    requestId,
    action:      'UPDATE',
    performedBy: ctx.approverId,
    onBehalfOf:  isHrAdminReject ? req.employee_id : null,
    oldData:     { status: 'PENDING' },
    newData:     { status: 'REJECTED', rejection_reason: rejectionReason ?? null },
  })

  // Event emission (fire-and-forget)
  const lt = req.leave_types as { name: string } | null
  eventService.emit('leave.rejected', {
    tenant_id:   tenantId,
    employee_id: req.employee_id,
    request_id:  requestId,
    type:        'leave',
    actor_id:    ctx.approverId,
    leave_type:  lt?.name,
    from_date:   req.from_date,
    to_date:     req.to_date,
  })

  return { ok: true, value: rejected }
}

// ── Regularisation approval ────────────────────────────────────────────────────

export interface RegularisationApprovalOpts {
  tenantId:         string
  regularisationId: string
  ctx:              ApproverContext
}

export interface ApprovedRegularisation {
  id:                  string
  status:              string
  employee_id:         string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
}

/**
 * Approve an attendance regularisation.
 *
 * Steps:
 *   1. Fetch + status pre-check + auth.
 *   2. Atomic RPC: FOR UPDATE → status guard → UPDATE approved.
 *   3. Audit + notification.
 *   (attendance recompute is the caller's responsibility — see regularisation.ts)
 */
export async function approveRegularisation(
  supabase: SupabaseClient,
  opts:     RegularisationApprovalOpts,
): Promise<ApprovalResult<ApprovedRegularisation>> {
  const { tenantId, regularisationId, ctx } = opts

  // 1. Fetch
  const { data: reg, error: fetchErr } = await supabase
    .from('attendance_regularisation')
    .select('id, status, employee_id, date, requested_check_in, requested_check_out')
    .eq('id', regularisationId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr || !reg) {
    return { ok: false, error: { type: 'NOT_FOUND', message: 'Regularisation request not found' } }
  }

  const regRow = reg as {
    id: string; status: string; employee_id: string; date: string;
    requested_check_in: string | null; requested_check_out: string | null
  }

  // Status pre-check (Step 2)
  if (regRow.status !== 'pending') {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: `Request is already ${regRow.status}` },
    }
  }

  // Period-lock recheck (ISSUE-144). Submission time already blocks new requests
  // once a period is locked (attendance/regularisation.ts POST handler), but a
  // request can sit pending for days — if HR locks the period (or payroll runs
  // and advances it to PAYROLL_PROCESSING/PAYROLL_FINALIZED) before this request
  // is approved, approving it here would still insert punch logs and recompute
  // attendance_daily for a period that's supposed to be closed, silently
  // invalidating figures HR already locked or a payroll run already used.
  const { data: periodLock } = await supabase
    .from('attendance_period_locks')
    .select('state')
    .eq('tenant_id', tenantId)
    .eq('period_month', regRow.date.slice(0, 7))
    .maybeSingle()

  if (periodLock && periodLock.state !== 'OPEN') {
    return {
      ok:    false,
      error: {
        type:    'CONFLICT',
        message: `Cannot approve — the pay period for ${regRow.date} is ${periodLock.state}. ` +
          'Reopen the period before approving this request.',
      },
    }
  }

  // Multi-level gate (engages only when a regularisation chain is configured).
  // No chain => { finalize, authorized:false } and we run the legacy self-approval
  // + validateApprover guards below, exactly as before.
  const gate = await gateApprove(supabase, {
    tenantId,
    entityType:       'attendance_regularisation',
    entityId:         regularisationId,
    actorId:          ctx.approverId,
    actorRole:        ctx.approverRole,
    targetEmployeeId: regRow.employee_id,
  })
  if (gate.kind === 'error') {
    return { ok: false, error: { type: gate.error.type, message: gate.error.message } }
  }
  if (gate.kind === 'advanced') {
    // Intermediate approval recorded; the request stays pending for the next level.
    await logAction(supabase, {
      tenantId,
      tableName:   'attendance_regularisation',
      recordId:    regularisationId,
      action:      'UPDATE',
      performedBy: ctx.approverId,
      oldData:     { status: 'pending', approval_level: gate.level },
      newData:     { status: 'pending', approval_level: gate.nextLevel, total_levels: gate.totalLevels },
    })
    return { ok: true, value: {
      id:                  regRow.id,
      status:              'pending',
      employee_id:         regRow.employee_id,
      date:                regRow.date,
      requested_check_in:  regRow.requested_check_in,
      requested_check_out: regRow.requested_check_out,
    } }
  }
  // gate.kind === 'finalize' — legacy guards only when the per-level gate did not
  // already authorize this actor (Segregation of duties F3 + approver validation).
  if (!gate.authorized) {
    if (await isSelfApproval(supabase, tenantId, ctx.approverId, regRow.employee_id)) {
      return {
        ok:    false,
        error: { type: 'FORBIDDEN', message: 'You cannot approve your own regularisation request.' },
      }
    }
    const authResult = await validateApprover(supabase, ctx, regRow.employee_id)
    if (!authResult.ok) return authResult
  }

  // 2. Atomic RPC
  const now = new Date().toISOString()
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'approve_regularisation_atomic',
    {
      p_tenant_id:   tenantId,
      p_reg_id:      regularisationId,
      p_approver_id: ctx.approverId,
      p_approved_at: now,
    },
  )

  if (rpcErr) {
    return { ok: false, error: parseRpcError(rpcErr) }
  }

  const approved = rpcData as ApprovedRegularisation

  // 3. Audit (non-fatal)
  const isHrAdminRegApprove = ['super_admin', 'hr_admin'].includes(ctx.approverRole)
  await logAction(supabase, {
    tenantId,
    tableName:   'attendance_regularisation',
    recordId:    regularisationId,
    action:      'UPDATE',
    performedBy: ctx.approverId,
    onBehalfOf:  isHrAdminRegApprove ? regRow.employee_id : null,
    oldData:     { status: 'pending' },
    newData:     { status: 'approved', approved_by: ctx.approverId, approved_at: now },
  })

  // Event emission (fire-and-forget)
  eventService.emit('regularisation.approved', {
    tenant_id:   tenantId,
    employee_id: regRow.employee_id,
    request_id:  regularisationId,
    type:        'regularisation',
    actor_id:    ctx.approverId,
    date:        regRow.date,
  })

  return { ok: true, value: approved }
}

/**
 * Reject an attendance regularisation.
 */
export async function rejectRegularisation(
  supabase: SupabaseClient,
  opts:     RegularisationApprovalOpts & { rejectionReason?: string },
): Promise<ApprovalResult<{ id: string; status: string }>> {
  const { tenantId, regularisationId, ctx, rejectionReason } = opts

  // Fetch
  const { data: reg, error: fetchErr } = await supabase
    .from('attendance_regularisation')
    .select('id, status, employee_id, date')
    .eq('id', regularisationId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr || !reg) {
    return { ok: false, error: { type: 'NOT_FOUND', message: 'Regularisation request not found' } }
  }

  const regRow = reg as { id: string; status: string; employee_id: string; date: string }

  // Status pre-check (Step 2)
  if (regRow.status !== 'pending') {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: `Request is already ${regRow.status}` },
    }
  }

  // Multi-level gate. Reject always finalizes but records the action + closes the
  // instance when a chain exists; legacy approver check only when not pre-authorized.
  const gate = await gateReject(supabase, {
    tenantId,
    entityType:       'attendance_regularisation',
    entityId:         regularisationId,
    actorId:          ctx.approverId,
    actorRole:        ctx.approverRole,
    targetEmployeeId: regRow.employee_id,
    comments:         rejectionReason,
  })
  if (gate.kind === 'error') {
    return { ok: false, error: { type: gate.error.type, message: gate.error.message } }
  }
  if (gate.kind === 'finalize' && !gate.authorized) {
    const authResult = await validateApprover(supabase, ctx, regRow.employee_id)
    if (!authResult.ok) return authResult
  }

  // Atomic RPC
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'reject_regularisation_atomic',
    {
      p_tenant_id:        tenantId,
      p_reg_id:           regularisationId,
      p_rejection_reason: rejectionReason ?? null,
    },
  )

  if (rpcErr) {
    return { ok: false, error: parseRpcError(rpcErr) }
  }

  const rejected = rpcData as { id: string; status: string }

  // Audit
  const isHrAdminRegReject = ['super_admin', 'hr_admin'].includes(ctx.approverRole)
  await logAction(supabase, {
    tenantId,
    tableName:   'attendance_regularisation',
    recordId:    regularisationId,
    action:      'UPDATE',
    performedBy: ctx.approverId,
    onBehalfOf:  isHrAdminRegReject ? regRow.employee_id : null,
    oldData:     { status: 'pending' },
    newData:     { status: 'rejected', rejection_reason: rejectionReason ?? null },
  })

  // Event emission (fire-and-forget)
  eventService.emit('regularisation.rejected', {
    tenant_id:   tenantId,
    employee_id: regRow.employee_id,
    request_id:  regularisationId,
    type:        'regularisation',
    actor_id:    ctx.approverId,
    date:        regRow.date,
  })

  return { ok: true, value: rejected }
}

// ── Pending approvals query ────────────────────────────────────────────────────

export interface PendingApprovalsPage {
  leaveRequests:    unknown[]
  regularisations:  unknown[]
  leaveTotal:       number
  regTotal:         number
}

/**
 * Return paginated PENDING leave requests + regularisations for a given manager's
 * direct reports.
 *
 * Used by the GET /approvals/pending route for non-admin callers.
 */
export async function getPendingApprovalsForManager(
  supabase:          SupabaseClient,
  tenantId:          string,
  managerEmployeeId: string,
  page:              number = 1,
  limit:             number = 20,
): Promise<PendingApprovalsPage> {
  const offset = (page - 1) * limit

  // Fetch direct-report IDs
  const { data: directReports } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('manager_id', managerEmployeeId)

  const directReportIds = (directReports ?? []).map((e: { id: string }) => e.id)

  if (!directReportIds.length) {
    return { leaveRequests: [], regularisations: [], leaveTotal: 0, regTotal: 0 }
  }

  const [leaveRes, regRes] = await Promise.all([
    supabase
      .from('leave_requests')
      .select(`
        id, from_date, to_date, computed_days, half_day, reason, status, created_at,
        leave_types(id, name, is_paid),
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .in('employee_id', directReportIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),

    supabase
      .from('attendance_regularisation')
      .select(`
        id, date, requested_check_in, requested_check_out, reason, status, created_at,
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .in('employee_id', directReportIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  ])

  return {
    leaveRequests:   leaveRes.data   ?? [],
    regularisations: regRes.data     ?? [],
    leaveTotal:      leaveRes.count  ?? 0,
    regTotal:        regRes.count    ?? 0,
  }
}
