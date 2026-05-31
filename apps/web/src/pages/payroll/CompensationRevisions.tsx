/**
 * CompensationRevisions — /compensation/revisions
 *
 * HR admin view: submit, review, approve/reject compensation revision requests.
 * Employees see only their own history (read-only).
 *
 * Access: all roles (admin sees all; employee sees own).
 */

import { useState }                                    from 'react'
import { useQuery, useMutation, useQueryClient }        from '@tanstack/react-query'
import {
  TrendingUp, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp, Plus, Send,
  AlertTriangle, RefreshCw, Loader2,
  DollarSign, ArrowRight, FileText,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { Button }           from '@/components/ui/button'
import { Badge }            from '@/components/ui/badge'
import { Input }            from '@/components/ui/input'
import { DateInput }        from '@/components/ui/date-input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast }            from 'sonner'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import {
  IntelligenceLoadingSkeleton,
  IntelligenceEmptyState,
} from '@/components/ui/intelligence/index.js'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CompRevision {
  id:                   string
  employee_id:          string
  revision_type:        'increment' | 'promotion' | 'revision' | 'correction' | 'restructure' | 'retro'
  status:               'pending' | 'approved' | 'rejected' | 'withdrawn'
  effective_date:       string
  before_ctc_annual:    number | null
  before_ctc_monthly:   number | null
  before_structure_name: string | null
  new_ctc_annual:       number
  delta_amount:         number | null
  delta_pct:            number | null
  notes:                string | null
  rejection_reason:     string | null
  retro_months:         number | null
  payroll_impact_preview: Record<string, unknown> | null
  requested_by_name:    string | null
  approved_by_name:     string | null
  created_at:           string
  approved_at:          string | null
  employees?: {
    first_name: string
    last_name:  string
    employee_code: string
  }
}

interface PreviewData {
  monthly_delta:   number
  affected_months: string[]
  retro_total:     number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'destructive',
  withdrawn: 'secondary',
}

