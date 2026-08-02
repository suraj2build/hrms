/**
 * Workforce Drill-Down API
 *
 * Transforms aggregated metrics into actionable, per-employee investigation data.
 * Every chart/trend in WorkforceAnalytics.tsx is wired to this endpoint so analysts
 * can click a data point and immediately see which employees drive the metric.
 *
 * GET /analytics/workforce/drill
 *   ?metric=absent|late|ot|pressure|reliability|leave
 *   &from=YYYY-MM-DD  (required)
 *   &to=YYYY-MM-DD    (required)
 *   &week=YYYY-Wnn    (optional — narrows to a specific ISO week)
 *   &department_id=UUID (optional — department filter)
 *   &severity=high|medium|low (optional — for pressure/reliability metrics)
 *   &limit=50 (default 50, max 200)
 *
 * Response:
 *   { metric, range, week?, filters, employees: DrillEmployee[], summary }
 *
 * DrillEmployee:
 *   { employee_id, employee_code, name, department, metric_value, metric_label,
 *     severity, investigation_links: { profile, attendance } }
 */

import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { HR_ADMIN_ROLES }      from '../../lib/rbac.js'
import { fetchAllRows }        from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
// ── Types ─────────────────────────────────────────────────────────────────────

type MetricType = 'absent' | 'late' | 'ot' | 'pressure' | 'reliability' | 'leave'
type Severity   = 'high' | 'medium' | 'low'

interface DrillEmployee {
  employee_id:    string
  employee_code:  string
  name:           string
  department:     string | null
  metric_value:   number
  metric_label:   string
  severity:       Severity
  detail:         Record<string, number | string>
  investigation_links: {
    profile:    string   // /employees/:id
    attendance: string   // /my-attendance or /attendance/:id
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const dateRe = /^\d{4}-\d{2}-\d{2}$/
const weekRe = /^\d{4}-W\d{2}$/

function isoWeekBounds(weekStr: string): { from: string; to: string } {
  // e.g. "2025-W04" → Monday and Sunday of that week
  const [yearStr, weekNumStr] = weekStr.split('-W')
  const year    = parseInt(yearStr)
  const weekNum = parseInt(weekNumStr)

  // Jan 4 is always in week 1 (ISO 8601)
  const jan4    = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7   // 1=Mon … 7=Sun
  const monday  = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (weekNum - 1) * 7)
  const sunday  = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  return {
    from: monday.toISOString().slice(0, 10),
    to:   sunday.toISOString().slice(0, 10),
  }
}

function severityFromRate(rate: number, highThresh: number, medThresh: number): Severity {
  if (rate >= highThresh) return 'high'
  if (rate >= medThresh)  return 'medium'
  return 'low'
}

function severityFromScore(score: number): Severity {
  if (score < 60) return 'high'
  if (score < 75) return 'medium'
  return 'low'
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function workforceDrillRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  const querySchema = z.object({
    metric:        z.enum(['absent', 'late', 'ot', 'pressure', 'reliability', 'leave']),
    from:          z.string().regex(dateRe),
    to:            z.string().regex(dateRe),
    week:          z.string().regex(weekRe).optional(),
    department_id: z.string().uuid().optional(),
    severity:      z.enum(['high', 'medium', 'low']).optional(),
    limit:         z.coerce.number().int().min(1).max(200).default(50),
  })

  fastify.get('/analytics/workforce/drill', auth, async (req: any, reply) => {
    // Only admin + manager can drill (managers get team scope applied separately)
    const isAdmin   = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
    const isManager = req.userRole === 'manager'
    if (!isAdmin && !isManager) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or admin access required' })
    }

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { metric, week, department_id, severity: severityFilter, limit } = parsed.data
    // If a specific ISO week is given, narrow the range to that week's bounds
    const range = week
      ? isoWeekBounds(week)
      : { from: parsed.data.from, to: parsed.data.to }

    // ── Step 1: Resolve employee set (with names + departments) ──────────────
    // We always join through employees → job_history to get department + code.
    // manager scope: only employees in their team (manager_id = req.employeeId)
    // Paginated — an unbounded .select() truncates at PostgREST's 1,000-row
    // ceiling for a large tenant, silently dropping employees from every
    // drill-down metric below.
    let empRows: any[]
    try {
      empRows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('employees')
          .select(`
            id,
            employee_code,
            first_name,
            last_name,
            job_history!job_history_employee_id_fkey(
              is_current,
              department_id,
              departments(name),
              manager_id
            )
          `)
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .eq('job_history.is_current', true)

        if (isManager) q = q.eq('job_history.manager_id', req.employeeId)

        return q.range(from, to)
      })
    } catch (err) {
      // Manager scoping depends entirely on empMeta being populated (see the
      // isAllowed() guard below) — silently continuing with an empty set here
      // would make a manager's drill-down look like a clean "no issues" empty
      // list instead of surfacing the query failure.
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch employee data')
    }

