/**
 * Canonical Attendance Dataset — /datasets/attendance
 *
 * Single source of truth for attendance aggregates consumed by:
 *   - Reports page
 *   - WorkforceAnalytics
 *   - ManagerDashboard
 *
 * GET /datasets/attendance
 *   ?month         YYYY-MM           — derive from/to as first/last day of month
 *   ?from          YYYY-MM-DD        — start date (used when month not provided)
 *   ?to            YYYY-MM-DD        — end date   (used when month not provided)
 *   ?department_id UUID              — optional filter
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

function r2(n: number): number { return Math.round(n * 100) / 100 }
function r1(n: number): number { return Math.round(n * 10) / 10 }

/** Last calendar day of a YYYY-MM string, returned as YYYY-MM-DD */
function lastDayOf(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${yyyyMM}-${String(last).padStart(2, '0')}`
}

export default async function attendanceDataset(fastify: FastifyInstance) {
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

    // ── Date range resolution ───────────────────────────────────────────────────
    let fromDate: string
    let toDate: string
    let monthParam: string | null = null

    if (q.month) {
      monthParam = q.month
      fromDate   = `${q.month}-01`
      toDate     = lastDayOf(q.month)
    } else {
      const now  = new Date()
      const curM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      fromDate   = q.from ?? `${curM}-01`
      toDate     = q.to   ?? lastDayOf(curM)
    }

    const deptFilter = q.department_id ?? q.filter_department_id ?? null

    // ── Query: attendance rows in range ─────────────────────────────────────────
    const { data: attRows, error: attErr } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, date, status, work_hours, late_minutes, overtime_minutes')
      .eq('tenant_id', tid)
      .gte('date', fromDate)
      .lte('date', toDate)

    if (attErr) return reply.code(500).send({ error: 'DB_ERROR', message: attErr.message })

    // ── Query: employees with current job history ───────────────────────────────
    let empQuery = fastify.supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name,
        job_history!job_history_employee_id_fkey (
          department_id, employment_type, is_current,
          departments ( name )
        )
      `)
      .eq('tenant_id', tid)
      .eq('job_history.is_current', true)
      .neq('status', 'separated')

    if (deptFilter) empQuery = empQuery.eq('job_history.department_id', deptFilter)

    const { data: employees } = await empQuery

    // ── Build employee map ──────────────────────────────────────────────────────
    const empMap: Record<string, { code: string; name: string; dept: string; deptId: string; type: string }> = {}
    for (const emp of (employees ?? []) as any[]) {
      const jh = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      empMap[emp.id] = {
        code: emp.employee_code,
        name: `${emp.first_name} ${emp.last_name}`.trim(),
        dept: (jh?.departments as { name?: string } | null)?.name ?? 'Unassigned',
        deptId: (jh?.department_id as string | null) ?? '__none__',
        type: jh?.employment_type ?? 'unknown',
      }
    }

    const eligibleIds = new Set(Object.keys(empMap))

    // ── working_days = distinct dates in the filtered result set ────────────────
    const distinctDates = new Set<string>()
    for (const row of (attRows ?? []) as any[]) {
      if (eligibleIds.has(row.employee_id)) distinctDates.add(row.date)
    }
    const workingDays = distinctDates.size || 1   // avoid /0

    // ── Per-employee aggregation ────────────────────────────────────────────────
    type EmpAgg = {
      employee_id: string
      employee_code: string
      full_name: string
      department: string
      department_id: string
      employment_type: string
      present_days: number
      absent_days: number
      late_arrivals: number
      half_days: number
      work_hours: number
      late_minutes: number
      overtime_minutes: number
      lop_days: number
      attendance_rate: number
    }

    const empAgg: Record<string, EmpAgg> = {}

    for (const row of (attRows ?? []) as any[]) {
      if (!eligibleIds.has(row.employee_id)) continue

      if (!empAgg[row.employee_id]) {
        const em = empMap[row.employee_id]!
        empAgg[row.employee_id] = {
          employee_id:      row.employee_id,
          employee_code:    em.code,
          full_name:        em.name,
          department:       em.dept,
          department_id:    em.deptId,
          employment_type:  em.type,
          present_days:     0,
          absent_days:      0,
          late_arrivals:    0,
          half_days:        0,
          work_hours:       0,
          late_minutes:     0,
          overtime_minutes: 0,
          lop_days:         0,
          attendance_rate:  0,
        }
      }

      const agg = empAgg[row.employee_id]!
      agg.work_hours        += Number(row.work_hours        ?? 0)
      agg.late_minutes      += Number(row.late_minutes      ?? 0)
      agg.overtime_minutes  += Number(row.overtime_minutes  ?? 0)

      switch (row.status) {
        case 'present':  agg.present_days++;  break
        case 'late':     agg.late_arrivals++; break
        case 'absent':   agg.absent_days++;   break
        case 'half_day': agg.half_days++;     break
      }
    }

    // Derive lop_days and attendance_rate per employee
    const empList: EmpAgg[] = Object.values(empAgg).map(agg => {
      const lopDays = r2(agg.absent_days + 0.5 * agg.half_days)
      const attRate = r2((agg.present_days + agg.late_arrivals) / workingDays * 100)
      return {
        ...agg,
        work_hours:       r1(agg.work_hours),
        lop_days:         lopDays,
        attendance_rate:  attRate,
      }
    }).sort((a, b) => a.employee_code.localeCompare(b.employee_code))

    // ── Summary aggregation ─────────────────────────────────────────────────────
    const totalPresentDays  = empList.reduce((s, e) => s + e.present_days + e.late_arrivals, 0)
    const totalAbsentDays   = empList.reduce((s, e) => s + e.absent_days, 0)
    const totalLateArrivals = empList.reduce((s, e) => s + e.late_arrivals, 0)
    const totalHalfDays     = empList.reduce((s, e) => s + e.half_days, 0)
    const totalWorkHours    = r1(empList.reduce((s, e) => s + e.work_hours, 0))
    const totalOTHours      = r1(empList.reduce((s, e) => s + e.overtime_minutes, 0) / 60)
    const totalLop          = r2(empList.reduce((s, e) => s + e.lop_days, 0))

    const avgAttRate = empList.length > 0
      ? r2(empList.reduce((s, e) => s + e.attendance_rate, 0) / empList.length)
      : 0

    const lateRows = (attRows ?? []) as any[]
    const lateMinsArr = lateRows
      .filter(r => eligibleIds.has(r.employee_id) && Number(r.late_minutes ?? 0) > 0)
      .map(r => Number(r.late_minutes))
    const avgLateMins = lateMinsArr.length > 0
      ? r2(lateMinsArr.reduce((s, v) => s + v, 0) / lateMinsArr.length)
      : 0

    // ── Response ────────────────────────────────────────────────────────────────
    // ── By department rollup (for Data Explorer / "highest absenteeism") ────────
    type DeptAtt = {
      key: string; label: string; employee_count: number
      present: number; absent: number; lop: number; attSum: number
    }
    const deptAgg: Record<string, DeptAtt> = {}
    for (const e of empList) {
      const k = e.department_id || '__none__'
      if (!deptAgg[k]) deptAgg[k] = { key: k, label: e.department, employee_count: 0, present: 0, absent: 0, lop: 0, attSum: 0 }
      const d = deptAgg[k]
      d.employee_count++
      d.present += e.present_days + e.late_arrivals
      d.absent  += e.absent_days
      d.lop     += e.lop_days
      d.attSum  += e.attendance_rate
    }
    const byDepartment = Object.values(deptAgg)
      .map(d => ({
        key:                 d.key,
        label:               d.label,
        employee_count:      d.employee_count,
        avg_attendance_rate: d.employee_count > 0 ? r2(d.attSum / d.employee_count) : 0,
        total_lop_days:      r2(d.lop),
        total_absent_days:   d.absent,
        absenteeism_pct:     (d.employee_count * workingDays) > 0
          ? r2((d.absent / (d.employee_count * workingDays)) * 100)
          : 0,
      }))
      .sort((a, b) => b.absenteeism_pct - a.absenteeism_pct)

    return reply.send({
      meta: {
        from:          fromDate,
        to:            toDate,
        month:         monthParam,
        department_id: deptFilter,
        generated_at:  new Date().toISOString(),
      },
      by_department: byDepartment,
      summary: {
        employee_count:         empList.length,
        working_days:           workingDays,
        total_present_days:     totalPresentDays,
        total_absent_days:      totalAbsentDays,
        total_late_arrivals:    totalLateArrivals,
        total_half_days:        totalHalfDays,
        total_work_hours:       totalWorkHours,
        total_overtime_hours:   totalOTHours,
        total_lop_days:         totalLop,
        avg_attendance_rate:    avgAttRate,
        avg_late_minutes:       avgLateMins,
      },
      employees: empList,
    })
  })
}
