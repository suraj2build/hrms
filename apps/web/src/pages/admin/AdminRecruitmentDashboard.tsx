import type React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Users, Briefcase, Clock, CheckCircle2, ChevronRight,
  TrendingUp, CalendarCheck, AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  funnel: {
    applied: number; screening: number; interviewing: number
    offer: number; hired: number; rejected: number; withdrawn: number
  }
  avg_time_to_hire:  number | null
  avg_time_to_offer: number | null
  requisitions:  { draft: number; open: number; on_hold: number; filled: number; cancelled: number }
  interviews:    { scheduled: number; completed: number; cancelled: number; no_show: number }
  pass_rate:     number | null
  source_breakdown: Array<{ source: string; count: number }>
  recent_30d_applications: number
  total_applications:      number
  total_requisitions:      number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(a: number, b: number) {
  return b === 0 ? '—' : `${Math.round((a / b) * 100)}%`
}

const EMPTY_FUNNEL     = { applied: 0, screening: 0, interviewing: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 }
const EMPTY_REQS       = { draft: 0, open: 0, on_hold: 0, filled: 0, cancelled: 0 }
const EMPTY_INTERVIEWS = { scheduled: 0, completed: 0, cancelled: 0, no_show: 0 }

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct', referral: 'Referral', portal: 'Job Portal',
  agency: 'Agency', linkedin: 'LinkedIn', naukri: 'Naukri',
  indeed: 'Indeed', other: 'Other',
}

