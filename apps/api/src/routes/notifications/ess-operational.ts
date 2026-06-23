/**
 * Advanced ESS Operational Experience
 *
 * GET /ess/operational-summary    — attendance + leave + payroll impact preview
 * GET /ess/workforce-notifications — actionable risk signals for the employee
 * GET /ess/schedule-fairness      — shift / OT fairness vs team
 * GET /ess/upcoming-payroll-impact — LOP projection for current month
 * GET /ess/workload-balance       — daily work-hour distribution (last 30 days)
 *
 * All routes require authentication.
 * Resolves employee_id from profiles table via req.userId.
 * All calculations use safe defaults (0 / null) when data is missing — never crashes.
 */

import type { FastifyInstance } from 'fastify'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns { year, month } and ISO range strings for the current calendar month. */
function currentMonthRange(): { from: string; to: string; year: number; month: number } {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1               // 1-based
  const pad   = (n: number) => String(n).padStart(2, '0')
  const from  = `${year}-${pad(month)}-01`
  // last day of month: day 0 of next month
  const lastDay = new Date(year, month, 0).getDate()
  const to      = `${year}-${pad(month)}-${pad(lastDay)}`
  return { from, to, year, month }
}

/** Returns the ISO date string for N days ago. */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Parses HH:MM:SS or HH:MM duration strings to total minutes (0 on error). */
function durationToMinutes(duration: string | null | undefined): number {
  if (!duration) return 0
  const parts = String(duration).split(':').map(Number)
  if (parts.length < 2) return 0
  const [h = 0, m = 0] = parts
  return h * 60 + m
}

/** Safely divide, returning 0 if denominator is 0. */
function safeDivide(num: number, den: number): number {
  return den === 0 ? 0 : num / den
}

// ── No-employee-record response helper ────────────────────────────────────────

