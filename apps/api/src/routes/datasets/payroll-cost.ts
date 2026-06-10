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
        if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
          return
        }
        done()
      },
    ],
  }

  // ── GET /datasets/payroll-cost/anchor ───────────────────────────────────────
  // Returns the latest month that has a finalized payroll run, so analytics /
  // explorer can anchor their windows on real data instead of the wall clock.
  fastify.get('/anchor', adminAuth, async (req: any, reply) => {
    const { data } = await fastify.supabase
      .from('payroll_runs')
      .select('month, status')
      .eq('tenant_id', req.tenantId)
      .in('status', ['finalized', 'completed'])
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()
    return reply.send({ month: (data as any)?.month ?? null })
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

    // Current month: payroll run + slips
    let slipsQuery = fastify.supabase
      .from('payroll_slips')
      .select(`
        employee_id, gross_pay, net_pay, total_deductions, lop_amount,
        component_breakdown,
        employees!inner(
          id, grade_id, designation_id,
          job_history!job_history_employee_id_fkey(
            department_id, work_location_id, is_current,
            departments(id, name),
            work_locations(id, name)
          )
        )
      `)
      .eq('tenant_id', tid)
      .eq('month', month)
      .eq('status', 'finalized') as any

    const [runRes, priorRunRes] = await Promise.all([
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
    ])

    const run      = (runRes.data      as any) ?? null
    const priorRun = (priorRunRes.data as any) ?? null

    // Now fetch slips (we needed run first only for fallback — but we fetch all finalized slips)
    if (deptFilter) {
      slipsQuery = slipsQuery.eq('employees.job_history.department_id', deptFilter)
    }
    if (filterDeptId)  slipsQuery = slipsQuery.eq('employees.job_history.department_id', filterDeptId)
    if (filterLocId)   slipsQuery = slipsQuery.eq('employees.job_history.work_location_id', filterLocId)
    if (filterGradeId) slipsQuery = slipsQuery.eq('employees.grade_id', filterGradeId)
    if (filterDesgId)  slipsQuery = slipsQuery.eq('employees.designation_id', filterDesgId)
    const { data: slipsData, error: slipsErr } = await slipsQuery

    if (slipsErr) return reply.code(500).send({ error: 'DB_ERROR', message: slipsErr.message })

    const slips = (slipsData ?? []) as any[]

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
      // Lookup tables for grade / designation labels
      const [{ data: gradesData }, { data: desgData }] = await Promise.all([
        groupByDim === 'grade'
          ? fastify.supabase.from('grades').select('id, name').eq('tenant_id', tid)
          : Promise.resolve({ data: [] }),
        groupByDim === 'designation'
          ? fastify.supabase.from('designations').select('id, name').eq('tenant_id', tid)
          : Promise.resolve({ data: [] }),
      ])
      const gradeMap = new Map<string, string>()
      const desgMap  = new Map<string, string>()
      for (const g of (gradesData ?? []) as any[]) gradeMap.set(g.id, g.name)
      for (const d of (desgData  ?? []) as any[]) desgMap.set(d.id, d.name)

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
          key   = emp?.grade_id ?? '__none__'
          label = gradeMap.get(emp?.grade_id) ?? 'Unassigned'
        } else {
          key   = emp?.designation_id ?? '__none__'
          label = desgMap.get(emp?.designation_id) ?? 'Unassigned'
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

      const { data: trendRuns } = await fastify.supabase
        .from('payroll_runs')
        .select('month, total_gross, total_net, employee_count')
        .eq('tenant_id', tid)
        .in('month', trendMonths)
        .order('month', { ascending: true })

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
