/**
 * ArrearEngine — /admin/payroll/arrears
 *
 * HR admin view: manage arrear batches, trigger calculations, and view records.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState }                                from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus, Calculator,
  CheckCircle2, Eye,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
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
import { toast }          from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ArrearBatch {
  id:                  string
  batch_name:          string
  from_period:         string
  to_period:           string
  trigger_type:        string
  status:              'pending' | 'calculating' | 'calculated' | 'approved' | 'paid'
  total_arrear_amount: number
  employee_count:      number
  created_at:          string
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
  pending:    'secondary',
  calculating:'outline',
  calculated: 'warning',
  approved:   'success',
  paid:       'outline',
}

const TRIGGER_TYPES = ['compensation_revision', 'structure_change', 'manual']

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

function CreateBatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    batch_name:   '',
    from_period:  '',
    to_period:    '',
    trigger_type: 'compensation_revision',
    notes:        '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/arrears/batches', form),
    onSuccess:  () => {
      toast.success('Arrear batch created')
      qc.invalidateQueries({ queryKey: ['arrear-batches'] })
      onClose()
      setForm({ batch_name: '', from_period: '', to_period: '', trigger_type: 'compensation_revision', notes: '' })
    },
    onError: (e: Error) => {
      toast.error('Failed to create arrear batch', { description: e.message })
    },
  })

  const valid = form.batch_name && form.from_period && form.to_period

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
            <label className="text-sm font-medium text-foreground">Trigger Type</label>
            <select
              value={form.trigger_type}
              onChange={e => set('trigger_type', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {TRIGGER_TYPES.map(t => (
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
      api.get(`/payroll/arrears/batches/${batch!.id}/records`).then((r: any) => r.data),
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
                          {r.employee_name ?? r.employee_id}
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

// ── Main Component ─────────────────────────────────────────────────────────────

export function ArrearEngine() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [showCreate, setShowCreate]   = useState(false)
  const [viewBatch, setViewBatch]     = useState<ArrearBatch | null>(null)

  const { data: batches = [], isLoading, refetch } = useQuery<ArrearBatch[]>({
    queryKey: ['arrear-batches'],
    queryFn:  () => api.get('/payroll/arrears/batches').then((r: any) => r.data),
  })

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
                  <th className="text-left py-3 px-4 font-medium">Trigger</th>
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
                    <td className="py-3 px-4 text-foreground">{labelify(b.trigger_type)}</td>
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
                          {(b.status === 'pending' || b.status === 'calculated') && (
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
    </PageContainer>
  )
}
