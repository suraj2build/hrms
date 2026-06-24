/**
 * DailyOperationsWorkspace — Phase UX-6 "Daily Operations Workspace"
 *
 * Unified attendance + payroll daily operations page for payroll ops teams
 * and attendance admins managing 5k+ employees across 100+ sites.
 *
 * Replaces having to navigate between 6+ separate pages for daily work.
 *
 * Tabs:
 *   1 Today              — summary stats, open anomalies, recent activity, quick links
 *   2 Missing Punches    — bulk regularisation workflow
 *   3 OT Review          — overtime spike review & approval
 *   4 Shift Conflicts    — unassigned/roster-change conflicts
 *   5 Leave Conflicts    — collision log + pending/rejected leaves
 *   6 Pending Approvals  — regularisations + corrections combined queue
 *   7 Payroll Blockers   — blockers preventing payroll run
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  LayoutDashboard, Clock, Timer, CalendarX, CalendarOff,
  ClipboardCheck, ShieldAlert, CheckCircle2, AlertTriangle,
  RefreshCw, Users, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn }                           from '@/lib/utils'
import { api }                          from '@/lib/api/client'
import { Button }                       from '@/components/ui/button'
import { Badge }                        from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast }                        from 'sonner'
import { useActivityStream }            from '@/lib/activity/useActivityStream'
import { SEVERITY_COLORS }              from '@/lib/activity/types'
import type { OperationalActivityEvent } from '@/lib/activity/types'
import { EmployeeOperationalProfile }   from '@/components/employee/EmployeeOperationalProfile'

// ── Tab definitions ────────────────────────────────────────────────────────────

type DailyOpsTab =
  | 'today'
  | 'missing-punches'
  | 'ot-review'
  | 'shift-conflicts'
  | 'leave-conflicts'
  | 'pending-approvals'
  | 'payroll-blockers'

const TABS: Array<{ id: DailyOpsTab; label: string; shortcut: string; icon: LucideIcon }> = [
  { id: 'today',             label: 'Today',             shortcut: '1', icon: LayoutDashboard },
  { id: 'missing-punches',   label: 'Missing Punches',   shortcut: '2', icon: Clock           },
  { id: 'ot-review',         label: 'OT Review',         shortcut: '3', icon: Timer           },
  { id: 'shift-conflicts',   label: 'Shift Conflicts',   shortcut: '4', icon: CalendarX       },
  { id: 'leave-conflicts',   label: 'Leave Conflicts',   shortcut: '5', icon: CalendarOff     },
  { id: 'pending-approvals', label: 'Pending Approvals', shortcut: '6', icon: ClipboardCheck  },
  { id: 'payroll-blockers',  label: 'Payroll Blockers',  shortcut: '7', icon: ShieldAlert     },
]

// ── Shared helpers ─────────────────────────────────────────────────────────────

function rowData(item: unknown): Record<string, string> {
  if (typeof item !== 'object' || item === null) return {}
  return Object.fromEntries(
    Object.entries(item as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
  )
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

// ── Shared UI primitives ───────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="rounded-lg border border-border overflow-hidden animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={cn('h-11 border-b border-border bg-muted/30', i === 0 && 'bg-muted/50')} />
      ))}
    </div>
  )
}

function TabTable({
  children,
  isLoading,
}: {
  children: React.ReactNode
  isLoading: boolean
}) {
  if (isLoading) return <TableSkeleton />
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <CheckCircle2 className="h-8 w-8 text-success/50" />
      <p className="text-sm font-medium text-foreground">All clear</p>
      <p className="text-xs text-muted-foreground">No {label} issues found</p>
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground bg-muted/40 border-b border-border', className)}>
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn('px-3 py-2.5 border-b border-border/50 align-middle', className)}>
      {children}
    </td>
  )
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="h-4 min-w-4 px-1 rounded-full bg-destructive text-[9px] text-white font-bold flex items-center justify-center">
      {count > 99 ? '99+' : count}
    </span>
  )
}

// ── Dashboard stats response ───────────────────────────────────────────────────

interface DashStats {
  active_employees:       number
  total_employees:        number
  new_joiners_this_month: number
  separations_this_month: number
}

// ── Tab 1: Today ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, className }: { label: string; value: number | string; icon: LucideIcon; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4 flex items-center gap-3', className)}>
      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
      </div>
    </div>
  )
}

function TodayTab({
  onNavigate,
  allEvents,
  isActivityLoading,
}: {
  onNavigate: (tab: DailyOpsTab) => void
  allEvents: OperationalActivityEvent[]
  isActivityLoading: boolean
}) {
  const { data: dashStats, isLoading: statsLoading } = useQuery({
    queryKey: ['daily-ops-today-stats'],
    queryFn: () => api.get<DashStats>('/analytics/dashboard'),
    staleTime: 5 * 60_000,
  })

  const { data: todayAnomalies, isLoading: anomaliesLoading } = useQuery({
    queryKey: ['daily-ops-today-anomalies'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/anomalies?resolved=false&limit=10')
        .then(r => r.data ?? []),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const missingCount   = useMemo(() => allEvents.filter(e => e.type === 'missing_punch'   && e.status === 'open').length,    [allEvents])
  const pendingCount   = useMemo(() => allEvents.filter(e => e.status === 'pending').length,                                  [allEvents])
  const blockerCount   = useMemo(() => allEvents.filter(e => e.type === 'payroll_blocker' && e.status === 'open').length,    [allEvents])
  const recentActivity = useMemo(() => allEvents.slice(0, 5), [allEvents])

  const quickLinks: Array<{ tab: DailyOpsTab; label: string; count: number; icon: LucideIcon; urgent?: boolean }> = [
    { tab: 'missing-punches',   label: 'Missing Punches',   count: missingCount,  icon: Clock,          urgent: missingCount > 0  },
    { tab: 'pending-approvals', label: 'Pending Approvals', count: pendingCount,  icon: ClipboardCheck, urgent: pendingCount > 5   },
    { tab: 'payroll-blockers',  label: 'Payroll Blockers',  count: blockerCount,  icon: ShieldAlert,    urgent: blockerCount > 0   },
    { tab: 'ot-review',         label: 'OT Review',         count: allEvents.filter(e => e.type === 'ot_spike' && e.status === 'open').length, icon: Timer },
    { tab: 'shift-conflicts',   label: 'Shift Conflicts',   count: allEvents.filter(e => (e.type === 'shift_unassigned' || e.type === 'roster_change') && e.status === 'open').length, icon: CalendarX },
    { tab: 'leave-conflicts',   label: 'Leave Conflicts',   count: allEvents.filter(e => (e.type === 'leave_rejection' || e.type === 'leave_pending') && e.status === 'open').length, icon: CalendarOff },
  ]

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4 h-20 animate-pulse bg-muted/30" />
            ))
          : (
            <>
              <StatCard label="Active Employees"       value={dashStats?.active_employees       ?? '—'} icon={Users}         />
              <StatCard label="Total Employees"        value={dashStats?.total_employees        ?? '—'} icon={Users}         />
              <StatCard label="New Joiners This Month" value={dashStats?.new_joiners_this_month ?? '—'} icon={ChevronRight}  />
              <StatCard label="Separations This Month" value={dashStats?.separations_this_month ?? '—'} icon={AlertTriangle}  />
            </>
          )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Open anomalies */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Open anomalies today</p>
            <Badge variant="secondary">{todayAnomalies?.length ?? 0}</Badge>
          </div>
          {anomaliesLoading
            ? <div className="p-4 animate-pulse space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 rounded bg-muted/40" />)}</div>
            : !todayAnomalies || todayAnomalies.length === 0
              ? (
                <div className="flex flex-col items-center justify-center py-10 gap-1">
                  <CheckCircle2 className="h-6 w-6 text-success/50" />
                  <p className="text-xs text-muted-foreground">No open anomalies</p>
                </div>
              )
              : (
                <ul className="divide-y divide-border/50">
                  {todayAnomalies.slice(0, 5).map((item, i) => {
                    const d = rowData(item)
                    return (
                      <li key={d.id ?? i} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                          <span className="text-sm text-foreground truncate">{d.employee_name || d.employeeName || '—'}</span>
                          <span className="text-xs text-muted-foreground truncate">{d.anomaly_type || d.type || ''}</span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{d.created_at ? timeAgo(d.created_at) : ''}</span>
                      </li>
                    )
                  })}
                </ul>
              )
          }
        </div>

        {/* Recent activity */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Recent activity</p>
          </div>
          {isActivityLoading
            ? <div className="p-4 animate-pulse space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 rounded bg-muted/40" />)}</div>
            : recentActivity.length === 0
              ? (
                <div className="flex flex-col items-center justify-center py-10 gap-1">
                  <CheckCircle2 className="h-6 w-6 text-success/50" />
                  <p className="text-xs text-muted-foreground">No recent activity</p>
                </div>
              )
              : (
                <ul className="divide-y divide-border/50">
                  {recentActivity.map(ev => (
                    <li key={ev.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', SEVERITY_COLORS[ev.severity].dot)} />
                        <span className="text-sm text-foreground truncate">{ev.title}</span>
                        {ev.employeeName && (
                          <span className="text-xs text-muted-foreground truncate">{ev.employeeName}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(ev.timestamp)}</span>
                    </li>
                  ))}
                </ul>
              )
          }
        </div>
      </div>

      {/* Quick links */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Jump to</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {quickLinks.map(({ tab, label, count, icon: Icon, urgent }) => (
            <button
              key={tab}
              onClick={() => onNavigate(tab)}
              className={cn(
                'group rounded-lg border bg-card px-4 py-3 flex items-center justify-between text-left transition-colors hover:bg-muted/50',
                urgent ? 'border-destructive/40' : 'border-border',
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn('h-4 w-4', urgent ? 'text-destructive' : 'text-muted-foreground')} />
                <span className="text-sm font-medium text-foreground">{label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {count > 0 && (
                  <span className={cn(
                    'h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center',
                    urgent ? 'bg-destructive text-white' : 'bg-muted text-foreground',
                  )}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Missing Punches ─────────────────────────────────────────────────────

function MissingPunchesTab({
  selectedIds,
  setSelectedIds,
  onOpenProfile,
}: {
  selectedIds: Set<string>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onOpenProfile: (id: string, name: string) => void
}) {
  const { data: missingPunches, isLoading, refetch: refetchMissing } = useQuery({
    queryKey: ['daily-ops-missing'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/anomalies?type=missing_punch&resolved=false&limit=100')
        .then(r => r.data ?? []),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const bulkMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<void>('/attendance/regularisation/bulk-approve', { ids }),
    onSuccess: () => {
      toast.success('Bulk regularised')
      void refetchMissing()
      setSelectedIds(new Set())
    },
    onError: () => toast.error('Bulk action failed'),
  })

  const regulariseSingle = useCallback(async (employeeId: string) => {
    try {
      await api.post<void>('/attendance/regularisation', { employeeId })
      toast.success('Regularisation submitted')
      void refetchMissing()
    } catch {
      toast.error('Failed to submit regularisation')
    }
  }, [refetchMissing])

  const toggleAll = useCallback(() => {
    if (!missingPunches) return
    if (selectedIds.size === missingPunches.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(missingPunches.map(item => rowData(item).id).filter(Boolean)))
    }
  }, [missingPunches, selectedIds.size, setSelectedIds])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [setSelectedIds])

  const items = missingPunches ?? []

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border border-border rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" onClick={() => bulkMutation.mutate([...selectedIds])} disabled={bulkMutation.isPending}>
            Bulk Regularise
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <TabTable isLoading={isLoading}>
        {items.length === 0 && !isLoading ? (
          <tbody>
            <tr>
              <td colSpan={7}>
                <EmptyState label="missing punch" />
              </td>
            </tr>
          </tbody>
        ) : (
          <>
            <thead>
              <tr>
                <Th className="w-8">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onChange={toggleAll}
                  />
                </Th>
                <Th>Employee Name</Th>
                <Th>Date</Th>
                <Th>Missing</Th>
                <Th>Anomaly Type</Th>
                <Th>Hours Open</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const d     = rowData(item)
                const id    = d.id || String(i)
                const hoursOpen = d.created_at
                  ? Math.floor((Date.now() - new Date(d.created_at).getTime()) / 3_600_000)
                  : null

                const missingLabel = (() => {
                  const hasMissingIn  = d.missing_punch_in  === 'true' || d.punch_in  === '' || d.punch_in  === 'null'
                  const hasMissingOut = d.missing_punch_out === 'true' || d.punch_out === '' || d.punch_out === 'null'
                  if (hasMissingIn && hasMissingOut) return 'Both'
                  if (hasMissingIn)  return 'Punch In'
                  if (hasMissingOut) return 'Punch Out'
                  return d.missing_type || 'Punch In'
                })()

                return (
                  <tr key={id} className="hover:bg-muted/30 transition-colors">
                    <Td>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedIds.has(id)}
                        onChange={() => toggleRow(id)}
                      />
                    </Td>
                    <Td>
                      <button
                        className="text-primary hover:underline font-medium text-left"
                        onClick={() => onOpenProfile(d.employee_id || id, d.employee_name || d.employeeName || '—')}
                      >
                        {d.employee_name || d.employeeName || '—'}
                      </button>
                    </Td>
                    <Td className="text-muted-foreground">{d.date || d.attendance_date || '—'}</Td>
                    <Td>
                      <Badge variant="outline" className="text-xs">{missingLabel}</Badge>
                    </Td>
                    <Td className="text-muted-foreground text-xs">{d.anomaly_type || d.type || '—'}</Td>
                    <Td>
                      {hoursOpen !== null ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs',
                            hoursOpen > 48 ? 'border-destructive/40 text-destructive bg-destructive/10'
                              : hoursOpen > 24 ? 'border-warning/40 text-warning bg-warning/10'
                              : '',
                          )}
                        >
                          {hoursOpen}h
                        </Badge>
                      ) : '—'}
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => regulariseSingle(d.employee_id || id)}
                      >
                        Regularise
                      </Button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </>
        )}
      </TabTable>
    </div>
  )
}

// ── Tab 3: OT Review ──────────────────────────────────────────────────────────

function OTReviewTab({
  selectedIds,
  setSelectedIds,
  onOpenProfile,
  allEvents,
}: {
  selectedIds: Set<string>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onOpenProfile: (id: string, name: string) => void
  allEvents: OperationalActivityEvent[]
}) {
  const { data: otResp, isLoading } = useQuery({
    queryKey: ['daily-ops-ot'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/anomalies?type=excessive_hours&resolved=false&limit=100')
        .then(r => r.data ?? []),
    staleTime: 60_000,
  })

  const bulkMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api.post<void>(`/overtime/requests/${id}/approve`, {}))).then(() => undefined),
    onSuccess: () => {
      toast.success('OT bulk approved')
      setSelectedIds(new Set())
    },
    onError: () => toast.error('Bulk approval failed'),
  })

  const approveSingle = useCallback(async (itemId: string) => {
    try {
      await api.post<void>(`/overtime/requests/${itemId}/approve`, {})
      toast.success('OT approved')
    } catch {
      toast.error('Approval failed')
    }
  }, [])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [setSelectedIds])

  // fallback to allEvents if OT query is empty
  const apiItems: unknown[] = otResp ?? []
  const eventFallback = useMemo(
    () => allEvents.filter(e => e.type === 'ot_spike'),
    [allEvents],
  )

  const items: unknown[] = apiItems.length > 0 ? apiItems : eventFallback

  const toggleAll = useCallback(() => {
    const allIds = items.map((item, i) => {
      if (typeof item === 'object' && item !== null && 'id' in item) return String((item as Record<string, unknown>).id ?? i)
      if (typeof item === 'object' && item !== null && 'id' in (item as OperationalActivityEvent)) return (item as OperationalActivityEvent).id
      return String(i)
    })
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }, [items, selectedIds.size, setSelectedIds])

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border border-border rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" onClick={() => bulkMutation.mutate([...selectedIds])} disabled={bulkMutation.isPending}>
            Bulk Approve OT
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <TabTable isLoading={isLoading}>
        {items.length === 0 && !isLoading ? (
          <tbody>
            <tr>
              <td colSpan={7}>
                <EmptyState label="OT review" />
              </td>
            </tr>
          </tbody>
        ) : (
          <>
            <thead>
              <tr>
                <Th className="w-8">
                  <input type="checkbox" className="rounded" checked={items.length > 0 && selectedIds.size === items.length} onChange={toggleAll} />
                </Th>
                <Th>Employee</Th>
                <Th>Date</Th>
                <Th>OT Hours</Th>
                <Th>Shift</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const isEvent = typeof item === 'object' && item !== null && 'type' in item && (item as OperationalActivityEvent).type !== undefined && typeof (item as OperationalActivityEvent).timestamp === 'string'
                const d = isEvent ? {} : rowData(item)
                const ev = isEvent ? (item as OperationalActivityEvent) : null

                const id         = ev?.id ?? d.id ?? String(i)
                const empName    = ev?.employeeName ?? d.employee_name ?? d.employeeName ?? '—'
                const empId      = ev?.employeeId   ?? d.employee_id   ?? id
                const date       = ev ? ev.timestamp.slice(0, 10) : (d.date ?? d.attendance_date ?? '—')
                const otHours    = ev ? (ev.metadata?.ot_hours as number | undefined) ?? '—' : (d.ot_hours ?? '—')
                const shift      = ev ? (ev.metadata?.shift as string | undefined) ?? '—' : (d.shift_name ?? d.shift ?? '—')
                const status     = ev?.status ?? d.status ?? '—'

                return (
                  <tr key={id} className="hover:bg-muted/30 transition-colors">
                    <Td>
                      <input type="checkbox" className="rounded" checked={selectedIds.has(id)} onChange={() => toggleRow(id)} />
                    </Td>
                    <Td>
                      <button className="text-primary hover:underline font-medium text-left" onClick={() => onOpenProfile(empId, empName)}>
                        {empName}
                      </button>
                    </Td>
                    <Td className="text-muted-foreground">{date}</Td>
                    <Td>
                      <Badge variant="outline" className="text-xs font-mono">{String(otHours)}</Badge>
                    </Td>
                    <Td className="text-muted-foreground text-xs">{String(shift)}</Td>
                    <Td>
                      <Badge variant="outline" className="text-xs capitalize">{status}</Badge>
                    </Td>
                    <Td>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => approveSingle(id)}>
                        Approve OT
                      </Button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </>
        )}
      </TabTable>
    </div>
  )
}

