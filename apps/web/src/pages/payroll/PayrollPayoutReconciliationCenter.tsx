/**
 * PayrollPayoutReconciliationCenter — /admin/payroll/payout-reconciliation
 *
 * Bank payout reconciliation workspace:
 *   - Per-employee obligation status (pending / processing / paid / failed / held)
 *   - UTR entry and bank reference tracking
 *   - Failed transfer management and retry
 *   - Reversal workflow
 *   - KPI strip: paid, pending, failed, held, completion %
 *   - Batch status update (mark-all-paid after bank confirmation)
 *   - Held salary handling
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }    from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DollarSign, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Loader2, Search, Clock,
  RotateCcw, Lock, Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmployeeLabel } from '@/components/employee/EmployeeLabel'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { cn, formatCurrency as fmtCurrency } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayoutRecord {
  id:                  string
  run_id:              string
  slip_id:             string | null
  employee_id:         string
  expected_amount:     number
  paid_amount:         number
  variance_amount:     number
  payment_status:      string
  utr_number:          string | null
  bank_reference:      string | null
  bank_account_masked: string | null
  ifsc_code:           string | null
  initiated_at:        string | null
  completed_at:        string | null
  failure_reason:      string | null
  retry_count:         number
}

interface PayrollRun {
  id:     string
  month:  string
  status: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:    { label: 'Pending',    color: 'text-muted-foreground border-border', icon: <Clock className="h-3 w-3" /> },
  processing: { label: 'Processing', color: 'text-info border-info/40',            icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  paid:       { label: 'Paid',       color: 'text-success border-success/40',      icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:     { label: 'Failed',     color: 'text-destructive border-destructive/40', icon: <XCircle className="h-3 w-3" /> },
  reversed:   { label: 'Reversed',   color: 'text-warning border-warning/40',      icon: <RotateCcw className="h-3 w-3" /> },
  held:       { label: 'Held',       color: 'text-warning border-warning/40',      icon: <Lock className="h-3 w-3" /> },
  partial:    { label: 'Partial',    color: 'text-info border-info/40',            icon: <AlertTriangle className="h-3 w-3" /> },
}

const STATUS_FILTERS = ['all', 'pending', 'processing', 'paid', 'failed', 'held', 'reversed']

// ── Payout Row ─────────────────────────────────────────────────────────────────

function PayoutRow({
  rec,
  onUpdate,
  isUpdating,
}: {
  rec:       PayoutRecord
  onUpdate:  (id: string, data: Record<string, unknown>) => void
  isUpdating: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [utr, setUtr]         = useState(rec.utr_number ?? '')
  const [ref, setRef]         = useState(rec.bank_reference ?? '')
  const [failReason, setFailReason] = useState(rec.failure_reason ?? '')
  const cfg = STATUS_CONFIG[rec.payment_status] ?? STATUS_CONFIG.pending

  return (
    <div className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status badge */}
        <Badge variant="outline" className={cn('text-[9px] rounded-full gap-1 flex-shrink-0', cfg.color)}>
          {cfg.icon}{cfg.label}
        </Badge>

        {/* Employee & bank info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <EmployeeLabel id={rec.employee_id} className="text-xs text-muted-foreground" />
            {rec.bank_account_masked && (
              <span className="text-[10px] text-muted-foreground">Acct: ****{rec.bank_account_masked.slice(-4)}</span>
            )}
            {rec.ifsc_code && (
              <span className="text-[10px] font-mono text-muted-foreground">{rec.ifsc_code}</span>
            )}
            {rec.utr_number && (
              <span className="text-[10px] font-mono text-info">UTR: {rec.utr_number}</span>
            )}
          </div>
          {rec.failure_reason && (
            <p className="text-[10px] text-destructive mt-0.5">{rec.failure_reason}</p>
          )}
          {rec.retry_count > 0 && (
            <p className="text-[10px] text-muted-foreground">Retried {rec.retry_count}×</p>
          )}
        </div>

        {/* Amounts */}
        <div className="text-right flex-shrink-0 space-y-0.5">
          <p className="text-xs font-semibold tabular-nums">{fmtCurrency(rec.expected_amount)}</p>
          {rec.paid_amount > 0 && Math.abs(rec.variance_amount) >= 0.01 && (
            <p className={cn('text-[9px] tabular-nums', rec.variance_amount < 0 ? 'text-destructive' : 'text-warning')}>
              Paid: {fmtCurrency(rec.paid_amount)}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          {rec.payment_status !== 'paid' && rec.payment_status !== 'reversed' && (
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={() => setEditing(v => !v)}
            >
              {editing ? 'Cancel' : 'Update'}
            </button>
          )}
          {rec.payment_status === 'pending' && (
            <button
              className="text-[10px] text-success hover:underline"
              onClick={() => {
                if (confirm(`Mark this payout of ${fmtCurrency(rec.expected_amount)} as paid without a UTR/bank reference?`)) {
                  onUpdate(rec.id, { payment_status: 'paid', paid_amount: rec.expected_amount })
                }
              }}
              disabled={isUpdating}
            >
              Mark Paid
            </button>
          )}
          {rec.payment_status === 'failed' && (
            <button
              className="text-[10px] text-info hover:underline"
              onClick={() => onUpdate(rec.id, { payment_status: 'pending' })}
              disabled={isUpdating}
            >
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="px-4 pb-3 space-y-2 bg-muted/10 border-t border-border/40">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">UTR Number</p>
              <Input className="h-7 text-xs" placeholder="UTR/NEFT ref" value={utr} onChange={e => setUtr(e.target.value)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Bank Reference</p>
              <Input className="h-7 text-xs" placeholder="Bank ref number" value={ref} onChange={e => setRef(e.target.value)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Failure Reason (if any)</p>
              <Input className="h-7 text-xs" placeholder="Account frozen, etc." value={failReason} onChange={e => setFailReason(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" disabled={isUpdating}
              onClick={() => { onUpdate(rec.id, { payment_status: 'paid', paid_amount: rec.expected_amount, utr_number: utr || undefined, bank_reference: ref || undefined }); setEditing(false) }}>
              Mark Paid
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={isUpdating}
              onClick={() => { onUpdate(rec.id, { payment_status: 'failed', failure_reason: failReason || undefined }); setEditing(false) }}>
              Mark Failed
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-warning border-warning/40" disabled={isUpdating}
              onClick={() => { onUpdate(rec.id, { payment_status: 'held' }); setEditing(false) }}>
              Hold
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={isUpdating || (!utr && !ref)}
              onClick={() => { onUpdate(rec.id, { utr_number: utr || undefined, bank_reference: ref || undefined }); setEditing(false) }}>
              Save UTR Only
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollPayoutReconciliationCenter() {
  const [selectedRunId, setSelectedRunId]   = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter]     = useState('all')
  const [search, setSearch]                 = useState('')
  const queryClient = useQueryClient()

  // ── Runs ───────────────────────────────────────────────────────────────────
  const { data: runsRaw } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-payout-recon'],
    queryFn:  () => api.get('/payroll/runs?limit=12'),
    staleTime: 60_000,
  })
  const runs      = runsRaw?.data ?? []
  const finalRuns = runs.filter(r => r.status === 'finalized')

  // ── Payout records ─────────────────────────────────────────────────────────
  const { data: payoutsRaw, isLoading, refetch } = useQuery<{ data: PayoutRecord[]; total: number }>({
    queryKey: ['payout-reconciliation', selectedRunId, statusFilter],
    queryFn:  () => {
      const params = new URLSearchParams({ limit: '500' })
      if (selectedRunId)       params.set('run_id', selectedRunId)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      return api.get(`/payroll/payout-reconciliation?${params}`)
    },
    staleTime: 30_000,
  })
  const allRecords = useMemo(() => payoutsRaw?.data ?? [], [payoutsRaw])
  const total      = payoutsRaw?.total ?? 0

  // ── Mutation ───────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/payroll/payout-reconciliation/${id}/update`, data),
    onSuccess: () => {
      toast.success('Payout status updated')
      queryClient.invalidateQueries({ queryKey: ['payout-reconciliation'] })
    },
    onError: () => toast.error('Update failed'),
  })

  const generateObligationsMutation = useMutation({
    mutationFn: (runId: string) => api.post<{ count?: number }>(`/payroll/runs/${runId}/payout-obligations`, {}),
    onSuccess: (res) => {
      toast.success(`${res.count} payout obligations created`)
      queryClient.invalidateQueries({ queryKey: ['payout-reconciliation'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Failed to create obligations')
    },
  })

  // ── Filtered ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return allRecords
    const q = search.toLowerCase()
    return allRecords.filter(r =>
      (r.utr_number ?? '').toLowerCase().includes(q) ||
      (r.bank_reference ?? '').toLowerCase().includes(q) ||
      (r.bank_account_masked ?? '').includes(q) ||
      (r.employee_id ?? '').includes(q),
    )
  }, [allRecords, search])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const paidRecs     = allRecords.filter(r => r.payment_status === 'paid')
  const pendingRecs  = allRecords.filter(r => r.payment_status === 'pending' || r.payment_status === 'processing')
  const failedRecs   = allRecords.filter(r => r.payment_status === 'failed')
  const heldRecs     = allRecords.filter(r => r.payment_status === 'held')
  const totalExpected = allRecords.reduce((s, r) => s + r.expected_amount, 0)
  const totalPaid     = paidRecs.reduce((s, r) => s + r.paid_amount, 0)
  const completionPct = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0

  return (
    <PageContainer>
      <PageHeader
        title="Payout Reconciliation"
        subtitle="Bank disbursement tracking · UTR entry · Failed transfer management · Reversal workflows"
        actions={
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isLoading && 'animate-spin')} />Refresh
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { label: 'Total Expected',   value: fmtCurrency(totalExpected), color: '' },
          { label: 'Paid',             value: `${paidRecs.length} (${fmtCurrency(totalPaid)})`, color: 'text-success' },
          { label: 'Pending',          value: pendingRecs.length, color: pendingRecs.length > 0 ? 'text-warning' : '' },
          { label: 'Failed',           value: failedRecs.length, color: failedRecs.length > 0 ? 'text-destructive' : '' },
          { label: 'Completion',       value: `${completionPct}%`, color: completionPct === 100 ? 'text-success' : 'text-info' },
        ].map(k => (
          <div key={k.label} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-card">
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
            <p className={cn('text-lg font-bold tabular-nums', k.color, isLoading && 'animate-pulse text-muted-foreground/30')}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Failure / held alerts */}
      {failedRecs.length > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5">
          <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">{failedRecs.length} failed transfer{failedRecs.length > 1 ? 's' : ''}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total: {fmtCurrency(failedRecs.reduce((s, r) => s + r.expected_amount, 0))}. Investigate and retry or reverse each.</p>
          </div>
        </div>
      )}
      {heldRecs.length > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5">
          <Lock className="h-5 w-5 text-warning flex-shrink-0" />
          <p className="text-sm"><span className="font-semibold">{heldRecs.length} held salary</span> {heldRecs.length > 1 ? 'records' : 'record'}. Release or reverse individually after investigation.</p>
        </div>
      )}

      {/* Run selector + generate */}
      <SectionCard title="Run Filter" icon={<Filter className="h-4 w-4" />} description="Filter by payroll run, or view all">
        <div className="p-4 flex flex-wrap gap-2 items-center">
          <button onClick={() => setSelectedRunId(undefined)}
            className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', !selectedRunId ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
            All Runs
          </button>
          {finalRuns.map(r => (
            <button key={r.id} onClick={() => setSelectedRunId(r.id)}
              className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
              {fmtMonth(r.month)}
            </button>
          ))}
          {selectedRunId && (
            <Button size="sm" variant="outline" onClick={() => generateObligationsMutation.mutate(selectedRunId)} disabled={generateObligationsMutation.isPending}>
              {generateObligationsMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1.5" />}
              Generate Obligations
            </Button>
          )}
        </div>
      </SectionCard>

      {/* Filters */}
      <div className="mt-4 mb-3 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors capitalize', statusFilter === s ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
              {s === 'all' ? 'All' : s}
              {s !== 'all' && (() => {
                const c = allRecords.filter(r => r.payment_status === s).length
                return c > 0 ? <span className="ml-1 opacity-70">({c})</span> : null
              })()}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-8 h-8 text-xs w-52" placeholder="Search UTR, employee, account…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Records */}
      <SectionCard
        title={`Payout Records (${filtered.length}${filtered.length !== total ? ` / ${total}` : ''})`}
        icon={<DollarSign className="h-4 w-4" />}
        description="Per-employee disbursement tracking with inline UTR entry and status management"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <DollarSign className="h-8 w-8 opacity-30" />
            <p className="text-sm">
              {allRecords.length === 0
                ? 'No payout obligations. Select a finalized run and click "Generate Obligations".'
                : 'No records match this filter'
              }
            </p>
          </div>
        ) : (
          <div>
            {filtered.map(rec => (
              <PayoutRow
                key={rec.id}
                rec={rec}
                onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                isUpdating={updateMutation.isPending}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Reconciliation summary */}
      {allRecords.length > 0 && (
        <div className="mt-4 p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold mb-3">Reconciliation Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              { label: 'Total Expected',   value: fmtCurrency(totalExpected) },
              { label: 'Total Paid',       value: fmtCurrency(totalPaid), color: 'text-success' },
              { label: 'Outstanding',      value: fmtCurrency(totalExpected - totalPaid), color: totalExpected > totalPaid ? 'text-warning' : 'text-success' },
              { label: 'Completion',       value: `${completionPct}%`, color: completionPct === 100 ? 'text-success' : 'text-info' },
            ].map(k => (
              <div key={k.label}>
                <p className="text-muted-foreground text-[10px]">{k.label}</p>
                <p className={cn('font-semibold tabular-nums mt-0.5', k.color ?? '')}>{k.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
