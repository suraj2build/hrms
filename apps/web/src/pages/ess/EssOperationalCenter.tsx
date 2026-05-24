/**
 * EssOperationalCenter — /ess/operational-center
 *
 * Employee self-service hub showing personalised attendance, schedule,
 * workload balance, schedule fairness, and upcoming payroll impact.
 *
 * Access: all authenticated users.
 */

import { useQuery }             from '@tanstack/react-query'
import {
  AlertTriangle, Bell, BellOff, TrendingUp, Calendar,
  DollarSign, BarChart2, Users, ShieldCheck, Loader2,
  Clock, AlertCircle, Info,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { useAuthStore }  from '@/stores/authStore'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type NotificationType =
  | 'shift_overload'
  | 'ot_warning'
  | 'low_leave_balance'
  | 'attendance_risk'
  | 'incomplete_punch'

type LopRiskLevel = 'low' | 'medium' | 'high'

interface WorkforceNotification {
  id:          string
  type:        NotificationType
  title:       string
  message:     string
  action_hint: string | null
}

interface LeaveBalance {
  type:         string
  balance_days: number
}

interface OperationalSummary {
  present_days:         number
  absent_days:          number
  late_days:            number
  lop_days:             number
  total_ot_hours:       number
  leave_balance_by_type: LeaveBalance[]
  lop_amount:           number
  ot_amount:            number
  estimated_net_payable: number
  warnings:             string[]
}

interface WorkloadBalance {
  avg_work_hours:  number
  max_work_hours:  number
  overload_days:   number
  normal_days:     number
  short_days:      number
  balance_score:   number
}

interface ScheduleFairness {
  weekend_shifts:       number
  night_shifts:         number
  total_ot_hours:       number
  team_avg_ot_hours:    number
  fairness_score:       number
  below_team_average:   boolean
}

interface UpcomingPayrollImpact {
  current_lop_days:  number
  projected_lop_days: number
  payroll_month:     string
  lop_risk_level:    LopRiskLevel
}

// ── Badge / style helpers ──────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const NOTIFICATION_BORDER: Record<NotificationType, string> = {
  shift_overload:   'border-l-destructive',
  ot_warning:       'border-l-warning',
  low_leave_balance:'border-l-warning',
  attendance_risk:  'border-l-destructive',
  incomplete_punch: 'border-l-warning',
}

const NOTIFICATION_ICON: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  shift_overload:   AlertTriangle,
  ot_warning:       Clock,
  low_leave_balance: Info,
  attendance_risk:  AlertCircle,
  incomplete_punch: AlertCircle,
}

const NOTIFICATION_ICON_COLOR: Record<NotificationType, string> = {
  shift_overload:   'text-destructive',
  ot_warning:       'text-warning',
  low_leave_balance:'text-warning',
  attendance_risk:  'text-destructive',
  incomplete_punch: 'text-warning',
}

const LOP_RISK_BORDER: Record<LopRiskLevel, string> = {
  low:    'border-success/50',
  medium: 'border-warning/50',
  high:   'border-destructive/50',
}

const LOP_RISK_BG: Record<LopRiskLevel, string> = {
  low:    'bg-success/5',
  medium: 'bg-warning/5',
  high:   'bg-destructive/5',
}

const LOP_RISK_VARIANT: Record<LopRiskLevel, BadgeVariant> = {
  low:    'success',
  medium: 'warning',
  high:   'destructive',
}

// ── Balance score color ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score > 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-destructive'
}

// ── Mini stacked bar ───────────────────────────────────────────────────────────

interface MiniBarProps {
  overload: number
  normal:   number
  short:    number
}

