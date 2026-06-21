/**
 * viz — shared BI-canvas visual primitives for the Executive Insight Hub.
 * Power BI / Tableau-style visual card, custom tooltip, donut block, empty
 * state and compact stat — used across every exec tab for one visual language.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { cn } from '@/lib/utils'
import { PERIODS, type Period } from '@/components/exec/exec-utils'

export function PeriodSlicer({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
      {PERIODS.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {p}
        </button>
      ))}
    </div>
  )
}

export function Viz({ title, sub, icon: Icon, right, className, children }: {
  title: string; sub?: string; icon?: React.ComponentType<{ className?: string }>
  right?: React.ReactNode; className?: string; children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-3.5 shadow-[var(--shadow-card)]', className)}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <div>
            <h3 className="text-[13px] font-semibold leading-tight text-foreground">{title}</h3>
            {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export function DonutBlock({ data, centerValue, centerLabel, total }: {
  data: { name: string; value: number; color: string }[]; centerValue: string; centerLabel: string; total?: number
}) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={46} outerRadius={68} paddingAngle={2} stroke="var(--background)" strokeWidth={2}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTip fmt={(v: number) => `${v} · ${sum > 0 ? ((v / sum) * 100).toFixed(0) : 0}%`} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} /><span className="capitalize text-foreground">{d.name}</span></span>
            <span className="font-medium tabular-nums text-muted-foreground">{d.value} · {sum > 0 ? ((d.value / sum) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChartTip({ active, payload, label, fmt }: {
  active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; fill?: string; dataKey?: string; payload?: Record<string, unknown> }>
  label?: string; fmt?: (v: number, p: { dataKey?: string; payload?: Record<string, unknown> }) => React.ReactNode
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-[11px] shadow-md">
      {label != null && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums text-foreground">{fmt ? fmt(p.value ?? 0, p) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function NoData({ text }: { text: string }) {
  return <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 text-center text-[11px] leading-relaxed text-muted-foreground">{text}</div>
}

export function MiniStat({ label, value, tone = 'muted', boxed }: {
  label: string; value: string; tone?: 'success' | 'destructive' | 'warning' | 'primary' | 'muted'; boxed?: boolean
}) {
  const cls = tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive'
    : tone === 'warning' ? 'text-warning' : tone === 'primary' ? 'text-primary' : 'text-muted-foreground'
  return (
    <div className={cn(boxed && 'rounded-lg border bg-background/40 p-2.5')}>
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-base font-semibold tabular-nums', cls)}>{value}</div>
    </div>
  )
}
