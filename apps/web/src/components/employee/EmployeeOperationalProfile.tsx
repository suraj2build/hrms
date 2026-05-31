/**
 * EmployeeOperationalProfile — Phase UX-4
 *
 * Right-side Sheet drawer providing a unified operational view of a single
 * employee across all HRIS modules (Attendance, Leave, Payroll, Roster,
 * Anomalies, Timeline) without requiring page navigation.
 */

import { useState, useEffect } from 'react'
import { useQuery }            from '@tanstack/react-query'
import { useNavigate }         from 'react-router-dom'
import {
  CalendarDays, Clock, DollarSign, AlertTriangle,
  Calendar, Activity, User, MapPin, Mail, Phone,
  Briefcase, Building2,
} from 'lucide-react'
import { cn }          from '@/lib/utils'
import { api }         from '@/lib/api/client'
import { Button }      from '@/components/ui/button'
import { Badge }       from '@/components/ui/badge'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  SheetDescription, SheetBody, SheetFooter,
} from '@/components/ui/sheet'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import { useActivityStream } from '@/lib/activity/useActivityStream'
import {
  SEVERITY_COLORS, STATUS_META, WORKSPACE_META,
} from '@/lib/activity/types'
import type { OperationalActivityEvent } from '@/lib/activity/types'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EmployeeOperationalProfileProps {
  employeeId:    string | null
  employeeName?: string
  onClose:       () => void
}

interface EmployeeBasic {
  id:               string
  full_name:        string
  employee_code?:   string
  designation?:     string
  department?:      string
  site_name?:       string
  status?:          string
  avatar_url?:      string | null
  date_of_joining?: string
  email?:           string
  phone?:           string
}

