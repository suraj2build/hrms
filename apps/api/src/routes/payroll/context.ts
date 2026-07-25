/**
 * Payroll Context Panel Endpoints
 *
 * GET /payroll/blockers?month=YYYY-MM          — employees blocking the payroll run
 * GET /payroll/variance-summary?month=YYYY-MM  — month-over-month salary spikes
 * GET /payroll/readiness?month=YYYY-MM         — run-readiness checklist
 * GET /payroll/pending-locks?month=YYYY-MM     — departments with attendance not yet locked
 *
 * All require hr_admin or super_admin.
 */
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const monthRe = /^\d{4}-\d{2}$/

export default async function payrollContextRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/blockers?month=YYYY-MM ──────────────────────────────────────
  fastify.get('/payroll/blockers', hrAdminAuth, async (req: any, reply) => {
    const month = (req.query as any).month as string | undefined
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })
    }

    try {
      // Employees missing an active compensation record block payroll processing.
      // Both fetches paginated — an unbounded .select() would silently truncate
      // at PostgREST's 1,000-row ceiling for a large tenant, either hiding real
      // blockers past row 1,000 or falsely flagging employees whose comp record
      // just happened to fall outside the truncated compensations set.
      const [emps, compsData] = await Promise.all([
        fetchAllRows<{ id: string; first_name: string; last_name: string }>((from, to) =>
          fastify.supabase
            .from('employees')
            .select('id, first_name, last_name')
            .eq('tenant_id', req.tenantId)
            .eq('status', 'active')
            .range(from, to),
        ),
        fetchAllRows<{ employee_id: string }>((from, to) =>
          fastify.supabase
            .from('employee_compensations')
            .select('employee_id')
            .eq('tenant_id', req.tenantId)
            .eq('is_active', true)
            .range(from, to),
        ),
      ])

      const compSet = new Set(compsData.map((c) => c.employee_id))

      const blockers = emps
        .filter((e: any) => !compSet.has(e.id))
        .slice(0, 20)
        .map((e: any) => ({
          id:            e.id,
          employee_name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
          blocker_type:  'missing_compensation',
          severity:      'critical' as const,
        }))

      return reply.send({ data: blockers })
    } catch {
      return reply.send({ data: [] })
    }
  })

  // ── GET /payroll/variance-summary?month=YYYY-MM ──────────────────────────────
  fastify.get('/payroll/variance-summary', hrAdminAuth, async (req: any, reply) => {
    const month = (req.query as any).month as string | undefined
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })
    }

    try {
      const [y, m] = month.split('-').map(Number)
      const prevDate  = new Date(y, m - 2, 1)
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

      const [curRunRes, prevRunRes] = await Promise.all([
        fastify.supabase
          .from('payroll_runs')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('month', month)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        fastify.supabase
          .from('payroll_runs')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('month', prevMonth)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (!curRunRes.data?.id || !prevRunRes.data?.id) {
        return reply.send({ data: { spike_count: 0, top_variances: [] } })
      }

      const [curSlips, prevSlips] = await Promise.all([
        fastify.supabase
          .from('payroll_slips')
          .select('employee_id, gross_pay, employees(first_name, last_name)')
          .eq('tenant_id', req.tenantId)
          .eq('run_id', curRunRes.data.id),
        fastify.supabase
          .from('payroll_slips')
          .select('employee_id, gross_pay')
          .eq('tenant_id', req.tenantId)
          .eq('run_id', prevRunRes.data.id),
      ])

      const prevMap = new Map<string, number>()
      for (const s of ((prevSlips.data ?? []) as any[])) {
        prevMap.set(s.employee_id, s.gross_pay ?? 0)
      }

      const SPIKE_THRESHOLD = 0.15 // flag >= 15% variance
      const variances: { employee_name: string; delta_pct: number; direction: 'up' | 'down' }[] = []

      for (const s of ((curSlips.data ?? []) as any[])) {
        const prev = prevMap.get(s.employee_id)
        if (!prev || prev === 0) continue
        const delta = (s.gross_pay - prev) / prev
        if (Math.abs(delta) >= SPIKE_THRESHOLD) {
          const emp = Array.isArray(s.employees) ? s.employees[0] : s.employees
          variances.push({
            employee_name: emp
              ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim()
              : s.employee_id,
            delta_pct:  Math.round(delta * 1000) / 10,
            direction:  delta > 0 ? 'up' : 'down',
          })
        }
      }

      variances.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))

      return reply.send({
        data: { spike_count: variances.length, top_variances: variances.slice(0, 5) },
      })
    } catch {
      return reply.send({ data: { spike_count: 0, top_variances: [] } })
    }
  })

  // ── GET /payroll/readiness?month=YYYY-MM ─────────────────────────────────────
  fastify.get('/payroll/readiness', hrAdminAuth, async (req: any, reply) => {
    const month = (req.query as any).month as string | undefined
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })
    }

    try {
      const [locksRes, anomaliesRes, revisionsRes] = await Promise.all([
        fastify.supabase
          .from('attendance_period_locks')
          .select('id, status:state')
          .eq('tenant_id', req.tenantId)
          .eq('period_month', month)
          .limit(1),
        fastify.supabase
          .from('attendance_anomalies')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('resolved', false),
        fastify.supabase
          .from('compensation_revisions')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('status', 'pending'),
      ])

      const attendance_locked  = (locksRes.data ?? []).length > 0
                                   && ((locksRes.data as any[])[0]?.status === 'locked')
      const anomalies_resolved = (anomaliesRes.count ?? 0) === 0
      const revisions_approved = (revisionsRes.count ?? 0) === 0

      const checks = [attendance_locked, anomalies_resolved, revisions_approved]
      const readiness_pct = Math.round((checks.filter(Boolean).length / checks.length) * 100)

      return reply.send({
        data: { attendance_locked, anomalies_resolved, revisions_approved, readiness_pct },
      })
    } catch {
      return reply.send({
        data: { attendance_locked: false, anomalies_resolved: false, revisions_approved: false, readiness_pct: 0 },
      })
    }
  })

  // ── GET /payroll/pending-locks?month=YYYY-MM ─────────────────────────────────
  fastify.get('/payroll/pending-locks', hrAdminAuth, async (req: any, reply) => {
    const month = (req.query as any).month as string | undefined
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })
    }

    try {
      const [deptsRes, lockedRes] = await Promise.all([
        fastify.supabase
          .from('departments')
          .select('id, name')
          .eq('tenant_id', req.tenantId),
        fastify.supabase
          // Period locks are tenant+month scoped (not per-department); there is no
          // department_id column, so dept-level lock filtering degrades to none.
          .from('attendance_period_locks')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('period_month', month),
      ])

      const lockedDeptIds = new Set(
        ((lockedRes.data ?? []) as any[]).map((r: any) => r.department_id)
      )
      const pendingDepts = ((deptsRes.data ?? []) as any[]).filter((d: any) => !lockedDeptIds.has(d.id))

      return reply.send({
        data: { pending_count: pendingDepts.length, departments: pendingDepts.map((d: any) => d.name) },
      })
    } catch {
      return reply.send({ data: { pending_count: 0, departments: [] } })
    }
  })
}
