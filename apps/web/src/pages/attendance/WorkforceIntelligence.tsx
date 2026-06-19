/**
 * WorkforceIntelligence — /admin/intelligence
 *
 * AI-Assisted Workforce Intelligence dashboard.
 * Uses rule-based heuristics from the backend intelligence engine to surface:
 *   - At-risk employees ranked by risk score
 *   - Daily anomaly trend sparkline
 *   - Anomaly breakdown by type and severity
 *   - Active risk flags with dismiss action
 *   - Summary KPIs
 *
 * Access: hr_admin / super_admin only.
 * Design: design-system tokens only — no raw hex / bg-gray-*.
 */

import { useState }                               from 'react'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  AlertTriangle, Brain, RefreshCw, Shield, ShieldOff,
  TrendingUp, Users, CheckCircle2, Loader2, Activity,
  ChevronDown, ChevronUp, X, ShieldAlert,
} from 'lucide-react'

import { toast }          from 'sonner'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import {
  getChartColor, getAxisStyle, getGridStyle, getTooltipStyle,
} from '@/components/ui/chart'

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntelSummary {
  period_from:         string
  period_to:           string
  total_employees:     number
  at_risk_count:       number
  open_anomalies:      number
  resolved_anomalies:  number
  avg_risk_score:      number
  computed_at:         string
}

interface AtRiskEmployee {
  employee_id:   string
  name:          string
  employee_code: string
  risk_score:    number
  reasons:       string[]
  anomaly_count: number
  flag_types:    string[]
}

interface DailyTrend {
  date:      string
  open:      number
  resolved:  number
  total:     number
}

interface IntelData {
  summary:   IntelSummary
  at_risk:   AtRiskEmployee[]
  trends: {
    daily:               DailyTrend[]
    anomaly_by_type:     Record<string, number>
    anomaly_by_severity: Record<string, number>
  }
  patterns: {
    repeat_offenders:  AtRiskEmployee[]
    top_anomaly_types: Array<{ type: string; count: number; pct: number }>
  }
}

interface IntelResponse {
  data:         IntelData
  cached:       boolean
  computed_at?: string
}

interface RiskFlag {
  id:               string
  flag_type:        string
  risk_score:       number
  details:          { reasons?: string[]; anomaly_count?: number } | null
  first_flagged:    string
  last_updated:     string
  dismissed:        boolean
  dismissed_at:     string | null
  dismiss_note:     string | null
  employee_id:      string | null
  employee_name:    string | null
  employee_code:    string | null
  dismissed_by_name: string | null
}

