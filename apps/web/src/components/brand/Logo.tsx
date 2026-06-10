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
        {/* Ring: deep navy-indigo → royal blue → electric blue */}
        <linearGradient id="cognix-ring" x1="12" y1="38" x2="37" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#112494" />
          <stop offset="42%"  stopColor={BRAND_BLUE} />
          <stop offset="100%" stopColor="#60A5FA" />
        </linearGradient>
        {/* Inner H+person: dark teal → bright cyan */}
        <linearGradient id="cognix-fig" x1="24" y1="37" x2="24" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#0B6B5A" />
          <stop offset="55%"  stopColor="#0EA5A0" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      {/* Open "C" ring — center (24,24) r=16.8, gap ≈ 90° on the right */}
      <path
        d="M 35.9 12.1 A 16.8 16.8 0 1 0 35.9 35.9"
        fill="none"
        stroke="url(#cognix-ring)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Head dot */}
      <circle cx="20.6" cy="16.3" r="2.2" fill="url(#cognix-fig)" />
      {/* Left pillar (body of person + left H upright) */}
      <rect x="18.8" y="19.4" width="3.6" height="16.3" rx="1.8" fill="url(#cognix-fig)" />
      {/* Right pillar (right H upright, taller) */}
      <rect x="25.0" y="15.6" width="3.6" height="20.2" rx="1.8" fill="url(#cognix-fig)" />
      {/* H crossbar */}
      <rect x="18.8" y="27.1" width="9.8" height="3.1" rx="1.5" fill="url(#cognix-fig)" />
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
