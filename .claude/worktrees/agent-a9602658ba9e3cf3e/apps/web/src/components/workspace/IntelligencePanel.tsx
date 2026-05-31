/**
 * IntelligencePanel
 *
 * Right-side contextual intelligence panel for workspace shells.
 * Renders a scrollable list of grouped insight cards.
 *
 * Used as the `rightPanel` prop in WorkspaceShell.
 */

import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { AlertTriangle, Info, CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'success'

export interface InsightItem {
  id:          string
  title:       string
  description?: string
  severity:    InsightSeverity
  /** Employee or entity count */
  count?:      number
  /** CTA label for drill-down */
  action?:     string
  onAction?:   () => void
}

export interface InsightGroup {
  id:      string
  label:   string
  icon?:   LucideIcon
  items:   InsightItem[]
}

export interface IntelligencePanelProps {
  title?:      string
  groups:      InsightGroup[]
  loading?:    boolean
  className?:  string
  /** Shown when all groups are empty */
  emptyState?: ReactNode
}

// ── Severity icon + color ──────────────────────────────────────────────────────

const SEVERITY_ICON: Record<InsightSeverity, LucideIcon> = {
  critical: XCircle,
  warning:  AlertTriangle,
  info:     Info,
  success:  CheckCircle2,
}

const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  critical: 'text-destructive',
  warning:  'text-warning',
  info:     'text-info',
  success:  'text-success',
}

const SEVERITY_BG: Record<InsightSeverity, string> = {
  critical: 'bg-destructive/8',
  warning:  'bg-warning/8',
  info:     'bg-info/8',
  success:  'bg-success/8',
}

// ── Insight Card ──────────────────────────────────────────────────────────────

function InsightCard({ item }: { item: InsightItem }) {
  const Icon  = SEVERITY_ICON[item.severity]
  const color = SEVERITY_COLOR[item.severity]
  const bg    = SEVERITY_BG[item.severity]

  return (
    <div className={cn('rounded-md p-2.5 space-y-1', bg)}>
      <div className="flex items-start gap-2">
        <Icon className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[11.5px] font-semibold text-foreground leading-tight">{item.title}</p>
            {item.count !== undefined && (
              <span className={cn('text-[10px] font-bold tabular-nums rounded-full px-1.5 py-0', color, bg)}>
                {item.count}
              </span>
            )}
          </div>
          {item.description && (
            <p className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">{item.description}</p>
          )}
        </div>
      </div>
      {item.action && item.onAction && (
        <button
          type="button"
          onClick={item.onAction}
          className={cn(
            'flex items-center gap-1 text-[10.5px] font-medium ml-5.5 transition-opacity hover:opacity-70',
            color,
          )}
        >
          {item.action}
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Intelligence Panel ────────────────────────────────────────────────────────

export function IntelligencePanel({
  title = 'Intelligence',
  groups,
  loading = false,
  className,
  emptyState,
}: IntelligencePanelProps) {
  const hasContent = groups.some(g => g.items.length > 0)

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-border/50 flex-shrink-0">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : !hasContent ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            {emptyState ?? (
              <>
                <CheckCircle2 className="h-8 w-8 text-success/40 mb-2" />
                <p className="text-xs text-muted-foreground">No active issues</p>
              </>
            )}
          </div>
        ) : (
          groups.map(group => {
            if (group.items.length === 0) return null
            const GroupIcon = group.icon
            return (
              <div key={group.id}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  {GroupIcon && <GroupIcon className="h-3 w-3 text-muted-foreground/60" />}
                  <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    {group.label}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {group.items.map(item => (
                    <InsightCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
