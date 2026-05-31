/**
 * WorkforceOperationsCenter — /admin/workforce/center
 *
 * Workforce & People Operations Command Center.
 *
 * Answers immediately:
 *   Is the org growing or shrinking? Who needs attention?
 *   What is the onboarding pipeline state? Who is at risk?
 *
 * Layout:
 *   1. Org Health Strip     (org state · headcount · growth signal)
 *   2. Compact KPI Row      (8 chips, colour-coded)
 *   3. Two-column grid
 *      Left  (lg:col-span-2) — Attention Queue · Distribution Charts · Operational Tools
 *      Right (lg:col-span-1) — Onboarding Pipeline · Workforce Signals · Org Timeline
 */

import { useMemo, useState }  from 'react'
import { Link, useNavigate }  from 'react-router-dom'
import { useQuery }           from '@tanstack/react-query'
import {
  Users, UserPlus, UserMinus, AlertTriangle,
  Building2, Brain,
  ChevronRight, ChevronDown,
  CheckCircle2, XCircle, ArrowRight,
  Activity, FolderUp, BarChart2,
  LayoutGrid, PieChart, UserCog,
} from 'lucide-react'

import { PageContainer }       from '@/components/layout/PageContainer'
import { PageHeader }          from '@/components/layout/PageHeader'
import { SectionCard }         from '@/components/layout/SectionCard'
import { OperationalTimeline } from '@/components/workspace/OperationalTimeline'
import type { TimelineEvent }  from '@/components/workspace/OperationalTimeline'
import { Button }              from '@/components/ui/button'
import { Badge }               from '@/components/ui/badge'
import { api }                 from '@/lib/api/client'
import { useAuthStore }        from '@/stores/authStore'
import { cn }                  from '@/lib/utils'
import {
  getChartColor,
  getAxisStyle,
  getGridStyle,
  getTooltipStyle,
} from '@/components/ui/chart'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPieChart, Pie, Cell,
} from 'recharts'

import type { DashboardStats } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntelSummary {
  at_risk_count:  number
  open_anomalies: number
  avg_risk_score: number
  computed_at:    string
}

interface AtRiskEmployee {
  employee_id:   string
  name:          string
  employee_code: string
  risk_score:    number
  reasons:       string[]
  flag_types:    string[]
}

interface IntelData {
  summary:   IntelSummary
  at_risk:   AtRiskEmployee[]
  trends?:   unknown
  patterns?: unknown
}

interface OnboardingStats {
  total_sessions:       number
  pending_review:       number
  extraction_failed:    number
  approved_this_month:  number
  rejected:             number
  draft_ready?:         number
  active?:              number
}

// ── Org state derivation ───────────────────────────────────────────────────────

type OrgState = 'growth' | 'stable' | 'attrition' | 'onboarding-pressure' | 'risk'

const ORG_STATE_CONFIG: Record<OrgState, {
  label:       string
  description: string
  dotCls:      string
  borderCls:   string
  bgCls:       string
  textCls:     string
}> = {
  growth: {
    label:       'Growth Mode',
    description: 'Headcount is expanding — new joiners exceed exits.',
    dotCls:      'bg-success',
    borderCls:   'border-success/20',
    bgCls:       'bg-success/[0.06]',
    textCls:     'text-success',
  },
  stable: {
    label:       'Stable',
    description: 'Headcount is steady — workforce is in equilibrium.',
    dotCls:      'bg-info',
    borderCls:   'border-info/20',
    bgCls:       'bg-info/[0.06]',
    textCls:     'text-info',
  },
  attrition: {
    label:       'Attrition Pressure',
    description: 'Exits are outpacing joiners — attrition needs attention.',
    dotCls:      'bg-warning',
    borderCls:   'border-warning/20',
    bgCls:       'bg-warning/[0.06]',
    textCls:     'text-warning',
  },
  'onboarding-pressure': {
    label:       'Onboarding Backlog',
    description: 'Pending reviews are accumulating in the onboarding pipeline.',
    dotCls:      'bg-warning',
    borderCls:   'border-warning/20',
    bgCls:       'bg-warning/[0.06]',
    textCls:     'text-warning',
  },
  risk: {
    label:       'Workforce Risk',
    description: 'High at-risk employee count or multiple open anomalies.',
    dotCls:      'bg-destructive',
    borderCls:   'border-destructive/20',
    bgCls:       'bg-destructive/[0.06]',
    textCls:     'text-destructive',
  },
}

