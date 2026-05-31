import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useOperationalContext } from '@/contexts/OperationalContext'

// ── Types ──────────────────────────────────────────────────────────────────────

interface UncoveredShift {
  date: string
  shift_name: string
  employee_count_needed: number
}

interface UncoveredShiftsResponse {
  data: UncoveredShift[]
}

interface WeeklyOffConflict {
  employee_name: string
  conflict_date: string
  conflict_type: string
}

interface WeeklyOffConflictsResponse {
  data: WeeklyOffConflict[]
}

interface Holiday {
  date: string
  name: string
  day: string
}

interface HolidaysResponse {
  data: Holiday[]
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading">
      <div className="animate-pulse bg-muted rounded h-3 w-3/4" />
      <div className="animate-pulse bg-muted rounded h-3 w-1/2" />
      <div className="animate-pulse bg-muted rounded h-3 w-2/3" />
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}

function Section({ title, badge, children }: SectionProps) {
  return (
    <div className="px-3 py-2.5 border-b border-border last:border-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export const RosterContextPanel = React.memo(function RosterContextPanel() {
  const { activeRosterMonth } = useOperationalContext()

  const STALE = 30_000
  const REFETCH = 60_000

  const uncoveredQuery = useQuery<UncoveredShiftsResponse, Error>({
    queryKey: ['roster', 'uncovered-shifts', activeRosterMonth],
    queryFn: () =>
      api.get<UncoveredShiftsResponse>(
        `/roster/uncovered-shifts?month=${activeRosterMonth}&limit=5`,
      ),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const conflictsQuery = useQuery<WeeklyOffConflictsResponse, Error>({
    queryKey: ['roster', 'weekly-off-conflicts', activeRosterMonth],
    queryFn: () =>
      api.get<WeeklyOffConflictsResponse>(
        `/roster/weekly-off-conflicts?month=${activeRosterMonth}&limit=5`,
      ),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const holidaysQuery = useQuery<HolidaysResponse, Error>({
    queryKey: ['roster', 'holidays', activeRosterMonth],
    queryFn: () =>
      api.get<HolidaysResponse>(
        `/holidays?month=${activeRosterMonth}&upcoming=true&limit=3`,
      ),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  // ── Section 1 — Uncovered Shifts ─────────────────────────────────────────

  const uncovered = uncoveredQuery.data?.data ?? []

  // ── Section 3 — Weekly Off Conflicts ─────────────────────────────────────

  const conflicts = conflictsQuery.data?.data ?? []

  // ── Section 4 — Upcoming Holidays ────────────────────────────────────────

  const holidays = holidaysQuery.data?.data ?? []

  return (
    <div className="text-sm">
      {/* Section 1 — Uncovered Shifts */}
      <Section title="Uncovered Shifts">
        {uncoveredQuery.isLoading ? (
          <SectionSkeleton />
        ) : uncovered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            All shifts covered.
          </p>
        ) : (
          <div className="space-y-1">
            {uncovered.map((shift, idx) => (
              <div key={idx} className="text-xs">
                <span className="text-foreground">{shift.date}</span>
                <span className="text-muted-foreground">
                  {' '}· {shift.shift_name} · needs {shift.employee_count_needed}{' '}
                  {shift.employee_count_needed === 1 ? 'person' : 'people'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Section 3 — Weekly Off Conflicts */}
      <Section title="Weekly Off Conflicts">
        {conflictsQuery.isLoading ? (
          <SectionSkeleton />
        ) : conflicts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No conflicts detected.</p>
        ) : (
          <div className="space-y-1">
            {conflicts.map((c, idx) => (
              <div key={idx} className="text-xs">
                <span className="text-foreground">{c.employee_name}</span>
                <span className="text-muted-foreground">
                  {' '}· {c.conflict_date} · {c.conflict_type}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Section 4 — Upcoming Holidays */}
      <Section title="Upcoming Holidays">
        {holidaysQuery.isLoading ? (
          <SectionSkeleton />
        ) : holidays.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No upcoming holidays this month.
          </p>
        ) : (
          <div className="space-y-1">
            {holidays.map((h, idx) => (
              <div key={idx} className="text-xs">
                <span className="text-foreground">{h.name}</span>
                <span className="text-muted-foreground">
                  {' '}· {h.date} ({h.day})
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
})
