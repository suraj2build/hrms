/**
 * CelebrationCard — the reusable Celebration block primitive.
 *
 * Surface primitive (EXPERIENCE_CLOUD_UX_BLUEPRINT.md §12 emotional design /
 * Manifesto §IV.8). Renders a celebration moment from EXISTING data — peer
 * birthday, work anniversary, recognition, service milestone, salary released.
 *
 * Animation is subtle and premium: a one-time fade/rise on mount and a soft
 * sheen — never confetti-childish — and fully suppressed under
 * prefers-reduced-motion (a CSS media query the inline transition respects via
 * the `motion-reduce` utilities).
 */

import * as React from 'react'
import { Cake, PartyPopper, Award, Medal, Wallet, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type CelebrationKind = 'birthday' | 'anniversary' | 'recognition' | 'milestone' | 'salary'

const ICON: Record<CelebrationKind, React.ComponentType<{ className?: string }>> = {
  birthday:    Cake,
  anniversary: PartyPopper,
  recognition: Award,
  milestone:   Medal,
  salary:      Wallet,
}

export interface CelebrationCardProps {
  kind:      CelebrationKind
  title:     string
  subtitle?: string
  /** Optional action (e.g. "Wish" / "Say thanks"). */
  action?:   { label: string; onClick: () => void }
  className?: string
}

export function CelebrationCard({ kind, title, subtitle, action, className }: CelebrationCardProps) {
  const Icon = ICON[kind] ?? Sparkles
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => { const t = setTimeout(() => setShown(true), 20); return () => clearTimeout(t) }, [])

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-brand-teal/25 bg-gradient-to-br from-brand-teal/8 to-primary/5 p-3.5',
        // Subtle one-time rise/fade on mount; disabled for reduced motion.
        'transition-all duration-500 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        className,
      )}
    >
      {/* Soft sheen — decorative, very low contrast, no motion dependency. */}
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-brand-teal/10 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action && (
          <Button size="sm" variant="outline" className="shrink-0 border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  )
}
