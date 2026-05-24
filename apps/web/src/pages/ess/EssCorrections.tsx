/**
 * EssCorrections — /ess/attendance/corrections
 *
 * Employee Self-Service: submit punch correction requests and track their status.
 *
 * - "Apply Correction" form: date, corrected_in, corrected_out, reason
 * - "My Requests" table: status badge, submitted date, approved/applied/rejected timestamps
 *
 * Employees cannot edit attendance directly; all changes flow through the
 * manager/HR approval workflow (Step 6 constraint).
 *
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardEdit, CheckCircle2, XCircle, Clock3,
  Loader2, SearchX, CalendarDays, RefreshCw, Send,
  AlertTriangle, AlertCircle,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

// 'approved' is no longer persisted — corrections move directly from
// pending → processing (recompute in flight) → applied | failed.
type CorrectionStatus = 'pending' | 'processing' | 'applied' | 'failed' | 'rejected'

interface MyCorrection {
  id:                    string
  date:                  string
  corrected_in:          string | null
  corrected_out:         string | null
  reason:                string
  status:                CorrectionStatus
  rejection_reason:      string | null
  created_at:            string
  approved_at:           string | null
  applied_at:            string | null
  failure_reason:        string | null
  retry_count:           number
}

interface MyCorrectionsResponse {
  data:  MyCorrection[]
  total: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const STATUS_BADGE: Record<CorrectionStatus, 'warning' | 'success' | 'destructive' | 'outline' | 'secondary'> = {
  pending:    'warning',
  processing: 'secondary',
  applied:    'outline',
  failed:     'destructive',
  rejected:   'destructive',
}

const STATUS_ICON: Record<CorrectionStatus, React.ReactNode> = {
  pending:    <Clock3 className="h-3.5 w-3.5" />,
  processing: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  applied:    <CheckCircle2 className="h-3.5 w-3.5" />,
  failed:     <AlertCircle className="h-3.5 w-3.5" />,
  rejected:   <XCircle className="h-3.5 w-3.5" />,
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">Loading your requests…</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      <SearchX className="h-7 w-7 opacity-40" />
      <p className="text-sm font-medium text-foreground">No correction requests yet</p>
      <p className="text-xs">Use the form above to submit your first correction request.</p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EssCorrections() {
  const { profile }    = useAuthStore()
  const queryClient    = useQueryClient()

  // ── Form state ─────────────────────────────────────────────────────────────
  const [date,         setDate]         = useState('')
  const [correctedIn,  setCorrectedIn]  = useState('')
  const [correctedOut, setCorrectedOut] = useState('')
  const [reason,       setReason]       = useState('')
  const [formError,    setFormError]    = useState<string | null>(null)
  const [submitted,    setSubmitted]    = useState(false)

  // ── Filters ────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<CorrectionStatus | ''>('')

  // ── Query: own requests ────────────────────────────────────────────────────
  const params = new URLSearchParams({ limit: '100' })
  if (statusFilter) params.set('status', statusFilter)

  const { data, isLoading, isError, refetch } = useQuery<MyCorrectionsResponse>({
    queryKey: ['corrections-my', statusFilter],
    queryFn:  () => api.get<MyCorrectionsResponse>(`/attendance/corrections/my?${params}`),
    staleTime: 30_000,
    // Auto-refresh every 8 s while any correction is in 'processing' state so
    // employees see the applied/failed result without having to manually refresh.
    refetchInterval: (query) => {
      const rows = (query.state.data as MyCorrectionsResponse | undefined)?.data ?? []
      return rows.some((r) => r.status === 'processing') ? 8_000 : false
    },
  })

  const rows  = data?.data  ?? []
  const total = data?.total ?? 0

  // ── Mutation: submit correction ────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: () =>
      api.post('/attendance/corrections', {
        date,
        corrected_in:  correctedIn  ? new Date(correctedIn).toISOString()  : null,
        corrected_out: correctedOut ? new Date(correctedOut).toISOString() : null,
        reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections-my'] })
      // Reset form
      setDate(''); setCorrectedIn(''); setCorrectedOut(''); setReason('')
      setFormError(null)
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 4000)
      toast.success('Correction submitted', {
        description: 'Your manager will review it shortly.',
      })
    },
    onError: (err: Error) => {
      setFormError(err.message ?? 'Failed to submit correction request')
      toast.error('Submission failed', { description: err.message })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitted(false)

    if (!date) { setFormError('Date is required'); return }
    if (!correctedIn && !correctedOut) {
      setFormError('Please provide at least a corrected check-in or check-out time'); return
    }
    if (!reason.trim()) { setFormError('Reason is required'); return }

    submitMutation.mutate()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Attendance Corrections"
        subtitle="Submit a request to correct missing or incorrect punch records"
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
          {/* ── Apply Correction form ─────────────────────────────────────── */}
          <SectionCard
            title="Apply Correction"
            icon={<ClipboardEdit className="h-4 w-4 text-muted-foreground" />}
          >
            {/* Constraint notice */}
            <div className="flex items-start gap-2 mb-4 p-3 rounded-md bg-info/10 border border-info/25 text-xs text-info">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Corrections are reviewed by your manager or HR before being applied to your
                attendance record. You cannot edit attendance directly.
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Date */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Date <span className="text-destructive">*</span>
                </label>
                <Input
                  type="date"
                  value={date}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 text-xs max-w-[200px]"
                />
              </div>

              {/* Corrected times */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Corrected Check-in
                  </label>
                  <Input
                    type="datetime-local"
                    value={correctedIn}
                    onChange={(e) => setCorrectedIn(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">Leave blank if not correcting check-in</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Corrected Check-out
                  </label>
                  <Input
                    type="datetime-local"
                    value={correctedOut}
                    onChange={(e) => setCorrectedOut(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">Leave blank if not correcting check-out</p>
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Forgot to punch out, device was offline, worked from a different location…"
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
                <p className="text-xs text-success flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  Correction request submitted — your manager will review it shortly.
                </p>
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
                {submitMutation.isPending ? 'Submitting…' : 'Submit Request'}
              </Button>
            </form>
          </SectionCard>

          {/* ── My Requests ────────────────────────────────────────────────── */}
          <SectionCard
            title={isLoading ? 'My Requests' : `My Requests${total > 0 ? ` (${total})` : ''}`}
            icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-2">
                {/* Status filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as CorrectionStatus | '')}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">All status</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="applied">Applied</option>
                  <option value="failed">Failed</option>
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

            {!isLoading && !isError && rows.length === 0 && <EmptyState />}

            {!isLoading && !isError && rows.length > 0 && (
              <>
                {/* ── Mobile card view (< sm) ─────────────────────────────── */}
                <div className="sm:hidden space-y-2">
                  {rows.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-2"
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
                          {row.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">Check-in</p>
                          <p className="font-mono text-foreground">{fmtTime(row.corrected_in)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">Check-out</p>
                          <p className="font-mono text-foreground">{fmtTime(row.corrected_out)}</p>
                        </div>
                      </div>

                      <p className="text-muted-foreground line-clamp-2" title={row.reason}>
                        {row.reason}
                      </p>

                      {/* Status detail */}
                      {row.status === 'applied' && (
                        <p className="text-success">Applied {fmtDatetime(row.applied_at)}</p>
                      )}
                      {row.status === 'processing' && (
                        <p className="flex items-center gap-1 text-muted-foreground italic">
                          <Loader2 className="h-3 w-3 animate-spin" />Recomputing…
                        </p>
                      )}
                      {row.status === 'failed' && (
                        <p className="text-destructive flex items-start gap-1">
                          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          {row.failure_reason ?? 'Recompute failed'}
                        </p>
                      )}
                      {row.status === 'rejected' && row.rejection_reason && (
                        <p className="text-destructive">Rejected — {row.rejection_reason}</p>
                      )}

                      <p className="text-[10px] text-muted-foreground">
                        Submitted {fmtDatetime(row.created_at)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* ── Desktop table view (≥ sm) ─────────────────────────────── */}
                <div className="hidden sm:block overflow-x-auto -mx-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Date', 'Corrected In', 'Corrected Out', 'Reason', 'Status', 'Submitted', 'Last Update'].map((h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap"
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
                          <td className="py-3 px-3 whitespace-nowrap text-foreground">{fmtTime(row.corrected_in)}</td>
                          <td className="py-3 px-3 whitespace-nowrap text-foreground">{fmtTime(row.corrected_out)}</td>
                          <td className="py-3 px-3 max-w-[200px]">
                            <p className="text-foreground text-xs line-clamp-2" title={row.reason}>{row.reason}</p>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <Badge variant={STATUS_BADGE[row.status]} className="rounded-full text-[10px] capitalize gap-1">
                              {STATUS_ICON[row.status]}{row.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">{fmtDatetime(row.created_at)}</td>
                          <td className="py-3 px-3 text-xs max-w-[200px]">
                            {row.status === 'applied' && <span className="text-success whitespace-nowrap">Applied {fmtDatetime(row.applied_at)}</span>}
                            {row.status === 'processing' && (
                              <span className="flex items-center gap-1 text-muted-foreground italic whitespace-nowrap">
                                <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />Approved · recomputing…
                              </span>
                            )}
                            {row.status === 'failed' && (
                              <div className="space-y-0.5">
                                <div className="flex items-start gap-1 text-destructive">
                                  <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <span className="line-clamp-2">{row.failure_reason ?? 'Recompute failed'}</span>
                                </div>
                                {row.retry_count > 0 && (
                                  <p className="text-[10px] text-muted-foreground pl-4">
                                    {row.retry_count} retr{row.retry_count === 1 ? 'y' : 'ies'}
                                  </p>
                                )}
                              </div>
                            )}
                            {row.status === 'rejected' && (
                              <span className="text-destructive">
                                {row.rejection_reason ? `Rejected — ${row.rejection_reason}` : 'Rejected'}
                              </span>
                            )}
                            {row.status === 'pending' && (
                              <span className="text-muted-foreground whitespace-nowrap">Awaiting review</span>
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
                      {rows.filter((r) => r.status === 'pending').length} pending review
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
