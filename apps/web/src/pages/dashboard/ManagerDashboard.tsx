/**
 * ManagerDashboard — /manager/dashboard  [v2]
 *
 * Enterprise workforce command center — redesigned to match reference UI.
 *
 * Layout:
 *   CoreIdentity hero card (full width)
 *   KPI strip × 5 (full width)
 *   Two-column body:
 *     Main  → ApprovalsQueue + TeamHeatmap
 *     Rail  → TeamAttendanceToday (donut) + WhosOut + QuickActions + PendingRegularisation
 *
 * Terminology: "Regularisation" throughout — no "corrections" / "correction".
 * Navigation:  /manager/* routes — no /admin/* links.
 *
 * Reuses: GET /manager/dashboard, GET /approvals/pending, GET /attendance/:id
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast }       from 'sonner'
import {
  Check, ChevronRight, ChevronLeft,
  Users, Calendar, Clock, FileText,
  BarChart2, ClipboardList, UserCheck,
  MapPin, X, AlertCircle,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { api }          from '@/lib/api/client'
import { ManagerInsights } from '@/pages/intelligence/ManagerInsights'
import type { Employee } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember {
  employee_id:   string
  employee_code: string
  name:          string
  status:        string
  work_hours:    number
  late_minutes:  number
  check_in:      string | null
  check_out:     string | null
}

interface TodaySummary {
  present:    number
  late:       number
  absent:     number
  leave:      number
  not_marked: number
  total:      number
}

interface LeaveRequest {
  id:            string
  from_date:     string
  to_date:       string
  computed_days: number
  reason?:       string
  created_at:    string
  leave_types?:  { id: string; name: string }
  employees:     { id: string; first_name: string; last_name: string; employee_code: string }
}

interface Regularisation {
  id:                  string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  created_at:          string
  employees:           { id: string; first_name: string; last_name: string; employee_code: string }
}

interface ManagerDashboardResponse {
  manager_employee_id: string | null
  date:                string
  team_members:        TeamMember[]
  today_summary:       TodaySummary
  pending: {
    leave_requests:  LeaveRequest[]
    regularisations: Regularisation[]
  }
  anomalies: { count: number }
}

interface AttendanceDailyRow {
  date:       string
  status:     string
  work_hours: number
}

type ApprovalFilter = 'all' | 'leave' | 'reg'

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:      'var(--muted)',
  card:    'var(--card)',
  border:  'var(--border)',
  borderL: 'var(--border)',
  text:    'var(--foreground)',
  sub:     'var(--muted-foreground)',
  muted:   'var(--muted-foreground)',
  shadow:  '0 1px 0 rgba(15,16,36,.04),0 1px 3px rgba(15,16,36,.06)',
  radius:  14,
  mono:    '"Geist Mono",ui-monospace,monospace',
}

// ── Cell status config for heatmap ────────────────────────────────────────────

interface CellCfg { bg: string; color: string; label: string; exception?: boolean }

const CELL: Record<string, CellCfg> = {
  present:       { bg: '#ecfdf5', color: '#059669', label: 'P'  },
  late:          { bg: '#ecfdf5', color: '#059669', label: 'P',  exception: true },
  absent:        { bg: '#fff1f2', color: '#e11d48', label: 'A'  },
  lop:           { bg: '#fff1f2', color: '#e11d48', label: 'A'  },
  leave:         { bg: '#eff6ff', color: '#2563eb', label: 'L'  },
  on_leave:      { bg: '#eff6ff', color: '#2563eb', label: 'L'  },
  weekly_off:    { bg: '#f3f4f8', color: '#9ca3af', label: 'WO' },
  off:           { bg: '#f3f4f8', color: '#9ca3af', label: 'WO' },
  holiday:       { bg: '#f3e8ff', color: '#7c3aed', label: 'H'  },
  not_marked:    { bg: '#f8f9fa', color: '#d1d5db', label: '—'  },
  missing_punch: { bg: '#ecfdf5', color: '#059669', label: 'P',  exception: true },
  half_day:      { bg: '#fef9c3', color: '#d97706', label: 'HD' },
  early_out:     { bg: '#ecfdf5', color: '#059669', label: 'P',  exception: true },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) }
  catch { return '—' }
}

function fmtDate(s: string) {
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function fmtDateFull(s: string) {
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function calcTenure(joining?: string | null) {
  if (!joining) return '—'
  try {
    const j = new Date(joining), now = new Date()
    let y = now.getFullYear() - j.getFullYear()
    let m = now.getMonth() - j.getMonth()
    if (m < 0) { y--; m += 12 }
    if (y === 0) return `${m}m`
    return m === 0 ? `${y}y` : `${y}y ${m}m`
  } catch { return '—' }
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

function regType(r: Regularisation) {
  if (r.requested_check_in && !r.requested_check_out) return 'Missing Punch (In)'
  if (!r.requested_check_in && r.requested_check_out) return 'Missing Punch (Out)'
  if (r.requested_check_in && r.requested_check_out)  return 'Punch Correction'
  return 'Regularisation'
}

function buildDates(offset: number): string[] {
  const list: string[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i - offset)
    list.push(d.toISOString().slice(0, 10))
  }
  return list
}

// ── SVG Donut chart ───────────────────────────────────────────────────────────

function DonutChart({
  segments, total, size = 88,
}: {
  segments: Array<{ value: number; color: string }>
  total:    number
  size?:    number
}) {
  const cx = size / 2, cy = size / 2
  const outerR = size * 0.43, innerR = size * 0.28

  if (total === 0) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={outerR} fill="var(--muted)" />
      <circle cx={cx} cy={cy} r={innerR} fill="var(--card)" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.2} fontWeight={700} fill="var(--muted-foreground)" fontFamily={T.mono}>0</text>
      <text x={cx} y={cy + size * 0.15} textAnchor="middle" fontSize={size * 0.1} fill="var(--muted-foreground)">Total</text>
    </svg>
  )

  const paths: JSX.Element[] = []
  let angle = -Math.PI / 2

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.value <= 0) continue
    const sweep = (seg.value / total) * 2 * Math.PI
    const [x1, y1]   = [cx + outerR * Math.cos(angle),          cy + outerR * Math.sin(angle)]
    const [x2, y2]   = [cx + outerR * Math.cos(angle + sweep),  cy + outerR * Math.sin(angle + sweep)]
    const [ix1, iy1] = [cx + innerR * Math.cos(angle),          cy + innerR * Math.sin(angle)]
    const [ix2, iy2] = [cx + innerR * Math.cos(angle + sweep),  cy + innerR * Math.sin(angle + sweep)]
    const lg = sweep > Math.PI ? 1 : 0
    paths.push(
      <path key={i}
        d={`M${x1} ${y1}A${outerR} ${outerR} 0 ${lg} 1 ${x2} ${y2}L${ix2} ${iy2}A${innerR} ${innerR} 0 ${lg} 0 ${ix1} ${iy1}Z`}
        fill={seg.color}
      />
    )
    angle += sweep
  }

  return (
    <svg width={size} height={size}>
      {paths}
      <circle cx={cx} cy={cy} r={innerR} fill="var(--card)" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.21} fontWeight={700} fill={T.text} fontFamily={T.mono}>{total}</text>
      <text x={cx} y={cy + size * 0.155} textAnchor="middle" fontSize={size * 0.1} fill={T.muted}>Total</text>
    </svg>
  )
}

// ── CoreIdentity ──────────────────────────────────────────────────────────────

function CoreIdentity({ emp, teamSize, pendingCount }: {
  emp:          Employee | null
  teamSize:     number
  pendingCount: number
}) {
  const { profile } = useAuthStore()
  const name    = emp ? `${emp.first_name} ${emp.last_name}` : (profile?.full_name ?? 'Manager')
  const dept    = (emp as any)?.department?.name  ?? (emp as any)?.departments?.name  ?? '—'
  const loc     = (emp as any)?.work_location?.name ?? (emp as any)?.work_locations?.name ?? '—'
  const grade   = (emp as any)?.grade?.name ?? (emp as any)?.grades?.name ?? null
  const code    = emp?.employee_code ?? '—'
  const tenure  = calcTenure((emp as any)?.joining_date)
  const joined  = (() => {
    const jd = (emp as any)?.joining_date
    if (!jd) return ''
    const d = new Date(jd.length === 10 ? jd + 'T12:00:00Z' : jd)
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (isNaN(d.getTime())) return ''
    return `Joined ${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
  })()

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius,
      boxShadow: T.shadow, padding: '14px 20px',
      display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto',
      gap: 18, alignItems: 'center',
    }}>
      {/* Label row spanning all columns */}
      <div style={{
        gridColumn: '1/-1', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: -2,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: T.muted }}>
          Core Identity · Manager
        </span>
        <FileText style={{ width: 13, height: 13, color: T.muted }} />
      </div>

      {/* Avatar */}
      <div style={{
        width: 68, height: 68, borderRadius: 15, flexShrink: 0,
        background: 'radial-gradient(circle at 30% 25%,#bfdbfe 0%,transparent 55%),linear-gradient(135deg,#1d4ed8,#3b82f6 70%,#0ea5e9)',
        color: '#fff', display: 'grid', placeItems: 'center',
        fontSize: 22, fontWeight: 700, letterSpacing: '-.01em',
        boxShadow: '0 10px 20px -10px rgba(29,78,216,.55)',
        border: '2px solid #fff', position: 'relative',
      }}>
        {initials(name)}
        <span style={{
          position: 'absolute', right: -4, bottom: -4,
          width: 20, height: 20, borderRadius: '50%',
          background: '#3b82f6', color: '#fff',
          display: 'grid', placeItems: 'center',
          border: '2px solid #fff', boxShadow: '0 3px 6px -2px rgba(59,130,246,.5)',
        }}>
          <Users style={{ width: 10, height: 10 }} />
        </span>
      </div>

      {/* Center: name + meta */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: T.text }}>{name}</span>
          {grade && (
            <span style={{
              border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8',
              padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
              letterSpacing: '.1em', textTransform: 'uppercase',
            }}>{grade}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
          {[
            { k: 'Employee ID', v: code,  mono: true  },
            { k: 'Department',  v: dept,  mono: false },
            { k: 'Location',    v: loc,   mono: false },
          ].map(f => (
            <div key={f.k}>
              <div style={{ fontSize: 9.5, color: T.muted, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{f.k}</div>
              <div style={{ fontSize: 12.5, color: T.text, marginTop: 1, fontFamily: f.mono ? T.mono : undefined, fontWeight: f.mono ? 500 : 600 }}>{f.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: tenure + stats */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ fontSize: 9.5, color: T.muted, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Tenure</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: T.text, letterSpacing: '-.02em', fontFamily: T.mono }}>{tenure}</span>
          {joined && <span style={{ fontSize: 10.5, color: T.muted }}>{joined}</span>}
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          {[
            { k: 'Direct Reports', v: teamSize,     color: '#1d4ed8' },
            { k: 'Pending',        v: pendingCount, color: pendingCount > 0 ? '#f59e0b' : T.muted },
          ].map(s => (
            <div key={s.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: T.mono, lineHeight: 1 }}>{s.v}</span>
              <span style={{ fontSize: 9, color: T.muted, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.k}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── KPI Strip ─────────────────────────────────────────────────────────────────

function KPIStrip({ summary, pendingLeave, pendingReg }: {
  summary:      TodaySummary
  pendingLeave: number
  pendingReg:   number
}) {
  const total   = summary.total
  const present = summary.present
  const pctPres = total > 0 ? ((present / total) * 100).toFixed(1) : '0.0'

  const tiles = [
    {
      icon: Users,       label: 'Team Size',        value: total,
      sub: 'Active members', color: '#1d4ed8', bg: '#eff6ff',
    },
    {
      icon: UserCheck,   label: 'Present Today',    value: present,
      sub: `${pctPres}% of team`, color: '#059669', bg: '#ecfdf5',
    },
    {
      icon: Calendar,    label: 'On Leave',          value: summary.leave,
      sub: 'Approved', color: '#0ea5e9', bg: '#e3f3fc',
    },
    {
      icon: AlertCircle, label: 'Absent',            value: summary.absent,
      sub: summary.not_marked > 0 ? `${summary.not_marked} not marked` : 'Today',
      color: '#e11d48', bg: '#fff1f2',
    },
    {
      icon: ClipboardList, label: 'Pending Approvals', value: pendingLeave + pendingReg,
      sub: `${pendingLeave} leave · ${pendingReg} reg`,
      color: pendingLeave + pendingReg > 0 ? '#f59e0b' : T.muted,
      bg: pendingLeave + pendingReg > 0 ? '#fffbeb' : '#f8f9fa',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" style={{ gap: 10 }}>
      {tiles.map(t => {
        const Icon = t.icon
        return (
          <div key={t.label} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
            borderTop: '3px solid var(--primary)',
            padding: '12px 14px', boxShadow: T.shadow,
            display: 'flex', alignItems: 'center', gap: 12,
            position: 'relative', overflow: 'hidden',
          }}>
            {/* 3px top accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: t.color, borderRadius: '12px 12px 0 0' }} />
            <div style={{
              width: 38, height: 38, borderRadius: 10, background: t.bg,
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <Icon style={{ width: 17, height: 17, color: t.color }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{t.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: t.color, fontFamily: T.mono, letterSpacing: '-.02em', lineHeight: 1.15 }}>{t.value}</div>
              <div style={{ fontSize: 10.5, color: T.muted, marginTop: 1 }}>{t.sub}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Approvals Queue ───────────────────────────────────────────────────────────

type CombinedItem = {
  type:       'leave' | 'reg'
  id:         string
  name:       string
  code:       string
  reqType:    string
  reqSub:     string
  dateRange:  string
  days:       number | null
  reason:     string
  createdAt:  string
  time?:      string
}

function ApprovalsQueue({
  leaveRequests, regularisations, navigate,
  onApproveLeave, onRejectLeave, onApproveReg, onRejectReg,
  approvingLeaveId, approvingRegId,
}: {
  leaveRequests:    LeaveRequest[]
  regularisations:  Regularisation[]
  navigate:         ReturnType<typeof useNavigate>
  onApproveLeave:   (id: string) => void
  onRejectLeave:    (id: string) => void
  onApproveReg:     (id: string) => void
  onRejectReg:      (id: string) => void
  approvingLeaveId: string | undefined
  approvingRegId:   string | undefined
}) {
  const [filter, setFilter] = useState<ApprovalFilter>('all')

  const combined = useMemo<CombinedItem[]>(() => {
    const leaves: CombinedItem[] = leaveRequests.map(r => ({
      type:      'leave',
      id:        r.id,
      name:      `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim() || 'Employee',
      code:      r.employees?.employee_code ?? '',
      reqType:   r.leave_types?.name ?? 'Leave',
      reqSub:    'Leave Request',
      dateRange: r.from_date === r.to_date
        ? fmtDateFull(r.from_date)
        : `${fmtDate(r.from_date)} – ${fmtDateFull(r.to_date)}`,
      days:      r.computed_days,
      reason:    r.reason ?? '',
      createdAt: r.created_at,
    }))

    const regs: CombinedItem[] = regularisations.map(r => ({
      type:      'reg',
      id:        r.id,
      name:      `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim() || 'Employee',
      code:      r.employees?.employee_code ?? '',
      reqType:   regType(r),
      reqSub:    'Regularisation Request',
      dateRange: fmtDateFull(r.date),
      days:      null,
      reason:    r.reason,
      createdAt: r.created_at,
      time:      r.requested_check_in
        ? fmtTime(r.requested_check_in)
        : r.requested_check_out
        ? fmtTime(r.requested_check_out)
        : undefined,
    }))

    const all = [...leaves, ...regs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    if (filter === 'leave') return leaves
    if (filter === 'reg')   return regs
    return all
  }, [leaveRequests, regularisations, filter])

  const total = leaveRequests.length + regularisations.length

  const CHIPS: { key: ApprovalFilter; label: string; count: number }[] = [
    { key: 'all',   label: 'All',        count: total                    },
    { key: 'leave', label: 'Leave',      count: leaveRequests.length    },
    { key: 'reg',   label: 'Regularize', count: regularisations.length  },
  ]

  // Avatar colors cycling
  const AV_COLORS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#ede9fe', '#cffafe']
  const AV_TEXT   = ['#1d4ed8', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2']

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow }}>
      {/* Head */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px 10px', borderBottom: `1px solid ${T.borderL}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: T.sub }}>
            Approvals Queue
          </span>
          {total > 0 && (
            <span style={{
              background: '#fffbeb', color: '#92400e', fontWeight: 700,
              fontSize: 10, padding: '2px 7px', borderRadius: 999,
            }}>{total} pending</span>
          )}
        </div>
        <button
          onClick={() => navigate('/manager/approvals')}
          style={{ color: '#1d4ed8', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0 }}
        >
          Full inbox <ChevronRight style={{ width: 11, height: 11 }} />
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 5, padding: '10px 20px 8px' }}>
        {CHIPS.map(c => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            style={{
              padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .1s',
              border: `1px solid ${filter === c.key ? '#1d4ed8' : 'var(--border)'}`,
              background: filter === c.key ? '#eff6ff' : 'transparent',
              color: filter === c.key ? '#1d4ed8' : T.sub,
            }}
          >
            {c.label}
            {c.count > 0 && (
              <span style={{ marginLeft: 4, fontSize: 10, opacity: .8 }}>({c.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Items */}
      <div style={{ padding: '0 8px 8px' }}>
        {combined.length === 0 ? (
          <div style={{ textAlign: 'center', color: T.muted, padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: '#ecfdf5', display: 'grid', placeItems: 'center' }}>
              <Check style={{ width: 18, height: 18, color: '#10b981' }} />
            </div>
            <span style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>All caught up!</span>
            <span style={{ fontSize: 11.5 }}>No pending approvals</span>
          </div>
        ) : (
          combined.map((item, idx) => {
            const isBusy = (item.type === 'leave' && approvingLeaveId === item.id)
                        || (item.type === 'reg'   && approvingRegId   === item.id)
            const ci = idx % AV_COLORS.length

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 10,
                  border: '1px solid transparent', transition: 'background .1s,border-color .1s',
                }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = 'var(--card)'; el.style.borderColor = T.border }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = ''; el.style.borderColor = 'transparent' }}
              >
                {/* Avatar */}
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: AV_COLORS[ci], color: AV_TEXT[ci],
                  display: 'grid', placeItems: 'center',
                  fontSize: 10.5, fontWeight: 700,
                }}>
                  {initials(item.name)}
                </div>

                {/* Employee info */}
                <div style={{ width: 140, flexShrink: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginTop: 1 }}>{item.code}</div>
                </div>

                {/* Request type */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reqType}</div>
                  <div style={{ fontSize: 10.5, color: T.sub, marginTop: 1 }}>{item.reqSub}</div>
                </div>

                {/* Date / time */}
                <div style={{ minWidth: 160, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {item.type === 'leave'
                      ? <Calendar style={{ width: 10, height: 10, color: T.muted, flexShrink: 0 }} />
                      : <Clock    style={{ width: 10, height: 10, color: T.muted, flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: 11.5, color: T.sub, fontFamily: T.mono }}>{item.dateRange}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: T.muted, marginTop: 1 }}>
                    {item.days != null && item.days > 0 && `${item.days} day${item.days !== 1 ? 's' : ''}`}
                    {item.time && item.time !== '—' && item.time}
                  </div>
                </div>

                {/* Status badge */}
                <div style={{ flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                    background: '#fffbeb', color: '#92400e',
                    letterSpacing: '.04em', textTransform: 'capitalize',
                  }}>Submitted</span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  <button
                    disabled={isBusy}
                    onClick={() => item.type === 'leave' ? onApproveLeave(item.id) : onApproveReg(item.id)}
                    title="Approve"
                    style={{
                      width: 28, height: 28, borderRadius: 7, border: '1px solid #cdebd9',
                      background: '#ecfdf5', color: '#059669', cursor: isBusy ? 'not-allowed' : 'pointer',
                      display: 'grid', placeItems: 'center', opacity: isBusy ? .5 : 1, transition: 'opacity .1s',
                    }}
                  >
                    <Check style={{ width: 12, height: 12 }} />
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => item.type === 'leave' ? onRejectLeave(item.id) : onRejectReg(item.id)}
                    title="Reject"
                    style={{
                      width: 28, height: 28, borderRadius: 7, border: '1px solid #ffd0d7',
                      background: '#fff0f2', color: '#e11d48', cursor: isBusy ? 'not-allowed' : 'pointer',
                      display: 'grid', placeItems: 'center', opacity: isBusy ? .5 : 1, transition: 'opacity .1s',
                    }}
                  >
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              </div>
            )
          })
        )}

        {combined.length > 0 && (
          <div style={{ textAlign: 'center', paddingTop: 6 }}>
            <button
              onClick={() => navigate('/manager/approvals')}
              style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 3 }}
            >
              View all approvals <ChevronRight style={{ width: 11, height: 11 }} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── TeamHeatmap ───────────────────────────────────────────────────────────────

interface HeatTip { x: number; y: number; member: string; date: string; status: string }

function TeamHeatmap({
  teamMembers, teamAttendance, dates, dateOffset, setDateOffset, navigate,
}: {
  teamMembers:     TeamMember[]
  teamAttendance:  Map<string, Map<string, string>>
  dates:           string[]
  dateOffset:      number
  setDateOffset:   (n: number) => void
  navigate:        ReturnType<typeof useNavigate>
}) {
  const [tip, setTip] = useState<HeatTip | null>(null)

  const onEnter = useCallback((e: React.MouseEvent, name: string, date: string, status: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top, member: name, date, status })
  }, [])
  const onLeave = useCallback(() => setTip(null), [])

  const rangeLabel = dates.length >= 2
    ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`
    : ''

  const LEGEND = [
    { bg: '#ecfdf5', color: '#059669', label: 'Present' },
    { bg: '#eff6ff', color: '#2563eb', label: 'On Leave' },
    { bg: '#fff1f2', color: '#e11d48', label: 'Absent'  },
    { bg: '#f3f4f8', color: '#9ca3af', label: 'Weekly Off' },
    { bg: '#f3e8ff', color: '#7c3aed', label: 'Holiday' },
    { exception: true, label: 'Exception' },
  ]

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow }}>
      {/* Head */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 20px', borderBottom: `1px solid ${T.borderL}`,
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: T.sub }}>
          Team Attendance · Last 14 Days
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: T.muted }}>{rangeLabel}</span>
          <div style={{ display: 'flex', gap: 3 }}>
            <button
              onClick={() => setDateOffset(dateOffset + 7)}
              style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${T.border}`, background: T.card, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            >
              <ChevronLeft style={{ width: 12, height: 12, color: T.sub }} />
            </button>
            <button
              disabled={dateOffset === 0}
              onClick={() => setDateOffset(Math.max(0, dateOffset - 7))}
              style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${T.border}`, background: T.card, cursor: dateOffset === 0 ? 'not-allowed' : 'pointer', display: 'grid', placeItems: 'center', opacity: dateOffset === 0 ? .4 : 1 }}
            >
              <ChevronRight style={{ width: 12, height: 12, color: T.sub }} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 20px 0', overflowX: 'auto' }}>
        {/* Date header */}
        <div className="min-w-[640px]" style={{ display: 'grid', gridTemplateColumns: '88px repeat(14, 1fr)', gap: '0 3px', marginBottom: 6 }}>
          <div />
          {dates.map(d => {
            const dt = new Date(d + 'T12:00:00Z')
            const isWe = dt.getDay() === 0 || dt.getDay() === 6
            return (
              <div key={d} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: isWe ? '#c5c8d4' : T.muted, fontWeight: 600, letterSpacing: '.04em' }}>
                  {DOW[dt.getDay()].slice(0, 3)}
                </div>
                <div style={{ fontSize: 10, color: isWe ? '#c5c8d4' : T.sub, fontWeight: 500 }}>
                  {dt.getDate()}
                </div>
              </div>
            )
          })}
        </div>

        {/* Member rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {teamMembers.slice(0, 12).map(member => {
            const memberMap = teamAttendance.get(member.employee_id) ?? new Map<string, string>()
            return (
              <div key={member.employee_id} className="min-w-[640px]" style={{ display: 'grid', gridTemplateColumns: '88px repeat(14, 1fr)', gap: '0 3px', alignItems: 'center' }}>
                {/* Name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 6 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    background: '#dbeafe', color: '#1d4ed8',
                    display: 'grid', placeItems: 'center',
                    fontSize: 8, fontWeight: 700,
                  }}>
                    {initials(member.name)}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {member.name.split(' ')[0]}
                  </span>
                </div>

                {/* Day cells */}
                {dates.map(d => {
                  const dt       = new Date(d + 'T12:00:00Z')
                  const isWe     = dt.getDay() === 0 || dt.getDay() === 6
                  const raw      = memberMap.get(d) ?? 'not_marked'
                  const status   = isWe && raw === 'not_marked' ? 'off' : raw
                  const cfg      = CELL[status] ?? CELL['not_marked']
                  const isExc    = !!cfg.exception

                  return (
                    <div
                      key={d}
                      onMouseEnter={e => onEnter(e, member.name, d, status)}
                      onMouseLeave={onLeave}
                      style={{
                        height: 26, borderRadius: 5,
                        background: cfg.bg, cursor: 'pointer',
                        border: '1px solid transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative', transition: 'transform .05s',
                      }}
                      className="heatmap-cell"
                    >
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                      {isExc && (
                        <span style={{
                          position: 'absolute', top: 2, right: 2,
                          width: 4, height: 4, borderRadius: '50%', background: '#f59e0b',
                        }} />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {teamMembers.length > 12 && (
          <div style={{ fontSize: 11, color: T.muted, textAlign: 'center', padding: '8px 0' }}>
            +{teamMembers.length - 12} more members
          </div>
        )}
      </div>

      {/* Legend + view link */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
        padding: '10px 20px 14px', borderTop: `1px solid ${T.borderL}`, marginTop: 10,
      }}>
        {LEGEND.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.sub }}>
            {l.exception ? (
              <span style={{ position: 'relative', display: 'inline-flex', width: 12, height: 12, borderRadius: 3, background: '#ecfdf5', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 7, fontWeight: 700, color: '#059669' }}>P</span>
                <span style={{ position: 'absolute', top: 1, right: 1, width: 3, height: 3, borderRadius: '50%', background: '#f59e0b' }} />
              </span>
            ) : (
              <span style={{ width: 12, height: 12, borderRadius: 3, background: (l as any).bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 7, fontWeight: 700, color: (l as any).color }}>{(l as any).label === 'Weekly Off' ? 'W' : (l as any).label[0]}</span>
              </span>
            )}
            {l.label}
          </div>
        ))}
        <button
          onClick={() => navigate('/manager/team/attendance')}
          style={{ marginLeft: 'auto', fontSize: 12, color: '#1d4ed8', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0 }}
        >
          View full attendance <ChevronRight style={{ width: 11, height: 11 }} />
        </button>
      </div>

      {/* Hover tooltip */}
      {tip && (
        <div style={{
          position: 'fixed', zIndex: 90,
          left: tip.x, top: tip.y,
          background: '#0f1024', color: '#fff',
          borderRadius: 9, padding: '8px 12px',
          boxShadow: '0 12px 32px -10px rgba(15,16,36,.45)',
          minWidth: 140, pointerEvents: 'none',
          transform: 'translate(-50%,calc(-100% - 8px))',
          fontSize: 11.5,
        }}>
          <div style={{ position: 'absolute', left: '50%', bottom: -4, transform: 'translateX(-50%) rotate(45deg)', width: 8, height: 8, background: '#0f1024' }} />
          <div style={{ fontWeight: 600 }}>{tip.member}</div>
          <div style={{ color: '#b6b9d8', marginTop: 2 }}>{tip.date}</div>
          <div style={{ marginTop: 4, textTransform: 'capitalize' }}>{tip.status.replace(/_/g, ' ')}</div>
        </div>
      )}
    </div>
  )
}

// ── TeamAttendanceTodayCard (donut) ───────────────────────────────────────────

function TeamAttendanceTodayCard({ summary, navigate }: {
  summary:  TodaySummary
  navigate: ReturnType<typeof useNavigate>
}) {
  const segments = [
    { value: summary.present - summary.late, color: '#10b981' },
    { value: summary.late,                   color: '#f59e0b' },
    { value: summary.leave,                  color: '#3b82f6' },
    { value: summary.absent,                 color: '#f43f5e' },
    { value: summary.not_marked,             color: '#e4e5f0' },
  ]

  const rows = [
    { label: 'Present',     n: summary.present,    color: '#10b981' },
    { label: 'On Leave',    n: summary.leave,       color: '#3b82f6' },
    { label: 'Absent',      n: summary.absent,      color: '#f43f5e' },
    { label: 'Weekly Off',  n: 0,                   color: '#e4e5f0' },
    { label: 'Holiday',     n: 0,                   color: '#a78bfa' },
  ]

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: `1px solid ${T.borderL}` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: T.sub }}>
          Team Attendance · Today
        </span>
      </div>
      <div style={{ padding: '14px 18px' }}>
        {/* Donut + legend row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flexShrink: 0 }}>
            <DonutChart segments={segments} total={summary.total} size={88} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {rows.map(r => {
              const pct = summary.total > 0 ? ((r.n / summary.total) * 100).toFixed(1) : '0.0'
              return (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11.5, color: T.sub }}>{r.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{r.n}</span>
                    <span style={{ fontSize: 10.5, color: T.muted, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <button
          onClick={() => navigate('/manager/team/attendance')}
          style={{ marginTop: 12, fontSize: 11.5, color: '#1d4ed8', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}
        >
          View detailed report <ChevronRight style={{ width: 10, height: 10 }} />
        </button>
      </div>
    </div>
  )
}

// ── Who's Out Card ────────────────────────────────────────────────────────────

function WhosOutCard({ teamMembers, navigate }: {
  teamMembers: TeamMember[]
  navigate:    ReturnType<typeof useNavigate>
}) {
  const out = teamMembers.filter(m =>
    m.status === 'absent' || m.status === 'leave' || m.status === 'not_marked'
  )

  const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
    leave:      { bg: '#eff6ff', color: '#2563eb', label: 'On Leave' },
    absent:     { bg: '#fff1f2', color: '#e11d48', label: 'Absent'   },
    not_marked: { bg: '#f8f9fa', color: T.muted,   label: 'Not Marked' },
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: `1px solid ${T.borderL}` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: T.sub }}>
          Who's Out Today
        </span>
        {out.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ background: '#fff1f2', color: '#e11d48', fontWeight: 700, fontSize: 10, padding: '2px 7px', borderRadius: 999 }}>{out.length}</span>
            <button
              onClick={() => navigate('/manager/team/attendance')}
              style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 2 }}
            >
              View all <ChevronRight style={{ width: 10, height: 10 }} />
            </button>
          </div>
        )}
      </div>
      <div style={{ padding: '8px 14px 12px' }}>
        {out.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontSize: 12.5, fontWeight: 600, padding: '8px' }}>
            <Check style={{ width: 15, height: 15 }} />
            Everyone's in!
          </div>
        ) : (
          out.slice(0, 6).map(m => {
            const ss = STATUS_STYLE[m.status] ?? STATUS_STYLE['not_marked']
            return (
              <div
                key={m.employee_id}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 6px', borderRadius: 7 }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--card)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
              >
                <div style={{
                  width: 27, height: 27, borderRadius: 7, background: 'var(--muted)',
                  display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 700, color: T.sub, flexShrink: 0,
                }}>
                  {initials(m.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                  <div style={{ fontSize: 9.5, color: T.muted, fontFamily: T.mono }}>{m.employee_code}</div>
                </div>
                <span style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: ss.bg, color: ss.color, flexShrink: 0 }}>
                  {ss.label}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Quick Actions ─────────────────────────────────────────────────────────────

const QA_ITEMS = [
  { icon: ClipboardList, label: 'Approvals',      sub: 'Inbox',     tone: { bg: '#fffbeb', color: '#f59e0b' }, to: '/manager/approvals'            },
  { icon: Users,         label: 'Muster',          sub: 'Today',     tone: { bg: '#ecfdf5', color: '#10b981' }, to: '/manager/team/attendance'      },
  { icon: Calendar,      label: 'Roster',          sub: 'Planner',   tone: { bg: '#eff6ff', color: '#3b82f6' }, to: '/manager/team/roster'          },
  { icon: Clock,         label: 'Regularisation',  sub: 'Requests',  tone: { bg: '#f3e8ff', color: '#7c3aed' }, to: '/manager/approvals'            },
  { icon: MapPin,        label: 'Leave Calendar',  sub: 'Team view', tone: { bg: '#e3f3fc', color: '#0ea5e9' }, to: '/manager/team/leave-balances'  },
  { icon: BarChart2,     label: 'Reports',         sub: 'Analytics', tone: { bg: '#fff1f2', color: '#f43f5e' }, to: '/manager/reports/team'         },
]

function QuickActionsCard({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow }}>
      <div style={{ padding: '13px 18px', borderBottom: `1px solid ${T.borderL}` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: T.sub }}>Quick Actions</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, padding: '12px 14px 14px' }}>
        {QA_ITEMS.map(qa => {
          const Icon = qa.icon
          return (
            <button
              key={qa.label}
              onClick={() => navigate(qa.to)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
                padding: '10px 10px 10px', borderRadius: 10, border: `1px solid ${T.border}`,
                background: T.card, cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit', transition: 'transform .08s,box-shadow .1s',
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.transform = 'translateY(-1px)'; el.style.boxShadow = '0 4px 12px -4px rgba(15,16,36,.15)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.transform = ''; el.style.boxShadow = '' }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: qa.tone.bg }}>
                <Icon style={{ width: 14, height: 14, color: qa.tone.color }} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text, lineHeight: 1.2 }}>{qa.label}</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>{qa.sub}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Pending Regularisation Card ───────────────────────────────────────────────

function PendingRegularisationCard({ regularisations, navigate }: {
  regularisations: Regularisation[]
  navigate:        ReturnType<typeof useNavigate>
}) {
  const pending = regularisations.slice(0, 4)

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: `1px solid ${T.borderL}` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: T.sub }}>
          Pending Regularisation
        </span>
        <button
          onClick={() => navigate('/manager/approvals')}
          style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 2 }}
        >
          View all <ChevronRight style={{ width: 10, height: 10 }} />
        </button>
      </div>

      <div style={{ padding: '10px 16px 14px' }}>
        {regularisations.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#10b981', fontSize: 12, fontWeight: 600, padding: '6px 2px' }}>
            <Check style={{ width: 14, height: 14 }} />
            No pending regularisations
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
              {regularisations.length} regularisation request{regularisations.length !== 1 ? 's' : ''} pending review
            </div>
            {pending.map(r => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 8px', borderRadius: 7, marginBottom: 3,
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--card)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: T.sub, fontFamily: T.mono }}>
                    {fmtDateFull(r.date)}
                  </div>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 600, marginTop: 1 }}>
                    {regType(r)}
                  </div>
                </div>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                  background: '#fffbeb', color: '#92400e', flexShrink: 0, marginLeft: 8,
                }}>
                  Submitted
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── ManagerDashboardPage (root) ───────────────────────────────────────────────

export function ManagerDashboardPage() {
  const { profile } = useAuthStore()
  const navigate    = useNavigate()
  const qc          = useQueryClient()

  const today      = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const employeeId = profile?.employee_id

  const [dateOffset, setDateOffset] = useState(0)

  const dates = useMemo(() => buildDates(dateOffset), [dateOffset])
  const fromDate = dates[0]

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: empResp } = useQuery({
    queryKey:  ['employee', employeeId],
    queryFn:   () => api.get<{ data: Employee }>(`/employees/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 5 * 60_000,
  })

  const { data: dashResp } = useQuery<ManagerDashboardResponse>({
    queryKey:  ['manager-dashboard', today],
    queryFn:   () => api.get('/manager/dashboard'),
    staleTime: 60_000,
  })

  const { data: approvalsResp } = useQuery<{
    leave_requests:  LeaveRequest[]
    regularisations: Regularisation[]
  }>({
    queryKey:  ['approvals-pending'],
    queryFn:   () => api.get('/approvals/pending?limit=20'),
    staleTime: 60_000,
  })

  const teamMemberIds = dashResp?.team_members?.map(m => m.employee_id) ?? []

  const { data: teamAttendanceRaw } = useQuery({
    queryKey:  ['team-attendance-heatmap', teamMemberIds.join(','), fromDate],
    queryFn:   async () => {
      const to = dates[dates.length - 1]
      return Promise.all(
        teamMemberIds.map(id =>
          api.get<{ daily: AttendanceDailyRow[] }>(`/attendance/${id}?from=${fromDate}&to=${to}`)
            .then(r => ({ id, data: r as { daily: AttendanceDailyRow[] } }))
            .catch(() => ({ id, data: null as { daily: AttendanceDailyRow[] } | null }))
        )
      )
    },
    enabled:   teamMemberIds.length > 0,
    staleTime: 2 * 60_000,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    qc.invalidateQueries({ queryKey: ['approvals-pending'] })
  }

  const { mutate: approveLeave, variables: approvingLeaveId } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/leave/${id}/approve`, {}),
    onSuccess: () => { invalidate(); toast.success('Leave approved') },
    onError:   (e: Error) => toast.error('Failed to approve leave', { description: e.message }),
  })
  const { mutate: rejectLeave } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/leave/${id}/reject`, {}),
    onSuccess: () => { invalidate(); toast.success('Leave rejected') },
    onError:   (e: Error) => toast.error('Failed to reject leave', { description: e.message }),
  })
  const { mutate: approveReg, variables: approvingRegId } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: () => { invalidate(); toast.success('Regularisation approved') },
    onError:   (e: Error) => toast.error('Failed to approve regularisation', { description: e.message }),
  })
  const { mutate: rejectReg } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/reject`, {}),
    onSuccess: () => { invalidate(); toast.success('Regularisation rejected') },
    onError:   (e: Error) => toast.error('Failed to reject regularisation', { description: e.message }),
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const emp           = (empResp as any)?.data ?? (empResp as any) ?? null
  const teamMembers   = dashResp?.team_members   ?? []
  const summary       = dashResp?.today_summary  ?? { present: 0, late: 0, absent: 0, leave: 0, not_marked: 0, total: 0 }
  const leaveRequests   = approvalsResp?.leave_requests  ?? dashResp?.pending?.leave_requests  ?? []
  const regularisations = approvalsResp?.regularisations ?? dashResp?.pending?.regularisations ?? []
  const pendingCount    = leaveRequests.length + regularisations.length

  const teamAttendance = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const item of (teamAttendanceRaw ?? [])) {
      if (!item.data) continue
      const memberMap = new Map<string, string>()
      const daily = (item.data as any)?.daily ?? []
      for (const row of daily as AttendanceDailyRow[]) {
        const s = (row.status ?? 'not_marked').toLowerCase()
          .replace('on_leave', 'leave')
          .replace('weekly_off', 'off')
        memberMap.set(row.date, s)
      }
      map.set(item.id, memberMap)
    }
    return map
  }, [teamAttendanceRaw])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .heatmap-cell:hover {
          transform: scale(1.12) !important;
          border-color: rgba(29,78,216,.3) !important;
          z-index: 1;
        }
      `}</style>

      <div style={{ padding: '18px 22px 36px', background: T.bg, minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Hero card */}
        <CoreIdentity emp={emp} teamSize={summary.total} pendingCount={pendingCount} />

        {/* Team intelligence (read-only; renders nothing when no signals) */}
        <ManagerInsights />

        {/* KPI strip */}
        <KPIStrip summary={summary} pendingLeave={leaveRequests.length} pendingReg={regularisations.length} />

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px]" style={{ gap: 14, alignItems: 'start' }}>

          {/* Main column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ApprovalsQueue
              leaveRequests={leaveRequests}
              regularisations={regularisations}
              navigate={navigate}
              onApproveLeave={id => approveLeave(id)}
              onRejectLeave={id  => rejectLeave(id)}
              onApproveReg={id   => approveReg(id)}
              onRejectReg={id    => rejectReg(id)}
              approvingLeaveId={approvingLeaveId}
              approvingRegId={approvingRegId}
            />
            <TeamHeatmap
              teamMembers={teamMembers}
              teamAttendance={teamAttendance}
              dates={dates}
              dateOffset={dateOffset}
              setDateOffset={setDateOffset}
              navigate={navigate}
            />
          </div>

          {/* Right rail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <TeamAttendanceTodayCard summary={summary} navigate={navigate} />
            <WhosOutCard teamMembers={teamMembers} navigate={navigate} />
            <QuickActionsCard navigate={navigate} />
            <PendingRegularisationCard regularisations={regularisations} navigate={navigate} />
          </div>

        </div>
      </div>
    </>
  )
}
