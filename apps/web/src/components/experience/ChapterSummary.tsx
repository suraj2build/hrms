/**
 * ChapterSummary — the compressed "routine" of a chapter (refinement principle 4:
 * compress repetition, expand meaning). The dozen near-identical payslips and the
 * single routine days off collapse into one quiet line — "8 payslips · 3 days off" —
 * that expands on demand. A timeline is not an archive; the archive hides here.
 */

import * as React from 'react'
import { ChevronDown, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActivityItem, type ActivityEvent } from './ActivityItem'

export function ChapterSummary({ label, items }: { label: string; items: ActivityEvent[] }) {
  const [open, setOpen] = React.useState(false)
  if (!items.length) return null
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 rounded-xl py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Receipt className="h-4 w-4" />
        </span>
        <span className="flex-1 text-xs">{label}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-4 border-l border-border/50 pl-4 motion-safe:animate-in motion-safe:fade-in-0">
          {items.map(e => <ActivityItem key={e.id} event={e} />)}
        </div>
      )}
    </div>
  )
}
