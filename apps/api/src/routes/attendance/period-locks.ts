/**
 * Attendance Period Lock API
 * GET    /attendance/period-locks              — list all periods for tenant
 * GET    /attendance/period-locks/:month       — get lock state for a period (YYYY-MM)
 * POST   /attendance/period-locks/:month/lock  — lock a period (hr_admin / super_admin)
 * POST   /attendance/period-locks/:month/unlock — unlock (hr_admin / super_admin)
 * POST   /attendance/period-locks/:month/start-payroll — advance to PAYROLL_PROCESSING
 * POST   /attendance/period-locks/:month/finalize      — advance to PAYROLL_FINALIZED
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, conflictError, notFound, ErrorCode } from '../../lib/api-errors.js'

const monthRe = /^\d{4}-\d{2}$/

function requireHrAdmin(req: any, reply: any): boolean {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return false
  }
  return true
}

const reasonSchema = z.object({ reason: z.string().min(1).max(500).optional() })

export default async function periodLocksRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // GET /attendance/period-locks
  fastify.get('/attendance/period-locks', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('attendance_period_locks')
      .select('id, period_month, state, locked_at, locked_by, lock_reason, unlocked_at, finalized_at, created_at')
      .eq('tenant_id', req.tenantId)
      .order('period_month', { ascending: false })
      .limit(24)   // 2 years of history

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch period locks')
    return reply.send({ data: data ?? [] })
  })

  // GET /attendance/period-locks/:month
  fastify.get('/attendance/period-locks/:month', auth, async (req: any, reply) => {
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    const { data, error } = await fastify.supabase
      .from('attendance_period_locks')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('period_month', month)
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch period lock')
    // Return synthesized OPEN state if no row exists
    return reply.send({ data: data ?? { period_month: month, state: 'OPEN' } })
  })

  // POST /attendance/period-locks/:month/lock
  fastify.post('/attendance/period-locks/:month/lock', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    const parsed = reasonSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // SYSTEM_AUDIT_2026-10-14 checkpoint 7: a plain CAS UPDATE/INSERT here,
    // on its own, shares no mutual-exclusion mechanism with the approval
    // RPCs' in-transaction lock-check (migration 461) — a genuinely
    // concurrent approval could still read "not yet locked" and commit in
    // the window before this write lands. lock_period_atomic (migration
    // 462) takes the SAME per-(tenant, month) advisory lock those RPCs now
    // take before their own check, giving both writer classes a real,
    // shared serialization point instead of two independent CAS writers
    // hoping not to race each other.
    const { data, error: lockErr } = await fastify.supabase.rpc('lock_period_atomic', {
      p_tenant_id: req.tenantId,
      p_month:     month,
      p_actor_id:  req.userId,
      p_reason:    parsed.data.reason ?? null,
    })

    if (lockErr) {
      const msg = lockErr.message ?? ''
      if (msg.includes('INVALID_TRANSITION:')) {
        return conflictError(reply, 'INVALID_TRANSITION', 'Cannot lock a period that is already in payroll processing or finalized')
      }
      return serverError(req, reply, lockErr, ErrorCode.UPDATE_FAILED, 'Failed to lock period')
    }

    // Fire-and-forget: auto-close pending regularisations as LOP
    setImmediate(async () => {
      try {
        // 1. Find all pending regularisations for this period
        const periodStart = `${month}-01`
        const nextMonth = new Date(`${month}-01`)
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
        const periodEnd = nextMonth.toISOString().slice(0, 10)

        const { data: pendingRegs } = await fastify.supabase
          .from('attendance_regularisation')
          .select('id, employee_id, date')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'pending')
          .gte('date', periodStart)
          .lt('date', periodEnd)

        if (!pendingRegs || pendingRegs.length === 0) return

        // 2. Auto-reject all pending regs with system reason
        const regIds = pendingRegs.map((r: any) => r.id)
        await fastify.supabase
          .from('attendance_regularisation')
          .update({
            status: 'rejected',
            rejection_reason: 'Period locked — regularisation window closed. Attendance marked as Absent (LOP).',
            approved_at: new Date().toISOString(),
          })
          .eq('tenant_id', req.tenantId)
          .in('id', regIds)

        // SYSTEM_AUDIT_2026-10-14 checkpoint 13 batch — this raw UPDATE bypasses
        // gateReject entirely, unlike every genuine reject in regularisation.ts.
        // If any of these regs had an OPEN multi-level approval_instances row
        // (e.g. advanced to level 2, awaiting HR), the above left it orphaned:
        // current_level/final_approved unchanged, final_approved still NULL —
        // the entity now reads 'rejected' but its chain metadata still claims
        // "awaiting approval," which would keep surfacing in an approver's
        // pending-approvals view for a request that can no longer be acted on.
        // Close any such instance the same way recordAndAdvance's own close
        // branch does (final_approved + closed_at), so system-forced rejection
        // leaves no stale open chain behind.
        await fastify.supabase
          .from('approval_instances')
          .update({ final_approved: false, closed_at: new Date().toISOString() })
          .eq('tenant_id', req.tenantId)
          .eq('entity_type', 'attendance_regularisation')
          .in('entity_id', regIds)
          .is('final_approved', null)

        // 3. For each unique employee+date, update attendance_daily status to 'absent' (LOP)
        const uniquePairs = Array.from(
          new Map(pendingRegs.map((r: any) => [`${r.employee_id}|${r.date}`, r])).values()
        ) as Array<{ employee_id: string; date: string }>

        for (const { employee_id, date } of uniquePairs) {
          await fastify.supabase
            .from('attendance_daily')
            .update({
              status: 'absent',
              is_payable: false,
            })
            .eq('tenant_id', req.tenantId)
            .eq('employee_id', employee_id)
            .eq('date', date)
            // Only update if currently anomalous — don't overwrite approved/present records
            .in('status', ['unknown', 'anomaly', 'no_punch', 'missing_punch', 'half_day'])

          fastify.log.info({ tenant_id: req.tenantId, employee_id, date }, 'auto-LOP: marked absent at period lock')
        }

        fastify.log.info(
          { tenant_id: req.tenantId, month, count: uniquePairs.length },
          'auto-LOP: period lock closed pending regularisations'
        )
      } catch (err) {
        fastify.log.warn({ err, month, tenant_id: req.tenantId }, 'auto-LOP background job failed')
      }
    })

    return reply.send({ data })
  })

  // POST /attendance/period-locks/:month/unlock
  fastify.post('/attendance/period-locks/:month/unlock', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    const parsed = reasonSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Same shared-advisory-lock rationale as /lock above (migration 462's
    // unlock_period_atomic) — this is also a writer of attendance_period_
    // locks.state that an in-flight approval RPC must genuinely serialize
    // against, not just race against a plain CAS UPDATE.
    const { data, error: unlockErr } = await fastify.supabase.rpc('unlock_period_atomic', {
      p_tenant_id: req.tenantId,
      p_month:     month,
      p_actor_id:  req.userId,
      p_reason:    parsed.data.reason ?? null,
    })

    if (unlockErr) {
      const msg = unlockErr.message ?? ''
      if (msg.includes('NOT_FOUND:')) return notFound(reply, 'NOT_FOUND', 'Period lock record not found')
      return serverError(req, reply, unlockErr, ErrorCode.UPDATE_FAILED, 'Failed to unlock period')
    }
    return reply.send({ data })
  })

  // POST /attendance/period-locks/:month/start-payroll
  fastify.post('/attendance/period-locks/:month/start-payroll', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    // Same shared-advisory-lock rationale as /lock above (migration 462's
    // start_payroll_processing_atomic).
    const { data, error: startErr } = await fastify.supabase.rpc('start_payroll_processing_atomic', {
      p_tenant_id: req.tenantId,
      p_month:     month,
      p_actor_id:  req.userId,
    })

    if (startErr) {
      const msg = startErr.message ?? ''
      if (msg.includes('INVALID_TRANSITION:')) return conflictError(reply, 'INVALID_TRANSITION', 'Period must be LOCKED before starting payroll processing')
      return serverError(req, reply, startErr, ErrorCode.UPDATE_FAILED, 'Failed to advance to payroll processing')
    }
    return reply.send({ data })
  })

  // POST /attendance/period-locks/:month/finalize
  fastify.post('/attendance/period-locks/:month/finalize', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    // Same shared-advisory-lock rationale as /lock above (migration 462's
    // finalize_period_atomic) — this is the "payroll finalization writer"
    // the continued audit specifically asked be checked for a shared
    // serialization mechanism with the approval RPCs.
    const { data, error: finalizeErr } = await fastify.supabase.rpc('finalize_period_atomic', {
      p_tenant_id: req.tenantId,
      p_month:     month,
      p_actor_id:  req.userId,
    })

    if (finalizeErr) {
      const msg = finalizeErr.message ?? ''
      if (msg.includes('INVALID_TRANSITION:')) return conflictError(reply, 'INVALID_TRANSITION', 'Period must be in PAYROLL_PROCESSING before finalization')
      return serverError(req, reply, finalizeErr, ErrorCode.UPDATE_FAILED, 'Failed to finalize period')
    }
    return reply.send({ data })
  })
}
