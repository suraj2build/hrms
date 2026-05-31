/**
 * EssRegularization — /ess/attendance/regularization
 *
 * Employee Self-Service: raise attendance regularization requests and track status.
 *
 * Terminology: Employees do NOT correct attendance — they REQUEST REGULARIZATION
 * against an attendance exception (missed punch, absent without cause, etc.).
 *
 * Workflow:
 *   Employee submits → Manager approves/rejects → HR handles escalations only
 *
 * Design: employee-centric worklife portal feel — not admin console styling.
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardCheck, CheckCircle2, XCircle, Clock3,
  Loader2, SearchX, CalendarDays, RefreshCw, Send,
  AlertTriangle, Info, ChevronDown, Ban,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type RegStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

interface RegRequest {
  id:                    string
  date:                  string
  regularization_type:   string | null
  requested_check_in:    string | null
  requested_check_out:   string | null
  reason:                string
  status:                RegStatus
  rejection_reason:      string | null
  created_at:            string
  approved_at:           string | null
}

interface RegResponse {
  data:  RegRequest[]
  total: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REG_TYPES: { value: string; label: string; description: string }[] = [
  { value: 'missed_punch',    label: 'Missed Punch',         description: 'Did not punch in or out' },
  { value: 'forgot_checkout', label: 'Forgot Check-out',     description: 'Checked in but forgot to punch out' },
  { value: 'onsite_duty',     label: 'Onsite Duty',          description: 'Worked at a client or partner location' },
  { value: 'biometric_issue', label: 'Biometric Issue',      description: 'Device malfunction or registration failure' },
  { value: 'client_visit',    label: 'Client Visit',         description: 'Travelled for a client meeting' },
  { value: 'wfh',             label: 'Work from Home',       description: 'Worked remotely — no office punch available' },
  { value: 'field_work',      label: 'Field Work',           description: 'Travelling or working in the field' },
  { value: 'system_issue',    label: 'System Issue',         description: 'Attendance system was down or inaccessible' },
]

const REG_TYPE_LABEL: Record<string, string> = Object.fromEntries(REG_TYPES.map(t => [t.value, t.label]))

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const STATUS_BADGE: Record<RegStatus, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'destructive',
  withdrawn: 'secondary',
}

const STATUS_ICON: Record<RegStatus, React.ReactNode> = {
  pending:   <Clock3 className="h-3.5 w-3.5" />,
  approved:  <CheckCircle2 className="h-3.5 w-3.5" />,
  rejected:  <XCircle className="h-3.5 w-3.5" />,
  withdrawn: <Ban className="h-3.5 w-3.5" />,
}

const STATUS_LABEL: Record<RegStatus, string> = {
  pending:   'Pending Review',
  approved:  'Approved',
  rejected:  'Rejected',
  withdrawn: 'Withdrawn',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">Loading your requests…</p>
    </div>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      <SearchX className="h-7 w-7 opacity-40" />
      <p className="text-sm font-medium text-foreground">
        {filtered ? 'No requests match this filter' : 'No regularization requests yet'}
      </p>
      <p className="text-xs text-center max-w-xs">
        {filtered
          ? 'Try clearing the filter to see all requests.'
          : 'Use the form above to raise a regularization request for any exception day.'}
      </p>
    </div>
  )
}

// ── Regularization type card selector ─────────────────────────────────────────

function RegTypeSelector({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {REG_TYPES.map(t => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
            value === t.value
              ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/20'
              : 'border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40',
          )}
        >
          <div className={cn(
            'w-3.5 h-3.5 mt-0.5 rounded-full border-2 flex-shrink-0 transition-all',
            value === t.value ? 'border-primary bg-primary scale-110' : 'border-muted-foreground/30',
          )} />
          <div>
            <p className={cn(
              'text-xs font-semibold leading-tight',
              value === t.value ? 'text-primary' : 'text-foreground',
            )}>
              {t.label}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EssRegularization() {
  const { profile }  = useAuthStore()
  const queryClient  = useQueryClient()

  // ── Form state ─────────────────────────────────────────────────────────────
  const [date,        setDate]        = useState('')
  const [regType,     setRegType]     = useState('')
  const [checkIn,     setCheckIn]     = useState('')
  const [checkOut,    setCheckOut]    = useState('')
  const [reason,      setReason]      = useState('')
  const [formError,   setFormError]   = useState<string | null>(null)
  const [submitted,   setSubmitted]   = useState(false)
  const [showTimes,   setShowTimes]   = useState(false)

  // ── Filters ────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<RegStatus | ''>('')

  // ── Query: own regularization requests ────────────────────────────────────
  const params = new URLSearchParams({ limit: '100' })
  if (statusFilter) params.set('status', statusFilter)

  const { data, isLoading, isError, refetch } = useQuery<RegResponse>({
    queryKey: ['regularization-my', statusFilter],
    queryFn:  () => api.get<RegResponse>(`/attendance/regularisation/my?${params}`),
    staleTime: 30_000,
  })

  const rows  = data?.data  ?? []
  const total = data?.total ?? 0

  // ── Mutation: submit regularization ───────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: () =>
      api.post('/attendance/regularisation', {
        date,
        regularization_type:  regType,
        requested_check_in:   checkIn  ? new Date(checkIn).toISOString()  : null,
        requested_check_out:  checkOut ? new Date(checkOut).toISOString() : null,
        reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularization-my'] })
      setDate(''); setRegType(''); setCheckIn(''); setCheckOut(''); setReason('')
      setShowTimes(false)
      setFormError(null)
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 5000)
      toast.success('Regularization request submitted', {
        description: 'Your manager will review it shortly.',
      })
    },
    onError: (err: Error) => {
      setFormError(err.message ?? 'Failed to submit regularization request')
      toast.error('Submission failed', { description: err.message })
    },
  })

  // ── Mutation: cancel pending request ─────────────────────────────────────
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularization-my'] })
      setCancellingId(null)
      toast.success('Request withdrawn')
    },
    onError: (err: Error) => {
      setCancellingId(null)
      toast.error('Could not cancel request', { description: err.message })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitted(false)

    if (!date)   { setFormError('Date is required'); return }
    if (!regType) { setFormError('Regularization type is required'); return }
    if (!reason.trim()) { setFormError('Reason is required'); return }

    submitMutation.mutate()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Attendance Regularization"
        subtitle="Raise regularization requests for attendance exceptions"
      />

      {/* Profile not linked guard */}
      {!profile?.employee_id && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <AlertTriangle className="h-7 w-7 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs">Your profile is not linked to an employee record. Contact HR.</p>
          </div>
        </SectionCard>
      )}

      {profile?.employee_id && (
        <>
          {/* ── Workflow notice ───────────────────────────────────────────────── */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-info/8 border border-info/20">
            <Info className="h-4 w-4 text-info flex-shrink-0 mt-0.5" />
            <div className="text-xs text-info/80 leading-relaxed">
              <span className="font-semibold text-info">How it works:</span>{' '}
              You raise a regularization request → your manager approves or rejects it →
              HR admin handles escalations only. You cannot edit attendance records directly.
            </div>
          </div>

          {/* ── Request Regularization form ───────────────────────────────────── */}
          <SectionCard
            title="Request Regularization"
            icon={<ClipboardCheck className="h-4 w-4 text-muted-foreground" />}
          >
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Exception Date <span className="text-destructive">*</span>
                </label>
                <DateInput
                  value={date}
                  max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}
                  onChange={setDate}
                  className="h-9 text-xs max-w-[220px]"
                />
                <p className="text-[10px] text-muted-foreground">Select the date the attendance exception occurred.</p>
              </div>

              {/* Regularization type */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">
                  Regularization Type <span className="text-destructive">*</span>
                </label>
                <RegTypeSelector value={regType} onChange={setRegType} />
              </div>

              {/* Optional times */}
              <div className="space-y-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowTimes(v => !v)}
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showTimes && 'rotate-180')} />
                  {showTimes ? 'Hide' : 'Add'} requested times (optional)
                </button>
                {showTimes && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground">Requested Check-in</label>
                      <Input
                        type="datetime-local"
                        value={checkIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground">Requested Check-out</label>
                      <Input
                        type="datetime-local"
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Describe the circumstances — e.g. I was on an onsite visit and the client premises had no biometric device…"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
                />
                <p className="text-[10px] text-muted-foreground text-right">{reason.length}/1000</p>
              </div>

              {/* Error */}
              {formError && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {formError}
                </p>
              )}

              {/* Success flash */}
              {submitted && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-success/8 border border-success/20">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-success">Regularization request submitted</p>
                    <p className="text-muted-foreground mt-0.5">Your manager will review it shortly. You will be notified once a decision is made.</p>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                size="sm"
                className="gap-1.5"
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Send className="h-3.5 w-3.5" />}
                {submitMutation.isPending ? 'Submitting…' : 'Submit Regularization Request'}
              </Button>
            </form>
          </SectionCard>

          {/* ── My Requests ────────────────────────────────────────────────────── */}
          <SectionCard
            title={isLoading ? 'My Requests' : `My Requests${total > 0 ? ` (${total})` : ''}`}
            icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as RegStatus | '')}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">All status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
            }
          >
            {isLoading && <LoadingState />}

            {isError && (
              <div className="flex flex-col items-center gap-2 py-12">
                <p className="text-sm text-destructive">Failed to load your requests</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
              </div>
            )}

            {!isLoading && !isError && rows.length === 0 && (
              <EmptyState filtered={!!statusFilter} />
            )}

            {!isLoading && !isError && rows.length > 0 && (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden space-y-2.5">
                  {rows.map((row) => (
                    <div
                      key={row.id}
                      className={cn(
                        'rounded-xl border bg-card p-4 text-xs space-y-3',
                        row.status === 'pending'  && 'border-warning/30',
                        row.status === 'approved' && 'border-success/30',
                        row.status === 'rejected' && 'border-destructive/30',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          {fmtDate(row.date)}
                        </div>
                        <Badge
                          variant={STATUS_BADGE[row.status]}
                          className="rounded-full text-[10px] capitalize gap-1 flex-shrink-0"
                        >
                          {STATUS_ICON[row.status]}
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </div>

                      {row.regularization_type && (
                        <p className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {REG_TYPE_LABEL[row.regularization_type] ?? row.regularization_type}
                          </span>
                        </p>
                      )}

                      {(row.requested_check_in || row.requested_check_out) && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-0.5">Requested In</p>
                            <p className="font-mono text-foreground">{fmtTime(row.requested_check_in)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-0.5">Requested Out</p>
                            <p className="font-mono text-foreground">{fmtTime(row.requested_check_out)}</p>
                          </div>
                        </div>
                      )}

                      <p className="text-muted-foreground line-clamp-2" title={row.reason}>
                        {row.reason}
                      </p>

                      {row.status === 'approved' && (
                        <p className="text-success">Approved {fmtDatetime(row.approved_at)}</p>
                      )}
                      {row.status === 'rejected' && row.rejection_reason && (
                        <p className="text-destructive">Rejected — {row.rejection_reason}</p>
                      )}
                      {row.status === 'pending' && (
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-muted-foreground">Awaiting manager review</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={cancellingId === row.id}
                            onClick={() => {
                              setCancellingId(row.id)
                              cancelMutation.mutate(row.id)
                            }}
                          >
                            {cancellingId === row.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Withdraw'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop table view */}
                <div className="hidden sm:block overflow-x-auto -mx-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Date', 'Type', 'Req. In', 'Req. Out', 'Reason', 'Status / Feedback', 'Submitted', ''].map((h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold text-muted-foreground py-2.5 px-3 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-foreground">
                              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              {fmtDate(row.date)}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="text-xs font-medium text-foreground">
                              {row.regularization_type
                                ? (REG_TYPE_LABEL[row.regularization_type] ?? row.regularization_type)
                                : <span className="text-muted-foreground/40">—</span>}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">
                            {fmtTime(row.requested_check_in)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">
                            {fmtTime(row.requested_check_out)}
                          </td>
                          <td className="py-3 px-3 max-w-[200px]">
                            <p className="text-foreground text-xs line-clamp-2" title={row.reason}>{row.reason}</p>
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant={STATUS_BADGE[row.status]} className="rounded-full text-[10px] gap-1 whitespace-nowrap">
                              {STATUS_ICON[row.status]}
                              {STATUS_LABEL[row.status]}
                            </Badge>
                            {row.status === 'rejected' && row.rejection_reason && (
                              <p className="text-[10px] text-destructive mt-1 max-w-[160px]" title={row.rejection_reason}>
                                {row.rejection_reason}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">
                            {fmtDatetime(row.created_at)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {row.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={cancellingId === row.id}
                                onClick={() => {
                                  setCancellingId(row.id)
                                  cancelMutation.mutate(row.id)
                                }}
                              >
                                {cancellingId === row.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : 'Withdraw'}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted-foreground px-1">
                  <span>{total} request{total !== 1 ? 's' : ''}</span>
                  {rows.some((r) => r.status === 'pending') && (
                    <Badge variant="warning" className="rounded-full text-[10px]">
                      {rows.filter((r) => r.status === 'pending').length} awaiting review
                    </Badge>
                  )}
                </div>
              </>
            )}
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
