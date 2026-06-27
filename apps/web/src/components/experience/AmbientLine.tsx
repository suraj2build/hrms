/**
 * AmbientLine — one quiet, intelligent sentence on an Experience Cloud block.
 *
 * Ambient intelligence (Manifesto §IV.4 / UX Blueprint §8): AI as *language*, not
 * a chat window or a button. Each major Home block carries one of these — a
 * sentence that explains, recommends or reassures, derived from the employee's
 * own data. Deliberately understated: a spark mark + calm text, never shouting.
 */

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AmbientLineProps {
  children: React.ReactNode
  className?: string
}

export function AmbientLine({ children, className }: AmbientLineProps) {
  if (!children) return null
  return (
    <p className={cn('flex items-start gap-2 text-sm leading-relaxed text-muted-foreground', className)}>
      <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-teal" />
      <span>{children}</span>
    </p>
  )
}
