import { useQuery } from '@tanstack/react-query'
import { CalendarDays, RefreshCw, Clock } from 'lucide-react'
import { api } from '@/lib/api/client'
import { glossy } from '../glossy'

interface LeaveApp { id: string; status: string; from_date?: string; leave_types?: { name: string } | null }
interface CorrectionReq { id: string; status: string; date?: string }

const isPending = (s: string) => s === 'pending'

export function MobileApprovals({ base: _base }: { base: string }) {
  // Canonical source is `leave_requests` (served by /leave/my-requests) — NOT
  // the legacy `leave_applications` behind /attendance/leave/my, where
  // submitted leave never appeared. leave_requests stores status UPPERCASE;
  // normalized to lowercase since isPending() above does an exact comparison.
  const { data: leaveData } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['mobile-approvals-leave'],
    queryFn: async () => {
      const res = await api.get('/leave/my-requests?limit=100') as { data: LeaveApp[] }
      return { data: (res.data ?? []).map(r => ({ ...r, status: String(r.status ?? '').toLowerCase() })) }
    },
  })
  const { data: corrData } = useQuery<{ data: CorrectionReq[] }>({
    queryKey: ['mobile-approvals-corrections'],
    queryFn: () => api.get('/attendance/corrections/my?limit=50'),
  })

  const pendingLeave = (leaveData?.data ?? []).filter((l) => isPending(l.status))
  const pendingCorr = (corrData?.data ?? []).filter((c) => isPending(c.status))
  const total = pendingLeave.length + pendingCorr.length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-2xl bg-white p-4 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <span className="grid h-12 w-12 mx-auto place-items-center rounded-2xl text-lg font-extrabold text-white" style={glossy('#2E6FE6', '#15B8A6')}>
          {total}
        </span>
        <p className="mt-2 text-sm font-bold text-[#0F172A]">Requests awaiting approval</p>
        <p className="text-[11px] text-muted-foreground">Track everything you've submitted</p>
      </div>

      <Section icon={CalendarDays} tint="#1A8050" title="Leave requests" empty="No pending leave">
        {pendingLeave.map((l) => (
          <Row key={l.id} title={l.leave_types?.name ?? 'Leave'} sub={l.from_date?.slice(0, 10) ?? ''} />
        ))}
      </Section>

      <Section icon={RefreshCw} tint="#B07B18" title="Regularisations" empty="No pending regularisations">
        {pendingCorr.map((c) => (
          <Row key={c.id} title="Attendance regularisation" sub={c.date?.slice(0, 10) ?? ''} />
        ))}
      </Section>
    </div>
  )
}

function Section({ icon: Icon, tint, title, empty, children }: {
  icon: React.ComponentType<{ className?: string }>; tint: string; title: string; empty: string; children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  const has = items.filter(Boolean).length > 0
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 px-1 text-xs font-bold text-[#0F172A]">
        <span className="grid h-6 w-6 place-items-center rounded-lg text-white" style={glossy(tint, `${tint}cc`)}><Icon className="h-3.5 w-3.5" /></span>
        {title}
      </p>
      <div className="space-y-2">
        {has ? children : <p className="rounded-xl bg-white px-3 py-3 text-center text-xs text-muted-foreground shadow-sm">{empty}</p>}
      </div>
    </div>
  )
}

function Row({ title, sub }: { title: string; sub: string }) {
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
