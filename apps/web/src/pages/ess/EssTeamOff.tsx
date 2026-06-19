/**
 * EssTeamOff — /ess/whos-off  (ESS-03)
 *
 * "Team Who's Off" calendar. Shows which of your department teammates are on
 * approved leave across a month, overlaid with company holidays so you can see
 * coverage at a glance. Available to every employee.
 *
 * Design: design-system tokens only; month grid built with date-fns.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, format, isSameMonth, isToday,
} from 'date-fns'
import { CalendarOff, ChevronLeft, ChevronRight, Loader2, Users, PartyPopper } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Member {
  employee_id:   string
  name:          string
  employee_code: string | null
  is_self:       boolean
}

interface LeaveEntry {
  id:          string
  employee_id: string
  from_date:   string   // YYYY-MM-DD
  to_date:     string   // YYYY-MM-DD
  half_day:    boolean
  days:        number
  leave_type:  string
}

interface WhosOffResponse {
  data: {
    members:    Member[]
    leave:      LeaveEntry[]
    department: string | null
  }
}

interface HolidayItem { id: string; date: string; name: string }
interface HolidaysResponse { data: HolidayItem[]; year: number }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

// Stable initials + colour per person for the avatar chips
function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}
const AVATAR_COLORS = [
  'bg-info/15 text-info', 'bg-success/15 text-success',
  'bg-warning/15 text-warning', 'bg-accent-violet/15 text-accent-violet',
  'bg-destructive/15 text-destructive', 'bg-accent-teal/15 text-accent-teal',
  'bg-primary/15 text-primary', 'bg-accent-teal/15 text-accent-teal',
]
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function EssTeamOff() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))

  const monthStart = startOfMonth(cursor)
  const monthEnd   = endOfMonth(cursor)
  const gridStart  = startOfWeek(monthStart)
  const gridEnd    = endOfWeek(monthEnd)
  const year       = cursor.getFullYear()

  const { data, isLoading, isError, refetch } = useQuery<WhosOffResponse>({
    queryKey: ['ess-whos-off', fmt(gridStart), fmt(gridEnd)],
    queryFn:  () => api.get(`/attendance/leave/whos-off?from=${fmt(gridStart)}&to=${fmt(gridEnd)}`),
    staleTime: 60_000,
  })

  const { data: holidayData } = useQuery<HolidaysResponse>({
    queryKey: ['ess-whos-off-holidays', year],
    queryFn:  () => api.get(`/leave/holidays?year=${year}`),
    staleTime: 5 * 60_000,
  })

  const members    = useMemo(() => data?.data.members ?? [], [data])
  const leave      = useMemo(() => data?.data.leave ?? [], [data])
  const department = data?.data.department ?? null

  const memberById = useMemo(
    () => new Map(members.map(m => [m.employee_id, m])),
    [members],
  )
  const holidayByDate = useMemo(
    () => new Map((holidayData?.data ?? []).map(h => [h.date, h.name])),
    [holidayData],
  )

  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  )

  // For a given day, who is off (approved leave covering that day)
  function offOn(day: Date): LeaveEntry[] {
    const ds = fmt(day)
    return leave.filter(l => l.from_date <= ds && l.to_date >= ds)
  }

  // Month summary: people off at least once this visible month
  const offThisMonth = useMemo(() => {
    const ids = new Set<string>()
    for (const l of leave) {
      // any overlap with the actual month (not the padded grid)
      if (l.from_date <= fmt(monthEnd) && l.to_date >= fmt(monthStart)) ids.add(l.employee_id)
    }
    return ids.size
  }, [leave, monthStart, monthEnd])

  return (
    <PageContainer>
      <PageHeader
        title="Team — Who's Off"
        subtitle={department ? `Approved leave across ${department}` : 'Approved leave across your team'}
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setCursor(c => addMonths(c, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[120px] text-center text-sm font-semibold">
              {format(cursor, 'MMMM yyyy')}
            </div>
            <Button size="sm" variant="outline" onClick={() => setCursor(c => addMonths(c, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCursor(startOfMonth(new Date()))}>
              Today
            </Button>
          </div>
        }
      />

      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-muted-foreground">
        <Badge variant="secondary" className="gap-1">
          <Users className="h-3 w-3" /> {members.length} teammate{members.length === 1 ? '' : 's'}
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <CalendarOff className="h-3 w-3" /> {offThisMonth} off this month
        </Badge>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary/15" /> On leave
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning/15" /> Holiday
        </span>
      </div>

      <SectionCard title="Calendar" icon={<CalendarOff className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading team calendar…
          </div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Couldn't load the team calendar.
            <Button size="sm" variant="outline" className="ml-2" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              {/* Weekday header */}
              <div className="grid grid-cols-7 border-b border-border">
                {WEEKDAYS.map(d => (
                  <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-center">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7">
                {days.map(day => {
                  const ds          = fmt(day)
                  const inMonth     = isSameMonth(day, cursor)
                  const holidayName = holidayByDate.get(ds)
                  const offToday    = offOn(day)

                  return (
                    <div
                      key={ds}
                      className={cn(
                        'min-h-[92px] border-b border-r border-border p-1.5 align-top',
                        !inMonth && 'bg-muted/30',
                        holidayName && 'bg-warning/10',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn(
                          'text-[11px] font-medium',
                          !inMonth ? 'text-muted-foreground/50' : 'text-foreground',
                          isToday(day) && 'flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground',
                        )}>
                          {format(day, 'd')}
                        </span>
                        {holidayName && (
                          <PartyPopper className="h-3 w-3 text-warning flex-shrink-0" />
                        )}
                      </div>

                      {holidayName && (
                        <p className="mt-0.5 truncate text-[9px] font-medium text-warning" title={holidayName}>
                          {holidayName}
                        </p>
                      )}

                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {offToday.slice(0, 4).map(l => {
                          const m = memberById.get(l.employee_id)
                          const label = m?.name ?? 'Teammate'
                          return (
                            <span
                              key={l.id}
                              title={`${label} — ${l.leave_type}${l.half_day ? ' (half day)' : ''}`}
                              className={cn(
                                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold ring-1 ring-white',
                                colorFor(l.employee_id),
                                m?.is_self && 'ring-2 ring-primary',
                              )}
                            >
                              {initials(label)}
                            </span>
                          )
                        })}
                        {offToday.length > 4 && (
                          <span className="inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[8px] font-semibold text-muted-foreground">
                            +{offToday.length - 4}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* This month's leave list */}
      <SectionCard title="Approved leave this month" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
        {(() => {
          const ms = fmt(monthStart), meStr = fmt(monthEnd)
          const monthLeave = leave
            .filter(l => l.from_date <= meStr && l.to_date >= ms)
            .sort((a, b) => a.from_date.localeCompare(b.from_date))
          if (monthLeave.length === 0) {
            return <p className="py-6 text-center text-sm text-muted-foreground">No teammates on approved leave this month. 🎉</p>
          }
          return (
            <div className="divide-y divide-border">
              {monthLeave.map(l => {
                const m = memberById.get(l.employee_id)
                return (
                  <div key={l.id} className="flex items-center gap-3 py-2">
                    <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold', colorFor(l.employee_id))}>
                      {initials(m?.name ?? '?')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m?.name ?? 'Teammate'}
                        {m?.is_self && <span className="ml-1.5 text-[10px] text-primary">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{l.leave_type}</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-medium">
                        {format(new Date(`${l.from_date}T12:00:00`), 'd MMM')}
                        {l.to_date !== l.from_date && ` – ${format(new Date(`${l.to_date}T12:00:00`), 'd MMM')}`}
                      </p>
                      <p className="text-muted-foreground">
                        {l.days} day{l.days === 1 ? '' : 's'}{l.half_day ? ' · half' : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </SectionCard>
    </PageContainer>
  )
}
