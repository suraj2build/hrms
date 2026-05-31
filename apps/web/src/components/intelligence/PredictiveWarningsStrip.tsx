/**
 * PredictiveWarningsStrip.tsx — Scrollable strip of predictive warning chips with expandable detail (Phase UX-5)
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PredictiveWarning } from '@/lib/intelligence/types'

export interface PredictiveWarningsStripProps {
  warnings:   PredictiveWarning[]
  isLoading?: boolean
}

export function PredictiveWarningsStrip({ warnings, isLoading = false }: PredictiveWarningsStripProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // All-clear state
  if (warnings.length === 0 && !isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-3 py-1 text-xs font-medium w-fit">
        <CheckCircle2 className="h-3 w-3" />
        No predictive warnings
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="h-6 rounded-full bg-muted animate-pulse flex-shrink-0"
            style={{ width: `${80 + i * 20}px` }}
          />
        ))}
      </div>
    )
  }

  const expandedWarning = expanded ? warnings.find(w => w.id === expanded) : null

  return (
    <div className="space-y-2">
      {/* Label */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Predictive Warnings
      </p>

      {/* Horizontally scrollable chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {warnings.map(w => (
          <button
            key={w.id}
            onClick={() => setExpanded(expanded === w.id ? null : w.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border whitespace-nowrap flex-shrink-0 transition-colors',
              w.severity === 'critical'
                ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
                : w.severity === 'high'
                ? 'bg-orange-500/10 text-orange-600 border-orange-500/30 hover:bg-orange-500/20'
                : 'bg-amber-500/10 text-amber-600 border-amber-500/30 hover:bg-amber-500/20',
              expanded === w.id && 'ring-1 ring-offset-1 ring-current',
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {w.title}
            <span className="font-normal opacity-70">· {w.probability}%</span>
          </button>
        ))}
      </div>

      {/* Expanded detail panel */}
      {expandedWarning && (
        <div className="mt-2 rounded-lg border border-border bg-card p-3 animate-in fade-in-0 slide-in-from-top-2 duration-150">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">{expandedWarning.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{expandedWarning.description}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs font-bold text-foreground">{expandedWarning.probability}%</p>
              <p className="text-[10px] text-muted-foreground">probability</p>
            </div>
          </div>

          <div className="mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Based on
            </p>
            <ul className="space-y-0.5">
              {expandedWarning.basis.map((b, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-muted-foreground/50 mt-0.5">·</span> {b}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[10px] text-muted-foreground mt-2">
            Expected:{' '}
            <span className="font-medium text-foreground">{expandedWarning.timeHorizon}</span>
          </p>
        </div>
      )}
    </div>
  )
}
