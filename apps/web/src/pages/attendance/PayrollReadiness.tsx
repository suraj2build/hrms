/**
 * PayrollReadiness — /admin/payroll-readiness
 *
 * Consolidated payroll close checklist. Shows all blocking items that must
 * be resolved before payroll can be safely processed for a given month.
 *
 * Checklist items:
 *  ✓ Pending leave requests
 *  ✓ Pending regularisation requests
 *  ✓ Pending OT requests
 *  ✓ Pending comp-off requests
 *  ✓ Attendance anomalies (unflagged)
 *  ✓ Payroll summary (payable days / LOP days total)
 *  ✓ Period lock status
 *  ✓ Employees with zero attendance
 */

import { useState }                                        from 'react'
import { useQuery, useMutation, useQueryClient }           from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, AlertTriangle, ShieldAlert,
  ChevronLeft, ChevronRight, Lock, Unlock,
  Calendar, Clock, FileCheck, Users,
  Loader2,
} from 'lucide-react'

import { toast }          from 'sonner'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayrollSummary {
  total_employees: number
  total_payable_days: number
  total_lop_days: number
  avg_work_hours: number
}

interface ChecklistItem {
  id:          string
  label:       string
  description: string
  count:       number | null
  status:      'ok' | 'warning' | 'error' | 'loading'
  action?:     string
  href?:       string
}