function deriveOrgState(
  stats?:      DashboardStats,
  onboarding?: OnboardingStats,
  intel?:      IntelData,
): OrgState {
  const atRisk = intel?.summary?.at_risk_count ?? 0
  const anomalies = intel?.summary?.open_anomalies ?? 0
  if (atRisk >= 10 || anomalies >= 15) return 'risk'
  const pending = onboarding?.pending_review ?? 0
  const failed  = onboarding?.extraction_failed ?? 0
  if (pending >= 5 || failed >= 3) return 'onboarding-pressure'
  const joiners = stats?.new_joiners_this_month ?? 0
  const exits   = stats?.separations_this_month ?? 0
  if (exits > joiners && exits > 2) return 'attrition'
  if (joiners > exits && joiners > 0) return 'growth'
  return 'stable'
}

// ── Local components ───────────────────────────────────────────────────────────

interface KpiChipProps {
  label:       string
  value:       string | number | undefined
  colorClass?: string
  href?:       string
  loading?:    boolean
}

function KpiChip({ label, value, colorClass = 'text-foreground', href, loading }: KpiChipProps) {
  const inner = (
    <div className={cn(
      'flex flex-col gap-0.5 p-3 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors',
      href && 'cursor-pointer',
    )}>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</span>
      <span className={cn(
        'text-xl font-bold tabular-nums',
        loading ? 'text-muted-foreground/30 animate-pulse' : colorClass,
      )}>
        {loading ? '—' : (value ?? '—')}
      </span>
    </div>
  )
  if (href) return <Link to={href} className="block">{inner}</Link>
  return inner
}

interface AttentionRowProps {
  label:     string
  count:     number
  severity:  'critical' | 'warning' | 'info' | 'neutral'
  href:      string
  loading?:  boolean
}

function AttentionRow({ label, count, severity, href, loading }: AttentionRowProps) {
  const colorMap = {
    critical: { dot: 'bg-destructive', text: 'text-destructive', badge: 'destructive' as const },
    warning:  { dot: 'bg-warning',     text: 'text-warning',     badge: 'warning'     as const },
    info:     { dot: 'bg-info',        text: 'text-info',        badge: 'secondary'   as const },
    neutral:  { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', badge: 'outline' as const },
  }
  const cls = colorMap[severity]

  if (loading) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 animate-pulse h-9" />
    )
  }

  if (count === 0) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-success/5 text-xs">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
          <span className="text-foreground font-medium">{label}</span>
        </div>
        <span className="text-success font-semibold text-[10px]">Clear</span>
      </div>
    )
  }

  return (
    <Link to={href} className="block group">
      <div className={cn(
        'flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors',
        severity === 'critical' ? 'bg-destructive/5 hover:bg-destructive/10'
          : severity === 'warning' ? 'bg-warning/5 hover:bg-warning/10'
          : 'bg-muted/30 hover:bg-muted/50',
      )}>
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', cls.dot)} />
          <span className={cn('font-medium', cls.text)}>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={cls.badge} className="rounded-full text-[9px] h-4 px-1.5 tabular-nums">{count}</Badge>
          <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>
      </div>
    </Link>
  )
}

// ── Quick actions ──────────────────────────────────────────────────────────────

