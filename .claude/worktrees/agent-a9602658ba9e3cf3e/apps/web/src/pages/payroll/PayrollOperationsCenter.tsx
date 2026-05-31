/**
 * PayrollOperationsCenter — /admin/payroll/center
 *
 * Payroll Operations Command Center — single-scroll operational workspace.
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
} from 'lucide-react'

import { PageContainer }       from '@/components/layout/PageContainer'
import { PageHeader }          from '@/components/layout/PageHeader'
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
  { label: 'Payroll Runs',      description: 'Run and manage payroll cycles',              href: '/admin/payroll',                       icon: DollarSign,   accent: 'neutral'  },
  { label: 'Validation',        description: 'Pre-run validation and readiness checks',    href: '/admin/payroll/validation',             icon: CheckSquare,  accent: 'warning'  },
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

  // ── Queries (both preserved exactly as original) ───────────────────────────
  const { data: stats, isLoading } = useQuery<PayrollRunStats>({
    queryKey:  ['payroll-run-stats'],
    queryFn:   () => api.get('/payroll/runs/stats'),
    staleTime: 30_000,
    retry:     false,
  })

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

  // ── Derived state ───────────────────────────────────────────────────────────
  const stage      = deriveStage(stats)
  const stageIdx   = STAGES.indexOf(stage)
  const hasBlockers  = (stats?.blockers ?? 0) > 0
  const hasCritical  = hasBlockers || (stats?.failed_payouts ?? 0) > 0 || (stats?.failed_bank_transfers ?? 0) > 0
  const readyToRun   = !isLoading
    && (stats?.blockers ?? 0) === 0
    && !stats?.is_frozen
    && (stats?.pending_validations ?? 0) === 0

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
      items.push({ id: 'run-blockers',    severity: 'critical', title: 'Payroll run blockers',          desc: 'Validation issues preventing payroll processing',       count: stats.blockers,              href: '/admin/payroll/validation' })
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
  }, [stats])

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
      <PageHeader
        title="Payroll Operations"
        subtitle={`Command center — runs, validations, reconciliation and compliance${stats?.current_run_month ? ` · ${stats.current_run_month}` : ''}`}
        actions={
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/admin/payroll')}>
            Payroll Runs
          </Button>
        }
      />

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
                onClick={() => navigate('/admin/payroll/validation')}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Fix {stats!.blockers} Blocker{stats!.blockers === 1 ? '' : 's'}
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
          href="/admin/payroll/validation"
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
              isLoading ? undefined :
              readyToRun
                ? <Badge variant="success" className="rounded-full text-[10px]">Ready to Run</Badge>
                : <Badge variant="warning" className="rounded-full text-[10px]">Not Ready</Badge>
            }
          >
            <div className="space-y-1.5">
              <ReadinessCheck
                label="No validation blockers"
                ok={(stats?.blockers ?? 0) === 0}
                count={stats?.blockers}
                href="/admin/payroll/validation"
              />
              <ReadinessCheck
                label="No pending validations"
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
            {!isLoading && readyToRun && (
              <Button
                size="sm"
                className="w-full mt-3 h-8 text-xs"
                onClick={() => navigate('/admin/payroll')}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Proceed to Payroll Runs
              </Button>
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
                        'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors',
                        ACCENT_CLASSES[qa.accent ?? 'neutral'],
                      )}
                    >
                      <qa.icon className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
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
                  { label: 'Governance',     href: '/admin/payroll/governance',          icon: ShieldCheck },
                  { label: 'Statutory',      href: '/admin/payroll/statutory-dashboard', icon: BarChart3 },
                  { label: 'Reconciliation', href: '/admin/payroll/reconciliation',       icon: Scale },
                  { label: 'Investigations', href: '/admin/payroll/investigate',          icon: Search },
                  { label: 'Cost Intel',     href: '/admin/payroll/cost-intelligence',   icon: PieChart },
                  { label: 'Comp. Revisions',href: '/admin/payroll/compensation-revisions', icon: FileWarning },
                ] as const).map(({ label, href, icon: Icon }) => (
                  <Link
                    key={href}
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