interface FlagsResponse {
  data:   RiskFlag[]
  total:  number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FLAG_LABEL: Record<string, string> = {
  chronic_late:        'Chronic Late',
  frequent_no_punch:   'Frequent No-Punch',
  high_anomaly_rate:   'High Anomaly Rate',
  excessive_leave:     'Excessive Leave',
  absent_streak:       'Absent Streak',
  low_attendance:      'Low Attendance',
}

const ANOMALY_TYPE_LABEL: Record<string, string> = {
  missing_out:      'Missing OUT',
  no_punch:         'No Punch',
  late:             'Late Arrival',
  excessive_hours:  'Excessive Hours',
}

function riskVariant(score: number): 'destructive' | 'warning' | 'secondary' | 'success' {
  if (score >= 70) return 'destructive'
  if (score >= 40) return 'warning'
  if (score >= 15) return 'secondary'
  return 'success'
}

function riskLabel(score: number): string {
  if (score >= 70) return 'Critical'
  if (score >= 40) return 'High'
  if (score >= 15) return 'Medium'
  return 'Low'
}

function fmtDate(iso: string) {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function fmtDatetime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, colorCls,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  colorCls: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3">
      <div className={cn('p-2 rounded-lg bg-muted/60', colorCls)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={cn('text-2xl font-bold leading-none mt-0.5', colorCls)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  )
}

function RiskScoreBar({ score }: { score: number }) {
  const cls =
    score >= 70 ? 'bg-destructive' :
    score >= 40 ? 'bg-warning' :
    score >= 15 ? 'bg-muted-foreground' :
                  'bg-success'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', cls)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums text-muted-foreground w-8 text-right">{score}</span>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function WorkforceIntelligence() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [flagFilter,  setFlagFilter]  = useState('')
  const [dismissId,   setDismissId]   = useState<string | null>(null)
  const [dismissNote, setDismissNote] = useState('')

  // ── Intel snapshot query ────────────────────────────────────────────────────
  const {
    data: intelResp,
    isLoading: intelLoading,
    refetch: refetchIntel,
  } = useQuery<IntelResponse>({
    queryKey: ['intelligence'],
    queryFn:  () => api.get('/attendance/intelligence'),
    enabled:  isAdmin,
    staleTime: 5 * 60_000,  // snapshot is valid for 5 min before showing stale
  })

  const intel      = intelResp?.data
  const isCached   = intelResp?.cached ?? false
  const computedAt = intelResp?.computed_at ?? intel?.summary.computed_at

  // ── Compute mutation ────────────────────────────────────────────────────────
  const computeMutation = useMutation({
    mutationFn: () => api.post<IntelResponse>('/attendance/intelligence/compute', {}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['intelligence'] })
      toast.success('Intelligence recomputed', { description: 'Risk scores and trend data have been refreshed.' })
    },
    onError: (e: Error) => toast.error('Compute failed', { description: e.message }),
  })

  // ── Risk flags query ────────────────────────────────────────────────────────
  const { data: flagsResp, refetch: refetchFlags } = useQuery<FlagsResponse>({
    queryKey: ['intelligence-flags'],
    queryFn:  () => api.get('/attendance/intelligence/flags?dismissed=false&limit=100'),
    enabled:  isAdmin,
    staleTime: 2 * 60_000,
  })

