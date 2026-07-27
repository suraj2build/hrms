/**
 * Canonical Separation Dataset — /datasets/separation
 *
 * Single source of truth for attrition and exit analytics.
 *
 * GET /datasets/separation
 *   ?group_by    exit_type|department|location
 *   ?from        YYYY-MM  (default: 12 months ago)
 *   ?to          YYYY-MM  (default: current month)
 *   ?filter_department_id|filter_location_id   drill-down filters
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

type GroupBy = 'exit_type' | 'department' | 'location'
const VALID_GROUP_BY = new Set<string>(['exit_type', 'department', 'location'])

function r2(n: number): number { return Math.round(n * 100) / 100 }

function lastDayOf(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return `${yyyyMM}-${new Date(y, m, 0).getDate()}`
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default async function separationDataset(fastify: FastifyInstance) {
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

    const groupBy: GroupBy = VALID_GROUP_BY.has(q.group_by ?? '') ? (q.group_by as GroupBy) : 'exit_type'

    const filterDeptId = q.filter_department_id ?? null
    const filterLocId  = q.filter_location_id   ?? null

    const now        = new Date()
    const curYYYYMM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const toYYYYMM   = q.to ?? curYYYYMM
    const fromDate   = q.from
      ? new Date(`${q.from}-01`)
      : new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const fromYYYYMM = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`
    const fromFirst  = `${fromYYYYMM}-01`
    const toLast     = lastDayOf(toYYYYMM)

    // Fetch separations in range with employee + job_history joins
    let sepQuery = fastify.supabase
      .from('employee_separation')
      .select(`
        id, employee_id, separation_type, notice_date, last_working_date,
        employees!inner (
          id, joining_date,
          job_history!job_history_employee_id_fkey (
            department_id, work_location_id, is_current,
            departments ( id, name ),
            work_locations ( id, name )
          )
        )
      `)
      .eq('tenant_id', tid)
      .gte('last_working_date', fromFirst)
      .lte('last_working_date', toLast) as any

    let fetchedSeparations: any[]
    try {
      fetchedSeparations = await fetchAllRows((from, to) => (sepQuery as any).range(from, to))
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch separation dataset')
    }

    // ── Group helper ──────────────────────────────────────────────────────────
    function jh(sep: any) {
      const emp = sep.employees as any
      const arr = emp?.job_history
      return (Array.isArray(arr) ? arr.find((j: any) => j.is_current) ?? arr[0] : arr) ?? {}
    }

    // Fresh audit finding: filter_department_id/location_id were previously
    // applied as .eq('employees.job_history.department_id', ...) etc. — an
    // embedded resource with no !inner — per PostgREST semantics that only
    // nulls out the non-matching embed, it never removes the parent
    // employee_separation row, so drilling into a department/location
    // silently returned the FULL unfiltered exit set. Applying it in JS
    // instead, after fetch.
    const separations = fetchedSeparations.filter((sep) => {
      const h = jh(sep)
      if (filterDeptId && h.department_id    !== filterDeptId) return false
      if (filterLocId  && h.work_location_id !== filterLocId)  return false
      return true
    })

    function getGroupKey(sep: any): { key: string; label: string } {
      const h = jh(sep)
      switch (groupBy) {
        case 'exit_type':
          return { key: sep.separation_type ?? 'unknown', label: sep.separation_type ? titleCase(sep.separation_type) : 'Unknown' }
        case 'department':
          return { key: h.department_id ?? '__none__', label: (h.departments as any)?.name ?? 'Unassigned' }
        case 'location':
          return { key: h.work_location_id ?? '__none__', label: (h.work_locations as any)?.name ?? 'Unassigned' }
      }
    }

    type GroupEntry = {
      key: string; label: string; exits: number
      total_notice_days: number; notice_count: number
      total_tenure_days: number; tenure_count: number
    }
    const groupMap: Record<string, GroupEntry> = {}

    for (const sep of separations) {
      const { key, label } = getGroupKey(sep)
      if (!groupMap[key]) groupMap[key] = { key, label, exits: 0, total_notice_days: 0, notice_count: 0, total_tenure_days: 0, tenure_count: 0 }
      const g = groupMap[key]
      g.exits++

      if (sep.notice_date && sep.last_working_date) {
        const days = Math.floor(
          (new Date(sep.last_working_date).getTime() - new Date(sep.notice_date).getTime()) / 86_400_000
        )
        if (days >= 0) { g.total_notice_days += days; g.notice_count++ }
      }

      const joiningDate = (sep.employees as any)?.joining_date
      if (joiningDate && sep.last_working_date) {
        const days = Math.floor(
          (new Date(sep.last_working_date).getTime() - new Date(joiningDate).getTime()) / 86_400_000
        )
        if (days >= 0) { g.total_tenure_days += days; g.tenure_count++ }
      }
    }

    // ── Summary totals ────────────────────────────────────────────────────────
    let sumNoticeDays = 0
    let noticeDaysCount = 0
    for (const sep of separations) {
      if (!sep.notice_date || !sep.last_working_date) continue
      const days = Math.floor(
        (new Date(sep.last_working_date).getTime() - new Date(sep.notice_date).getTime()) / 86_400_000
      )
      if (days >= 0) { sumNoticeDays += days; noticeDaysCount++ }
    }

    const by_group = Object.values(groupMap)
      .map(g => ({
        key:                       g.key,
        label:                     g.label,
        exits:                     g.exits,
        avg_notice_days:           g.notice_count > 0 ? r2(g.total_notice_days / g.notice_count) : 0,
        avg_tenure_at_exit_months: g.tenure_count > 0 ? r2(g.total_tenure_days / g.tenure_count / 30.44) : 0,
      }))
      .sort((a, b) => b.exits - a.exits)

    return reply.send({
      meta: { group_by: groupBy, from: fromYYYYMM, to: toYYYYMM, generated_at: new Date().toISOString() },
      summary: {
        total_exits:     separations.length,
        avg_notice_days: noticeDaysCount > 0 ? r2(sumNoticeDays / noticeDaysCount) : 0,
      },
      by_group,
    })
  })
}