    // Build employee lookup map — id → { code, name, department }. When
    // isManager, the query above already scoped job_history.manager_id, so
    // empMeta only contains this manager's team — every metric loop below
    // must skip any employee_id NOT present here, otherwise a manager could
    // see tenant-wide metric values (OT hours, reliability scores, etc.) for
    // employees outside their team even though display fields degrade to
    // "Unknown"/"N/A".
    type EmpMeta = { employee_code: string; name: string; department: string | null; department_id: string | null }
    const empMeta = new Map<string, EmpMeta>()

    if (empRows && empRows.length > 0) {
      for (const e of empRows as any[]) {
        const deptName = e.job_history?.[0]?.departments?.name ?? null
        const deptId   = e.job_history?.[0]?.department_id ?? null
        empMeta.set(e.id, {
          employee_code: e.employee_code,
          name:          `${e.first_name} ${e.last_name}`,
          department:    deptName,
          department_id: deptId,
        })
      }
    }

    // Applies to every metric loop below: manager-scope + department filter.
    function isAllowed(employee_id: string): boolean {
      if (isManager && !empMeta.has(employee_id)) return false
      if (department_id && empMeta.get(employee_id)?.department_id !== department_id) return false
      return true
    }

    // ── Step 2: Fetch metric-specific data ────────────────────────────────────

    const employees: DrillEmployee[] = []

