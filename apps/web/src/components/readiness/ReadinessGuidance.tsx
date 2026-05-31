/**
 * ReadinessGuidance — Compact inline contextual guidance banner.
 *
 * Embeds on any page to surface the most important operational action
 * for a given domain without being intrusive.
 *
 * Design principles:
 *   - One line when ok, two lines when there's an issue
 *   - Dismissible per session
 *   - No modals, no blocking UI
 *   - Enterprise operational language, not onboarding language
 *
 * Usage:
 *   <ReadinessGuidance domain="organization" />
 *   <ReadinessGuidance domain="payroll" collapsed />
 */
import { useState }           from 'react'
import { useNavigate }        from 'react-router-dom'
import {
  CheckCircle2, AlertTriangle, XCircle,
  ChevronRight, X, Info,
} from 'lucide-react'
import { Button }             from '@/components/ui/button'
import { cn }                 from '@/lib/utils'
import type { ReadinessDomain } from '@/lib/readiness/types'
import {
  useOrgReadiness,
  useWorkforceReadiness,
  usePayrollReadiness,
  useAttendanceReadiness,
}                             from '@/lib/readiness/hooks'
import type { DomainReadiness } from '@/lib/readiness/types'

// ── Hook selector ─────────────────────────────────────────────────────────────

function useDomainReadiness(domain: ReadinessDomain): DomainReadiness {
  const org        = useOrgReadiness()
  const workforce  = useWorkforceReadiness()
  const payroll    = usePayrollReadiness()
  const attendance = useAttendanceReadiness()

  switch (domain) {
    case 'organization': return org
    case 'workforce':    return workforce
    case 'payroll':      return payroll
    case 'attendance':   return attendance
    default:             return org  // fallback
  }
}

// ── ReadinessGuidance ─────────────────────────────────────────────────────────

interface ReadinessGuidanceProps {
  domain:     ReadinessDomain
  /** Only show if there are issues — suppress the "all good" state */
  issueOnly?: boolean
  className?: string
}

export function ReadinessGuidance({
  domain,
  issueOnly = false,
  className,
}: ReadinessGuidanceProps) {
  const navigate   = useNavigate()
  const [dismissed, setDismissed] = useState(false)
  const readiness  = useDomainReadiness(domain)

  if (dismissed)          return null
  if (readiness.isLoading) return null
  if (issueOnly && readiness.isReady && readiness.warnings.length === 0) return null

  const issue = readiness.nextAction

  // All good state
  if (!issue) {
    if (issueOnly) return null
    return (
      <div className={cn(
        'flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2',
        className,
      )}>
        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
        <span className="text-xs text-success font-medium flex-1">
          {readiness.label}: all checks passing
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground/50 hover:text-muted-foreground shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  // Determine tone
  const isError   = issue.status === 'error' || issue.isBlocking
  const isWarning = issue.status === 'warning'

  return (
    <div className={cn(
      'flex items-start gap-2.5 rounded-md border px-3 py-2.5',
      isError   ? 'border-destructive/30 bg-destructive/5'
      : isWarning ? 'border-warning/30 bg-warning/5'
      :             'border-primary/20 bg-primary/5',
      className,
    )}>
      {/* Icon */}
      <span className="mt-0.5 shrink-0">
        {isError
          ? <XCircle       className="h-3.5 w-3.5 text-destructive" />
          : isWarning
          ? <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          : <Info          className="h-3.5 w-3.5 text-primary" />
        }
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-xs font-medium leading-snug',
          isError ? 'text-destructive' : isWarning ? 'text-warning' : 'text-primary',
        )}>
          {readiness.label}
          {readiness.blockers.length > 0 && (
            <span className="font-normal text-muted-foreground ml-1">
              · {readiness.blockers.length} blocker{readiness.blockers.length !== 1 ? 's' : ''} blocking operations
            </span>
          )}
        </p>
        {issue.recommendation && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {issue.recommendation}
          </p>
        )}
      </div>

      {/* CTA */}
      {issue.actionPath && (
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-6 px-2 text-[10px] shrink-0',
            isError   ? 'text-destructive hover:text-destructive'
            : isWarning ? 'text-warning hover:text-warning'
            :             'text-primary hover:text-primary',
          )}
          onClick={() => navigate(issue.actionPath!)}
        >
          {issue.actionLabel ?? 'Fix'} <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
        </Button>
      )}

      {/* Dismiss */}
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground/40 hover:text-muted-foreground shrink-0 mt-0.5"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── ReadinessBlockerList — inline blocker list for page headers ───────────────

interface ReadinessBlockerListProps {
  domain:    ReadinessDomain
  maxItems?: number
  className?: string
}

export function ReadinessBlockerList({
  domain,
  maxItems = 3,
  className,
}: ReadinessBlockerListProps) {
  const navigate  = useNavigate()
  const readiness = useDomainReadiness(domain)

  if (readiness.isLoading || readiness.isReady) return null

  const items = [...readiness.blockers, ...readiness.warnings].slice(0, maxItems)
  if (items.length === 0) return null

  return (
    <div className={cn('space-y-1', className)}>
      {items.map(item => (
        <div key={item.id} className="flex items-start gap-2 text-xs">
          {item.isBlocking
            ? <XCircle       className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
            : <AlertTriangle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
          }
          <span className="flex-1 text-muted-foreground leading-snug">
            {item.recommendation ?? item.label}
          </span>
          {item.actionPath && (
            <button
              onClick={() => navigate(item.actionPath!)}
              className="text-primary hover:underline shrink-0 flex items-center gap-0.5"
            >
              {item.actionLabel ?? 'Fix'}
              <ChevronRight className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
