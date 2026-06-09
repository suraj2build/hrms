/**
 * ExecShell — shared chrome for the Executive Insight Hub.
 * Sub-tab nav (CEO / CHRO / Workforce / Financial / Compliance / Trends),
 * a compact page header, and the reusable Panel / EmptyBody / StatTile pieces
 * + chart helpers that every exec page uses.
 */
import { NavLink } from 'react-router-dom'
import { Activity, Users2, Users, DollarSign, ShieldCheck, BarChart3, Brain, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
export const TIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } as const

export function cr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`
  return `₹${Math.round(n).toLocaleString()}`
}
export function fmtMonth(ym: string): string {
  try { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1).toLocaleString('default', { month: 'short' }) }
  catch { return ym }
}
export const fmtNum = (n: number | undefined | null) => (n ?? 0).toLocaleString()

const TABS = [
  { to: '/admin/executive',            label: 'CEO View',   icon: Activity,    end: true },
  { to: '/admin/executive/chro',       label: 'CHRO View',  icon: Users2 },
  { to: '/admin/executive/workforce',  label: 'Workforce',  icon: Users },
  { to: '/admin/executive/financial',  label: 'Financial',  icon: DollarSign },
  { to: '/admin/executive/compliance', label: 'Compliance', icon: ShieldCheck },
  { to: '/admin/executive/trends',     label: 'Trends',     icon: BarChart3 },
]

export function ExecNav() {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-xl border bg-muted/30 p-1">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
            isActive
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          )}
        >
          <t.icon className="h-3.5 w-3.5" />
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function ExecLayout({ title, subtitle, actions, children }: {
  title: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[image:var(--gradient-primary)] text-primary-foreground shadow-sm">
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-none text-foreground">{title}</h1>
              <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {actions}
        </div>
        <ExecNav />
      </div>
      {children}
    </div>
  )
}

export function Panel({ title, subtitle, icon: Icon, iconClass, badge, action, className, children }: {
  title: string; subtitle?: string; icon: React.ComponentType<{ className?: string }>; iconClass?: string
  badge?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Icon className={cn('h-4 w-4', iconClass)} />
            <h3 className="text-sm font-semibold">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function EmptyBody({ text }: { text: string }) {
  return (
    <div className="mt-4 flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
      <Info className="h-6 w-6 text-muted-foreground/40" />
      <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">{text}</p>
    </div>
  )
}

export function StatTile({ label, value, tone = 'default' }: {
  label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'destructive' | 'muted' | 'primary'
}) {
  const cls =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'destructive' ? 'text-destructive' :
    tone === 'primary' ? 'text-primary' :
    tone === 'muted' ? 'text-muted-foreground' :
    'text-foreground'
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums', cls)}>{value}</div>
    </div>
  )
}
