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
      className={`sky-grain -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 relative flex min-h-[44vh] flex-col justify-end overflow-hidden px-6 pb-10 sm:px-10 lg:px-14 ${sky}`}
    >
      <div aria-hidden className="drift-slow pointer-events-none absolute -right-20 -top-28 h-[440px] w-[440px] rounded-full bg-white/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-[360px] w-[360px] rounded-full bg-black/20 blur-3xl" />
      <div className="relative z-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-on-sky-soft">{eyebrow}</p>
        <h1 className="serif-hero mt-3 text-[clamp(2.4rem,5vw,4.5rem)] leading-none text-on-sky">{title}</h1>
        {tagline && (
          <p className="mt-4 max-w-[46ch] text-[17px] leading-relaxed text-on-sky-soft">{tagline}</p>
        )}
      </div>
    </div>
  )
}
