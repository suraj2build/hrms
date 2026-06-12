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
 *
 * All asset paths and brand colours are sourced from brandConfig so a
 * white-label deployment can override them via VITE_BRAND_* env vars.
 */
import { cn } from '@/lib/utils'
import { brandConfig } from '@/lib/brand-config'

interface LogoProps {
  variant?: 'full' | 'mark' | 'lockup'
  size?:    number
  className?: string
  /** When true, render the white wordmark (for dark surfaces). Ignored for mark/lockup. */
  dark?: boolean
}

/**
 * Brand colours — re-exported from brandConfig for consumers that need a hex
 * value (e.g. inline SVG fills). A white-label build overrides via
 * VITE_BRAND_COLOR_PRIMARY / VITE_BRAND_COLOR_TEAL env vars.
 */
export const BRAND_BLUE = brandConfig.colors.primary
export const BRAND_TEAL = brandConfig.colors.teal

/** Public paths to the canonical brand assets, sourced from brandConfig. */
export const BRAND_ICON_SRC           = brandConfig.assets.icon
export const BRAND_LOCKUP_SRC         = brandConfig.assets.lockup
export const BRAND_WORDMARK_SRC       = brandConfig.assets.wordmark
export const BRAND_WORDMARK_LIGHT_SRC = brandConfig.assets.wordmarkLight

/**
 * The brand mark (icon). Pass `tile` to back it with a white rounded tile so the
 * navy "C" stays crisp on dark / coloured surfaces.
 */
export function LogoMark({
  size = 32, className, tile = false,
}: { size?: number; className?: string; tile?: boolean }) {
  const img = (
    <img
      src={brandConfig.assets.icon}
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
      src={tone === 'light' ? brandConfig.assets.wordmarkLight : brandConfig.assets.wordmark}
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
        src={brandConfig.assets.lockup}
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
