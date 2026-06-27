/**
 * PillarHero — the cinematic sky header for every Experience Cloud pillar.
 *
 * Bleeds edge-to-edge over the EssShell's p-4/6/8 padding via negative margins,
 * then re-pads internally so content aligns with the rest of the page.
 * Apply to the very top of any pillar page that lives inside EssShell.
 */

interface PillarHeroProps {
  /** Single-line emotion / tagline — shown above the pillar name. */
  eyebrow: string
  /** The pillar name — rendered in serif-hero. */
  title: string
  /** One of the sky-* CSS classes from index.css */
  sky: string
  /** Optional ambient line beneath the title. */
  tagline?: string
}

export function PillarHero({ eyebrow, title, sky, tagline }: PillarHeroProps) {
  return (
    <div
      className={`sky-grain -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 relative flex min-h-[240px] flex-col justify-end overflow-hidden px-6 pb-8 pt-6 sm:px-10 lg:px-12 ${sky}`}
    >
      <div aria-hidden className="drift-slow pointer-events-none absolute -right-12 -top-16 h-[280px] w-[280px] rounded-full bg-white/8 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 h-[220px] w-[220px] rounded-full bg-black/20 blur-3xl" />
      <div className="relative z-10">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">{eyebrow}</p>
        <h1 className="serif-hero text-[clamp(2rem,4.5vw,3rem)] leading-none text-white">{title}</h1>
        {tagline && (
          <p className="mt-3 text-[15px] text-white/70">{tagline}</p>
        )}
      </div>
    </div>
  )
}
