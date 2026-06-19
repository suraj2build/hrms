/**
 * EmployeeDashboard — ESS home (redesigned)
 *
 * Layout:
 *   1. ProfileBar       — full-width identity strip
 *   2. KPI row          — Attendance · Net Pay · Open Actions
 *   3. Two-column body  — (60%) CompStructure + MyRequests | (40%) LeaveUsage + Upcoming
 *   4. QuickActionsBar  — full-width 8-item shortcut rail
 */

import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useQuery }    from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ChevronRight, ArrowRight, Check,
  TrendingUp, TrendingDown, Calendar,
  Leaf, Wallet, RefreshCw, Scale, FolderOpen, FileText,
  Mail, CreditCard, AlertCircle, CalendarClock, ShieldCheck,
} from 'lucide-react'
import { useAuthStore }  from '@/stores/authStore'
import { api }           from '@/lib/api/client'
import { SignedImage }   from '@/components/SignedImage'
import type { Employee } from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Types ─────────────────────────────────────────────────────────────────────

type DayStatus = 'present' | 'absent' | 'late' | 'leave' | 'holiday' | 'off' | 'future'

// Enriched identity from /employees/:id/full-profile
interface DashFullProfile {
  employee: {
    first_name:    string
    last_name:     string
    employee_code: string
    joining_date:  string | null
  }
  personal_info: { profile_photo: string | null } | null
  job_info: {
    departments:    { name: string } | null
    designations:   { name: string } | null
    grades:         { name: string } | null
    work_locations: { name: string; city: string } | null
    manager:        { first_name: string; last_name: string } | null
  } | null
}

interface DayData {
  day: number; date: Date; dow: number
  status: DayStatus; inHr: string | null; outHr: string | null
  workedH: string | null; isFuture: boolean; isToday: boolean
}

interface AttendanceRecord {
  date: string; status: string; work_hours: number; late_minutes: number
}

interface AttendanceLog {
  id: string; check_in: string | null; check_out: string | null
}

interface AttendanceResp {
  summary: { total_days: number; present: number; absent: number; late: number; avg_hours: number }
  daily: AttendanceRecord[]
  logs:  AttendanceLog[]
}

interface LeaveRequest {
  id: string; from_date: string; to_date: string
  status: string; leave_types?: { name: string }; created_at?: string
}

interface RegRequest {
  id: string; date: string; status: string; created_at?: string
}

interface LeaveBalance {
  id: string; leave_type_id: string; balance: number; used?: number
  leave_types?: { name: string; is_paid: boolean; max_days?: number }
}

interface PayslipSummary {
  slip_id: string; month: string; net_pay: number; gross_pay: number
  total_deductions: number; credit_date?: string | null
}

interface ActiveComp {
  ctc_annual: number; ctc_monthly: number; effective_from?: string
  components?: Array<{
    code: string; name: string
    type: 'earning' | 'deduction' | 'employer_contribution'
    computed_monthly: number
  }>
}

interface Holiday {
  id: string; date: string; name: string; holiday_type?: string
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const CARD: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  boxShadow: '0 1px 0 rgba(15,16,36,.04),0 1px 2px rgba(15,16,36,.04)',
}

const CARD_HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 16px', borderBottom: '1px solid var(--border)',
}

const MONO: CSSProperties = { fontFamily: '"Geist Mono",ui-monospace,monospace' }

// ── Micro components ──────────────────────────────────────────────────────────

function CardLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: 'var(--muted-foreground)' }}>
      {children}
    </span>
  )
}

function LinkBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ color: 'var(--primary)', fontSize: 12.5, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
    >
      {children}
    </button>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(n: number | undefined | null): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) }
  catch { return '—' }
}

