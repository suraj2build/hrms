/**
 * DomainReadinessCard — Compact domain health tile for the Readiness Dashboard.
 *
 * Shows:
 *   • Domain label + icon
 *   • Completion score bar (thin)
 *   • Blockers + warnings listed compactly
 *   • Next recommended action
 *   • Quick-navigate to domain
 */
import { useNavigate }        from 'react-router-dom'
import {
  CheckCircle2, AlertTriangle, XCircle,
  ChevronRight, Loader2, HelpCircle,
} from 'lucide-react'
import { Badge }              from '@/components/ui/badge'
import { Button }             from '@/components/ui/button'
import { cn }                 from '@/lib/utils'
import type { DomainReadiness, ReadinessCheck } from '@/lib/readiness/types'

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-success'
              : score >= 50 ? 'bg-warning'
              : 'bg-destructive'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn(
        'text-xs font-semibold tabular-nums shrink-0',
        score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-destructive',
      )}>
        {score}%
      </span>
    </div>
  )
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ check, onClick }: { check: ReadinessCheck; onClick?: () => void }) {
  const icon = check.status === 'ok'      ? <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
             : check.status === 'error'   ? <XCircle      className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
             : check.status === 'warning' ? <AlertTriangle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
             :                              <HelpCircle    className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-0.5" />

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex items-start gap-1.5 text-left w-full rounded px-1 py-0.5 -mx-1 transition-colors',
        onClick ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default',
      )}
    >
      {icon}
      <span className={cn(
        'text-[11px] leading-snug flex-1',
        check.status === 'ok'      ? 'text-muted-foreground'
        : check.status === 'error'  ? 'text-destructive'
        : check.status === 'warning'? 'text-warning'
        :                             'text-muted-foreground/50',
      )}>
        {check.recommendation ?? check.label}
        {check.value !== undefined && check.status === 'ok' && (
          <span className="text-muted-foreground/50 ml-1">({check.value})</span>
        )}
      </span>
    </button>
  )
}

// ── DomainReadinessCard ───────────────────────────────────────────────────────

interface DomainReadinessCardProps {
  readiness:   DomainReadiness
  domainPath?: string    // optional override for "view domain" navigation
  className?:  string
}

export function DomainReadinessCard({
  readiness,
  domainPath,
  className,
}: DomainReadinessCardProps) {
  const navigate = useNavigate()

  if (readiness.isLoading) {
    return (
      <div className={cn(
        'rounded-lg border border-border/60 bg-card p-4 flex flex-col gap-3',
        className,
      )}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          <span className="text-sm font-semibold text-muted-foreground">{readiness.label}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted animate-pulse" />
      </div>
    )
  }

  // Status badge
  const statusBadge = readiness.isReady ? (
    <Badge variant="success" className="rounded-full text-[10px] h-4 px-1.5">Ready</Badge>
  ) : readiness.blockers.length > 0 ? (
    <Badge variant="destructive" className="rounded-full text-[10px] h-4 px-1.5">
      {readiness.blockers.length} blocker{readiness.blockers.length !== 1 ? 's' : ''}
    </Badge>
  ) : readiness.isEmpty ? (
    <Badge variant="outline" className="rounded-full text-[10px] h-4 px-1.5 text-muted-foreground">
      Not configured
    </Badge>
  ) : (
    <Badge variant="warning" className="rounded-full text-[10px] h-4 px-1.5">
      {readiness.warnings.length} warning{readiness.warnings.length !== 1 ? 's' : ''}
    </Badge>
  )

  // Show top 3 issues (blockers first, then warnings)
  const issues = [...readiness.blockers, ...readiness.warnings].slice(0, 3)
  const okCount = readiness.checks.filter(c => c.status === 'ok').length

  return (
    <div className={cn(
      'rounded-lg border bg-card flex flex-col overflow-hidden transition-colors',
      readiness.blockers.length > 0
        ? 'border-destructive/30'
        : readiness.warnings.length > 0
        ? 'border-warning/30'
        : readiness.isReady
        ? 'border-success/30'
        : 'border-border/60',
      className,
    )}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <button
              onClick={() => domainPath && navigate(domainPath)}
              disabled={!domainPath}
              className={cn(
                'text-sm font-semibold text-foreground text-left',
                domainPath && 'hover:text-primary transition-colors cursor-pointer',
              )}
            >
              {readiness.label}
            </button>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{readiness.description}</p>
          </div>
          {statusBadge}
        </div>

        {/* Score bar */}
        <ScoreBar score={readiness.score} />
      </div>

      {/* Issues list */}
      <div className="flex-1 px-4 pb-3 space-y-0.5 min-h-[4rem]">
        {readiness.isEmpty ? (
          <p className="text-[11px] text-muted-foreground/50 italic pt-1">
            No data — not yet configured.
          </p>
        ) : issues.length === 0 ? (
          <div className="flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="h-3 w-3 text-success" />
            <span className="text-[11px] text-success">
              All {okCount} check{okCount !== 1 ? 's' : ''} passing
            </span>
          </div>
        ) : (
          issues.map(check => (
            <CheckRow
              key={check.id}
              check={check}
              onClick={check.actionPath ? () => navigate(check.actionPath!) : undefined}
            />
          ))
        )}
      </div>

      {/* Next action footer */}
      {readiness.nextAction && !readiness.isEmpty && (
        <div className="border-t border-border/40 px-4 py-2.5 bg-muted/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground truncate">
              Next: <span className="font-medium text-foreground">
                {readiness.nextAction.actionLabel ?? readiness.nextAction.label}
              </span>
            </span>
            {readiness.nextAction.actionPath && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] shrink-0 text-primary hover:text-primary"
                onClick={() => navigate(readiness.nextAction!.actionPath!)}
              >
                Go <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
