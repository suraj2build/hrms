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

// Each atmosphere = a cinematic field of LIGHT over the navy+teal base — a layered
// "sky": a radial light-source (the sun/aurora) + an atmospheric wash + a soft vertical
// scrim. Luminous in light mode, a deep night of the same hue in dark. Headline stays on
// a controlled-luminance zone (AA). Asset-free now; the same slot accepts hero photography
// later (EXPERIENCE_MOODBOARD_ALIGNMENT.md §2).
const ATMO: Record<AtmosphereTheme, { field: string; eyebrow: string }> = {
  // Dawn — a warm sunrise: a gold sun glow upper-right, a peach wash, cool sky settling.
  dawn: {
    field: 'radial-gradient(70% 80% at 82% 6%, rgba(245,184,96,0.30), transparent 60%), radial-gradient(60% 70% at 8% 40%, rgba(240,150,90,0.14), transparent 58%), linear-gradient(178deg, rgba(255,238,214,0.55), rgba(214,232,247,0.28) 62%, transparent)',
    eyebrow: 'text-[#9A6A12]',
  },
  // Memory — twilight: an indigo dusk with a magenta horizon glow.
  memory: {
    field: 'radial-gradient(72% 78% at 84% 4%, rgba(124,92,205,0.26), transparent 58%), radial-gradient(64% 60% at 16% 96%, rgba(200,96,156,0.16), transparent 56%), linear-gradient(178deg, rgba(234,228,250,0.5), transparent 70%)',
    eyebrow: 'text-primary',
  },
  // Ascent — a teal summit dawn rising from below, brightening upward.
  ascent: {
    field: 'radial-gradient(80% 80% at 50% 120%, rgba(21,184,166,0.30), transparent 60%), radial-gradient(60% 60% at 85% 4%, rgba(46,111,230,0.16), transparent 58%), linear-gradient(178deg, rgba(220,243,239,0.5), transparent 70%)',
    eyebrow: 'text-brand-teal-ink',
  },
  // Clarity — a serene cool calm; the lightest, most spacious field.
  clarity: {
    field: 'radial-gradient(90% 70% at 50% -8%, rgba(46,111,230,0.14), transparent 62%), linear-gradient(178deg, rgba(228,238,250,0.55), transparent 72%)',
    eyebrow: 'text-muted-foreground',
  },
  // Warmth — golden hour: amber light from the side, intimate.
  warmth: {
    field: 'radial-gradient(74% 80% at 22% 6%, rgba(245,182,96,0.28), transparent 60%), radial-gradient(60% 64% at 88% 84%, rgba(216,124,92,0.12), transparent 58%), linear-gradient(178deg, rgba(253,241,226,0.5), transparent 70%)',
    eyebrow: 'text-[#9A6A12]',
  },
  // Belonging — open water: a wide teal-and-blue expanse, bright and panoramic.
  belonging: {
    field: 'radial-gradient(84% 78% at 72% -4%, rgba(21,184,166,0.24), transparent 60%), radial-gradient(72% 64% at 14% 96%, rgba(46,111,230,0.14), transparent 58%), linear-gradient(178deg, rgba(224,243,242,0.5), transparent 70%)',
    eyebrow: 'text-brand-teal-ink',
  },
  // Intelligence — aurora: deep violet meeting a teal spark.
  intelligence: {
    field: 'radial-gradient(70% 80% at 84% 0%, rgba(124,58,237,0.26), transparent 56%), radial-gradient(64% 66% at 26% 96%, rgba(21,184,166,0.22), transparent 56%), linear-gradient(135deg, rgba(236,231,251,0.46), transparent 72%)',
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
      className={cn('relative overflow-hidden rounded-[1.9rem] bg-card px-7 py-11 shadow-depth-lg sm:px-12 sm:py-14', className)}
      style={{ backgroundImage: a.field }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.18em]', a.eyebrow)}>{eyebrow}</p>
          )}
          <h1 className="mt-3.5 font-serif text-[2.4rem] font-medium leading-[1.04] tracking-[-0.015em] text-foreground sm:text-[3rem]">
            {title}
          </h1>
          {subtitle && <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground sm:text-base">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children && <div className="mt-7">{children}</div>}
    </header>
  )
}
