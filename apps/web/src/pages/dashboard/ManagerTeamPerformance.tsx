/**
 * ManagerTeamPerformance — /manager/team/performance
 *
 * Team attendance-based performance overview for the logged-in manager.
 *
 * Metrics computed per team member over a configurable window (30 / 60 / 90 days):
 *   • Attendance Rate   = present days / working days × 100
 *   • Punctuality Rate  = (working days − late days) / working days × 100
 *   • Avg Daily Hours   = total_work_hours / days_actually_worked
 *   • Performance Tier  = Excellent / Good / Average / Needs Attention
 *
 * Data:
 *   GET /manager/dashboard        — team member list
 *   GET /attendance/:id?from=&to= — daily attendance rows per member (parallel)
 */

import { useMemo, useState }      from 'react'
import { useQuery }               from '@tanstack/react-query'
import {
  TrendingUp, Users, Clock, AlertTriangle,
  CheckCircle2, ChevronUp, ChevronDown, Minus,
} from 'lucide-react'
import { api }          from '@/lib/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember {
  employee_id:   string
  employee_code: string
  name:          string
  status:        string
}

interface DashboardResponse {
  team_members: TeamMember[]
}

interface DailyRow {
  date:       string
  status:     string
  work_hours: number
}

interface AttendanceResp {
  daily: DailyRow[]
}

type Window = 30 | 60 | 90

type Tier = 'excellent' | 'good' | 'average' | 'needs_attention'

interface MemberMetrics {
  employee_id:      string
  employee_code:    string
  name:             string
  workingDays:      number
  presentDays:      number
  lateDays:         number
  absentDays:       number
  leaveDays:        number
  attendanceRate:   number   // 0–100
  punctualityRate:  number   // 0–100
  avgDailyHours:    number
  tier:             Tier
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<Tier, { label: string; bg: string; color: string; dot: string }> = {
  excellent:       { label: 'Excellent',       bg: '#ecfdf5', color: '#0a6d4a', dot: '#10b981' },
  good:            { label: 'Good',            bg: '#eff6ff', color: '#1d4ed8', dot: '#3b82f6' },
  average:         { label: 'Average',         bg: '#fffbeb', color: '#92400e', dot: '#f59e0b' },
  needs_attention: { label: 'Needs Attention', bg: '#fff0f2', color: '#9f1239', dot: '#f43f5e' },
}

const WINDOWS: { value: Window; label: string }[] = [
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDateRange(days: number): { from: string; to: string } {
  const to  = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  }
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z').getDay()
  return d === 0 || d === 6
}

function computeTier(attendanceRate: number, punctualityRate: number): Tier {
  if (attendanceRate >= 95 && punctualityRate >= 90) return 'excellent'
  if (attendanceRate >= 85 && punctualityRate >= 75) return 'good'
  if (attendanceRate >= 70)                          return 'average'
  return 'needs_attention'
}

function computeMetrics(
  member:   TeamMember,
  daily:    DailyRow[],
): MemberMetrics {
  let workingDays   = 0
  let presentDays   = 0
  let lateDays      = 0
  let absentDays    = 0
  let leaveDays     = 0
  let totalHours    = 0
  let workedDaysCnt = 0

  for (const row of daily) {
    // Skip weekends (backend may mark as weekly_off or weekend)
    const s = row.status?.toLowerCase() ?? ''
    if (s === 'weekend' || s === 'weekly_off' || isWeekend(row.date)) continue
    if (s === 'holiday') continue

    workingDays++

    if (s === 'present')   { presentDays++; workedDaysCnt++ }
    else if (s === 'late') { presentDays++; lateDays++; workedDaysCnt++ }
    else if (s === 'half_day' || s === 'early_out' || s === 'on_duty') {
      presentDays++; workedDaysCnt++
    }
    else if (s === 'absent' || s === 'lop') absentDays++
    else if (s === 'leave')                 leaveDays++
    // not_marked / missing_punch → treated as absent for rate computation

    if (row.work_hours > 0) totalHours += row.work_hours
  }

  const attendanceRate  = workingDays > 0 ? (presentDays / workingDays) * 100 : 0
  const punctualityRate = presentDays > 0 ? ((presentDays - lateDays) / presentDays) * 100 : 100
  const avgDailyHours   = workedDaysCnt > 0 ? totalHours / workedDaysCnt : 0

  return {
    employee_id:     member.employee_id,
    employee_code:   member.employee_code,
    name:            member.name,
    workingDays,
    presentDays,
    lateDays,
    absentDays,
    leaveDays,
    attendanceRate,
    punctualityRate,
    avgDailyHours,
    tier:            computeTier(attendanceRate, punctualityRate),
  }
}

function fmt2(n: number) { return (n ?? 0).toFixed(1) }

function RateBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 6, borderRadius: 999,
        background: 'var(--muted)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${Math.min(100, value)}%`,
          background: color, borderRadius: 999,
          transition: 'width .3s ease',
        }} />
      </div>
      <span style={{
        fontSize: 11.5, fontWeight: 700, minWidth: 38, textAlign: 'right',
        fontFamily: '"Geist Mono",ui-monospace,monospace', color,
      }}>
        {fmt2(value)}%
      </span>
    </div>
  )
}