function isoDate(d: Date): string {
  const y  = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dd}`
}

function calcTenure(joining: string | null | undefined): string {
  if (!joining) return '—'
  try {
    const j = new Date(joining)
    const now = new Date()
    let yrs = now.getFullYear() - j.getFullYear()
    let mos = now.getMonth() - j.getMonth()
    if (mos < 0) { yrs--; mos += 12 }
    if (yrs === 0) return `${mos}m`
    if (mos === 0) return `${yrs}y`
    return `${yrs}y ${mos}m`
  } catch { return '—' }
}

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return ''
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  } catch { return '' }
}

function buildMonthData(
  year: number, month: number, today: Date,
  records: AttendanceRecord[], logs: AttendanceLog[],
): DayData[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const recMap = new Map(records.map(r => [r.date, r]))
  const logMap = new Map<string, AttendanceLog>()
  for (const l of logs) {
    if (!l.check_in) continue
    const d = l.check_in.slice(0, 10)
    if (!logMap.has(d)) logMap.set(d, l)
  }
  const todayStr = isoDate(today)
  const out: DayData[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(year, month, d)
    const dow     = (date.getDay() + 6) % 7
    const weekend = dow >= 5
    const dateStr = isoDate(date)
    const isFuture = date > today
    const isToday  = dateStr === todayStr
    const rec = recMap.get(dateStr)
    const log = logMap.get(dateStr)
    let status: DayStatus = 'future'
    let inHr: string | null = null, outHr: string | null = null, workedH: string | null = null
    if (weekend && !rec) {
      status = 'off'
    } else if (isFuture && !rec) {
      status = 'future'
    } else if (rec) {
      const s = rec.status?.toLowerCase()
      if      (s === 'present')                   status = 'present'
      else if (s === 'late')                      status = 'late'
      else if (s === 'absent')                    status = 'absent'
      else if (s === 'on_leave' || s === 'leave') status = 'leave'
      else if (s === 'holiday')                   status = 'holiday'
      else if (s === 'off' || s === 'weekly_off') status = 'off'
      else                                        status = 'present'
      if (rec.work_hours > 0) workedH = rec.work_hours.toFixed(1)
      if (log?.check_in)  inHr  = fmtTime(log.check_in)
      if (log?.check_out) outHr = fmtTime(log.check_out)
    } else if (!isFuture && !weekend) {
      status = 'absent'
    }
    out.push({ day: d, date, dow, status, inHr, outHr, workedH, isFuture, isToday })
  }
  return out
}

// ── 1. ProfileBar ─────────────────────────────────────────────────────────────

function ProfileBar({ emp, profile: fp }: { emp: Employee | null; profile?: DashFullProfile }) {
  const { profile } = useAuthStore()
  const pEmp = fp?.employee
  const job  = fp?.job_info

  const name     = pEmp ? `${pEmp.first_name} ${pEmp.last_name}`
                 : emp ? `${emp.first_name} ${emp.last_name}`
                 : (profile?.full_name ?? 'Employee')
  const initials = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
  const photo    = fp?.personal_info?.profile_photo ?? null
  const designation = job?.designations?.name ?? null
  const dept     = job?.departments?.name ?? (emp as any)?.department?.name ?? '—'
  const grade    = job?.grades?.name ?? null
  const manager  = job?.manager ? `${job.manager.first_name} ${job.manager.last_name}`
                 : emp?.manager ? `${emp.manager.first_name} ${emp.manager.last_name}` : '—'
  const location = job?.work_locations?.name ?? (emp as any)?.work_location?.name ?? '—'
  const empCode  = pEmp?.employee_code ?? emp?.employee_code ?? '—'
  const joiningDate = pEmp?.joining_date ?? (emp as any)?.joining_date
  const tenure   = calcTenure(joiningDate)
  const joinedStr   = (() => {
    if (!joiningDate) return null
    const d = new Date(joiningDate.length === 10 ? joiningDate + 'T12:00:00Z' : joiningDate)
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (isNaN(d.getTime())) return null
    return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
  })()

  const AVATAR = 60
  return (
    <section style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 18, padding: '16px 22px' }}>
      {/* Avatar — master photo, initials fallback */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: AVATAR, height: AVATAR, borderRadius: 16, overflow: 'hidden',
          background: 'radial-gradient(circle at 30% 25%,#cfe0f4 0%,transparent 55%),linear-gradient(135deg,var(--primary),var(--info) 75%,#3b82c4)',
          color: '#fff', display: 'grid', placeItems: 'center',
          fontSize: 22, fontWeight: 800, letterSpacing: '-.02em',
          boxShadow: '0 10px 22px -10px rgba(26,77,143,.6)',
          outline: '3px solid var(--card)',
        }}>
          <SignedImage
            path={photo}
            alt={name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fallback={<span>{initials}</span>}
          />
        </div>
        <span style={{
          position: 'absolute', right: -2, bottom: -2,
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--success)', border: '3px solid var(--card)',
          display: 'grid', placeItems: 'center',
        }}>
          <Check style={{ width: 9, height: 9, strokeWidth: 3.5, color: '#fff' }} />
        </span>
      </div>

      {/* Name + meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-.02em', lineHeight: 1.1 }}>
            {name}
          </span>
          {grade && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' as const,
              background: 'color-mix(in srgb, var(--success) 12%, var(--card))', color: 'var(--success)',
              border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
              padding: '2px 8px', borderRadius: 999,
            }}>
              {grade}
            </span>
          )}
        </div>
        {designation && (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', letterSpacing: '-.005em' }}>
            {designation}
          </span>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '2px 18px', marginTop: 1 }}>
          {[
            { k: 'ID', v: empCode, mono: true },
            { k: 'Dept', v: dept },
            { k: 'Reports to', v: manager },
            { k: 'Location', v: location },
          ].map(f => (
            <span key={f.k} style={{ fontSize: 11.5, color: 'var(--muted-foreground)' }}>
              <span style={{ fontWeight: 600, color: 'var(--muted-foreground)', marginRight: 3 }}>{f.k}</span>
              <span style={{ color: 'var(--foreground)', fontWeight: 600, ...(f.mono ? MONO : {}) }}>
                {f.v}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Tenure */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: 'var(--muted-foreground)' }}>
          Tenure
        </span>
        <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-.02em', lineHeight: 1.1, ...MONO }}>
          {tenure}
        </span>
        {joinedStr && (
          <span style={{ fontSize: 10.5, color: 'var(--muted-foreground)', marginTop: 2 }}>Joined {joinedStr}</span>
        )}
      </div>
    </section>
  )
}

// ── 2. KPI cards ─────────────────────────────────────────────────────────────

function AttKpiCard({ data, navigate }: { data: DayData[]; navigate: (to: string) => void }) {
  const stats = useMemo(() => {
    const upTo = data.filter(d => !d.isFuture)
    let total = 0, present = 0, late = 0
    for (const d of upTo) {
      if (d.status === 'off' || d.status === 'holiday') continue
      total++
      if (d.status === 'present' || d.status === 'late') present++
      if (d.status === 'late') late++
    }
    return { rate: total ? Math.round((present / total) * 100) : 0, present, total, late }
  }, [data])

  return (
    <section style={{ ...CARD, flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', overflow: 'hidden', borderTop: '3px solid var(--primary)', borderRadius: 12 }}>
      {/* 3px top accent bar — green for attendance */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#10b981' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardLabel>Attendance</CardLabel>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--tint-green-bg)', display: 'grid', placeItems: 'center' }}>
          <Check style={{ width: 12, height: 12, color: '#10b981' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--foreground)', letterSpacing: '-.03em', lineHeight: 1 }}>
          {stats.rate}%
        </div>
        <div style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 3 }}>
          <TrendingUp style={{ width: 11, height: 11 }} />
          This month
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, borderRadius: 7, background: 'var(--muted)', padding: '5px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', ...MONO }}>{stats.present}/{stats.total}</div>
          <div style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 1 }}>Days present</div>
        </div>
        <div style={{ flex: 1, borderRadius: 7, background: 'var(--muted)', padding: '5px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: stats.late > 0 ? '#f59e0b' : 'var(--foreground)', ...MONO }}>{stats.late}</div>
          <div style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 1 }}>Late arrivals</div>
        </div>
      </div>

      <LinkBtn onClick={() => navigate('/ess/attendance')}>
        Full view <ChevronRight style={{ width: 11, height: 11 }} />
      </LinkBtn>
    </section>
  )
}

function NetPayKpiCard({ slips, navigate }: { slips: PayslipSummary[]; navigate: (to: string) => void }) {
  const latest = slips[0]
  const prev   = slips[1]
  const delta  = latest && prev ? latest.net_pay - prev.net_pay : null
  const creditDate = (() => {
    if (!latest?.credit_date) return null
    const s = latest.credit_date
    const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (isNaN(d.getTime())) return null
    return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
  })()
  const monthLabel = latest?.month
    ? MONTHS_SHORT[parseInt(latest.month.slice(5, 7)) - 1]
    : null

  return (
    <section style={{ ...CARD, flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', overflow: 'hidden', borderTop: '3px solid var(--primary)', borderRadius: 12 }}>
      {/* 3px top accent bar — amber for pay */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#f59e0b' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardLabel>Net Pay</CardLabel>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--tint-amber-bg)', display: 'grid', placeItems: 'center' }}>
          <Wallet style={{ width: 12, height: 12, color: '#f59e0b' }} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', letterSpacing: '-.02em', lineHeight: 1, ...MONO }}>
          {latest ? fmtINR(latest.net_pay) : '—'}
        </div>
        {delta !== null ? (
          <div style={{ fontSize: 11, color: delta >= 0 ? '#10b981' : '#f43f5e', marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
            {delta >= 0
              ? <TrendingUp style={{ width: 11, height: 11 }} />
              : <TrendingDown style={{ width: 11, height: 11 }} />
            }
            {delta >= 0 ? '+' : ''}{fmtINR(Math.abs(delta))} vs prev
          </div>
        ) : monthLabel ? (
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>{monthLabel} payslip</div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>No payslip yet</div>
        )}
      </div>

      {creditDate && (
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)', background: 'var(--muted)', borderRadius: 7, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar style={{ width: 10, height: 10 }} />
          Credited {creditDate}
        </div>
      )}

      <LinkBtn onClick={() => navigate('/ess/compensation')}>
        View payslips <ChevronRight style={{ width: 11, height: 11 }} />
      </LinkBtn>
    </section>
  )
}

function OpenActionsKpiCard({
  requests, regRequests, navigate,
}: {
  requests: LeaveRequest[]; regRequests: RegRequest[]; navigate: (to: string) => void
}) {
  const { total, awaitingInput } = useMemo(() => {
    let total = 0, awaitingInput = 0
    for (const r of [...requests, ...regRequests]) {
      const s = (r as any).status?.toLowerCase()
      if (s === 'pending') { total++; awaitingInput++ }
    }
    return { total, awaitingInput }
  }, [requests, regRequests])

  return (
    <section style={{ ...CARD, flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', overflow: 'hidden', borderTop: '3px solid var(--primary)', borderRadius: 12 }}>
      {/* 3px top accent bar — amber if actions pending, muted if none */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: total > 0 ? '#f59e0b' : 'var(--border)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardLabel>Open Actions</CardLabel>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: total > 0 ? 'var(--tint-amber-bg)' : 'var(--muted)', display: 'grid', placeItems: 'center' }}>
          <AlertCircle style={{ width: 12, height: 12, color: total > 0 ? '#f59e0b' : 'var(--muted-foreground)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: total > 0 ? '#f59e0b' : 'var(--foreground)', letterSpacing: '-.03em', lineHeight: 1, ...MONO }}>
          {total}
        </div>
        <div style={{ fontSize: 11, color: total > 0 ? 'var(--tint-amber-fg)' : 'var(--muted-foreground)' }}>
          {awaitingInput > 0 ? `${awaitingInput} awaiting input` : 'All clear'}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
        {total > 0 ? 'Items need your attention' : 'No pending actions'}
      </div>

      <LinkBtn onClick={() => navigate('/ess/approvals')}>
        View all <ChevronRight style={{ width: 11, height: 11 }} />
      </LinkBtn>
    </section>
  )
}

// ── 3a. CompStructure ─────────────────────────────────────────────────────────

function CompStructure({
  comp, latestSlip, navigate,
}: {
  comp: ActiveComp | null; latestSlip: PayslipSummary | null; navigate: (to: string) => void
}) {
  const components  = comp?.components ?? []
  const earnings    = components.filter(c => c.type === 'earning')
  const deductions  = components.filter(c => c.type === 'deduction')
  const maxEarning  = Math.max(...earnings.map(c => c.computed_monthly), 1)
  const effectiveFrom = (() => {
    if (!comp?.effective_from) return null
    const s = comp.effective_from
    const d = new Date(s.slice(0,7) + '-01T12:00:00Z')
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (isNaN(d.getTime())) return null
    return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
  })()

  return (
    <section style={CARD}>
      <div style={CARD_HEAD}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <CardLabel>Compensation Structure</CardLabel>
          {effectiveFrom && <span style={{ fontSize: 10.5, color: 'var(--muted-foreground)' }}>Revised {effectiveFrom}</span>}
        </div>
        <LinkBtn onClick={() => navigate('/ess/compensation')}>
          Details <ChevronRight style={{ width: 12, height: 12 }} />
        </LinkBtn>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {/* CTC summary — navy primary / success hierarchy, balanced tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 10, marginBottom: 14 }}>
          {[
            { k: 'Annual CTC',    v: fmtINR(comp?.ctc_annual),  tone: 'primary' as const },
            { k: 'Monthly CTC',   v: fmtINR(comp?.ctc_monthly), tone: 'neutral' as const },
            { k: 'Net Take-Home', v: latestSlip ? fmtINR(latestSlip.net_pay) : '—', tone: 'success' as const },
          ].map(m => {
            const tinted = m.tone !== 'neutral'
            const accent = m.tone === 'success' ? 'var(--success)' : 'var(--primary)'
            return (
              <div key={m.k} style={{
                borderRadius: 10, border: '1px solid var(--border)',
                borderTop: `2px solid ${tinted ? accent : 'var(--border)'}`,
                padding: '10px 12px',
                background: tinted
                  ? `color-mix(in srgb, ${accent} 6%, var(--card))`
                  : 'var(--card)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase' as const, letterSpacing: '.12em' }}>{m.k}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: tinted ? accent : 'var(--foreground)', ...MONO }}>
                  {m.v}
                </div>
              </div>
            )
          })}
        </div>

        {/* Earnings bars */}
        {earnings.length > 0 && (
          <>
            <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 7 }}>
              Earnings
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
              {earnings.slice(0, 4).map(c => (
                <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 100, flexShrink: 0, fontSize: 11.5, color: '#2b2d44', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {c.name}
                  </div>
                  <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--muted)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999,
                      background: 'linear-gradient(90deg, var(--primary), var(--info))',
                      width: `${Math.max(4, Math.round((c.computed_monthly / maxEarning) * 100))}%`,
                      transition: 'width .3s ease',
                    }} />
                  </div>
                  <div style={{ width: 68, textAlign: 'right' as const, fontSize: 11.5, fontWeight: 600, color: 'var(--foreground)', flexShrink: 0, ...MONO }}>
                    {fmtINR(c.computed_monthly)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Deduction pills */}
        {deductions.length > 0 && (
          <>
            <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 6 }}>
              Deductions
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
              {deductions.slice(0, 5).map(c => (
                <div key={c.code} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--card)', padding: '3px 8px',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{c.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--destructive)', ...MONO }}>
                    {fmtINR(c.computed_monthly)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Fallback */}
        {components.length === 0 && comp && (
          <div style={{ textAlign: 'center' as const, color: 'var(--muted-foreground)', fontSize: 13, paddingTop: 8 }}>
            Component breakdown not available
          </div>
        )}
        {!comp && (
          <div style={{ textAlign: 'center' as const, color: 'var(--muted-foreground)', fontSize: 13, padding: '16px 0' }}>
            No compensation data
          </div>
        )}
      </div>
    </section>
  )
}

// ── 3b. MyRequests ────────────────────────────────────────────────────────────

function MyRequests({
  requests, regRequests, navigate,
}: {
  requests: LeaveRequest[]; regRequests: RegRequest[]; navigate: (to: string) => void
}) {
  const { pending, approved, rejected } = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0
    for (const r of [...requests, ...regRequests]) {
      const s = (r as any).status?.toLowerCase()
      if (s === 'pending')  pending++
      if (s === 'approved') approved++
      if (s === 'rejected') rejected++
    }
    return { pending, approved, rejected }
  }, [requests, regRequests])

  const recentItems = useMemo(() => {
    const combined = [
      ...requests.map(r => ({
        id: r.id, type: 'Leave',
        detail: r.leave_types?.name ?? 'Leave request',
        status: r.status, when: r.created_at ?? r.from_date,
        ref: r.id.slice(0, 8).toUpperCase(),
      })),
      ...regRequests.map(r => ({
        id: r.id, type: 'Regularize',
        detail: `Correction · ${r.date}`,
        status: r.status, when: r.created_at ?? r.date,
        ref: r.id.slice(0, 8).toUpperCase(),
      })),
    ]
    combined.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    return combined.slice(0, 5)
  }, [requests, regRequests])

  const statusStyle: Record<string, { bg: string; color: string }> = {
    pending:  { bg: 'var(--tint-amber-bg)', color: 'var(--tint-amber-fg)' },
    approved: { bg: 'var(--tint-green-bg)', color: 'var(--tint-green-fg)' },
    rejected: { bg: 'var(--tint-red-bg)', color: 'var(--tint-red-fg)' },
  }

  return (
    <section style={CARD}>
      <div style={CARD_HEAD}>
        <CardLabel>My Requests</CardLabel>
        <LinkBtn onClick={() => navigate('/ess/approvals')}>
          View all <ArrowRight style={{ width: 12, height: 12 }} />
        </LinkBtn>
      </div>

      <div style={{ padding: '10px 16px' }}>
        {/* Status counters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[
            { k: 'Pending',  v: pending,  dot: '#f59e0b' },
            { k: 'Approved', v: approved, dot: '#10b981' },
            { k: 'Rejected', v: rejected, dot: '#f43f5e' },
          ].map(t => (
            <div key={t.k} style={{
              flex: 1, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--card)', padding: '6px 8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 9.5, color: 'var(--muted-foreground)', fontWeight: 600 }}>{t.k}</span>
              </div>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', ...MONO }}>{t.v}</span>
            </div>
          ))}
        </div>

        {/* Request rows */}
        {recentItems.length > 0 ? recentItems.map((r, i) => {
          const ss = statusStyle[r.status?.toLowerCase()] ?? { bg: 'var(--muted)', color: 'var(--muted-foreground)' }
          return (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0',
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {r.detail}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', marginTop: 1 }}>
                  {r.type} · #{r.ref}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                  background: ss.bg, color: ss.color, textTransform: 'capitalize' as const,
                }}>
                  {r.status}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>{timeAgo(r.when)}</span>
              </div>
            </div>
          )
        }) : (
          <div style={{ textAlign: 'center' as const, padding: '12px 0', color: 'var(--muted-foreground)', fontSize: 12 }}>
            No recent requests
          </div>
        )}
      </div>
    </section>
  )
}

// ── 4a. LeaveUsage ────────────────────────────────────────────────────────────

function LeaveUsage({ balances, navigate }: { balances: LeaveBalance[]; navigate: (to: string) => void }) {
  const items = useMemo(() =>
    balances.filter(b => b.leave_types).map(b => {
      const used      = b.used ?? 0
      const remaining = b.balance
      const total     = b.leave_types?.max_days ?? (remaining + used)
      const pctUsed   = total > 0 ? Math.round((used / total) * 100) : 0
      return { name: b.leave_types!.name, isPaid: b.leave_types!.is_paid, total, used, remaining, pctUsed }
    }).slice(0, 6)
  , [balances])

  return (
    <section style={CARD}>
      <div style={CARD_HEAD}>
        <CardLabel>Leave Balance & Usage</CardLabel>
        <LinkBtn onClick={() => navigate('/ess/leave/balance')}>
          Details <ChevronRight style={{ width: 12, height: 12 }} />
        </LinkBtn>
      </div>

      <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.length > 0 ? items.map(item => (
          <div key={item.name}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>{item.name}</span>
                {!item.isPaid && (
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--muted-foreground)', border: '1px solid var(--border)', borderRadius: 4, padding: '0px 4px', textTransform: 'uppercase' as const, letterSpacing: '.08em' }}>
                    Unpaid
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)', ...MONO }}>
                  <b style={{ color: 'var(--foreground)' }}>{item.remaining}</b>/{item.total}d
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: item.pctUsed > 70 ? '#f43f5e' : 'var(--muted-foreground)' }}>
                  {item.pctUsed}%
                </span>
              </div>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'var(--muted)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 999,
                background: item.pctUsed > 70
                  ? 'linear-gradient(90deg,#f59e0b,#f43f5e)'
                  : 'linear-gradient(90deg, var(--primary), var(--info))',
                width: `${Math.max(0, item.pctUsed)}%`,
                transition: 'width .3s ease',
              }} />
            </div>
          </div>
        )) : (
          <div style={{ textAlign: 'center' as const, padding: '12px 0', color: 'var(--muted-foreground)', fontSize: 12 }}>
            No leave balance data
          </div>
        )}
      </div>
    </section>
  )
}

// ── 4b. Upcoming ──────────────────────────────────────────────────────────────

function Upcoming({ holidays, navigate }: { holidays: Holiday[]; navigate: (to: string) => void }) {
  const todayMs = Date.now()

  const upcoming = useMemo(() =>
    holidays
      .filter(h => {
        try { return new Date(h.date + 'T00:00:00').getTime() >= todayMs - 86400000 } catch { return false }
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 6)
  , [holidays, todayMs])

  function fmtHolDate(ds: string): string {
    try {
      const d = new Date(ds + 'T12:00:00Z')
      const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      if (isNaN(d.getTime())) return ds
      return `${DOW[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
    } catch { return ds }
  }

  function daysUntil(ds: string): number {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const target = new Date(ds + 'T00:00:00'); target.setHours(0, 0, 0, 0)
      return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000))
    } catch { return 0 }
  }

  return (
    <section style={CARD}>
      <div style={CARD_HEAD}>
        <CardLabel>Upcoming Holidays</CardLabel>
        <LinkBtn onClick={() => navigate('/ess/optional-holidays')}>
          View all <ChevronRight style={{ width: 12, height: 12 }} />
        </LinkBtn>
      </div>

      <div style={{ padding: '8px 16px 12px' }}>
        {upcoming.length > 0 ? upcoming.map((h, i) => {
          const du = daysUntil(h.date)
          return (
            <div key={h.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: 'color-mix(in srgb, var(--primary) 10%, var(--card))',
                display: 'grid', placeItems: 'center',
              }}>
                <Calendar style={{ width: 12, height: 12, color: 'var(--primary)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {h.name}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', marginTop: 1 }}>{fmtHolDate(h.date)}</div>
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                background: du === 0 ? 'var(--tint-green-bg)' : du <= 7 ? 'var(--tint-amber-bg)' : 'var(--muted)',
                color:      du === 0 ? 'var(--tint-green-fg)' : du <= 7 ? 'var(--tint-amber-fg)' : 'var(--muted-foreground)',
              }}>
                {du === 0 ? 'Today' : du === 1 ? 'Tomorrow' : `${du}d`}
              </div>
            </div>
          )
        }) : (
          <div style={{ textAlign: 'center' as const, padding: '12px 0', color: 'var(--muted-foreground)', fontSize: 12 }}>
            No upcoming holidays
          </div>
        )}
      </div>
    </section>
  )
}