function noEmployeeRecord(reply: any) {
  return reply.code(404).send({
    error:   'EMPLOYEE_NOT_LINKED',
    message: 'Your profile is not linked to an employee record.',
  })
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default async function essOperationalRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /ess/operational-summary ───────────────────────────────────────────

  fastify.get('/operational-summary', auth, async (req: any, reply) => {
    // Resolve employee_id
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (profileErr || !profile?.employee_id) return noEmployeeRecord(reply)
    const employeeId = profile.employee_id as string

    const { from, to, year, month } = currentMonthRange()

    // Attendance for current month
    const { data: attendance } = await fastify.supabase
      .from('attendance_daily')
      .select('status, is_late:late_minutes, total_ot_hours:overtime_minutes, is_payable, work_duration:work_hours')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('date', from)
      .lte('date', to)

    const rows = (attendance ?? []) as any[]

    let present_days  = 0
    let absent_days   = 0
    let late_days     = 0
    let total_ot_hours = 0

    for (const r of rows) {
      const status = (r.status as string) ?? ''
      if (status === 'present' || status === 'half_day') present_days++
      if (status === 'absent')                            absent_days++
      if (r.is_late)                                      late_days++
      total_ot_hours += Number(r.total_ot_hours ?? 0) / 60   // overtime_minutes → hours
    }

    const lop_days = absent_days

    // Leave balances
    const { data: leaveBalances } = await fastify.supabase
      .from('employee_leave_balance')
      .select('leave_type_id, balance_days:balance, leave_types(name)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    const leave_balance_by_type = ((leaveBalances ?? []) as any[]).map((lb) => ({
      leave_type_id:   lb.leave_type_id,
      leave_type_name: lb.leave_types?.name ?? null,
      balance_days:    Number(lb.balance_days ?? 0),
    }))

    // Compensation data for payroll preview — table is employee_compensations (plural)
    // ctc_monthly is the stored column; daily_rate and hourly_rate are derived
    const { data: compData } = await fastify.supabase
      .from('employee_compensations')
      .select('ctc_monthly')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const grossSalary = Number(compData?.ctc_monthly ?? 0)
    const dailyRate   = grossSalary > 0 ? grossSalary / 26 : 0
    const hourlyRate  = dailyRate   > 0 ? dailyRate   / 8  : 0

    const lop_amount = lop_days * dailyRate
    const ot_amount  = total_ot_hours * 1.5 * hourlyRate
    const estimated_net_payable = Math.max(0, grossSalary - lop_amount + ot_amount)

    // Warnings
    const warnings: string[] = []
    if (lop_days > 0)           warnings.push(`You have ${lop_days} LOP day(s) this month which may impact your salary.`)
    if (late_days > 3)          warnings.push(`You were late ${late_days} times this month.`)
    if (total_ot_hours > 40)    warnings.push(`High overtime hours (${total_ot_hours.toFixed(1)}h) detected this month.`)
    if (leave_balance_by_type.some((lb) => lb.balance_days < 2)) {
      warnings.push('One or more of your leave balances is running low (< 2 days).')
    }

    return reply.send({
      employee_id:           employeeId,
      period:                { year, month, from, to },
      present_days,
      absent_days,
      late_days,
      lop_days,
      total_ot_hours:        Math.round(total_ot_hours * 100) / 100,
      leave_balance_by_type,
      payroll_preview: {
        lop_amount:            Math.round(lop_amount * 100) / 100,
        ot_amount:             Math.round(ot_amount * 100) / 100,
        estimated_net_payable: Math.round(estimated_net_payable * 100) / 100,
      },
      warnings,
    })
  })

  // ── GET /ess/workforce-notifications ──────────────────────────────────────

  fastify.get('/workforce-notifications', auth, async (req: any, reply) => {
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (profileErr || !profile?.employee_id) return noEmployeeRecord(reply)
    const employeeId = profile.employee_id as string

    const notifications: Array<{
      type:        string
      severity:    'info' | 'warning' | 'critical'
      title:       string
      message:     string
      action_hint: string
      date?:       string
      metadata?:   Record<string, unknown>
    }> = []

    // a. Workforce optimization hints: shift_overload / ot_concentration
    const { data: hints } = await fastify.supabase
      .from('workforce_optimization_hints')
      .select('hint_type, created_at')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .in('hint_type', ['consecutive_shift_overload', 'ot_concentration'])
      .order('created_at', { ascending: false })
      .limit(5)

    for (const hint of (hints ?? []) as any[]) {
      if (hint.hint_type === 'consecutive_shift_overload') {
        notifications.push({
          type:        'shift_overload',
          severity:    'warning',
          title:       'Consecutive Shift Overload Detected',
          message:     'You have been assigned consecutive overloaded shifts. Consider requesting a schedule adjustment.',
          action_hint: 'Contact your manager or HR to review your shift schedule.',
          date:        hint.created_at?.slice(0, 10),
          metadata:    hint.details ?? undefined,
        })
      } else if (hint.hint_type === 'ot_concentration') {
        notifications.push({
          type:        'ot_warning',
          severity:    'warning',
          title:       'High Overtime Concentration',
          message:     'Your overtime hours are concentrated in a short period, which may affect your health and work-life balance.',
          action_hint: 'Review your overtime schedule and discuss workload distribution with your manager.',
          date:        hint.created_at?.slice(0, 10),
          metadata:    hint.details ?? undefined,
        })
      }
    }

    // b. Low leave balance (< 2 days)
    const { data: leaveBalances } = await fastify.supabase
      .from('employee_leave_balance')
      .select('balance_days:balance, leave_types(name)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    for (const lb of (leaveBalances ?? []) as any[]) {
      const balance = Number(lb.balance_days ?? 0)
      if (balance < 2) {
        const typeName = lb.leave_types?.name ?? 'Leave'
        notifications.push({
          type:        'low_leave_balance',
          severity:    balance === 0 ? 'critical' : 'warning',
          title:       `Low ${typeName} Balance`,
          message:     `Your ${typeName} balance is ${balance} day(s). Plan your time off carefully.`,
          action_hint: 'Check upcoming holidays or discuss leave planning with HR.',
          metadata:    { leave_type: typeName, balance_days: balance },
        })
      }
    }

    // c. Attendance risk: absent_rate > 20% in last 30 days
    const thirtyDaysAgo = daysAgo(30)
    const { data: recentAttendance } = await fastify.supabase
      .from('attendance_daily')
      .select('status')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('date', thirtyDaysAgo)

    const recentRows    = (recentAttendance ?? []) as any[]
    const totalDays     = recentRows.length
    const absentCount   = recentRows.filter((r) => r.status === 'absent').length
    const absentRate    = safeDivide(absentCount, totalDays)

    if (totalDays > 0 && absentRate > 0.2) {
      notifications.push({
        type:        'attendance_risk',
        severity:    'critical',
        title:       'High Absence Rate',
        message:     `You have been absent ${absentCount} out of ${totalDays} working days in the last 30 days (${Math.round(absentRate * 100)}%).`,
        action_hint: 'Review your attendance record and consult HR if you have any ongoing issues.',
        metadata:    { absent_days: absentCount, total_days: totalDays, absent_rate: Math.round(absentRate * 100) },
      })
    }

    // d. Incomplete punches: no check_out in last 7 days
    const sevenDaysAgo = daysAgo(7)
    const { data: incompleteSessions } = await fastify.supabase
      .from('attendance_logs')
      .select('check_in, check_out, created_at')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('created_at', sevenDaysAgo)
      .not('check_in', 'is', null)
      .is('check_out', null)

    for (const session of (incompleteSessions ?? []) as any[]) {
      notifications.push({
        type:        'incomplete_punch',
        severity:    'warning',
        title:       'Incomplete Attendance Session',
        message:     `You have a missing check-out on ${(session.check_in ?? '').slice(0, 10)}. This may affect your attendance record.`,
        action_hint: 'Submit an attendance regularisation request for this date.',
        date:        (session.check_in ?? '').slice(0, 10),
        metadata:    { check_in: session.check_in },
      })
    }

    return reply.send({ notifications })
  })

  // ── GET /ess/schedule-fairness ─────────────────────────────────────────────

  fastify.get('/schedule-fairness', auth, async (req: any, reply) => {
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (profileErr || !profile?.employee_id) return noEmployeeRecord(reply)
    const employeeId = profile.employee_id as string

    const thirtyDaysAgo = daysAgo(30)

    // Fetch latest shift balance record for this employee
    const { data: shiftBalance } = await fastify.supabase
      .from('workforce_shift_balance')
      .select('weekend_shifts:weekend_shifts_count, night_shifts:night_shifts_count, total_ot_hours, fairness_score:overall_balance_score, period_from:period_start, period_to:period_end')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    const weekend_shifts   = Number(shiftBalance?.weekend_shifts   ?? 0)
    const night_shifts     = Number(shiftBalance?.night_shifts     ?? 0)
    const total_ot_hours   = Number(shiftBalance?.total_ot_hours   ?? 0)
    const team_avg_ot_hours = 0   // not tracked per-row on workforce_shift_balance
    const fairness_score   = Number(shiftBalance?.fairness_score   ?? 0)
    const below_team_average = total_ot_hours < team_avg_ot_hours

    return reply.send({
      weekend_shifts,
      night_shifts,
      total_ot_hours:    Math.round(total_ot_hours * 100) / 100,
      team_avg_ot_hours: Math.round(team_avg_ot_hours * 100) / 100,
      fairness_score:    Math.round(fairness_score * 100) / 100,
      below_team_average,
      period: {
        from: shiftBalance?.period_from ?? thirtyDaysAgo,
        to:   shiftBalance?.period_to   ?? new Date().toISOString().slice(0, 10),
      },
    })
  })

  // ── GET /ess/upcoming-payroll-impact ───────────────────────────────────────

  fastify.get('/upcoming-payroll-impact', auth, async (req: any, reply) => {
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (profileErr || !profile?.employee_id) return noEmployeeRecord(reply)
    const employeeId = profile.employee_id as string

    const { from, to, year, month } = currentMonthRange()

    // Attendance for current month
    const { data: attendance } = await fastify.supabase
      .from('attendance_daily')
      .select('status, is_payable, total_ot_hours:overtime_minutes, date')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('date', from)
      .lte('date', to)

    const rows = (attendance ?? []) as any[]

    // Current LOP: absent rows where is_payable = false (or absent with no pay)
    let current_lop_days = 0
    let current_ot_hours = 0
    const today = new Date()
    const dayOfMonth = today.getDate()

    // Count actual absent+non-payable days so far
    for (const r of rows) {
      const isAbsent    = r.status === 'absent'
      const isNotPayable = r.is_payable === false
      if (isAbsent && isNotPayable) current_lop_days++
      current_ot_hours += Number(r.total_ot_hours ?? 0) / 60   // overtime_minutes → hours
    }

    // Also count absent days where is_payable is not set (treat as LOP-eligible)
    // This handles cases where is_payable hasn't been explicitly set
    const plainAbsentDays = rows.filter((r) => r.status === 'absent' && r.is_payable == null).length
    current_lop_days = Math.max(current_lop_days, rows.filter((r) => r.status === 'absent').length)

    // Projected LOP: extrapolate current rate to end of month
    const totalMonthDays = new Date(year, month, 0).getDate()
    const remainingDays  = Math.max(0, totalMonthDays - dayOfMonth)
    const dailyLopRate   = safeDivide(current_lop_days, dayOfMonth)
    const projected_lop_days = Math.round(current_lop_days + dailyLopRate * remainingDays)

    // Risk level
    let lop_risk_level: 'low' | 'medium' | 'high' = 'low'
    if (projected_lop_days >= 5)       lop_risk_level = 'high'
    else if (projected_lop_days >= 2)  lop_risk_level = 'medium'

    return reply.send({
      current_lop_days,
      projected_lop_days,
      lop_risk_level,
      current_ot_hours:  Math.round(current_ot_hours * 100) / 100,
      payroll_month:     `${year}-${String(month).padStart(2, '0')}`,
    })
  })

  // ── GET /ess/workload-balance ──────────────────────────────────────────────

  fastify.get('/workload-balance', auth, async (req: any, reply) => {
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (profileErr || !profile?.employee_id) return noEmployeeRecord(reply)
    const employeeId = profile.employee_id as string

    const thirtyDaysAgo = daysAgo(30)

    const { data: attendance } = await fastify.supabase
      .from('attendance_daily')
      .select('work_duration:work_hours, status, date')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('date', thirtyDaysAgo)
      .in('status', ['present', 'half_day'])

    const rows = (attendance ?? []) as any[]

    // Convert work_duration to hours
    const workHoursPerDay = rows.map((r) => {
      return Number(r.work_duration ?? 0)   // work_hours is already in hours
    })

    const totalDays     = workHoursPerDay.length
    const totalHours    = workHoursPerDay.reduce((a, b) => a + b, 0)
    const avg_work_hours = Math.round(safeDivide(totalHours, totalDays) * 100) / 100
    const max_work_hours = totalDays > 0
      ? Math.round(Math.max(...workHoursPerDay) * 100) / 100
      : 0

    const overload_days = workHoursPerDay.filter((h) => h > 10).length   // > 10h
    const short_days    = workHoursPerDay.filter((h) => h > 0 && h < 7).length // < 7h
    const normal_days   = workHoursPerDay.filter((h) => h >= 7 && h <= 10).length

    // Balance score: 100 if avg is 8h, penalise for overload/short days
    const overloadPenalty = overload_days * 5
    const shortPenalty    = short_days    * 3
    const balance_score   = Math.max(0, Math.min(100, 100 - overloadPenalty - shortPenalty))

    return reply.send({
      avg_work_hours,
      max_work_hours,
      overload_days,
      normal_days,
      short_days,
      balance_score,
      period: {
        from: thirtyDaysAgo,
        to:   new Date().toISOString().slice(0, 10),
      },
    })
  })
}
