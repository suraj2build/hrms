/**
 * ManagerLoanApprovals — /manager/loans-approvals
 *
 * Manager (Stage 1) approval queue for direct reports' salary-advance and loan
 * requests. Consumes the existing canonical endpoints:
 *   GET  /payroll/ess/manager/pending
 *   POST /payroll/ess/manager/advances/:id/approve | /reject
 *   POST /payroll/ess/manager/loans/:id/approve    | /reject
 *
 * Approved requests advance to status 'pending_hr' for final HR approval.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Wallet, Landmark, CheckCircle2, XCircle, Loader2, Inbox, Clock,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { cn }            from '@/lib/utils'
import { api }           from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmployeeRef {
  id: string; first_name: string; last_name: string; employee_code: string
}
interface PendingAdvance {
  id: string
  requested_amount: number
  purpose: string
  recovery_months: number
  requested_date: string | null
  created_at: string
  employees: EmployeeRef | null
}
interface PendingLoan {
  id: string
  loan_type: string
  principal_amount: number
  interest_rate_pct: number
  tenure_months: number
  emi_amount: number
  purpose: string | null
  created_at: string
  employees: EmployeeRef | null
}
interface PendingResponse {
  advances: PendingAdvance[]
  loans: PendingLoan[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const fullName = (e: EmployeeRef | null) =>
  e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '—'

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const titleCase = (s: string) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// ── Page ───────────────────────────────────────────────────────────────────────

export function ManagerLoanApprovals() {
  const qc = useQueryClient()
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason]     = useState('')

  const { data, isLoading } = useQuery<PendingResponse>({
    queryKey: ['manager-loan-pending'],
    queryFn:  () => api.get('/payroll/ess/manager/pending'),
    staleTime: 30_000,
  })

  const advances = data?.advances ?? []
  const loans    = data?.loans    ?? []
  const total    = advances.length + loans.length

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['manager-loan-pending'] })
    qc.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
  }

  const approve = useMutation({
    mutationFn: ({ kind, id }: { kind: 'advances' | 'loans'; id: string }) =>
      api.post(`/payroll/ess/manager/${kind}/${id}/approve`),
    onSuccess: () => { toast.success('Approved — forwarded to HR'); invalidate() },
    onError:   (e: any) => toast.error(e?.message ?? 'Approval failed'),
  })

  const reject = useMutation({
    mutationFn: ({ kind, id }: { kind: 'advances' | 'loans'; id: string }) =>
      api.post(`/payroll/ess/manager/${kind}/${id}/reject`, { reason: reason.trim() }),
    onSuccess: () => { toast.success('Request rejected'); setRejectId(null); setReason(''); invalidate() },
    onError:   (e: any) => toast.error(e?.message ?? 'Rejection failed'),
  })

  const busy = approve.isPending || reject.isPending

  function RejectForm({ kind, id }: { kind: 'advances' | 'loans'; id: string }) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <input
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason for rejection…"
          className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive/50"
        />
        <button
          disabled={!reason.trim() || busy}
          onClick={() => reject.mutate({ kind, id })}
          className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-white disabled:opacity-50"
        >
          Confirm reject
        </button>
        <button onClick={() => { setRejectId(null); setReason('') }} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    )
  }

  function Actions({ kind, id }: { kind: 'advances' | 'loans'; id: string }) {
    if (rejectId === id) return <RejectForm kind={kind} id={id} />
    return (
      <div className="flex items-center gap-1.5">
        <button
          disabled={busy}
          onClick={() => approve.mutate({ kind, id })}
          className="flex items-center gap-1 rounded-md bg-success px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <CheckCircle2 className="h-3 w-3" /> Approve
        </button>
        <button
          disabled={busy}
          onClick={() => { setRejectId(id); setReason('') }}
          className="flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors"
        >
          <XCircle className="h-3 w-3" /> Reject
        </button>
      </div>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Loan & Advance Approvals"
        subtitle="Review your team's salary-advance and loan requests — approve to forward to HR"
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading queue…</span>
        </div>
      ) : total === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground rounded-lg border border-border bg-card">
          <Inbox className="h-8 w-8 opacity-30" />
          <p className="text-sm">No pending loan or advance requests</p>
          <p className="text-xs">Requests from your direct reports will appear here</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Advances ─────────────────────────────────────────────────── */}
          {advances.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Salary Advances</h2>
                <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">{advances.length}</span>
              </div>
              <div className="space-y-2">
                {advances.map(a => (
                  <div key={a.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{fullName(a.employees)}</p>
                        <p className="text-[11px] text-muted-foreground">{a.employees?.employee_code ?? ''}</p>
                        <p className="text-xs text-foreground/80 mt-1">{a.purpose}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount</p>
                          <p className="font-semibold text-foreground tabular-nums">{inr(a.requested_amount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recovery</p>
                          <p className="font-medium text-foreground tabular-nums">{a.recovery_months} mo.</p>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />{fmtDate(a.requested_date ?? a.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end"><Actions kind="advances" id={a.id} /></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Loans ────────────────────────────────────────────────────── */}
          {loans.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Landmark className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Loans</h2>
                <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">{loans.length}</span>
              </div>
              <div className="space-y-2">
                {loans.map(l => (
                  <div key={l.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{fullName(l.employees)}</p>
                        <p className="text-[11px] text-muted-foreground">{l.employees?.employee_code ?? ''}</p>
                        <p className="text-xs text-foreground/80 mt-1">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] mr-1">{titleCase(l.loan_type)}</span>
                          {l.purpose ?? ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Principal</p>
                          <p className="font-semibold text-foreground tabular-nums">{inr(l.principal_amount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">EMI</p>
                          <p className="font-medium text-foreground tabular-nums">{inr(l.emi_amount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tenure</p>
                          <p className="font-medium text-foreground tabular-nums">{l.tenure_months} mo. @ {l.interest_rate_pct}%</p>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />{fmtDate(l.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end"><Actions kind="loans" id={l.id} /></div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </PageContainer>
  )
}
