import { cn } from '@/lib/utils'
import { Clock, CalendarOff, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export interface ShiftInfo {
  name: string
  code?: string | null
  start_time: string   // "HH:MM:SS"
  end_time: string
  weekly_off_days?: number[]
}

interface ScheduleCardProps {
  shift?: ShiftInfo | null
  todayRoster?: ShiftInfo | null    // override for today
  upcomingDates?: Array<{ date: string; label: string; type: 'holiday' | 'leave' | 'roster' }>
  className?: string
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ScheduleCard({ shift, todayRoster, upcomingDates, className }: ScheduleCardProps) {
  const activeShift = todayRoster ?? shift
  // Local calendar day, not UTC — weekly_off_days are business/local days;
  // getUTCDay() would read as the previous day for IST tenants during the
  // 00:00-05:29 local window, misreporting a work day as the weekly off.
  const todayDow = new Date().getDay()
  const isWeeklyOff = activeShift?.weekly_off_days?.includes(todayDow)

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {/* Today's shift */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Today's Shift</p>
          {activeShift ? (
            <p className="text-[13px] font-semibold text-foreground mt-0.5">{activeShift.name}</p>
          ) : (
            <p className="text-[13px] text-muted-foreground mt-0.5">No shift assigned</p>
          )}
        </div>
        {todayRoster && (
          <Badge variant="outline" className="text-[10px] rounded-full">Override</Badge>
        )}
        {isWeeklyOff && (
          <Badge variant="secondary" className="text-[10px] rounded-full">Weekly Off</Badge>
        )}
      </div>

      {activeShift && !isWeeklyOff && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtTime(activeShift.start_time)} – {fmtTime(activeShift.end_time)}
          </span>
          {activeShift.code && (
            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{activeShift.code}</span>
          )}
        </div>
      )}

      {/* Weekly off days */}
      {activeShift?.weekly_off_days && activeShift.weekly_off_days.length > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <CalendarOff className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            Off: {activeShift.weekly_off_days.map(d => DOW[d]).join(', ')}
          </p>
        </div>
      )}

      {/* Upcoming events */}
      {upcomingDates && upcomingDates.length > 0 && (
        <>
          <div className="border-t border-border/50 pt-3 mt-1">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">Upcoming</p>
            <div className="space-y-1.5">
              {upcomingDates.slice(0, 3).map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Sun className={cn(
                    'h-3 w-3 flex-shrink-0',
                    d.type === 'holiday' ? 'text-info' : d.type === 'leave' ? 'text-warning' : 'text-primary',
                  )} />
                  <span className="text-foreground font-medium">{d.label}</span>
                  <span className="text-muted-foreground ml-auto">{d.date}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
