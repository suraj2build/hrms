/**
 * TimeGroup — one chapter of the Story pattern (§3.3): a human time-group header
 * ("Today", "This week", "March", "2024") above a calm vertical stack of events.
 * The header is language, never a date range. Used by Timeline and any surface
 * where chronology carries meaning.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export function TimeGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
        <span className="h-px flex-1 bg-border/60" />
      </div>
      <div className={cn('space-y-4')}>{children}</div>
    </section>
  )
}