function WorkloadMiniBar({ overload, normal, short }: MiniBarProps) {
  const total = overload + normal + short
  if (total === 0) return null

  const overloadPct = (overload / total) * 100
  const normalPct   = (normal  / total) * 100
  const shortPct    = (short   / total) * 100

  return (
    <div className="space-y-1.5 mt-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
        Day Distribution ({total} days)
      </p>
      <div className="flex h-3 w-full rounded-full overflow-hidden gap-px bg-muted">
        {overloadPct > 0 && (
          <div
            style={{ width: `${overloadPct}%` }}
            className="bg-destructive/70 h-full"
            title={`Overload: ${overload} days`}
          />
        )}
        {normalPct > 0 && (
          <div
            style={{ width: `${normalPct}%` }}
            className="bg-success/70 h-full"
            title={`Normal: ${normal} days`}
          />
        )}
        {shortPct > 0 && (
          <div
            style={{ width: `${shortPct}%` }}
            className="bg-warning/70 h-full"
            title={`Short: ${short} days`}
          />
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-destructive/70" />
          Overload ({overload})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-success/70" />
          Normal ({normal})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-warning/70" />
          Short ({short})
        </span>
      </div>
    </div>
  )
}

// ── Stat row helper ────────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  valueCls,
  unit,
}: {
  label:     string
  value:     string | number
  valueCls?: string
  unit?:     string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-semibold text-foreground tabular-nums', valueCls)}>
        {value}{unit && <span className="font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </span>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-pulse space-y-2">
      <div className="h-3 w-1/3 bg-muted rounded" />
      <div className="h-6 w-1/2 bg-muted rounded" />
      <div className="h-3 w-2/3 bg-muted rounded" />
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function EssOperationalCenter() {
  const { profile } = useAuthStore()

  const hasEmployee = !!profile?.employee_id

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: notificationsData, isLoading: notificationsLoading } =
    useQuery<{ data: WorkforceNotification[] }>({
      queryKey: ['ess-workforce-notifications'],
      queryFn:  () => api.get('/ess/workforce-notifications'),
      staleTime: 60_000,
      enabled:  hasEmployee,
    })

  const { data: summaryData, isLoading: summaryLoading } =
    useQuery<{ data: OperationalSummary }>({
      queryKey: ['ess-operational-summary'],
      queryFn:  () => api.get('/ess/operational-summary'),
      staleTime: 60_000,
      enabled:  hasEmployee,
    })

  const { data: workloadData, isLoading: workloadLoading } =
    useQuery<{ data: WorkloadBalance }>({
      queryKey: ['ess-workload-balance'],
      queryFn:  () => api.get('/ess/workload-balance'),
      staleTime: 60_000,
      enabled:  hasEmployee,
    })

  const { data: fairnessData, isLoading: fairnessLoading } =
    useQuery<{ data: ScheduleFairness }>({
      queryKey: ['ess-schedule-fairness'],
      queryFn:  () => api.get('/ess/schedule-fairness'),
      staleTime: 60_000,
      enabled:  hasEmployee,
    })

  const { data: payrollImpactData, isLoading: payrollImpactLoading } =
    useQuery<{ data: UpcomingPayrollImpact }>({
      queryKey: ['ess-upcoming-payroll-impact'],
      queryFn:  () => api.get('/ess/upcoming-payroll-impact'),
      staleTime: 60_000,
      enabled:  hasEmployee,
    })

  // ── Derived ──────────────────────────────────────────────────────────────────

  const notifications  = notificationsData?.data  ?? []
  const summary        = summaryData?.data
  const workload       = workloadData?.data
  const fairness       = fairnessData?.data
  const payrollImpact  = payrollImpactData?.data

  // ── No employee linked guard ──────────────────────────────────────────────────

  if (!hasEmployee) {
    return (
      <PageContainer>
        <PageHeader
          title="My Operational Center"
          subtitle="Your attendance, schedule, and payroll visibility"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-20 gap-3 text-center">
            <Users className="h-12 w-12 text-muted-foreground/20" />
            <p className="text-sm font-semibold text-foreground">No employee profile linked</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Your account is not yet linked to an employee record. Please contact your HR
              administrator to complete the setup.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="My Operational Center"
        subtitle="Your attendance, schedule, and payroll visibility"
      />

      {/* ── Section 1: Notifications Banner ── */}
      <SectionCard
        title="Notifications"
        icon={<Bell className="h-4 w-4 text-muted-foreground" />}
      >
        {notificationsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notifications…
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex items-center gap-3 py-3 text-muted-foreground">
            <BellOff className="h-4 w-4" />
            <p className="text-sm">No active notifications — you're all caught up.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map(n => {
              const Icon = NOTIFICATION_ICON[n.type]
              return (
                <div
                  key={n.id}
                  className={cn(
                    'rounded-md border bg-card border-l-4 px-4 py-3 flex items-start gap-3',
                    NOTIFICATION_BORDER[n.type],
                  )}
                >
                  <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', NOTIFICATION_ICON_COLOR[n.type])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    {n.action_hint && (
                      <p className="text-[11px] text-muted-foreground/70 mt-1 italic">
                        {n.action_hint}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Section 2: Three-column summary ── */}
      {summaryLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Card 1: Attendance */}
          <SectionCard
            title="Attendance"
            icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
          >
            <StatRow label="Present Days"  value={summary.present_days} />
            <StatRow
              label="Absent Days"
              value={summary.absent_days}
              valueCls={summary.absent_days > 0 ? 'text-destructive' : undefined}
            />
            <StatRow
              label="Late Days"
              value={summary.late_days}
              valueCls={summary.late_days > 0 ? 'text-warning' : undefined}
            />
            <StatRow label="LOP Days"      value={summary.lop_days} />
          </SectionCard>

          {/* Card 2: Overtime & Leave */}
          <SectionCard
            title="Overtime & Leave"
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          >
            <StatRow label="Total OT Hours" value={summary.total_ot_hours} unit=" hrs" />
            {summary.leave_balance_by_type.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1.5">
                  Leave Balances
                </p>
                {summary.leave_balance_by_type.map(lb => (
                  <div
                    key={lb.type}
                    className="flex items-center justify-between py-1 border-b border-border/40 last:border-0"
                  >
                    <span className="text-xs text-muted-foreground capitalize">
                      {lb.type.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-semibold tabular-nums',
                        lb.balance_days <= 1 ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {lb.balance_days} days
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Card 3: Payroll Preview */}
          <SectionCard
            title="Payroll Preview"
            icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          >
            <StatRow
              label="LOP Deduction"
              value={summary.lop_amount.toLocaleString()}
              valueCls={summary.lop_amount > 0 ? 'text-destructive' : undefined}
            />
            <StatRow
              label="OT Addition"
              value={summary.ot_amount.toLocaleString()}
              valueCls={summary.ot_amount > 0 ? 'text-success' : undefined}
            />
            <StatRow
              label="Est. Net Payable"
              value={summary.estimated_net_payable.toLocaleString()}
              valueCls="text-foreground font-bold"
            />
            {summary.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {summary.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-warning"
                  >
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {w}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {/* ── Section 3: Workload + Fairness ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Workload Balance */}
        <SectionCard
          title="Workload Balance"
          icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
        >
          {workloadLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading workload data…
            </div>
          ) : workload ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">Balance Score</span>
                <span className={cn('text-2xl font-bold tabular-nums', scoreColor(workload.balance_score))}>
                  {workload.balance_score}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </span>
              </div>

              <StatRow label="Avg Work Hours"  value={workload.avg_work_hours.toFixed(1)} unit=" hrs/day" />
              <StatRow label="Max Work Hours"  value={workload.max_work_hours.toFixed(1)} unit=" hrs/day" />

              <WorkloadMiniBar
                overload={workload.overload_days}
                normal={workload.normal_days}
                short={workload.short_days}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No workload data available.</p>
          )}
        </SectionCard>

        {/* Schedule Fairness */}
        <SectionCard
          title="Schedule Fairness"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        >
          {fairnessLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading fairness data…
            </div>
          ) : fairness ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">Fairness Score</span>
                <div className="flex items-center gap-2">
                  <span className={cn('text-2xl font-bold tabular-nums', scoreColor(fairness.fairness_score))}>
                    {fairness.fairness_score}
                    <span className="text-sm font-normal text-muted-foreground">/100</span>
                  </span>
                  {fairness.below_team_average && (
                    <Badge variant="warning" className="rounded-full text-[10px] px-2">
                      Below team avg OT
                    </Badge>
                  )}
                </div>
              </div>

              <StatRow label="Weekend Shifts"    value={fairness.weekend_shifts} unit=" shifts" />
              <StatRow label="Night Shifts"      value={fairness.night_shifts}   unit=" shifts" />
              <StatRow label="Your OT Hours"     value={fairness.total_ot_hours.toFixed(1)} unit=" hrs" />
              <StatRow
                label="Team Avg OT"
                value={fairness.team_avg_ot_hours.toFixed(1)}
                unit=" hrs"
                valueCls="text-muted-foreground"
              />

              {/* OT vs team avg visual bar */}
              {(fairness.total_ot_hours > 0 || fairness.team_avg_ot_hours > 0) && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                    OT vs Team Average
                  </p>
                  <div className="space-y-1">
                    {/* Your OT */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-16 shrink-0">You</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          style={{
                            width: `${Math.min(100, (fairness.total_ot_hours /
                              Math.max(fairness.total_ot_hours, fairness.team_avg_ot_hours, 1)) * 100)}%`,
                          }}
                          className={cn(
                            'h-full rounded-full',
                            fairness.below_team_average ? 'bg-warning/70' : 'bg-success/70',
                          )}
                        />
                      </div>
                      <span className="text-[10px] text-foreground tabular-nums w-12 text-right">
                        {fairness.total_ot_hours.toFixed(1)}h
                      </span>
                    </div>
                    {/* Team avg */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-16 shrink-0">Team</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          style={{
                            width: `${Math.min(100, (fairness.team_avg_ot_hours /
                              Math.max(fairness.total_ot_hours, fairness.team_avg_ot_hours, 1)) * 100)}%`,
                          }}
                          className="h-full rounded-full bg-muted-foreground/40"
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-12 text-right">
                        {fairness.team_avg_ot_hours.toFixed(1)}h
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No fairness data available.</p>
          )}
        </SectionCard>
      </div>

      {/* ── Section 4: Upcoming Payroll Impact ── */}
      <SectionCard
        title="Upcoming Payroll Impact"
        icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      >
        {payrollImpactLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading payroll impact…
          </div>
        ) : payrollImpact ? (
          <div
            className={cn(
              'rounded-lg border-2 p-4',
              LOP_RISK_BORDER[payrollImpact.lop_risk_level],
              LOP_RISK_BG[payrollImpact.lop_risk_level],
            )}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">
                  Payroll Month: <span className="font-medium text-foreground">{payrollImpact.payroll_month}</span>
                </p>
                <Badge
                  variant={LOP_RISK_VARIANT[payrollImpact.lop_risk_level]}
                  className="rounded-full text-[10px] px-2 capitalize"
                >
                  {payrollImpact.lop_risk_level} risk
                </Badge>
              </div>
              <div className="flex gap-6">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">
                    Current LOP
                  </p>
                  <p
                    className={cn(
                      'text-2xl font-bold tabular-nums',
                      payrollImpact.current_lop_days > 0 ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    {payrollImpact.current_lop_days}
                    <span className="text-sm font-normal text-muted-foreground ml-1">days</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">
                    Projected LOP
                  </p>
                  <p
                    className={cn(
                      'text-2xl font-bold tabular-nums',
                      payrollImpact.projected_lop_days > 0 ? 'text-warning' : 'text-foreground',
                    )}
                  >
                    {payrollImpact.projected_lop_days}
                    <span className="text-sm font-normal text-muted-foreground ml-1">days</span>
                  </p>
                </div>
              </div>
            </div>

            {payrollImpact.lop_risk_level === 'high' && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 mt-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">
                  You currently have <span className="font-bold">{payrollImpact.current_lop_days} LOP days</span> this
                  month. Take corrective action to avoid payroll impact.
                </p>
              </div>
            )}

            {payrollImpact.lop_risk_level === 'medium' && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 mt-2">
                <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning">
                  Your projected LOP days are rising. Monitor your attendance to prevent further deductions.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">No payroll impact data available.</p>
        )}
      </SectionCard>
    </PageContainer>
  )
}
