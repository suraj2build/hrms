/**
 * ReadinessDashboard — Operational Platform Health Console
 *
 * The single source of truth for HRMS operational readiness.
 * Shows domain-by-domain health, aggregated blockers, next actions,
 * and setup workflow guidance — all derived from existing TanStack
 * Query cache. Zero extra backend calls.
 *
 * Design principles:
 *   - Operational dashboard, not a consumer onboarding wizard
 *   - Dense, data-forward — every pixel earns its place
 *   - Domain cards are the primary unit; blockers surface inline
 *   - Score is a operational metric, not a gamification element
 */
import { useMemo }                    from 'react'
import { useNavigate }                from 'react-router-dom'
import {
  CheckCircle2, AlertTriangle, XCircle,
  ChevronRight, Loader2, RefreshCw,
  Building2, Users, Clock, DollarSign,
  ShieldCheck, Activity,
} from 'lucide-react'
import { Button }                     from '@/components/ui/button'
import { Badge }                      from '@/components/ui/badge'
import { cn }                         from '@/lib/utils'
import { useAllDomainReadiness }      from '@/lib/readiness/hooks'
import { computePlatformScore }       from '@/lib/readiness/utils'
import { DomainReadinessCard }        from '@/components/readiness/DomainReadinessCard'
import { WorkflowSequence }           from '@/components/readiness/WorkflowSequence'
import type { DomainReadiness, WorkflowStep } from '@/lib/readiness/types'

// ── Domain icons ──────────────────────────────────────────────────────────────

const DOMAIN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  organization: Building2,
  workforce:    Users,
  attendance:   Clock,
  payroll:      DollarSign,
}

// ── Platform score ring ───────────────────────────────────────────────────────

