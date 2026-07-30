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
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { tenantTodayStr } from '../../lib/digest-builder.js'

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
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
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
    // Tenant-local "current month", not the server's (UTC) clock — see
    // ISSUE-457/digest-builder.ts's tenantTodayStr for the day/month-
    // boundary class this avoids.
    const todayStr    = await tenantTodayStr(fastify.supabase, tid)
    const [curY, curM] = todayStr.slice(0, 7).split('-').map(Number)
    const curYYYYMM = `${curY}-${String(curM).padStart(2, '0')}`
    const toYYYYMM  = q.to   ?? curYYYYMM
    let fromYYYYMM: string
    if (q.from) {
      fromYYYYMM = q.from
    } else {
      const totalMonths = curY * 12 + (curM - 1) - 12
      const y = Math.floor(totalMonths / 12)
      const m = (totalMonths % 12) + 1
      fromYYYYMM = `${y}-${String(m).padStart(2, '0')}`
    }

    const fromFirst = `${fromYYYYMM}-01`
    const toLast    = lastDayOf(toYYYYMM)

    const deptFilter = q.department_id ?? null

    // Drill-down filters (from R3.3)
    const filterDeptId  = q.filter_department_id ?? null
    const filterLocId   = q.filter_location_id   ?? null
    const filterGradeId = q.filter_grade_id      ?? null
    const filterGender  = q.filter_gender        ?? null

    type HcGroupBy = 'department' | 'location' | 'grade' | 'gender'
    const VALID_HC_DIM = new Set(['department', 'location', 'grade', 'gender'])
    const groupByDim: HcGroupBy = VALID_HC_DIM.has(q.group_by ?? '') ? (q.group_by as HcGroupBy) : 'department'

    // ── Parallel queries ────────────────────────────────────────────────────────

    // 1) All employees with current job history (for active snapshot + dept + type)
    // gender lives on employee_personal_info, grade on job_history (lean employees, migration 016)
    let empQuery = fastify.supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name,
        joining_date, status, updated_at,
        employee_personal_info ( gender ),
        job_history!job_history_employee_id_fkey (
          department_id, work_location_id, grade_id, employment_type, is_current,
          departments ( id, name ),
          work_locations ( id, name ),
          grades ( id, name )
        )
      `)
      .eq('tenant_id', tid)
      .eq('job_history.is_current', true)

    // 2) Separations in range (for exits + monthly trend). Sourced from
    // employee_separation (not employees.status='separated') so department/
    // location/grade drill-down filters can be applied the same way the
    // sibling /datasets/separation endpoint does — job_history is joined via
    // employees!inner so a department filter actually scopes the exit count,
    // instead of the previous unfiltered employees.updated_at scan whose
    // exitCount silently ignored deptFilter/filterDeptId/filterLocId/
    // filterGradeId, producing a mismatched numerator/denominator
    // attrition_rate whenever a drill-down filter was active.
    let sepQuery = fastify.supabase
      .from('employee_separation')
      .select(`
        id, employee_id, last_working_date,
        employees!inner (
          id,
          job_history!job_history_employee_id_fkey (
            department_id, work_location_id, grade_id, is_current,
            departments ( id, name )
          )
        )
      `)
      .eq('tenant_id', tid)
      .gte('last_working_date', fromFirst)
      .lte('last_working_date', toLast) as any

    let fetchedEmployees: any[]
    let allSeps: any[]
    try {
      fetchedEmployees = await fetchAllRows((from, to) => (empQuery as any).range(from, to))
      allSeps          = await fetchAllRows((from, to) => (sepQuery as any).range(from, to))
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch headcount dataset')
    }

    // Fresh audit finding: deptFilter/filterDeptId/filterLocId/filterGradeId/
    // filterGender were previously applied at the DB layer as
    // .eq('job_history.department_id', ...) etc. against embedded resources
    // with no !inner — per PostgREST semantics that only nulls out the
    // non-matching embed, it never removes the parent row, so these filters
    // silently had no effect on the snapshot/by_department/by_group totals.
    // Applying them in JS instead, after fetch.
    const genderOfEmp = (emp: any): string | null => {
      const pi = emp.employee_personal_info
      const rec = Array.isArray(pi) ? pi[0] : pi
      return rec?.gender ?? null
    }
    const allEmployees = fetchedEmployees.filter((emp) => {
      const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      if (deptFilter    && jh?.department_id    !== deptFilter)    return false
      if (filterDeptId  && jh?.department_id    !== filterDeptId)  return false
      if (filterLocId   && jh?.work_location_id !== filterLocId)   return false
      if (filterGradeId && jh?.grade_id         !== filterGradeId) return false
      if (filterGender  && genderOfEmp(emp)     !== filterGender)  return false
      return true
    })

    // Same department/location/grade job_history embed, but for a separation
    // row (employee_separation -> employees!inner -> job_history), matching
    // the pattern the sibling /datasets/separation endpoint uses.
    const sepJh = (sep: any) => {
      const jhArr = sep.employees?.job_history ?? []
      return Array.isArray(jhArr) ? jhArr.find((j: any) => j.is_current) ?? jhArr[0] ?? {} : jhArr ?? {}
    }
    const allSepsFiltered = allSeps.filter((sep) => {
      const h = sepJh(sep)
      if (deptFilter    && h.department_id    !== deptFilter)    return false
      if (filterDeptId  && h.department_id    !== filterDeptId)  return false
      if (filterLocId   && h.work_location_id !== filterLocId)   return false
      if (filterGradeId && h.grade_id         !== filterGradeId) return false
      return true
    })

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
    const exitCount   = allSepsFiltered.length

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

    // Exits per dept (was a dead field, always 0 — never incremented)
    for (const sep of allSepsFiltered) {
      const h      = sepJh(sep)
      const deptId = h.department_id ?? '__none__'
      if (deptMap[deptId]) deptMap[deptId].exits++
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
    // Integer month-index arithmetic instead of new Date(y,m,d) local-component
    // construction — a date-only string parses as UTC midnight, but
    // getFullYear()/getMonth() read it back in the server's local TZ, which
    // can silently roll the month back by one when the server isn't UTC
    // (same class fixed in ISSUE-457's org/headcount-trend endpoint).
    const months: Record<string, { month: string; joiners: number; exits: number; net: number }> = {}
    const [fromY, fromM] = fromYYYYMM.split('-').map(Number)
    const [toY, toM]     = toYYYYMM.split('-').map(Number)
    const fromIdx = fromY * 12 + (fromM - 1)
    const toIdx   = toY   * 12 + (toM   - 1)
    for (let idx = fromIdx; idx <= toIdx; idx++) {
      const y = Math.floor(idx / 12)
      const m = (idx % 12) + 1
      const key = `${y}-${String(m).padStart(2, '0')}`
      months[key] = { month: key, joiners: 0, exits: 0, net: 0 }
    }

    for (const emp of allEmployees) {
      if (!emp.joining_date) continue
      const key = emp.joining_date.slice(0, 7)
      if (months[key]) months[key].joiners++
    }

    for (const sep of allSepsFiltered) {
      if (!sep.last_working_date) continue
      const key = sep.last_working_date.slice(0, 7)
      if (months[key]) months[key].exits++
    }

    for (const m of Object.values(months)) {
      m.net = m.joiners - m.exits
    }

    // ── By group (location / grade / gender) — only when requested ───────────────
    type HcGroupEntry = { key: string; label: string; count: number; joiners: number }
    let byGroup: HcGroupEntry[] | null = null

    if (groupByDim !== 'department') {
      const gMap = new Map<string, HcGroupEntry>()

      const genderOf = (emp: any): string | null => {
        const pi = emp.employee_personal_info
        const rec = Array.isArray(pi) ? pi[0] : pi
        return rec?.gender ?? null
      }

      for (const emp of allEmployees) {
        if (emp.status === 'separated') continue
        const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history

        let key: string; let label: string
        if (groupByDim === 'location') {
          key   = jh?.work_location_id ?? '__none__'
          label = (jh?.work_locations as any)?.name ?? 'Unassigned'
        } else if (groupByDim === 'grade') {
          key   = jh?.grade_id ?? '__none__'
          label = (jh?.grades as any)?.name ?? 'Unassigned'
        } else {
          const g = genderOf(emp)
          key   = g ?? 'not_specified'
          label = g ? (g.charAt(0).toUpperCase() + g.slice(1)) : 'Not Specified'
        }

        if (!gMap.has(key)) gMap.set(key, { key, label, count: 0, joiners: 0 })
        gMap.get(key)!.count++
      }

      // Joiner overlay for the group
      for (const emp of allEmployees) {
        if (!emp.joining_date || emp.joining_date < fromFirst || emp.joining_date > toLast) continue
        const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
        let key: string
        if (groupByDim === 'location') {
          key = jh?.work_location_id ?? '__none__'
        } else if (groupByDim === 'grade') {
          key = jh?.grade_id ?? '__none__'
        } else {
          key = genderOf(emp) ?? 'not_specified'
        }
        if (gMap.has(key)) gMap.get(key)!.joiners++
      }

      byGroup = Array.from(gMap.values()).sort((a, b) => b.count - a.count)
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
      by_group:      byGroup,
      monthly_trend: Object.values(months),
    })
  })
}
