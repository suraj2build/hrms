/**
 * PayrollGovernance — /admin/payroll/governance
 *
 * Maker-checker log, payroll freeze management, and variance approvals.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Lock, Unlock, CheckCircle2, XCircle,
  Loader2, Scale, AlertTriangle,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SubTabs }       from '@/components/ui/SubTabs'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }           from '@/lib/utils'
import { toast }        from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MakerCheckerLog {
  id: string
  entity_type: string
  entity_id: string
  action: string
  status: 'pending' | 'approved' | 'rejected'
  maker_id: string
  checker_id: string | null
  maker_name?: string
  checker_name?: string
  payload: Record<string, unknown>
  created_at: string
  checked_at: string | null
}

interface PayrollFreezeLog {
  id: string
  payroll_month: string
  action: 'freeze' | 'unfreeze'
  performed_by: string
  performed_by_name?: string
  reason: string | null
  created_at: string
}

interface VarianceApproval {
  id: string
  payroll_month: string
  employee_id: string
  component_code: string
  expected_amount: number
  actual_amount: number
  variance_pct: number
  status: 'pending' | 'approved' | 'rejected'
  approved_by: string | null
  employee_name?: string
}

interface FreezeStatus {
  is_frozen: boolean
  month: string
  frozen_at?: string
  frozen_by?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string) {
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

function StatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const map = {
    pending:  { label: 'Pending',  cls: 'text-warning border-border'     },
    approved: { label: 'Approved', cls: 'text-success border-border'     },
    rejected: { label: 'Rejected', cls: 'text-destructive border-border' },
  }
  const { label, cls } = map[status]
  return <Badge variant="outline" className={cls}>{label}</Badge>
}

function VarianceBadge({ pct }: { pct: number }) {
  const abs = Math.abs(pct ?? 0)
  const cls = abs >= 20
    ? 'text-destructive border-border'
    : abs >= 10
      ? 'text-warning border-border'
      : 'text-success border-border'
  return (
    <Badge variant="outline" className={cls}>
      {(pct ?? 0) > 0 ? '+' : ''}{(pct ?? 0).toFixed(1)}%
    </Badge>
  )
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: (reason: string) => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reject — Provide Reason</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <textarea
            rows={3}
            placeholder="Reason for rejection…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || isPending}
              onClick={() => onConfirm(reason.trim())}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Freeze Dialog ─────────────────────────────────────────────────────────────

function FreezeDialog({
  open,
  onOpenChange,
  action,
  onConfirm,
  isPending,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  action: 'freeze' | 'unfreeze'
  onConfirm: (month: string, reason: string) => void
  isPending: boolean
}) {
  const [month, setMonth]   = useState('')
  const [reason, setReason] = useState('')
  const [error, setError]   = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!month) { setError('Month is required.'); return }
    onConfirm(month, reason)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setMonth(''); setReason(''); setError(null) } onOpenChange(v) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{action === 'freeze' ? 'Freeze Payroll' : 'Unfreeze Payroll'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Month <span className="text-destructive">*</span></label>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Reason</label>
            <textarea
              rows={2}
              placeholder="Optional reason…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {action === 'freeze' ? 'Freeze' : 'Unfreeze'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Maker-Checker Tab ─────────────────────────────────────────────────────────

function MakerCheckerTab() {
  const queryClient = useQueryClient()
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)

  const { data: logs, isLoading } = useQuery<MakerCheckerLog[]>({
    queryKey: ['maker-checker-logs'],
    queryFn: () => api.get<{ data: MakerCheckerLog[] }>('/payroll/governance/maker-checker').then(r => r.data),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post<{ data: unknown }>(`/payroll/governance/maker-checker/${id}/approve`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maker-checker-logs'] })
      // Approval changes run status/stats — keep ops pages in sync
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-run-stats'] })
      toast.success('Entry approved')
    },
    onError: (e: Error) => {
      // 409 means already actioned by another checker — refresh the list so the
      // record shows its current (non-pending) status instead of remaining stale.
      queryClient.invalidateQueries({ queryKey: ['maker-checker-logs'] })
      toast.error('Failed to approve entry', { description: e.message })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ data: unknown }>(`/payroll/governance/maker-checker/${id}/reject`, { reason }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maker-checker-logs'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-run-stats'] })
      setRejectTarget(null)
      toast.success('Entry rejected')
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ['maker-checker-logs'] })
      toast.error('Failed to reject entry', { description: e.message })
    },
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading logs…
    </div>
  )

  if (!logs?.length) return (
    <p className="py-10 text-center text-sm text-muted-foreground">No maker-checker records found.</p>
  )

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 pb-3 font-medium">Entity Type</th>
              <th className="px-4 pb-3 font-medium">Action</th>
              <th className="px-4 pb-3 font-medium">Maker</th>
              <th className="px-4 pb-3 font-medium">Checker</th>
              <th className="px-4 pb-3 font-medium">Status</th>
              <th className="px-4 pb-3 font-medium">Created</th>
              <th className="px-4 pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground capitalize">{log.entity_type.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-foreground capitalize">{log.action.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-foreground">{log.maker_name ?? log.maker_id}</td>
                <td className="px-4 py-3 text-muted-foreground">{log.checker_name ?? log.checker_id ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</td>
                <td className="px-4 py-3">
                  {log.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-success border-border"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(log.id)}
                      >
                        {approveMutation.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-destructive border-border"
                        onClick={() => setRejectTarget(log.id)}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {log.checked_at ? fmtDate(log.checked_at) : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RejectDialog
        open={!!rejectTarget}
        onOpenChange={v => { if (!v) setRejectTarget(null) }}
        isPending={rejectMutation.isPending}
        onConfirm={reason => {
          if (rejectTarget) rejectMutation.mutate({ id: rejectTarget, reason })
        }}
      />
    </>
  )
}

// ── Payroll Freeze Tab ────────────────────────────────────────────────────────

function PayrollFreezeTab() {
  const queryClient = useQueryClient()
  const [selectedMonth, setSelectedMonth] = useState('')
  const [appliedMonth, setAppliedMonth]   = useState('')
  const [freezeOpen, setFreezeOpen]       = useState(false)
  const [unfreezeOpen, setUnfreezeOpen]   = useState(false)

  const { data: freezeStatus, isLoading: loadingStatus } = useQuery<FreezeStatus>({
    queryKey: ['freeze-status', appliedMonth],
    queryFn: () => api.get<{ data: FreezeStatus }>(`/payroll/governance/freeze?month=${appliedMonth}`).then(r => r.data),
    enabled: !!appliedMonth,
  })

  const { data: freezeLogs, isLoading: loadingLogs } = useQuery<PayrollFreezeLog[]>({
    queryKey: ['freeze-logs'],
    queryFn: () => api.get<{ data: PayrollFreezeLog[] }>('/payroll/governance/freeze').then(r => r.data),
  })

  const freezeMutation = useMutation({
    mutationFn: ({ month, reason }: { month: string; reason: string }) =>
      api.post<{ data: unknown }>('/payroll/governance/freeze', { month, reason }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freeze-status'] })
      queryClient.invalidateQueries({ queryKey: ['freeze-logs'] })
      setFreezeOpen(false)
      toast.success('Payroll frozen')
    },
    onError: (e: Error) => toast.error('Failed to freeze payroll', { description: e.message }),
  })

  const unfreezeMutation = useMutation({
    mutationFn: ({ month, reason }: { month: string; reason: string }) =>
      api.post<{ data: unknown }>('/payroll/governance/unfreeze', { month, reason }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['freeze-status'] })
      queryClient.invalidateQueries({ queryKey: ['freeze-logs'] })
      setUnfreezeOpen(false)
      toast.success('Payroll unfrozen')
    },
    onError: (e: Error) => toast.error('Failed to unfreeze payroll', { description: e.message }),
  })

  return (
    <div className="space-y-4">
      {/* Month selector + status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-44 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Select Month</label>
          <Input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => setAppliedMonth(selectedMonth)} disabled={!selectedMonth}>
          Check Status
        </Button>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" className="gap-2 text-destructive border-border" onClick={() => setFreezeOpen(true)}>
            <Lock className="h-4 w-4" /> Freeze
          </Button>
          <Button variant="outline" className="gap-2 text-success border-border" onClick={() => setUnfreezeOpen(true)}>
            <Unlock className="h-4 w-4" /> Unfreeze
          </Button>
        </div>
      </div>

      {/* Status indicator */}
      {appliedMonth && (
        <div className={cn(
          'rounded-lg border px-4 py-3 flex items-center gap-3',
          loadingStatus ? 'border-border bg-muted/30' :
          freezeStatus?.is_frozen ? 'border-border bg-destructive/10' : 'border-border bg-success/10',
        )}>
          {loadingStatus ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : freezeStatus?.is_frozen ? (
            <Lock className="h-5 w-5 text-destructive" />
          ) : (
            <Unlock className="h-5 w-5 text-success" />
          )}
          <div>
            {loadingStatus ? (
              <p className="text-sm text-muted-foreground">Checking freeze status…</p>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">
                  {appliedMonth} — {freezeStatus?.is_frozen ? 'Frozen' : 'Open'}
                </p>
                {freezeStatus?.is_frozen && freezeStatus.frozen_by && (
                  <p className="text-xs text-muted-foreground">
                    Frozen by {freezeStatus.frozen_by}
                    {freezeStatus.frozen_at ? ` on ${fmtDate(freezeStatus.frozen_at)}` : ''}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Freeze log table */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Freeze Log</h3>
        {loadingLogs ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading log…
          </div>
        ) : !freezeLogs?.length ? (
          <p className="text-sm text-muted-foreground py-6">No freeze actions recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 pb-3 font-medium">Month</th>
                  <th className="px-4 pb-3 font-medium">Action</th>
                  <th className="px-4 pb-3 font-medium">Performed By</th>
                  <th className="px-4 pb-3 font-medium">Reason</th>
                  <th className="px-4 pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {freezeLogs.map(log => (
                  <tr key={log.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-foreground">{log.payroll_month}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={log.action === 'freeze' ? 'text-destructive border-border' : 'text-success border-border'}>
                        {log.action === 'freeze' ? 'Freeze' : 'Unfreeze'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground">{log.performed_by_name ?? log.performed_by}</td>
                    <td className="px-4 py-3 text-muted-foreground">{log.reason ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FreezeDialog
        open={freezeOpen}
        onOpenChange={setFreezeOpen}
        action="freeze"
        isPending={freezeMutation.isPending}
        onConfirm={(m, r) => freezeMutation.mutate({ month: m, reason: r })}
      />
      <FreezeDialog
        open={unfreezeOpen}
        onOpenChange={setUnfreezeOpen}
        action="unfreeze"
        isPending={unfreezeMutation.isPending}
        onConfirm={(m, r) => unfreezeMutation.mutate({ month: m, reason: r })}
      />
    </div>
  )
}

// ── Variance Approvals Tab ────────────────────────────────────────────────────

function VarianceApprovalsTab() {
  const queryClient = useQueryClient()
  const [month, setMonth]         = useState('')
  const [appliedMonth, setApplied] = useState('')

  const { data: variances, isLoading } = useQuery<VarianceApproval[]>({
    queryKey: ['variance-approvals', appliedMonth],
    queryFn: () => api.get<{ data: VarianceApproval[] }>(`/payroll/governance/variances?month=${appliedMonth}`).then(r => r.data),
    enabled: !!appliedMonth,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post<{ data: unknown }>(`/payroll/governance/variances/${id}/approve`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variance-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-run-stats'] })
      toast.success('Variance approved')
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ['variance-approvals'] })
      toast.error('Failed to approve variance', { description: e.message })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post<{ data: unknown }>(`/payroll/governance/variances/${id}/reject`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variance-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-run-stats'] })
      toast.success('Variance rejected')
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ['variance-approvals'] })
      toast.error('Failed to reject variance', { description: e.message })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="w-44 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Payroll Month</label>
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => setApplied(month)} disabled={!month}>
          Load Variances
        </Button>
      </div>

      {!appliedMonth ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Select a month and click Load Variances.</p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading variances…
        </div>
      ) : !variances?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No variance records for {appliedMonth}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 pb-3 font-medium">Employee</th>
                <th className="px-4 pb-3 font-medium">Component</th>
                <th className="px-4 pb-3 font-medium text-right">Expected</th>
                <th className="px-4 pb-3 font-medium text-right">Actual</th>
                <th className="px-4 pb-3 font-medium">Variance</th>
                <th className="px-4 pb-3 font-medium">Status</th>
                <th className="px-4 pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variances.map(v => (
                <tr key={v.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3 text-foreground">{v.employee_name ?? v.employee_id}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{v.component_code}</td>
                  <td className="px-4 py-3 text-right text-foreground">{fmt(v.expected_amount)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{fmt(v.actual_amount)}</td>
                  <td className="px-4 py-3"><VarianceBadge pct={v.variance_pct} /></td>
                  <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                  <td className="px-4 py-3">
                    {v.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-success border-border"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(v.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-destructive border-border"
                          disabled={rejectMutation.isPending}
                          onClick={() => rejectMutation.mutate(v.id)}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    )}
                    {v.status !== 'pending' && (
                      <span className="text-xs text-muted-foreground">
                        {v.status === 'approved' ? `By: ${v.approved_by ?? '—'}` : 'Rejected'}
                      </span>
                    )}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PayrollGovernance() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [activeTab, setActiveTab] = useState<'maker-checker' | 'freeze' | 'variances'>('maker-checker')

  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              You do not have permission to access Payroll Governance. Contact your HR administrator.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const tabs = [
    { id: 'maker-checker' as const, label: 'Maker-Checker Log',   icon: Scale          },
    { id: 'freeze'        as const, label: 'Payroll Freeze',      icon: Lock           },
    { id: 'variances'     as const, label: 'Variance Approvals',  icon: AlertTriangle  },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Governance"
        subtitle="Maker-checker approvals, freeze management, and variance controls"
      />

      {/* Tabs */}
      <SubTabs<typeof activeTab>
        tabs={tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      <SectionCard>
        {activeTab === 'maker-checker' && <MakerCheckerTab />}
        {activeTab === 'freeze'        && <PayrollFreezeTab />}
        {activeTab === 'variances'     && <VarianceApprovalsTab />}
      </SectionCard>
    </PageContainer>
  )
}
