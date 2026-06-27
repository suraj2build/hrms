/**
 * ReflectionCard — the signature ambient-AI moment (Reflection pattern, §3.6).
 *
 * The ONE rich filled surface per experience: a navy→teal gradient panel carrying
 * a single memory-aware insight the person didn't think to ask for. Scarcity is
 * the signature — this is the only gradient panel a surface shows. Extracted from
 * Home's Movement 9 so Timeline (and later surfaces) inherit it rather than
 * re-implementing. Renders nothing when there is no genuine insight.
 */

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReflectionCardProps {
  insight: string | null | undefined
  action?: { label: string; href: string }
  onAction?: (href: string) => void
  className?: string
}

export function ReflectionCard({ insight, action, onAction, className }: ReflectionCardProps) {
  if (!insight) return null
  // Intentional FIXED brand gradient — identical in light & dark; it carries its own
  // white text, so it must stay a dark navy→teal (a brightening token would worsen
  // white-on-teal contrast). The one justified literal pair.
  return (
    <div className={cn('rounded-2xl bg-gradient-to-br from-[#1A4D8F] to-[#15B8A6] p-6 text-white shadow-sm', className)}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/90">
        <Sparkles className="h-3.5 w-3.5" /> Cognix Insight
      </p>
      <p className="mt-2 text-base font-medium leading-relaxed">{insight}</p>
      {action && (
        <button
          onClick={() => onAction?.(action.href)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-white/25"
        >
          {action.label} →
        </button>
      )}
    </div>
  )
}