type ActiveTab = 'attendance' | 'leave' | 'payroll' | 'roster' | 'anomalies' | 'timeline'

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(p => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Safely coerce every value in an unknown object to string for display. */
function row(item: unknown): Record<string, string> {
  if (typeof item !== 'object' || item === null) return {}
  return Object.fromEntries(
    Object.entries(item as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
  )
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch {
    return iso
  }
}

// ── Sub-components: tab content ────────────────────────────────────────────────

// Attendance Tab
interface AttendanceTabProps {
  data: unknown[] | undefined
  isLoading: boolean
}

function AttendanceTab({ data, isLoading }: AttendanceTabProps) {
  if (isLoading) return <TabSkeleton />
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="h-8 w-8 text-muted-foreground/30" />}
        label="attendance"
      />
    )
  }

  const rows = data.map(row)

  const totalDays = rows.length
  const present   = rows.filter(r => r['status']?.toLowerCase() === 'present').length
  const absent    = rows.filter(r => r['status']?.toLowerCase() === 'absent').length
  const late      = rows.filter(r =>
    r['status']?.toLowerCase().includes('late') ||
    r['is_late'] === 'true'
  ).length

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total',   value: totalDays, color: 'text-foreground' },
          { label: 'Present', value: present,   color: 'text-emerald-600' },
          { label: 'Absent',  value: absent,    color: 'text-destructive' },
          { label: 'Late',    value: late,       color: 'text-amber-600' },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border border-border bg-card px-3 py-2 text-center">
            <p className={cn('text-lg font-bold leading-none', stat.color)}>{stat.value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {['Date', 'Punch In', 'Punch Out', 'Status', 'Hours'].map(col => (
                <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-medium">{r['date'] || r['attendance_date'] || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{r['punch_in'] || r['first_in_time'] || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{r['punch_out'] || r['last_out_time'] || '—'}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                    (r['status'] || '').toLowerCase().includes('present')
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : (r['status'] || '').toLowerCase().includes('absent')
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-amber-500/10 text-amber-600',
                  )}>
                    {r['status'] || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r['work_hours'] || r['total_hours'] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Leave Tab
interface LeaveTabProps {
  data: unknown[] | undefined
  isLoading: boolean
}

function LeaveTab({ data, isLoading }: LeaveTabProps) {
  if (isLoading) return <TabSkeleton />
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-8 w-8 text-muted-foreground/30" />}
        label="leave"
      />
    )
  }

  const rows = data.map(row)

  return (
    <div className="grid grid-cols-1 gap-3">
      {rows.map((r, i) => {
        const balance = parseFloat(r['balance_days'] || r['remaining_days'] || '0')
        const total   = parseFloat(r['total_days'] || r['entitlement_days'] || '0')
        const used    = parseFloat(r['used_days'] || r['availed_days'] || '0')
        const pct     = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0

        const colorClass = balance <= 0
          ? 'text-destructive'
          : balance < 3
            ? 'text-amber-600'
            : 'text-emerald-600'

        const barColor = balance <= 0
          ? 'bg-destructive'
          : balance < 3
            ? 'bg-amber-500'
            : 'bg-emerald-500'

        return (
          <div key={i} className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                {r['leave_type_name'] || r['leave_type'] || `Leave Type ${i + 1}`}
              </span>
              <span className={cn('text-sm font-bold', colorClass)}>
                {balance} <span className="text-xs font-normal text-muted-foreground">/ {total} days</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{used} used</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Payroll Tab
interface PayrollTabProps {
  payrollData:      unknown[] | undefined
  compensationData: unknown[] | undefined
  isLoading:        boolean
}

function PayrollTab({ payrollData, compensationData, isLoading }: PayrollTabProps) {
  if (isLoading) return <TabSkeleton />
  const payrollRows      = (payrollData      ?? []).map(row)
  const compensationRows = (compensationData ?? []).map(row)

  const latestComp = compensationRows[0]

  return (
    <div className="space-y-4">
      {/* Compensation snapshot */}
      {latestComp && (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Compensation
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'CTC Monthly',   value: latestComp['ctc_monthly']   || latestComp['monthly_ctc']   || '—' },
              { label: 'Gross Monthly', value: latestComp['gross_monthly']  || latestComp['gross_salary']  || '—' },
              { label: 'Net Pay',       value: latestComp['net_pay']        || latestComp['net_monthly']   || '—' },
              { label: 'Effective',     value: latestComp['effective_date'] || latestComp['effective_from']|| '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-sm font-medium text-foreground">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payroll runs */}
      {payrollRows.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="h-8 w-8 text-muted-foreground/30" />}
          label="payroll"
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {['Month', 'Gross', 'Net', 'Status'].map(col => (
                  <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payrollRows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">{r['pay_period'] || r['month'] || r['period'] || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r['gross_pay'] || r['gross'] || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r['net_pay'] || r['net'] || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                      (r['status'] || '').toLowerCase() === 'processed'
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : (r['status'] || '').toLowerCase() === 'locked'
                          ? 'bg-blue-500/10 text-blue-600'
                          : 'bg-amber-500/10 text-amber-600',
                    )}>
                      {r['status'] || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Roster Tab
interface RosterTabProps {
  data: unknown[] | undefined
  isLoading: boolean
}

function RosterTab({ data, isLoading }: RosterTabProps) {
  if (isLoading) return <TabSkeleton />
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Calendar className="h-8 w-8 text-muted-foreground/30" />}
        label="roster"
      />
    )
  }

  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const rows     = data.map(row)

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const date    = r['date'] || r['roster_date'] || r['shift_date'] || ''
        const isToday = date === today
        const isTomorrow = date === tomorrow

        return (
          <div key={i} className={cn(
            'rounded-lg border px-4 py-3 transition-colors',
            isToday   ? 'border-primary/40 bg-primary/5'   :
            isTomorrow ? 'border-amber-500/30 bg-amber-500/5' :
            'border-border bg-card',
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {r['shift_name'] || r['shift'] || 'Shift'}
                </span>
                {isToday    && <Badge variant="default"   className="text-[10px] h-4 px-1.5">Today</Badge>}
                {isTomorrow && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Tomorrow</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(date)}</span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>{r['start_time'] || r['shift_start'] || '—'} – {r['end_time'] || r['shift_end'] || '—'}</span>
              {(r['site'] || r['site_name']) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {r['site'] || r['site_name']}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Anomalies Tab
interface AnomaliesTabProps {
  data: unknown[] | undefined
  isLoading: boolean
}

function AnomaliesTab({ data, isLoading }: AnomaliesTabProps) {
  if (isLoading) return <TabSkeleton />
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-8 w-8 text-muted-foreground/30" />}
        label="anomalies"
      />
    )
  }

  const rows = data.map(row)

  function severityDot(sev: string) {
    const map: Record<string, string> = {
      critical: 'bg-destructive',
      high:     'bg-orange-500',
      medium:   'bg-amber-500',
      low:      'bg-blue-500',
    }
    return map[sev.toLowerCase()] ?? 'bg-muted-foreground'
  }

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const isResolved = (r['is_resolved'] === 'true' || r['status']?.toLowerCase() === 'resolved')

        return (
          <div key={i} className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <span className={cn(
                  'mt-1.5 h-2 w-2 rounded-full flex-shrink-0',
                  severityDot(r['severity'] || 'info'),
                )} />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {r['anomaly_type'] || r['type'] || 'Anomaly'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r['description'] || r['details'] || '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {formatDate(r['date'] || r['detected_at'] || r['created_at'])}
                  </p>
                </div>
              </div>
              {isResolved ? (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 flex-shrink-0">
                  Resolved
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px] h-4 px-1.5 flex-shrink-0">
                  Open
                </Badge>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Timeline Tab
interface TimelineTabProps {
  employeeId: string
}

function TimelineTab({ employeeId }: TimelineTabProps) {
  const { events, isLoading } = useActivityStream({ employeeId })
  const top20 = events.slice(0, 20)

  if (isLoading) return <TabSkeleton />
  if (top20.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-8 w-8 text-muted-foreground/30" />}
        label="timeline"
      />
    )
  }

  return (
    <div className="space-y-1">
      {top20.map((event: OperationalActivityEvent) => {
        const sevColors  = SEVERITY_COLORS[event.severity]
        const statusMeta = STATUS_META[event.status]
        const wsMeta     = WORKSPACE_META[event.workspace]

        return (
          <div
            key={event.id}
            className={cn(
              'rounded-lg border px-3 py-2.5 flex items-start gap-3',
              sevColors.bg, sevColors.border,
            )}
          >
            {/* Severity dot */}
            <span className={cn('mt-1.5 h-2 w-2 rounded-full flex-shrink-0', sevColors.dot)} />

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1.5">
                <p className={cn('text-xs font-medium leading-snug', sevColors.text)}>
                  {event.title}
                </p>
                <span className={cn('text-[10px] flex-shrink-0', statusMeta.color)}>
                  {statusMeta.label}
                </span>
              </div>

              {event.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {event.description}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                  wsMeta.bg, wsMeta.color,
                )}>
                  {wsMeta.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {timeAgo(event.timestamp)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Shared UI atoms ────────────────────────────────────────────────────────────

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      {icon}
      <p className="text-sm text-muted-foreground">No {label} data</p>
    </div>
  )
}

function TabSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EmployeeOperationalProfile({
  employeeId,
  employeeName,
  onClose,
}: EmployeeOperationalProfileProps) {
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<ActiveTab>('attendance')

  // Reset tab when employee changes
  useEffect(() => {
    setActiveTab('attendance')
  }, [employeeId])

  // ── Employee basic info ──────────────────────────────────────────────────────

  const { data: employee, isLoading: empLoading } = useQuery({
    queryKey: ['emp-profile-basic', employeeId],
    queryFn:  () =>
      api.get<{ data: EmployeeBasic }>(`/employees/${employeeId}`).then(r => r.data),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  // ── Per-tab queries ──────────────────────────────────────────────────────────

  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ['emp-attendance', employeeId],
    queryFn:  () =>
      api
        .get<{ data: unknown[] }>(`/attendance/records?employee_id=${employeeId}&limit=30`)
        .then(r => r.data ?? []),
    enabled:   !!employeeId && activeTab === 'attendance',
    staleTime: 2 * 60_000,
  })

  const { data: leaveData, isLoading: leaveLoading } = useQuery({
    queryKey: ['emp-leave', employeeId],
    queryFn:  () =>
      api
        .get<{ data: unknown[] }>(`/leave/balances?employee_id=${employeeId}`)
        .then(r => r.data ?? []),
    enabled:   !!employeeId && activeTab === 'leave',
    staleTime: 5 * 60_000,
  })

  const { data: payrollData, isLoading: payrollLoading } = useQuery({
    queryKey: ['emp-payroll', employeeId],
    queryFn:  () =>
      api
        .get<{ data: unknown[] }>(`/payroll/runs?employee_id=${employeeId}&limit=12`)
        .then(r => r.data ?? []),
    enabled:   !!employeeId && activeTab === 'payroll',
    staleTime: 5 * 60_000,
  })

  const { data: rosterData, isLoading: rosterLoading } = useQuery({
    queryKey: ['emp-roster', employeeId],
    queryFn:  () =>
      api
        .get<{ data: unknown[] }>(`/roster/assignments?employee_id=${employeeId}&limit=30`)
        .then(r => r.data ?? []),
    enabled:   !!employeeId && activeTab === 'roster',
    staleTime: 2 * 60_000,
  })

  const { data: anomalyData, isLoading: anomalyLoading } = useQuery({
    queryKey: ['emp-anomalies', employeeId],
    queryFn:  () =>
      api
        .get<{ data: unknown[] }>(`/attendance/anomalies?employee_id=${employeeId}&limit=20`)
        .then(r => r.data ?? []),
    enabled:   !!employeeId && activeTab === 'anomalies',
    staleTime: 2 * 60_000,
  })

  const { data: compensationData } = useQuery({
    queryKey: ['emp-compensation', employeeId],
    queryFn:  () =>
      api
        .get<{ data: unknown[] }>(`/employees/${employeeId}/compensation/history`)
        .then(r => r.data ?? []),
    enabled:   !!employeeId && activeTab === 'payroll',
    staleTime: 5 * 60_000,
  })

  // ── Derived values ───────────────────────────────────────────────────────────

  const displayName = employee?.full_name ?? employeeName ?? 'Employee'
  const initials    = getInitials(displayName)

  const statusColor = employee?.status?.toLowerCase() === 'active'
    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    : 'bg-muted text-muted-foreground border-border'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Sheet open={!!employeeId} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent size="lg">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <SheetHeader>
          <div className="flex items-start gap-4 pr-8">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {employee?.avatar_url ? (
                <img
                  src={employee.avatar_url}
                  alt={displayName}
                  className="h-12 w-12 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                  <span className="text-sm font-semibold text-primary">{initials}</span>
                </div>
              )}
            </div>

            {/* Name block */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-base font-semibold">
                  {empLoading ? (
                    <span className="inline-block h-4 w-32 bg-muted animate-pulse rounded" />
                  ) : displayName}
                </SheetTitle>
                {employee?.status && (
                  <span className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium flex-shrink-0',
                    statusColor,
                  )}>
                    {employee.status}
                  </span>
                )}
              </div>
              <SheetDescription className="mt-0.5">
                {employee?.employee_code && (
                  <span className="font-mono text-[11px]">{employee.employee_code}</span>
                )}
                {employee?.designation && (
                  <span className="ml-2">{employee.designation}</span>
                )}
                {employee?.department && (
                  <span className="ml-1 text-muted-foreground/60">· {employee.department}</span>
                )}
              </SheetDescription>
            </div>
          </div>

          {/* Quick stats row */}
          {employee && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
              {employee.date_of_joining && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Briefcase className="h-3 w-3" />
                  Joined {formatDate(employee.date_of_joining)}
                </span>
              )}
              {employee.site_name && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  {employee.site_name}
                </span>
              )}
              {employee.email && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  {employee.email}
                </span>
              )}
              {employee.phone && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {employee.phone}
                </span>
              )}
            </div>
          )}
        </SheetHeader>

        {/* ── Body ────────────────────────────────────────────────────────────── */}
        <SheetBody className="px-4 py-4">
          <Tabs
            value={activeTab}
            onValueChange={v => setActiveTab(v as ActiveTab)}
            className="flex flex-col h-full"
          >
            <TabsList className="w-full flex-shrink-0 h-auto flex-wrap gap-0.5 bg-muted/50 p-1 mb-4">
              {(
                [
                  { key: 'attendance', icon: Clock,        label: 'Attendance' },
                  { key: 'leave',      icon: CalendarDays, label: 'Leave'      },
                  { key: 'payroll',    icon: DollarSign,   label: 'Payroll'    },
                  { key: 'roster',     icon: Calendar,     label: 'Roster'     },
                  { key: 'anomalies',  icon: AlertTriangle,label: 'Anomalies'  },
                  { key: 'timeline',   icon: Activity,     label: 'Timeline'   },
                ] as const
              ).map(({ key, icon: Icon, label }) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="flex-1 text-xs gap-1.5 py-1.5 data-[state=active]:shadow-sm"
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="attendance" className="mt-0 flex-1 overflow-y-auto">
              <AttendanceTab data={attendanceData} isLoading={attendanceLoading && activeTab === 'attendance'} />
            </TabsContent>

            <TabsContent value="leave" className="mt-0 flex-1 overflow-y-auto">
              <LeaveTab data={leaveData} isLoading={leaveLoading && activeTab === 'leave'} />
            </TabsContent>

            <TabsContent value="payroll" className="mt-0 flex-1 overflow-y-auto">
              <PayrollTab
                payrollData={payrollData}
                compensationData={compensationData}
                isLoading={payrollLoading && activeTab === 'payroll'}
              />
            </TabsContent>

            <TabsContent value="roster" className="mt-0 flex-1 overflow-y-auto">
              <RosterTab data={rosterData} isLoading={rosterLoading && activeTab === 'roster'} />
            </TabsContent>

            <TabsContent value="anomalies" className="mt-0 flex-1 overflow-y-auto">
              <AnomaliesTab data={anomalyData} isLoading={anomalyLoading && activeTab === 'anomalies'} />
            </TabsContent>

            <TabsContent value="timeline" className="mt-0 flex-1 overflow-y-auto">
              {activeTab === 'timeline' && employeeId ? (
                <TimelineTab employeeId={employeeId} />
              ) : (
                <EmptyState
                  icon={<Activity className="h-8 w-8 text-muted-foreground/30" />}
                  label="timeline"
                />
              )}
            </TabsContent>
          </Tabs>
        </SheetBody>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <SheetFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (employeeId) navigate(`/admin/employees/${employeeId}`)
              onClose()
            }}
          >
            <User className="h-3.5 w-3.5 mr-1.5" />
            View Full Profile
          </Button>
        </SheetFooter>

      </SheetContent>
    </Sheet>
  )
}
