/**
 * PageHero — a premium navy "hero band" header for marquee pages.
 *
 * Uses the .hero-band utility (gradient + faint grid + glow) and renders glassy
 * KPI tiles on top — the in-app echo of the login showcase. Use HeroStat for the
 * glassmorphic tiles.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export function PageHero({
  eyebrow, title, subtitle, actions, children, className,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children?: React.ReactNode   // glassy stat row
  className?: string
}) {
  return (
    <div className={cn('hero-band mb-5 p-5 sm:p-6', className)}>
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/55">{eyebrow}</p>
          )}
          <h1 className="font-display text-2xl font-bold leading-tight text-white">{title}</h1>
          {subtitle && <p className="mt-1 max-w-xl text-sm text-white/65">{subtitle}</p>}
        </div>
        {actions && <div className="relative flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && (
        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
      )}
    </div>
  )
}

export function HeroStat({
  label, value, sub, icon: Icon, tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  icon?: React.ElementType
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const valTone =
    tone === 'success' ? 'text-success'
    : tone === 'warning' ? 'text-warning'
    : tone === 'danger'  ? 'text-destructive'
    : 'text-white'
  return (
    <div className="gloss-sheen rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-xl ring-1 ring-white/10">
      <div className="relative flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/55">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-white/55" />}
      </div>
      <p className={cn('relative mt-1 text-xl font-bold tabular-nums', valTone)}>{value}</p>
      {sub && <p className="relative mt-0.5 text-[10px] text-white/50">{sub}</p>}
    </div>
  )
}
