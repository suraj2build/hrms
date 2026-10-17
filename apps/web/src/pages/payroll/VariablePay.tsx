/**
 * VariablePay — /admin/payroll/variable-pay
 *
 * HR admin view: manage variable pay batches and incentive templates.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState, useEffect }                     from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus, CheckCircle2,
  Eye, BadgeCheck, Trash2,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SubTabs }        from '@/components/ui/SubTabs'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import { Label }          from '@/components/ui/label'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
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

interface IncentiveTemplate {
  id:                  string
  name:                string
  code:                string
  template_type:       string
  is_taxable:          boolean
  requires_approval:   boolean
  is_active:           boolean
}

interface VariableBatch {
  id:                      string
  batch_name:              string
  payout_month:            string
  template_id:             string
  status:                  'draft' | 'in_review' | 'approved' | 'processing' | 'processed' | 'cancelled'
  total_amount:            number
  employee_count:          number
  processed_payroll_run_id: string | null
  created_at:              string
  // Embedded by GET /batches's `select('*, incentive_templates(...)')` —
  // SYSTEM_AUDIT_2026-10-14 found this page previously read a flat
  // `template_name`/`total_payout` that the API has never actually sent
  // (real columns: the embedded `incentive_templates.name` and
  // `total_amount`), so every batch always showed "—" / "₹NaN" here.
  incentive_templates?:    { id: string; name: string; code: string; template_type: string } | null
}

interface PayrollRunOption {
  id:     string
  month:  string
  status: string
}

interface VariablePayout {
  id:                 string
  batch_id:           string
  employee_id:        string
  amount:             number
  is_taxable:         boolean
  performance_period: string | null
  performance_notes:  string | null
  status:             'pending' | 'approved' | 'processed' | 'cancelled'
  payroll_run_id:     string | null
  created_at:         string
  // Embedded by GET /batches/:id/payouts's `select('*, employees(...)')` —
  // this page previously read flat `employee_name`/`employee_code` fields
  // the API has never sent, and non-existent `base_amount`/`multiplier`/
  // `final_payout`/`approved` columns (real table: variable_payouts,
  // migration 102) — every payout row always showed "—" here, and there was
  // no form to add a payout in the first place (checkpoint 30, SYSTEM_AUDIT).
  employees?:         { id: string; first_name: string; last_name: string; employee_code: string } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const BATCH_BADGE: Record<string, 'secondary' | 'outline' | 'success' | 'warning'> = {
  draft:      'secondary',
  in_review:  'warning',
  processing: 'outline',
  processed:  'outline',
  approved:   'success',
  cancelled:  'secondary',
}

// Must match incentive_templates.template_type's CHECK constraint exactly
// (supabase/migrations/102_variable_pay.sql) — mirrors the same list the
// backend's zod schema enforces (routes/payroll/variable-pay.ts).
const TEMPLATE_TYPES = [
  'performance', 'sales', 'referral', 'spot_award', 'project',
  'quarterly', 'annual', 'festival', 'retention', 'other',
]

const fmt = (n: number) => formatCurrency(n)

const labelify = (s: string) =>
  s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

// ── Create Batch Dialog ────────────────────────────────────────────────────────

function CreateBatchDialog({
  open,
  templates,
  onClose,
}: {
  open: boolean
  templates: IncentiveTemplate[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    batch_name:   '',
    payout_month: '',
    template_id:  '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/variable-pay/batches', form),
    onSuccess:  () => {
      toast.success('Variable pay batch created')
      qc.invalidateQueries({ queryKey: ['vp-batches'] })
      onClose()
      setForm({ batch_name: '', payout_month: '', template_id: '' })
    },
    onError: (e: Error) => {
      toast.error('Failed to create batch', { description: e.message })
    },
  })

  const valid = form.batch_name && form.payout_month && form.template_id

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Variable Pay Batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Batch Name</label>
            <Input value={form.batch_name} onChange={e => set('batch_name', e.target.value)} placeholder="e.g. Q1 2025 Incentives" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Payout Month (YYYY-MM)</label>
            <Input
              type="month"
              value={form.payout_month}
              onChange={e => set('payout_month', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Template</label>
            <select
              value={form.template_id}
              onChange={e => set('template_id', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select template...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Payouts Dialog ─────────────────────────────────────────────────────────────

interface PendingPayoutRow {
  key: string
  employee_id: string
  employee_label: string
  amount: string
  performance_period: string
}

function PayoutsDialog({
  open,
  batch,
  onClose,
}: {
  open: boolean
  batch: VariableBatch | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [pendingRows, setPendingRows] = useState<PendingPayoutRow[]>([])
  const [rowEmployee, setRowEmployee] = useState<string>('')
  const [rowAmount, setRowAmount] = useState('')
  const [rowPeriod, setRowPeriod] = useState('')

  const { data: payouts = [], isLoading } = useQuery<VariablePayout[]>({
    queryKey: ['vp-payouts', batch?.id],
    queryFn:  () => api.get<{ data: VariablePayout[] }>(`/payroll/variable-pay/batches/${batch!.id}/payouts`).then(r => r.data),
    enabled:  open && !!batch,
  })

  useEffect(() => {
    if (!open) {
      setPendingRows([])
      setRowEmployee('')
      setRowAmount('')
      setRowPeriod('')
    }
  }, [open])

  const existingEmployeeIds = payouts.map(p => p.employee_id)
  const pendingEmployeeIds  = pendingRows.map(r => r.employee_id)
  // variable_payouts has UNIQUE(tenant_id, batch_id, employee_id) — an
  // employee can have at most one payout line per batch. Exclude both
  // already-saved and already-queued employees from the picker so the
  // 23505 can't be hit from this form.
  const excludeFromPicker = [...existingEmployeeIds, ...pendingEmployeeIds]
  const canAddPayouts = batch && ['draft', 'in_review'].includes(batch.status)

  async function handleAddRow() {
    if (!rowEmployee || !rowAmount || Number(rowAmount) <= 0) return
    let label = rowEmployee
    try {
      const res = await api.get<{ data: Array<{ id: string; first_name: string; last_name: string; employee_code?: string }> }>(
        `/employees/options?ids=${encodeURIComponent(rowEmployee)}`,
      )
      const emp = res.data?.[0]
      if (emp) label = `${emp.employee_code ?? ''} — ${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim()
    } catch { /* fall back to raw id if lookup fails */ }
    setPendingRows(rows => [
      ...rows,
      { key: `${rowEmployee}-${Date.now()}`, employee_id: rowEmployee, employee_label: label, amount: rowAmount, performance_period: rowPeriod },
    ])
    setRowEmployee('')
    setRowAmount('')
    setRowPeriod('')
  }

  function removeRow(key: string) {
    setPendingRows(rows => rows.filter(r => r.key !== key))
  }

  const addPayouts = useMutation({
    mutationFn: () =>
      api.post(`/payroll/variable-pay/batches/${batch!.id}/payouts`, {
        payouts: pendingRows.map(r => ({
          employee_id: r.employee_id,
          amount: Number(r.amount),
          performance_period: r.performance_period || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success(`${pendingRows.length} payout(s) added`)
      qc.invalidateQueries({ queryKey: ['vp-payouts', batch?.id] })
      qc.invalidateQueries({ queryKey: ['vp-batches'] })
      setPendingRows([])
    },
    onError: (e: Error) => {
      toast.error('Failed to add payouts', { description: e.message })
    },
  })

  const submitBatch = useMutation({
    mutationFn: () => api.post(`/payroll/variable-pay/batches/${batch!.id}/submit`),
    onSuccess:  () => {
      toast.success('Batch submitted for review')
      qc.invalidateQueries({ queryKey: ['vp-batches'] })
      onClose()
    },
    onError: (e: Error) => {
      toast.error('Failed to submit batch', { description: e.message })
    },
  })

  const approveBatch = useMutation({
    mutationFn: () => api.post(`/payroll/variable-pay/batches/${batch!.id}/approve`),
    onSuccess:  () => {
      toast.success('Batch approved')
      qc.invalidateQueries({ queryKey: ['vp-batches'] })
      onClose()
    },
    onError: (e: Error) => {
      toast.error('Failed to approve batch', { description: e.message })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Payouts — {batch?.batch_name} ({batch?.payout_month})
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : payouts.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center">No payout records found.</p>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Employee</th>
                    <th className="text-left py-3 px-4 font-medium">Period</th>
                    <th className="text-right py-3 px-4 font-medium">Amount</th>
                    <th className="text-center py-3 px-4 font-medium">Taxable</th>
                    <th className="text-center py-3 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map(p => (
                    <tr key={p.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">
                          {p.employees ? `${p.employees.first_name} ${p.employees.last_name}` : '—'}
                        </div>
                        {p.employees?.employee_code && (
                          <div className="text-xs text-muted-foreground">{p.employees.employee_code}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-foreground">{p.performance_period || '—'}</td>
                      <td className="py-3 px-4 text-right font-medium text-foreground">{fmt(p.amount)}</td>
                      <td className="py-3 px-4 text-center">
                        <input type="checkbox" checked={p.is_taxable} readOnly className="h-4 w-4" />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={p.status === 'cancelled' ? 'secondary' : 'outline'}>{labelify(p.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canAddPayouts && (
            <div className="rounded-md border border-border p-3 space-y-3">
              <p className="text-sm font-medium text-foreground">Add payout</p>
              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Employee</label>
                  <EmployeeSelector value={rowEmployee} onChange={v => setRowEmployee(v as string)} excludeIds={excludeFromPicker} placeholder="Search by name or code…" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Amount</label>
                  <Input type="number" min="0" step="0.01" value={rowAmount} onChange={e => setRowAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Period (optional)</label>
                  <Input value={rowPeriod} onChange={e => setRowPeriod(e.target.value)} placeholder="e.g. Q1 2026" />
                </div>
                <Button variant="outline" onClick={handleAddRow} disabled={!rowEmployee || !rowAmount || Number(rowAmount) <= 0}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {pendingRows.length > 0 && (
                <div className="space-y-2">
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {pendingRows.map(r => (
                      <li key={r.key} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-foreground">{r.employee_label}{r.performance_period ? ` · ${r.performance_period}` : ''}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-foreground">{fmt(Number(r.amount))}</span>
                          <button type="button" onClick={() => removeRow(r.key)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-end">
                    <Button onClick={() => addPayouts.mutate()} disabled={addPayouts.isPending}>
                      {addPayouts.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save {pendingRows.length} Payout{pendingRows.length > 1 ? 's' : ''}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {batch && batch.status === 'draft' && (
            <div className="flex justify-end pt-2">
              <Button onClick={() => submitBatch.mutate()} disabled={submitBatch.isPending || batch.employee_count === 0} title={batch.employee_count === 0 ? 'Add at least one payout before submitting' : undefined}>
                {submitBatch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit for Review
              </Button>
            </div>
          )}
          {batch && batch.status === 'in_review' && (
            <div className="flex justify-end pt-2">
              <Button onClick={() => approveBatch.mutate()} disabled={approveBatch.isPending}>
                {approveBatch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve Batch
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Assign to Payroll Run Dialog ───────────────────────────────────────────────
// Mirrors ArrearEngine.tsx / LeaveAccrualAdmin.tsx's "Assign to Payroll Run"
// dialog exactly — reserves a draft run for an approved batch without marking
// it processed yet. Every (re)generation of that run folds each assigned
// employee's variable pay into their payslip fresh; finalizing that run is
// what actually flips this batch to 'processed'.

function AssignRunDialog({
  open,
  batch,
  draftRuns,
  onClose,
}: {
  open: boolean
  batch: VariableBatch | null
  draftRuns: PayrollRunOption[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [runId, setRunId] = useState('')

  useEffect(() => { if (open) setRunId('') }, [open])

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/variable-pay/batches/${batch!.id}/assign-run`, { payroll_run_id: runId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vp-batches'] })
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
            Total payout <strong className="text-foreground">{batch ? fmt(batch.total_amount) : ''}</strong> across{' '}
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

// ── Add Template Dialog ────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE_FORM = {
  name:               '',
  code:               '',
  template_type:      'other',
  is_taxable:         true,
  requires_approval:  true,
}

function AddTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(DEFAULT_TEMPLATE_FORM)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const setBool = (k: 'is_taxable' | 'requires_approval', v: boolean) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/variable-pay/templates', form),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['vp-templates'] })
      onClose()
      setForm(DEFAULT_TEMPLATE_FORM)
    },
    onError: (e: Error) => {
      toast.error('Failed to create template', { description: e.message })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Incentive Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Sales Incentive" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Code</label>
            <Input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. SALES_INC" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Template Type</label>
            <select
              value={form.template_type}
              onChange={e => set('template_type', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{labelify(t)}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="tpl-taxable"
              type="checkbox"
              checked={form.is_taxable}
              onChange={e => setBool('is_taxable', e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <label htmlFor="tpl-taxable" className="text-sm font-medium text-foreground">Taxable</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="tpl-approval"
              type="checkbox"
              checked={form.requires_approval}
              onChange={e => setBool('requires_approval', e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <label htmlFor="tpl-approval" className="text-sm font-medium text-foreground">Requires Approval</label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!form.name || !form.code || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function VariablePay() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [activeTab, setActiveTab]       = useState<'batches' | 'templates'>('batches')
  const [showCreate, setShowCreate]     = useState(false)
  const [showAddTpl, setShowAddTpl]     = useState(false)
  const [viewBatch, setViewBatch]       = useState<VariableBatch | null>(null)
  const [assignBatch, setAssignBatch]   = useState<VariableBatch | null>(null)

  const { data: batches = [], isLoading: batchesLoading, refetch } = useQuery<VariableBatch[]>({
    queryKey: ['vp-batches'],
    queryFn:  () => api.get<{ data: VariableBatch[] }>('/payroll/variable-pay/batches').then(r => r.data),
  })

  const { data: payrollRunsResp } = useQuery<{ data: PayrollRunOption[] }>({
    queryKey: ['payroll-runs-for-variable-pay'],
    queryFn:  () => api.get('/payroll/runs?limit=50'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const draftPayrollRuns = (payrollRunsResp?.data ?? []).filter(r => r.status === 'draft')

  const { data: templates = [], isLoading: tplLoading } = useQuery<IncentiveTemplate[]>({
    queryKey: ['vp-templates'],
    queryFn:  () => api.get<{ data: IncentiveTemplate[] }>('/payroll/variable-pay/templates').then(r => r.data),
  })

  const tabs = [
    { key: 'batches',   label: 'Batches' },
    { key: 'templates', label: 'Templates' },
  ] as const

  return (
    <PageContainer>
      <PageHeader
        title="Variable Pay"
        subtitle="Manage incentive batches and payout templates"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            {isAdmin && activeTab === 'batches' && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" /> Create Batch
              </Button>
            )}
            {isAdmin && activeTab === 'templates' && (
              <Button size="sm" onClick={() => setShowAddTpl(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add Template
              </Button>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <SubTabs<typeof activeTab>
        tabs={tabs.map(t => ({ id: t.key, label: t.label }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-6"
      />

      {/* ── Batches Tab ── */}
      {activeTab === 'batches' && (
        <SectionCard title="Variable Pay Batches">
          {batchesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : batches.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No batches found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Batch Name</th>
                    <th className="text-left py-3 px-4 font-medium">Month</th>
                    <th className="text-left py-3 px-4 font-medium">Template</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-right py-3 px-4 font-medium">Employees</th>
                    <th className="text-right py-3 px-4 font-medium">Total Payout</th>
                    <th className="text-left py-3 px-4 font-medium">Created</th>
                    {isAdmin && <th className="text-left py-3 px-4 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4 font-medium text-foreground">{b.batch_name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{b.payout_month}</td>
                      <td className="py-3 px-4 text-foreground">{b.incentive_templates?.name ?? '—'}</td>
                      <td className="py-3 px-4">
                        <Badge variant={BATCH_BADGE[b.status] ?? 'secondary'}>
                          {labelify(b.status)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">{b.employee_count}</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(b.total_amount)}</td>
                      <td className="py-3 px-4 text-muted-foreground">{fmtDate(b.created_at)}</td>
                      {isAdmin && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setViewBatch(b)}
                            >
                              <Eye className="mr-1 h-3 w-3" /> View Payouts
                            </Button>
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
      )}

      {/* ── Templates Tab ── */}
      {activeTab === 'templates' && (
        <SectionCard title="Incentive Templates">
          {tplLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No templates found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Name</th>
                    <th className="text-left py-3 px-4 font-medium">Code</th>
                    <th className="text-left py-3 px-4 font-medium">Type</th>
                    <th className="text-left py-3 px-4 font-medium">Taxable</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4 font-medium text-foreground">{t.name}</td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{t.code}</td>
                      <td className="py-3 px-4 text-foreground">{labelify(t.template_type)}</td>
                      <td className="py-3 px-4 text-foreground">{t.is_taxable ? 'Yes' : 'No'}</td>
                      <td className="py-3 px-4">
                        <Badge variant={t.is_active ? 'success' : 'secondary'}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Dialogs */}
      <CreateBatchDialog
        open={showCreate}
        templates={templates}
        onClose={() => setShowCreate(false)}
      />
      <PayoutsDialog
        open={!!viewBatch}
        batch={viewBatch}
        onClose={() => setViewBatch(null)}
      />
      <AddTemplateDialog open={showAddTpl} onClose={() => setShowAddTpl(false)} />
      <AssignRunDialog
        open={!!assignBatch}
        batch={assignBatch}
        draftRuns={draftPayrollRuns}
        onClose={() => setAssignBatch(null)}
      />
    </PageContainer>
  )
}
