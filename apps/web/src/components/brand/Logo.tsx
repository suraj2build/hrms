/**
 * CognixHR brand logo.
 *
 *   <Logo />                  → mark + "CognixHR" wordmark (default)
 *   <Logo variant="mark" />   → just the brand mark
 *   <Logo variant="lockup" /> → full brand lockup image (mark + wordmark + tagline)
 *   <Logo size={40} />        → custom mark size (px)
 *
 * Brand: "Smarter Workforce. Stronger Future." — a Saar HRMS application.
 * The mark/lockup render the canonical brand raster (apps/web/public/brand/*),
 * so they match the official artwork pixel-for-pixel everywhere.
 */
import { cn } from '@/lib/utils'

interface LogoProps {
  variant?: 'full' | 'mark' | 'lockup'
  size?:    number
  className?: string
  /** Wordmark colour for the "Cognix" half — defaults to currentColor (adapts to dark/light). */
  wordClassName?: string
}

/** Brand colours, exported for use in non-SVG brand contexts. */
export const BRAND_BLUE = '#2E6FE6'
export const BRAND_TEAL = '#15B8A6'

/** Public paths to the canonical brand assets. */
export const BRAND_ICON_SRC   = '/brand/cognixhr-icon.png'
export const BRAND_LOCKUP_SRC  = '/brand/cognixhr-lockup.png'

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src={BRAND_ICON_SRC}
      width={size}
      height={size}
      className={className}
      alt="CognixHR"
      draggable={false}
      style={{ display: 'block' }}
    />
  )
}

export function Logo({ variant = 'full', size = 32, className, wordClassName }: LogoProps) {
  if (variant === 'lockup') {
    return (
      <img
        src={BRAND_LOCKUP_SRC}
        className={className}
        alt="CognixHR — Smarter Workforce. Stronger Future."
        draggable={false}
        style={{ height: size, width: 'auto', display: 'block' }}
      />
    )
  }
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
