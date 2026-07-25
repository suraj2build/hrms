import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Inbox, ArrowRight, Clock, CheckCircle2, Check, X, Loader2,
  CalendarCheck, ClipboardEdit, CreditCard, Wallet, Home, CalendarPlus, LifeBuoy,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'

interface LeaveApp { id: string; status: string; from_date?: string; leave_types?: { name: string } | null }
interface CorrectionReq { id: string; status: string; date?: string }
interface PendingEmployee { first_name?: string; last_name?: string }
interface PendingLeaveItem { id: string; from_date?: string; to_date?: string; reason?: string; leave_types?: { name?: string } | null; employees?: PendingEmployee }
interface PendingRegItem { id: string; date?: string; reason?: string; employees?: PendingEmployee }
interface PendingPayload { leave_requests?: PendingLeaveItem[]; regularisations?: PendingRegItem[] }
interface PendingOtItem { id: string; attendance_date?: string; status: string; employees?: PendingEmployee }
interface PendingCoItem { id: string; worked_date?: string; status: string; employee?: { name?: string } | null }

const isPending = (s: string) => s === 'pending'
const who = (e?: PendingEmployee) => (e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee' : 'Employee')

type Decision = 'approve' | 'reject'
type ActKind = 'leave' | 'regularisation' | 'overtime' | 'comp_off'

const ACT_PATH: Record<ActKind, string> = {
  leave:          '/leave-requests',
  regularisation: '/attendance/regularisation',
  overtime:       '/overtime/requests',
  comp_off:       '/attendance/comp-off',
}

const REQUESTS = (base: string) => [
  { label: 'Apply Leave',     icon: CalendarCheck, to: `${base}/leave/balance`, from: '#1A4D8F', c: '#15B8A6' },
  { label: 'Regularize',      icon: ClipboardEdit, to: `${base}/attendance`,    from: '#2E6FE6', c: '#5C9AFF' },
  { label: 'Reimbursement',   icon: CreditCard,    to: `${base}/reimbursements`, from: '#15B8A6', c: '#2DD4BF' },
  { label: 'Loan / Advance',  icon: Wallet,        to: `${base}/loans`,         from: '#1A8050', c: '#34B27B' },
  { label: 'Work From Home',  icon: Home,          to: `${base}/wfh`,           from: '#7C3AED', c: '#A78BFA' },
  { label: 'Comp-Off',        icon: CalendarPlus,  to: `${base}/leave/balance`, from: '#B07B18', c: '#D9A441' },
  { label: 'Helpdesk Ticket', icon: LifeBuoy,      to: `${base}/issues`,        from: '#1A4D8F', c: '#2E6FE6' },
]

export function MobileFlowDesk({ base }: { base: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const isManager = ['manager', 'hr_admin', 'super_admin'].includes(profile?.role ?? '')

  const { data: pending } = useQuery<PendingPayload>({
    queryKey: ['mobile-flowdesk-pending'],
    queryFn: () => api.get('/approvals/pending?limit=20'),
    enabled: isManager,
  })
  const { data: otData } = useQuery<{ data: PendingOtItem[] }>({
    queryKey: ['mobile-flowdesk-ot'],
    queryFn: () => api.get('/overtime/requests?status=PENDING&limit=20'),
    enabled: isManager,
  })
  const { data: coData } = useQuery<{ data: PendingCoItem[] }>({
    queryKey: ['mobile-flowdesk-co'],
    queryFn: () => api.get('/attendance/comp-off?status=pending'),
    enabled: isManager,
  })
  const leaves = pending?.leave_requests ?? []
  const regs = pending?.regularisations ?? []
  const ots = otData?.data ?? []
  const cos = coData?.data ?? []
  const awaiting = leaves.length + regs.length + ots.length + cos.length

  const act = useMutation({
    mutationFn: ({ kind, id, decision, reason }: { kind: ActKind; id: string; decision: Decision; reason?: string }) => {
      const path = `${ACT_PATH[kind]}/${id}`
      if (decision === 'approve') return api.post(`${path}/approve`, {})
      // Reject body differs by entity: comp-off uses `notes` (required); overtime &
      // the rest use `rejection_reason` (required for overtime, optional for leave/reg).
      const body = kind === 'comp_off' ? { notes: reason } : { rejection_reason: reason || undefined }
      return api.post(`${path}/reject`, body)
    },
    onSuccess: (_r, v) => {
      toast.success(v.decision === 'approve' ? 'Approved' : 'Rejected')
      qc.invalidateQueries({ queryKey: ['mobile-flowdesk-pending'] })
      qc.invalidateQueries({ queryKey: ['mobile-flowdesk-ot'] })
      qc.invalidateQueries({ queryKey: ['mobile-flowdesk-co'] })
    },
    onError: (e: Error) => toast.error('Action failed', { description: e.message }),
  })
  const busyId = act.isPending ? (act.variables?.id ?? null) : null
  const onAct = (kind: ActKind, id: string, decision: Decision, reason?: string) => act.mutate({ kind, id, decision, reason })

  // Canonical source is `leave_requests` (served by /leave/my-requests) — NOT
  // the legacy `leave_applications` behind /attendance/leave/my, where
  // submitted leave never appeared. leave_requests stores status UPPERCASE;
  // normalized to lowercase since isPending() above does an exact comparison.
  const { data: leaveData } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['mobile-flowdesk-leave', profile?.employee_id],
    queryFn: async () => {
      const res = await api.get('/leave/my-requests?limit=100') as { data: LeaveApp[] }
      return { data: (res.data ?? []).map(r => ({ ...r, status: String(r.status ?? '').toLowerCase() })) }
    },
    enabled: !!profile?.employee_id,
  })
  const { data: corrData } = useQuery<{ data: CorrectionReq[] }>({
    queryKey: ['mobile-flowdesk-corrections'], queryFn: () => api.get('/attendance/corrections/my?limit=50'),
  })
  const pendingLeave = (leaveData?.data ?? []).filter((l) => isPending(l.status))
  const pendingCorr = (corrData?.data ?? []).filter((c) => isPending(c.status))
  const myOpen = pendingLeave.length + pendingCorr.length

  return (
    <div className="space-y-4">
      <p className="px-1 text-lg font-extrabold tracking-tight text-[#0F172A]">FlowDesk</p>

      {/* Awaiting you — managers only, with inline approve/reject */}
      {isManager && (
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
              <Inbox className="h-3.5 w-3.5 text-[#1A4D8F]" /> Awaiting your approval{awaiting > 0 ? ` (${awaiting})` : ''}
            </span>
            <button onClick={() => navigate(`${base}/approvals`)} className="flex items-center gap-0.5 text-[10px] font-semibold text-[#1A4D8F]">
              Full inbox <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {awaiting === 0 ? (
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-xs text-muted-foreground shadow-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#1A8050]" /> Nothing waiting on your approval.
            </div>
          ) : (
            <div className="space-y-2">
              {leaves.map((r) => (
                <ApprovalRow key={r.id} kind="leave" id={r.id} busyId={busyId} onAct={onAct}
                  title={`${who(r.employees)} · ${r.leave_types?.name ?? 'Leave'}`}
                  sub={`${r.from_date?.slice(0, 10) ?? ''}${r.to_date && r.to_date !== r.from_date ? ` → ${r.to_date.slice(0, 10)}` : ''}`} />
              ))}
              {regs.map((r) => (
                <ApprovalRow key={r.id} kind="regularisation" id={r.id} busyId={busyId} onAct={onAct}
                  title={`${who(r.employees)} · Regularisation`} sub={r.date?.slice(0, 10) ?? ''} />
              ))}
              {ots.map((r) => (
                <ApprovalRow key={r.id} kind="overtime" id={r.id} busyId={busyId} onAct={onAct} reasonRequired
                  title={`${who(r.employees)} · Overtime`} sub={r.attendance_date?.slice(0, 10) ?? ''} />
              ))}
              {cos.map((r) => (
                <ApprovalRow key={r.id} kind="comp_off" id={r.id} busyId={busyId} onAct={onAct} reasonRequired
                  title={`${r.employee?.name ?? 'Employee'} · Comp-off`} sub={r.worked_date?.slice(0, 10) ?? ''} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Raise a request */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold text-[#0F172A]"><Inbox className="h-3.5 w-3.5 text-[#1A4D8F]" /> Raise a request</p>
        <div className="grid grid-cols-2 gap-3">
          {REQUESTS(base).map((r) => (
            <button key={r.label} onClick={() => navigate(r.to)} className="flex items-center gap-2.5 rounded-2xl bg-white p-3 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={glossy(r.from, r.c)}>
                <r.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground/80">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* My open requests */}
      <div>
        <p className="mb-2 px-1 text-xs font-bold text-[#0F172A]">My open requests</p>
        {myOpen === 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-xs text-muted-foreground shadow-sm">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#1A8050]" /> Nothing pending — you're all caught up.
          </div>
        ) : (
          <div className="space-y-2">
            {pendingLeave.map((l) => <OpenRow key={l.id} title={l.leave_types?.name ?? 'Leave'} sub={l.from_date?.slice(0, 10) ?? ''} />)}
            {pendingCorr.map((c) => <OpenRow key={c.id} title="Attendance regularisation" sub={c.date?.slice(0, 10) ?? ''} />)}
          </div>
        )}
      </div>
    </div>
  )
}

/** Pending team item with inline approve / reject (same endpoints as desktop). */
function ApprovalRow({ title, sub, kind, id, busyId, onAct, reasonRequired = false }: {
  title: string; sub: string; kind: ActKind; id: string
  busyId: string | null; onAct: (kind: ActKind, id: string, decision: Decision, reason?: string) => void
  reasonRequired?: boolean
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const busy = busyId === id
  const rejectBlocked = reasonRequired && !reason.trim()

  return (
    <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{title}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
        {!rejecting && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button aria-label="Approve" disabled={busy} onClick={() => onAct(kind, id, 'approve')}
              className="grid h-8 w-8 place-items-center rounded-lg text-white disabled:opacity-50" style={glossy('#1A8050', '#34B27B')}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
            <button aria-label="Reject" disabled={busy} onClick={() => setRejecting(true)}
              className="grid h-8 w-8 place-items-center rounded-lg bg-[#C93535]/10 text-[#C93535] disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex items-center gap-1.5">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonRequired ? 'Reason (required)' : 'Reason (optional)'}
            className="h-8 flex-1 rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs outline-none focus:border-[#1A4D8F]/50" />
          <button disabled={busy || rejectBlocked} onClick={() => { onAct(kind, id, 'reject', reason.trim()); setRejecting(false); setReason('') }}
            className="rounded-lg bg-[#C93535] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Reject</button>
          <button onClick={() => { setRejecting(false); setReason('') }} className="px-1.5 text-xs text-muted-foreground">Cancel</button>
        </div>
      )}
    </div>
  )
}

function OpenRow({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 shadow-sm">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">{title}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
      <span className="flex items-center gap-1 rounded-full bg-[#B07B18]/10 px-2 py-0.5 text-[10px] font-semibold text-[#B07B18]">
        <Clock className="h-3 w-3" /> Pending
      </span>
    </div>
  )
}
