import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'
import { UpcomingHolidays } from './parts'

interface BalanceRow { leave_type_id: string; balance: number; leave_types: { name: string } }
interface LeaveApp {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  from_date?: string
  to_date?: string
  leave_types?: { name: string } | null
  days?: number
}

const TILE_COLORS = [
  ['#2E6FE6', '#5C9AFF'], ['#1A8050', '#34B27B'], ['#B07B18', '#D9A441'], ['#7C3AED', '#A78BFA'],
]

const STATUS_TONE: Record<string, string> = {
  approved: 'text-[#1A8050] bg-[#1A8050]/10',
  pending: 'text-[#B07B18] bg-[#B07B18]/10',
  rejected: 'text-destructive bg-destructive/10',
  withdrawn: 'text-muted-foreground bg-muted',
}

export function MobileLeave({ base }: { base: string }) {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const employeeId = profile?.employee_id ?? ''

  const { data: balData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['mobile-leave-balance', employeeId],
    queryFn: () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled: !!employeeId,
  })
  const { data: histData } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['mobile-leave-history'],
    queryFn: () => api.get('/attendance/leave/my'),
  })

  const balances = balData?.data ?? []
  const history = (histData?.data ?? []).slice(0, 6)

  return (
    <div className="space-y-4">
      {/* Balance tiles */}
      <div className="grid grid-cols-2 gap-3">
        {balances.length === 0 && (
          <p className="col-span-2 rounded-2xl bg-white px-3 py-5 text-center text-xs text-muted-foreground shadow-sm">No leave balances yet.</p>
        )}
        {balances.map((b, i) => {
          const [from, to] = TILE_COLORS[i % TILE_COLORS.length]
          return (
            <div key={b.leave_type_id} className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
              <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-extrabold text-white" style={glossy(from, to)}>
                {b.balance}
              </span>
              <p className="mt-2 text-[11px] font-semibold text-foreground/80">{b.leave_types?.name ?? 'Leave'}</p>
              <p className="text-[10px] text-muted-foreground">days available</p>
            </div>
          )
        })}
      </div>

      {/* Apply CTA */}
      <button
        onClick={() => navigate(`${base}/leave/balance`)}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white"
        style={glossy('#1A4D8F', '#15B8A6')}
      >
        <Plus className="h-4 w-4" /> Apply for leave
      </button>

      {/* Recent applications */}
      <div>
        <p className="px-1 text-xs font-bold text-[#0F172A]">Recent requests</p>
        <div className="mt-2 space-y-2">
          {history.length === 0 && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">No leave requests yet.</p>}
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 shadow-sm">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{h.leave_types?.name ?? 'Leave'}</p>
                <p className="text-[10px] text-muted-foreground">
                  {h.from_date?.slice(0, 10) ?? ''}{h.to_date && h.to_date !== h.from_date ? ` → ${h.to_date.slice(0, 10)}` : ''}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_TONE[h.status] ?? 'bg-muted text-muted-foreground'}`}>
                {h.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <UpcomingHolidays limit={3} />
    </div>
  )
}