interface QuickAction {
  label:       string
  description: string
  href:        string
  icon:        React.ComponentType<{ className?: string }>
  accent?:     'warning' | 'destructive' | 'success' | 'neutral'
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'People Directory',    description: 'Search and manage employee records',         href: '/admin/employees',              icon: Users,        accent: 'neutral'  },
  { label: 'AI Onboarding',       description: 'AI-powered bulk employee onboarding',        href: '/admin/onboarding',             icon: UserPlus,     accent: 'warning'  },
  { label: 'Organization Chart',  description: 'Visual org structure and hierarchy',         href: '/admin/organization',           icon: Building2,    accent: 'neutral'  },
  { label: 'Workforce Analytics', description: 'Headcount trends, attrition, retention',     href: '/admin/analytics/workforce',    icon: BarChart2,    accent: 'neutral'  },
  { label: 'Intelligence',        description: 'Risk scores, anomalies, at-risk employees',  href: '/admin/intelligence',           icon: Brain,        accent: 'warning'  },
  { label: 'Executive Intel',     description: 'C-suite workforce intelligence reports',      href: '/admin/analytics/executive',    icon: PieChart,     accent: 'neutral'  },
  { label: 'Master Import',       description: 'Bulk data import via CSV',                   href: '/admin/import',                 icon: FolderUp,     accent: 'neutral'  },
  { label: 'Manager Dashboard',   description: 'Team-level view for managers',               href: '/manager/dashboard',            icon: UserCog,      accent: 'neutral'  },
]

const ACCENT_CLASSES: Record<string, string> = {
  warning:     'border-warning/20 bg-warning/[0.04] hover:bg-warning/[0.08]',
  destructive: 'border-destructive/20 bg-destructive/[0.04] hover:bg-destructive/[0.08]',
  success:     'border-success/20 bg-success/[0.04] hover:bg-success/[0.08]',
  neutral:     'border-border/60 bg-muted/[0.04] hover:bg-muted/10',
}

// ── Employment type color map ──────────────────────────────────────────────────

