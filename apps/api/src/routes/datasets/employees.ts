/**
 * Canonical Employees Dataset — /datasets/employees
 *
 * Single source of truth for headcount dimension analytics.
 * Supports flexible group_by across all people dimensions.
 *
 * GET /datasets/employees
 *   ?group_by    department|location|designation|grade|gender|employment_type
 *   ?from        YYYY-MM  (default: 12 months ago)
 *   ?to          YYYY-MM  (default: current month)
 *   ?filter_department_id|filter_location_id|filter_grade_id|filter_gender   drill-down filters
 */

import type { FastifyInstance } from 'fastify'

type GroupBy = 'department' | 'location' | 'designation' | 'grade' | 'gender' | 'employment_type'
const VALID_GROUP_BY = new Set<string>(['department', 'location', 'designation', 'grade', 'gender', 'employment_type'])

function r2(n: number): number { return Math.round(n * 100) / 100 }

function lastDayOf(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return `${yyyyMM}-${new Date(y, m, 0).getDate()}`
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default async function employeesDataset(fastify: FastifyInstance) {
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

    const groupBy: GroupBy = VALID_GROUP_BY.has(q.group_by ?? '') ? (q.group_by as GroupBy) : 'department'

    // Drill-down filters
    const filterDeptId  = q.filter_department_id  ?? null
    const filterLocId   = q.filter_location_id    ?? null
    const filterGradeId = q.filter_grade_id       ?? null
    const filterGender  = q.filter_gender         ?? null

    const now        = new Date()
    const curYYYYMM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const toYYYYMM   = q.to ?? curYYYYMM
    const fromDate   = q.from
      ? new Date(`${q.from}-01`)
      : new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const fromYYYYMM = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`
    const fromFirst  = `${fromYYYYMM}-01`
    const toLast     = lastDayOf(toYYYYMM)

    // ── Active employees with job_history ─────────────────────────────────────
    let empQuery = fastify.supabase
      .from('employees')
      .select(`
        id, gender, joining_date, confirmation_date, status,
        designation_id, grade_id,
        job_history!job_history_employee_id_fkey (
          department_id, work_location_id, employment_type, is_current,
          departments ( id, name ),
          work_locations ( id, name )
        )
      `)
      .eq('tenant_id', tid)
      .neq('status', 'separated')
      .eq('job_history.is_current', true) as any

    if (filterDeptId)  empQuery = empQuery.eq('job_history.department_id', filterDeptId)
    if (filterLocId)   empQuery = empQuery.eq('job_history.work_location_id', filterLocId)
    if (filterGradeId) empQuery = empQuery.eq('grade_id', filterGradeId)
    if (filterGender)  empQuery = empQuery.eq('gender', filterGender)

    const { data: empData, error: empErr } = await empQuery

    if (empErr) return reply.code(500).send({ error: 'DB_ERROR', message: empErr.message })

    // ── New joiners in the date range ─────────────────────────────────────────
    const { data: joinerData } = await fastify.supabase
      .from('employees')
      .select(`
        id, gender, joining_date, status,
        designation_id, grade_id,
        job_history!job_history_employee_id_fkey (
          department_id, work_location_id, employment_type, is_current,
          departments ( id, name ),
          work_locations ( id, name )
        )
      `)
      .eq('tenant_id', tid)
      .gte('joining_date', fromFirst)
      .lte('joining_date', toLast)

    // ── Designation / grade lookup (separate query to avoid deep join issues) ─
    const [{ data: designations }, { data: grades }] = await Promise.all([
      fastify.supabase.from('designations').select('id, name').eq('tenant_id', tid),
      fastify.supabase.from('grades').select('id, name').eq('tenant_id', tid),
    ])

    const desgMap = new Map<string, string>()
    const gradeMap = new Map<string, string>()
    for (const d of (designations ?? []) as any[]) desgMap.set(d.id, d.name)
    for (const g of (grades ?? []) as any[]) gradeMap.set(g.id, g.name)

    const employees = (empData ?? []) as any[]
    const joiners   = (joinerData ?? []) as any[]

    // ── Group helper ──────────────────────────────────────────────────────────
    function jh(emp: any) {
      const arr = emp.job_history
      return (Array.isArray(arr) ? arr[0] : arr) ?? {}
    }

    function getGroupKey(emp: any): { key: string; label: string } {
      const h = jh(emp)
      switch (groupBy) {
        case 'department':
          return { key: h.department_id ?? '__none__', label: (h.departments as any)?.name ?? 'Unassigned' }
        case 'location':
          return { key: h.work_location_id ?? '__none__', label: (h.work_locations as any)?.name ?? 'Unassigned' }
        case 'designation':
          return { key: emp.designation_id ?? '__none__', label: desgMap.get(emp.designation_id) ?? 'Unassigned' }
        case 'grade':
          return { key: emp.grade_id ?? '__none__', label: gradeMap.get(emp.grade_id) ?? 'Unassigned' }
        case 'gender':
          return { key: emp.gender ?? 'not_specified', label: emp.gender ? titleCase(emp.gender) : 'Not Specified' }
        case 'employment_type':
          return { key: h.employment_type ?? 'unknown', label: h.employment_type ? titleCase(h.employment_type) : 'Unknown' }
      }
    }

    // ── Active employee aggregation ───────────────────────────────────────────
    type GroupEntry = {
      key: string; label: string
      headcount: number; on_probation: number; confirmed: number
      new_joiners: number; total_tenure_days: number
    }
    const groupMap: Record<string, GroupEntry> = {}

    for (const emp of employees) {
      const { key, label } = getGroupKey(emp)
      if (!groupMap[key]) groupMap[key] = { key, label, headcount: 0, on_probation: 0, confirmed: 0, new_joiners: 0, total_tenure_days: 0 }
      const g = groupMap[key]
      g.headcount++
      if (emp.confirmation_date) g.confirmed++; else g.on_probation++
      if (emp.joining_date) {
        g.total_tenure_days += Math.floor((now.getTime() - new Date(emp.joining_date).getTime()) / 86_400_000)
      }
    }

    // ── New joiner overlay ────────────────────────────────────────────────────
    for (const emp of joiners) {
      const { key, label } = getGroupKey(emp)
      if (!groupMap[key]) groupMap[key] = { key, label, headcount: 0, on_probation: 0, confirmed: 0, new_joiners: 0, total_tenure_days: 0 }
      groupMap[key].new_joiners++
    }

    const total = employees.length

    const by_group = Object.values(groupMap)
      .map(g => ({
        key:               g.key,
        label:             g.label,
        headcount:         g.headcount,
        on_probation:      g.on_probation,
        confirmed:         g.confirmed,
        new_joiners:       g.new_joiners,
        avg_tenure_months: g.headcount > 0 ? r2(g.total_tenure_days / g.headcount / 30.44) : 0,
      }))
      .sort((a, b) => b.headcount - a.headcount)

    const totalTenureDays = employees.reduce((s, e) => {
      if (!e.joining_date) return s
      return s + Math.floor((now.getTime() - new Date(e.joining_date).getTime()) / 86_400_000)
    }, 0)

    return reply.send({
      meta: { group_by: groupBy, from: fromYYYYMM, to: toYYYYMM, generated_at: new Date().toISOString() },
      summary: {
        total_headcount:    total,
        total_confirmed:    employees.filter(e => e.confirmation_date).length,
        total_probation:    employees.filter(e => !e.confirmation_date).length,
        total_new_joiners:  joiners.length,
        avg_tenure_months:  total > 0 ? r2(totalTenureDays / total / 30.44) : 0,
      },
      by_group,
    })
  })
}
