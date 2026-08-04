/**
 * EssApprovals — /ess/approvals
 *
 * Aggregate hub showing all pending workflow requests for the logged-in employee:
 *   · Leave applications (pending manager/HR approval)
 *   · Attendance corrections (pending review)
 *   · Reimbursement claims (draft or submitted)
 *   · Comp-off requests (pending)
 *
 * Design: compact enterprise density, operational trust, no clutter.
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useMemo }  from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link }     from 'react-router-dom'
import {
  CalendarCheck, ClipboardEdit, CreditCard,
  CalendarPlus, Loader2, ArrowRight, CheckCircle2,
  AlertTriangle, AlertCircle, Info,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { ApprovalChainStepper } from '@/components/approvals/ApprovalChainStepper'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveApp {
  id: string; from_date: string; to_date: string; status: string
  reason?: string; leave_types?: { name: string }; created_at: string
}
interface CorrectionReq {
  id: string; date: string; status: string; reason: string
  corrected_in: string | null; corrected_out: string | null; created_at: string
}
interface ReimbClaim {
  id: string; claim_month: string; claimed_amount: number
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'paid'
  category_name?: string; created_at: string
}
interface CompOffReq {
  id: string; worked_date: string; status: string; days_to_credit: number
  worked_reason: string; created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}
function fmtDatetime(s: string) {
  const d = new Date(s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

const PENDING_LEAVE   = (s: string) => s === 'pending'
const PENDING_CORR    = (s: string) => s === 'pending' || s === 'processing'
const PENDING_REIMB   = (s: string) => s === 'draft' || s === 'submitted' || s === 'under_review'
const PENDING_COMPOFF = (s: string) => s === 'pending'

// ── Section component ──────────────────────────────────────────────────────────

function PendingSection({
  title, icon, count, href, linkLabel, children, loading, empty,
}: {
  title:      string
  icon:       React.ReactNode
  count:      number
  href:       string
  linkLabel:  string
  children:   React.ReactNode
  loading:    boolean
  empty:      React.ReactNode
}) {
  return (
    <SectionCard
      title={count > 0 ? `${title} (${count})` : title}
      icon={icon}
      action={
        <Link to={href}>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
            {linkLabel} <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      }
    >
      {loading
        ? <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
        : count === 0 ? empty
        : children
      }
    </SectionCard>
  )
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const variantMap: Record<string, 'warning' | 'secondary' | 'success' | 'destructive' | 'outline'> = {
    pending:     'warning',
    processing:  'secondary',
    draft:       'secondary',
    submitted:   'warning',
    under_review:'warning',
    approved:    'success',
    applied:     'success',
    rejected:    'destructive',
    failed:      'destructive',
    paid:        'outline',
  }
  return (
    <Badge
      variant={variantMap[status] ?? 'outline'}
      className="rounded-full text-[10px] capitalize"
    >
      {status.replace('_', ' ')}
    </Badge>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function PendingRow({
  left, right, meta, status, chain,
}: {
  left:   React.ReactNode
  right?: React.ReactNode
  meta:   string
  status: string
  chain?: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-border/40 last:border-0 gap-2 sm:gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {left}
          <StatusChip status={status} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{meta}</p>
        {chain && <div className="mt-1.5">{chain}</div>}
      </div>
      {right && <div className="flex-shrink-0 w-full sm:w-auto">{right}</div>}
    </div>
  )
}

// ── No-pending state ──────────────────────────────────────────────────────────

function NoPending({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2.5 py-4 text-muted-foreground text-xs">
      <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
      <span>{msg}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EssApprovals({ embedded = false }: { embedded?: boolean } = {}) {
  const { profile }  = useAuthStore()
  const employeeId   = profile?.employee_id ?? null

  // ── Leave applications ─────────────────────────────────────────────────────
  // Canonical source is `leave_requests` (served by /leave/my-requests) — NOT
  // the legacy `leave_applications` behind /attendance/leave/my, where
  // submitted leave never appeared. leave_requests stores status UPPERCASE;
  // normalized to lowercase since PENDING_LEAVE() below does an exact
  // lowercase comparison.
  const { data: leaveData, isLoading: leaveLoading } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['ess-approvals-leave', employeeId],
    queryFn:  async () => {
      const res = await api.get('/leave/my-requests?limit=100') as { data: LeaveApp[] }
      return { data: (res.data ?? []).map(r => ({ ...r, status: String(r.status ?? '').toLowerCase() })) }
    },
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  // ── Corrections ────────────────────────────────────────────────────────────
  // Reads /attendance/regularisation/my — the live correction-request table.
  // attendance_corrections (the old /attendance/corrections/my endpoint) has
  // had no writer anywhere in the app since regularisation replaced it —
  // this tab always showed empty/stale data reading from a dead table.
  const { data: corrData, isLoading: corrLoading } = useQuery<{ data: CorrectionReq[] }>({
    queryKey: ['ess-approvals-corrections'],
    queryFn:  async () => {
      const res = await api.get<{ data: Array<{
        id: string; date: string; status: string; reason: string | null
        requested_check_in: string | null; requested_check_out: string | null
        created_at: string
      }> }>('/attendance/regularisation/my?limit=50')
      return {
        data: (res.data ?? []).map((r) => ({
          id:            r.id,
          date:          r.date,
          status:        r.status,
          reason:        r.reason ?? '',
          corrected_in:  r.requested_check_in  ?? null,
          corrected_out: r.requested_check_out ?? null,
          created_at:    r.created_at,
        })),
      }
    },
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  // ── Reimbursements ─────────────────────────────────────────────────────────
  const { data: reimbData, isLoading: reimbLoading } = useQuery<ReimbClaim[]>({
    queryKey: ['ess-approvals-reimb'],
    queryFn:  () => api.get<{ data: ReimbClaim[] }>('/payroll/reimbursements/my').then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  // ── Comp-off ───────────────────────────────────────────────────────────────
  const { data: compOffData, isLoading: compOffLoading } = useQuery<{ data: CompOffReq[] }>({
    queryKey: ['ess-approvals-compoff'],
    queryFn:  () => api.get<{ data: CompOffReq[] }>('/attendance/comp-off'),
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  // ── Derived pending counts ──────────────────────────────────────────────────

  const pendingLeave   = useMemo(() => (leaveData?.data  ?? []).filter(r => PENDING_LEAVE(r.status)),   [leaveData])
  const pendingCorr    = useMemo(() => (corrData?.data    ?? []).filter(r => PENDING_CORR(r.status)),    [corrData])
  const pendingReimb   = useMemo(() => (reimbData         ?? []).filter(r => PENDING_REIMB(r.status)),   [reimbData])
  const pendingCompOff = useMemo(() => (compOffData?.data ?? []).filter(r => PENDING_COMPOFF(r.status)), [compOffData])

  const totalPending = pendingLeave.length + pendingCorr.length + pendingReimb.length + pendingCompOff.length

  // ── Profile guard ──────────────────────────────────────────────────────────

  if (!employeeId) {
    const guard = (
      <SectionCard>
        <div className="flex flex-col items-center gap-2 py-12">
          <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
          <p className="text-sm font-medium text-foreground">Profile not linked</p>
          <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
        </div>
      </SectionCard>
    )
    if (embedded) return guard
    return (
      <PageContainer>
        <PageHeader title="My Approvals" subtitle="Track all pending workflow requests" />
        {guard}
      </PageContainer>
    )
  }

  const body = (
    <>
      {/* ── Overview banner ────────────────────────────────────────────────── */}
      {totalPending > 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 px-4 py-3 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            You have <strong>{totalPending} pending request{totalPending !== 1 ? 's' : ''}</strong> awaiting
            approval across{' '}
            {[
              pendingLeave.length > 0   && `${pendingLeave.length} leave`,
              pendingCorr.length > 0    && `${pendingCorr.length} correction`,
              pendingReimb.length > 0   && `${pendingReimb.length} reimbursement`,
              pendingCompOff.length > 0 && `${pendingCompOff.length} comp-off`,
            ].filter(Boolean).join(', ')}{' '}
            workflow{totalPending !== 1 ? 's' : ''}.
          </span>
        </div>
      ) : (!leaveLoading && !corrLoading && !reimbLoading && !compOffLoading) ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          <span>All caught up — no pending requests.</span>
        </div>
      ) : null}

      {/* ── Leave Applications ─────────────────────────────────────────────── */}
      <PendingSection
        title="Leave Requests"
        icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}
        count={pendingLeave.length}
        href="/ess/leave"
        linkLabel="View all leaves"
        loading={leaveLoading}
        empty={<NoPending msg="No pending leave applications." />}
      >
        <div className="space-y-0">
          {pendingLeave.map(r => (
            <PendingRow
              key={r.id}
              status={r.status}
              left={
                <span className="text-xs font-medium text-foreground">
                  {r.leave_types?.name ?? 'Leave'} —{' '}
                  {fmtDate(r.from_date)}{r.from_date !== r.to_date ? ` → ${fmtDate(r.to_date)}` : ''}
                </span>
              }
              meta={`Submitted ${fmtDatetime(r.created_at)}${r.reason ? ` · "${r.reason}"` : ''}`}
              chain={<ApprovalChainStepper entityType="leave_request" entityId={r.id} />}
            />
          ))}
        </div>
      </PendingSection>

      {/* ── Attendance Corrections ─────────────────────────────────────────── */}
      <PendingSection
        title="Attendance Corrections"
        icon={<ClipboardEdit className="h-4 w-4 text-muted-foreground" />}
        count={pendingCorr.length}
        href="/ess/attendance/corrections"
        linkLabel="View all corrections"
        loading={corrLoading}
        empty={<NoPending msg="No pending correction requests." />}
      >
        <div className="space-y-0">
          {pendingCorr.map(r => (
            <PendingRow
              key={r.id}
              status={r.status}
              left={
                <span className="text-xs font-medium text-foreground">
                  {fmtDate(r.date)}
                  {r.status === 'processing' && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground italic">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />recomputing…
                    </span>
                  )}
                </span>
              }
              meta={`${(r.reason ?? '').slice(0, 60)}${(r.reason ?? '').length > 60 ? '…' : ''} · ${fmtDatetime(r.created_at)}`}
              chain={<ApprovalChainStepper entityType="attendance_regularisation" entityId={r.id} />}
            />
          ))}
        </div>
      </PendingSection>

      {/* ── Reimbursements ────────────────────────────────────────────────── */}
      <PendingSection
        title="Reimbursement Claims"
        icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
        count={pendingReimb.length}
        href="/ess/reimbursements"
        linkLabel="View all claims"
        loading={reimbLoading}
        empty={<NoPending msg="No pending reimbursement claims." />}
      >
        <div className="space-y-0">
          {pendingReimb.map(r => (
            <PendingRow
              key={r.id}
              status={r.status}
              left={
                <span className="text-xs font-medium text-foreground">
                  {r.category_name ?? 'Claim'} — ₹{r.claimed_amount.toLocaleString('en-IN')}
                </span>
              }
              meta={`${(() => { if (!r.claim_month) return '—'; const d=new Date(r.claim_month.slice(0,7)+'-01T12:00:00Z'); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()} · ${fmtDatetime(r.created_at)}`}
              chain={<ApprovalChainStepper entityType="reimbursement_claim" entityId={r.id} />}
              right={
                r.status === 'draft' ? (
                  <Link to="/ess/reimbursements">
                    <Button size="sm" variant="outline" className="h-9 w-full sm:w-auto sm:h-6 text-[10px] px-2">Submit</Button>
                  </Link>
                ) : undefined
              }
            />
          ))}
        </div>
      </PendingSection>

      {/* ── Comp-Off ──────────────────────────────────────────────────────── */}
      <PendingSection
        title="Comp-Off Requests"
        icon={<CalendarPlus className="h-4 w-4 text-muted-foreground" />}
        count={pendingCompOff.length}
        href="/ess/comp-off"
        linkLabel="View all comp-off"
        loading={compOffLoading}
        empty={<NoPending msg="No pending comp-off requests." />}
      >
        <div className="space-y-0">
          {pendingCompOff.map(r => (
            <PendingRow
              key={r.id}
              status={r.status}
              left={
                <span className="text-xs font-medium text-foreground">
                  {fmtDate(r.worked_date)} —{' '}
                  {r.worked_reason === 'holiday' ? 'Worked on Holiday' : 'Worked on Weekly Off'}
                </span>
              }
              meta={`${r.days_to_credit === 0.5 ? 'Half day' : `${r.days_to_credit} day`} · ${fmtDatetime(r.created_at)}`}
              chain={<ApprovalChainStepper entityType="comp_off_request" entityId={r.id} />}
            />
          ))}
        </div>
      </PendingSection>

      {/* ── Payroll continuity note ────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          Pending leave and corrections may affect your payroll. Ensure requests are approved before your
          payroll processing date each month.
        </span>
      </div>
    </>
  )

  if (embedded) return body

  return (
    <PageContainer>
      <PageHeader
        title="My Approvals"
        subtitle="All pending workflow requests across leave, corrections, reimbursements, and comp-off"
      />
      {body}
    </PageContainer>
  )
}