// ── Expiry Alerts (P4.5 productivity layer) ────────────────────────────────────

interface DashExpiryItem {
  id: string; category: string; label: string; due_date: string; days_to_due: number; bucket: string
}

function ExpiryAlerts({ items, navigate }: { items: DashExpiryItem[]; navigate: (to: string) => void }) {
  // Surface only what needs attention soon — overdue + due within 90 days.
  const actionable = useMemo(
    () => items
      .filter(i => i.bucket === 'overdue' || i.bucket === 'due_7' || i.bucket === 'due_30' || i.bucket === 'due_90')
      .sort((a, b) => a.days_to_due - b.days_to_due)
      .slice(0, 5),
    [items],
  )

  return (
    <section style={CARD}>
      <div style={CARD_HEAD}>
        <CardLabel>My Expiry Alerts</CardLabel>
        <LinkBtn onClick={() => navigate('/ess/documents')}>
          View all <ChevronRight style={{ width: 12, height: 12 }} />
        </LinkBtn>
      </div>
      <div style={{ padding: '8px 16px 12px' }}>
        {actionable.length > 0 ? actionable.map((it, i) => {
          const overdue = it.days_to_due < 0
          const soon    = it.days_to_due >= 0 && it.days_to_due <= 30
          return (
            <div key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: overdue ? 'var(--tint-red-bg)' : soon ? 'var(--tint-amber-bg)' : 'var(--muted)',
                display: 'grid', placeItems: 'center',
              }}>
                <CalendarClock style={{ width: 12, height: 12, color: overdue ? '#b42318' : soon ? 'var(--tint-amber-fg)' : 'var(--muted-foreground)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {it.label}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', marginTop: 1, textTransform: 'capitalize' as const }}>{it.category}</div>
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                background: overdue ? 'var(--tint-red-bg)' : soon ? 'var(--tint-amber-bg)' : 'var(--muted)',
                color:      overdue ? '#b42318' : soon ? 'var(--tint-amber-fg)' : 'var(--muted-foreground)',
              }}>
                {overdue ? 'Expired' : `${it.days_to_due}d`}
              </div>
            </div>
          )
        }) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', color: 'var(--muted-foreground)', fontSize: 12 }}>
            <ShieldCheck style={{ width: 14, height: 14, color: 'var(--tint-green-fg)' }} />
            Nothing expiring soon
          </div>
        )}
      </div>
    </section>
  )
}

