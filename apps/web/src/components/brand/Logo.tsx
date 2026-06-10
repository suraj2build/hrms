/**
 * CognixHR brand logo.
 *
 *   <Logo />                  → mark + "CognixHR" wordmark (default)
 *   <Logo variant="mark" />   → just the gradient mark
 *   <Logo size={40} />        → custom mark size (px)
 *
 * Brand: "Smarter Workforce. Stronger Future." — a Saar HRMS application.
 * Gradient: royal blue #2E6FE6 → teal #15B8A6.
 * The mark is an open "C" ring cradling an H / person figure =
 * Cognix (cognition) + HR (people).
 */
import { cn } from '@/lib/utils'

interface LogoProps {
  variant?: 'full' | 'mark'
  size?:    number
  className?: string
  /** Wordmark colour for the "Cognix" half — defaults to currentColor (adapts to dark/light). */
  wordClassName?: string
}

/** Brand colours, exported for use in non-SVG brand contexts. */
export const BRAND_BLUE = '#2E6FE6'
export const BRAND_TEAL = '#15B8A6'

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Ring: royal blue (lower-left) → teal (upper-right tail) */}
        <linearGradient id="cognix-ring" x1="9" y1="40" x2="39" y2="9" gradientUnits="userSpaceOnUse">
          <stop offset="0"    stopColor={BRAND_BLUE} />
          <stop offset="0.62" stopColor="#2C8FCB" />
          <stop offset="1"    stopColor={BRAND_TEAL} />
        </linearGradient>
        {/* Inner figure: teal-dominant with a blue base */}
        <linearGradient id="cognix-fig" x1="18" y1="36" x2="32" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0"   stopColor="#1E73C4" />
          <stop offset="1"   stopColor={BRAND_TEAL} />
        </linearGradient>
      </defs>
      {/* Open "C" ring — cognition / a circle of people, open to the right */}
      <path
        d="M33.4 11.2 A16 16 0 1 0 33.4 36.8"
        fill="none"
        stroke="url(#cognix-ring)"
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      {/* Inner H + person: left pillar (with head dot), crossbar, taller right pillar */}
      <circle cx="20.4" cy="16.2" r="3" fill="url(#cognix-fig)" />
      <rect x="18.1" y="20.4" width="4.6" height="13.8" rx="2.3" fill="url(#cognix-fig)" />
      <rect x="26.9" y="15.8" width="4.6" height="18.4" rx="2.3" fill="url(#cognix-fig)" />
      <rect x="18.1" y="24.4" width="13.4" height="4.2" rx="2.1" fill="url(#cognix-fig)" />
    </svg>
  )
}

export function Logo({ variant = 'full', size = 32, className, wordClassName }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      {variant === 'full' && (
        <span className="font-display font-bold tracking-tight leading-none"
              style={{ fontSize: size * 0.56 }}>
          <span className={cn(wordClassName)}>Cognix</span>
          <span style={{ color: BRAND_TEAL }}>HR</span>
        </span>
      )}
    </div>
  )
}

export default Logo
