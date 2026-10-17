/**
 * AdjustmentsQueue — /admin/payroll/adjustments
 *
 * HR admin view for the frozen-period adjustment queue (apps/api/src/routes/payroll/adjustments.ts).
 * Until this page existed there was no frontend consumer of payroll_adjustments at all
 * (SYSTEM_AUDIT_2026-10-14 checkpoint 22 disclosed this as a gap; closed here).
 *
 * Flow: raise (authorized entry) → approve/reject → assign to an open draft
 * payroll run → payslip reflects it on (re)generation → finalize marks it applied.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState, useEffect }                     from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus, CheckCircle2, XCircle, BadgeCheck,
} from 'lucide-react'

import { PageContainer }     from '@/components/layout/PageContainer'
import { PageHeader }        from '@/components/layout/PageHeader'
import { SectionCard }       from '@/components/layout/SectionCard'
import { Button }            from '@/components/ui/button'
import { Badge }             from '@/components/ui/badge'
import { Input }             from '@/components/ui/input'
import { Label }             from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { EmployeeSelector }  from '@/components/filters/EmployeeSelector'
import { api }               from '@/lib/api/client'
import { useAuthStore }      from '@/stores/authStore'
import { toast }             from 'sonner'
import { fmtDate, formatCurrency } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayrollAdjustment {
  id:              string
  employee_id:     string
  locked_month:    string
  apply_to_month:  string | null
  adjustment_type: 'lop_adjustment' | 'arrear' | 'statutory_correction' | 'manual'
  amount:          number
  lop_days_delta:  number | null
  reason:          string
  status:          'pending' | 'approved' | 'applied' | 'rejected' | 'cancelled'
  applied_run_id:  string | null
  created_at:      string
  notes:           string | null
  employees?:      { id: string; first_name: string; last_name: string; employee_code: string } | null
}

interface AdjustmentSummary {
  total: number
  pending: number
  approved: number
  applied: number
  rejected: number
}

interface PayrollRunOption {
  id:     string
  month:  string
  status: string
}

// Must match payroll_adjustments.adjustment_type's CHECK constraint
// (supabase/migrations/167_operational_completion.sql).
const ADJUSTMENT_TYPES = ['lop_adjustment', 'arrear', 'statutory_correction', 'manual'] as const

const STATUS_BADGE: Record<string, 'secondary' | 'outline' | 'warning' | 'success'> = {
  pending:   'warning',
  approved:  'outline',
  applied:   'success',
  rejected:  'secondary',
  cancelled: 'secondary',
}

const fmt = (n: number) => formatCurrency(n)
const labelify = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

// ── Create Adjustment Dialog ────────────────────────────────────────────────────

function CreateAdjustmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState<string>('')
  const [form, setForm] = useState({
    locked_month:    '',
    adjustment_type: 'manual' as typeof ADJUSTMENT_TYPES[number],
    amount:          '',
    lop_days_delta:  '',
    reason:          '',
    notes:           '',
  })

  useEffect(() => {
    if (!open) {
      setEmployeeId('')
      setForm({ locked_month: '', adjustment_type: 'manual', amount: '', lop_days_delta: '', reason: '', notes: '' })
    }
  }, [open])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/adjustments', {
        employee_id:     employeeId,
        locked_month:    form.locked_month,
        adjustment_type: form.adjustment_type,
        amount:          Number(form.amount) || 0,
        lop_days_delta:  form.lop_days_delta ? Number(form.lop_days_delta) : undefined,
        reason:          form.reason,
        notes:           form.notes || undefined,
      }),
    onSuccess: (res: any) => {
      toast.success(
        res?.period_frozen
          ? 'Adjustment raised for a frozen period'
          : 'Adjustment raised (note: that period is not currently frozen)',
      )
      qc.invalidateQueries({ queryKey: ['payroll-adjustments'] })
      qc.invalidateQueries({ queryKey: ['payroll-adjustments-summary'] })
      onClose()
    },
    onError: (e: Error) => {
      toast.error('Failed to raise adjustment', { description: e.message })
    },
  })

  const valid = employeeId && /^\d{4}-\d{2}$/.test(form.locked_month) && form.reason.trim().length >= 3

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Raise Payroll Adjustment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label className="text-sm">Employee</Label>
            <EmployeeSelector value={employeeId} onChange={v => setEmployeeId(v as string)} placeholder="Search by name or code…" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Locked / frozen month (YYYY-MM)</Label>
            <Input type="month" value={form.locked_month} onChange={e => set('locked_month', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Adjustment type</Label>
            <select
              value={form.adjustment_type}
              onChange={e => set('adjustment_type', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {ADJUSTMENT_TYPES.map(t => (
                <option key={t} value={t}>{labelify(t)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Amount</Label>
            <Input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
          </div>
          {form.adjustment_type === 'lop_adjustment' && (
            <div className="space-y-1">
              <Label className="text-sm">LOP days delta</Label>
              <Input type="number" step="0.5" value={form.lop_days_delta} onChange={e => set('lop_days_delta', e.target.value)} placeholder="e.g. 1 (more LOP) or -1 (less LOP)" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-sm">Reason</Label>
            <Input value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="Why this correction is needed" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Notes (optional)</Label>
            <Input value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Raise Adjustment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Reject Dialog ────────────────────────────────────────────────────────────────

function RejectDialog({ open, adjustment, onClose }: { open: boolean; adjustment: PayrollAdjustment | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  useEffect(() => { if (open) setReason('') }, [open])

  const mutation = useMutation({
    mutationFn: () => api.put(`/payroll/adjustments/${adjustment!.id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('Adjustment rejected')
      qc.invalidateQueries({ queryKey: ['payroll-adjustments'] })
      qc.invalidateQueries({ queryKey: ['payroll-adjustments-summary'] })
      onClose()
    },
    onError: (e: Error) => toast.error('Failed to reject adjustment', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reject Adjustment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-sm">Reason</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this is being rejected" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="destructive" disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Assign to Payroll Run Dialog ─────────────────────────────────────────────────
// Mirrors ArrearEngine.tsx/VariablePay.tsx's assign-run shape: only ASSIGNS the
// run (adjustments/:id/apply → assign_payroll_adjustment_to_run_atomic, migration
// 478). Status stays 'approved' until that run is finalized — every (re)generation
// of the run folds this adjustment's signed amount into the payslip fresh.

function AssignRunDialog({
  open,
  adjustment,
  draftRuns,
  onClose,
}: {
  open: boolean
  adjustment: PayrollAdjustment | null
  draftRuns: PayrollRunOption[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [runId, setRunId] = useState('')

  useEffect(() => { if (open) setRunId('') }, [open])

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/adjustments/${adjustment!.id}/apply`, { run_id: runId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-adjustments'] })
      toast.success('Assigned to payroll run — not yet applied. Run (or re-run) payroll for that month, then finalize to mark applied.')
      onClose()
    },
    onError: (e: Error) => toast.error('Failed to assign adjustment to payroll run', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign to Payroll Run</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Adjustment amount <strong className="text-foreground">{adjustment ? fmt(adjustment.amount) : ''}</strong>{' '}
            for the {adjustment?.locked_month} locked period will be reserved for the selected draft run — this does
            not mark it applied yet. Finalizing that run is what marks this adjustment applied.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Draft payroll run</Label>
            {draftRuns.length === 0 ? (
              <p className="text-xs text-warning">No draft payroll run available — create or reopen one first.</p>
            ) : (
              <select
                value={runId}
                onChange={e => setRunId(e.target.value)}
                className="w-full h-9 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">Select a run…</option>
                {draftRuns.map(r => (
                  <option key={r.id} value={r.id}>{r.month} (draft)</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={mutation.isPending || !runId} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────────

export function AdjustmentsQueue() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [showCreate, setShowCreate]   = useState(false)
  const [rejectTarget, setRejectTarget] = useState<PayrollAdjustment | null>(null)
  const [assignTarget, setAssignTarget] = useState<PayrollAdjustment | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')

  const { data: summary } = useQuery<AdjustmentSummary>({
    queryKey: ['payroll-adjustments-summary'],
    queryFn:  () => api.get<AdjustmentSummary>('/payroll/adjustments/summary'),
    enabled:  isAdmin,
  })

  const { data: adjustmentsResp, isLoading, refetch } = useQuery<{ data: PayrollAdjustment[] }>({
    queryKey: ['payroll-adjustments', statusFilter],
    queryFn:  () => api.get(`/payroll/adjustments${statusFilter ? `?status=${statusFilter}` : ''}`),
    enabled:  isAdmin,
  })
  const adjustments = adjustmentsResp?.data ?? []

  const { data: payrollRunsResp } = useQuery<{ data: PayrollRunOption[] }>({
    queryKey: ['payroll-runs-for-adjustments'],
    queryFn:  () => api.get('/payroll/runs?limit=50'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const draftPayrollRuns = (payrollRunsResp?.data ?? []).filter(r => r.status === 'draft')

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/payroll/adjustments/${id}/approve`, {}),
    onSuccess:  () => {
      toast.success('Adjustment approved')
      qc.invalidateQueries({ queryKey: ['payroll-adjustments'] })
      qc.invalidateQueries({ queryKey: ['payroll-adjustments-summary'] })
    },
    onError: (e: Error) => toast.error('Failed to approve adjustment', { description: e.message }),
  })

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Payroll Adjustments" subtitle="HR admin access required." />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Adjustments"
        subtitle="Retroactive corrections raised against a frozen payroll period — review, approve and assign to an open run."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Raise Adjustment
            </Button>
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {(['pending', 'approved', 'applied', 'rejected'] as const).map(k => (
            <SectionCard key={k} className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">{labelify(k)}</div>
              <div className="text-2xl font-semibold text-foreground mt-1">{summary[k]}</div>
            </SectionCard>
          ))}
        </div>
      )}

      <SectionCard>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex gap-2">
            {['', 'pending', 'approved', 'applied', 'rejected'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {s ? labelify(s) : 'All'}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : adjustments.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center">No adjustments found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-3 px-4 font-medium">Employee</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Locked Month</th>
                  <th className="text-right py-3 px-4 font-medium">Amount</th>
                  <th className="text-left py-3 px-4 font-medium">Reason</th>
                  <th className="text-center py-3 px-4 font-medium">Status</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map(a => (
                  <tr key={a.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">
                        {a.employees ? `${a.employees.first_name} ${a.employees.last_name}` : '—'}
                      </div>
                      {a.employees?.employee_code && (
                        <div className="text-xs text-muted-foreground">{a.employees.employee_code}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-foreground">{labelify(a.adjustment_type)}</td>
                    <td className="py-3 px-4 text-foreground">{a.locked_month}</td>
                    <td className="py-3 px-4 text-right font-medium text-foreground">{fmt(a.amount)}</td>
                    <td className="py-3 px-4 text-foreground max-w-xs truncate" title={a.reason}>{a.reason}</td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={STATUS_BADGE[a.status] ?? 'secondary'}>{labelify(a.status)}</Badge>
                      {a.applied_run_id && a.status === 'approved' && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">Assigned, pending run finalization</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        {a.status === 'pending' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(a.id)} disabled={approveMutation.isPending}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRejectTarget(a)}>
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                            </Button>
                          </>
                        )}
                        {a.status === 'approved' && !a.applied_run_id && (
                          <Button size="sm" variant="outline" onClick={() => setAssignTarget(a)}>
                            <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Assign to Run
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <CreateAdjustmentDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <RejectDialog open={!!rejectTarget} adjustment={rejectTarget} onClose={() => setRejectTarget(null)} />
      <AssignRunDialog open={!!assignTarget} adjustment={assignTarget} draftRuns={draftPayrollRuns} onClose={() => setAssignTarget(null)} />
    </PageContainer>
  )
}
