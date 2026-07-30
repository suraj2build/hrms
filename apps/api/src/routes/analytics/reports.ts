/**
 * Reports API — /reports/*
 *
 * Four report endpoints covering the full HR reporting surface:
 *
 *  GET /reports/headcount        — Headcount & Attrition
 *  GET /reports/attendance-summary — Attendance & Leave utilisation
 *  GET /reports/salary-register  — Monthly salary register
 *  GET /reports/statutory        — India statutory compliance (PF, ESI, PT, LWF)
 *
 * All endpoints:
 *   - Require Authorization: Bearer <jwt>
 *   - Are scoped to req.tenantId (full tenant isolation)
 *   - Accept optional query filters documented per-endpoint
 *   - Return JSON; the frontend handles CSV serialisation client-side
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows }  from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

// Tenant-local "now", anchored at UTC midnight of the tenant's local calendar
// date — so callers must use the UTC getters (getUTCFullYear/getUTCMonth) to
// stay in the tenant's timezone rather than the server's.
async function tenantNow(fastify: FastifyInstance, tenantId: string): Promise<Date> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  const todayLocal = getLocalDate(new Date().toISOString(), tz)
  return new Date(todayLocal + 'T00:00:00Z')
}

// Not every month has 31 days — a bare `${month}-31` literal against a
// TIMESTAMPTZ column throws "date/time field value out of range" for
// Apr/Jun/Sep/Nov/Feb, 500ing the endpoint whenever `to` falls in one of
// those months. Compute the real last day instead (matches the fix already
// applied in payroll/arrears.ts and workspace/stats.ts).
function monthEndDate(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

export default async function reportsRoutes(fastify: FastifyInstance) {
  // All report endpoints expose tenant-wide data (full salary register,
  // statutory PF/ESI/PT with bank/PAN/UAN, headcount). They are restricted to
  // HR admins — a plain employee or manager must never read org-wide pay data.
  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }
  const auth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ── 1. Headcount & Attrition ────────────────────────────────────────────────
  //
  // Query params:
  //   from          YYYY-MM   start month  (default: 12 months ago)
  //   to            YYYY-MM   end month    (default: current month)
  //   department_id UUID      filter by department
  //   employment_type TEXT    filter by employment type

  fastify.get('/reports/headcount', auth, async (req, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    // Date range — default last 12 months
    const now      = await tenantNow(fastify, tid)
    const toMonth  = q.to   ? `${q.to}-01`   : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
    const fromDate = q.from ? new Date(`${q.from}-01`) : new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1))
    const fromMonth = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, '0')}-01`

    // Build employee query
    let empQuery = fastify.supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name, joining_date, status, created_at,
        job_history!job_history_employee_id_fkey (
          department_id, employment_type, is_current,
          departments ( name )
        )
      `)
      .eq('tenant_id', tid)
      .eq('job_history.is_current', true)

    if (q.department_id) empQuery = empQuery.eq('job_history.department_id', q.department_id)
    if (q.employment_type) empQuery = empQuery.eq('job_history.employment_type', q.employment_type)
    // ORDER BY is required for stable multi-page results with fetchAllRows
    empQuery = empQuery.order('id')

    let employees: any[]
    try {
      employees = await fetchAllRows((from, to) => (empQuery as any).range(from, to))
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch headcount data')
    }

    // Fetch separations in range for attrition calculation
    const separations = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name, updated_at, status')
        .eq('tenant_id', tid)
        .eq('status', 'separated')
        .gte('updated_at', fromMonth)
        .lte('updated_at', monthEndDate(toMonth.slice(0, 7)))
        .range(from, to),
    )

    // Build monthly breakdown
    const months: Record<string, { month: string; joiners: number; separations: number }> = {}
    const d = new Date(fromMonth)
    const end = new Date(toMonth)
    while (d <= end) {
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      months[key] = { month: key, joiners: 0, separations: 0 }
      d.setUTCMonth(d.getUTCMonth() + 1)
    }

    for (const emp of employees) {
      const jd = emp.joining_date ? emp.joining_date.slice(0, 7) : null
      if (jd && months[jd]) months[jd].joiners++
    }
    for (const sep of separations) {
      const sd = sep.updated_at ? sep.updated_at.slice(0, 7) : null
      if (sd && months[sd]) months[sd].separations++
    }

    // Department breakdown (current headcount)
    const deptBreakdown: Record<string, number> = {}
    const typeBreakdown: Record<string, number> = {}
    for (const emp of employees) {
      if (emp.status === 'separated') continue
      const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      const deptName = (jh?.departments as { name?: string } | null)?.name ?? 'Unassigned'
      const empType  = jh?.employment_type ?? 'unknown'
      deptBreakdown[deptName] = (deptBreakdown[deptName] ?? 0) + 1
      typeBreakdown[empType]  = (typeBreakdown[empType] ?? 0) + 1
    }

    const activeCount = employees.filter(e => e.status === 'active').length

    return reply.send({
      summary: {
        total_employees:  employees.length,
        active_employees: activeCount,
        total_separations: separations.length,
      },
      monthly_trend: Object.values(months),
      department_breakdown: Object.entries(deptBreakdown)
        .map(([dept, count]) => ({ dept, count }))
        .sort((a, b) => b.count - a.count),
      employment_type_breakdown: Object.entries(typeBreakdown)
        .map(([type, count]) => ({ type, count })),
      employees: employees.map(emp => {
        const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
        return {
          employee_code: emp.employee_code,
          name:          `${emp.first_name} ${emp.last_name}`,
          department:    (jh?.departments as { name?: string } | null)?.name ?? '—',
          employment_type: jh?.employment_type ?? '—',
          joining_date:  emp.joining_date,
          status:        emp.status,
        }
      }),
    })
  })

  // ── 2. Attendance & Leave Summary ───────────────────────────────────────────
  //
  // Query params:
  //   from          YYYY-MM-DD  start date (default: first of current month)
  //   to            YYYY-MM-DD  end date   (default: today)
  //   employee_id   UUID        filter single employee
  //   department_id UUID        filter by department

  fastify.get('/reports/attendance-summary', auth, async (req, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    const now   = await tenantNow(fastify, tid)
    const today = now.toISOString().slice(0, 10)
    const fromDate = q.from ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
    const toDate   = q.to   ?? today

    // Fetch attendance_daily rows in range
    const attRows = await fetchAllRows((from, to) => {
      let aq = fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, status, work_hours, late_minutes, overtime_minutes')
        .eq('tenant_id', tid)
        .gte('date', fromDate)
        .lte('date', toDate)
      if (q.employee_id) aq = aq.eq('employee_id', q.employee_id)
      return aq.range(from, to)
    })

    // Fetch leave requests in range (APPROVED only)
    const leaveRows = await fetchAllRows((from, to) => {
      let lq = fastify.supabase
        .from('leave_requests')
        .select(`
          employee_id, computed_days, status,
          leave_types ( name )
        `)
        .eq('tenant_id', tid)
        .eq('status', 'APPROVED')
        .lte('from_date', toDate)
        .gte('to_date', fromDate)
      if (q.employee_id) lq = lq.eq('employee_id', q.employee_id)
      return lq.range(from, to)
    })

    // Fetch employee names — optionally filtered by department
    const employees = await fetchAllRows((from, to) => {
      let eq2 = fastify.supabase
        .from('employees')
        .select(`
          id, employee_code, first_name, last_name,
          job_history!job_history_employee_id_fkey ( department_id, is_current, departments ( name ) )
        `)
        .eq('tenant_id', tid)
        .eq('job_history.is_current', true)
        .neq('status', 'separated')
      if (q.department_id) eq2 = eq2.eq('job_history.department_id', q.department_id)
      return eq2.range(from, to)
    })

    // Build employee map
    const empMap: Record<string, { code: string; name: string; dept: string }> = {}
    for (const emp of employees) {
      const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      empMap[emp.id] = {
        code: emp.employee_code,
        name: `${emp.first_name} ${emp.last_name}`,
        dept: (jh?.departments as { name?: string } | null)?.name ?? '—',
      }
    }

    // Aggregate per employee
    const summary: Record<string, {
      employee_id: string; employee_code: string; name: string; department: string;
      present: number; absent: number; late: number; half_day: number; holiday: number; weekend: number;
      total_work_hours: number; total_late_minutes: number; total_overtime_minutes: number;
      leave_days: number;
    }> = {}

    // Only include employees found in empMap (respects department filter)
    const eligibleIds = new Set(Object.keys(empMap))

    for (const row of attRows) {
      if (!eligibleIds.has(row.employee_id)) continue
      if (!summary[row.employee_id]) {
        const emp = empMap[row.employee_id]
        summary[row.employee_id] = {
          employee_id: row.employee_id,
          employee_code: emp?.code ?? '',
          name: emp?.name ?? row.employee_id,
          department: emp?.dept ?? '—',
          present: 0, absent: 0, late: 0, half_day: 0, holiday: 0, weekend: 0,
          total_work_hours: 0, total_late_minutes: 0, total_overtime_minutes: 0,
          leave_days: 0,
        }
      }
      const s = summary[row.employee_id]
      s.total_work_hours       += Number(row.work_hours ?? 0)
      s.total_late_minutes     += Number(row.late_minutes ?? 0)
      s.total_overtime_minutes += Number(row.overtime_minutes ?? 0)
      switch (row.status) {
        case 'present':  s.present++;  break
        case 'absent':   s.absent++;   break
        case 'late':     s.late++;     break
        case 'half_day': s.half_day++; break
        case 'holiday':  s.holiday++;  break
        case 'weekend':  s.weekend++;  break
      }
    }

    // Add leave days
    for (const lr of leaveRows) {
      if (!eligibleIds.has(lr.employee_id)) continue
      if (!summary[lr.employee_id]) {
        const emp = empMap[lr.employee_id]
        if (!emp) continue
        summary[lr.employee_id] = {
          employee_id: lr.employee_id,
          employee_code: emp.code,
          name: emp.name,
          department: emp.dept,
          present: 0, absent: 0, late: 0, half_day: 0, holiday: 0, weekend: 0,
          total_work_hours: 0, total_late_minutes: 0, total_overtime_minutes: 0,
          leave_days: 0,
        }
      }
      summary[lr.employee_id].leave_days += Number(lr.computed_days ?? 0)
    }

    const rows = Object.values(summary).sort((a, b) => a.name.localeCompare(b.name))

    // Totals
    const totals = rows.reduce((acc, r) => ({
      present:               acc.present + r.present,
      absent:                acc.absent + r.absent,
      late:                  acc.late + r.late,
      half_day:              acc.half_day + r.half_day,
      total_work_hours:      Math.round((acc.total_work_hours + r.total_work_hours) * 10) / 10,
      total_late_minutes:    acc.total_late_minutes + r.total_late_minutes,
      total_overtime_minutes:acc.total_overtime_minutes + r.total_overtime_minutes,
      leave_days:            acc.leave_days + r.leave_days,
    }), { present:0, absent:0, late:0, half_day:0, total_work_hours:0, total_late_minutes:0, total_overtime_minutes:0, leave_days:0 })

    return reply.send({ from: fromDate, to: toDate, totals, rows })
  })

  // ── 3. Salary Register ──────────────────────────────────────────────────────
  //
  // Query params:
  //   month         YYYY-MM   payroll month (default: current month)
  //   department_id UUID      filter by department
  //   employment_type TEXT    filter by employment type

  fastify.get('/reports/salary-register', auth, async (req, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    const now   = await tenantNow(fastify, tid)
    const month = q.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

    // Fetch active compensations with their components
    let comps: any[]
    try {
      comps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_compensations')
          .select(`
            id, employee_id, ctc_annual, ctc_monthly, effective_from,
            employee_compensation_components (
              computed_monthly, computed_annual, sequence,
              salary_components ( name, code, component_type )
            )
          `)
          .eq('tenant_id', tid)
          .eq('is_active', true)
          .range(from, to),
      )
    } catch (compErr) {
      return serverError(req, reply, compErr, ErrorCode.QUERY_FAILED, 'Failed to fetch salary register data')
    }

    // Fetch employees with job history for name + dept
    let empQuerySR = fastify.supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name,
        job_history!job_history_employee_id_fkey ( department_id, employment_type, is_current, departments ( name ) )
      `)
      .eq('tenant_id', tid)
      .eq('job_history.is_current', true)
      .neq('status', 'separated') as any

    if (q.department_id)   empQuerySR = empQuerySR.eq('job_history.department_id', q.department_id)
    if (q.employment_type) empQuerySR = empQuerySR.eq('job_history.employment_type', q.employment_type)

    const employees: any[] = await fetchAllRows((from, to) => empQuerySR.range(from, to))

    const eligibleIds = new Set(employees.map((e: any) => e.id))
    const empMap: Record<string, { code: string; name: string; dept: string; type: string }> = {}
    for (const emp of employees) {
      const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      empMap[emp.id] = {
        code: emp.employee_code,
        name: `${emp.first_name} ${emp.last_name}`,
        dept: (jh?.departments as { name?: string } | null)?.name ?? '—',
        type: jh?.employment_type ?? '—',
      }
    }

    // Collect all unique component names (for table columns)
    const componentNames = new Set<string>()
    for (const comp of comps) {
      for (const cc of (comp.employee_compensation_components as any[]) ?? []) {
        const sc = cc.salary_components
        if (sc?.name) componentNames.add(sc.name)
      }
    }
    const componentCols = Array.from(componentNames).sort()

    // Build rows
    const rows = []
    let totalCTC = 0
    let totalMonthly = 0

    for (const comp of comps) {
      if (!eligibleIds.has(comp.employee_id)) continue
      const emp = empMap[comp.employee_id]
      if (!emp) continue

      const componentMap: Record<string, number> = {}
      for (const cc of (comp.employee_compensation_components as any[]) ?? []) {
        const sc = cc.salary_components
        if (sc?.name) componentMap[sc.name] = Number(cc.computed_monthly ?? 0)
      }

      totalCTC     += Number(comp.ctc_annual ?? 0)
      totalMonthly += Number(comp.ctc_monthly ?? 0)

      rows.push({
        employee_code:  emp.code,
        name:           emp.name,
        department:     emp.dept,
        employment_type: emp.type,
        ctc_annual:     Number(comp.ctc_annual ?? 0),
        ctc_monthly:    Number(comp.ctc_monthly ?? 0),
        effective_from: comp.effective_from,
        components:     componentMap,
      })
    }

    rows.sort((a, b) => a.name.localeCompare(b.name))

    return reply.send({
      month,
      component_columns: componentCols,
      totals: {
        employee_count: rows.length,
        total_ctc_annual:  Math.round(totalCTC),
        total_ctc_monthly: Math.round(totalMonthly),
      },
      rows,
    })
  })

  // ── 4. Statutory Compliance Register ───────────────────────────────────────
  //
  // India-specific: PF, ESI, PT, LWF
  //
  // Query params:
  //   department_id   UUID    filter by department
  //   employment_type TEXT    filter by employment type
  //   scheme          TEXT    pf | esi | pt | lwf  (filter to one scheme)

  fastify.get('/reports/statutory', auth, async (req, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    // Employee bank + statutory details
    let statutory: any[]
    try {
      statutory = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_bank_statutory')
          .select(`
            employee_id,
            pan:pan_number, aadhaar:aadhaar_number, uan:uan_number, pf_number, esi_number,
            pt_applicable, lwf_applicable, tax_regime
          `)
          .eq('tenant_id', tid)
          .range(from, to),
      )
    } catch (statErr) {
      return serverError(req, reply, statErr, ErrorCode.QUERY_FAILED, 'Failed to fetch statutory report data')
    }

    // Active compensations for gross/CTC
    const statComps = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('employee_compensations')
        .select('employee_id, ctc_monthly, ctc_annual')
        .eq('tenant_id', tid)
        .eq('is_active', true)
        .range(from, to),
    )

    const compMap: Record<string, { ctc_monthly: number; ctc_annual: number }> = {}
    for (const c of statComps) {
      compMap[c.employee_id] = {
        ctc_monthly: Number(c.ctc_monthly ?? 0),
        ctc_annual:  Number(c.ctc_annual  ?? 0),
      }
    }

    // Employees with job history
    let empQueryStat = fastify.supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name,
        job_history!job_history_employee_id_fkey ( department_id, employment_type, is_current, departments ( name ) )
      `)
      .eq('tenant_id', tid)
      .eq('job_history.is_current', true)
      .neq('status', 'separated') as any

    if (q.department_id)   empQueryStat = empQueryStat.eq('job_history.department_id', q.department_id)
    if (q.employment_type) empQueryStat = empQueryStat.eq('job_history.employment_type', q.employment_type)

    const employees: any[] = await fetchAllRows((from, to) => empQueryStat.range(from, to))

    const eligibleIds = new Set(employees.map((e: any) => e.id))
    const empMap: Record<string, { code: string; name: string; dept: string; type: string }> = {}
    for (const emp of employees) {
      const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      empMap[emp.id] = {
        code: emp.employee_code,
        name: `${emp.first_name} ${emp.last_name}`,
        dept: (jh?.departments as { name?: string } | null)?.name ?? '—',
        type: jh?.employment_type ?? '—',
      }
    }

    // Build statutory map
    const statMap: Record<string, any> = {}
    for (const s of statutory) {
      statMap[s.employee_id] = s
    }

    const rows = []
    for (const emp of employees) {
      if (!eligibleIds.has(emp.id)) continue
      const info = empMap[emp.id]
      const stat = statMap[emp.id] ?? {}
      const comp = compMap[emp.id]  ?? { ctc_monthly: 0, ctc_annual: 0 }

      // PF: 12% of basic (approx 50% of CTC monthly as basic estimate) — capped at ₹15,000 basic
      const approxBasicMonthly = Math.min(comp.ctc_monthly * 0.5, 15000)
      const pf_employee = stat.uan ? Math.round(approxBasicMonthly * 0.12) : null
      const pf_employer = stat.uan ? Math.round(approxBasicMonthly * 0.12) : null

      // ESI: applicable if gross ≤ ₹21,000/month; employee 0.75%, employer 3.25%
      const esiApplicable = stat.esi_number && comp.ctc_monthly <= 21000
      const esi_employee = esiApplicable ? Math.round(comp.ctc_monthly * 0.0075) : null
      const esi_employer = esiApplicable ? Math.round(comp.ctc_monthly * 0.0325) : null

      const row = {
        employee_code:    info.code,
        name:             info.name,
        department:       info.dept,
        employment_type:  info.type,
        ctc_monthly:      comp.ctc_monthly,
        ctc_annual:       comp.ctc_annual,
        // PF
        uan:              stat.uan       ?? null,
        pf_number:        stat.pf_number ?? null,
        pf_employee_monthly: pf_employee,
        pf_employer_monthly: pf_employer,
        // ESI
        esi_number:       stat.esi_number ?? null,
        esi_applicable:   esiApplicable   ?? false,
        esi_employee_monthly: esi_employee,
        esi_employer_monthly: esi_employer,
        // PT
        pan:              stat.pan         ?? null,
        pt_applicable:    stat.pt_applicable  ?? false,
        // LWF
        lwf_applicable:   stat.lwf_applicable ?? false,
        // Tax
        tax_regime:       stat.tax_regime ?? '—',
      }

      // Filter by scheme if requested
      if (q.scheme) {
        const scheme = q.scheme.toLowerCase()
        if (scheme === 'pf'  && !stat.uan)        continue
        if (scheme === 'esi' && !esiApplicable)    continue
        if (scheme === 'pt'  && !stat.pt_applicable)  continue
        if (scheme === 'lwf' && !stat.lwf_applicable) continue
      }

      rows.push(row)
    }

    rows.sort((a, b) => a.name.localeCompare(b.name))

    // Statutory summary totals
    const totals = {
      employee_count:        rows.length,
      pf_employees:          rows.filter(r => r.uan).length,
      esi_employees:         rows.filter(r => r.esi_applicable).length,
      pt_employees:          rows.filter(r => r.pt_applicable).length,
      lwf_employees:         rows.filter(r => r.lwf_applicable).length,
      total_pf_employee:     rows.reduce((s, r) => s + (r.pf_employee_monthly ?? 0), 0),
      total_pf_employer:     rows.reduce((s, r) => s + (r.pf_employer_monthly ?? 0), 0),
      total_esi_employee:    rows.reduce((s, r) => s + (r.esi_employee_monthly ?? 0), 0),
      total_esi_employer:    rows.reduce((s, r) => s + (r.esi_employer_monthly ?? 0), 0),
    }

    return reply.send({ totals, rows })
  })
}