// ── Tab 4: Shift Conflicts ─────────────────────────────────────────────────────

function ShiftConflictsTab({
  allEvents,
  onOpenProfile,
}: {
  allEvents: OperationalActivityEvent[]
  onOpenProfile: (id: string, name: string) => void
}) {
  const navigate = useNavigate()

  const shiftConflicts = useMemo(
    () => allEvents.filter(e => (e.type === 'shift_unassigned' || e.type === 'roster_change') && e.status === 'open'),
    [allEvents],
  )

  const unassignedCount = shiftConflicts.filter(e => e.type === 'shift_unassigned').length

  return (
    <div className="space-y-3">
      {unassignedCount > 0 && (
        <div className={cn(
          'flex items-center gap-2 rounded-lg border px-4 py-3',
          unassignedCount > 5 ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5',
        )}>
          <AlertTriangle className={cn('h-4 w-4 shrink-0', unassignedCount > 5 ? 'text-destructive' : 'text-warning')} />
          <p className={cn('text-sm font-medium', unassignedCount > 5 ? 'text-destructive' : 'text-warning')}>
            {unassignedCount} shift{unassignedCount !== 1 ? 's' : ''} unassigned
          </p>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            onClick={() => navigate('/admin/employee-shifts')}
          >
            Assign to shifts
          </Button>
        </div>
      )}

      <TabTable isLoading={false}>
        {shiftConflicts.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={6}>
                <EmptyState label="shift conflict" />
              </td>
            </tr>
          </tbody>
        ) : (
          <>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Site</Th>
                <Th>Conflict Type</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {shiftConflicts.map(ev => (
                <tr key={ev.id} className="hover:bg-muted/30 transition-colors">
                  <Td>
                    <button
                      className="text-primary hover:underline font-medium text-left"
                      onClick={() => onOpenProfile(ev.employeeId ?? ev.id, ev.employeeName ?? '—')}
                    >
                      {ev.employeeName ?? '—'}
                    </button>
                  </Td>
                  <Td className="text-muted-foreground text-xs">{ev.siteName ?? '—'}</Td>
                  <Td>
                    <Badge variant="outline" className="text-xs capitalize">
                      {ev.type === 'shift_unassigned' ? 'Unassigned' : 'Roster Change'}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">{ev.timestamp.slice(0, 10)}</Td>
                  <Td>
                    <Badge variant="outline" className="text-xs capitalize">{ev.status}</Badge>
                  </Td>
                  <Td>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/admin/roster')}>
                      Assign Shift
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </TabTable>
    </div>
  )
}

// ── Tab 5: Leave Conflicts ─────────────────────────────────────────────────────

function LeaveConflictsTab({
  allEvents,
  onOpenProfile,
}: {
  allEvents: OperationalActivityEvent[]
  onOpenProfile: (id: string, name: string) => void
}) {
  const { data: collisionResp, isLoading } = useQuery({
    queryKey: ['daily-ops-leave-conflicts'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/leave/collision/log?limit=50')
        .then(r => r.data ?? []),
    staleTime: 2 * 60_000,
  })

  const eventConflicts = useMemo(
    () => allEvents.filter(e => e.type === 'leave_rejection' || e.type === 'leave_pending'),
    [allEvents],
  )

  const apiItems: unknown[] = collisionResp ?? []

  const resolveItem = useCallback(async (id: string) => {
    try {
      await api.post<void>(`/leave/collision/log/${id}/resolve`, {})
      toast.success('Leave conflict resolved')
    } catch {
      toast.error('Failed to resolve conflict')
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* API collision log */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Collision Log</p>
        <TabTable isLoading={isLoading}>
          {apiItems.length === 0 && !isLoading ? (
            <tbody>
              <tr>
                <td colSpan={6}>
                  <EmptyState label="leave conflict" />
                </td>
              </tr>
            </tbody>
          ) : (
            <>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Leave Type</Th>
                  <Th>Dates</Th>
                  <Th>Conflict Reason</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {apiItems.map((item, i) => {
                  const d   = rowData(item)
                  const id  = d.id || String(i)
                  return (
                    <tr key={id} className="hover:bg-muted/30 transition-colors">
                      <Td>
                        <button
                          className="text-primary hover:underline font-medium text-left"
                          onClick={() => onOpenProfile(d.employee_id ?? id, d.employee_name ?? d.employeeName ?? '—')}
                        >
                          {d.employee_name || d.employeeName || '—'}
                        </button>
                      </Td>
                      <Td className="text-xs">{d.leave_type || d.leaveType || '—'}</Td>
                      <Td className="text-muted-foreground text-xs">
                        {d.from_date || d.start_date || '—'}{(d.from_date || d.start_date) && (d.to_date || d.end_date) ? ' → ' : ''}{d.to_date || d.end_date || ''}
                      </Td>
                      <Td className="text-xs text-muted-foreground max-w-xs truncate">{d.conflict_reason || d.reason || '—'}</Td>
                      <Td>
                        <Badge variant="outline" className="text-xs capitalize">{d.status || '—'}</Badge>
                      </Td>
                      <Td>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resolveItem(id)}>
                          Resolve
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </>
          )}
        </TabTable>
      </div>

      {/* Activity stream leave events */}
      {eventConflicts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Leave activity</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Event</Th>
                  <Th>Description</Th>
                  <Th>Time</Th>
                </tr>
              </thead>
              <tbody>
                {eventConflicts.map(ev => (
                  <tr key={ev.id} className="hover:bg-muted/30 transition-colors">
                    <Td>
                      <button
                        className="text-primary hover:underline font-medium text-left"
                        onClick={() => onOpenProfile(ev.employeeId ?? ev.id, ev.employeeName ?? '—')}
                      >
                        {ev.employeeName ?? '—'}
                      </button>
                    </Td>
                    <Td>
                      <Badge variant="outline" className="text-xs capitalize">
                        {ev.type === 'leave_rejection' ? 'Rejected' : 'Pending'}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-muted-foreground max-w-xs truncate">{ev.description ?? ev.title}</Td>
                    <Td className="text-muted-foreground text-xs">{timeAgo(ev.timestamp)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab 6: Pending Approvals ───────────────────────────────────────────────────

interface CombinedApprovalItem {
  id:       string
  kind:     'regularisation' | 'correction'
  empId:    string
  empName:  string
  date:     string
  reason:   string
  status:   string
}

function PendingApprovalsTab({
  selectedIds,
  setSelectedIds,
  onOpenProfile,
}: {
  selectedIds: Set<string>
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onOpenProfile: (id: string, name: string) => void
}) {
  const { data: regResp, isLoading: regLoading } = useQuery({
    queryKey: ['daily-ops-regs'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/regularisation/pending')
        .then(r => r.data ?? []),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: corrResp, isLoading: corrLoading } = useQuery({
    queryKey: ['daily-ops-corrections'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/corrections?status=pending&limit=100')
        .then(r => r.data ?? []),
    staleTime: 60_000,
  })

  const combined = useMemo<CombinedApprovalItem[]>(() => {
    const regs  = (regResp  ?? []).map(item => { const d = rowData(item); return { id: d.id || d.regularisation_id || '', kind: 'regularisation' as const, empId: d.employee_id || '', empName: d.employee_name || d.employeeName || '—', date: d.date || d.attendance_date || '—', reason: d.reason || '—', status: d.status || 'pending' } })
    const corrs = (corrResp ?? []).map(item => { const d = rowData(item); return { id: d.id || d.correction_id || '',     kind: 'correction'      as const, empId: d.employee_id || '', empName: d.employee_name || d.employeeName || '—', date: d.date || d.correction_date || '—', reason: d.reason || '—', status: d.status || 'pending' } })
    return [...regs, ...corrs].filter(x => x.id)
  }, [regResp, corrResp])

  const isLoading = regLoading || corrLoading

  const approveMutation = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'regularisation' | 'correction' }) =>
      api.post<void>(`/attendance/${kind === 'regularisation' ? 'regularisation' : 'corrections'}/${id}/approve`, {}),
    onSuccess: () => toast.success('Approved'),
    onError:   () => toast.error('Approval failed'),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<void>(`/attendance/regularisation/${id}/reject`, {}),
    onSuccess: () => toast.success('Rejected'),
    onError:   () => toast.error('Rejection failed'),
  })

  const bulkApprove = useCallback(() => {
    const selected = combined.filter(item => selectedIds.has(item.id))
    selected.forEach(item => approveMutation.mutate({ id: item.id, kind: item.kind }))
    setSelectedIds(new Set())
  }, [combined, selectedIds, approveMutation, setSelectedIds])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [setSelectedIds])

  const toggleAll = useCallback(() => {
    if (selectedIds.size === combined.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(combined.map(x => x.id)))
    }
  }, [combined, selectedIds.size, setSelectedIds])

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border border-border rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" onClick={bulkApprove} disabled={approveMutation.isPending}>
            Approve All
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <TabTable isLoading={isLoading}>
        {combined.length === 0 && !isLoading ? (
          <tbody>
            <tr>
              <td colSpan={7}>
                <EmptyState label="pending approval" />
              </td>
            </tr>
          </tbody>
        ) : (
          <>
            <thead>
              <tr>
                <Th className="w-8">
                  <input type="checkbox" className="rounded" checked={combined.length > 0 && selectedIds.size === combined.length} onChange={toggleAll} />
                </Th>
                <Th>Type</Th>
                <Th>Employee</Th>
                <Th>Date</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {combined.map(item => (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <Td>
                    <input type="checkbox" className="rounded" checked={selectedIds.has(item.id)} onChange={() => toggleRow(item.id)} />
                  </Td>
                  <Td>
                    <Badge
                      variant="outline"
                      className={cn('text-xs', item.kind === 'regularisation' ? 'border-info/40 text-info bg-info/10' : 'border-primary/40 text-primary bg-primary/10')}
                    >
                      {item.kind === 'regularisation' ? 'Regularisation' : 'Correction'}
                    </Badge>
                  </Td>
                  <Td>
                    <button className="text-primary hover:underline font-medium text-left" onClick={() => onOpenProfile(item.empId, item.empName)}>
                      {item.empName}
                    </button>
                  </Td>
                  <Td className="text-muted-foreground">{item.date}</Td>
                  <Td className="text-xs text-muted-foreground max-w-xs truncate">{item.reason}</Td>
                  <Td>
                    <Badge variant="outline" className="text-xs capitalize">{item.status}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => approveMutation.mutate({ id: item.id, kind: item.kind })}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => rejectMutation.mutate(item.id)}
                        disabled={rejectMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </TabTable>
    </div>
  )
}

// ── Tab 7: Payroll Blockers ───────────────────────────────────────────────────

function PayrollBlockersTab({
  allEvents,
  onOpenProfile,
}: {
  allEvents: OperationalActivityEvent[]
  onOpenProfile: (id: string, name: string) => void
}) {
  const navigate = useNavigate()

  const payrollBlockers = useMemo(
    () => allEvents.filter(e => e.type === 'payroll_blocker' && e.status === 'open'),
    [allEvents],
  )

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      <div className={cn(
        'flex items-center justify-between rounded-lg border px-4 py-3',
        payrollBlockers.length > 0
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-success/40 bg-success/5',
      )}>
        <div className="flex items-center gap-2">
          {payrollBlockers.length > 0
            ? <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
            : <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          }
          <p className={cn('text-sm font-medium', payrollBlockers.length > 0 ? 'text-destructive' : 'text-success')}>
            {payrollBlockers.length > 0
              ? `${payrollBlockers.length} blocker${payrollBlockers.length !== 1 ? 's' : ''} preventing payroll run`
              : 'No blockers — payroll run is clear'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => navigate('/admin/payroll/center')}
        >
          Go to Payroll Control Center →
        </Button>
      </div>

      <TabTable isLoading={false}>
        {payrollBlockers.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={5}>
                <EmptyState label="payroll blocker" />
              </td>
            </tr>
          </tbody>
        ) : (
          <>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Employee</Th>
                <Th>Severity</Th>
                <Th>Since</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {payrollBlockers.map(ev => {
                const sc = SEVERITY_COLORS[ev.severity]
                const route = ev.actionLinks?.[0]?.route ?? '/admin/payroll/center'
                return (
                  <tr key={ev.id} className="hover:bg-muted/30 transition-colors">
                    <Td className="font-medium">{ev.title}</Td>
                    <Td>
                      {ev.employeeName
                        ? (
                          <button
                            className="text-primary hover:underline font-medium text-left"
                            onClick={() => onOpenProfile(ev.employeeId ?? ev.id, ev.employeeName ?? '—')}
                          >
                            {ev.employeeName}
                          </button>
                        )
                        : <span className="text-muted-foreground">—</span>
                      }
                    </Td>
                    <Td>
                      <Badge
                        variant="outline"
                        className={cn('text-xs capitalize', sc.bg, sc.text, sc.border)}
                      >
                        {ev.severity}
                      </Badge>
                    </Td>
                    <Td className="text-muted-foreground text-xs">{timeAgo(ev.timestamp)}</Td>
                    <Td>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(route)}>
                        Resolve
                      </Button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </>
        )}
      </TabTable>
    </div>
  )
}

// ── Live clock ─────────────────────────────────────────────────────────────────

function useLiveClock(): string {
  const fmt = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const [time, setTime] = useState(fmt)

  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 60_000)
    return () => clearInterval(id)
  }, [])

  return time
}

// ── Root component ─────────────────────────────────────────────────────────────

export function DailyOperationsWorkspace(): JSX.Element {
  const [activeTab, setActiveTab] = useState<DailyOpsTab>('today')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [profileEmployee, setProfileEmployee] = useState<{ id: string; name: string } | null>(null)

  const { allEvents, isLoading: activityLoading, refresh } = useActivityStream()
  const liveClock = useLiveClock()

  // Reset selections when tab changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeTab])

  // Keyboard shortcuts Ctrl/Cmd+1-7
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const n = parseInt(e.key, 10)
        if (n >= 1 && n <= 7) {
          e.preventDefault()
          setActiveTab(TABS[n - 1].id)
        }
        if (e.key === 'a') {
          e.preventDefault()
          // select all in current tab — handled inside each tab component via checkbox header
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openProfile = useCallback((id: string, name: string) => {
    setProfileEmployee({ id, name })
  }, [])

  // Counts for tab badges
  const missingCount  = useMemo(() => allEvents.filter(e => e.type === 'missing_punch'   && e.status === 'open').length,   [allEvents])
  const otCount       = useMemo(() => allEvents.filter(e => e.type === 'ot_spike'        && e.status === 'open').length,   [allEvents])
  const shiftCount    = useMemo(() => allEvents.filter(e => (e.type === 'shift_unassigned' || e.type === 'roster_change') && e.status === 'open').length, [allEvents])
  const leaveCount    = useMemo(() => allEvents.filter(e => (e.type === 'leave_rejection' || e.type === 'leave_pending') && e.status === 'open').length,  [allEvents])
  const pendingCount  = useMemo(() => allEvents.filter(e => e.status === 'pending').length,                                                                [allEvents])
  const blockerCount  = useMemo(() => allEvents.filter(e => e.type === 'payroll_blocker' && e.status === 'open').length,   [allEvents])

  const tabCounts: Record<DailyOpsTab, number> = {
    'today':             0,
    'missing-punches':   missingCount,
    'ot-review':         otCount,
    'shift-conflicts':   shiftCount,
    'leave-conflicts':   leaveCount,
    'pending-approvals': pendingCount,
    'payroll-blockers':  blockerCount,
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground leading-tight">Daily Operations</h1>
              <p className="text-xs text-muted-foreground">
                Unified workspace — today's attendance, OT, approvals, and blockers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-mono font-medium text-foreground">{liveClock}</span>
            </div>
            <Button size="sm" variant="outline" onClick={refresh} className="h-8 gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Ctrl+1–7 to switch tabs
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 px-6 py-5">
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as DailyOpsTab)}>
          <TabsList className="h-auto flex-wrap gap-1 mb-5 bg-muted/50 p-1 rounded-lg">
            {TABS.map(tab => {
              const count = tabCounts[tab.id]
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium"
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                  <CountBadge count={count} />
                </TabsTrigger>
              )
            })}
          </TabsList>

          <TabsContent value="today" className="mt-0">
            <TodayTab
              onNavigate={setActiveTab}
              allEvents={allEvents}
              isActivityLoading={activityLoading}
            />
          </TabsContent>

          <TabsContent value="missing-punches" className="mt-0">
            <MissingPunchesTab
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              onOpenProfile={openProfile}
            />
          </TabsContent>

          <TabsContent value="ot-review" className="mt-0">
            <OTReviewTab
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              onOpenProfile={openProfile}
              allEvents={allEvents}
            />
          </TabsContent>

          <TabsContent value="shift-conflicts" className="mt-0">
            <ShiftConflictsTab
              allEvents={allEvents}
              onOpenProfile={openProfile}
            />
          </TabsContent>

          <TabsContent value="leave-conflicts" className="mt-0">
            <LeaveConflictsTab
              allEvents={allEvents}
              onOpenProfile={openProfile}
            />
          </TabsContent>

          <TabsContent value="pending-approvals" className="mt-0">
            <PendingApprovalsTab
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              onOpenProfile={openProfile}
            />
          </TabsContent>

          <TabsContent value="payroll-blockers" className="mt-0">
            <PayrollBlockersTab
              allEvents={allEvents}
              onOpenProfile={openProfile}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Employee profile drawer */}
      <EmployeeOperationalProfile
        employeeId={profileEmployee?.id ?? null}
        employeeName={profileEmployee?.name}
        onClose={() => setProfileEmployee(null)}
      />
    </div>
  )
}
