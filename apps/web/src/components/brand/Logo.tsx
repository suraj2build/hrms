/**
 * Emvora brand logo.
 *
 *   <Logo />                  → mark + "emvora" wordmark (default)
 *   <Logo variant="mark" />   → just the gradient tile mark
 *   <Logo size={40} />        → custom mark size (px)
 *
 * Brand gradient: dark green #047857 → dark teal #0F766E → dark blue #1E40AF
 * The mark is three ascending bars = growth + workforce intelligence.
 */
import { cn } from '@/lib/utils'

interface LogoProps {
  variant?: 'full' | 'mark'
  size?:    number
  className?: string
  /** Wordmark colour — defaults to currentColor so it adapts to dark/light. */
  wordClassName?: string
}

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
        <linearGradient id="emvora-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0"   stopColor="#047857" />
          <stop offset="0.5" stopColor="#0F766E" />
          <stop offset="1"   stopColor="#1E40AF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#emvora-grad)" />
      {/* ascending bars — growth / intelligence */}
      <rect x="7.5"  y="18"   width="3.5" height="6.5"  rx="1.75" fill="#fff" fillOpacity="0.85" />
      <rect x="14.25" y="12.5" width="3.5" height="12"   rx="1.75" fill="#fff" />
      <rect x="21"   y="7.5"  width="3.5" height="17"   rx="1.75" fill="#fff" fillOpacity="0.95" />
    </svg>
  )
}

export function Logo({ variant = 'full', size = 32, className, wordClassName }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      {variant === 'full' && (
        <span className={cn('font-display font-bold tracking-tight leading-none', wordClassName)}
              style={{ fontSize: size * 0.56 }}>
          emvora
        </span>
      )}
    </div>
  )
}

export default Logo
