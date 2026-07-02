/**
 * Canonical Compensation Dataset — /datasets/compensation
 *
 * Single source of truth for CTC and compensation analytics.
 * Pulls current CTC from employee_compensations (one row per active employee).
 *
 * GET /datasets/compensation
 *   ?group_by    department|grade|designation|location
 *   ?month       YYYY-MM  (unused for CTC, kept for future payroll actuals; defaults to current month)
 *   ?filter_department_id|filter_location_id|filter_grade_id|filter_designation_id   drill-down filters
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

type GroupBy = 'department' | 'grade' | 'designation' | 'location'
const VALID_GROUP_BY = new Set<string>(['department', 'grade', 'designation', 'location'])

function r2(n: number): number { return Math.round(n * 100) / 100 }

export default async function compensationDataset(fastify: FastifyInstance) {
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

    const groupBy: GroupBy = VALID_GROUP_BY.has(q.group_by ?? '') ? (q.group_by as GroupBy) : 'department'

    // Drill-down filters
    const filterDeptId    = q.filter_department_id  ?? null
    const filterLocId     = q.filter_location_id    ?? null
    const filterGradeId   = q.filter_grade_id       ?? null
    const filterDesgId    = q.filter_designation_id ?? null

    const now       = new Date()
    const curYYYYMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const month     = (q.month && /^\d{4}-\d{2}$/.test(q.month)) ? q.month : curYYYYMM

    // ── Compensation records for active employees ─────────────────────────────
    // grade/designation live on job_history (lean employees, migration 016)
    let compQuery = fastify.supabase
      .from('employee_compensations')
      .select(`
        id, employee_id, ctc_annual,
        employees!inner (
          id, status,
          job_history!job_history_employee_id_fkey (
            department_id, work_location_id, grade_id, designation_id, is_current,
            departments ( id, name ),
            work_locations ( id, name ),
            grades ( id, name ),
            designations ( id, name )
          )
        )
      `)
      .eq('tenant_id', tid)
      .eq('employees.status', 'active') as any

    if (filterDeptId)  compQuery = compQuery.eq('employees.job_history.department_id', filterDeptId)
    if (filterLocId)   compQuery = compQuery.eq('employees.job_history.work_location_id', filterLocId)
    if (filterGradeId) compQuery = compQuery.eq('employees.job_history.grade_id', filterGradeId)
    if (filterDesgId)  compQuery = compQuery.eq('employees.job_history.designation_id', filterDesgId)

    const { data: compData, error: compErr } = await compQuery

    if (compErr) return reply.code(500).send({ error: 'DB_ERROR', message: compErr.message })

    const comps = (compData ?? []) as any[]

    // ── Group helper ──────────────────────────────────────────────────────────
    function jh(comp: any) {
      const emp = comp.employees as any
      const arr = emp?.job_history
      return (Array.isArray(arr) ? arr.find((j: any) => j.is_current) ?? arr[0] : arr) ?? {}
    }

    function getGroupKey(comp: any): { key: string; label: string } {
      const h   = jh(comp)
      switch (groupBy) {
        case 'department':
          return { key: h.department_id ?? '__none__', label: (h.departments as any)?.name ?? 'Unassigned' }
        case 'grade':
          return { key: h.grade_id ?? '__none__', label: (h.grades as any)?.name ?? 'Unassigned' }
        case 'designation':
          return { key: h.designation_id ?? '__none__', label: (h.designations as any)?.name ?? 'Unassigned' }
        case 'location':
          return { key: h.work_location_id ?? '__none__', label: (h.work_locations as any)?.name ?? 'Unassigned' }
      }
    }

    type GroupEntry = { key: string; label: string; headcount: number; total_ctc: number }
    const groupMap: Record<string, GroupEntry> = {}

    for (const comp of comps) {
      const { key, label } = getGroupKey(comp)
      if (!groupMap[key]) groupMap[key] = { key, label, headcount: 0, total_ctc: 0 }
      const g = groupMap[key]
      g.headcount++
      g.total_ctc += Number(comp.ctc_annual ?? 0)
    }

    const totalCTC  = comps.reduce((s, c) => s + Number(c.ctc_annual ?? 0), 0)
    const headcount = comps.length

    const by_group = Object.values(groupMap)
      .map(g => ({
        key:            g.key,
        label:          g.label,
        headcount:      g.headcount,
        total_ctc:      r2(g.total_ctc),
        avg_ctc:        g.headcount > 0 ? r2(g.total_ctc / g.headcount) : 0,
        cost_share_pct: totalCTC > 0 ? r2((g.total_ctc / totalCTC) * 100) : 0,
      }))
      .sort((a, b) => b.total_ctc - a.total_ctc)

    return reply.send({
      meta: { group_by: groupBy, month, generated_at: new Date().toISOString() },
      summary: {
        total_ctc_annual: r2(totalCTC),
        avg_ctc_annual:   headcount > 0 ? r2(totalCTC / headcount) : 0,
        headcount,
      },
      by_group,
    })
  })
}