const EMP_TYPE_COLOR: Record<string, string> = {
  permanent:   getChartColor('active'),
  contract:    getChartColor('contract'),
  probation:   getChartColor('probation'),
  intern:      getChartColor('intern'),
  consultant:  getChartColor('chart2'),
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkforceOperationsCenter() {
  const navigate              = useNavigate()
  const { profile }           = useAuthStore()
  const isAdmin               = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [toolsOpen, setToolsOpen] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey:  ['wf-dashboard-stats'],
    queryFn:   () => api.get('/analytics/dashboard'),
    staleTime: 30_000,
    retry:     false,
  })

  const { data: intelResp, isLoading: intelLoading } = useQuery<{ data: IntelData; cached: boolean }>({
    queryKey:  ['wf-intelligence'],
    queryFn:   () => api.get('/attendance/intelligence'),
    enabled:   isAdmin,
    staleTime: 5 * 60_000,
    retry:     false,
  })

  const { data: onboardResp, isLoading: onboardLoading } = useQuery<{ data: OnboardingStats }>({
    queryKey:  ['wf-onboarding-stats'],
    queryFn:   () => api.get('/onboarding/dashboard'),
    staleTime: 60_000,
    retry:     false,
  })

  const intel     = intelResp?.data
  const onboarding = onboardResp?.data

  // ── Derived state ──────────────────────────────────────────────────────────
  const orgState   = useMemo(() => deriveOrgState(stats, onboarding, intel), [stats, onboarding, intel])
  const orgCfg     = ORG_STATE_CONFIG[orgState]

  const totalEmp   = stats?.total_employees   ?? 0
  const activeEmp  = stats?.active_employees  ?? 0
  const newJoiners = stats?.new_joiners_this_month ?? 0
  const exits      = stats?.separations_this_month ?? 0
  const atRisk     = intel?.summary?.at_risk_count ?? 0
  const anomalies  = intel?.summary?.open_anomalies ?? 0
  const pendingOB  = onboarding?.pending_review ?? 0
  const failedOB   = onboarding?.extraction_failed ?? 0

  // Dept chart data
  const deptData = useMemo(
    () => (stats?.department_breakdown ?? []).slice(0, 8).map(d => ({
      name:  d.name.length > 12 ? d.name.slice(0, 12) + '…' : d.name,
      count: d.count,
    })),
    [stats],
  )

  // Emp type pie data
  const empTypeData = useMemo(
    () => (stats?.employment_type_breakdown ?? []).map(e => ({
      name:  e.type,
      value: e.count,
    })),
    [stats],
  )

  // Timeline events
  const timelineEvents = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = []
    const now = new Date().toISOString()

    if (atRisk > 0) {
      events.push({
        id:          'at-risk',
        title:       `${atRisk} employee${atRisk !== 1 ? 's' : ''} flagged at risk`,
        description: 'High risk score — review workforce intelligence.',
        timestamp:   now,
        severity:    atRisk >= 10 ? 'critical' : 'warning',
        icon:        AlertTriangle,
        action:      'View intelligence',
        onAction:    () => navigate('/admin/intelligence'),
      })
    }
    if (pendingOB > 0) {
      events.push({
        id:          'onboard-pending',
        title:       `${pendingOB} onboarding session${pendingOB !== 1 ? 's' : ''} awaiting review`,
        description: 'Employee records extracted — HR review required.',
        timestamp:   now,
        severity:    'warning',
        icon:        UserPlus,
        action:      'Open onboarding',
        onAction:    () => navigate('/admin/onboarding'),
      })
    }
    if (failedOB > 0) {
      events.push({
        id:          'onboard-failed',
        title:       `${failedOB} onboarding session${failedOB !== 1 ? 's' : ''} failed extraction`,
        description: 'Data extraction failed — manual intervention needed.',
        timestamp:   now,
        severity:    'critical',
        icon:        XCircle,
        action:      'Fix sessions',
        onAction:    () => navigate('/admin/onboarding'),
      })
    }
    if (newJoiners > 0) {
      events.push({
        id:          'new-joiners',
        title:       `${newJoiners} new joiner${newJoiners !== 1 ? 's' : ''} this month`,
        description: 'New employees added to the workforce.',
        timestamp:   now,
        severity:    'success',
        icon:        UserPlus,
      })
    }
    if (exits > 0) {
      events.push({
        id:          'exits',
        title:       `${exits} separation${exits !== 1 ? 's' : ''} this month`,
        description: 'Employee exits recorded for the current cycle.',
        timestamp:   now,
        severity:    exits > newJoiners ? 'warning' : 'neutral',
        icon:        UserMinus,
      })
    }
    if (anomalies > 0) {
      events.push({
        id:          'anomalies',
        title:       `${anomalies} open workforce anomal${anomalies !== 1 ? 'ies' : 'y'}`,
        description: 'Attendance patterns requiring investigation.',
        timestamp:   now,
        severity:    'warning',
        icon:        Activity,
        action:      'View anomalies',
        onAction:    () => navigate('/admin/attendance/anomalies'),
      })
    }
    if (events.length === 0) {
      events.push({
        id:        'all-clear',
        title:     'All workforce signals clear',
        timestamp: now,
        severity:  'success',
        icon:      CheckCircle2,
      })
    }
    return events
  }, [atRisk, pendingOB, failedOB, newJoiners, exits, anomalies, navigate])

  const anyLoading = statsLoading || onboardLoading

  return (
    <PageContainer>
      <PageHeader
        title="Workforce Operations"
        subtitle="Organizational command center — headcount, onboarding, risk, and people signals"
        actions={
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => navigate('/admin/employees/new')}>
            <UserPlus className="h-3.5 w-3.5" />
            Add Employee
          </Button>
        }
      />

      {/* ── 1. Org Health Strip ─────────────────────────────────────────────── */}
      <div className={cn(
        'rounded-lg border px-4 py-3 flex items-center justify-between gap-4',
        orgCfg.borderCls, orgCfg.bgCls,
      )}>
        <div className="flex items-center gap-3">
          <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0 animate-pulse', orgCfg.dotCls)} />
          <div>
            <p className={cn('text-sm font-semibold', orgCfg.textCls)}>{orgCfg.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{orgCfg.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {anyLoading ? '—' : totalEmp}
            </span>{' '}total
          </span>
          <span>
            <span className={cn('font-semibold tabular-nums', newJoiners > 0 ? 'text-success' : 'text-foreground')}>
              {anyLoading ? '—' : `+${newJoiners}`}
            </span>{' '}joiners
          </span>
          <span>
            <span className={cn('font-semibold tabular-nums', exits > 0 ? 'text-warning' : 'text-foreground')}>
              {anyLoading ? '—' : `-${exits}`}
            </span>{' '}exits
          </span>
        </div>
      </div>

      {/* ── 2. KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <KpiChip label="Total"        value={totalEmp}   href="/admin/employees"           loading={anyLoading} />
        <KpiChip label="Active"       value={activeEmp}  href="/admin/employees"           loading={anyLoading}
          colorClass={activeEmp === totalEmp ? 'text-success' : 'text-foreground'} />
        <KpiChip label="Joiners"      value={newJoiners} href="/admin/employees"           loading={anyLoading}
          colorClass={newJoiners > 0 ? 'text-success' : 'text-foreground'} />
        <KpiChip label="Exits"        value={exits}      href="/admin/employees"           loading={anyLoading}
          colorClass={exits > newJoiners ? 'text-warning' : exits > 0 ? 'text-muted-foreground' : 'text-foreground'} />
        <KpiChip label="OB Pending"   value={pendingOB}  href="/admin/onboarding"          loading={onboardLoading}
          colorClass={pendingOB > 0 ? 'text-warning' : 'text-foreground'} />
        <KpiChip label="At Risk"      value={atRisk}     href="/admin/intelligence"        loading={intelLoading}
          colorClass={atRisk >= 10 ? 'text-destructive' : atRisk > 0 ? 'text-warning' : 'text-foreground'} />
        <KpiChip label="Anomalies"    value={anomalies}  href="/admin/attendance/anomalies" loading={intelLoading}
          colorClass={anomalies > 0 ? 'text-warning' : 'text-foreground'} />
        <KpiChip label="Departments"  value={stats?.department_breakdown?.length ?? '—'}  loading={anyLoading} />
      </div>

      {/* ── 3. Two-column grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Attention Queue */}
          <SectionCard
            title="Attention Queue"
            icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="space-y-1.5">
              <AttentionRow label="Onboarding pending review"   count={pendingOB}  severity={pendingOB >= 5 ? 'critical' : 'warning'} href="/admin/onboarding"             loading={onboardLoading} />
              <AttentionRow label="Onboarding extraction failed" count={failedOB}   severity="critical"  href="/admin/onboarding"             loading={onboardLoading} />
              <AttentionRow label="Employees at risk"           count={atRisk}     severity={atRisk >= 10 ? 'critical' : 'warning'} href="/admin/intelligence"           loading={intelLoading} />
              <AttentionRow label="Open workforce anomalies"    count={anomalies}  severity="warning"   href="/admin/attendance/anomalies"   loading={intelLoading} />
              <AttentionRow label="Separations this month"      count={exits}      severity={exits > newJoiners ? 'warning' : 'neutral'} href="/admin/employees"  loading={anyLoading} />
            </div>
          </SectionCard>

          {/* Distribution — dept headcount + emp type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Department headcount bar chart */}
            <SectionCard
              title="By Department"
              icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
            >
              {anyLoading ? (
                <div className="h-40 rounded-md bg-muted/30 animate-pulse" />
              ) : deptData.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No department data</div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={deptData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid {...getGridStyle()} />
                    <XAxis dataKey="name" {...getAxisStyle()} tick={{ ...getAxisStyle().tick, fontSize: 9 }} />
                    <YAxis {...getAxisStyle()} />
                    <Tooltip contentStyle={getTooltipStyle()} cursor={{ fill: 'var(--color-muted)', opacity: 0.3 }} />
                    <Bar dataKey="count" fill={getChartColor('active')} radius={[3, 3, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            {/* Employment type pie */}
            <SectionCard
              title="Employment Mix"
              icon={<PieChart className="h-4 w-4 text-muted-foreground" />}
            >
              {anyLoading ? (
                <div className="h-40 rounded-md bg-muted/30 animate-pulse" />
              ) : empTypeData.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No data</div>
              ) : (
                <div className="flex items-center gap-3">
                  <ResponsiveContainer width="60%" height={140}>
                    <RechartsPieChart>
                      <Pie data={empTypeData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={2}>
                        {empTypeData.map((entry) => (
                          <Cell key={entry.name} fill={EMP_TYPE_COLOR[entry.name] ?? getChartColor('chart3')} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={getTooltipStyle()} />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    {empTypeData.map(entry => (
                      <div key={entry.name} className="flex items-center justify-between text-[10px] gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full flex-shrink-0"
                            style={{ background: EMP_TYPE_COLOR[entry.name] ?? getChartColor('chart3') }}
                          />
                          <span className="text-muted-foreground capitalize truncate">{entry.name}</span>
                        </div>
                        <span className="font-semibold tabular-nums text-foreground">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          {/* Operational Tools (collapsible) */}
          <SectionCard
            title="Operational Tools"
            icon={<LayoutGrid className="h-4 w-4 text-muted-foreground" />}
            action={
              <button
                type="button"
                onClick={() => setToolsOpen(v => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {toolsOpen ? 'Collapse' : 'Expand'}
                {toolsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            }
          >
            {toolsOpen ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {QUICK_ACTIONS.map(action => {
                  const Icon = action.icon
                  return (
                    <Link key={action.href} to={action.href} className="block group">
                      <div className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                        ACCENT_CLASSES[action.accent ?? 'neutral'],
                      )}>
                        <div className="rounded-md p-1.5 bg-background/60 flex-shrink-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11.5px] font-semibold text-foreground truncate">{action.label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-1">{action.description}</p>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Quick access to all workforce tools — people directory, analytics, onboarding, and more.
                <button type="button" onClick={() => setToolsOpen(true)} className="ml-1.5 text-primary hover:underline">
                  Expand to explore →
                </button>
              </p>
            )}
          </SectionCard>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Onboarding Pipeline */}
          <SectionCard
            title="Onboarding Pipeline"
            icon={<UserPlus className="h-4 w-4 text-muted-foreground" />}
            action={
              <Link to="/admin/onboarding" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                Open <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            {onboardLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-7 rounded-md bg-muted/30 animate-pulse" />)}
              </div>
            ) : !onboarding ? (
              <p className="text-xs text-muted-foreground py-2">No onboarding data available.</p>
            ) : (
              <div className="space-y-1.5">
                {[
                  { label: 'Total Sessions',    value: onboarding.total_sessions,      cls: 'text-foreground' },
                  { label: 'Pending Review',    value: onboarding.pending_review,      cls: onboarding.pending_review > 0 ? 'text-warning' : 'text-foreground' },
                  { label: 'Extraction Failed', value: onboarding.extraction_failed,   cls: onboarding.extraction_failed > 0 ? 'text-destructive' : 'text-foreground' },
                  { label: 'Approved (Month)',  value: onboarding.approved_this_month, cls: 'text-success' },
                  { label: 'Rejected',          value: onboarding.rejected,            cls: onboarding.rejected > 0 ? 'text-warning' : 'text-foreground' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className={cn('font-semibold tabular-nums', row.cls)}>{row.value ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Workforce Signals — top at-risk */}
          {isAdmin && (
            <SectionCard
              title="Workforce Signals"
              icon={<Brain className="h-4 w-4 text-muted-foreground" />}
              action={
                <Link to="/admin/intelligence" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                  All <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {intelLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-8 rounded-md bg-muted/30 animate-pulse" />)}
                </div>
              ) : !intel || (intel.at_risk ?? []).length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-success py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  No at-risk employees detected.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {(intel.at_risk ?? []).slice(0, 4).map(emp => (
                    <div key={emp.employee_id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{emp.name}</p>
                        <p className="text-muted-foreground text-[10px] truncate">#{emp.employee_code}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={cn(
                          'text-[10px] font-semibold tabular-nums',
                          emp.risk_score >= 80 ? 'text-destructive'
                            : emp.risk_score >= 60 ? 'text-warning'
                            : 'text-muted-foreground',
                        )}>
                          {emp.risk_score}%
                        </span>
                        <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', emp.risk_score >= 80 ? 'bg-destructive' : emp.risk_score >= 60 ? 'bg-warning' : 'bg-success')}
                            style={{ width: `${emp.risk_score}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {/* Org Timeline */}
          <SectionCard
            title="Org Timeline"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          >
            <OperationalTimeline
              events={timelineEvents}
              loading={anyLoading && timelineEvents.length === 0}
              maxItems={8}
            />
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  )
}
