/**
 * ArrearEngine — /admin/payroll/arrears
 *
 * HR admin view: manage arrear batches, trigger calculations, and view records.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState, useRef, useEffect }             from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus, Calculator,
  CheckCircle2, Eye, BadgeCheck,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import { Label }          from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { toast }          from 'sonner'
import { fmtDate, formatCurrency } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ArrearBatch {
  id:                      string
  batch_name:              string
  from_period:             string
  to_period:               string
  payout_month:            string | null
  arrear_type:             string
  status:                  'draft' | 'calculated' | 'approved' | 'processing' | 'processed' | 'cancelled'
  total_arrear_amount:     number
  employee_count:          number
  processed_payroll_run_id: string | null
  created_at:              string
}

interface PayrollRunOption {
  id:     string
  month:  string
  status: string
}

interface ArrearRecord {
  id:              string
  batch_id:        string
  employee_id:     string
  component_code:  string
  old_amount:      number
  new_amount:      number
  arrear_amount:   number
  period_months:   number
  payout_month:    string | null
  status:          string
  employee_name?:  string
  employee_code?:  string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'secondary' | 'outline' | 'warning' | 'success'> = {
  draft:      'secondary',
  calculated: 'warning',
  approved:   'success',
  processing: 'outline',
  processed:  'success',
  cancelled:  'secondary',
}

// Must match ARREAR_TYPES in apps/api/src/routes/payroll/arrears.ts (also
// the arrear_batches.arrear_type CHECK constraint).
const ARREAR_TYPES = ['salary_revision', 'bonus_revision', 'component_change', 'correction', 'other']

const fmt = (n: number) => formatCurrency(n)

const labelify = (s: string) =>
  s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

// ── Create Batch Dialog ────────────────────────────────────────────────────────

function CreateBatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    batch_name:   '',
    from_period:  '',
    to_period:    '',
    payout_month: '',
    arrear_type:  'salary_revision',
    notes:        '',
  })

  // New key each time the dialog opens, so a double-click on "Create Batch"
  // within one open/submit cycle is deduped without also deduping the next
  // legitimate batch creation after this dialog is reopened.
  const idempotencyKey = useRef(crypto.randomUUID())
  useEffect(() => {
    if (open) idempotencyKey.current = crypto.randomUUID()
  }, [open])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/arrears/batches', form, { headers: { 'Idempotency-Key': idempotencyKey.current } }),
    onSuccess:  () => {
      toast.success('Arrear batch created')
      qc.invalidateQueries({ queryKey: ['arrear-batches'] })
      onClose()
      setForm({ batch_name: '', from_period: '', to_period: '', payout_month: '', arrear_type: 'salary_revision', notes: '' })
    },
    onError: (e: Error) => {
      toast.error('Failed to create arrear batch', { description: e.message })
    },
  })

  const valid = form.batch_name && form.from_period && form.to_period && form.payout_month

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Arrear Batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Batch Name</label>
            <Input
              value={form.batch_name}
              onChange={e => set('batch_name', e.target.value)}
              placeholder="e.g. Revision Arrears Jan–Mar 2025"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">From Period (YYYY-MM)</label>
              <Input
                type="month"
                value={form.from_period}
                onChange={e => set('from_period', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">To Period (YYYY-MM)</label>
              <Input
                type="month"
                value={form.to_period}
                onChange={e => set('to_period', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Payout Month (YYYY-MM)</label>
            <Input
              type="month"
              value={form.payout_month}
              onChange={e => set('payout_month', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The payroll run this arrear will be paid through. Must be a draft run's month.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Arrear Type</label>
            <select
              value={form.arrear_type}
              onChange={e => set('arrear_type', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {ARREAR_TYPES.map(t => (
                <option key={t} value={t}>{labelify(t)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Notes (optional)</label>
            <Input
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any additional notes..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Batch
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Records Dialog ─────────────────────────────────────────────────────────────

function RecordsDialog({
  open,
  batch,
  onClose,
}: {
  open: boolean
  batch: ArrearBatch | null
  onClose: () => void
}) {
  const { data: records = [], isLoading } = useQuery<ArrearRecord[]>({
    queryKey: ['arrear-records', batch?.id],
    queryFn:  () =>
      api.get<{ data: ArrearRecord[] }>(`/payroll/arrears/batches/${batch!.id}/records`).then((r) => r.data),
    enabled:  open && !!batch,
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Arrear Records — {batch?.batch_name}
            {batch && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({batch.from_period} → {batch.to_period})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="pt-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : records.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No records found. Run Calculate to generate arrear records.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Employee</th>
                    <th className="text-left py-3 px-4 font-medium">Component</th>
                    <th className="text-right py-3 px-4 font-medium">Old Amount</th>
                    <th className="text-right py-3 px-4 font-medium">New Amount</th>
                    <th className="text-right py-3 px-4 font-medium">Arrear</th>
                    <th className="text-left py-3 px-4 font-medium">Payout Month</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">
                          {r.employee_name ?? r.employee_code ?? '—'}
                        </div>
                        {r.employee_code && (
                          <div className="text-xs text-muted-foreground">{r.employee_code}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{r.component_code}</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(r.old_amount)}</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(r.new_amount)}</td>
                      <td className="py-3 px-4 text-right font-medium text-foreground">
                        {fmt(r.arrear_amount)}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{r.payout_month ?? '—'}</td>
                      <td className="py-3 px-4">
                        <Badge variant={STATUS_BADGE[r.status] ?? 'secondary'}>
                          {labelify(r.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Assign to Payroll Run Dialog ───────────────────────────────────────────────
// Mirrors LeaveAccrualAdmin.tsx's leave-encashment "Assign to Payroll Run"
// dialog exactly — this reserves a draft run for an approved batch; it does
// NOT mark anything paid yet. Every (re)generation of that run folds each
// assigned employee's arrears into their payslip fresh, so it survives any
// number of re-runs; finalizing that run is what actually flips this batch
// (and its arrear_payouts) to 'processed'/'paid'.

function AssignRunDialog({
  open,
  batch,
  draftRuns,
  onClose,
}: {
  open: boolean
  batch: ArrearBatch | null
  draftRuns: PayrollRunOption[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [runId, setRunId] = useState('')

  useEffect(() => { if (open) setRunId('') }, [open])

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/arrears/batches/${batch!.id}/assign-run`, { payroll_run_id: runId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['arrear-batches'] })
      toast.success('Assigned to payroll run — not yet paid. Run (or re-run) payroll for this month, then finalize to mark processed.')
      onClose()
    },
    onError: (e: Error) => toast.error('Failed to assign batch to payroll run', { description: e.message }),
  })

  const eligibleRuns = draftRuns.filter(r => !batch?.payout_month || r.month === batch.payout_month)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign to Payroll Run — {batch?.batch_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Total arrear <strong className="text-foreground">{batch ? fmt(batch.total_arrear_amount) : ''}</strong> across{' '}
            {batch?.employee_count} employee(s) will be reserved for the selected draft run — this does not mark the
            batch processed yet. Run (or re-run) payroll for {batch?.payout_month} so each payslip reflects it, then
            finalize that run to mark this batch processed.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Draft payroll run ({batch?.payout_month})</Label>
            {eligibleRuns.length === 0 ? (
              <p className="text-xs text-warning">
                No draft payroll run for {batch?.payout_month} — create or reopen one for that month first.
              </p>
            ) : (
              <select
                value={runId}
                onChange={e => setRunId(e.target.value)}
                className="w-full h-9 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">Select a run…</option>
                {eligibleRuns.map(r => (
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

// ── Main Component ─────────────────────────────────────────────────────────────

export function ArrearEngine() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [showCreate, setShowCreate]   = useState(false)
  const [viewBatch, setViewBatch]     = useState<ArrearBatch | null>(null)
  const [assignBatch, setAssignBatch] = useState<ArrearBatch | null>(null)

  const { data: batches = [], isLoading, refetch } = useQuery<ArrearBatch[]>({
    queryKey: ['arrear-batches'],
    queryFn:  () => api.get<{ data: ArrearBatch[] }>('/payroll/arrears/batches').then((r) => r.data),
  })

  const { data: payrollRunsResp } = useQuery<{ data: PayrollRunOption[] }>({
    queryKey: ['payroll-runs-for-arrears'],
    queryFn:  () => api.get('/payroll/runs?limit=50'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const draftPayrollRuns = (payrollRunsResp?.data ?? []).filter(r => r.status === 'draft')

  const calculateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/arrears/batches/${id}/calculate`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['arrear-batches'] }),
    onError: (e: Error) => toast.error('Failed to calculate arrear batch', { description: e.message }),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/arrears/batches/${id}/approve`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['arrear-batches'] }),
    onError: (e: Error) => toast.error('Failed to approve arrear batch', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Arrear Engine"
        subtitle="Calculate and approve payroll arrears across periods"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" /> Create Batch
              </Button>
            )}
          </div>
        }
      />

      <SectionCard title="Arrear Batches">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : batches.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No arrear batches found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-3 px-4 font-medium">Batch Name</th>
                  <th className="text-left py-3 px-4 font-medium">Period</th>
                  <th className="text-left py-3 px-4 font-medium">Arrear Type</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-right py-3 px-4 font-medium">Employees</th>
                  <th className="text-right py-3 px-4 font-medium">Total Arrear</th>
                  <th className="text-left py-3 px-4 font-medium">Created</th>
                  {isAdmin && <th className="text-left py-3 px-4 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">{b.batch_name}</td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {b.from_period} → {b.to_period}
                    </td>
                    <td className="py-3 px-4 text-foreground">{labelify(b.arrear_type)}</td>
                    <td className="py-3 px-4">
                      <Badge variant={STATUS_BADGE[b.status] ?? 'secondary'}>
                        {labelify(b.status)}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right text-foreground">{b.employee_count}</td>
                    <td className="py-3 px-4 text-right font-medium text-foreground">
                      {fmt(b.total_arrear_amount)}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{fmtDate(b.created_at)}</td>
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {(b.status === 'draft' || b.status === 'calculated') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={calculateMutation.isPending}
                              onClick={() => calculateMutation.mutate(b.id)}
                            >
                              {calculateMutation.isPending ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Calculator className="mr-1 h-3 w-3" />
                              )}
                              Calculate
                            </Button>
                          )}
                          {b.status === 'calculated' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(b.id)}
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                            </Button>
                          )}
                          {b.status === 'approved' && !b.processed_payroll_run_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAssignBatch(b)}
                            >
                              <BadgeCheck className="mr-1 h-3 w-3" /> Assign to Payroll Run
                            </Button>
                          )}
                          {b.status === 'approved' && b.processed_payroll_run_id && (
                            <span className="text-xs text-muted-foreground">Assigned — awaiting finalize</span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setViewBatch(b)}
                          >
                            <Eye className="mr-1 h-3 w-3" /> View Records
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Dialogs */}
      <CreateBatchDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <RecordsDialog
        open={!!viewBatch}
        batch={viewBatch}
        onClose={() => setViewBatch(null)}
      />
      <AssignRunDialog
        open={!!assignBatch}
        batch={assignBatch}
        draftRuns={draftPayrollRuns}
        onClose={() => setAssignBatch(null)}
      />
    </PageContainer>
  )
}
