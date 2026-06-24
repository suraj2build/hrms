import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Info, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const CHART = { green: '#1FA968', rose: '#E5564B', blue: '#2E6FE6', amber: '#E0A53B' }

interface TrendPoint {
  month:         string
  joiners:       number
  exits:         number
  net:           number
  attrition_pct: number
}

// 'YYYY-MM' → 'Jan' for compact axis labels.
function fmtMonth(ym: string): string {
  const [, mo] = ym.split('-').map(Number)
  return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo] ?? ym
}

// Per-department row — headcount + cost are real (from /executive). The rest
// (attrition / productivity / diversity / open roles / contract) have no
// per-department source yet, so they render as "—" rather than fabricated.
export interface DeptRow {
  name:         string
  headcount:    number
  cost:         number          // ₹ Cr (gross)
  costPerHead:  number | null   // ₹ K / head / month
  net?:         number | null
  ot?:          number | null
  open?:        number | null
  attrition?:   number | null
  productivity?: number | null
  female?:      number | null
  contract?:    number | null
  growth?:      number | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  dept: DeptRow | null
}

const dash = (v: number | null | undefined, suffix = '') => (v == null ? '—' : `${v}${suffix}`)

export function DrillDownSheet({ open, onOpenChange, dept }: Props) {
  if (!dept) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{dept.name}</SheetTitle>
            <Badge variant="secondary">Manpower drill-down</Badge>
          </div>
          <SheetDescription>Headcount and payroll cost from live data. Attrition, productivity and diversity are not yet broken down per department.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Headcount"   value={dept.headcount.toLocaleString()} />
          <Metric label="Open Roles"  value={dash(dept.open)} tone="muted" />
          <Metric label="Attrition"   value={dept.attrition == null ? '—' : `${dept.attrition}%`} tone="muted" />
          <Metric label="Productivity" value={dept.productivity == null ? '—' : `${dept.productivity}%`} tone="muted" />
          <Metric label="Cost / Yr"   value={`₹${dept.cost.toFixed(1)}Cr`} />
          <Metric label="Cost / Head" value={dept.costPerHead == null ? '—' : `₹${dept.costPerHead.toFixed(1)}K`} />
          <Metric label="Female %"    value={dept.female == null ? '—' : `${dept.female}%`} tone="muted" />
          <Metric label="Contract"    value={dash(dept.contract)} tone="muted" />
        </div>

        <DeptTrends department={dept.name} open={open} />
      </SheetContent>
    </Sheet>
  )
}

// Per-department joiner/exit/net + attrition, from /executive/department-trend.
// Queries by department NAME (consistent with the rest of the exec dept feature)
// and only while the sheet is open.
function DeptTrends({ department, open }: { department: string; open: boolean }) {
  const { data, isLoading, isError } = useQuery<{ data: { trend: TrendPoint[] } }>({
    queryKey:  ['exec-dept-trend', department],
    queryFn:   () => api.get<{ data: { trend: TrendPoint[] } }>(`/executive/department-trend?department=${encodeURIComponent(department)}&months=12`),
    enabled:   open && !!department,
    staleTime: 5 * 60_000,
  })

  const trend = (data?.data?.trend ?? []).map(p => ({ ...p, label: fmtMonth(p.month) }))
  const hasData = trend.some(p => p.joiners || p.exits)

  if (isLoading) {
    return (
      <div className="mt-6 flex h-40 items-center justify-center rounded-xl border bg-card text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading trends…
      </div>
    )
  }
  if (isError || !trend.length || !hasData) {
    return (
      <div className="mt-6 rounded-xl border bg-card p-4">
        <div className="mb-3 text-sm font-medium">Headcount trend (12 mo)</div>
        <EmptyChart text="No joiner/exit movement recorded for this department in the last 12 months." />
      </div>
    )
  }

  return (
    <>
      <div className="mt-6 rounded-xl border bg-card p-4">
        <div className="mb-3 text-sm font-medium">Headcount trend (12 mo)</div>
        <div className="h-44">
          <ResponsiveContainer>
            <ComposedChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="joiners" name="Joiners" fill={CHART.green} radius={[3, 3, 0, 0]} maxBarSize={16} />
              <Bar dataKey="exits"   name="Exits"   fill={CHART.rose}  radius={[3, 3, 0, 0]} maxBarSize={16} />
              <Line type="monotone" dataKey="net" name="Net" stroke={CHART.blue} strokeWidth={2.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4">
        <div className="mb-1 text-sm font-medium">Attrition trend (%)</div>
        <p className="mb-3 text-[11px] text-muted-foreground">Monthly exits as a share of current department headcount (rate proxy).</p>
        <div className="h-40">
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="attrition_pct" name="Attrition %" stroke={CHART.amber} strokeWidth={2.5} dot={{ r: 2, fill: CHART.amber }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 text-center">
      <Info className="h-5 w-5 text-muted-foreground/40" />
      <p className="max-w-xs text-xs text-muted-foreground">{text}</p>
    </div>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'destructive' | 'muted' }) {
  const toneCls =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'destructive' ? 'text-destructive' :
    tone === 'muted' ? 'text-muted-foreground' :
    'text-foreground'
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  )
}
