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
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cognix-grad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0"    stopColor={BRAND_BLUE} />
          <stop offset="0.55" stopColor="#2392C8" />
          <stop offset="1"    stopColor={BRAND_TEAL} />
        </linearGradient>
      </defs>
      {/* Open "C" ring — cognition / circle of people */}
      <path
        d="M24 7.6 A11 11 0 1 0 24 24.4"
        fill="none"
        stroke="url(#cognix-grad)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {/* H / person — two legs, a crossbar, and a head dot */}
      <rect x="12.4" y="11.6" width="2.8" height="10.8" rx="1.4" fill="url(#cognix-grad)" />
      <rect x="18.0" y="11.6" width="2.8" height="10.8" rx="1.4" fill="url(#cognix-grad)" />
      <rect x="12.4" y="15.6" width="8.4" height="2.6"  rx="1.3" fill="url(#cognix-grad)" />
      <circle cx="16.6" cy="9.4" r="2.25" fill="url(#cognix-grad)" />
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