    // ── ABSENT / LATE / LEAVE ─────────────────────────────────────────────────
    if (metric === 'absent' || metric === 'late' || metric === 'leave') {
      const targetStatus = metric === 'absent'
        ? ['absent']
        : metric === 'late'
        ? ['late']
        : ['leave']

      let dailyRows: any[]
      try {
        dailyRows = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, date, status, work_hours, late_minutes')
            .eq('tenant_id', req.tenantId)
            .gte('date', range.from)
            .lte('date', range.to)
            .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])
            .range(from, to),
        )
      } catch (err) {
        return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance data')
      }

      // Aggregate per employee
      type EmpStats = { targetDays: number; totalDays: number; dates: string[] }
      const empStats = new Map<string, EmpStats>()

      for (const row of dailyRows) {
        const s = empStats.get(row.employee_id) ?? { targetDays: 0, totalDays: 0, dates: [] }
        s.totalDays++
        if (targetStatus.includes(row.status)) {
          s.targetDays++
          s.dates.push(row.date)
        }
        empStats.set(row.employee_id, s)
      }

      for (const [employee_id, stats] of empStats.entries()) {
        if (stats.targetDays === 0) continue
        if (!isAllowed(employee_id)) continue

        const rate     = stats.totalDays > 0 ? stats.targetDays / stats.totalDays : 0
        const pct      = parseFloat((rate * 100).toFixed(1))
        const severity = severityFromRate(rate, 0.3, 0.15)

        if (severityFilter && severity !== severityFilter) continue

        const meta = empMeta.get(employee_id)

        employees.push({
          employee_id,
          employee_code:  meta?.employee_code ?? 'N/A',
          name:           meta?.name ?? 'Unknown',
          department:     meta?.department ?? null,
          metric_value:   pct,
          metric_label:   `${pct}% (${stats.targetDays} / ${stats.totalDays} days)`,
          severity,
          detail: {
            target_days: stats.targetDays,
            total_days:  stats.totalDays,
            rate_pct:    pct,
            dates_count: stats.dates.length,
          },
          investigation_links: {
            profile:    `/employees/${employee_id}`,
            attendance: `/attendance?employee_id=${employee_id}&from=${range.from}&to=${range.to}`,
          },
        })
      }

      // Sort worst first
      employees.sort((a, b) => b.metric_value - a.metric_value)
    }

    // ── OT (overtime dependency) ──────────────────────────────────────────────
    if (metric === 'ot') {
      let otRows: any[]
      try {
        otRows = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, date, overtime_minutes, work_hours')
            .eq('tenant_id', req.tenantId)
            .gte('date', range.from)
            .lte('date', range.to)
            .gt('overtime_minutes', 0)
            .range(from, to),
        )
      } catch (err) {
        return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch OT data')
      }

      type OtStats = { total_ot_minutes: number; ot_days: number }
      const empOtStats = new Map<string, OtStats>()

      for (const row of otRows) {
        const s = empOtStats.get(row.employee_id) ?? { total_ot_minutes: 0, ot_days: 0 }
        s.total_ot_minutes += row.overtime_minutes ?? 0
        s.ot_days++
        empOtStats.set(row.employee_id, s)
      }

      for (const [employee_id, stats] of empOtStats.entries()) {
        if (!isAllowed(employee_id)) continue
        const totalHours = parseFloat((stats.total_ot_minutes / 60).toFixed(1))
        // Severity: high if > 40 OT hours, medium if > 20, low otherwise
        const severity: Severity = totalHours >= 40 ? 'high' : totalHours >= 20 ? 'medium' : 'low'

        if (severityFilter && severity !== severityFilter) continue

        const meta = empMeta.get(employee_id)

        employees.push({
          employee_id,
          employee_code:  meta?.employee_code ?? 'N/A',
          name:           meta?.name ?? 'Unknown',
          department:     meta?.department ?? null,
          metric_value:   totalHours,
          metric_label:   `${totalHours}h OT (${stats.ot_days} days)`,
          severity,
          detail: {
            total_ot_hours:   totalHours,
            total_ot_minutes: stats.total_ot_minutes,
            ot_days:          stats.ot_days,
          },
          investigation_links: {
            profile:    `/employees/${employee_id}`,
            attendance: `/attendance?employee_id=${employee_id}&from=${range.from}&to=${range.to}`,
          },
        })
      }

      employees.sort((a, b) => b.metric_value - a.metric_value)
    }

    // ── STAFFING PRESSURE (worked on weekly-off / holiday) ────────────────────
    if (metric === 'pressure') {
      const [weeklyOffRows, holidayRows] = await Promise.all([
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, date, work_hours')
            .eq('tenant_id', req.tenantId)
            .eq('worked_on_weekly_off', true)
            .gte('date', range.from)
            .lte('date', range.to)
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, date, work_hours')
            .eq('tenant_id', req.tenantId)
            .eq('worked_on_holiday', true)
            .gte('date', range.from)
            .lte('date', range.to)
            .range(from, to),
        ),
      ])

      type PressureStats = { weekly_off_days: number; holiday_days: number; total_hours: number }
      const pressureMap = new Map<string, PressureStats>()

      for (const row of weeklyOffRows) {
        const s = pressureMap.get(row.employee_id) ?? { weekly_off_days: 0, holiday_days: 0, total_hours: 0 }
        s.weekly_off_days++
        s.total_hours += row.work_hours ?? 0
        pressureMap.set(row.employee_id, s)
      }
      for (const row of holidayRows) {
        const s = pressureMap.get(row.employee_id) ?? { weekly_off_days: 0, holiday_days: 0, total_hours: 0 }
        s.holiday_days++
        s.total_hours += row.work_hours ?? 0
        pressureMap.set(row.employee_id, s)
      }

      for (const [employee_id, stats] of pressureMap.entries()) {
        if (!isAllowed(employee_id)) continue
        const totalPressureDays = stats.weekly_off_days + stats.holiday_days
        const severity: Severity = totalPressureDays >= 5 ? 'high' : totalPressureDays >= 2 ? 'medium' : 'low'

        if (severityFilter && severity !== severityFilter) continue

        const meta = empMeta.get(employee_id)

        employees.push({
          employee_id,
          employee_code:  meta?.employee_code ?? 'N/A',
          name:           meta?.name ?? 'Unknown',
          department:     meta?.department ?? null,
          metric_value:   totalPressureDays,
          metric_label:   `${totalPressureDays} pressure days (${stats.weekly_off_days} WO + ${stats.holiday_days} holiday)`,
          severity,
          detail: {
            weekly_off_days:   stats.weekly_off_days,
            holiday_days:      stats.holiday_days,
            total_pressure_days: totalPressureDays,
          },
          investigation_links: {
            profile:    `/employees/${employee_id}`,
            attendance: `/attendance?employee_id=${employee_id}&from=${range.from}&to=${range.to}`,
          },
        })
      }

      employees.sort((a, b) => b.metric_value - a.metric_value)
    }

    // ── RELIABILITY SCORE ─────────────────────────────────────────────────────
    if (metric === 'reliability') {
      let rows: any[]
      try {
        rows = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, status')
            .eq('tenant_id', req.tenantId)
            .gte('date', range.from)
            .lte('date', range.to)
            .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])
            .range(from, to),
        )
      } catch (err) {
        return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch reliability data')
      }

      type RelStats = { present: number; absent: number; late: number; total: number }
      const relMap = new Map<string, RelStats>()

      for (const row of rows ?? []) {
        const s = relMap.get(row.employee_id) ?? { present: 0, absent: 0, late: 0, total: 0 }
        s.total++
        if (row.status === 'absent' || row.status === 'leave') s.absent++
        else if (row.status === 'late') { s.present++; s.late++ }
        else s.present++
        relMap.set(row.employee_id, s)
      }

      for (const [employee_id, stats] of relMap.entries()) {
        if (!isAllowed(employee_id)) continue
        const absentRate = stats.total > 0 ? stats.absent / stats.total : 0
        const lateRate   = stats.total > 0 ? stats.late   / stats.total : 0
        const score      = Math.max(0, Math.min(100, Math.round(100 - absentRate * 60 - lateRate * 20)))
        const grade      = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D'
        const severity   = severityFromScore(score)

        if (severityFilter && severity !== severityFilter) continue

        const meta = empMeta.get(employee_id)

        employees.push({
          employee_id,
          employee_code:  meta?.employee_code ?? 'N/A',
          name:           meta?.name ?? 'Unknown',
          department:     meta?.department ?? null,
          metric_value:   score,
          metric_label:   `Score: ${score} (Grade ${grade})`,
          severity,
          detail: {
            score,
            grade,
            absent_rate: parseFloat((absentRate * 100).toFixed(1)),
            late_rate:   parseFloat((lateRate   * 100).toFixed(1)),
            absent_days: stats.absent,
            late_days:   stats.late,
            total_days:  stats.total,
          },
          investigation_links: {
            profile:    `/employees/${employee_id}`,
            attendance: `/attendance?employee_id=${employee_id}&from=${range.from}&to=${range.to}`,
          },
        })
      }

      // Worst scores first for reliability
      employees.sort((a, b) => a.metric_value - b.metric_value)
    }

    // ── Pagination ────────────────────────────────────────────────────────────
    const sliced = employees.slice(0, limit)

    // ── Summary ───────────────────────────────────────────────────────────────
    const severityCounts = sliced.reduce((acc, e) => {
      acc[e.severity] = (acc[e.severity] ?? 0) + 1
      return acc
    }, {} as Record<Severity, number>)

    return reply.send({
      metric,
      range,
      week:    week ?? null,
      filters: { department_id: department_id ?? null, severity: severityFilter ?? null },
      employees: sliced,
      summary: {
        total:    sliced.length,
        severity: {
          high:   severityCounts.high   ?? 0,
          medium: severityCounts.medium ?? 0,
          low:    severityCounts.low    ?? 0,
        },
      },
    })
  })
}