// ── 5. Quick Actions Bar ──────────────────────────────────────────────────────

type QaItem = { icon: React.ComponentType<{ style?: CSSProperties }>; label: string; tone: string; to: string }
function buildQaItems(base: string): QaItem[] {
  return [
    { icon: Leaf,       label: 'Apply Leave',     tone: 'gn', to: `${base}/leave/balance`             },
    { icon: RefreshCw,  label: 'Regularize',       tone: 'sk', to: `${base}/attendance/regularization` },
    { icon: Wallet,     label: 'Payslip',           tone: 'am', to: `${base}/compensation`              },
    { icon: FileText,   label: 'Tax Declaration',  tone: 'rs', to: `${base}/declarations`              },
    { icon: CreditCard, label: 'Reimburse',         tone: 'vl', to: `${base}/reimbursements`            },
    { icon: FolderOpen, label: 'Documents',         tone: '',   to: `${base}/documents`                 },
    { icon: Scale,      label: 'Form 16',           tone: 'gn', to: `${base}/documents`                 },
    { icon: Mail,       label: 'Letters',           tone: 'sk', to: `${base}/letters`                   },
  ]
}

const TONE: Record<string, { bg: string; color: string }> = {
  gn: { bg: '#e8f7ef', color: '#10b981' },
  am: { bg: 'var(--tint-amber-bg)', color: '#f59e0b' },
  sk: { bg: '#e3f3fc', color: '#0ea5e9' },
  vl: { bg: '#efeafe', color: '#8b5cf6' },
  rs: { bg: 'var(--tint-red-bg)', color: '#f43f5e' },
  '': { bg: '#e9f0f8', color: '#1A4D8F' },
}

