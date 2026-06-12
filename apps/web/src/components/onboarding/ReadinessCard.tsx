/**
 * ReadinessCard.tsx — Phase O3: Onboarding Readiness Card.
 *
 * Reusable component. Accepts sessionId or employeeId.
 * Displays the deterministic readiness score from the O3 engine.
 * Trust signal is shown separately and explicitly never merged into the score.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  FileText,
  BadgeCheck,
  ClipboardList,
  UserCheck,
  DoorOpen,
} from 'lucide-react'

// ── Types (mirrors ReadinessResult from readiness-engine.ts) ──────────────────

type ReadinessStatus = 'ready' | 'at_risk' | 'blocked'
type DimensionLabel  = 'complete' | 'partial' | 'pending' | 'blocked' | 'na'

interface ReadinessLineItem {
  text:   string
  status: 'complete' | 'pending' | 'blocked'
}

interface DimensionScore {
  score: number
  label: DimensionLabel
  items: ReadinessLineItem[]
}

interface ReadinessDimensions {
  documents:    DimensionScore
  verification: DimensionScore
  tasks:        DimensionScore
  approvals:    DimensionScore
  joining:      DimensionScore
}

interface TrustSignal {
  score:    number
  severity: string
}

interface ReadinessResult {
  session_id:      string | null
  employee_id:     string | null
  overall_score:   number
  status:          ReadinessStatus
  dimensions:      ReadinessDimensions
  blocking_items:  string[]
  completed_items: string[]
  last_updated:    string
  trust_signal:    TrustSignal | null
}

// ── Visual config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ReadinessStatus, {
  label:       string
  badgeVariant: 'success' | 'warning' | 'destructive'
  ringColor:   string
  textColor:   string
  bgColor:     string
}> = {
  ready:   { label: 'Ready',    badgeVariant: 'success',     ringColor: 'stroke-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-950/30' },
  at_risk: { label: 'At Risk',  badgeVariant: 'warning',     ringColor: 'stroke-amber-500',   textColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-950/30'     },
  blocked: { label: 'Blocked',  badgeVariant: 'destructive', ringColor: 'stroke-red-500',     textColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-950/30'         },
}

const DIMENSION_META: Record<keyof ReadinessDimensions, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  documents:    { label: 'Documents',    Icon: FileText     },
  verification: { label: 'Verification', Icon: BadgeCheck   },
  tasks:        { label: 'Tasks',        Icon: ClipboardList },
  approvals:    { label: 'Approvals',    Icon: UserCheck    },
  joining:      { label: 'Joining',      Icon: DoorOpen     },
}

const TRUST_SEVERITY_COLOR: Record<string, string> = {
  low:      'text-emerald-600 dark:text-emerald-400',
  medium:   'text-amber-600 dark:text-amber-400',
  high:     'text-red-600 dark:text-red-400',
  critical: 'text-red-700 dark:text-red-300',
}

// ── Score ring SVG ────────────────────────────────────────────────────────────

function ScoreRing({ score, status }: { score: number; status: ReadinessStatus }) {
  const cfg        = STATUS_CONFIG[status]
  const radius     = 28
  const circ       = 2 * Math.PI * radius
  const dashOffset = circ * (1 - score / 100)

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle cx="36" cy="36" r={radius} strokeWidth="6" className="stroke-border fill-none" />
        <circle
          cx="36" cy="36" r={radius}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          className={cn('transition-all duration-500', cfg.ringColor)}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-lg font-bold leading-none', cfg.textColor)}>{score}</span>
        <span className="text-[9px] text-muted-foreground font-medium">/100</span>
      </div>
    </div>
  )
}

// ── Dimension row ─────────────────────────────────────────────────────────────

function DimensionRow({ dimKey, dim }: { dimKey: keyof ReadinessDimensions; dim: DimensionScore }) {
  const [open, setOpen] = useState(false)
  const meta  = DIMENSION_META[dimKey]
  const Icon  = meta.Icon
  const isNA  = dim.label === 'na'

  const barColor =
    dim.label === 'complete' ? 'bg-emerald-500'
    : dim.label === 'partial' ? 'bg-[#2E6FE6]'
    : dim.label === 'blocked' ? 'bg-red-500'
    : 'bg-border'

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-foreground flex-1 font-medium">{meta.label}</span>
        {isNA
          ? <span className="text-[11px] text-muted-foreground">N/A</span>
          : <span className="text-[11px] text-muted-foreground tabular-nums">{dim.score}%</span>
        }
        {dim.items.length > 0 && (
          <button
            onClick={() => setOpen(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-border overflow-hidden ml-5">
        {!isNA && (
          <div
            className={cn('h-full rounded-full transition-all duration-500', barColor)}
            style={{ width: `${dim.score}%` }}
          />
        )}
      </div>

      {/* Expandable items */}
      {open && dim.items.length > 0 && (
        <div className="ml-5 mt-1.5 space-y-1">
          {dim.items.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px]">
              {item.status === 'complete'
                ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
                : item.status === 'blocked'
                ? <XCircle className="h-3 w-3 shrink-0 text-red-500 mt-0.5" />
                : <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
              }
              <span className={cn(
                item.status === 'complete' ? 'text-foreground'
                : item.status === 'blocked' ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground',
              )}>{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ReadinessCardProps {
  sessionId?:    string
  employeeId?:   string
  /** Compact variant: hides completed items + dimension drill-down toggle */
  compact?:      boolean
  className?:    string
}

export function ReadinessCard({
  sessionId,
  employeeId,
  compact  = false,
  className,
}: ReadinessCardProps) {
  const [completedOpen, setCompletedOpen] = useState(false)
  const enabled = Boolean(sessionId || employeeId)

  const queryUrl = sessionId
    ? `/onboarding/sessions/${sessionId}/readiness`
    : `/employees/${employeeId}/readiness`

  const { data, isLoading, isError, error } = useQuery({
    queryKey:  ['readiness', sessionId ?? employeeId, sessionId ? 'session' : 'employee'],
    queryFn:   () => api.get<{ data: ReadinessResult }>(queryUrl).then(r => r.data),
    enabled,
    staleTime: 60_000,
  })

  if (!enabled) return null

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" /> Computing readiness…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className={cn('rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive', className)}>
        Failed to load readiness: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  const cfg = STATUS_CONFIG[data.status]

  return (
    <div className={cn('rounded-lg border border-border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div className={cn('flex items-center justify-between gap-4 px-4 py-3', cfg.bgColor)}>
        <div className="flex items-center gap-3">
          <ScoreRing score={data.overall_score} status={data.status} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Onboarding Readiness</span>
              <Badge variant={cfg.badgeVariant}>{cfg.label}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Deterministic · 5 dimensions · updated {new Date(data.last_updated).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* Blocking items */}
        {data.blocking_items.length > 0 && (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
              Blocking ({data.blocking_items.length})
            </p>
            {data.blocking_items.map((item, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-destructive/90">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}

        {/* Dimensions */}
        {!compact && (
          <div className="space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Dimensions</p>
            {(Object.entries(data.dimensions) as [keyof ReadinessDimensions, DimensionScore][]).map(
              ([key, dim]) => <DimensionRow key={key} dimKey={key} dim={dim} />,
            )}
          </div>
        )}

        {/* Completed items — collapsible */}
        {data.completed_items.length > 0 && (
          <div>
            <button
              onClick={() => setCompletedOpen(v => !v)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {completedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              {data.completed_items.length} completed item{data.completed_items.length !== 1 ? 's' : ''}
            </button>

            {completedOpen && (
              <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1.5">
                {data.completed_items.map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Trust signal — always displayed separately, never merged into readiness */}
        {data.trust_signal && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <ShieldAlert className={cn('h-3.5 w-3.5', TRUST_SEVERITY_COLOR[data.trust_signal.severity] ?? 'text-muted-foreground')} />
              <span className="text-[11px] text-muted-foreground">
                Trust score:{' '}
                <span className={cn('font-semibold', TRUST_SEVERITY_COLOR[data.trust_signal.severity] ?? 'text-foreground')}>
                  {data.trust_signal.score}
                </span>
                {' · '}
                <span className="capitalize">{data.trust_signal.severity} risk</span>
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/60 italic">Independent of readiness score</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReadinessCard
