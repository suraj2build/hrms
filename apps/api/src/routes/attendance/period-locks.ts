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

const monthRe = /^\d{4}-\d{2}$/

function requireHrAdmin(req: any, reply: any): boolean {
  if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch period locks' })
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

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch period lock' })
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

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('attendance_period_locks')
      .upsert({
        tenant_id:   req.tenantId,
        period_month: month,
        state:       'LOCKED',
        locked_by:   req.userId,
        locked_at:   now,
        lock_reason: parsed.data.reason ?? null,
        updated_at:  now,
      }, { onConflict: 'tenant_id,period_month' })
      .select('id, period_month, state, locked_at, lock_reason')
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to lock period' })

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

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('attendance_period_locks')
      .update({
        state:         'OPEN',
        unlocked_by:   req.userId,
        unlocked_at:   now,
        unlock_reason: parsed.data.reason ?? null,
        updated_at:    now,
      })
      .eq('tenant_id', req.tenantId)
      .eq('period_month', month)
      .select('id, period_month, state')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to unlock period' })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Period lock record not found' })
    return reply.send({ data })
  })

  // POST /attendance/period-locks/:month/start-payroll
  fastify.post('/attendance/period-locks/:month/start-payroll', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    // Must be currently LOCKED to advance
    const { data: current } = await fastify.supabase
      .from('attendance_period_locks')
      .select('state')
      .eq('tenant_id', req.tenantId)
      .eq('period_month', month)
      .maybeSingle()

    if (!current || current.state !== 'LOCKED') {
      return reply.code(409).send({ error: 'INVALID_TRANSITION', message: 'Period must be LOCKED before starting payroll processing' })
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('attendance_period_locks')
      .update({ state: 'PAYROLL_PROCESSING', payroll_started_by: req.userId, payroll_started_at: now, updated_at: now })
      .eq('tenant_id', req.tenantId)
      .eq('period_month', month)
      .select('id, period_month, state')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to advance to payroll processing' })
    return reply.send({ data })
  })

  // POST /attendance/period-locks/:month/finalize
  fastify.post('/attendance/period-locks/:month/finalize', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.params as { month: string }
    if (!monthRe.test(month)) return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })

    const { data: current } = await fastify.supabase
      .from('attendance_period_locks')
      .select('state')
      .eq('tenant_id', req.tenantId)
      .eq('period_month', month)
      .maybeSingle()

    if (!current || current.state !== 'PAYROLL_PROCESSING') {
      return reply.code(409).send({ error: 'INVALID_TRANSITION', message: 'Period must be in PAYROLL_PROCESSING before finalization' })
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('attendance_period_locks')
      .update({ state: 'PAYROLL_FINALIZED', finalized_by: req.userId, finalized_at: now, updated_at: now })
      .eq('tenant_id', req.tenantId)
      .eq('period_month', month)
      .select('id, period_month, state, finalized_at')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to finalize period' })
    return reply.send({ data })
  })
}
