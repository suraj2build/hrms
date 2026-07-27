/**
 * Canonical Employees Dataset — /datasets/employees
 *
 * Single source of truth for headcount dimension analytics.
 * Supports flexible group_by across all people dimensions.
 *
 * GET /datasets/employees
 *   ?group_by    department|location|designation|grade|gender|employment_type|site|region|zone|site_type
 *   ?from        YYYY-MM  (default: 12 months ago)
 *   ?to          YYYY-MM  (default: current month)
 *   ?filter_department_id|filter_location_id|filter_grade_id|filter_gender   drill-down filters
 *   ?filter_site_id|filter_region|filter_zone                               site drill-down filters (R5)
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// R5 — site/region/zone/site_type added so headcount can be disaggregated by the
// retail geography dimensions (migration 248). Same KPI, new GROUP BY axis.
type GroupBy = 'department' | 'location' | 'designation' | 'grade' | 'gender' | 'employment_type' | 'site' | 'region' | 'zone' | 'site_type'
const VALID_GROUP_BY = new Set<string>(['department', 'location', 'designation', 'grade', 'gender', 'employment_type', 'site', 'region', 'zone', 'site_type'])

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
    const filterDeptId  = q.filter_department_id  ?? null
    const filterLocId   = q.filter_location_id    ?? null
    const filterGradeId = q.filter_grade_id       ?? null
    const filterGender  = q.filter_gender         ?? null
    // R5 — site geography drill filters
    const filterSiteId  = q.filter_site_id        ?? null
    const filterRegion  = q.filter_region         ?? null
    const filterZone    = q.filter_zone           ?? null

    const now        = new Date()
    const curYYYYMM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const toYYYYMM   = q.to ?? curYYYYMM
    const fromDate   = q.from
      ? new Date(`${q.from}-01`)
      : new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const fromYYYYMM = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`
    const fromFirst  = `${fromYYYYMM}-01`
    const toLast     = lastDayOf(toYYYYMM)

    // grade/designation/confirmation_date live on job_history, gender on
    // employee_personal_info (lean employees, migration 016).
    const EMP_SELECT = `
        id, joining_date, status, site_id,
        sites ( id, name, region, zone, site_type ),
        employee_personal_info ( gender ),
        job_history!job_history_employee_id_fkey (
          department_id, work_location_id, grade_id, designation_id,
          employment_type, confirmation_date, is_current,
          departments ( id, name ),
          work_locations ( id, name ),
          grades ( id, name ),
          designations ( id, name )
        )
      `

    // ── Active employees with job_history ─────────────────────────────────────
    let empQuery = fastify.supabase
      .from('employees')
      .select(EMP_SELECT)
      .eq('tenant_id', tid)
      .neq('status', 'separated')
      .eq('job_history.is_current', true) as any

    // Fresh audit finding: filter_department_id/location_id/grade_id/gender
    // were applied here as .eq('job_history.department_id', ...) etc. against
    // an embedded resource with no !inner — per PostgREST semantics that only
    // nulls out the non-matching embed, it never removes the parent row. So
    // every drill-down by department/location/grade/gender silently returned
    // the FULL unfiltered employee set (summary totals never shrank), while
    // only the label grouping reclassified non-matches into "Unassigned".
    // filter_site_id is the one filter here that's actually safe at the DB
    // layer, since site_id lives directly on `employees`, not an embed.
    if (filterSiteId) empQuery = empQuery.eq('site_id', filterSiteId)

    let empData: any[]
    try {
      empData = await fetchAllRows((from, to) => (empQuery as any).range(from, to))
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch employees dataset')
    }
    let joinerData: any[]
    try {
      joinerData = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select(EMP_SELECT)
          .eq('tenant_id', tid)
          .gte('joining_date', fromFirst)
          .lte('joining_date', toLast)
          .range(from, to),
      )
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch joiners for employees dataset')
    }

    // ── Group helpers ─────────────────────────────────────────────────────────
    function jh(emp: any) {
      const arr = emp.job_history
      return (Array.isArray(arr) ? arr[0] : arr) ?? {}
    }
    function genderOf(emp: any): string | null {
      const pi = emp.employee_personal_info
      const rec = Array.isArray(pi) ? pi[0] : pi
      return rec?.gender ?? null
    }
    function siteOf(emp: any): { id: string | null; name: string | null; region: string | null; zone: string | null; site_type: string | null } {
      const s = Array.isArray(emp.sites) ? emp.sites[0] : emp.sites
      return { id: emp.site_id ?? null, name: s?.name ?? null, region: s?.region ?? null, zone: s?.zone ?? null, site_type: s?.site_type ?? null }
    }

    // Drill-down filters on embedded resources (job_history.department_id,
    // work_location_id, grade_id; employee_personal_info.gender; sites.region,
    // sites.zone) can't be applied at the DB layer without !inner (see the
    // comment above empQuery), so all of them are applied here in JS after
    // fetch. filter_site_id is already redundantly applied at the DB layer
    // too (site_id is a direct column), but re-checking it here is harmless.
    const passesFilters = (emp: any): boolean => {
      if (filterDeptId  && jh(emp).department_id     !== filterDeptId)  return false
      if (filterLocId   && jh(emp).work_location_id  !== filterLocId)   return false
      if (filterGradeId && jh(emp).grade_id          !== filterGradeId) return false
      if (filterGender  && genderOf(emp)             !== filterGender)  return false
      if (!filterRegion && !filterZone && !filterSiteId) return true
      const s = siteOf(emp)
      if (filterSiteId && s.id     !== filterSiteId) return false
      if (filterRegion && s.region !== filterRegion) return false
      if (filterZone   && s.zone   !== filterZone)   return false
      return true
    }

    const employees = (empData as any[]).filter(passesFilters)
    const joiners   = (joinerData as any[]).filter(passesFilters)

    function getGroupKey(emp: any): { key: string; label: string } {
      const h = jh(emp)
      switch (groupBy) {
        case 'department':
          return { key: h.department_id ?? '__none__', label: (h.departments as any)?.name ?? 'Unassigned' }
        case 'location':
          return { key: h.work_location_id ?? '__none__', label: (h.work_locations as any)?.name ?? 'Unassigned' }
        case 'designation':
          return { key: h.designation_id ?? '__none__', label: (h.designations as any)?.name ?? 'Unassigned' }
        case 'grade':
          return { key: h.grade_id ?? '__none__', label: (h.grades as any)?.name ?? 'Unassigned' }
        case 'gender': {
          const g = genderOf(emp)
          return { key: g ?? 'not_specified', label: g ? titleCase(g) : 'Not Specified' }
        }
        case 'employment_type':
          return { key: h.employment_type ?? 'unknown', label: h.employment_type ? titleCase(h.employment_type) : 'Unknown' }
        case 'site': {
          const s = siteOf(emp)
          return { key: s.id ?? '__none__', label: s.name ?? 'Unassigned' }
        }
        case 'region': {
          const s = siteOf(emp)
          return { key: s.region ?? '__none__', label: s.region ?? 'Unassigned' }
        }
        case 'zone': {
          const s = siteOf(emp)
          return { key: s.zone ?? '__none__', label: s.zone ?? 'Unassigned' }
        }
        case 'site_type': {
          const s = siteOf(emp)
          return { key: s.site_type ?? '__none__', label: s.site_type ? titleCase(s.site_type) : 'Unassigned' }
        }
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
      if (jh(emp).confirmation_date) g.confirmed++; else g.on_probation++
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
        total_confirmed:    employees.filter(e => jh(e).confirmation_date).length,
        total_probation:    employees.filter(e => !jh(e).confirmation_date).length,
        total_new_joiners:  joiners.length,
        avg_tenure_months:  total > 0 ? r2(totalTenureDays / total / 30.44) : 0,
      },
      by_group,
    })
  })
}