interface PeriodLockState {
  is_locked:    boolean
  locked_at:    string | null
  locked_by:    string | null
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function statusIcon(status: ChecklistItem['status'], count: number | null) {
  if (status === 'loading') return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  if (status === 'ok' || (status !== 'error' && count === 0)) return <CheckCircle2 className="h-5 w-5 text-success" />
  if (status === 'warning') return <AlertTriangle className="h-5 w-5 text-warning" />
  return <XCircle className="h-5 w-5 text-destructive" />
}

function monthLabel(m: string): string {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Readiness Score ────────────────────────────────────────────────────────────

function ReadinessScore({ items }: { items: ChecklistItem[] }) {
  const loaded = items.filter(i => i.status !== 'loading')
  const ok     = loaded.filter(i => i.count === 0 || i.status === 'ok').length
  const total  = loaded.length
  const pct    = total > 0 ? Math.round((ok / total) * 100) : 0

  const color = pct === 100 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-destructive'
  const ring  = pct === 100 ? 'ring-success/30' : pct >= 70 ? 'ring-warning/30' : 'ring-destructive/30'

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Payroll Readiness Score</p>
          <p className={cn('text-4xl font-bold mt-1', color)}>{pct}<span className="text-lg font-normal">%</span></p>
          <p className="text-xs text-muted-foreground mt-1">{ok} of {total} checks passed</p>
        </div>
        <div className={cn(
          'h-20 w-20 rounded-full flex items-center justify-center ring-4',
          ring,
          pct === 100 ? 'bg-success/10' : pct >= 70 ? 'bg-warning/10' : 'bg-destructive/10',
        )}>
          {pct === 100
            ? <CheckCircle2 className={cn('h-10 w-10', color)} />
            : <AlertTriangle className={cn('h-10 w-10', color)} />}
        </div>
      </div>
    </SectionCard>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollReadiness() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // ── Data queries ─────────────────────────────────────────────────────────────

  const { data: pendingLeavesData, isLoading: pendingLeavesLoading } = useQuery<{ total: number }>({
    queryKey: ['payroll-pending-leaves', month],
    queryFn:  () => api.get(`/leave-requests?status=pending&month=${month}&count_only=true`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: pendingRegData, isLoading: pendingRegLoading } = useQuery<{ data: unknown[]; total?: number }>({
    queryKey: ['payroll-pending-reg', month],
    queryFn:  () => api.get(`/attendance/regularisation/pending?month=${month}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: pendingOtData, isLoading: pendingOtLoading } = useQuery<{ data: unknown[]; total?: number }>({
    queryKey: ['payroll-pending-ot', month],
    queryFn:  () => api.get(`/overtime/requests?status=PENDING&month=${month}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: pendingCoData, isLoading: pendingCoLoading } = useQuery<{ data: unknown[]; total?: number }>({
    queryKey: ['payroll-pending-compoff', month],
    queryFn:  () => api.get(`/attendance/comp-off?status=pending&month=${month}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: anomalyData, isLoading: anomalyLoading } = useQuery<{ data: unknown[]; total?: number }>({
    queryKey: ['payroll-anomalies', month],
    queryFn:  () => api.get(`/attendance/anomalies?month=${month}&resolved=false`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: payrollSummaryData, isLoading: summaryLoading } = useQuery<{ summary: PayrollSummary }>({
    queryKey: ['payroll-summary', month],
    queryFn:  () => api.get(`/attendance/payroll-summary?month=${month}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: periodLockData, isLoading: lockLoading } = useQuery<{ data: PeriodLockState }>({
    queryKey: ['period-lock', month],
    queryFn:  () => api.get(`/attendance/period-locks?month=${month}`),
    enabled:  isAdmin,
    staleTime: 30_000,
  })

  const lockState    = periodLockData?.data
  const isLocked     = lockState?.is_locked ?? false
  const payrollSum   = payrollSummaryData?.summary

  // Lock/unlock mutation
  const lockMutation = useMutation({
    mutationFn: (action: 'lock' | 'unlock') =>
      api.post(`/attendance/period-locks/${action}`, { month }),
    onSuccess: (_data, action) => {
      // Exact key with month prevents invalidating period-lock entries for other months
      qc.invalidateQueries({ queryKey: ['period-lock', month], exact: true })
      toast.success(action === 'lock' ? 'Period locked' : 'Period unlocked', {
        description: monthLabel(month),
      })
    },
    onError: (e: Error) => toast.error('Failed to update period lock', { description: e.message }),
  })

  // ── Build checklist ──────────────────────────────────────────────────────────

  const pendingLeavesCount = (pendingLeavesData?.total ?? (pendingLeavesData as { data?: unknown[] })?.data?.length) as number | undefined
  const pendingRegCount    = Array.isArray(pendingRegData?.data) ? pendingRegData!.data.length : (pendingRegData?.total ?? 0)
  const pendingOtCount     = Array.isArray(pendingOtData?.data)  ? pendingOtData!.data.length  : (pendingOtData?.total  ?? 0)
  const pendingCoCount     = Array.isArray(pendingCoData?.data)  ? pendingCoData!.data.length  : (pendingCoData?.total  ?? 0)
  const anomalyCount       = Array.isArray(anomalyData?.data)    ? anomalyData!.data.length    : (anomalyData?.total    ?? 0)

  const checklist: ChecklistItem[] = [
    {
      id:          'period-lock',
      label:       'Period Locked',
      description: isLocked
        ? `Period locked on ${lockState?.locked_at ? (() => { const _d = new Date(lockState.locked_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getDate()).padStart(2,'0')}-${_M[_d.getMonth()]}-${_d.getFullYear()}` })() : '—'}`
        : 'Period is not yet locked — employees can still submit requests',
      count:       isLocked ? 0 : 1,
      status:      lockLoading ? 'loading' : isLocked ? 'ok' : 'warning',
    },
    {
      id:          'pending-leaves',
      label:       'Pending Leave Requests',
      description: `${pendingLeavesCount ?? '—'} unapproved leave request(s) for this month`,
      count:       pendingLeavesCount ?? null,
      status:      pendingLeavesLoading ? 'loading' : (pendingLeavesCount ?? 0) > 0 ? 'error' : 'ok',
      href:        '/admin/approvals/inbox',
    },
    {
      id:          'pending-reg',
      label:       'Pending Regularisations',
      description: `${pendingRegCount} unresolved attendance correction request(s)`,
      count:       pendingRegCount,
      status:      pendingRegLoading ? 'loading' : pendingRegCount > 0 ? 'warning' : 'ok',
      href:        `/admin/attendance/corrections?status=pending&month=${month}`,
    },
    {
      id:          'pending-ot',
      label:       'Pending OT Approvals',
      description: `${pendingOtCount} overtime request(s) awaiting approval`,
      count:       pendingOtCount,
      status:      pendingOtLoading ? 'loading' : pendingOtCount > 0 ? 'warning' : 'ok',
      href:        '/admin/overtime',
    },
    {
      id:          'pending-co',
      label:       'Pending Comp-Off',
      description: `${pendingCoCount} comp-off request(s) awaiting approval`,
      count:       pendingCoCount,
      status:      pendingCoLoading ? 'loading' : pendingCoCount > 0 ? 'warning' : 'ok',
      href:        '/admin/comp-off',
    },
    {
      id:          'anomalies',
      label:       'Unresolved Anomalies',
      description: `${anomalyCount} attendance anomaly(ies) not yet resolved`,
      count:       anomalyCount,
      status:      anomalyLoading ? 'loading' : anomalyCount > 0 ? 'warning' : 'ok',
      href:        `/admin/attendance/anomalies?resolved=false&from=${month}-01`,
    },
  ]

  const allClear  = checklist.every(i => i.count === 0 || i.status === 'ok')
  const errorCount = checklist.filter(i => i.status === 'error').length
  const warnCount  = checklist.filter(i => i.status === 'warning').length

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Payroll Readiness" subtitle="Pre-payroll close checklist" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
            <p className="text-sm text-center max-w-sm">
              Payroll readiness dashboard requires HR Admin or Super Admin role.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Readiness"
        subtitle={`Pre-payroll close checklist — ${monthLabel(month)}`}
      />

      {/* Month nav */}
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonth(prevMonth(month))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium min-w-[160px] text-center">{monthLabel(month)}</span>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonth(nextMonth(month))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Left: Checklist */}
        <div className="lg:col-span-2 space-y-4">
          <ReadinessScore items={checklist} />

          {/* Overall status banner */}
          {allClear ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20 text-success">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">All checks passed</p>
                <p className="text-xs opacity-80">Payroll is ready to process for {monthLabel(month)}.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20 text-warning">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">
                  {errorCount > 0 ? `${errorCount} blocking issue(s)` : `${warnCount} warning(s)`} need attention
                </p>
                <p className="text-xs opacity-80">Resolve all items before closing payroll.</p>
              </div>
            </div>
          )}

          {/* Checklist cards */}
          <SectionCard
            title="Readiness Checklist"
            icon={<FileCheck className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="space-y-1">
              {checklist.map(item => (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-center justify-between px-4 py-3 rounded-lg border transition-colors',
                    item.status === 'error'   ? 'border-destructive/30 bg-destructive/5' :
                    item.status === 'warning' && item.count !== 0 ? 'border-warning/30 bg-warning/5' :
                    item.status === 'ok'  || item.count === 0 ? 'border-success/30 bg-success/5' :
                    'border-border bg-card',
                  )}
                >
                  <div className="flex items-center gap-3">
                    {statusIcon(item.status, item.count)}
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-[11px] text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.count !== null && item.count > 0 && (
                      <Badge
                        variant={item.status === 'error' ? 'destructive' : 'warning'}
                        className="rounded-full text-[10px]"
                      >
                        {item.count}
                      </Badge>
                    )}
                    {item.count === 0 && (
                      <Badge variant="success" className="rounded-full text-[10px]">Clear</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Right: Summary + Lock */}
        <div className="space-y-4">

          {/* Period Lock Panel */}
          <SectionCard
            title="Period Lock"
            icon={isLocked ? <Lock className="h-4 w-4 text-success" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="space-y-3">
              <div className={cn(
                'flex items-center gap-2 p-3 rounded-md',
                isLocked ? 'bg-success/10 text-success' : 'bg-muted/40 text-muted-foreground',
              )}>
                {isLocked
                  ? <><Lock className="h-4 w-4" /><span className="text-sm font-medium">Locked</span></>
                  : <><Unlock className="h-4 w-4" /><span className="text-sm font-medium">Unlocked</span></>
                }
              </div>

              {isLocked && lockState?.locked_at && (
                <div className="text-xs space-y-0.5">
                  <p className="text-muted-foreground">
                    Locked on {(() => { const _d = new Date(lockState.locked_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getDate()).padStart(2,'0')}-${_M[_d.getMonth()]}-${_d.getFullYear()}` })()}
                  </p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                {isLocked
                  ? 'This period is locked. No new attendance changes or leave requests can be submitted.'
                  : 'Lock this period to prevent further changes before payroll processing.'}
              </p>

              <Button
                size="sm"
                variant={isLocked ? 'outline' : 'default'}
                className="w-full h-8 text-xs gap-1.5"
                disabled={lockMutation.isPending || lockLoading}
                onClick={() => lockMutation.mutate(isLocked ? 'unlock' : 'lock')}
              >
                {lockMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {isLocked ? 'Unlock Period' : 'Lock Period'}
              </Button>
            </div>
          </SectionCard>

          {/* Payroll Summary */}
          <SectionCard
            title="Payroll Summary"
            icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
          >
            {summaryLoading ? (
              <div className="space-y-2 animate-pulse">
                {[1,2,3,4].map(i => <div key={i} className="h-8 bg-muted rounded" />)}
              </div>
            ) : payrollSum ? (
              <div className="space-y-2">
                {[
                  { label: 'Employees', value: payrollSum.total_employees, icon: Users, cls: 'text-foreground' },
                  { label: 'Payable Days', value: payrollSum.total_payable_days, icon: CheckCircle2, cls: 'text-success' },
                  { label: 'LOP Days', value: payrollSum.total_lop_days, icon: XCircle, cls: 'text-destructive' },
                  { label: 'Avg Hours/Day', value: payrollSum.avg_work_hours?.toFixed(1) ?? '—', icon: Clock, cls: 'text-info' },
                ].map(({ label, value, icon: Icon, cls }) => (
                  <div key={label} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Icon className={cn('h-3.5 w-3.5', cls)} />
                      {label}
                    </div>
                    <span className={cn('text-sm font-bold', cls)}>{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No payroll data for this period.</p>
            )}
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  )
}
