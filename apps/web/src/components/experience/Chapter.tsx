/**
 * Chapter — one era of the journey (Story pattern, §3.3): a narrative title
 * ("Joining", "Settling in", "This year", "2025") with a quiet date-range subtitle,
 * above a calm vertical stack of memories. Replaces a bare time-group so Timeline
 * reads like a biography, not an audit trail.
 *
 * Motion supports memory, not spectacle: a subtle fade/rise on entrance so the
 * employee feels they're moving through time. Suppressed under reduced-motion.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export function Chapter({
  title, subtitle, children, index = 0, className,
}: { title: string; subtitle?: string; children: React.ReactNode; index?: number; className?: string }) {
  return (
    <section
      className={cn('motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500', className)}
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms`, animationFillMode: 'backwards' }}
    >
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
        <span className="h-px flex-1 self-center bg-border/50" />
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}
