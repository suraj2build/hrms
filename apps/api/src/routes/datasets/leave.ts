/**
 * Canonical Leave Dataset — /datasets/leave
 *
 * Single source of truth for leave utilization analytics.
 *
 * GET /datasets/leave
 *   ?group_by    leave_type|department|employment_type
 *   ?from        YYYY-MM  (default: 12 months ago)
 *   ?to          YYYY-MM  (default: current month)
 *   ?filter_department_id   drill-down filter
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

type GroupBy = 'leave_type' | 'department' | 'employment_type'
const VALID_GROUP_BY = new Set<string>(['leave_type', 'department', 'employment_type'])

function r2(n: number): number { return Math.round(n * 100) / 100 }

function lastDayOf(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return `${yyyyMM}-${new Date(y, m, 0).getDate()}`
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default async function leaveDataset(fastify: FastifyInstance) {
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

    const groupBy: GroupBy = VALID_GROUP_BY.has(q.group_by ?? '') ? (q.group_by as GroupBy) : 'leave_type'

    const filterDeptId = q.filter_department_id ?? null

    const now        = new Date()
    const curYYYYMM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const toYYYYMM   = q.to ?? curYYYYMM
    const fromDate   = q.from
      ? new Date(`${q.from}-01`)
      : new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const fromYYYYMM = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`
    const fromFirst  = `${fromYYYYMM}-01`
    const toLast     = lastDayOf(toYYYYMM)

    // Fetch approved leave requests in range with leave_type and employee+job_history joins
    let leaveQuery = fastify.supabase
      .from('leave_requests')
      .select(`
        id, employee_id, leave_type_id, computed_days, status, start_date:from_date,
        leave_types ( id, name ),
        employees!inner (
          id,
          job_history!job_history_employee_id_fkey (
            department_id, employment_type, is_current,
            departments ( id, name )
          )
        )
      `)
      .eq('tenant_id', tid)
      .eq('status', 'approved')
      .gte('from_date', fromFirst)
      .lte('from_date', toLast) as any

    if (filterDeptId) leaveQuery = leaveQuery.eq('employees.job_history.department_id', filterDeptId)

    let leaves: any[]
    try {
      leaves = await fetchAllRows((from, to) => (leaveQuery as any).range(from, to))
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch leave dataset')
    }

    // ── Group helper ──────────────────────────────────────────────────────────
    function jh(leave: any) {
      const emp = leave.employees as any
      const arr = emp?.job_history
      return (Array.isArray(arr) ? arr.find((j: any) => j.is_current) ?? arr[0] : arr) ?? {}
    }

    function getGroupKey(leave: any): { key: string; label: string } {
      const h = jh(leave)
      switch (groupBy) {
        case 'leave_type':
          return { key: leave.leave_type_id ?? '__none__', label: (leave.leave_types as any)?.name ?? 'Unknown' }
        case 'department':
          return { key: h.department_id ?? '__none__', label: (h.departments as any)?.name ?? 'Unassigned' }
        case 'employment_type':
          return { key: h.employment_type ?? 'unknown', label: h.employment_type ? titleCase(h.employment_type) : 'Unknown' }
      }
    }

    type GroupEntry = { key: string; label: string; total_days: number; request_count: number; employees: Set<string> }
    const groupMap: Record<string, GroupEntry> = {}

    for (const leave of leaves) {
      const { key, label } = getGroupKey(leave)
      if (!groupMap[key]) groupMap[key] = { key, label, total_days: 0, request_count: 0, employees: new Set() }
      const g = groupMap[key]
      g.total_days += Number(leave.computed_days ?? 0)
      g.request_count++
      if (leave.employee_id) g.employees.add(leave.employee_id)
    }

    const totalDays  = leaves.reduce((s, l) => s + Number(l.computed_days ?? 0), 0)
    const totalReqs  = leaves.length
    const uniqueEmps = new Set(leaves.map((l: any) => l.employee_id)).size

    const by_group = Object.values(groupMap)
      .map(g => ({
        key:                   g.key,
        label:                 g.label,
        total_days:            r2(g.total_days),
        request_count:         g.request_count,
        unique_employees:      g.employees.size,
        avg_days_per_employee: g.employees.size > 0 ? r2(g.total_days / g.employees.size) : 0,
      }))
      .sort((a, b) => b.total_days - a.total_days)

    return reply.send({
      meta: { group_by: groupBy, from: fromYYYYMM, to: toYYYYMM, generated_at: new Date().toISOString() },
      summary: {
        total_days:            totalDays,
        total_requests:        totalReqs,
        unique_employees:      uniqueEmps,
        avg_days_per_employee: uniqueEmps > 0 ? r2(totalDays / uniqueEmps) : 0,
      },
      by_group,
    })
  })
}
