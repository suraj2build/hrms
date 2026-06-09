/**
 * ExecutiveNarrative — Monthly Workforce Narrative component
 * Added to the existing Executive Intelligence page. Does NOT replace it.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Loader2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'

interface NarrativeMetrics {
  headcount:        number
  joiners:          number
  exits:            number
  probation_backlog: number
  net_change:       number
  period:           string
}

interface ExecutiveNarrativeData {
  narrative:    string
  metrics:      NarrativeMetrics
  period_start: string
  period_end:   string
  generated_at: string
}

function MetricChip({ label, value, delta }: { label: string; value: number; delta?: number }) {
  const isUp   = delta != null && delta > 0
  const isDown = delta != null && delta < 0
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1">
      <span className="text-xl font-bold text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      {isUp   && <span className="text-[11px] text-emerald-600 flex items-center gap-0.5"><TrendingUp  className="h-3 w-3" /> +{delta}</span>}
      {isDown && <span className="text-[11px] text-red-600    flex items-center gap-0.5"><TrendingDown className="h-3 w-3" /> {delta}</span>}
      {delta === 0 && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" /> No change</span>}
    </div>
  )
}

export function ExecutiveNarrative({ month }: { month?: string }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const { data, isLoading, error } = useQuery<{ data: ExecutiveNarrativeData }>({
    queryKey: ['intelligence-executive-narrative', month ?? 'current'],
    queryFn:  () => api.get('/intelligence/executive-narrative' + (month ? '?month=' + month : '')),
    staleTime: 30 * 60_000,
  })
  const d = data?.data

  if (isLoading) return (
    <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Generating workforce narrative…</span>
    </div>
  )
  if (error || !d) return null

  const m = d.metrics
  return (
    <div className="rounded-xl border border-border bg-card space-y-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Monthly Workforce Narrative
          </p>
          <p className="text-sm text-muted-foreground">{d.period_start} – {d.period_end}</p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {new Date(d.generated_at).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricChip label="Active Headcount"  value={m.headcount} />
        <MetricChip label="Joiners"           value={m.joiners}           delta={m.joiners} />
        <MetricChip label="Exits"             value={m.exits}             delta={-m.exits} />
        <MetricChip label="Probation Backlog" value={m.probation_backlog} delta={m.probation_backlog > 0 ? m.probation_backlog : 0} />
      </div>

      <div className="rounded-md bg-muted/30 px-4 py-3">
        <p className="text-sm leading-relaxed text-foreground">{d.narrative}</p>
      </div>

      <button
        onClick={() => setSourcesOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Data sources
      </button>
      {sourcesOpen && (
        <div className="text-xs text-muted-foreground space-y-1 pl-4 border-l border-border">
          <p>· <span className="font-mono">employees</span> — headcount, joiners, probation backlog</p>
          <p>· <span className="font-mono">employee_separation</span> — exits (relieved/archived this period)</p>
          <p className="text-[10px]">All figures are direct COUNTs from live source tables — no caching or estimation.</p>
        </div>
      )}
    </div>
  )
}

// Standalone page wrapper — the bare component is a card embedded elsewhere;
// the /admin/intelligence/narratives route needs proper page chrome.
export function NarrativesPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Narratives"
        subtitle="AI-generated monthly workforce narrative — every figure is a live COUNT from source tables"
        breadcrumb={[{ label: 'Advanced Operations' }, { label: 'Narratives' }]}
      />
      <ExecutiveNarrative />
    </PageContainer>
  )
}

export default ExecutiveNarrative
