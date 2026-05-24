/**
 * Payroll Cost Intelligence — Phase 3
 *
 * Operational workforce cost analytics. Not a finance dashboard —
 * surfacing actionable cost intelligence for HR operations.
 *
 * GET /analytics/payroll/cost              — dept-level cost for a month
 * GET /analytics/payroll/cost/trends       — 6-month rolling cost trends
 * GET /analytics/payroll/cost/insights     — OT-heavy teams, high variance, anomalies
 * GET /analytics/payroll/cost/departments  — ranked dept cost breakdown
 *
 * All endpoints: hr_admin / super_admin only.
 */

import type { FastifyInstance } from 'fastify'
import { eventBus }            from '../../lib/event-bus.js'

const monthRe = /^\d{4}-\d{2}$/

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function priorMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)
  return { from, to }
}

export default async function payrollCostRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /analytics/payroll/cost ──────────────────────────────────────────────
  // Aggregated cost data for a month across all departments.
  fastify.get('/analytics/payroll/cost', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const month = (req.query as any).month || currentMonth()
    if (!monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_PARAM', message: 'month must be YYYY-MM' })
    }

    // Try snapshot table first (fast path)
    const { data: snapshots } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .order('total_gross', { ascending: false })

    if (snapshots?.length) {
      const totals = snapshots.reduce(
        (acc: any, s: any) => ({
          headcount:   acc.headcount + s.headcount,
          total_gross: acc.total_gross + Number(s.total_gross),
          total_net:   acc.total_net   + Number(s.total_net),
          total_ot_cost: acc.total_ot_cost + Number(s.total_ot_cost),
          total_lop:   acc.total_lop   + Number(s.total_lop_deduction),
        }),
        { headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0, total_lop: 0 },
      )
      return reply.send({
        data: {
          month,
          source: 'snapshot',
          ...totals,
          avg_gross:  totals.headcount > 0 ? Math.round(totals.total_gross / totals.headcount) : 0,
          departments: snapshots,
        },
      })
    }

    // Live path: aggregate from payroll_run_employees for the month's run
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status, total_gross, total_net, employee_count')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!run) {
      return reply.send({
        data: {
          month, source: 'no_run',
          headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0, total_lop: 0, avg_gross: 0,
          departments: [],
          message: 'No payroll run found for this month',
        },
      })
    }

    // Fetch per-employee slips with job_history for dept
    const { data: slips } = await fastify.supabase
      .from('payroll_run_employees')
      .select(`
        employee_id, gross_pay, net_pay, ot_cost, lop_deduction,
        employees!inner(
          id, first_name, last_name,
          job_history!inner(department_id, is_current, departments(id, name))
        )
      `)
      .eq('payroll_run_id', run.id)
      .eq('tenant_id', req.tenantId)

    // Aggregate by department
    const deptMap = new Map<string, {
      department_id: string; department_name: string
      headcount: number; total_gross: number; total_net: number
      total_ot_cost: number; total_lop: number
    }>()

    for (const slip of (slips ?? []) as any[]) {
      const jh = slip.employees?.job_history?.find((j: any) => j.is_current)
      const deptId   = jh?.department_id ?? 'unassigned'
      const deptName = jh?.departments?.name ?? 'Unassigned'
      const entry = deptMap.get(deptId) ?? {
        department_id: deptId, department_name: deptName,
        headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0, total_lop: 0,
      }
      entry.headcount++
      entry.total_gross   += Number(slip.gross_pay ?? 0)
      entry.total_net     += Number(slip.net_pay ?? 0)
      entry.total_ot_cost += Number(slip.ot_cost ?? 0)
      entry.total_lop     += Number(slip.lop_deduction ?? 0)
      deptMap.set(deptId, entry)
    }

    const departments = Array.from(deptMap.values())
      .map(d => ({ ...d, avg_gross: d.headcount > 0 ? Math.round(d.total_gross / d.headcount) : 0 }))
      .sort((a, b) => b.total_gross - a.total_gross)

    const totals = departments.reduce(
      (acc, d) => ({
        headcount:     acc.headcount + d.headcount,
        total_gross:   acc.total_gross + d.total_gross,
        total_net:     acc.total_net + d.total_net,
        total_ot_cost: acc.total_ot_cost + d.total_ot_cost,
        total_lop:     acc.total_lop + d.total_lop,
      }),
      { headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0, total_lop: 0 },
    )

    return reply.send({
      data: {
        month,
        source:        'live',
        run_id:        run.id,
        run_status:    run.status,
        ...totals,
        avg_gross:     totals.headcount > 0 ? Math.round(totals.total_gross / totals.headcount) : 0,
        departments,
      },
    })
  })

  // ── GET /analytics/payroll/cost/trends ──────────────────────────────────────
  // 6-month rolling cost trend — total_gross + avg_gross per month.
  fastify.get('/analytics/payroll/cost/trends', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { months = 6 } = req.query as { months?: number }
    const limit = Math.min(Number(months), 12)

    // Build last N months list
    const monthList: string[] = []
    const now = new Date()
    for (let i = limit - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    // Try snapshots first
    const { data: snaps } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('month, headcount, total_gross, total_net, total_ot_cost')
      .eq('tenant_id', req.tenantId)
      .in('month', monthList)

    // Aggregate snapshots by month
    const snapByMonth = new Map<string, { headcount: number; total_gross: number; total_net: number; total_ot_cost: number }>()
    for (const s of (snaps ?? []) as any[]) {
      const e = snapByMonth.get(s.month) ?? { headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0 }
      e.headcount   += s.headcount
      e.total_gross += Number(s.total_gross)
      e.total_net   += Number(s.total_net)
      e.total_ot_cost += Number(s.total_ot_cost)
      snapByMonth.set(s.month, e)
    }

    // Fill missing months from payroll_runs
    const missingMonths = monthList.filter(m => !snapByMonth.has(m))
    if (missingMonths.length) {
      const { data: runs } = await fastify.supabase
        .from('payroll_runs')
        .select('month, total_gross, total_net, employee_count')
        .eq('tenant_id', req.tenantId)
        .in('month', missingMonths)
        .in('status', ['completed', 'finalized'])

      for (const r of (runs ?? []) as any[]) {
        if (!snapByMonth.has(r.month)) {
          snapByMonth.set(r.month, {
            headcount:   r.employee_count ?? 0,
            total_gross: Number(r.total_gross ?? 0),
            total_net:   Number(r.total_net ?? 0),
            total_ot_cost: 0,
          })
        }
      }
    }

    const trend = monthList.map(m => {
      const d = snapByMonth.get(m)
      return {
        month:       m,
        headcount:   d?.headcount   ?? 0,
        total_gross: d?.total_gross ?? 0,
        total_net:   d?.total_net   ?? 0,
        total_ot_cost: d?.total_ot_cost ?? 0,
        avg_gross:   d && d.headcount > 0 ? Math.round(d.total_gross / d.headcount) : 0,
        has_data:    !!d,
      }
    })

    return reply.send({ data: trend, months: limit })
  })

  // ── GET /analytics/payroll/cost/insights ────────────────────────────────────
  // Actionable operational insights: OT-heavy, high-variance, risk signals.
  fastify.get('/analytics/payroll/cost/insights', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const month = (req.query as any).month || currentMonth()

    const insights: Array<{
      type: string; severity: 'low' | 'medium' | 'high'
      title: string; description: string
      department_id?: string; department_name?: string
      value?: number; threshold?: number
    }> = []

    // OT-heavy departments (ot_cost > 15% of gross)
    const { data: otHeavy } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('department_id, department_name, total_gross, total_ot_cost, headcount')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('ot_heavy', true)

    for (const d of (otHeavy ?? []) as any[]) {
      const pct = d.total_gross > 0 ? Math.round((d.total_ot_cost / d.total_gross) * 100) : 0
      insights.push({
        type: 'ot_heavy_team',
        severity: pct > 25 ? 'high' : 'medium',
        title: `High OT cost: ${d.department_name}`,
        description: `Overtime is ${pct}% of gross payroll (${d.headcount} employees). Possible staffing shortage or roster imbalance.`,
        department_id:   d.department_id,
        department_name: d.department_name,
        value:     pct,
        threshold: 15,
      })

      // Emit event if not already emitted for this dept+month
      eventBus.emit({
        type:          'abnormal.ot.cost.detected',
        correlationId: `${req.tenantId}:${d.department_id}:${month}`,
        payload: {
          tenantId:      req.tenantId,
          departmentId:  d.department_id,
          month,
          totalGross:    Number(d.total_gross),
          otCost:        Number(d.total_ot_cost),
          otPct:         pct,
          severity:      pct > 25 ? 'high' : 'medium',
          affectedCount: d.headcount,
        },
        tenantId: req.tenantId,
      })
    }

    // High variance departments (|variance_pct| > 10)
    const { data: highVar } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('department_id, department_name, total_gross, prior_month_gross, variance_pct, variance_amount')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('has_high_variance', true)

    for (const d of (highVar ?? []) as any[]) {
      const pct = Number(d.variance_pct)
      insights.push({
        type: 'high_variance_department',
        severity: Math.abs(pct) > 20 ? 'high' : 'medium',
        title: `Payroll variance: ${d.department_name}`,
        description: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last month (₹${Math.abs(Number(d.variance_amount)).toLocaleString()}). Investigate compensation revisions or headcount changes.`,
        department_id:   d.department_id,
        department_name: d.department_name,
        value:     pct,
        threshold: 10,
      })

      eventBus.emit({
        type:          'excessive.payroll.variance.detected',
        correlationId: `${req.tenantId}:${d.department_id}:${month}:var`,
        payload: {
          tenantId:       req.tenantId,
          month,
          departmentId:   d.department_id,
          departmentName: d.department_name,
          priorGross:     Number(d.prior_month_gross ?? 0),
          currentGross:   Number(d.total_gross),
          variancePct:    pct,
          severity:       Math.abs(pct) > 20 ? 'high' : 'medium',
        },
        tenantId: req.tenantId,
      })
    }

    // Compensation risk: employees with no active compensation
    const { data: noComp, count: noCompCount } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
      .not('id', 'in', `(SELECT employee_id FROM employee_compensations WHERE tenant_id = '${req.tenantId}' AND is_active = true)`)

    if ((noCompCount ?? 0) > 0) {
      insights.push({
        type: 'compensation_gap',
        severity: 'high',
        title: `${noCompCount} employee(s) with no active compensation`,
        description: 'These employees will be excluded from payroll runs. Assign a compensation structure immediately.',
        value: noCompCount ?? 0,
      })
    }

    // Sort by severity
    const order = { high: 0, medium: 1, low: 2 }
    insights.sort((a, b) => order[a.severity] - order[b.severity])

    return reply.send({ data: insights, month, total: insights.length })
  })

  // ── GET /analytics/payroll/cost/departments ──────────────────────────────────
  // Ranked department cost breakdown for a month.
  fastify.get('/analytics/payroll/cost/departments', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const month = (req.query as any).month || currentMonth()
    if (!monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_PARAM', message: 'month must be YYYY-MM' })
    }

    const prior = priorMonth(month)

    // Get current month snapshots
    const { data: current } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('department_id, department_name, headcount, total_gross, total_net, total_ot_cost, variance_pct, has_high_variance, ot_heavy')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .order('total_gross', { ascending: false })

    // Get prior month for comparison
    const { data: priorData } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('department_id, total_gross')
      .eq('tenant_id', req.tenantId)
      .eq('month', prior)

    const priorMap = new Map((priorData ?? []).map((d: any) => [d.department_id, Number(d.total_gross)]))

    const departments = (current ?? []).map((d: any) => ({
      department_id:    d.department_id,
      department_name:  d.department_name,
      headcount:        d.headcount,
      total_gross:      Number(d.total_gross),
      total_net:        Number(d.total_net),
      total_ot_cost:    Number(d.total_ot_cost),
      avg_gross:        d.headcount > 0 ? Math.round(Number(d.total_gross) / d.headcount) : 0,
      prior_gross:      priorMap.get(d.department_id) ?? null,
      variance_pct:     d.variance_pct ? Number(d.variance_pct) : null,
      has_high_variance: d.has_high_variance,
      ot_heavy:         d.ot_heavy,
    }))

    return reply.send({ data: departments, month, prior_month: prior })
  })
}
