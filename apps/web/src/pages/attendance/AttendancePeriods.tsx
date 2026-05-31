import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Unlock, PlayCircle, CheckCircle2, ChevronLeft, ChevronRight, ShieldAlert, RefreshCw, Loader2, Calendar, AlertTriangle, Users } from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer }   from '@/components/layout/PageContainer'
import { PageHeader }      from '@/components/layout/PageHeader'
import { SectionCard }     from '@/components/layout/SectionCard'
import { Button }          from '@/components/ui/button'
import { Input }           from '@/components/ui/input'
import { Badge }           from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { api }             from '@/lib/api/client'
import { useAuthStore }    from '@/stores/authStore'
import { cn }              from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type PeriodState = 'OPEN' | 'LOCKED' | 'PAYROLL_PROCESSING' | 'PAYROLL_FINALIZED'

interface PeriodLock {
  id?:           string
  period_month:  string
  state:         PeriodState
  locked_at?:    string | null
  locked_by?:    string | null
  lock_reason?:  string | null
  unlocked_at?:  string | null
  finalized_at?: string | null
  created_at?:   string
}

interface ActionDialogState {
  open:   boolean
  action: 'lock' | 'unlock' | 'start-payroll' | 'finalize' | null
  month:  string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const d = new Date(ym.slice(0,7) + '-01T12:00:00Z')
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── State config ──────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<PeriodState, { label: string; variant: 'success' | 'warning' | 'info' | 'secondary'; description: string }> = {
  OPEN:               { label: 'Open',               variant: 'success',   description: 'Attendance data can be modified' },
  LOCKED:             { label: 'Locked',             variant: 'warning',   description: 'Attendance data is locked for review' },
  PAYROLL_PROCESSING: { label: 'Payroll Processing', variant: 'info',      description: 'Payroll is being processed' },
  PAYROLL_FINALIZED:  { label: 'Finalized',          variant: 'secondary', description: 'Period is closed and finalized' },
}

/** Safe lookup — normalises lowercase/unknown DB values and never returns undefined */
function stateCfg(state: string | null | undefined) {
  if (!state) return STATE_CONFIG['OPEN']
  const upper = state.toUpperCase()
  // handle shortened DB values like 'processing' → 'PAYROLL_PROCESSING'
  if (upper === 'PROCESSING')        return STATE_CONFIG['PAYROLL_PROCESSING']
  if (upper === 'FINALIZED')         return STATE_CONFIG['PAYROLL_FINALIZED']
  return STATE_CONFIG[upper as PeriodState] ?? { label: state, variant: 'secondary' as const, description: '' }
}

// ── Dialog config ─────────────────────────────────────────────────────────────

const DIALOG_CONFIG: Record<
  NonNullable<ActionDialogState['action']>,
  { title: string; desc: string; confirmLabel: string; needsReason: boolean }
> = {
  lock:            { title: 'Lock Period',    desc: 'Lock this period to prevent further attendance modifications. Provide a reason for the lock.',                       confirmLabel: 'Lock Period',   needsReason: true  },
  unlock:          { title: 'Unlock Period',  desc: 'Unlock this period to allow attendance corrections. Provide a reason for unlocking.',                               confirmLabel: 'Unlock',        needsReason: true  },
  'start-payroll': { title: 'Start Payroll',  desc: 'Advance this period to Payroll Processing. No further corrections will be allowed.',                               confirmLabel: 'Start Payroll', needsReason: false },
  finalize:        { title: 'Finalize Period',desc: 'Permanently close this period. This action marks the payroll as finalized and cannot be reversed.',                 confirmLabel: 'Finalize',      needsReason: false },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AttendancePeriods() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const queryClient = useQueryClient()

  // Selected month navigation (default: current month)
  const [viewDate, setViewDate] = useState(() => new Date())
  const selectedMonth = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`

  // Action dialog state
  const [dialog, setDialog] = useState<ActionDialogState>({ open: false, action: null, month: '' })
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState('')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: historyData, isLoading: histLoading, refetch } = useQuery<{ data: PeriodLock[] }>({
    queryKey: ['period-locks'],
    queryFn:  () => api.get('/attendance/period-locks'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const history = historyData?.data ?? []

  const { data: currentData, isLoading: currentLoading } = useQuery<{ data: PeriodLock }>({
    queryKey: ['period-lock', selectedMonth],
    queryFn:  () => api.get(`/attendance/period-locks/${selectedMonth}`),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const currentPeriod: PeriodLock = currentData?.data ?? { period_month: selectedMonth, state: 'OPEN' as PeriodState }

  // Fetch anomaly impact for the selected month — used in the lock confirmation dialog
  const { data: anomalySummary } = useQuery({
    queryKey: ['anomaly-summary-lock', selectedMonth],
    queryFn:  () => api.get(`/attendance/anomalies/summary?month=${selectedMonth}`),
    enabled:  isAdmin && dialog.open && dialog.action === 'lock',
    staleTime: 60_000,
  })

  const lopImpact = {
    anomalyCount:      (anomalySummary as any)?.summary?.unresolved ?? 0,
    departmentCount:   ((anomalySummary as any)?.by_department ?? []).filter((d: any) => d.unresolved_count > 0).length,
    affectedEmployees: ((anomalySummary as any)?.by_department ?? []).reduce((sum: number, d: any) => sum + (d.affected_employees ?? 0), 0),
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  const actionMutation = useMutation({
    mutationFn: ({ month, action, reason: r }: { month: string; action: string; reason?: string }) =>
      api.post(`/attendance/period-locks/${month}/${action}`, r ? { reason: r } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period-locks'] })
      queryClient.invalidateQueries({ queryKey: ['period-lock', dialog.month] })
      const actionLabel: Record<string, string> = {
        lock:            'Period locked',
        unlock:          'Period unlocked',
        'start-payroll': 'Payroll processing started',
        finalize:        'Period finalized',
      }
      toast.success(actionLabel[dialog.action ?? ''] ?? 'Action completed', {
        description: fmtMonth(dialog.month),
      })
      setDialog({ open: false, action: null, month: '' })
      setReason('')
      setActionError('')
    },
    onError: (e: Error) => {
      const msg = e instanceof Error ? e.message : 'Action failed'
      setActionError(msg)
      toast.error('Action failed', { description: msg })
    },
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  function openDialog(action: ActionDialogState['action'], month: string) {
    setReason('')
    setActionError('')
    setDialog({ open: true, action, month })
  }

  function getAvailableActions(state: PeriodState, month: string) {
    const actions: Array<{
      label: string
      icon: React.ComponentType<{ className?: string }>
      variant: 'outline'
      onClick: () => void
      className: string
    }> = []

    if (state === 'OPEN') {
      actions.push({
        label: 'Lock Period',
        icon: Lock,
        variant: 'outline' as const,
        onClick: () => openDialog('lock', month),
        className: 'border-warning/40 text-warning hover:bg-warning/10',
      })
    }
    if (state === 'LOCKED') {
      actions.push(
        {
          label: 'Unlock',
          icon: Unlock,
          variant: 'outline' as const,
          onClick: () => openDialog('unlock', month),
          className: 'border-success/40 text-success hover:bg-success/10',
        },
        {
          label: 'Start Payroll',
          icon: PlayCircle,
          variant: 'outline' as const,
          onClick: () => openDialog('start-payroll', month),
          className: 'border-info/40 text-info hover:bg-info/10',
        },
      )
    }
    if (state === 'PAYROLL_PROCESSING') {
      actions.push({
        label: 'Finalize',
        icon: CheckCircle2,
        variant: 'outline' as const,
        onClick: () => openDialog('finalize', month),
        className: 'border-primary/40 text-primary hover:bg-primary/10',
      })
    }
    return actions
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Period Manager"
        subtitle="Control attendance period lock states for payroll processing"
      />

      {/* Access guard */}
      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can manage period locks.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <>
          {/* Current period card */}
          <SectionCard
            title={`Current Period — ${fmtMonth(selectedMonth)}`}
            icon={<Lock className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
          >
            {currentLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span></div>
            ) : (
              <div className="space-y-4">
                {/* State badge + description */}
                <div className="flex items-center gap-3">
                  <Badge variant={stateCfg(currentPeriod.state).variant} className="rounded-full text-xs px-3">
                    {stateCfg(currentPeriod.state).label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{stateCfg(currentPeriod.state).description}</span>
                </div>

                {/* State timeline */}
                <div className="flex items-center gap-0">
                  {(['OPEN', 'LOCKED', 'PAYROLL_PROCESSING', 'PAYROLL_FINALIZED'] as PeriodState[]).map((state, i, arr) => {
                    const stateIdx = arr.indexOf(currentPeriod.state)
                    const isActive = state === currentPeriod.state
                    const isPast   = i < stateIdx
                    return (
                      <div key={state} className="flex items-center">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            'h-3 w-3 rounded-full border-2 transition-colors',
                            isActive ? 'bg-primary border-primary' : isPast ? 'bg-success border-success' : 'bg-muted border-border',
                          )} />
                          <span className={cn(
                            'text-[10px] mt-1 font-medium whitespace-nowrap',
                            isActive ? 'text-primary' : isPast ? 'text-success' : 'text-muted-foreground',
                          )}>
                            {stateCfg(state).label}
                          </span>
                        </div>
                        {i < arr.length - 1 && (
                          <div className={cn('h-0.5 w-16 mx-1 mb-4', isPast ? 'bg-success' : 'bg-border')} />
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Lock info */}
                {currentPeriod.locked_at && (
                  <div className="text-xs text-muted-foreground space-y-1 p-3 rounded-md bg-muted/40">
                    <p>Locked on <span className="text-foreground font-medium">{fmtDate(currentPeriod.locked_at)}</span></p>
                    {currentPeriod.lock_reason && (
                      <p>Reason: <span className="text-foreground">{currentPeriod.lock_reason}</span></p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                {getAvailableActions(currentPeriod.state, currentPeriod.period_month).length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {getAvailableActions(currentPeriod.state, currentPeriod.period_month).map(action => (
                      <Button
                        key={action.label}
                        size="sm"
                        variant={action.variant}
                        className={cn('h-8 text-xs gap-1.5', action.className)}
                        onClick={action.onClick}
                      >
                        <action.icon className="h-3.5 w-3.5" />
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* History table */}
          <SectionCard
            title="Period History"
            icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5"
                onClick={() => refetch()}
                disabled={histLoading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            }
          >
            {histLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span></div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <Calendar className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No period lock records yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Period', 'State', 'Locked', 'Finalized', 'Actions'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.period_month} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 font-medium text-xs">{fmtMonth(row.period_month)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={stateCfg(row.state).variant} className="rounded-full text-[10px]">
                            {stateCfg(row.state).label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(row.locked_at)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(row.finalized_at)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {getAvailableActions(row.state, row.period_month).map(action => (
                              <Button
                                key={action.label}
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2 gap-1"
                                onClick={action.onClick}
                              >
                                <action.icon className="h-3 w-3" />
                                {action.label}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Action dialog */}
      <Dialog open={dialog.open} onOpenChange={open => !open && setDialog(d => ({ ...d, open: false }))}>
        <DialogContent className="max-w-md">
          {dialog.action && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{DIALOG_CONFIG[dialog.action].title}</DialogTitle>
                <DialogDescription className="text-xs">{DIALOG_CONFIG[dialog.action].desc}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-md bg-muted/40 text-xs">
                  <span className="text-muted-foreground">Period: </span>
                  <span className="font-medium">{fmtMonth(dialog.month)}</span>
                </div>

                {/* LOP impact warning — only shown for lock action */}
                {dialog.action === 'lock' && lopImpact.anomalyCount > 0 && (
                  <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                      <p className="text-sm font-semibold text-destructive">Payroll Impact Warning</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Locking this period will <strong className="text-foreground">auto-mark {lopImpact.anomalyCount} unresolved {lopImpact.anomalyCount === 1 ? 'anomaly' : 'anomalies'} as Absent (LOP)</strong> for employees who did not submit a regularisation request.
                    </p>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-foreground font-semibold">{lopImpact.affectedEmployees}</span>
                        <span className="text-muted-foreground">employees affected</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-foreground font-semibold">{lopImpact.departmentCount}</span>
                        <span className="text-muted-foreground">departments</span>
                      </div>
                    </div>
                    <p className="text-[10.5px] text-muted-foreground border-t border-destructive/15 pt-2">
                      This cannot be undone without manually unlocking the period. Pending regularisation requests will be auto-rejected.
                    </p>
                  </div>
                )}

                {dialog.action === 'lock' && lopImpact.anomalyCount === 0 && (
                  <div className="rounded-xl border border-success/25 bg-success/5 p-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                    <p className="text-xs text-success font-medium">All anomalies resolved — no LOP impact on lock</p>
                  </div>
                )}

                {DIALOG_CONFIG[dialog.action].needsReason && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Reason</label>
                    <Input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Enter reason…"
                      className="h-8 text-xs"
                    />
                  </div>
                )}
                {actionError && (
                  <p className="text-xs text-destructive">{actionError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => setDialog(d => ({ ...d, open: false }))}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={
                      actionMutation.isPending ||
                      (DIALOG_CONFIG[dialog.action].needsReason && !reason.trim())
                    }
                    onClick={() =>
                      actionMutation.mutate({
                        month: dialog.month,
                        action: dialog.action!,
                        reason: reason.trim() || undefined,
                      })
                    }
                  >
                    {actionMutation.isPending ? 'Processing…' : DIALOG_CONFIG[dialog.action].confirmLabel}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
