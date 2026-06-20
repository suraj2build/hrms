/**
 * attendance-trend.ts — shared decision-support summary for approvals.
 *
 * Both the leave-context and regularisation-context drawers need the same
 * "how has this person been attending lately?" snapshot so a manager can
 * approve faster. This computes it from attendance_daily over a rolling window.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AttendanceTrend {
  window_days:      number
  working_days:     number
  present:          number
  late:             number
  absent:           number
  half_day:         number
  attendance_rate:  number   // 0–100
  punctuality_rate: number   // 0–100
  avg_hours:        number    // average hours on days actually worked
  recent: Array<{ date: string; status: string; work_hours: number; late_minutes: number }>
}

export async function fetchAttendanceTrend(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  days = 30,
): Promise<AttendanceTrend> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data } = await supabase
    .from('attendance_daily')
    .select('date, status, work_hours, late_minutes')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', sinceStr)
    .order('date', { ascending: false })

  const rows = (data ?? []) as Array<{ date: string; status: string; work_hours: number; late_minutes: number }>

  let working = 0, present = 0, late = 0, absent = 0, half = 0, totalHours = 0, workedDays = 0
  for (const r of rows) {
    const s = (r.status ?? '').toLowerCase()
    if (s === 'holiday' || s === 'weekend') continue
    working++
    if (s === 'present')        { present++; workedDays++ }
    else if (s === 'late')      { present++; late++; workedDays++ }
    else if (s === 'half_day')  { present++; half++; workedDays++ }
    else if (s === 'absent')    { absent++ }
    if (Number(r.work_hours) > 0) totalHours += Number(r.work_hours)
  }

  const round1 = (n: number) => Math.round(n * 10) / 10

  return {
    window_days:      days,
    working_days:     working,
    present, late, absent, half_day: half,
    attendance_rate:  working > 0 ? round1((present / working) * 100) : 0,
    punctuality_rate: present > 0 ? round1(((present - late) / present) * 100) : 100,
    avg_hours:        workedDays > 0 ? round1(totalHours / workedDays) : 0,
    recent: rows.slice(0, 14).map(r => ({
      date:         r.date,
      status:       r.status,
      work_hours:   Number(r.work_hours ?? 0),
      late_minutes: Number(r.late_minutes ?? 0),
    })),
  }
}
