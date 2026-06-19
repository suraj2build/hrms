/**
 * PayrollOperationsCenter — /admin/payroll/hub
 *
 * Payroll Hub — single-scroll payroll command overview.
 *
 * Answers immediately:
 *   Is payroll ready? What is blocked? What validations failed?
 *   What compliance gaps exist? What payout risks exist?
 *
 * Layout:
 *   1. Payroll Pipeline Strip  (month · stage pipeline · freeze · readiness · CTA)
 *   2. Compact KPI Row         (8 chips, colour-coded by severity)
 *   3. Two-column grid
 *      Left  (lg:col-span-2) — Attention Queue · Readiness Surface · Operational Tools
 *      Right (lg:col-span-1) — Operations Rail · Activity Timeline
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery }          from '@tanstack/react-query'
import {
  AlertTriangle, DollarSign, CheckSquare, Scale,
  ShieldCheck, Landmark, PieChart, Search,
  BookMarked, CreditCard, XCircle, Lock,
  FileWarning, Activity, TrendingDown,
  BarChart3, TrendingUp, FlaskConical,
  BadgeCheck, LineChart, Wallet,
  Receipt, GitMerge, Layers,
  ChevronDown, ChevronRight,
  CheckCircle2, ArrowRight, Clock, Calendar,
  AlertCircle, RefreshCw, BarChart2, PlayCircle,
} from 'lucide-react'

import { PageContainer }       from '@/components/layout/PageContainer'
import { PageHero }            from '@/components/layout/PageHero'
import { SectionCard }         from '@/components/layout/SectionCard'
import { OperationalTimeline } from '@/components/workspace/OperationalTimeline'
import type { TimelineEvent }  from '@/components/workspace/OperationalTimeline'
import { Button }              from '@/components/ui/button'
import { Badge }               from '@/components/ui/badge'
import { api }                 from '@/lib/api/client'
import { cn }                  from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayrollRunStats {
  blockers:              number
  failed_payouts:        number
  compliance_mismatches: number
  reconciliation_open:   number
  pending_validations:   number
  is_frozen:             boolean
  unresolved_anomalies:  number
  current_run_month:     string
  ot_mismatches:         number
  variance_cases:        number
  failed_bank_transfers: number
  deduction_gaps:        number
}

// ── Payroll Stage Pipeline ─────────────────────────────────────────────────────

const STAGES = ['Draft', 'Inputs Lock', 'Validation', 'Approval', 'Processing', 'Payout', 'Closed'] as const
type Stage = typeof STAGES[number]

function deriveStage(stats: PayrollRunStats | undefined): Stage {
  if (!stats) return 'Draft'
  if ((stats.failed_payouts ?? 0) > 0 || (stats.failed_bank_transfers ?? 0) > 0) return 'Payout'
  if (stats.is_frozen) return 'Approval'
  if ((stats.blockers ?? 0) > 0 || (stats.pending_validations ?? 0) > 0) return 'Validation'
  return 'Draft'
}

// ── Local components ───────────────────────────────────────────────────────────

interface KpiChipProps {
  label:      string
  value:      string | number | undefined
  colorClass?: string
  href?:      string
  loading?:   boolean
}

function KpiChip({ label, value, colorClass = 'text-foreground', href, loading }: KpiChipProps) {
  const inner = (
    <div className={cn(
      'surface-premium flex flex-col gap-0.5 p-3',
      href && 'lift-hover cursor-pointer',
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

interface ReadinessCheckProps {
  label: string
  ok:    boolean
  count?: number
  href?:  string
}

function ReadinessCheck({ label, ok, count, href }: ReadinessCheckProps) {
  const inner = (
    <div className={cn(
      'flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors',
      ok ? 'bg-success/5 hover:bg-success/10' : 'bg-destructive/5 hover:bg-destructive/10',
    )}>
      <div className="flex items-center gap-2">
        {ok
          ? <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
          : <XCircle      className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
        <span className={cn('font-medium', ok ? 'text-foreground' : 'text-destructive')}>{label}</span>
      </div>
      {!ok && (count ?? 0) > 0 && (
        <Badge variant="destructive" className="rounded-full text-[9px] h-4 px-1.5 tabular-nums">{count}</Badge>
      )}
    </div>
  )
  if (href && !ok) return <Link to={href} className="block">{inner}</Link>
  return inner
}

// ── Quick Actions ──────────────────────────────────────────────────────────────

interface QuickAction {
  label:       string
  description: string
  href:        string
  icon:        React.ComponentType<{ className?: string }>
  accent?:     'warning' | 'destructive' | 'success' | 'neutral'
}

const QUICK_ACTIONS: QuickAction[] = [
  // ── Finalization & Governance ────────────────────────────────────────────
  { label: 'Finalization',      description: 'Finalize, freeze, rollback, and export bank advice', href: '/admin/payroll/finalize',               icon: Lock,         accent: 'success'  },
  { label: 'Approval Workflow', description: 'Multi-stage approval: HR → Finance → Compliance',   href: '/admin/payroll/approvals',              icon: GitMerge,     accent: 'warning'  },
  { label: 'Variance Center',   description: 'MoM anomaly detection and net-pay variance',        href: '/admin/payroll/variance',               icon: TrendingDown, accent: 'warning'  },
  { label: 'Payout Center',     description: 'Bank disbursement, advice export, payout tracking', href: '/admin/payroll/payout',                 icon: BadgeCheck,   accent: 'success'  },
  { label: 'Forensics',         description: 'Complete payroll audit trail and event timeline',   href: '/admin/payroll/forensics',              icon: Activity,     accent: 'neutral'  },
  { label: 'Stat. Reconciliation', description: 'PF · ESI · PT · TDS ready-for-filing status',   href: '/admin/payroll/statutory-reconciliation', icon: Scale,      accent: 'warning'  },
  // ── Core Operations ──────────────────────────────────────────────────────
  { label: 'Payroll Runs',      description: 'Run and manage payroll cycles',              href: '/admin/payroll',                       icon: DollarSign,   accent: 'neutral'  },
  { label: 'Resolution Center', description: 'Investigate and resolve payroll run blockers', href: '/admin/payroll',                       icon: ShieldCheck,  accent: 'destructive' },
  { label: 'Validation Rules',  description: 'Governance — rule configuration and toggles', href: '/admin/payroll/validation',            icon: CheckSquare,  accent: 'warning'  },
  { label: 'Reconciliation',    description: 'Payroll vs attendance and deduction checks', href: '/admin/payroll/reconciliation',          icon: Scale,        accent: 'warning'  },
  { label: 'Governance',        description: 'Freeze controls and maker-checker flows',    href: '/admin/payroll/governance',             icon: ShieldCheck,  accent: 'neutral'  },
  { label: 'Ledger',            description: 'Explainability ledger for all changes',      href: '/admin/payroll/ledger',                 icon: BookMarked,   accent: 'neutral'  },
  { label: 'Investigations',    description: 'Deep-dive payroll discrepancy analysis',     href: '/admin/payroll/investigate',            icon: Search,       accent: 'warning'  },
  { label: 'Cost Intelligence', description: 'Workforce cost breakdown and trends',        href: '/admin/payroll/cost-intelligence',      icon: PieChart,     accent: 'neutral'  },
  { label: 'Statutory',         description: 'EPF, ESI, PTAX, and TDS management',        href: '/admin/payroll/statutory-dashboard',    icon: BarChart3,    accent: 'neutral'  },
  { label: 'Advances',          description: 'Salary advance management',                 href: '/admin/payroll/advances',               icon: CreditCard,   accent: 'neutral'  },
  { label: 'Loans',             description: 'Employee loan disbursements and tracking',   href: '/admin/payroll/loans',                  icon: Wallet,       accent: 'neutral'  },
  { label: 'Reimbursements',    description: 'Expense reimbursement processing',           href: '/admin/payroll/reimbursements',          icon: Receipt,      accent: 'neutral'  },
  { label: 'Variable Pay',      description: 'Incentives, bonus and variable components',  href: '/admin/payroll/variable-pay',           icon: TrendingUp,   accent: 'neutral'  },
  { label: 'Arrears',           description: 'Arrears computation and release',            href: '/admin/payroll/arrears',                icon: GitMerge,     accent: 'warning'  },
  { label: 'Forecast',          description: 'Payroll cost forecast and projections',      href: '/admin/payroll/forecast',               icon: LineChart,    accent: 'neutral'  },
  { label: 'Simulation',        description: 'Scenario-based payroll simulation',          href: '/admin/payroll/simulation',             icon: FlaskConical, accent: 'neutral'  },
  { label: 'Comp. Structures',  description: 'Salary structure and component config',      href: '/admin/payroll/compensation',           icon: Landmark,     accent: 'neutral'  },
  { label: 'Comp. Revisions',   description: 'Pending compensation revision approvals',    href: '/admin/payroll/compensation-revisions', icon: BadgeCheck,   accent: 'warning'  },
  { label: 'Salary Components', description: 'Manage salary component definitions',        href: '/admin/payroll/salary-components',      icon: Layers,       accent: 'neutral'  },
]

const ACCENT_CLASSES: Record<string, string> = {
  warning:     'border-warning/20 bg-warning/[0.04] hover:bg-warning/[0.08]',
  destructive: 'border-destructive/20 bg-destructive/[0.04] hover:bg-destructive/[0.08]',
  success:     'border-success/20 bg-success/[0.04] hover:bg-success/[0.08]',
  neutral:     'border-border/60 bg-muted/[0.04] hover:bg-muted/10',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PayrollOperationsCenter() {
  const navigate    = useNavigate()
  const [toolsOpen, setToolsOpen] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stats, isLoading, isError, dataUpdatedAt, refetch } = useQuery<PayrollRunStats>({
    queryKey:  ['payroll-run-stats'],
    queryFn:   () => api.get('/payroll/runs/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  // Fetch latest failed/partial_failed run ID so blocker CTAs can deep-link
  // to the Resolution Center for that specific run. Only runs this query when
  // there are active blockers to avoid unnecessary API calls.
  const { data: recentRunsData } = useQuery<{ data: Array<{ id: string; status: string }> }>({
    queryKey:  ['payroll-recent-runs-for-blockers'],
    queryFn:   () => api.get('/payroll/runs?limit=3&offset=0'),
    staleTime: 30_000,
    enabled:   (stats?.blockers ?? 0) > 0,
  })
  // The run we want to open in the Resolution Center — most recent failed/partial_failed
  const blockerRunId = recentRunsData?.data?.find(
    r => r.status === 'failed' || r.status === 'partial_failed',
  )?.id
  // Deep-link if we have a run ID, fall back to Payroll Runs list otherwise
  const blockerHref = blockerRunId
    ? `/admin/payroll/blockers/${blockerRunId}`
    : '/admin/payroll'

  const { data: events, isLoading: eventsLoading } = useQuery<{
    data: Array<{
      id: string; event_type: string; employee_name: string
      timestamp: string; severity: string; detail: string
    }>
  }>({
    queryKey:  ['payroll-operational-events'],
    queryFn:   () => api.get('/payroll/events?limit=15'),
    staleTime: 20_000,
    retry:     false,
  })

  // ── Compensation coverage audit ──────────────────────────────────────────
  interface CoverageAudit {
    total_active_employees:              number
    employees_with_active_compensation:  number
    employees_missing_compensation:      number
    employees_future_dated:              number
    employees_zero_ctc:                  number
    employees_with_no_components:        number
    employees_with_invalid_components:   number
    coverage_percent:                    number
    ready_for_payroll:                   boolean
    as_of:                               string
  }
  const { data: coverageRaw, isLoading: coverageLoading, refetch: refetchCoverage } = useQuery<{ data: CoverageAudit }>({
    queryKey:  ['payroll-compensation-coverage'],
    queryFn:   () => api.get('/payroll/compensation-coverage'),
    staleTime: 60_000,
    retry:     false,
  })
  const coverage = coverageRaw?.data

  // ── Readiness score ─────────────────────────────────────────────────────────
  const { data: readinessRaw } = useQuery<{ data: { score: number; max: number; grade: string; ready: boolean; month: string } }>({
    queryKey:  ['payroll-readiness-score-ops'],
    queryFn:   () => api.get('/payroll/readiness-score'),
    staleTime: 60_000,
    retry:     false,
  })
  const readinessScore = readinessRaw?.data

  // ── Derived state ───────────────────────────────────────────────────────────
  const stage      = deriveStage(stats)
  const stageIdx   = STAGES.indexOf(stage)
  const hasBlockers  = (stats?.blockers ?? 0) > 0
  const hasCritical  = hasBlockers || (stats?.failed_payouts ?? 0) > 0 || (stats?.failed_bank_transfers ?? 0) > 0
  const readyToRun   = !isLoading
    && !coverageLoading
    && (stats?.blockers ?? 0) === 0
    && !stats?.is_frozen
    && (stats?.pending_validations ?? 0) === 0
    && (coverage?.ready_for_payroll !== false)  // undefined (loading) = don't block

  // ── Attention items ─────────────────────────────────────────────────────────
  const attentionItems = useMemo(() => {
    if (!stats) return []
    type Severity = 'critical' | 'warning'
    const items: Array<{ id: string; severity: Severity; title: string; desc: string; count: number; href: string }> = []

    if ((stats.failed_payouts ?? 0) > 0)
      items.push({ id: 'failed-payouts',  severity: 'critical', title: 'Failed bank payouts',          desc: 'Bank transfers rejected — employees not paid',          count: stats.failed_payouts,        href: '/admin/payroll' })
    if ((stats.failed_bank_transfers ?? 0) > 0)
      items.push({ id: 'bank-transfers',  severity: 'critical', title: 'Bank transfer failures',        desc: 'Disbursement file rejected by bank',                   count: stats.failed_bank_transfers, href: '/admin/payroll' })
    if ((stats.blockers ?? 0) > 0)
      items.push({ id: 'run-blockers',    severity: 'critical', title: 'Payroll run blockers',          desc: 'Employee-level issues blocking payroll — review and resolve', count: stats.blockers, href: blockerHref })
    if ((stats.ot_mismatches ?? 0) > 0)
      items.push({ id: 'ot-mismatch',     severity: 'warning',  title: 'OT vs payroll mismatch',        desc: "Overtime hours in attendance don't match payroll OT",  count: stats.ot_mismatches,         href: '/admin/payroll/reconciliation' })
    if ((stats.variance_cases ?? 0) > 0)
      items.push({ id: 'variance-cases',  severity: 'warning',  title: 'Open variance cases',           desc: 'Payroll variance investigations awaiting resolution',   count: stats.variance_cases,        href: '/admin/payroll/investigate' })
    if ((stats.deduction_gaps ?? 0) > 0)
      items.push({ id: 'deduction-gaps',  severity: 'warning',  title: 'Deduction inconsistencies',     desc: 'Employee deductions differ from structure definition',  count: stats.deduction_gaps,        href: '/admin/payroll/reconciliation' })
    if ((stats.compliance_mismatches ?? 0) > 0)
      items.push({ id: 'compliance-gaps', severity: 'warning',  title: 'Compliance data mismatches',    desc: 'EPF/ESI/PTAX/TDS registration or computation gaps',    count: stats.compliance_mismatches, href: '/admin/payroll/statutory-dashboard' })
    if ((stats.unresolved_anomalies ?? 0) > 0)
      items.push({ id: 'anomalies',       severity: 'warning',  title: 'Unresolved payroll anomalies',  desc: 'System-flagged inconsistencies needing investigation',  count: stats.unresolved_anomalies,  href: '/admin/payroll/investigate' })

    return items
  }, [stats, blockerHref])

  // ── Timeline events ─────────────────────────────────────────────────────────
  const timeline: TimelineEvent[] = useMemo(() => {
    if (!events?.data?.length) return []
    return events.data.map(e => ({
      id:          e.id,
      title:       e.event_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: e.employee_name ? `${e.employee_name} · ${e.detail ?? ''}` : e.detail,
      timestamp:   e.timestamp,
      severity:    (e.severity as TimelineEvent['severity']) ?? 'neutral',
    }))
  }, [events?.data])

  return (
    <PageContainer>
      <PageHero
        eyebrow={`Payroll · Command${stats?.current_run_month ? ` · ${stats.current_run_month}` : ''}`}
        title="Payroll Hub"
        subtitle="The payroll command overview — readiness, compensation coverage, blockers and every payroll tool in one place."
        actions={
          <>
            <Button size="sm" variant="outline"
              className="h-8 gap-1.5 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() => navigate('/admin/payroll')}>
              Payroll Runs
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => navigate('/admin/payroll/center')}>
              <PlayCircle className="h-3.5 w-3.5" /> Run Workflow
            </Button>
          </>
        }
      />

      {/* ── Error / stale-data banners ─────────────────────────────────────── */}
      {isError && (
        <div className="flex items-center justify-between p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            Failed to load payroll statistics. Data shown below may be stale.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-destructive gap-1 px-2"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}
      {!isError && !isLoading && dataUpdatedAt > 0 && (Date.now() - dataUpdatedAt > 5 * 60_000) && (
        <div className="flex items-center justify-between p-3 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Statistics last updated {Math.floor((Date.now() - dataUpdatedAt) / 60_000)} min ago — data may not reflect recent changes.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-warning gap-1 px-2"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>
      )}

      {/* ── 1. Payroll Pipeline Strip ───────────────────────────────────────── */}
      <div className={cn(
        'rounded-lg border bg-card shadow-elev-1 p-4',
        hasCritical
          ? 'border-destructive/30'
          : stats?.is_frozen
          ? 'border-warning/30'
          : 'border-border',
      )}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">

          {/* Status dot + period */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className={cn(
              'w-2.5 h-2.5 rounded-full flex-shrink-0',
              hasCritical       ? 'bg-destructive animate-pulse' :
              stats?.is_frozen  ? 'bg-warning' :
              isLoading         ? 'bg-muted-foreground/30' :
                                  'bg-success',
            )} />
            <div>
              <p className="text-sm font-bold text-foreground tabular-nums">
                {isLoading ? '——' : (stats?.current_run_month ?? 'No active run')}
              </p>
              <p className="text-[10px] text-muted-foreground">Payroll period</p>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden sm:block w-px h-8 bg-border flex-shrink-0" />

          {/* Stage pipeline */}
          <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
            {STAGES.map((s, i) => {
              const isPast    = i < stageIdx
              const isCurrent = i === stageIdx
              const isFuture  = i > stageIdx
              return (
                <div key={s} className="flex items-center gap-1 flex-shrink-0">
                  <div className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                    isPast    && 'bg-success/15 text-success',
                    isCurrent && hasCritical            && 'bg-destructive/15 text-destructive ring-1 ring-destructive/30',
                    isCurrent && !hasCritical && stats?.is_frozen  && 'bg-warning/15 text-warning ring-1 ring-warning/30',
                    isCurrent && !hasCritical && !stats?.is_frozen && 'bg-primary/15 text-primary ring-1 ring-primary/30',
                    isFuture  && 'bg-muted/40 text-muted-foreground/50',
                  )}>
                    {s}
                  </div>
                  {i < STAGES.length - 1 && (
                    <ChevronRight className={cn(
                      'h-3 w-3 flex-shrink-0',
                      i < stageIdx ? 'text-success/50' : 'text-border',
                    )} />
                  )}
                </div>
              )
            })}
          </div>

          {/* CTA */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {stats?.is_frozen ? (
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs border-warning/40 text-warning hover:bg-warning/10"
                onClick={() => navigate('/admin/payroll/governance')}
              >
                <Lock className="h-3 w-3 mr-1" />
                Frozen — Governance
              </Button>
            ) : hasBlockers ? (
              <Button
                size="sm"
                className="h-7 text-xs bg-destructive hover:bg-destructive/90"
                onClick={() => navigate(blockerHref)}
              >
                <ShieldCheck className="h-3 w-3 mr-1" />
                Review {stats!.blockers} Blocker{stats!.blockers === 1 ? '' : 's'}
              </Button>
            ) : !isLoading && readyToRun ? (
              <Button
                size="sm" className="h-7 text-xs"
                onClick={() => navigate('/admin/payroll')}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Run Payroll
              </Button>
            ) : (
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => navigate('/admin/payroll')}
              >
                View Runs
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        <KpiChip
          label="Run Blockers"
          value={stats?.blockers ?? 0}
          colorClass={(stats?.blockers ?? 0) > 0 ? 'text-destructive' : 'text-success'}
          href={(stats?.blockers ?? 0) > 0 ? blockerHref : '/admin/payroll'}
          loading={isLoading}
        />
        <KpiChip
          label="Failed Payouts"
          value={stats?.failed_payouts ?? 0}
          colorClass={(stats?.failed_payouts ?? 0) > 0 ? 'text-destructive' : 'text-success'}
          href="/admin/payroll"
          loading={isLoading}
        />
        <KpiChip
          label="Compliance Gaps"
          value={stats?.compliance_mismatches ?? 0}
          colorClass={(stats?.compliance_mismatches ?? 0) > 0 ? 'text-warning' : 'text-success'}
          href="/admin/payroll/statutory-dashboard"
          loading={isLoading}
        />
        <KpiChip
          label="Reconcil. Open"
          value={stats?.reconciliation_open ?? 0}
          colorClass={(stats?.reconciliation_open ?? 0) > 3 ? 'text-warning' : 'text-foreground'}
          href="/admin/payroll/reconciliation"
          loading={isLoading}
        />
        <KpiChip
          label="Anomalies"
          value={stats?.unresolved_anomalies ?? 0}
          colorClass={(stats?.unresolved_anomalies ?? 0) > 0 ? 'text-warning' : 'text-success'}
          href="/admin/payroll/investigate"
          loading={isLoading}
        />
        <KpiChip
          label="Variance Cases"
          value={stats?.variance_cases ?? 0}
          colorClass={(stats?.variance_cases ?? 0) > 0 ? 'text-warning' : 'text-foreground'}
          href="/admin/payroll/investigate"
          loading={isLoading}
        />
        <KpiChip
          label="Pending Validation"
          value={stats?.pending_validations ?? 0}
          colorClass={(stats?.pending_validations ?? 0) > 5 ? 'text-warning' : 'text-foreground'}
          href="/admin/payroll/validation"
          loading={isLoading}
        />
        <KpiChip
          label="Payroll State"
          value={isLoading ? '—' : (stats?.is_frozen ? 'Frozen' : 'Open')}
          colorClass={stats?.is_frozen ? 'text-warning' : 'text-success'}
          href="/admin/payroll/governance"
          loading={isLoading}
        />
      </div>

      {/* ── 3. Two-column content ────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* ── Left — 2/3 width ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── Compensation Health Card ─────────────────────────────────────── */}
          <SectionCard
            title="Compensation Health"
            icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
            action={
              coverageLoading ? undefined :
              coverage?.ready_for_payroll
                ? <Badge variant="success"  className="rounded-full text-[10px]">Payroll Safe</Badge>
                : <Badge variant="destructive" className="rounded-full text-[10px]">Action Required</Badge>
            }
          >
            {coverageLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {[1,2,3].map(i => <div key={i} className="h-14 rounded-md bg-muted/40 animate-pulse" />)}
              </div>
            ) : !coverage ? (
              <div className="text-xs text-muted-foreground/60 py-3">Could not load coverage data.</div>
            ) : (
              <>
                {/* Coverage metric row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {/* Coverage % */}
                  <div className={cn(
                    'rounded-md border px-3 py-2.5',
                    coverage.coverage_percent >= 90 ? 'border-success/30 bg-success/5' :
                    coverage.coverage_percent >= 70 ? 'border-warning/30 bg-warning/5' :
                                                      'border-destructive/30 bg-destructive/5',
                  )}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Coverage</p>
                    <p className={cn(
                      'text-lg font-bold tabular-nums',
                      coverage.coverage_percent >= 90 ? 'text-success' :
                      coverage.coverage_percent >= 70 ? 'text-warning' : 'text-destructive',
                    )}>{coverage.coverage_percent}%</p>
                    <p className="text-[10px] text-muted-foreground">{coverage.employees_with_active_compensation}/{coverage.total_active_employees} employees</p>
                  </div>

                  {/* Missing */}
                  <div className={cn(
                    'rounded-md border px-3 py-2.5',
                    coverage.employees_missing_compensation > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5',
                  )}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Missing Comp.</p>
                    <p className={cn('text-lg font-bold tabular-nums', coverage.employees_missing_compensation > 0 ? 'text-destructive' : 'text-success')}>
                      {coverage.employees_missing_compensation}
                    </p>
                    <p className="text-[10px] text-muted-foreground">employees</p>
                  </div>

                  {/* No components */}
                  <div className={cn(
                    'rounded-md border px-3 py-2.5',
                    coverage.employees_with_no_components > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5',
                  )}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">No Components</p>
                    <p className={cn('text-lg font-bold tabular-nums', coverage.employees_with_no_components > 0 ? 'text-destructive' : 'text-success')}>
                      {coverage.employees_with_no_components}
                    </p>
                    <p className="text-[10px] text-muted-foreground">employees</p>
                  </div>

                  {/* Invalid / future */}
                  <div className={cn(
                    'rounded-md border px-3 py-2.5',
                    coverage.employees_with_invalid_components > 0 ? 'border-destructive/30 bg-destructive/5' :
                    coverage.employees_future_dated > 0 ? 'border-warning/30 bg-warning/5' :
                                                          'border-success/30 bg-success/5',
                  )}>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Invalid / Future</p>
                    <p className={cn(
                      'text-lg font-bold tabular-nums',
                      coverage.employees_with_invalid_components > 0 ? 'text-destructive' :
                      coverage.employees_future_dated > 0 ? 'text-warning' : 'text-success',
                    )}>
                      {coverage.employees_with_invalid_components + coverage.employees_future_dated}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {coverage.employees_with_invalid_components > 0 ? 'invalid' : 'future-dated'}
                    </p>
                  </div>
                </div>

                {/* Blocker rows */}
                {!coverage.ready_for_payroll && (
                  <div className="space-y-1.5">
                    {coverage.employees_missing_compensation > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20 text-xs">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                          <span className="text-destructive font-medium">{coverage.employees_missing_compensation} employee{coverage.employees_missing_compensation !== 1 ? 's' : ''} with no active compensation</span>
                        </div>
                        <Badge variant="destructive" className="rounded-full text-[9px] h-4 px-1.5">Blocker</Badge>
                      </div>
                    )}
                    {coverage.employees_with_no_components > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20 text-xs">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                          <span className="text-destructive font-medium">{coverage.employees_with_no_components} employee{coverage.employees_with_no_components !== 1 ? 's' : ''} with no salary components (gross pay = ₹0)</span>
                        </div>
                        <Badge variant="destructive" className="rounded-full text-[9px] h-4 px-1.5">Blocker</Badge>
                      </div>
                    )}
                    {coverage.employees_with_invalid_components > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20 text-xs">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                          <span className="text-destructive font-medium">{coverage.employees_with_invalid_components} employee{coverage.employees_with_invalid_components !== 1 ? 's' : ''} with invalid component amounts</span>
                        </div>
                        <Badge variant="destructive" className="rounded-full text-[9px] h-4 px-1.5">Blocker</Badge>
                      </div>
                    )}
                    {coverage.employees_future_dated > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-warning/5 border border-warning/20 text-xs">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                          <span className="text-warning font-medium">{coverage.employees_future_dated} future-dated compensation{coverage.employees_future_dated !== 1 ? 's' : ''} — will use prior active record</span>
                        </div>
                        <Badge variant="warning" className="rounded-full text-[9px] h-4 px-1.5">Warning</Badge>
                      </div>
                    )}
                    <div className="flex justify-end pt-1">
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                        onClick={() => navigate('/admin/workforce/employees')}>
                        <ArrowRight className="h-3 w-3" />Fix Compensation Issues
                      </Button>
                    </div>
                  </div>
                )}
                {coverage.ready_for_payroll && coverage.employees_future_dated > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-warning/5 border border-warning/20 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                    <span className="text-warning">{coverage.employees_future_dated} future-dated record{coverage.employees_future_dated !== 1 ? 's' : ''} — payroll will use previous active compensation</span>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                  <span className="text-[10px] text-muted-foreground">Last checked: {coverage.as_of}</span>
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => refetchCoverage()}>
                    <RefreshCw className="h-3 w-3 mr-1" />Refresh
                  </Button>
                </div>
              </>
            )}
          </SectionCard>

          {/* Attention Queue */}
          <SectionCard
            title="Attention Queue"
            icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          >
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : attentionItems.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground/60">
                <Activity className="h-3.5 w-3.5 text-success/60" />
                All systems operational — no active payroll issues detected.
              </div>
            ) : (
              <div className="space-y-1.5">
                {attentionItems.map(item => (
                  <Link
                    key={item.id}
                    to={item.href}
                    className={cn(
                      'flex items-center justify-between px-3 py-2.5 rounded-md border text-xs transition-colors group',
                      item.severity === 'critical'
                        ? 'border-destructive/20 bg-destructive/[0.04] hover:bg-destructive/[0.08]'
                        : 'border-warning/20 bg-warning/[0.04] hover:bg-warning/[0.08]',
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        'w-1.5 h-1.5 rounded-full flex-shrink-0',
                        item.severity === 'critical' ? 'bg-destructive' : 'bg-warning',
                      )} />
                      <div className="min-w-0">
                        <p className={cn(
                          'font-medium truncate',
                          item.severity === 'critical' ? 'text-destructive' : 'text-warning',
                        )}>
                          {item.title}
                        </p>
                        <p className="text-muted-foreground/60 truncate">{item.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <Badge
                        variant={item.severity === 'critical' ? 'destructive' : 'warning'}
                        className="rounded-full text-[9px] h-4 px-1.5 tabular-nums"
                      >
                        {item.count}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Payroll Readiness Surface */}
          <SectionCard
            title="Payroll Readiness"
            icon={<BadgeCheck className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-2">
                {readinessScore && (
                  <div className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold tabular-nums',
                    readinessScore.score >= 80 ? 'text-success border-success/30 bg-success/10' :
                    readinessScore.score >= 60 ? 'text-warning border-warning/30 bg-warning/10' :
                                                  'text-destructive border-destructive/30 bg-destructive/10',
                  )}>
                    <BarChart2 className="h-3 w-3" />{readinessScore.score}/{readinessScore.max} Grade {readinessScore.grade}
                  </div>
                )}
                {isLoading ? undefined :
                  readyToRun
                    ? <Badge variant="success" className="rounded-full text-[10px]">Ready to Run</Badge>
                    : <Badge variant="warning" className="rounded-full text-[10px]">Not Ready</Badge>
                }
              </div>
            }
          >
            <div className="space-y-1.5">
              <ReadinessCheck
                label="Compensation coverage complete"
                ok={coverage?.ready_for_payroll !== false}
                count={
                  (coverage?.employees_missing_compensation ?? 0) +
                  (coverage?.employees_with_no_components   ?? 0) +
                  (coverage?.employees_with_invalid_components ?? 0)
                }
                href="/admin/workforce/employees"
              />
              <ReadinessCheck
                label="No payroll run blockers"
                ok={(stats?.blockers ?? 0) === 0}
                count={stats?.blockers}
                href={blockerHref}
              />
              <ReadinessCheck
                label="Validation rules passing"
                ok={(stats?.pending_validations ?? 0) === 0}
                count={stats?.pending_validations}
                href="/admin/payroll/validation"
              />
              <ReadinessCheck
                label="Payroll period not frozen"
                ok={!stats?.is_frozen}
                href="/admin/payroll/governance"
              />
              <ReadinessCheck
                label="No failed payouts"
                ok={(stats?.failed_payouts ?? 0) === 0}
                count={stats?.failed_payouts}
                href="/admin/payroll"
              />
              <ReadinessCheck
                label="Compliance gaps resolved"
                ok={(stats?.compliance_mismatches ?? 0) === 0}
                count={stats?.compliance_mismatches}
                href="/admin/payroll/statutory-dashboard"
              />
            </div>
            {!isLoading && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => navigate('/admin/payroll')}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Run Payroll
                </Button>
                <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => navigate('/admin/payroll/finalize')}>
                  <Lock className="h-3.5 w-3.5 mr-1.5" />Finalize
                </Button>
              </div>
            )}
          </SectionCard>

          {/* Operational Tools — collapsible */}
          <div className="rounded-lg border border-border bg-card shadow-elev-1">
            <button
              type="button"
              onClick={() => setToolsOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-foreground">Operational Tools</span>
              <ChevronDown className={cn(
                'h-4 w-4 text-muted-foreground transition-transform duration-150',
                toolsOpen && 'rotate-180',
              )} />
            </button>
            {toolsOpen && (
              <div className="px-4 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {QUICK_ACTIONS.map(qa => (
                    <button
                      key={qa.href}
                      type="button"
                      onClick={() => navigate(qa.href)}
                      className={cn(
                        'group flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all duration-200 hover:-translate-y-0.5',
                        ACCENT_CLASSES[qa.accent ?? 'neutral'],
                      )}
                    >
                      <span className="chip-grad flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm flex-shrink-0">
                        <qa.icon className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <p className="text-[12px] font-medium text-foreground leading-tight">{qa.label}</p>
                        <p className="text-[10px] text-muted-foreground/60 leading-tight mt-0.5">{qa.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ── Right — 1/3 width ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Operations Rail */}
          <SectionCard
            title="Operations Rail"
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="space-y-2 text-xs">

              {/* Freeze state */}
              <div className={cn(
                'flex items-center justify-between p-2.5 rounded-md border',
                stats?.is_frozen
                  ? 'border-warning/30 bg-warning/5'
                  : 'border-success/30 bg-success/5',
              )}>
                <div className="flex items-center gap-2">
                  <Lock className={cn('h-3.5 w-3.5', stats?.is_frozen ? 'text-warning' : 'text-success')} />
                  <span className="font-medium text-foreground">Freeze State</span>
                </div>
                <Badge
                  variant={stats?.is_frozen ? 'warning' : 'success'}
                  className="rounded-full text-[9px]"
                >
                  {isLoading ? '—' : (stats?.is_frozen ? 'Frozen' : 'Open')}
                </Badge>
              </div>

              {/* Current period */}
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium text-foreground">Current Period</span>
                </div>
                <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                  {isLoading ? '——' : (stats?.current_run_month ?? 'Not set')}
                </span>
              </div>

              {/* OT mismatches (shown only when non-zero) */}
              {(stats?.ot_mismatches ?? 0) > 0 && (
                <Link
                  to="/admin/payroll/reconciliation"
                  className="flex items-center justify-between p-2.5 rounded-md border border-warning/20 bg-warning/5 hover:bg-warning/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-3.5 w-3.5 text-warning" />
                    <span className="font-medium text-warning">OT Mismatches</span>
                  </div>
                  <Badge variant="warning" className="rounded-full text-[9px]">{stats!.ot_mismatches}</Badge>
                </Link>
              )}

              {/* Deduction gaps (shown only when non-zero) */}
              {(stats?.deduction_gaps ?? 0) > 0 && (
                <Link
                  to="/admin/payroll/reconciliation"
                  className="flex items-center justify-between p-2.5 rounded-md border border-warning/20 bg-warning/5 hover:bg-warning/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Scale className="h-3.5 w-3.5 text-warning" />
                    <span className="font-medium text-warning">Deduction Gaps</span>
                  </div>
                  <Badge variant="warning" className="rounded-full text-[9px]">{stats!.deduction_gaps}</Badge>
                </Link>
              )}

              {/* Quick-nav shortcuts */}
              <div className="pt-1 space-y-0.5">
                {([
                  { label: 'Resolution Center', href: blockerHref,                            icon: ShieldCheck },
                  { label: 'Validation Rules',  href: '/admin/payroll/validation',             icon: CheckSquare },
                  { label: 'Governance',        href: '/admin/payroll/governance',             icon: Lock },
                  { label: 'Statutory',         href: '/admin/payroll/statutory-dashboard',    icon: BarChart3 },
                  { label: 'Reconciliation',    href: '/admin/payroll/reconciliation',          icon: Scale },
                  { label: 'Investigations',    href: '/admin/payroll/investigate',             icon: Search },
                  { label: 'Cost Intel',        href: '/admin/payroll/cost-intelligence',      icon: PieChart },
                  { label: 'Comp. Revisions',   href: '/admin/payroll/compensation-revisions', icon: FileWarning },
                ] as Array<{ label: string; href: string; icon: React.ComponentType<{ className?: string }> }>).map(({ label, href, icon: Icon }) => (
                  <Link
                    key={label}
                    to={href}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-foreground/80">{label}</span>
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </Link>
                ))}
              </div>

            </div>
          </SectionCard>

          {/* Activity Timeline */}
          <SectionCard
            title="Recent Events"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          >
            <OperationalTimeline
              events={timeline}
              loading={eventsLoading}
              maxItems={10}
            />
          </SectionCard>

        </div>
      </div>
    </PageContainer>
  )
}
