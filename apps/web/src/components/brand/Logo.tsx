/**
 * CognixHR brand logo.
 *
 *   <Logo />                       → mark + wordmark image (default)
 *   <Logo variant="mark" />        → just the brand mark
 *   <Logo variant="lockup" />      → full brand lockup image (mark + wordmark + tagline)
 *   <LogoMark tile />              → mark on a white tile (for dark backgrounds)
 *   <Wordmark tone="light" />      → white wordmark (for dark backgrounds)
 *
 * Brand: "Smarter Workforce. Stronger Future." — a Saar HRMS application.
 * The mark / wordmark / lockup all render the canonical brand raster
 * (apps/web/public/brand/*), so they match the official artwork pixel-for-pixel.
 */
import { cn } from '@/lib/utils'

interface LogoProps {
  variant?: 'full' | 'mark' | 'lockup'
  size?:    number
  className?: string
  /** When true, render the white wordmark (for dark surfaces). Ignored for mark/lockup. */
  dark?: boolean
}

/** Brand colours, exported for use in non-image brand contexts. */
export const BRAND_BLUE = '#2E6FE6'
export const BRAND_TEAL = '#15B8A6'

/** Public paths to the canonical brand assets. */
export const BRAND_ICON_SRC           = '/brand/cognixhr-icon.png'
export const BRAND_LOCKUP_SRC          = '/brand/cognixhr-lockup.png'
export const BRAND_WORDMARK_SRC        = '/brand/cognixhr-wordmark.png'
export const BRAND_WORDMARK_LIGHT_SRC  = '/brand/cognixhr-wordmark-light.png'

/**
 * The brand mark (icon). Pass `tile` to back it with a white rounded tile so the
 * navy "C" stays crisp on dark / coloured surfaces.
 */
export function LogoMark({
  size = 32, className, tile = false,
}: { size?: number; className?: string; tile?: boolean }) {
  const img = (
    <img
      src={BRAND_ICON_SRC}
      width={size}
      height={size}
      className={tile ? undefined : className}
      alt="CognixHR"
      draggable={false}
      style={{ display: 'block' }}
    />
  )
  if (!tile) return img
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-xl bg-white shadow-sm', className)}
      style={{ padding: Math.round(size * 0.16) }}
    >
      {img}
    </span>
  )
}

/**
 * The "CognixHR" wordmark, rendered from the canonical artwork so the lettering
 * matches the brand exactly. `tone="light"` swaps to the white version for dark
 * backgrounds. Width auto-scales from `height`.
 */
export function Wordmark({
  height = 18, tone = 'color', className,
}: { height?: number; tone?: 'color' | 'light'; className?: string }) {
  return (
    <img
      src={tone === 'light' ? BRAND_WORDMARK_LIGHT_SRC : BRAND_WORDMARK_SRC}
      className={className}
      alt="CognixHR"
      draggable={false}
      style={{ height, width: 'auto', display: 'block' }}
    />
  )
}

export function Logo({ variant = 'full', size = 32, className, dark = false }: LogoProps) {
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
      <LogoMark size={size} tile={dark} />
      {variant === 'full' && <Wordmark height={Math.round(size * 0.5)} tone={dark ? 'light' : 'color'} />}
    </div>
  )
}

export default Logo
