/**
 * OperationalErrorBanner — enterprise-grade operational error display.
 *
 * Renders structured error state with:
 *   - Severity badge (critical / high / medium / low)
 *   - Error message + optional API error code
 *   - Remediation guidance text
 *   - Retry CTA (disabled while retrying)
 *   - Escalation link / guidance
 *   - Structured details (key-value pairs)
 *   - Dismiss control
 *
 * Used for mutations and queries that fail in operational contexts
 * (payroll, reconciliation, upload, import, etc.) where "toast + ignore"
 * is insufficient for enterprise operators.
 */

import { useState }          from 'react'
import {
  AlertTriangle, XCircle, AlertCircle, Info,
  RefreshCw, Loader2, ChevronDown, ChevronRight,
  X, ArrowUpRight,
} from 'lucide-react'
import { cn }    from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge }  from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface OperationalErrorBannerProps {
  /** Error message to display. Pass null/undefined to suppress rendering. */
  error:             string | null | undefined
  /** API error code (e.g. "INSERT_FAILED", "VALIDATION_ERROR"). Optional. */
  errorCode?:        string
  /** Visual severity — affects icon and color scheme. Default: "high". */
  severity?:         ErrorSeverity
  /** Human-readable remediation instruction for the operator. */
  remediationText?:  string
  /** Called when the user clicks Retry. If omitted, no Retry button is shown. */
  onRetry?:          () => void
  /** True while the retry is in flight — disables the Retry button. */
  retrying?:         boolean
  /** Called when the user clicks Dismiss. If omitted, no Dismiss button shown. */
  onDismiss?:        () => void
  /** Escalation text/URL. Shown as a secondary CTA next to Retry. */
  escalation?:       { label: string; href?: string; onClick?: () => void }
  /** Structured error details — key-value pairs shown in a collapsible section. */
  details?:          Record<string, string | number | null | undefined>
  /** Additional className for the root element. */
  className?:        string
  /** Whether to start with details expanded. Default false. */
  defaultExpanded?:  boolean
}

// ── Config ────────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<ErrorSeverity, {
  icon:      React.ElementType
  border:    string
  bg:        string
  iconColor: string
  label:     string
  badgeVariant: 'destructive' | 'warning' | 'secondary' | 'outline'
}> = {
  critical: {
    icon:         XCircle,
    border:       'border-destructive/40',
    bg:           'bg-destructive/5',
    iconColor:    'text-destructive',
    label:        'Critical',
    badgeVariant: 'destructive',
  },
  high: {
    icon:         AlertTriangle,
    border:       'border-destructive/30',
    bg:           'bg-destructive/5',
    iconColor:    'text-destructive',
    label:        'High',
    badgeVariant: 'destructive',
  },
  medium: {
    icon:         AlertCircle,
    border:       'border-warning/40',
    bg:           'bg-warning/5',
    iconColor:    'text-warning',
    label:        'Medium',
    badgeVariant: 'warning',
  },
  low: {
    icon:         AlertCircle,
    border:       'border-border',
    bg:           'bg-muted/40',
    iconColor:    'text-muted-foreground',
    label:        'Low',
    badgeVariant: 'secondary',
  },
  info: {
    icon:         Info,
    border:       'border-border',
    bg:           'bg-muted/30',
    iconColor:    'text-muted-foreground',
    label:        'Info',
    badgeVariant: 'outline',
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OperationalErrorBanner({
  error,
  errorCode,
  severity = 'high',
  remediationText,
  onRetry,
  retrying = false,
  onDismiss,
  escalation,
  details,
  className,
  defaultExpanded = false,
}: OperationalErrorBannerProps) {
  const [detailsOpen, setDetailsOpen] = useState(defaultExpanded)

  if (!error) return null

  const cfg          = SEVERITY_CONFIG[severity]
  const Icon         = cfg.icon
  const hasDetails   = details && Object.keys(details).length > 0

  return (
    <div
      className={cn(
        'rounded-md border p-3.5 text-sm',
        cfg.border,
        cfg.bg,
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <Icon className={cn('h-4 w-4 flex-shrink-0 mt-0.5', cfg.iconColor)} />

        <div className="flex-1 min-w-0">
          {/* Title + badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground leading-tight">
              Operation failed
            </span>
            <Badge variant={cfg.badgeVariant} className="rounded-full text-[10px] px-1.5 py-0">
              {cfg.label}
            </Badge>
            {errorCode && (
              <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
                {errorCode}
              </span>
            )}
          </div>

          {/* Error message */}
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">{error}</p>

          {/* Remediation guidance */}
          {remediationText && (
            <p className="mt-1.5 text-xs text-foreground/80 leading-relaxed">
              <span className="font-medium">What to do:</span> {remediationText}
            </p>
          )}

          {/* Details toggle */}
          {hasDetails && (
            <button
              type="button"
              className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setDetailsOpen(o => !o)}
            >
              {detailsOpen
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />}
              {detailsOpen ? 'Hide' : 'Show'} technical details
            </button>
          )}

          {/* Structured details */}
          {hasDetails && detailsOpen && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] bg-background/60 rounded p-2 border border-border/50">
              {Object.entries(details!).map(([k, v]) => (
                <>
                  <dt key={`k-${k}`} className="text-muted-foreground font-medium">{k}</dt>
                  <dd key={`v-${k}`} className="font-mono text-foreground truncate" title={String(v ?? '—')}>
                    {v != null ? String(v) : '—'}
                  </dd>
                </>
              ))}
            </dl>
          )}

          {/* CTAs */}
          {(onRetry || escalation) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {onRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    'h-7 text-xs gap-1.5',
                    (severity === 'critical' || severity === 'high')
                      ? 'border-destructive/30 text-destructive hover:bg-destructive/5'
                      : '',
                  )}
                  onClick={onRetry}
                  disabled={retrying}
                >
                  {retrying
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <RefreshCw className="h-3 w-3" />}
                  {retrying ? 'Retrying…' : 'Retry'}
                </Button>
              )}
              {escalation && (
                escalation.href ? (
                  <a
                    href={escalation.href}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    {escalation.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                    onClick={escalation.onClick}
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    {escalation.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            type="button"
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors ml-1"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