  // ── Dismiss mutation ────────────────────────────────────────────────────────
  const dismissMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.post(`/attendance/intelligence/flags/${id}/dismiss`, { note }),
    onSuccess: () => {
      setDismissId(null)
      setDismissNote('')
      refetchFlags()
      toast.success('Risk flag dismissed')
    },
    onError: (e: Error) => toast.error('Failed to dismiss flag', { description: e.message }),
  })

  // ── Derived chart data ──────────────────────────────────────────────────────
  const trendData = (intel?.trends.daily ?? []).slice(-14).map(d => ({
    date:     fmtDate(d.date),
    Open:     d.open,
    Resolved: d.resolved,
  }))

  const typeData = Object.entries(intel?.trends.anomaly_by_type ?? {}).map(([type, count]) => ({
    name:  ANOMALY_TYPE_LABEL[type] ?? type,
    value: count,
  }))

  const sevData = Object.entries(intel?.trends.anomaly_by_severity ?? {}).map(([sev, count]) => ({
    name:  sev.charAt(0).toUpperCase() + sev.slice(1),
    value: count,
    fill:  sev === 'high' ? 'var(--color-destructive)' : sev === 'medium' ? 'var(--color-warning)' : 'var(--color-muted-foreground)',
  }))

  const filteredFlags = (flagsResp?.data ?? []).filter(f =>
    !flagFilter ||
    f.employee_name?.toLowerCase().includes(flagFilter.toLowerCase()) ||
    f.employee_code?.toLowerCase().includes(flagFilter.toLowerCase()) ||
    FLAG_LABEL[f.flag_type]?.toLowerCase().includes(flagFilter.toLowerCase())
  )

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Workforce Intelligence" subtitle="AI-assisted attendance risk analysis" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">Access restricted to HR admins</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const summary = intel?.summary

  return (
    <PageContainer>
      <PageHeader
        title="Workforce Intelligence"
        subtitle={
          computedAt
            ? `Last computed ${fmtDatetime(computedAt)}${isCached ? ' · cached' : ''}`
            : 'AI-assisted attendance risk analysis'
        }
        actions={
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
          >
            {computeMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Recompute
          </Button>
        }
      />

      {/* KPI row */}
      {(intelLoading && !intel) ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analysing attendance data…
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <KpiCard
              label="At-Risk Employees"
              value={summary.at_risk_count}
              sub={`of ${summary.total_employees} active`}
              icon={AlertTriangle}
              colorCls="text-destructive"
            />
            <KpiCard
              label="Open Anomalies"
              value={summary.open_anomalies}
              sub={`${summary.resolved_anomalies} resolved`}
              icon={Activity}
              colorCls="text-warning"
            />
            <KpiCard
              label="Avg Risk Score"
              value={`${summary.avg_risk_score}/100`}
              sub={riskLabel(summary.avg_risk_score)}
              icon={Brain}
              colorCls={summary.avg_risk_score >= 40 ? 'text-destructive' : 'text-success'}
            />
            <KpiCard
              label="Active Flags"
              value={flagsResp?.total ?? '…'}
              sub="Unacknowledged"
              icon={Shield}
              colorCls="text-warning"
            />
          </div>

          {/* Trend + Breakdown row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

            {/* Daily trend (2/3 width) */}
            <SectionCard
              title="Anomaly Trend (Last 14 Days)"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              className="lg:col-span-2"
            >
              {trendData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No anomaly data in this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid {...getGridStyle()} />
                    <XAxis dataKey="date" {...getAxisStyle()} />
                    <YAxis  {...getAxisStyle()} allowDecimals={false} />
                    <Tooltip contentStyle={getTooltipStyle()} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area
                      type="monotone" dataKey="Open"
                      stroke="var(--color-destructive)" fill="var(--color-destructive)"
                      fillOpacity={0.15} strokeWidth={1.5}
                    />
                    <Area
                      type="monotone" dataKey="Resolved"
                      stroke="var(--color-success)" fill="var(--color-success)"
                      fillOpacity={0.12} strokeWidth={1.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            {/* Severity breakdown */}
            <SectionCard
              title="By Severity"
              icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            >
              {sevData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={sevData}
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={75}
                      dataKey="value"
                      label={({ name, value }) => `${name} (${value})`}
                      labelLine={false}
                    >
                      {sevData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={getTooltipStyle()} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          {/* Type breakdown */}
          {typeData.length > 0 && (
            <SectionCard
              title="Anomaly Types"
              icon={<Brain className="h-4 w-4 text-muted-foreground" />}
              className="mb-4"
            >
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={typeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} layout="vertical">
                  <CartesianGrid {...getGridStyle()} horizontal={false} />
                  <XAxis type="number" {...getAxisStyle()} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} {...getAxisStyle()} />
                  <Tooltip contentStyle={getTooltipStyle()} />
                  <Bar dataKey="value" fill={getChartColor('chart1')} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}

          {/* At-risk employees list */}
          <SectionCard
            title={`At-Risk Employees (${intel?.at_risk.length ?? 0})`}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            className="mb-4"
          >
            {(intel?.at_risk ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 opacity-40" />
                <p className="text-sm">No at-risk employees detected in this period.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {(intel?.at_risk ?? []).map(emp => {
                  const expanded = expandedEmp === emp.employee_id
                  return (
                    <div
                      key={emp.employee_id}
                      className="border border-border rounded-lg overflow-hidden"
                    >
                      {/* Header row */}
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedEmp(expanded ? null : emp.employee_id)}
                      >
                        {/* Risk score badge */}
                        <Badge
                          variant={riskVariant(emp.risk_score)}
                          className="rounded-full text-[10px] w-16 justify-center flex-shrink-0"
                        >
                          {riskLabel(emp.risk_score)}
                        </Badge>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground">{emp.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">#{emp.employee_code}</span>
                        </div>

                        {/* Risk bar */}
                        <div className="w-32 hidden sm:block">
                          <RiskScoreBar score={emp.risk_score} />
                        </div>

                        {/* Anomaly count */}
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {emp.anomaly_count} anomalie{emp.anomaly_count !== 1 ? 's' : ''}
                        </span>

                        {/* Expand icon */}
                        {expanded
                          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        }
                      </button>

                      {/* Expanded detail */}
                      {expanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-border bg-muted/20 space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {emp.flag_types.map(ft => (
                              <Badge key={ft} variant="outline" className="rounded-full text-[10px]">
                                {FLAG_LABEL[ft] ?? ft}
                              </Badge>
                            ))}
                          </div>
                          <ul className="space-y-1">
                            {emp.reasons.map((r, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <AlertTriangle className="h-3 w-3 text-warning flex-shrink-0" />
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {/* Active risk flags table */}
          <SectionCard
            title={`Active Risk Flags (${flagsResp?.total ?? 0})`}
            icon={<Shield className="h-4 w-4 text-muted-foreground" />}
          >
            {/* Filter */}
            <div className="mb-3">
              <Input
                placeholder="Filter by name, code or flag type…"
                value={flagFilter}
                onChange={e => setFlagFilter(e.target.value)}
                className="h-8 text-xs max-w-xs"
              />
            </div>

            {filteredFlags.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <ShieldOff className="h-6 w-6 opacity-40" />
                <p className="text-xs">No active flags{flagFilter ? ' matching filter' : ''}.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Employee', 'Flag', 'Risk Score', 'Reasons', 'Since', ''].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFlags.map(flag => (
                      <tr key={flag.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <span className="font-medium">{flag.employee_name ?? '—'}</span>
                          {flag.employee_code && (
                            <span className="text-muted-foreground ml-1">#{flag.employee_code}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="rounded-full text-[10px] whitespace-nowrap">
                            {FLAG_LABEL[flag.flag_type] ?? flag.flag_type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 w-28">
                          <RiskScoreBar score={flag.risk_score} />
                        </td>
                        <td className="px-3 py-2 max-w-[220px]">
                          {(flag.details?.reasons ?? []).length > 0 ? (
                            <ul className="space-y-0.5">
                              {(flag.details?.reasons ?? []).slice(0, 2).map((r, i) => (
                                <li key={i} className="text-muted-foreground truncate">{r}</li>
                              ))}
                              {(flag.details?.reasons ?? []).length > 2 && (
                                <li className="text-muted-foreground/60">+{(flag.details?.reasons ?? []).length - 2} more</li>
                              )}
                            </ul>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                          {fmtDate(flag.first_flagged)}
                        </td>
                        <td className="px-3 py-2">
                          {dismissId === flag.id ? (
                            <div className="flex items-center gap-1.5">
                              <Input
                                placeholder="Note (optional)"
                                value={dismissNote}
                                onChange={e => setDismissNote(e.target.value)}
                                className="h-6 text-[10px] w-32"
                              />
                              <Button
                                size="sm"
                                className="h-6 text-[10px] px-2"
                                disabled={dismissMutation.isPending}
                                onClick={() => dismissMutation.mutate({ id: flag.id, note: dismissNote || undefined })}
                              >
                                {dismissMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'OK'}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-1"
                                onClick={() => { setDismissId(null); setDismissNote('') }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                              onClick={() => { setDismissId(flag.id); setDismissNote('') }}
                            >
                              Dismiss
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      ) : (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Brain className="h-10 w-10 opacity-30" />
            <p className="text-sm">No intelligence data yet.</p>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => computeMutation.mutate()}
              disabled={computeMutation.isPending}
            >
              {computeMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Computing…</>
                : 'Run Analysis'}
            </Button>
          </div>
        </SectionCard>
      )}

      <button
        type="button"
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground mt-4 ml-auto"
        onClick={() => refetchIntel()}
      >
        <RefreshCw className="h-3 w-3" />
        Refresh cached snapshot
      </button>
    </PageContainer>
  )
}
