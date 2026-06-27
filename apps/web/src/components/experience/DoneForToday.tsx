/**
 * DoneForToday / origin Closure — the Closure pattern (§3.7): a calm centred line
 * with a small ✓ that lets the person *finish*. Never a dead-end. On Timeline this
 * marks the origin ("this is where it began") — the emotional floor of the journey.
 */

import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DoneForToday({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center justify-center gap-2 pb-2 pt-1 text-center text-sm text-muted-foreground', className)}>
      <CheckCircle2 className="h-4 w-4 text-success" />
      {children}
    </p>
  )
}
