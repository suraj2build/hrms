import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Info } from 'lucide-react'

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

        <div className="mt-6 rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-medium">Headcount trend (12 mo)</div>
          <EmptyChart text="Per-department monthly trend isn't available yet." />
        </div>

        <div className="mt-4 rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-medium">Attrition trend (%)</div>
          <EmptyChart text="Per-department attrition history isn't available yet." />
        </div>
      </SheetContent>
    </Sheet>
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
