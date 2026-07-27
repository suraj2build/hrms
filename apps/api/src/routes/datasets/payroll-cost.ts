/**
 * Canonical Payroll Cost Dataset — /datasets/payroll-cost
 *
 * Single source of truth for payroll cost, variance and trends consumed by:
 *   - PayrollCostIntelligence
 *   - ExecutiveIntelligenceCenter
 *
 * GET /datasets/payroll-cost
 *   ?month           YYYY-MM  (required)
 *   ?department_id   UUID     optional filter
 *   ?include_trends  'true'|'false'  default: 'false' — include 6-month rolling trend
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// Payroll slips advance finalized → processed → paid through the pay cycle.
// All of these are "final" data for reporting; only 'draft' is excluded.
const FINAL_SLIP_STATUSES = ['finalized', 'processed', 'paid', 'completed']
// A finalized run is the authoritative signal that a month's payroll is locked.
const FINAL_RUN_STATUSES = ['finalized', 'completed', 'paid', 'processed']

function r2(n: number): number { return Math.round(n * 100) / 100 }

function priorMonthStr(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Build list of last N months ending at (and including) endMonth */
function lastNMonths(endMonth: string, n: number): string[] {
  const [y, m] = endMonth.split('-').map(Number)
  const months: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export default async function payrollCostDataset(fastify: FastifyInstance) {
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      (req: any, reply: any, done: () => void) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
          return
        }
        done()
      },
    ],
  }

  // ── GET /datasets/payroll-cost/anchor ───────────────────────────────────────
  // Returns the latest month that actually has finalized payroll SLIPS — the
  // exact table the analytics/explorer read from — so the anchored window is
  // guaranteed to land on data. Falls back to the latest finalized run, then
  // any slip month, so it works even if run/slip status drift.
  fastify.get('/anchor', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId
    const latestSlipMonth = async (statuses?: string[]) => {
      let qb = fastify.supabase
        .from('payroll_slips')
        .select('month')
        .eq('tenant_id', tid)
        .order('month', { ascending: false })
        .limit(1)
      if (statuses) qb = qb.in('status', statuses)
      const { data } = await qb.maybeSingle()
      return (data as any)?.month ?? null
    }

    // Prefer the latest finalized RUN month — that's the authoritative "payroll
    // is locked" signal and matches what the breakdown reads.
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('month')
      .eq('tenant_id', tid)
      .in('status', FINAL_RUN_STATUSES)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()
    let month = (run as any)?.month ?? null
    if (!month) month = await latestSlipMonth(FINAL_SLIP_STATUSES)
    if (!month) month = await latestSlipMonth()   // any slip at all
    return reply.send({ month })
  })

  fastify.get('/', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    if (!q.month || !/^\d{4}-\d{2}$/.test(q.month)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'month (YYYY-MM) is required' })
    }
    const month         = q.month
    const deptFilter    = q.department_id ?? null
    const includeTrends = q.include_trends === 'true'
    const priorMonth    = priorMonthStr(month)

    type GroupByDim = 'department' | 'location' | 'grade' | 'designation'
    const VALID_DIM = new Set(['department', 'location', 'grade', 'designation'])
    const groupByDim: GroupByDim = VALID_DIM.has(q.group_by ?? '') ? (q.group_by as GroupByDim) : 'department'

    // Drill-down filters (from R3.3)
    const filterDeptId  = q.filter_department_id  ?? null
    const filterLocId   = q.filter_location_id    ?? null
    const filterGradeId = q.filter_grade_id       ?? null
    const filterDesgId  = q.filter_designation_id ?? null

    // ── Parallel queries ────────────────────────────────────────────────────────

    const [runRes, priorRunRes, finalRunRes] = await Promise.all([
      fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, total_gross, total_net, employee_count')
        .eq('tenant_id', tid)
        .eq('month', month)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('payroll_runs')
        .select('id, month, total_gross')
        .eq('tenant_id', tid)
        .eq('month', priorMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // The latest FINALIZED run for the month — its slips are the source of
      // truth for the breakdown regardless of individual slip status drift.
      fastify.supabase
        .from('payroll_runs')
        .select('id')
        .eq('tenant_id', tid)
        .eq('month', month)
        .in('status', FINAL_RUN_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // Errors are checked before falling back to "no matching row" — otherwise
    // a genuine query failure (RLS hiccup, transient error) is silently
    // treated identically to "no run for this month" (finalized: false,
    // run_status: null, mom_variance: null), with no signal that a query
    // actually failed vs. legitimately found nothing, on a financial-
    // reporting endpoint.
    if (runRes.error)      return serverError(req, reply, runRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll run')
    if (priorRunRes.error) return serverError(req, reply, priorRunRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch prior payroll run')
    if (finalRunRes.error) return serverError(req, reply, finalRunRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch finalized payroll run')

    const run        = (runRes.data      as any) ?? null
    const priorRun   = (priorRunRes.data as any) ?? null
    const finalRunId = (finalRunRes.data as any)?.id ?? null

    // Slips: prefer the finalized run's slips (run_id gate); otherwise fall back
    // to month + final slip statuses so it still works if run rows are absent.
    let slipsQuery = fastify.supabase
      .from('payroll_slips')
      .select(`
        employee_id, gross_pay, net_pay, total_deductions, lop_amount,
        component_breakdown,
        employees!inner(
          id,
          job_history!job_history_employee_id_fkey(
            department_id, work_location_id, grade_id, designation_id, is_current,
            departments(id, name),
            work_locations(id, name),
            grades(id, name),
            designations(id, name)
          )
        )
      `)
      .eq('tenant_id', tid) as any

    if (finalRunId) {
      slipsQuery = slipsQuery.eq('run_id', finalRunId)
    } else {
      slipsQuery = slipsQuery.eq('month', month).in('status', FINAL_SLIP_STATUSES)
    }

    let fetchedSlips: any[]
    try {
      fetchedSlips = await fetchAllRows((from, to) => (slipsQuery as any).range(from, to))
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll cost dataset')
    }

    // Fresh audit finding: department_id/filter_department_id/location_id/
    // grade_id/designation_id were previously applied as
    // .eq('employees.job_history.department_id', ...) etc. — two levels of
    // embedded resource (payroll_slips -> employees!inner -> job_history, the
    // last hop without !inner). Per PostgREST semantics that only nulls out
    // the non-matching embed, it never removes the parent payroll_slips row,
    // so drilling into a department/location/grade/designation silently
    // returned the FULL unfiltered payroll cost for the month — every
    // total_gross/total_net/total_deductions figure in the summary never
    // shrank to the filtered dimension. Applying them in JS instead.
    const jhOf = (slip: any) => {
      const jhArr = slip.employees?.job_history ?? []
      return Array.isArray(jhArr) ? jhArr.find((j: any) => j.is_current) ?? jhArr[0] ?? {} : jhArr ?? {}
    }
    const slips = fetchedSlips.filter((slip) => {
      const jh = jhOf(slip)
      if (deptFilter    && jh.department_id    !== deptFilter)    return false
      if (filterDeptId  && jh.department_id    !== filterDeptId)  return false
      if (filterLocId   && jh.work_location_id !== filterLocId)   return false
      if (filterGradeId && jh.grade_id         !== filterGradeId) return false
      if (filterDesgId  && jh.designation_id   !== filterDesgId)  return false
      return true
    })

    // ── Per-department aggregation ──────────────────────────────────────────────
    type DeptAgg = {
      department_id: string | null
      name: string
      headcount: number
      gross: number
      net: number
      deductions: number
    }

    const deptMap = new Map<string, DeptAgg>()

    let totalGross      = 0
    let totalNet        = 0
    let totalDeductions = 0
    let totalLop        = 0
    let totalOtCost     = 0

    for (const slip of slips) {
      const jhArr    = slip.employees?.job_history ?? []
      const jh       = Array.isArray(jhArr) ? jhArr.find((j: any) => j.is_current) ?? jhArr[0] : jhArr
      const deptId   = jh?.department_id   ?? null
      const deptName = (jh?.departments as { id?: string; name?: string } | null)?.name ?? 'Unassigned'
      const key      = deptId ?? '__none__'

      const gross      = Number(slip.gross_pay       ?? 0)
      const net        = Number(slip.net_pay         ?? 0)
      const deductions = Number(slip.total_deductions ?? 0)
      const lop        = Number(slip.lop_amount       ?? 0)

      // Extract OT cost from component_breakdown JSONB if available
      let otCost = 0
      const breakdown = Array.isArray(slip.component_breakdown) ? slip.component_breakdown : []
      for (const comp of breakdown) {
        const code = (comp?.code ?? comp?.component_code ?? '').toUpperCase()
        if (code === 'OT' || code === 'OVERTIME' || code === 'OT_PAY') {
          otCost += Number(comp?.amount ?? comp?.computed_monthly ?? 0)
        }
      }

      totalGross      += gross
      totalNet        += net
      totalDeductions += deductions
      totalLop        += lop
      totalOtCost     += otCost

      if (!deptMap.has(key)) {
        deptMap.set(key, { department_id: deptId, name: deptName, headcount: 0, gross: 0, net: 0, deductions: 0 })
      }
      const entry = deptMap.get(key)!
      entry.headcount++
      entry.gross      += gross
      entry.net        += net
      entry.deductions += deductions
    }

    totalGross      = r2(totalGross)
    totalNet        = r2(totalNet)
    totalDeductions = r2(totalDeductions)
    totalLop        = r2(totalLop)
    totalOtCost     = r2(totalOtCost)

    const headcount          = slips.length
    const avgCostPerEmployee = headcount > 0 ? r2(totalGross / headcount) : 0

    const byDepartment = Array.from(deptMap.values())
      .map(d => ({
        department_id:  d.department_id,
        name:           d.name,
        headcount:      d.headcount,
        gross:          r2(d.gross),
        net:            r2(d.net),
        deductions:     r2(d.deductions),
        cost_share_pct: totalGross > 0 ? r2((d.gross / totalGross) * 100) : 0,
      }))
      .sort((a, b) => b.gross - a.gross)

    // ── By group (location / grade / designation) — only when requested ──────────
    type GroupAgg = { key: string; label: string; headcount: number; gross: number; net: number }
    let byGroup: Array<{ key: string; label: string; headcount: number; gross: number; net: number; cost_share_pct: number }> | null = null

    if (groupByDim !== 'department') {
      const gMap = new Map<string, GroupAgg>()
      for (const slip of slips) {
        const emp  = slip.employees as any
        const jhArr = emp?.job_history ?? []
        const jh    = Array.isArray(jhArr) ? jhArr.find((j: any) => j.is_current) ?? jhArr[0] : jhArr

        let key: string; let label: string
        if (groupByDim === 'location') {
          key   = jh?.work_location_id ?? '__none__'
          label = (jh?.work_locations as any)?.name ?? 'Unassigned'
        } else if (groupByDim === 'grade') {
          key   = jh?.grade_id ?? '__none__'
          label = (jh?.grades as any)?.name ?? 'Unassigned'
        } else {
          key   = jh?.designation_id ?? '__none__'
          label = (jh?.designations as any)?.name ?? 'Unassigned'
        }

        if (!gMap.has(key)) gMap.set(key, { key, label, headcount: 0, gross: 0, net: 0 })
        const entry = gMap.get(key)!
        entry.headcount++
        entry.gross += Number(slip.gross_pay ?? 0)
        entry.net   += Number(slip.net_pay   ?? 0)
      }

      byGroup = Array.from(gMap.values())
        .map(g => ({
          key:            g.key,
          label:          g.label,
          headcount:      g.headcount,
          gross:          r2(g.gross),
          net:            r2(g.net),
          cost_share_pct: totalGross > 0 ? r2((g.gross / totalGross) * 100) : 0,
        }))
        .sort((a, b) => b.gross - a.gross)
    }

    // ── MOM Variance ─────────────────────────────────────────────────────────────
    let momVariance: {
      prior_month: string
      prior_gross: number
      variance: number
      variance_pct: number
    } | null = null

    if (priorRun) {
      const priorGross  = r2(Number(priorRun.total_gross ?? 0))
      const variance    = r2(totalGross - priorGross)
      const variancePct = priorGross > 0 ? r2((variance / priorGross) * 100) : 0
      momVariance = { prior_month: priorMonth, prior_gross: priorGross, variance, variance_pct: variancePct }
    }

    // ── 6-month trends (optional) ────────────────────────────────────────────────
    let trends: Array<{ month: string; gross: number; net: number; headcount: number }> | null = null

    if (includeTrends) {
      const trendMonths = lastNMonths(month, 6)

      const { data: trendRuns, error: trendErr } = await fastify.supabase
        .from('payroll_runs')
        .select('month, total_gross, total_net, employee_count')
        .eq('tenant_id', tid)
        .in('month', trendMonths)
        .order('month', { ascending: true })

      if (trendErr) return serverError(req, reply, trendErr, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll trends')

      const trendMap = new Map<string, { gross: number; net: number; headcount: number }>()
      for (const r of (trendRuns ?? []) as any[]) {
        trendMap.set(r.month, {
          gross:     r2(Number(r.total_gross    ?? 0)),
          net:       r2(Number(r.total_net      ?? 0)),
          headcount: Number(r.employee_count ?? 0),
        })
      }

      trends = trendMonths.map(m => ({
        month:     m,
        gross:     trendMap.get(m)?.gross     ?? 0,
        net:       trendMap.get(m)?.net       ?? 0,
        headcount: trendMap.get(m)?.headcount ?? 0,
      }))
    }

    return reply.send({
      meta: {
        month,
        department_id: deptFilter,
        generated_at:  new Date().toISOString(),
      },
      summary: {
        total_gross:            totalGross,
        total_net:              totalNet,
        total_deductions:       totalDeductions,
        total_lop_amount:       totalLop,
        total_ot_cost:          totalOtCost,
        headcount,
        avg_cost_per_employee:  avgCostPerEmployee,
        finalized:              run ? run.status === 'finalized' || run.status === 'completed' : false,
        run_status:             run?.status ?? null,
      },
      by_department: byDepartment,
      by_group:      byGroup,
      mom_variance:  momVariance,
      trends,
    })
  })
}