function QuickActionsBar({ navigate, basePath }: { navigate: (to: string) => void; basePath: string }) {
  const QA_ITEMS = buildQaItems(basePath)
  return (
    <section style={{ ...CARD, overflow: 'hidden' }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
        {QA_ITEMS.map((qa, i) => {
          const QIcon = qa.icon
          const t     = TONE[qa.tone]
          return (
            <button
              key={qa.label}
              onClick={() => navigate(qa.to)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 6, padding: '12px 6px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderRight: i < QA_ITEMS.length - 1 ? '1px solid var(--border)' : undefined,
                transition: 'background .1s ease',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--muted)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: t.bg }}>
                <QIcon style={{ width: 13, height: 13, color: t.color } as CSSProperties} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap' as const }}>
                {qa.label}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ── EmployeeDashboard (root) ──────────────────────────────────────────────────

export function EmployeeDashboard() {
  const { profile }  = useAuthStore()
  const navigate     = useNavigate()
  const location     = useLocation()
  const today        = useMemo(() => new Date(), [])
  const employeeId   = profile?.employee_id

  // When rendered inside ManagerShell (/manager/self/*), keep navigation
  // within the manager shell so the amber sidebar doesn't switch to ESS.
  const selfBase = location.pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  // Context-aware navigate: rewrites /ess/ prefix to selfBase so all child
  // components with hardcoded /ess/ links automatically stay in the correct shell.
  const nav = useMemo(
    () => (to: string) => navigate(to.replace(/^\/ess\//, `${selfBase}/`)),
    [navigate, selfBase],
  )

  const cursor = useMemo(() => ({ y: today.getFullYear(), m: today.getMonth() }), [today])

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: empResp } = useQuery<{ data: Employee }>({
    queryKey:  ['employee', employeeId],
    queryFn:   () => api.get(`/employees/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  // Enriched identity — profile photo + designation/department/manager/location
  // (the lean /employees/:id omits these; the master view carries them).
  const { data: fullProfile } = useQuery<DashFullProfile>({
    queryKey:  ['ess-dash-full-profile', employeeId],
    queryFn:   () => api.get(`/employees/${employeeId}/full-profile`),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  const monthStart = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`
  const monthEnd   = (() => {
    const d = new Date(cursor.y, cursor.m + 1, 0)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  const { data: attResp } = useQuery<AttendanceResp>({
    queryKey:  ['attendance', employeeId, cursor.y, cursor.m],
    queryFn:   () => api.get(`/attendance/${employeeId}?from=${monthStart}&to=${monthEnd}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const { data: leaveResp } = useQuery<{ data: LeaveRequest[] }>({
    queryKey:  ['leave-my-requests'],
    queryFn:   () => api.get('/attendance/leave/my'),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const regCutoff = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])
  const regToday = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const { data: regResp } = useQuery<{ data: RegRequest[] }>({
    queryKey:  ['reg-my-requests-dash', employeeId, regCutoff],
    queryFn:   () => api.get(`/attendance/regularisation/my?from=${regCutoff}&to=${regToday}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const { data: balanceResp } = useQuery<{ data: LeaveBalance[] }>({
    queryKey:  ['leave-balance', employeeId],
    queryFn:   () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  const { data: slipsResp } = useQuery<{ data: PayslipSummary[] }>({
    queryKey:  ['my-slips-dash', employeeId],
    queryFn:   () => api.get('/payroll/my-slips?limit=2'),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  const { data: compResp } = useQuery<{ data: ActiveComp }>({
    queryKey:  ['my-comp-dash', employeeId],
    queryFn:   () => api.get(`/employees/${employeeId}/compensation`),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  const { data: holidaysResp } = useQuery({
    queryKey:  ['public-holidays', cursor.y],
    queryFn:   () => api.get(`/masters/holidays?year=${cursor.y}`),
    enabled:   !!employeeId,
    staleTime: 60 * 60_000,
  })

  // My expiry alerts — own lifecycle risks projected from the Program 3A engine.
  const { data: expiryResp } = useQuery<{ data: DashExpiryItem[] }>({
    queryKey:  ['ess-dash-expiry', employeeId],
    queryFn:   () => api.get('/ess/me/expiry'),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const emp = (empResp as any)?.data ?? (empResp as any) ?? null

  const heatmapData = useMemo<DayData[]>(() => {
    const records = attResp?.daily ?? []
    const logs    = attResp?.logs  ?? []
    return buildMonthData(cursor.y, cursor.m, today, records, logs)
  }, [attResp, cursor, today])

  const requests    = (leaveResp    as any)?.data ?? []
  const regRequests = (regResp      as any)?.data ?? []
  const balances    = (balanceResp  as any)?.data ?? []
  const slips       = (slipsResp    as any)?.data ?? (Array.isArray(slipsResp) ? slipsResp : [])
  const comp        = (compResp     as any)?.data ?? null
  const holidays    = (holidaysResp as any)?.data ?? (Array.isArray(holidaysResp) ? holidaysResp : [])
  const expiryItems = (expiryResp   as any)?.data ?? []

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-5" style={{ background: 'var(--muted)', minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 1. Profile bar */}
      <ProfileBar emp={emp} profile={fullProfile} />

      {/* 2. KPI row */}
      <div style={{ display: 'flex', gap: 12 }}>
        <AttKpiCard data={heatmapData} navigate={nav} />
        <NetPayKpiCard slips={slips} navigate={nav} />
        <OpenActionsKpiCard requests={requests} regRequests={regRequests} navigate={nav} />
      </div>

      {/* 3. Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr]" style={{ gap: 12, alignItems: 'start' }}>
        {/* Left: Compensation + My Requests */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CompStructure comp={comp} latestSlip={slips[0] ?? null} navigate={nav} />
          <MyRequests requests={requests} regRequests={regRequests} navigate={nav} />
        </div>
        {/* Right: Leave usage + Expiry alerts + Upcoming */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <LeaveUsage balances={balances} navigate={nav} />
          <ExpiryAlerts items={expiryItems} navigate={nav} />
          <Upcoming holidays={holidays} navigate={nav} />
        </div>
      </div>

      {/* 4. Quick Actions bar */}
      <QuickActionsBar navigate={nav} basePath={selfBase} />
    </div>
  )
}
