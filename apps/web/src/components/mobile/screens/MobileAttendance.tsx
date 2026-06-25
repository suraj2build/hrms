import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Camera, LogIn, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'

interface LogEntry { check_in: string | null; check_out: string | null; date: string }
interface DailyRecord { date: string; status: string }
interface AttendanceResponse { daily: DailyRecord[]; logs: LogEntry[] }

const todayStr = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local tz
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

function weekRange() {
  const now = new Date()
  const day = (now.getDay() + 6) % 7 // Mon=0
  const mon = new Date(now); mon.setDate(now.getDate() - day)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('en-CA')
  return { from: f(mon), to: f(sun) }
}

export function MobileAttendance({ base: _base }: { base: string }) {
  const { profile } = useAuthStore()
  const employeeId = profile?.employee_id ?? ''
  const qc = useQueryClient()
  const today = todayStr()
  const wk = weekRange()

  const { data } = useQuery<AttendanceResponse>({
    queryKey: ['mobile-attendance', employeeId, today],
    queryFn: () => api.get<AttendanceResponse>(`/attendance/${employeeId}?from=${today}&to=${today}`),
    enabled: !!employeeId,
    staleTime: 30_000,
  })

  const { data: weekData } = useQuery<AttendanceResponse>({
    queryKey: ['mobile-attendance-week', employeeId, wk.from],
    queryFn: () => api.get<AttendanceResponse>(`/attendance/${employeeId}?from=${wk.from}&to=${wk.to}`),
    enabled: !!employeeId,
    staleTime: 60_000,
  })

  const week = useMemo(() => {
    const daily = weekData?.daily ?? []
    const present = daily.filter((d) => d.status === 'present' || d.status === 'late').length
    const late = daily.filter((d) => d.status === 'late').length
    const absent = daily.filter((d) => d.status === 'absent' || d.status === 'lop').length
    return { present, late, absent }
  }, [weekData])

  const logs = useMemo(() => data?.logs ?? [], [data])
  const todayLog = logs.find((l) => (l.check_in ?? l.check_out)?.slice(0, 10) === today)
  const checkedIn = !!todayLog?.check_in && !todayLog?.check_out
  const inTime = todayLog?.check_in ? fmtTime(todayLog.check_in) : null

  const { mutate: punch, isPending } = useMutation({
    mutationFn: (direction: 'IN' | 'OUT') =>
      api.post<{ data: { punched_at: string } }>('/attendance/punch', { direction, source: 'mobile' }),
    onSuccess: (_r, dir) => {
      toast.success(dir === 'IN' ? 'Punched in' : 'Punched out')
      qc.invalidateQueries({ queryKey: ['mobile-attendance', employeeId, today] })
    },
    onError: (e: Error) => toast.error('Punch failed', { description: e.message }),
  })

  return (
    <div className="space-y-3">
      {/* GPS card */}
      <div className="relative overflow-hidden rounded-2xl shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]" style={{ height: 110, background: 'linear-gradient(135deg,#DCE8FF,#EAF2FF)' }}>
        <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'linear-gradient(#9DBDF5 1px,transparent 1px),linear-gradient(90deg,#9DBDF5 1px,transparent 1px)', backgroundSize: '24px 24px' }} />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="grid h-10 w-10 place-items-center rounded-full text-white" style={glossy('#2E6FE6', '#15B8A6')}><MapPin className="h-5 w-5" /></span>
        </span>
        <span className="absolute bottom-2.5 left-2.5 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-semibold text-[#1A4D8F]">Location captured</span>
      </div>

      {/* Punch card */}
      <div className="rounded-2xl bg-white p-5 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <p className="text-xs text-muted-foreground">{checkedIn ? 'Checked in at' : 'Today'}</p>
        <p className="text-4xl font-extrabold tracking-tight text-[#0F172A]">{inTime ?? '--:--'}</p>
        <p className="mt-1 text-[11px] font-semibold text-[#1A8050]">{checkedIn ? 'You are checked in ✓' : 'Not punched in yet'}</p>
        <button
          disabled={isPending}
          onClick={() => punch(checkedIn ? 'OUT' : 'IN')}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60"
          style={glossy(checkedIn ? '#B07B18' : '#1A4D8F', checkedIn ? '#D9A441' : '#15B8A6')}
        >
          {checkedIn ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {isPending ? 'Please wait…' : checkedIn ? 'Punch out' : 'Selfie punch in'}
          {!checkedIn && <Camera className="h-4 w-4 opacity-80" />}
        </button>
      </div>

      {/* This week summary */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { v: week.present, l: 'Present', tint: '#1A8050' },
          { v: week.late, l: 'Late', tint: '#B07B18' },
          { v: week.absent, l: 'Absent', tint: '#C93535' },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl bg-white p-3 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <p className="text-xl font-extrabold text-[#0F172A]">{s.v}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.tint }} />{s.l}
            </p>
          </div>
        ))}
      </div>
      <p className="-mb-1 px-1 text-[10px] text-muted-foreground">This week</p>

      {/* Recent */}
      <p className="px-1 pt-1 text-xs font-bold text-[#0F172A]">Today's punches</p>
      <div className="space-y-2">
        {logs.length === 0 && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">No punches yet today.</p>}
        {logs.map((l, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 shadow-sm">
            <span className="text-xs font-semibold text-foreground/80">Session {i + 1}</span>
            <span className="text-[11px] text-muted-foreground">{fmtTime(l.check_in)} → {fmtTime(l.check_out)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