type SortKey = 'name' | 'attendanceRate' | 'punctualityRate' | 'avgDailyHours' | 'tier'

// ── Component ─────────────────────────────────────────────────────────────────

export function ManagerTeamPerformance() {
  const [win,     setWin]     = useState<Window>(30)
  const [sortKey, setSortKey] = useState<SortKey>('attendanceRate')
  const [sortAsc, setSortAsc] = useState(false)

  const { from, to } = useMemo(() => buildDateRange(win), [win])

  // ── Team members ────────────────────────────────────────────────────────────
  const { data: dashResp, isLoading: dashLoading } = useQuery<DashboardResponse>({
    queryKey:  ['manager-dashboard-perf'],
    queryFn:   () => api.get('/manager/dashboard'),
    staleTime: 2 * 60_000,
  })

  const teamMembers = useMemo(() => dashResp?.team_members ?? [], [dashResp])

  // ── Per-member attendance (parallel) ────────────────────────────────────────
  const { data: rawAttendance, isLoading: attLoading } = useQuery({
    queryKey:  ['team-attendance-perf', teamMembers.map(m => m.employee_id).join(','), from, to],
    queryFn:   async () => {
      const results = await Promise.all(
        teamMembers.map(m =>
          api.get<AttendanceResp>(`/attendance/${m.employee_id}?from=${from}&to=${to}`)
            .then(r => ({ id: m.employee_id, daily: r?.daily ?? [] }))
            .catch(() => ({ id: m.employee_id, daily: [] as DailyRow[] }))
        )
      )
      return results
    },
    enabled:   teamMembers.length > 0,
    staleTime: 5 * 60_000,
  })

  const loading = dashLoading || attLoading

  // ── Compute metrics ─────────────────────────────────────────────────────────
  const metrics: MemberMetrics[] = useMemo(() => {
    if (!rawAttendance || teamMembers.length === 0) return []
    const attMap = new Map(rawAttendance.map(r => [r.id, r.daily as DailyRow[]]))
    return teamMembers.map(m => computeMetrics(m, attMap.get(m.employee_id) ?? []))
  }, [rawAttendance, teamMembers])

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const TIER_ORDER: Record<Tier, number> = { excellent: 0, good: 1, average: 2, needs_attention: 3 }
    return [...metrics].sort((a, b) => {
      let diff = 0
      if (sortKey === 'name')             diff = a.name.localeCompare(b.name)
      else if (sortKey === 'tier')        diff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
      else                               diff = (a[sortKey] as number) - (b[sortKey] as number)
      return sortAsc ? diff : -diff
    })
  }, [metrics, sortKey, sortAsc])

  // ── Summary KPIs ────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (metrics.length === 0) return null
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
    return {
      avgAttendance:  avg(metrics.map(m => m.attendanceRate)),
      avgPunctuality: avg(metrics.map(m => m.punctualityRate)),
      excellent:      metrics.filter(m => m.tier === 'excellent').length,
      needsAttention: metrics.filter(m => m.tier === 'needs_attention').length,
    }
  }, [metrics])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <Minus className="h-3 w-3 opacity-30" />
    return sortAsc
      ? <ChevronUp   className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3" />
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 28px 40px', background: 'var(--muted)', minHeight: '100%' }}>

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--foreground)' }}>
            Team Performance
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            Attendance-based performance metrics · {teamMembers.length} direct report{teamMembers.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Window selector */}
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map(w => (
            <button
              key={w.value}
              onClick={() => setWin(w.value)}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
                border: `1px solid ${win === w.value ? '#1d4ed8' : 'var(--border)'}`,
                background: win === w.value ? '#eff6ff' : 'var(--card)',
                color: win === w.value ? '#1d4ed8' : 'var(--muted-foreground)',
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary KPI strip ─────────────────────────────────────────── */}
      {!loading && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
          {[
            {
              icon: TrendingUp,
              label: 'Avg Attendance',
              value: `${fmt2(summary.avgAttendance)}%`,
              color: '#1d4ed8',
              bg: '#eff6ff',
            },
            {
              icon: Clock,
              label: 'Avg Punctuality',
              value: `${fmt2(summary.avgPunctuality)}%`,
              color: '#0ea5e9',
              bg: '#e3f3fc',
            },
            {
              icon: CheckCircle2,
              label: 'Excellent Performers',
              value: summary.excellent,
              color: '#10b981',
              bg: '#ecfdf5',
            },
            {
              icon: AlertTriangle,
              label: 'Needs Attention',
              value: summary.needsAttention,
              color: summary.needsAttention > 0 ? '#f43f5e' : 'var(--muted-foreground)',
              bg: summary.needsAttention > 0 ? '#fff0f2' : 'var(--muted)',
            },
          ].map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
              padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14,
              boxShadow: '0 1px 0 rgba(15,16,36,.04)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11, background: bg,
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>
                <Icon style={{ width: 18, height: 18, color }} />
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  {label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: '"Geist Mono",ui-monospace,monospace', letterSpacing: '-.02em', lineHeight: 1.2, marginTop: 2 }}>
                  {value}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Performance table ─────────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 1px 0 rgba(15,16,36,.04)',
        overflow: 'hidden',
      }}>

        {/* Table head */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 110px 140px 140px 110px 130px',
          gap: 0,
          padding: '10px 22px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
        }}>
          {([
            { key: 'name',            label: 'Member'           },
            { key: null,              label: 'Worked / Days'    },
            { key: 'attendanceRate',  label: 'Attendance'       },
            { key: 'punctualityRate', label: 'Punctuality'      },
            { key: 'avgDailyHours',   label: 'Avg Hours/Day'    },
            { key: 'tier',            label: 'Performance Tier' },
          ] as { key: SortKey | null; label: string }[]).map(col => (
            <div
              key={col.label}
              onClick={col.key ? () => toggleSort(col.key!) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 10.5, fontWeight: 700, color: 'var(--muted-foreground)',
                letterSpacing: '.1em', textTransform: 'uppercase',
                cursor: col.key ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              {col.label}
              {col.key && <SortIcon k={col.key} />}
            </div>
          ))}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div style={{ padding: '16px 22px' }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{
                height: 52, borderRadius: 8, background: 'var(--muted)',
                marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && sorted.length === 0 && (
          <div style={{
            padding: '48px 22px', textAlign: 'center',
            color: 'var(--muted-foreground)', fontSize: 14,
          }}>
            <Users style={{ width: 40, height: 40, opacity: .25, margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: 15 }}>No direct reports found</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Contact HR if your team hasn't been assigned yet.</div>
          </div>
        )}

        {/* Data rows */}
        {!loading && sorted.map((m, idx) => {
          const tc = TIER_CONFIG[m.tier]
          const attColor  = m.attendanceRate >= 85 ? '#10b981' : m.attendanceRate >= 70 ? '#f59e0b' : '#f43f5e'
          const puncColor = m.punctualityRate >= 90 ? '#10b981' : m.punctualityRate >= 75 ? '#f59e0b' : '#f43f5e'

          return (
            <div
              key={m.employee_id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 110px 140px 140px 110px 130px',
                gap: 0,
                padding: '12px 22px',
                borderBottom: idx < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
                transition: 'background .1s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--muted)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
            >
              {/* Member */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)',
                  color: '#1d4ed8', display: 'grid', placeItems: 'center',
                  fontSize: 10.5, fontWeight: 700,
                }}>
                  {m.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.2 }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', fontFamily: '"Geist Mono",ui-monospace,monospace', marginTop: 1 }}>
                    {m.employee_code}
                  </div>
                </div>
              </div>

              {/* Worked / Working days */}
              <div style={{ fontSize: 13, fontFamily: '"Geist Mono",ui-monospace,monospace' }}>
                <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{m.presentDays}</span>
                <span style={{ color: 'var(--muted-foreground)' }}> / {m.workingDays}d</span>
              </div>

              {/* Attendance rate */}
              <div style={{ paddingRight: 12 }}>
                <RateBar value={m.attendanceRate} color={attColor} />
              </div>

              {/* Punctuality rate */}
              <div style={{ paddingRight: 12 }}>
                <RateBar value={m.punctualityRate} color={puncColor} />
              </div>

              {/* Avg hours */}
              <div style={{ fontSize: 13, fontFamily: '"Geist Mono",ui-monospace,monospace' }}>
                <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{fmt2(m.avgDailyHours)}</span>
                <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}> hrs</span>
                {m.lateDays > 0 && (
                  <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>
                    {m.lateDays} late day{m.lateDays !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Tier badge */}
              <div>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 999,
                  background: tc.bg, color: tc.color,
                  fontSize: 11, fontWeight: 700,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: tc.dot, flexShrink: 0,
                    boxShadow: `0 0 0 3px ${tc.bg}`,
                  }} />
                  {tc.label}
                </span>
              </div>

            </div>
          )
        })}

      </div>

      {/* ── Legend / footnote ──────────────────────────────────────────── */}
      {!loading && sorted.length > 0 && (
        <div style={{
          marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 20,
          fontSize: 11.5, color: 'var(--muted-foreground)',
        }}>
          {Object.entries(TIER_CONFIG).map(([, tc]) => (
            <div key={tc.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tc.dot, flexShrink: 0 }} />
              <span style={{ color: 'var(--muted-foreground)', fontWeight: 600 }}>{tc.label}</span>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 10.5 }}>
            Weekends & public holidays excluded · Based on attendance records
          </span>
        </div>
      )}

    </div>
  )
}
