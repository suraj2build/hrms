import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Fingerprint, CalendarDays, Wallet, RefreshCw, ChevronRight,
  FileText, Receipt, Home as HomeIcon, BookOpen, Award, MessageCircle, Megaphone,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'
import { UpcomingHolidays } from './parts'

interface LeaveApp { id: string; status: string }
interface SlipSummary { slip_id: string; month: string; net_pay: number }
interface BalanceRow { leave_type_id: string; balance: number }
interface RecognitionMe { received: number; given: number; points: number; recent: { message: string; from_name?: string }[] }
interface CommunityPost { id: string; author_name?: string | null; type: string; title?: string | null; body: string; created_at: string }

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
  const shortcuts = [
    { label: 'Documents', icon: FileText, to: `${base}/documents` },
    { label: 'Claims', icon: Receipt, to: `${base}/reimbursements` },
    { label: 'WFH', icon: HomeIcon, to: `${base}/wfh` },
    { label: 'Policies', icon: BookOpen, to: `${base}/policies` },
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
  const { data: balData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['mobile-home-balance', employeeId],
    queryFn: () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled: !!employeeId,
  })
  const { data: recogData } = useQuery<{ data: RecognitionMe }>({
    queryKey: ['mobile-home-recognition'], queryFn: () => api.get('/recognition/me'),
  })
  const { data: communityData } = useQuery<{ data: CommunityPost[] }>({
    queryKey: ['mobile-home-community'], queryFn: () => api.get('/community/feed?limit=4'),
  })

  const todayLog = (att?.logs ?? []).find((l) => (l.check_in ?? l.check_out)?.slice(0, 10) === today)
  const inTime = fmtTime(todayLog?.check_in ?? null)
  const pendingLeave = (leaveData?.data ?? []).filter((l) => l.status === 'pending').length
  const latestSlip = slipData?.data?.[0]
  const leaveTotal = (balData?.data ?? []).reduce((s, r) => s + (r.balance ?? 0), 0)
  const recog = recogData?.data
  const communityPosts = (communityData?.data ?? []).slice(0, 3)

  return (
    <div className="space-y-4">
      {/* Quick-access glossy tiles */}
      <div className="grid grid-cols-4 gap-2.5">
        {quick.map((q) => (
          <button key={q.label} onClick={() => navigate(q.to_path)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)] active:scale-95 transition-transform">
            <span className="grid h-10 w-10 place-items-center rounded-2xl text-white" style={glossy(q.from, q.to)}>
              <q.icon className="h-4 w-4" />
            </span>
            <span className="text-[9px] font-semibold text-foreground/80">{q.label}</span>
          </button>
        ))}
      </div>

      {/* Today card */}
      <button onClick={() => navigate(`${base}/attendance`)} className="flex w-full items-center justify-between rounded-2xl bg-white p-4 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)] active:scale-[0.99] transition-transform">
        <div>
          <p className="text-[11px] text-muted-foreground">Today · In Time</p>
          <p className="text-2xl font-extrabold tracking-tight text-[#0F172A]">{inTime ?? '--:--'}</p>
          <p className="text-[10px] font-semibold text-[#1A8050]">{inTime ? 'Checked in ✓' : 'Tap to punch in'}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </button>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat value={String(leaveTotal)} label="Leave bal." tint="#15B8A6" onClick={() => navigate(`${base}/leave/balance`)} />
        <Stat value={String(pendingLeave)} label="Pending" tint="#1A8050" onClick={() => navigate(`${base}/approvals`)} />
        <Stat value={latestSlip ? inr(latestSlip.net_pay) : '—'} label="Net pay" tint="#7C3AED" small onClick={() => navigate(`${base}/compensation`)} />
      </div>

      {/* Shortcuts */}
      <div>
        <p className="mb-2 px-1 text-xs font-bold text-[#0F172A]">Shortcuts</p>
        <div className="grid grid-cols-4 gap-2.5">
          {shortcuts.map((s) => (
            <button key={s.label} onClick={() => navigate(s.to)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2.5 shadow-sm active:scale-95 transition-transform">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#2E6FE6]/10 text-[#2E6FE6]">
                <s.icon className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-medium text-foreground/70">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recognition teaser */}
      <button onClick={() => navigate(`${base}/recognition`)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)] active:scale-[0.99] transition-transform">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={glossy('#7C3AED', '#A78BFA')}><Award className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-foreground">
            {recog && recog.received > 0 ? `You were recognized ${recog.received}×` : 'Recognition'}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {recog?.recent?.[0]?.message ?? 'Appreciate a colleague today'}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Community teaser */}
      <div>
        <button onClick={() => navigate(`${base}/community`)} className="mb-2 flex w-full items-center justify-between px-1">
          <span className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]"><MessageCircle className="h-3.5 w-3.5 text-[#2E6FE6]" /> Community</span>
          <span className="text-[11px] font-semibold text-[#2E6FE6]">View all</span>
        </button>
        {communityPosts.length === 0 ? (
          <button onClick={() => navigate(`${base}/community`)} className="w-full rounded-2xl bg-white px-3 py-4 text-center text-[11px] text-muted-foreground shadow-sm">
            No posts yet — share an update.
          </button>
        ) : (
          <div className="space-y-2">
            {communityPosts.map((p) => {
              const isAnn = p.type === 'announcement'
              const initials = (p.author_name ?? '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase()
              return (
                <button key={p.id} onClick={() => navigate(`${base}/community`)} className="flex w-full items-start gap-2.5 rounded-2xl bg-white p-3 text-left shadow-sm active:scale-[0.99] transition-transform">
                  {isAnn ? (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white" style={glossy('#7C3AED', '#A78BFA')}><Megaphone className="h-4 w-4" /></span>
                  ) : (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={glossy('#1A4D8F', '#2E6FE6')}>{initials}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-bold text-foreground">{p.author_name ?? 'Someone'}</p>
                    <p className="line-clamp-2 text-[11px] text-foreground/75">{p.title ?? p.body}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <UpcomingHolidays limit={3} />
    </div>
  )
}

function Stat({ value, label, tint, small, onClick }: { value: string; label: string; tint: string; small?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-white p-3 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)] active:scale-95 transition-transform">
      <span className="block h-1.5 w-6 rounded-full" style={{ background: tint }} />
      <p className={`mt-2 font-extrabold tracking-tight text-[#0F172A] ${small ? 'text-sm' : 'text-xl'}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </button>
  )
}
