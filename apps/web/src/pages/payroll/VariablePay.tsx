/**
 * VariablePay — /admin/payroll/variable-pay
 *
 * HR admin view: manage variable pay batches and incentive templates.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState }                                from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus, CheckCircle2,
  Eye,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SubTabs }        from '@/components/ui/SubTabs'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import { toast }          from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface IncentiveTemplate {
  id:                  string
  name:                string
  code:                string
  calculation_basis:   string
  payout_frequency:    string
  is_active:           boolean
}

interface VariableBatch {
  id:             string
  batch_name:     string
  payout_month:   string
  template_id:    string
  status:         'draft' | 'processing' | 'approved' | 'paid'
  total_payout:   number
  employee_count: number
  created_at:     string
  template_name?: string
}

interface VariablePayout {
  id:               string
  batch_id:         string
  employee_id:      string
  base_amount:      number
  performance_score: number | null
  multiplier:       number
  final_payout:     number
  approved:         boolean
  employee_name?:   string
  employee_code?:   string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const BATCH_BADGE: Record<string, 'secondary' | 'outline' | 'success' | 'warning'> = {
  draft:      'secondary',
  processing: 'outline',
  approved:   'success',
  paid:       'outline',
}

const CALC_BASIS   = ['fixed', 'performance_linked', 'revenue_pct', 'attendance_linked']
const PAY_FREQ     = ['monthly', 'quarterly', 'annually', 'on_target']

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string) => {
  const s = d
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

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

  const { data: payouts = [], isLoading } = useQuery<VariablePayout[]>({
    queryKey: ['vp-payouts', batch?.id],
    queryFn:  () => api.get(`/payroll/variable-pay/batches/${batch!.id}/payouts`).then((r: any) => r.data),
    enabled:  open && !!batch,
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
                    <th className="text-right py-3 px-4 font-medium">Base Amount</th>
                    <th className="text-right py-3 px-4 font-medium">Score</th>
                    <th className="text-right py-3 px-4 font-medium">Multiplier</th>
                    <th className="text-right py-3 px-4 font-medium">Final Payout</th>
                    <th className="text-center py-3 px-4 font-medium">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map(p => (
                    <tr key={p.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">{p.employee_name ?? p.employee_id}</div>
                        {p.employee_code && (
                          <div className="text-xs text-muted-foreground">{p.employee_code}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(p.base_amount)}</td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {p.performance_score != null ? p.performance_score : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">{p.multiplier}×</td>
                      <td className="py-3 px-4 text-right font-medium text-foreground">{fmt(p.final_payout)}</td>
                      <td className="py-3 px-4 text-center">
                        <input type="checkbox" checked={p.approved} readOnly className="h-4 w-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {batch && batch.status !== 'approved' && batch.status !== 'paid' && (
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

// ── Add Template Dialog ────────────────────────────────────────────────────────

function AddTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name:               '',
    code:               '',
    calculation_basis:  'fixed',
    payout_frequency:   'monthly',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/variable-pay/templates', form),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['vp-templates'] })
      onClose()
      setForm({ name: '', code: '', calculation_basis: 'fixed', payout_frequency: 'monthly' })
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
            <label className="text-sm font-medium text-foreground">Calculation Basis</label>
            <select
              value={form.calculation_basis}
              onChange={e => set('calculation_basis', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {CALC_BASIS.map(b => <option key={b} value={b}>{labelify(b)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Payout Frequency</label>
            <select
              value={form.payout_frequency}
              onChange={e => set('payout_frequency', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {PAY_FREQ.map(f => <option key={f} value={f}>{labelify(f)}</option>)}
            </select>
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

  const { data: batches = [], isLoading: batchesLoading, refetch } = useQuery<VariableBatch[]>({
    queryKey: ['vp-batches'],
    queryFn:  () => api.get('/payroll/variable-pay/batches').then((r: any) => r.data),
  })

  const { data: templates = [], isLoading: tplLoading } = useQuery<IncentiveTemplate[]>({
    queryKey: ['vp-templates'],
    queryFn:  () => api.get('/payroll/variable-pay/templates').then((r: any) => r.data),
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
                      <td className="py-3 px-4 text-foreground">{b.template_name ?? b.template_id}</td>
                      <td className="py-3 px-4">
                        <Badge variant={BATCH_BADGE[b.status] ?? 'secondary'}>
                          {labelify(b.status)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">{b.employee_count}</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(b.total_payout)}</td>
                      <td className="py-3 px-4 text-muted-foreground">{fmtDate(b.created_at)}</td>
                      {isAdmin && (
                        <td className="py-3 px-4">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setViewBatch(b)}
                          >
                            <Eye className="mr-1 h-3 w-3" /> View Payouts
                          </Button>
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
                    <th className="text-left py-3 px-4 font-medium">Basis</th>
                    <th className="text-left py-3 px-4 font-medium">Frequency</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4 font-medium text-foreground">{t.name}</td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{t.code}</td>
                      <td className="py-3 px-4 text-foreground">{labelify(t.calculation_basis)}</td>
                      <td className="py-3 px-4 text-foreground">{labelify(t.payout_frequency)}</td>
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
    </PageContainer>
  )
}
