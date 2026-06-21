import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

type Tone = 'primary' | 'success' | 'warning' | 'destructive' | 'info'

interface KpiCardProps {
  label: string
  value: string
  delta?: number
  deltaLabel?: string
  hint?: string
  icon?: LucideIcon
  tone?: Tone
  spark?: number[]
  onClick?: () => void
}

const toneRing: Record<Tone, string> = {
  primary: 'from-primary/15 to-primary/0 text-primary',
  success: 'from-success/15 to-success/0 text-success',
  warning: 'from-warning/20 to-warning/0 text-warning',
  destructive: 'from-destructive/15 to-destructive/0 text-destructive',
  info: 'from-info/15 to-info/0 text-info',
}

const toneStroke: Record<Tone, string> = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  destructive: 'var(--destructive)',
  info: 'var(--info)',
}

// Glossy gradient chip per tone
const toneChip: Record<Tone, string> = {
  primary:     'var(--grad-primary)',
  success:     'linear-gradient(145deg, #1FA968, #1A8050)',
  warning:     'linear-gradient(145deg, #E0A53B, #B07B18)',
  destructive: 'linear-gradient(145deg, #E5564B, #C93535)',
  info:        'linear-gradient(145deg, #3B82F6, #2260A8)',
}

export function KpiCard({
  label, value, delta, deltaLabel, hint, icon: Icon, tone = 'primary', spark, onClick,
}: KpiCardProps) {
  const positive = (delta ?? 0) > 0
  const negative = (delta ?? 0) < 0
  const data = (spark ?? []).map((v, i) => ({ i, v }))

  return (
    <button
      onClick={onClick}
      className={cn(
        'surface-premium lift-hover group relative w-full overflow-hidden p-3.5 text-left',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
      )}
    >
      <div className={cn('pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-60 blur-xl', toneRing[tone])} />

      {/* label + icon */}
      <div className="relative flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && (
          <div className="gloss-sheen flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-black/5 shadow-sm"
               style={{ background: toneChip[tone] }}>
            <Icon className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </div>

      {/* value + delta */}
      <div className="relative mt-1 flex items-end justify-between gap-2">
        <span className="text-[1.6rem] font-semibold leading-none tracking-tight text-foreground tabular-nums">{value}</span>
        {typeof delta === 'number' && (
          <span className={cn(
            'inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
            positive && 'bg-success/10 text-success',
            negative && 'bg-destructive/10 text-destructive',
            !positive && !negative && 'bg-muted text-muted-foreground',
          )}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : negative ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      {/* footer: period + hint */}
      {(deltaLabel || hint) && (
        <div className="relative mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{deltaLabel ?? ''}</span>
          <span className="truncate text-right">{hint ?? ''}</span>
        </div>
      )}

      {data.length > 0 && (
        <div className="relative -mx-1 mt-2 h-7">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={toneStroke[tone]} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={toneStroke[tone]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={toneStroke[tone]} strokeWidth={2} fill={`url(#spark-${label})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </button>
  )
}