const FUNNEL_STEPS: Array<{ key: keyof AnalyticsData['funnel']; label: string; color: string }> = [
  { key: 'applied',      label: 'Applied',      color: '#2E6FE6' },
  { key: 'screening',    label: 'Screening',    color: '#3B82F6' },
  { key: 'interviewing', label: 'Interviewing', color: '#8B5CF6' },
  { key: 'offer',        label: 'Offer',        color: '#F59E0B' },
  { key: 'hired',        label: 'Hired',        color: '#15B8A6' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: 'blue' | 'teal' | 'amber' | 'violet'
}) {
  const ring = {
    blue:   'bg-info/10 text-info',
    teal:   'bg-accent-teal/10 text-accent-teal',
    amber:  'bg-warning/10 text-warning',
    violet: 'bg-accent-violet/10 text-accent-violet',
  }[color]

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-xl p-3 ${ring}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function FunnelStep({ label, count, total, color, isLast }: {
  label: string; count: number; total: number; color: string; isLast: boolean
}) {
  const width = total === 0 ? 0 : Math.max(8, Math.round((count / total) * 100))
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-right text-xs text-muted-foreground shrink-0">{label}</div>
      <div className="flex-1 relative h-8 bg-muted/40 rounded overflow-hidden">
        <div
          className="h-full rounded transition-all duration-700"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
        <span className="absolute inset-0 flex items-center px-3 text-xs font-semibold text-foreground">
          {count.toLocaleString()}
        </span>
      </div>
      {!isLast && (
        <div className="text-xs text-muted-foreground w-10 shrink-0 text-center">
          <ChevronRight className="h-4 w-4 mx-auto opacity-40" />
        </div>
      )}
      {isLast && <div className="w-10 shrink-0" />}
    </div>
  )
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-16" />
      </CardContent>
    </Card>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AdminRecruitmentDashboard() {
  const { data: raw, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ['recruitment', 'analytics'],
    queryFn:  () => api.get<AnalyticsData>('/recruitment/analytics'),
    staleTime: 60_000,
  })

  // Normalize the payload so partial/missing data can never crash the render
  // (the nested funnel/requisitions/interviews objects are always present).
  const d: AnalyticsData | undefined = raw
    ? {
        funnel:       { ...EMPTY_FUNNEL, ...raw.funnel },
        requisitions: { ...EMPTY_REQS, ...raw.requisitions },
        interviews:   { ...EMPTY_INTERVIEWS, ...raw.interviews },
        source_breakdown:        raw.source_breakdown ?? [],
        avg_time_to_hire:        raw.avg_time_to_hire ?? null,
        avg_time_to_offer:       raw.avg_time_to_offer ?? null,
        pass_rate:               raw.pass_rate ?? null,
        recent_30d_applications: raw.recent_30d_applications ?? 0,
        total_applications:      raw.total_applications ?? 0,
        total_requisitions:      raw.total_requisitions ?? 0,
      }
    : undefined

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <AlertCircle className="h-5 w-5" />
        <span>Failed to load analytics data</span>
      </div>
    )
  }

  const totalActive = d ? d.funnel.applied + d.funnel.screening + d.funnel.interviewing + d.funnel.offer : 0
  const sourceData = (d?.source_breakdown ?? []).map(s => ({
    name: SOURCE_LABELS[s.source] ?? s.source,
    count: s.count,
  }))

  const reqTotal = d ? Object.values(d.requisitions).reduce((a, b) => a + b, 0) : 0
  const reqRows = d ? [
    { label: 'Open',      count: d.requisitions.open,      color: '#2E6FE6' },
    { label: 'Draft',     count: d.requisitions.draft,     color: '#94a3b8' },
    { label: 'On Hold',   count: d.requisitions.on_hold,   color: '#F59E0B' },
    { label: 'Filled',    count: d.requisitions.filled,    color: '#15B8A6' },
    { label: 'Cancelled', count: d.requisitions.cancelled, color: '#ef4444' },
  ] : []

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recruitment Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Hiring funnel, pipeline health &amp; interview analytics</p>
        </div>
        {d && (
          <Badge variant="outline" className="text-xs">
            {d.recent_30d_applications} applications in last 30 days
          </Badge>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard
              icon={Users}
              label="Total Applications"
              value={d?.total_applications ?? 0}
              sub={`${totalActive} active in pipeline`}
              color="blue"
            />
            <KpiCard
              icon={Briefcase}
              label="Open Roles"
              value={d?.requisitions.open ?? 0}
              sub={`${d?.total_requisitions ?? 0} total requisitions`}
              color="violet"
            />
            <KpiCard
              icon={Clock}
              label="Avg Time to Hire"
              value={d?.avg_time_to_hire != null ? `${d.avg_time_to_hire}d` : '—'}
              sub={d?.avg_time_to_offer != null ? `${d.avg_time_to_offer}d to offer` : 'No hires yet'}
              color="amber"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Interview Pass Rate"
              value={d?.pass_rate != null ? `${d.pass_rate}%` : '—'}
              sub={`${(d?.interviews.completed ?? 0)} interviews completed`}
              color="teal"
            />
          </>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Application Funnel — 3 cols */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Application Funnel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 flex-1" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))
            ) : d ? (
              <>
                {FUNNEL_STEPS.map((step, idx) => (
                  <FunnelStep
                    key={step.key}
                    label={step.label}
                    count={d.funnel[step.key]}
                    total={d.funnel.applied}
                    color={step.color}
                    isLast={idx === FUNNEL_STEPS.length - 1}
                  />
                ))}
                <div className="pt-2 border-t grid grid-cols-3 gap-3 text-xs">
                  <div className="text-center">
                    <p className="font-semibold text-base">{pct(d.funnel.screening, d.funnel.applied)}</p>
                    <p className="text-muted-foreground">Applied → Screening</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-base">{pct(d.funnel.offer, d.funnel.interviewing)}</p>
                    <p className="text-muted-foreground">Interview → Offer</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-base">{pct(d.funnel.hired, d.funnel.offer)}</p>
                    <p className="text-muted-foreground">Offer → Hired</p>
                  </div>
                </div>
                <div className="pt-1 flex gap-4 text-xs text-muted-foreground">
                  <span className="text-destructive">✕ {d.funnel.rejected} rejected</span>
                  <span>↩ {d.funnel.withdrawn} withdrawn</span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Source Breakdown — 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Source Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : sourceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={sourceData} layout="vertical" margin={{ left: 8, right: 24, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{ fontSize: 12, border: '1px solid hsl(var(--border))' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {sourceData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={['#2E6FE6','#15B8A6','#8B5CF6','#F59E0B','#ef4444','#06b6d4','#10b981','#6b7280'][i % 8]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">No candidate data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Interviews + Requisitions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Interview Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
              Interview Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : d ? (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Scheduled', count: d.interviews.scheduled, color: 'text-info bg-info/10' },
                  { label: 'Completed', count: d.interviews.completed, color: 'text-accent-teal bg-accent-teal/10' },
                  { label: 'Cancelled', count: d.interviews.cancelled, color: 'text-destructive bg-destructive/10' },
                  { label: 'No Show',   count: d.interviews.no_show,   color: 'text-warning bg-warning/10' },
                ].map(item => (
                  <div key={item.label} className={`rounded-lg p-3 ${item.color}`}>
                    <p className="text-2xl font-bold">{item.count}</p>
                    <p className="text-xs mt-0.5 opacity-80">{item.label}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {d?.pass_rate != null && (
              <div className="mt-4 pt-3 border-t">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Scorecard pass rate</span>
                  <span className="font-semibold text-foreground">{d.pass_rate}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success rounded-full transition-all duration-700"
                    style={{ width: `${d.pass_rate}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Requisition Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Requisition Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-4 w-6" />
                </div>
              ))
            ) : d ? (
              <>
                {reqRows.map(row => (
                  <div key={row.label} className="flex items-center gap-3 text-sm">
                    <span className="w-20 text-muted-foreground text-xs">{row.label}</span>
                    <div className="flex-1 bg-muted/40 rounded h-5 overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-700"
                        style={{
                          width: reqTotal === 0 ? '0%' : `${Math.max(4, Math.round((row.count / reqTotal) * 100))}%`,
                          backgroundColor: row.color,
                          opacity: row.count === 0 ? 0 : 1,
                        }}
                      />
                    </div>
                    <span className="w-6 text-right text-xs font-medium tabular-nums">{row.count}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">{reqTotal} total requisitions</p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
