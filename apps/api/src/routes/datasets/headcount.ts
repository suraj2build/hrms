/**
 * Canonical Headcount Dataset — /datasets/headcount
 *
 * Single source of truth for headcount metrics consumed by:
 *   - Reports page
 *   - AdminDashboard
 *   - ExecutiveIntelligenceCenter
 *
 * GET /datasets/headcount
 *   ?from          YYYY-MM   start month (default: 12 months ago)
 *   ?to            YYYY-MM   end month   (default: current month)
 *   ?department_id UUID      optional filter
 */

import type { FastifyInstance } from 'fastify'

function r2(n: number): number { return Math.round(n * 100) / 100 }

/** Last calendar day of a month, e.g. "2024-03" → "2024-03-31" */
function lastDayOf(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${yyyyMM}-${String(last).padStart(2, '0')}`
}

export default async function headcountDataset(fastify: FastifyInstance) {
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

  fastify.get('/', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    // ── Date range ──────────────────────────────────────────────────────────────
    const now       = new Date()
    const curYYYYMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const toYYYYMM  = q.to   ?? curYYYYMM
    const fromDate  = q.from
      ? new Date(`${q.from}-01`)
      : new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const fromYYYYMM = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`

    const fromFirst = `${fromYYYYMM}-01`
    const toLast    = lastDayOf(toYYYYMM)

    const deptFilter = q.department_id ?? null

    // ── Parallel queries ────────────────────────────────────────────────────────

    // 1) All employees with current job history (for active snapshot + dept + type)
    let empQuery = fastify.supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name,
        joining_date, status, updated_at,
        job_history!job_history_employee_id_fkey (
          department_id, employment_type, is_current,
          departments ( id, name )
        )
      `)
      .eq('tenant_id', tid)
      .eq('job_history.is_current', true)

    if (deptFilter) empQuery = empQuery.eq('job_history.department_id', deptFilter)

    // 2) Separations in range (for exits + monthly trend)
    let sepQuery = fastify.supabase
      .from('employees')
      .select('id, updated_at')
      .eq('tenant_id', tid)
      .eq('status', 'separated')
      .gte('updated_at', fromFirst)
      .lte('updated_at', `${toLast}T23:59:59.999Z`)

    if (deptFilter) {
      // we'll filter separations by department below after fetching job_history
      // but for a clean approximation, we simply skip the filter here since
      // separated employees may no longer have is_current=true job_history
    }

    const [{ data: employees, error: empErr }, { data: sepRows }] = await Promise.all([
      empQuery,
      sepQuery,
    ])

    if (empErr) return reply.code(500).send({ error: 'DB_ERROR', message: empErr.message })

    const allEmployees = (employees ?? []) as any[]
    const allSeps      = (sepRows ?? []) as any[]

    // ── Snapshot counts ─────────────────────────────────────────────────────────
    const activeCount    = allEmployees.filter(e => e.status === 'active').length
    const onNoticeCount  = allEmployees.filter(e => e.status === 'on_notice').length
    const totalEmployed  = activeCount + onNoticeCount

    // Joiners: employees whose joining_date falls in [fromFirst, toLast]
    const joiners = allEmployees.filter(e => {
      if (!e.joining_date) return false
      return e.joining_date >= fromFirst && e.joining_date <= toLast
    })

    const joinerCount = joiners.length
    const exitCount   = allSeps.length

    const avgActive    = Math.max(1, activeCount)
    const attritionRate = r2((exitCount / avgActive) * 100)
    const netChange     = joinerCount - exitCount

    // ── By department (active + on_notice only) ─────────────────────────────────
    const deptMap: Record<string, { id: string; name: string; count: number; joiners: number; exits: number }> = {}

    for (const emp of allEmployees) {
      if (emp.status === 'separated') continue
      const jh      = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      const deptId  = jh?.department_id ?? '__none__'
      const deptName = (jh?.departments as { id?: string; name?: string } | null)?.name ?? 'Unassigned'
      if (!deptMap[deptId]) deptMap[deptId] = { id: deptId, name: deptName, count: 0, joiners: 0, exits: 0 }
      deptMap[deptId].count++
    }

    // Joiners per dept
    for (const emp of joiners) {
      if (emp.status === 'separated') continue
      const jh     = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      const deptId = jh?.department_id ?? '__none__'
      if (deptMap[deptId]) deptMap[deptId].joiners++
    }

    // ── By employment type ──────────────────────────────────────────────────────
    const typeMap: Record<string, number> = {}
    for (const emp of allEmployees) {
      if (emp.status === 'separated') continue
      const jh   = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      const type = jh?.employment_type ?? 'unknown'
      typeMap[type] = (typeMap[type] ?? 0) + 1
    }

    // ── Monthly trend ───────────────────────────────────────────────────────────
    const months: Record<string, { month: string; joiners: number; exits: number; net: number }> = {}
    const cur = new Date(`${fromYYYYMM}-01`)
    const end = new Date(`${toYYYYMM}-01`)
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
      months[key] = { month: key, joiners: 0, exits: 0, net: 0 }
      cur.setMonth(cur.getMonth() + 1)
    }

    for (const emp of allEmployees) {
      if (!emp.joining_date) continue
      const key = emp.joining_date.slice(0, 7)
      if (months[key]) months[key].joiners++
    }

    for (const sep of allSeps) {
      if (!sep.updated_at) continue
      const key = sep.updated_at.slice(0, 7)
      if (months[key]) months[key].exits++
    }

    for (const m of Object.values(months)) {
      m.net = m.joiners - m.exits
    }

    // ── Response ────────────────────────────────────────────────────────────────
    return reply.send({
      meta: {
        from:          fromYYYYMM,
        to:            toYYYYMM,
        department_id: deptFilter,
        generated_at:  new Date().toISOString(),
      },
      snapshot: {
        active:          activeCount,
        on_notice:       onNoticeCount,
        total_employed:  totalEmployed,
        joiners:         joinerCount,
        exits:           exitCount,
        net_change:      netChange,
        attrition_rate:  attritionRate,
      },
      by_department: Object.values(deptMap).sort((a, b) => b.count - a.count),
      by_employment_type: Object.entries(typeMap)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      monthly_trend: Object.values(months),
    })
  })
}
