import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Inbox, ArrowRight, Clock, CheckCircle2,
  CalendarCheck, ClipboardEdit, CreditCard, Wallet, Home, CalendarPlus, LifeBuoy,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'

interface LeaveApp { id: string; status: string; from_date?: string; leave_types?: { name: string } | null }
interface CorrectionReq { id: string; status: string; date?: string }
interface PendingPayload { leave_requests?: { id: string }[]; regularisations?: { id: string }[] }

const isPending = (s: string) => s === 'pending'

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
  const { profile } = useAuthStore()
  const isManager = ['manager', 'hr_admin', 'super_admin'].includes(profile?.role ?? '')

  const { data: pending } = useQuery<PendingPayload>({
    queryKey: ['mobile-flowdesk-pending'],
    queryFn: () => api.get('/approvals/pending?limit=20'),
    enabled: isManager,
  })
  const awaiting = (pending?.leave_requests?.length ?? 0) + (pending?.regularisations?.length ?? 0)

  const { data: leaveData } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['mobile-flowdesk-leave'], queryFn: () => api.get('/attendance/leave/my'),
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

      {/* Awaiting you — managers only */}
      {isManager && (
        <button onClick={() => navigate(`${base}/approvals`)}
          className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg font-extrabold text-white" style={glossy('#1A4D8F', '#15B8A6')}>
            {awaiting}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-[#0F172A]">Awaiting your approval</span>
            <span className="block text-[11px] text-muted-foreground">Leave & attendance from your team</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
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
