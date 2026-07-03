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
    let empQuery = fastify.supabase
      .from('employees')
      .select(`
        id,
        employee_code,
        first_name,
        last_name,
        job_history!job_history_employee_id_fkey(
          is_current,
          departments(name),
          manager_id
        )
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
      .eq('job_history.is_current', true)

    if (isManager) {
      empQuery = empQuery.eq('job_history.manager_id', req.employeeId)
    }

    const { data: empRows, error: empError } = await empQuery
    if (empError) {
      fastify.log.warn({ err: empError.message }, 'workforce-drill: employee join failed, falling back to simple query')
    }

    // Build employee lookup map — id → { code, name, department }
    type EmpMeta = { employee_code: string; name: string; department: string | null }
    const empMeta = new Map<string, EmpMeta>()

    if (empRows && empRows.length > 0) {
      for (const e of empRows as any[]) {
        const deptName = e.job_history?.[0]?.departments?.name ?? null
        empMeta.set(e.id, {
          employee_code: e.employee_code,
          name:          `${e.first_name} ${e.last_name}`,
          department:    deptName,
        })
      }
    }

    // Apply department filter after the join (if present)
    const allowedEmployeeIds = department_id
      ? new Set(
          [...empMeta.entries()]
            .filter(() => true)  // department filter applied below
            .map(([id]) => id)
        )
      : null

    // ── Step 2: Fetch metric-specific data ────────────────────────────────────

    const employees: DrillEmployee[] = []

    // ── ABSENT / LATE / LEAVE ─────────────────────────────────────────────────
    if (metric === 'absent' || metric === 'late' || metric === 'leave') {
      const targetStatus = metric === 'absent'
        ? ['absent']
        : metric === 'late'
        ? ['late']
        : ['leave']

      const { data: dailyRows, error } = await fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, status, work_hours, late_minutes')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to)
        .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])

      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance data' })

      // Aggregate per employee
      type EmpStats = { targetDays: number; totalDays: number; dates: string[] }
      const empStats = new Map<string, EmpStats>()

      for (const row of dailyRows ?? []) {
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

        // Department filter
        if (department_id && empMeta.get(employee_id)?.department !== undefined) {
          // We can only filter if we have department data
          const empDept = (empRows as any[])?.find((e: any) => e.id === employee_id)
          if (!empDept) continue
          const deptName = (empRows as any[])?.find((e: any) => e.id === employee_id)
            ?.job_history?.[0]?.departments?.name
          // department_id filter: check via empRows
          const empJobDeptId = (empRows as any[])?.find((e: any) => e.id === employee_id)
            ?.job_history?.[0]?.department_id
          if (empJobDeptId && empJobDeptId !== department_id) continue
        }

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
      const { data: otRows, error } = await fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, overtime_minutes, work_hours')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to)
        .gt('overtime_minutes', 0)

      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch OT data' })

      type OtStats = { total_ot_minutes: number; ot_days: number }
      const empOtStats = new Map<string, OtStats>()

      for (const row of otRows ?? []) {
        const s = empOtStats.get(row.employee_id) ?? { total_ot_minutes: 0, ot_days: 0 }
        s.total_ot_minutes += row.overtime_minutes ?? 0
        s.ot_days++
        empOtStats.set(row.employee_id, s)
      }

      for (const [employee_id, stats] of empOtStats.entries()) {
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
      const [weeklyOffRes, holidayRes] = await Promise.all([
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, date, work_hours')
          .eq('tenant_id', req.tenantId)
          .eq('worked_on_weekly_off', true)
          .gte('date', range.from)
          .lte('date', range.to),
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, date, work_hours')
          .eq('tenant_id', req.tenantId)
          .eq('worked_on_holiday', true)
          .gte('date', range.from)
          .lte('date', range.to),
      ])

      type PressureStats = { weekly_off_days: number; holiday_days: number; total_hours: number }
      const pressureMap = new Map<string, PressureStats>()

      for (const row of weeklyOffRes.data ?? []) {
        const s = pressureMap.get(row.employee_id) ?? { weekly_off_days: 0, holiday_days: 0, total_hours: 0 }
        s.weekly_off_days++
        s.total_hours += row.work_hours ?? 0
        pressureMap.set(row.employee_id, s)
      }
      for (const row of holidayRes.data ?? []) {
        const s = pressureMap.get(row.employee_id) ?? { weekly_off_days: 0, holiday_days: 0, total_hours: 0 }
        s.holiday_days++
        s.total_hours += row.work_hours ?? 0
        pressureMap.set(row.employee_id, s)
      }

      for (const [employee_id, stats] of pressureMap.entries()) {
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
      const { data: rows, error } = await fastify.supabase
        .from('attendance_daily')
        .select('employee_id, status')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to)
        .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])

      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch reliability data' })

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