function PlatformScoreRing({ score, isLoading }: { score: number; isLoading: boolean }) {
  const radius      = 36
  const circumference = 2 * Math.PI * radius
  const dashOffset  = circumference * (1 - score / 100)

  const color = score >= 80 ? '#22c55e'   // success
              : score >= 50 ? '#f59e0b'   // warning
              : '#ef4444'                  // destructive

  return (
    <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
      <svg width="96" height="96" className="-rotate-90">
        {/* Track */}
        <circle
          cx="48" cy="48" r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted/30"
        />
        {/* Progress */}
        {!isLoading && (
          <circle
            cx="48" cy="48" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
        ) : (
          <>
            <span className="text-2xl font-bold tabular-nums leading-none"
              style={{ color }}
            >
              {score}
            </span>
            <span className="text-[10px] text-muted-foreground/60 font-medium">/ 100</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Platform health banner ────────────────────────────────────────────────────

function PlatformHealthBanner({
  score,
  isLoading,
  totalBlockers,
  totalWarnings,
  readyDomains,
  totalDomains,
}: {
  score:         number
  isLoading:     boolean
  totalBlockers: number
  totalWarnings: number
  readyDomains:  number
  totalDomains:  number
}) {
  const statusLabel = isLoading ? 'Loading…'
    : totalBlockers > 0 ? 'Blocked'
    : totalWarnings > 0 ? 'Degraded'
    : score >= 80       ? 'Operational'
    :                     'Partial'

  const statusColor = isLoading         ? 'text-muted-foreground'
    : totalBlockers > 0 ? 'text-destructive'
    : totalWarnings > 0 ? 'text-warning'
    : score >= 80       ? 'text-success'
    :                     'text-primary'

  return (
    <div className="flex items-center gap-5 rounded-xl border border-border/60 bg-card px-5 py-4">
      {/* Score ring */}
      <PlatformScoreRing score={score} isLoading={isLoading} />

      {/* Summary */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <h1 className="text-base font-semibold text-foreground">Platform Readiness</h1>
          <span className={cn('text-xs font-semibold', statusColor)}>{statusLabel}</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mb-3">
          Operational health score across all active Emvora domains. Resolve blockers
          before running payroll or processing attendance.
        </p>

        {/* Stat chips */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">{readyDomains}</span>
              /{totalDomains} domains ready
            </span>
          </div>
          {totalBlockers > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <XCircle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-muted-foreground">
                <span className="font-semibold text-destructive">{totalBlockers}</span>{' '}
                blocker{totalBlockers !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {totalWarnings > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              <span className="text-muted-foreground">
                <span className="font-semibold text-warning">{totalWarnings}</span>{' '}
                warning{totalWarnings !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {totalBlockers === 0 && totalWarnings === 0 && !isLoading && (
            <div className="flex items-center gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5 text-success" />
              <span className="text-success font-medium">All clear — no blockers or warnings</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Aggregated blockers panel ─────────────────────────────────────────────────

function BlockersPanel({ domains }: { domains: DomainReadiness[] }) {
  const navigate  = useNavigate()
  const allBlocking = useMemo(() =>
    domains.flatMap(d =>
      d.blockers.map(b => ({ ...b, domainLabel: d.label }))
    ),
    [domains],
  )

  if (allBlocking.length === 0) return null

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/3 overflow-hidden">
      <div className="px-4 py-3 border-b border-destructive/20 bg-destructive/5 flex items-center gap-2">
        <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-xs font-semibold text-destructive">
          {allBlocking.length} operational blocker{allBlocking.length !== 1 ? 's' : ''} — payroll and attendance are at risk
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {allBlocking.map((check, i) => (
          <div key={`${check.id}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-muted-foreground/60 border-border/40">
                  {check.domainLabel}
                </Badge>
                <span className="text-xs font-medium text-destructive">{check.label}</span>
              </div>
              {check.recommendation && (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {check.recommendation}
                </p>
              )}
            </div>
            {check.actionPath && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] shrink-0 border-destructive/30 text-destructive hover:text-destructive hover:bg-destructive/5"
                onClick={() => navigate(check.actionPath!)}
              >
                {check.actionLabel ?? 'Fix'} <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Setup workflow (setup sequence for new tenants) ───────────────────────────

function deriveSetupWorkflow(domains: DomainReadiness[]): WorkflowStep[] {
  const org        = domains.find(d => d.domain === 'organization')
  const workforce  = domains.find(d => d.domain === 'workforce')
  const attendance = domains.find(d => d.domain === 'attendance')
  const payroll    = domains.find(d => d.domain === 'payroll')

  function stepStatus(d?: DomainReadiness): WorkflowStep['status'] {
    if (!d || d.isLoading) return 'pending'
    if (d.isEmpty)   return 'pending'
    if (d.isReady)   return 'complete'
    if (d.blockers.length > 0) return 'in_progress'
    return 'in_progress'
  }

  // A step is blocked if the prior step isn't complete
  const orgDone  = org?.isReady   ?? false
  const wfDone   = workforce?.isReady ?? false
  const attDone  = attendance?.isReady ?? false

  return [
    {
      id:          'setup-org',
      label:       'Configure Organization Structure',
      description: 'Sites, work locations, departments, cost centers',
      status:      stepStatus(org),
      blockers:    org?.blockers.map(b => b.recommendation ?? b.label),
      actionPath:  '/admin/organization',
      actionLabel: 'Organization',
    },
    {
      id:          'setup-workforce',
      label:       'Onboard Employees',
      description: 'Add employees, assign salary structures',
      status:      !orgDone ? 'blocked' : stepStatus(workforce),
      blockers:    workforce?.blockers.map(b => b.recommendation ?? b.label),
      actionPath:  '/admin/employees',
      actionLabel: 'Employees',
    },
    {
      id:          'setup-attendance',
      label:       'Configure Attendance',
      description: 'Shifts, rosters, assign employees to shifts',
      status:      !wfDone ? 'blocked' : stepStatus(attendance),
      blockers:    attendance?.blockers.map(b => b.recommendation ?? b.label),
      actionPath:  '/admin/shift-master',
      actionLabel: 'Shifts',
    },
    {
      id:          'setup-payroll',
      label:       'Run First Payroll',
      description: 'Salary structures, components, payroll run',
      status:      !attDone ? 'blocked' : stepStatus(payroll),
      blockers:    payroll?.blockers.map(b => b.recommendation ?? b.label),
      actionPath:  '/admin/payroll',
      actionLabel: 'Payroll',
    },
  ]
}

// ── Next actions panel ────────────────────────────────────────────────────────

function NextActionsPanel({ domains }: { domains: DomainReadiness[] }) {
  const navigate = useNavigate()

  const actions = useMemo(() =>
    domains
      .filter(d => !d.isLoading && !d.isEmpty && d.nextAction)
      .map(d => ({ domain: d, action: d.nextAction! }))
      .slice(0, 5),
    [domains],
  )

  if (actions.length === 0) return null

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40">
        <p className="text-xs font-semibold text-foreground">Recommended Next Actions</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Highest-priority unresolved items across domains</p>
      </div>
      <div className="divide-y divide-border/30">
        {actions.map(({ domain, action }, i) => {
          const Icon = DOMAIN_ICONS[domain.domain] ?? Activity
          const isError = action.status === 'error' || action.isBlocking
          return (
            <div key={`${domain.domain}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
              <Icon className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'text-xs font-medium leading-snug',
                  isError ? 'text-destructive' : 'text-warning',
                )}>
                  {domain.label}
                </p>
                {action.recommendation && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {action.recommendation}
                  </p>
                )}
              </div>
              {action.actionPath && (
                <button
                  onClick={() => navigate(action.actionPath!)}
                  className={cn(
                    'text-[10px] shrink-0 flex items-center gap-0.5 font-medium mt-0.5',
                    isError ? 'text-destructive hover:underline' : 'text-primary hover:underline',
                  )}
                >
                  {action.actionLabel ?? 'Go'} <ChevronRight className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── ReadinessDashboard ────────────────────────────────────────────────────────

export function ReadinessDashboard() {
  const navigate = useNavigate()
  const { org, workforce, payroll, attendance, all, isLoading } = useAllDomainReadiness()

  const platformScore  = useMemo(() => computePlatformScore(all), [all])
  const totalBlockers  = useMemo(() => all.reduce((n, d) => n + d.blockers.length, 0), [all])
  const totalWarnings  = useMemo(() => all.reduce((n, d) => n + d.warnings.length, 0), [all])
  const readyDomains   = useMemo(() => all.filter(d => d.isReady).length, [all])

  const setupSteps     = useMemo(() => deriveSetupWorkflow(all), [all])
  const setupComplete  = setupSteps.every(s => s.status === 'complete')

  // Domain path map for DomainReadinessCard navigation
  const domainPaths: Record<string, string> = {
    organization: '/admin/organization',
    workforce:    '/admin/employees',
    attendance:   '/admin/attendance',
    payroll:      '/admin/payroll',
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="border-b border-border/60 bg-card/50 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-semibold text-foreground">Platform Readiness</h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Real-time operational health across all Emvora domains
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3 w-3 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 space-y-5 max-w-6xl mx-auto w-full">

        {/* Platform health banner */}
        <PlatformHealthBanner
          score={platformScore}
          isLoading={isLoading}
          totalBlockers={totalBlockers}
          totalWarnings={totalWarnings}
          readyDomains={readyDomains}
          totalDomains={all.length}
        />

        {/* Domain cards grid */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
            Domain Health
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <DomainReadinessCard
              readiness={org}
              domainPath={domainPaths.organization}
            />
            <DomainReadinessCard
              readiness={workforce}
              domainPath={domainPaths.workforce}
            />
            <DomainReadinessCard
              readiness={attendance}
              domainPath={domainPaths.attendance}
            />
            <DomainReadinessCard
              readiness={payroll}
              domainPath={domainPaths.payroll}
            />
          </div>
        </div>

        {/* Blockers panel — only shown when blockers exist */}
        {totalBlockers > 0 && (
          <BlockersPanel domains={all} />
        )}

        {/* Bottom row: setup workflow + next actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Setup workflow */}
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <p className="text-xs font-semibold text-foreground">Platform Setup Sequence</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Complete these steps in order to run payroll
                </p>
              </div>
              {setupComplete && (
                <Badge variant="success" className="text-[10px] h-5 px-1.5 rounded-full shrink-0">
                  Complete
                </Badge>
              )}
            </div>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-5 w-5 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <WorkflowSequence steps={setupSteps} />
            )}
          </div>

          {/* Next actions */}
          <div className="space-y-3">
            <NextActionsPanel domains={all} />

            {/* Quick links */}
            <div className="rounded-lg border border-border/60 bg-card p-4">
              <p className="text-xs font-semibold text-foreground mb-3">Quick Navigation</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: 'Import Data',       path: '/admin/import',          icon: '↑' },
                  { label: 'Employee List',      path: '/admin/employees',        icon: '👥' },
                  { label: 'Shift Master',       path: '/admin/shift-master',     icon: '⏱' },
                  { label: 'Payroll Runs',       path: '/admin/payroll',          icon: '💰' },
                  { label: 'Organization',       path: '/admin/organization',     icon: '🏢' },
                  { label: 'Payroll Readiness',  path: '/admin/payroll-readiness', icon: '✓' },
                ].map(link => (
                  <button
                    key={link.path}
                    onClick={() => navigate(link.path)}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border/40 rounded px-2.5 py-1.5 hover:bg-muted/30 transition-colors text-left"
                  >
                    <span className="text-[10px]">{link.icon}</span>
                    <span>{link.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Domain detail links */}
        <div className="border-t border-border/40 pt-4">
          <p className="text-[11px] text-muted-foreground/50 text-center">
            Click any domain card to navigate directly to that module.
            Readiness data refreshes automatically as you use the platform.
          </p>
        </div>

      </div>
    </div>
  )
}