const TYPE_LABEL: Record<string, string> = {
  increment:   'Increment',
  promotion:   'Promotion',
  revision:    'Revision',
  correction:  'Correction',
  restructure: 'Restructure',
  retro:       'Retro',
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function fmtDate(s: string) {
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

// ── Submit form component ──────────────────────────────────────────────────────

interface SubmitFormProps {
  onSuccess: () => void
  onCancel:  () => void
}

function SubmitRevisionForm({ onSuccess, onCancel }: SubmitFormProps) {
  const [form, setForm] = useState({
    employee_id:    '',
    revision_type:  'increment' as string,
    effective_date: '',
    new_ctc_annual: '',
    notes:          '',
    retro_months:   '',
  })
  const [error, setError] = useState('')

  const submitMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/compensation/revisions', body),
    onSuccess: () => { setError(''); toast.success('Revision submitted'); onSuccess() },
    onError:   (e: Error) => { setError(e.message ?? 'Submission failed'); toast.error('Error', { description: e.message }) },
  })

  function handleSubmit() {
    if (!form.employee_id || !form.effective_date || !form.new_ctc_annual) {
      setError('Employee ID, effective date and new CTC are required.')
      return
    }
    submitMut.mutate({
      employee_id:    form.employee_id,
      revision_type:  form.revision_type,
      effective_date: form.effective_date,
      new_ctc_annual: parseFloat(form.new_ctc_annual),
      notes:          form.notes || undefined,
      retro_months:   form.retro_months ? parseInt(form.retro_months) : undefined,
    })
  }

  const inputCls = 'h-8 text-xs'
  const labelCls = 'text-xs font-medium text-muted-foreground mb-1 block'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Employee UUID *</label>
          <Input className={inputCls} placeholder="Employee ID"
            value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>Revision Type *</label>
          <select
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50"
            value={form.revision_type}
            onChange={e => setForm(p => ({ ...p, revision_type: e.target.value }))}
          >
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>New CTC Annual (₹) *</label>
          <Input className={inputCls} type="number" placeholder="e.g. 1200000"
            value={form.new_ctc_annual}
            onChange={e => setForm(p => ({ ...p, new_ctc_annual: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>Effective Date *</label>
          <DateInput className={inputCls}
            value={form.effective_date}
            onChange={v => setForm(p => ({ ...p, effective_date: v }))} />
        </div>
        <div>
          <label className={labelCls}>Retro Months</label>
          <Input className={inputCls} type="number" min={0} max={24} placeholder="0"
            value={form.retro_months}
            onChange={e => setForm(p => ({ ...p, retro_months: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <Input className={inputCls} placeholder="Optional note"
            value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />{error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSubmit}
          disabled={submitMut.isPending}>
          {submitMut.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Submitting…</>
            : <><Send className="h-3.5 w-3.5" />Submit Revision</>}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Row detail expanded view ───────────────────────────────────────────────────

function RevisionRow({
  rev,
  isAdmin,
  onApprove,
  onReject,
  onWithdraw,
}: {
  rev:        CompRevision
  isAdmin:    boolean
  onApprove:  (id: string) => void
  onReject:   (id: string) => void
  onWithdraw: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const empName = rev.employees
    ? `${rev.employees.first_name} ${rev.employees.last_name} (${rev.employees.employee_code})`
    : rev.employee_id.slice(0, 8) + '…'

  const preview = rev.payroll_impact_preview as PreviewData | null

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Row header */}
      <button
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors',
          expanded && 'bg-muted/30',
        )}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{empName}</span>
            <Badge className="rounded-full text-[10px]">{TYPE_LABEL[rev.revision_type]}</Badge>
            <Badge variant={STATUS_BADGE[rev.status]} className="rounded-full text-[10px]">
              {rev.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
            <span>Effective: {fmtDate(rev.effective_date)}</span>
            <span className="flex items-center gap-1">
              {fmt(rev.before_ctc_annual)} <ArrowRight className="h-3 w-3" /> {fmt(rev.new_ctc_annual)}
            </span>
            {rev.delta_pct != null && (
              <span className={cn('font-medium', rev.delta_pct >= 0 ? 'text-success' : 'text-destructive')}>
                {rev.delta_pct > 0 ? '+' : ''}{rev.delta_pct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
          {fmtDate(rev.created_at)}
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/60 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
            {[
              { label: 'Before CTC',   value: fmt(rev.before_ctc_annual) },
              { label: 'New CTC',      value: fmt(rev.new_ctc_annual) },
              { label: 'Delta Amount', value: fmt(rev.delta_amount) },
              { label: 'Retro Months', value: rev.retro_months != null ? `${rev.retro_months} mo` : '—' },
              { label: 'Requested By', value: rev.requested_by_name ?? '—' },
              { label: 'Approved By',  value: rev.approved_by_name ?? '—' },
              { label: 'Approved At',  value: rev.approved_at ? fmtDate(rev.approved_at) : '—' },
              { label: 'Before Structure', value: rev.before_structure_name ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/40 rounded-md p-2">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-xs font-medium mt-0.5 text-foreground">{value}</p>
              </div>
            ))}
          </div>

          {preview && (
            <div className="rounded-md bg-info/10 border border-info/20 px-3 py-2">
              <p className="text-xs font-semibold text-info mb-1.5">Payroll Impact Preview</p>
              <div className="flex gap-6 text-xs text-foreground">
                <span>Monthly delta: <strong className="text-success">{fmt(preview.monthly_delta)}</strong></span>
                {preview.retro_total > 0 && (
                  <span>Retro total: <strong className="text-warning">{fmt(preview.retro_total)}</strong></span>
                )}
                {preview.affected_months?.length > 0 && (
                  <span>Periods: <strong>{preview.affected_months.length}</strong></span>
                )}
              </div>
            </div>
          )}

          {rev.notes && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              <span className="font-medium text-foreground">Notes: </span>{rev.notes}
            </div>
          )}

          {rev.rejection_reason && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2 border border-destructive/20">
              <span className="font-medium">Rejection reason: </span>{rev.rejection_reason}
            </div>
          )}

          {/* Actions */}
          {rev.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              {isAdmin && (
                <>
                  <Button size="sm" variant="success" className="h-7 text-xs gap-1.5"
                    onClick={() => onApprove(rev.id)}>
                    <CheckCircle2 className="h-3.5 w-3.5" />Approve
                  </Button>
                  <Button size="sm" variant="destructive" className="h-7 text-xs gap-1.5"
                    onClick={() => onReject(rev.id)}>
                    <XCircle className="h-3.5 w-3.5" />Reject
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => onWithdraw(rev.id)}>
                Withdraw
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CompensationRevisions() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()

  const [showForm,    setShowForm]    = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [rejectId,    setRejectId]    = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data, isLoading, isError, refetch } = useQuery<{ data: CompRevision[] }>({
    queryKey: ['comp-revisions', statusFilter],
    queryFn:  () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : ''
      return api.get(`/compensation/revisions${params}`)
    },
    staleTime: 30_000,
  })

  const revisions = data?.data ?? []

  // ── Mutations ────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['comp-revisions'] })

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/compensation/revisions/${id}/approve`, {}),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error('Failed to approve revision', { description: e.message }),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/compensation/revisions/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => { setRejectId(null); setRejectReason(''); invalidate() },
    onError: (e: Error) => toast.error('Failed to reject revision', { description: e.message }),
  })

  const withdrawMut = useMutation({
    mutationFn: (id: string) => api.post(`/compensation/revisions/${id}/withdraw`, {}),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error('Failed to withdraw revision', { description: e.message }),
  })

  // ── Summary stats ─────────────────────────────────────────────────────────

  const pendingCount  = revisions.filter(r => r.status === 'pending').length
  const approvedCount = revisions.filter(r => r.status === 'approved').length
  const totalDelta    = revisions
    .filter(r => r.status === 'approved' && r.delta_amount)
    .reduce((s, r) => s + (r.delta_amount ?? 0), 0)

  const statCards = [
    { label: 'Pending Review',  value: pendingCount,  icon: Clock,       cls: 'text-warning' },
    { label: 'Approved',        value: approvedCount, icon: CheckCircle2, cls: 'text-success' },
    { label: 'Total Pay Impact', value: fmt(totalDelta / 12) + '/mo',
      icon: DollarSign, cls: 'text-info' },
    { label: 'Total Revisions', value: revisions.length, icon: FileText, cls: 'text-foreground' },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Compensation Revisions"
        subtitle="Submit, review, and approve employee compensation changes"
        actions={
          isAdmin ? (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowForm(v => !v)}>
              {showForm
                ? <><ChevronUp className="h-3.5 w-3.5" />Hide Form</>
                : <><Plus className="h-3.5 w-3.5" />New Revision</>}
            </Button>
          ) : undefined
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, cls }) => (
          <div key={label}
            className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted/50 flex-shrink-0">
              <Icon className={cn('h-4 w-4', cls)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('font-display text-lg font-bold', cls)}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Submit form */}
      {showForm && isAdmin && (
        <SectionCard
          title="Submit Revision Request"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        >
          <SubmitRevisionForm
            onSuccess={() => { setShowForm(false); invalidate() }}
            onCancel={() => setShowForm(false)}
          />
        </SectionCard>
      )}

      {/* Filters + list */}
      <SectionCard
        title="Revision History"
        icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            <select
              className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            <Button size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => refetch()} title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        {isLoading && (
          <IntelligenceLoadingSkeleton rows={5} />
        )}
        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertTriangle className="h-4 w-4" />
            Failed to load revisions.
            <Button size="sm" variant="ghost" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !isError && revisions.length === 0 && (
          <IntelligenceEmptyState
            title="No revisions found"
            description="Compensation revisions will appear here once initiated."
          />
        )}
        {!isLoading && !isError && revisions.length > 0 && (
          <div className="space-y-2">
            {revisions.map(rev => (
              <RevisionRow
                key={rev.id}
                rev={rev}
                isAdmin={isAdmin}
                onApprove={(id) => approveMut.mutate(id)}
                onReject={(id) => setRejectId(id)}
                onWithdraw={(id) => withdrawMut.mutate(id)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={(o) => { if (!o) { setRejectId(null); setRejectReason('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Reject Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Please provide a reason for rejecting this revision request.
            </p>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 ring-primary/50 resize-y"
              placeholder="Reason for rejection…"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" className="h-8 text-xs gap-1.5"
                disabled={!rejectReason.trim() || rejectMut.isPending}
                onClick={() => rejectId && rejectMut.mutate({ id: rejectId, reason: rejectReason })}>
                {rejectMut.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Rejecting…</>
                  : <><XCircle className="h-3.5 w-3.5" />Confirm Reject</>}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs"
                onClick={() => { setRejectId(null); setRejectReason('') }}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
