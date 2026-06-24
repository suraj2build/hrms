import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Fingerprint, CalendarDays, Wallet, RefreshCw, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'

interface LeaveApp { id: string; status: string }
interface SlipSummary { slip_id: string; month: string; net_pay: number }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const todayStr = () => new Date().toLocaleDateString('en-CA')
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : null

export function MobileHome({ base }: { base: string }) {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const employeeId = profile?.employee_id ?? ''
  const today = todayStr()

  const quick = [
    { label: 'Attendance', icon: Fingerprint, from: '#2E6FE6', to: '#5C9AFF', to_path: `${base}/attendance` },
    { label: 'Leave', icon: CalendarDays, from: '#15B8A6', to: '#2DD4BF', to_path: `${base}/leave/balance` },
    { label: 'Payslip', icon: Wallet, from: '#7C3AED', to: '#A78BFA', to_path: `${base}/compensation` },
    { label: 'Regularize', icon: RefreshCw, from: '#B07B18', to: '#D9A441', to_path: `${base}/attendance` },
  ]

  const { data: att } = useQuery<{ logs: { check_in: string | null; check_out: string | null; date: string }[] }>({
    queryKey: ['mobile-home-att', employeeId, today],
    queryFn: () => api.get(`/attendance/${employeeId}?from=${today}&to=${today}`),
    enabled: !!employeeId, staleTime: 30_000,
  })
  const { data: leaveData } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['mobile-home-leave'], queryFn: () => api.get('/attendance/leave/my'),
  })
  const { data: slipData } = useQuery<{ data: SlipSummary[] }>({
    queryKey: ['mobile-home-slips'], queryFn: () => api.get('/payroll/my-slips'),
  })

  const todayLog = (att?.logs ?? []).find((l) => (l.check_in ?? l.check_out)?.slice(0, 10) === today)
  const inTime = fmtTime(todayLog?.check_in ?? null)
  const pendingLeave = (leaveData?.data ?? []).filter((l) => l.status === 'pending').length
  const latestSlip = slipData?.data?.[0]

  return (
    <div className="space-y-4">
      {/* Quick-access glossy tiles */}
      <div className="grid grid-cols-4 gap-2.5">
        {quick.map((q) => (
          <button key={q.label} onClick={() => navigate(q.to_path)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <span className="grid h-10 w-10 place-items-center rounded-2xl text-white" style={glossy(q.from, q.to)}>
              <q.icon className="h-4 w-4" />
            </span>
            <span className="text-[9px] font-semibold text-foreground/80">{q.label}</span>
          </button>
        ))}
      </div>

      {/* Today card */}
      <button onClick={() => navigate(`${base}/attendance`)} className="flex w-full items-center justify-between rounded-2xl bg-white p-4 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <div>
          <p className="text-[11px] text-muted-foreground">Today · In Time</p>
          <p className="text-2xl font-extrabold tracking-tight text-[#0F172A]">{inTime ?? '--:--'}</p>
          <p className="text-[10px] font-semibold text-[#1A8050]">{inTime ? 'Checked in ✓' : 'Tap to punch in'}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </button>

      {/* Pending + payslip teasers */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate(`${base}/approvals`)} className="rounded-2xl bg-white p-4 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
          <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-extrabold text-white" style={glossy('#1A8050', '#34B27B')}>{pendingLeave}</span>
          <p className="mt-2 text-[11px] font-semibold text-foreground/80">Pending leave</p>
          <p className="text-[10px] text-muted-foreground">View approvals</p>
        </button>
        <button onClick={() => navigate(`${base}/compensation`)} className="rounded-2xl bg-white p-4 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
          <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={glossy('#7C3AED', '#A78BFA')}><Wallet className="h-4 w-4" /></span>
          <p className="mt-2 text-[11px] font-semibold text-foreground/80">{latestSlip ? inr(latestSlip.net_pay) : 'Payslip'}</p>
          <p className="text-[10px] text-muted-foreground">Latest net pay</p>
        </button>
      </div>
    </div>
  )
}
