/**
 * EssFlowDesk — /ess/flowdesk  (ESS 2.0 · FlowDesk pillar)
 *
 * One place to see what's waiting on you and to start any request. A thin shell
 * over existing approval/request APIs — NO new business logic, NO new tables:
 *   · Awaiting Me   → inline approve/reject for leave, attendance corrections,
 *                     comp-off (HR) and reimbursement claims (HR)
 *   · My Requests   → reuses <EssApprovals embedded /> (my submitted requests)
 *   · Raise a Request → deep-links to dedicated create-forms (no duplication here)
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Inbox, ClipboardList, PlusCircle, ArrowRight, CheckCircle2, Loader2,
  CalendarCheck, ClipboardEdit, CreditCard, Wallet, Home, CalendarPlus, LifeBuoy,
  Check, X,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { EssApprovals } from './EssApprovals'
import { fmtDate } from '@/lib/utils'

// ── Types (subset of the payloads we render) ──────────────────────────────────

interface PendingEmployee { first_name?: string; last_name?: string; employee_code?: string }
interface PendingLeave { id: string; from_date: string; to_date: string; reason?: string; created_at: string; leave_types?: { name?: string }; employees?: PendingEmployee }
interface PendingReg { id: string; date: string; reason?: string; created_at: string; employees?: PendingEmployee }
interface PendingPayload { leave_requests?: PendingLeave[]; regularisations?: PendingReg[] }
interface CompOffItem { id: string; worked_date?: string; days_to_credit?: number; leave_types?: { name?: string } | null; employees?: PendingEmployee }
interface ReimbItem { id: string; amount?: number; claim_month?: string; employees?: PendingEmployee; reimbursement_categories?: { name?: string } | null }

const who = (e?: PendingEmployee) =>
  e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.employee_code || 'Employee' : 'Employee'
const money = (n?: number) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—')

// ── Action engine: one mutation for all four approvable kinds ─────────────────

type Decision = 'approve' | 'reject'
type ActKind = 'leave' | 'regularisation' | 'compoff' | 'reimbursement'

const KIND_CFG: Record<ActKind, { path: (id: string) => string; rejectBody: (r: string) => object; requireReason?: boolean }> = {
  leave:          { path: (id) => `/leave-requests/${id}`,                rejectBody: (r) => ({ rejection_reason: r || undefined }) },
  regularisation: { path: (id) => `/attendance/regularisation/${id}`,     rejectBody: (r) => ({ rejection_reason: r || undefined }) },
  compoff:        { path: (id) => `/attendance/comp-off/${id}`,           rejectBody: (r) => ({ notes: r || undefined }) },
  reimbursement:  { path: (id) => `/payroll/reimbursements/claims/${id}`, rejectBody: (r) => ({ rejection_reason: r }), requireReason: true },
}

// ── A pending row with inline approve / reject ────────────────────────────────

function PendingRow({ title, meta, kind, id, busyId, onAct }: {
  title: string; meta: string; kind: ActKind; id: string
  busyId: string | null; onAct: (kind: ActKind, id: string, decision: Decision, reason?: string) => void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const busy = busyId === id
  const requireReason = !!KIND_CFG[kind].requireReason

  return (
    <div className="border-b border-border/40 py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{meta}</p>
        </div>
        {!rejecting && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAct(kind, id, 'approve')}
              className="h-7 gap-1 text-xs text-success hover:text-success">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}
              className="h-7 gap-1 text-xs text-destructive hover:text-destructive">
              <X className="h-3 w-3" />Reject
            </Button>
          </div>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={requireReason ? 'Reason (required)' : 'Reason (optional)'}
            className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/50"
          />
          <Button size="sm" variant="destructive" disabled={busy || (requireReason && !reason.trim())}
            onClick={() => { onAct(kind, id, 'reject', reason.trim()); setRejecting(false); setReason('') }}
            className="h-7 text-xs">Confirm reject</Button>
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => { setRejecting(false); setReason('') }} className="h-7 text-xs">Cancel</Button>
        </div>
      )}
    </div>
  )
}

// ── Awaiting Me tab ───────────────────────────────────────────────────────────

function AwaitingMe({ isHrAdmin }: { isHrAdmin: boolean }) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<PendingPayload>({
    queryKey: ['flowdesk-pending'],
    queryFn:  () => api.get('/approvals/pending?limit=20'),
    staleTime: 30_000,
  })
  const { data: compoffData } = useQuery<{ data: CompOffItem[] }>({
    queryKey: ['flowdesk-compoff'],
    queryFn:  () => api.get('/attendance/comp-off?status=pending'),
    enabled: isHrAdmin, staleTime: 30_000,
  })
  const { data: reimbData } = useQuery<{ data: ReimbItem[] }>({
    queryKey: ['flowdesk-reimb'],
    queryFn:  () => api.get('/payroll/reimbursements/claims?status=pending'),
    enabled: isHrAdmin, staleTime: 30_000,
  })

  const act = useMutation({
    mutationFn: ({ kind, id, decision, reason }: { kind: ActKind; id: string; decision: Decision; reason?: string }) => {
      const cfg = KIND_CFG[kind]
      return decision === 'approve'
        ? api.post(`${cfg.path(id)}/approve`, {})
        : api.post(`${cfg.path(id)}/reject`, cfg.rejectBody(reason ?? ''))
    },
    onSuccess: (_r, v) => {
      toast.success(v.decision === 'approve' ? 'Approved' : 'Rejected')
      qc.invalidateQueries({ queryKey: ['flowdesk-pending'] })
      qc.invalidateQueries({ queryKey: ['flowdesk-compoff'] })
      qc.invalidateQueries({ queryKey: ['flowdesk-reimb'] })
      // The Context Rail's pending-approvals badge reads kpis.pending_approvals
      // from this same shared key (EssHome / Arrival / MobileEssShell all use it).
      qc.invalidateQueries({ queryKey: ['ess-home'] })
      // The requesting employee's own "My Approvals" tracker (EssApprovals.tsx)
      // reads the same leave/regularisation/reimbursement/comp-off records
      // under four separate keys.
      qc.invalidateQueries({ queryKey: ['ess-approvals-leave'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-reimb'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-compoff'] })
    },
    onError: (e: Error) => toast.error('Action failed', { description: e.message }),
  })
  const busyId = act.isPending ? (act.variables?.id ?? null) : null
  const onAct = (kind: ActKind, id: string, decision: Decision, reason?: string) => act.mutate({ kind, id, decision, reason })

  const leaves = data?.leave_requests ?? []
  const regs   = data?.regularisations ?? []
  const compoffs = compoffData?.data ?? []
  const reimbs   = reimbData?.data ?? []
  const total = leaves.length + regs.length + compoffs.length + reimbs.length

  if (isLoading) {
    return <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading approvals…</div>
  }
  if (total === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        <span>Nothing is waiting on your approval.</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{total}</strong> item{total !== 1 ? 's' : ''} awaiting your action
        </p>
        <Link to="/manager/approvals">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">Full inbox <ArrowRight className="h-3 w-3" /></Button>
        </Link>
      </div>

      <SectionCard title={`Leave requests (${leaves.length})`} icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}>
        {leaves.length === 0 ? <p className="py-3 text-xs text-muted-foreground">No pending leave to approve.</p> : (
          <div className="space-y-0">
            {leaves.map((r) => (
              <PendingRow key={r.id} kind="leave" id={r.id} busyId={busyId} onAct={onAct}
                title={`${who(r.employees)} · ${r.leave_types?.name ?? 'Leave'} — ${fmtDate(r.from_date)}${r.from_date !== r.to_date ? ` → ${fmtDate(r.to_date)}` : ''}`}
                meta={`${r.reason ? `"${r.reason}" · ` : ''}requested ${fmtDate(r.created_at)}`}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Attendance corrections (${regs.length})`} icon={<ClipboardEdit className="h-4 w-4 text-muted-foreground" />}>
        {regs.length === 0 ? <p className="py-3 text-xs text-muted-foreground">No pending corrections to approve.</p> : (
          <div className="space-y-0">
            {regs.map((r) => (
              <PendingRow key={r.id} kind="regularisation" id={r.id} busyId={busyId} onAct={onAct}
                title={`${who(r.employees)} · ${fmtDate(r.date)}`}
                meta={`${r.reason ? `${r.reason.slice(0, 60)} · ` : ''}requested ${fmtDate(r.created_at)}`}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {isHrAdmin && compoffs.length > 0 && (
        <SectionCard title={`Comp-off (${compoffs.length})`} icon={<CalendarPlus className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-0">
            {compoffs.map((r) => (
              <PendingRow key={r.id} kind="compoff" id={r.id} busyId={busyId} onAct={onAct}
                title={`${who(r.employees)} · ${r.leave_types?.name ?? 'Comp-off'}`}
                meta={`worked ${fmtDate(r.worked_date)}${r.days_to_credit ? ` · +${r.days_to_credit}d credit` : ''}`}
              />
            ))}
          </div>
        </SectionCard>
      )}

      {isHrAdmin && reimbs.length > 0 && (
        <SectionCard title={`Reimbursement claims (${reimbs.length})`} icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-0">
            {reimbs.map((r) => (
              <PendingRow key={r.id} kind="reimbursement" id={r.id} busyId={busyId} onAct={onAct}
                title={`${who(r.employees)} · ${r.reimbursement_categories?.name ?? 'Reimbursement'}`}
                meta={`${money(r.amount)}${r.claim_month ? ` · ${r.claim_month.slice(0, 7)}` : ''}`}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Raise a Request tab — inline leave form + deep-links ──────────────────────

const REQUESTS: { label: string; desc: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: 'Apply for Leave',       desc: 'Casual, sick, earned & comp-off', href: '/ess/leave/balance',  icon: CalendarCheck },
  { label: 'Regularize Attendance', desc: 'Fix a missed or wrong punch',      href: '/ess/attendance',     icon: ClipboardEdit },
  { label: 'Reimbursement Claim',   desc: 'Submit an expense claim',          href: '/ess/reimbursements', icon: CreditCard },
  { label: 'Loan or Advance',       desc: 'Request a salary advance / loan',  href: '/ess/loans',          icon: Wallet },
  { label: 'Work From Home',        desc: 'Request a remote-work day',        href: '/ess/wfh',            icon: Home },
  { label: 'Comp-Off',              desc: 'Claim credit for working off-day', href: '/ess/leave/balance',  icon: CalendarPlus },
  { label: 'Raise a Helpdesk Ticket', desc: 'IT / HR / payroll support',      href: '/ess/issues',         icon: LifeBuoy },
]

function RaiseRequest() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {REQUESTS.map((r) => {
        const Icon = r.icon
        return (
          <Link key={r.label} to={r.href}
            className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-sm font-medium text-foreground">{r.label}<ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" /></p>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.desc}</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EssFlowDesk() {
  const { profile } = useAuthStore()
  const isHrAdmin = ['hr_admin', 'super_admin'].includes(profile?.role ?? '')
  const isManager = isHrAdmin || profile?.role === 'manager'

  return (
    <PageContainer>
      <PageHeader title="FlowDesk" subtitle="Your tasks, approvals and requests — in one place" />

      <Tabs defaultValue={isManager ? 'awaiting' : 'requests'}>
        <TabsList>
          {isManager && <TabsTrigger value="awaiting" className="gap-1.5"><Inbox className="h-3.5 w-3.5" />Awaiting Me</TabsTrigger>}
          <TabsTrigger value="requests" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" />My Requests</TabsTrigger>
          <TabsTrigger value="raise" className="gap-1.5"><PlusCircle className="h-3.5 w-3.5" />Raise a Request</TabsTrigger>
        </TabsList>

        {isManager && <TabsContent value="awaiting" className="mt-4"><AwaitingMe isHrAdmin={isHrAdmin} /></TabsContent>}
        <TabsContent value="requests" className="mt-4"><EssApprovals embedded /></TabsContent>
        <TabsContent value="raise" className="mt-4"><RaiseRequest /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}
