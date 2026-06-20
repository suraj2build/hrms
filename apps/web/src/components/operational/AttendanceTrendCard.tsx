/**
 * AttendanceTrendCard
 *
 * Compact decision-support snapshot of an employee's recent attendance, shared
 * by the leave-context and regularisation-context approval drawers. Shows a stat
 * strip (avg hours, punctuality, present/late/absent) plus a mini per-day bar
 * row so a manager can read the working pattern at a glance.
 */
import { Activity } from 'lucide-react'

export interface AttendanceTrend {
  window_days:      number
  working_days:     number
  present:          number
  late:             number
  absent:           number
  half_day:         number
  attendance_rate:  number
  punctuality_rate: number
  avg_hours:        number
  recent: Array<{ date: string; status: string; work_hours: number; late_minutes: number }>
}

const BAR_COLOR: Record<string, string> = {
  present:  '#10b981',
  late:     '#f59e0b',
  half_day: '#3b82f6',
  absent:   '#f43f5e',
  holiday:  '#cbd5e1',
  weekend:  '#e2e8f0',
}

function rateColor(v: number): string {
  return v >= 90 ? '#10b981' : v >= 75 ? '#f59e0b' : '#f43f5e'
}

function dayNum(d: string): string {
  try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { day: '2-digit' }) }
  catch { return d.slice(-2) }
}

export function AttendanceTrendCard({ trend }: { trend: AttendanceTrend }) {
  // Oldest → newest for the bar row (API returns newest first).
  const bars = [...trend.recent].reverse()
  const maxH = Math.max(8, ...bars.map(b => b.work_hours))

  const stat = (label: string, value: string | number, color = 'var(--foreground)') => (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  )

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        Attendance · last {trend.window_days} days
      </h3>

      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="grid grid-cols-5 gap-1 mb-3">
          {stat('Avg hrs', trend.avg_hours)}
          {stat('Punctual', `${trend.punctuality_rate}%`, rateColor(trend.punctuality_rate))}
          {stat('Present', `${trend.present}/${trend.working_days}`)}
          {stat('Late', trend.late, trend.late > 0 ? '#f59e0b' : 'var(--foreground)')}
          {stat('Absent', trend.absent, trend.absent > 0 ? '#f43f5e' : 'var(--foreground)')}
        </div>

        {bars.length > 0 ? (
          <div className="flex items-end justify-between gap-[3px] h-14">
            {bars.map((b, i) => {
              const s = (b.status ?? '').toLowerCase()
              const isOff = s === 'weekend' || s === 'holiday'
              const h = isOff ? 4 : Math.max(4, Math.round((b.work_hours / maxH) * 48))
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${b.date} · ${s || 'n/a'} · ${b.work_hours}h`}>
                  <div
                    className="w-full rounded-sm"
                    style={{ height: h, background: BAR_COLOR[s] ?? '#e2e8f0', opacity: isOff ? 0.5 : 1 }}
                  />
                  <span className="text-[8px] text-muted-foreground/70 tabular-nums">{dayNum(b.date)}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">No attendance records in this window.</p>
        )}
      </div>
    </section>
  )
}
