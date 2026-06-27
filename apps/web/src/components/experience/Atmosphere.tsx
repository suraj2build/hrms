/**
 * Atmosphere — the signature header field of Visual Language v2 ("Atmospheres").
 *
 * Every Experience Cloud surface opens in a full-width ambient field (not a card):
 * a soft aurora unique to its emotional center, cradling an eyebrow, the serif HERO
 * line (the emotional beat, in Fraunces), an optional subtitle, and any header
 * content (a punch state, an ask field, quick actions). One DNA, seven souls — the
 * `theme` is the only thing that changes the light; the structure is constant.
 *
 * Dark-safe: a `bg-card` base with low-opacity gradient tints on top (the page/card
 * shows through), foreground text on tokens (AA). The hero is a heading (the page's
 * <h1>) so each surface keeps its screen-reader anchor.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export type AtmosphereTheme =
  | 'dawn' | 'memory' | 'ascent' | 'clarity' | 'warmth' | 'belonging' | 'intelligence'

// Each atmosphere = a tint of light over the navy+teal base. Low-opacity, decorative,
// dark-safe. Eyebrow accents are dark enough for AA on the field.
const ATMO: Record<AtmosphereTheme, { field: string; eyebrow: string }> = {
  dawn: {
    field: 'radial-gradient(130% 120% at 12% -25%, rgba(245,166,35,0.13), transparent 52%), linear-gradient(135deg, rgba(26,77,143,0.05), rgba(21,184,166,0.09))',
    eyebrow: 'text-[#9A6A12]',
  },
  memory: {
    field: 'radial-gradient(130% 130% at 88% -25%, rgba(26,77,143,0.16), transparent 55%), linear-gradient(135deg, rgba(40,40,120,0.05), rgba(26,77,143,0.07))',
    eyebrow: 'text-primary',
  },
  ascent: {
    field: 'radial-gradient(120% 130% at 50% 130%, rgba(21,184,166,0.16), transparent 55%), linear-gradient(135deg, rgba(26,77,143,0.05), rgba(21,184,166,0.10))',
    eyebrow: 'text-brand-teal-ink',
  },
  clarity: {
    field: 'radial-gradient(120% 120% at 50% -30%, rgba(26,77,143,0.07), transparent 55%)',
    eyebrow: 'text-muted-foreground',
  },
  warmth: {
    field: 'radial-gradient(130% 120% at 20% -25%, rgba(214,150,60,0.14), transparent 52%), linear-gradient(135deg, rgba(26,77,143,0.04), rgba(21,184,166,0.07))',
    eyebrow: 'text-[#9A6A12]',
  },
  belonging: {
    field: 'radial-gradient(150% 140% at 80% -30%, rgba(21,184,166,0.14), transparent 55%), linear-gradient(120deg, rgba(26,77,143,0.05), rgba(21,184,166,0.08))',
    eyebrow: 'text-brand-teal-ink',
  },
  intelligence: {
    field: 'radial-gradient(110% 130% at 90% -10%, rgba(21,184,166,0.18), transparent 45%), linear-gradient(135deg, rgba(26,77,143,0.08), rgba(26,77,143,0.03))',
    eyebrow: 'text-primary',
  },
}

export interface AtmosphereProps {
  theme: AtmosphereTheme
  eyebrow?: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Trailing header element (e.g. a punch chip) aligned to the top-right. */
  aside?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function Atmosphere({ theme, eyebrow, title, subtitle, aside, children, className }: AtmosphereProps) {
  const a = ATMO[theme]
  return (
    <header
      className={cn('relative overflow-hidden rounded-[1.75rem] bg-card px-7 py-9 shadow-depth sm:px-10 sm:py-11', className)}
      style={{ backgroundImage: a.field }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.16em]', a.eyebrow)}>{eyebrow}</p>
          )}
          <h1 className="mt-3 font-serif text-[2rem] font-medium leading-[1.06] tracking-[-0.01em] text-foreground sm:text-[2.4rem]">
            {title}
          </h1>
          {subtitle && <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </header>
  )
}
