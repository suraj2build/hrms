/**
 * WorkforceDigest — Phase 6 AI Workforce OS
 * Three-tab digest view: Daily | Weekly | Monthly
 * Rule-based, no LLM. Read-only intelligence layer.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Loader2, RefreshCw, Database } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DigestSource {
  table: string
  description: string
}

interface DigestResponse {
  period: 'daily' | 'weekly' | 'monthly'
  summary_text: string
  metrics: Record<string, number>
  generated_at: string
  sources: DigestSource[]
}

type TabKey = 'daily' | 'weekly' | 'monthly'

// ── Metric display labels ─────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, Record<string, string>> = {
  daily: {
    new_joiners_today:    'New Joiners Today',
    separations_today:    'Separations Today',
    assets_assigned_today:'Assets Assigned Today',
    pending_approvals:    'Pending Approvals',
  },
  weekly: {
    joiners_7d:               'Joiners (7d)',
    exits_7d:                 'Exits (7d)',
    onboarding_completions_7d:'Onboarding Completions',
    probation_reviews_due:    'Probation Reviews Due',
  },
  monthly: {
    headcount:       'Active Headcount',
    joiners_mtd:     'Joiners (MTD)',
    exits_mtd:       'Exits (MTD)',
    net_change:      'Net Change',
    probation_backlog:'Probation Backlog',
  },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: number }) {
  const isNegative = value < 0
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1 min-w-[130px]">
      <span className={`text-2xl font-bold ${isNegative ? 'text-red-600' : 'text-foreground'}`}>
        {value > 0 && label === 'Net Change' ? '+' : ''}{value}
      </span>
      <span className="text-xs text-muted-foreground leading-tight">{label}</span>
    </div>
  )
}

function SourceBadge({ table, description }: DigestSource) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Database className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
      <span>
        <span className="font-mono font-medium text-foreground/70">{table}</span>
        {description ? <span className="ml-1">— {description}</span> : null}
      </span>
    </div>
  )
}

function DigestTab({ tab }: { tab: TabKey }) {
  const endpoint = `/intelligence/digest/${tab}`
  const { data, isLoading, error, refetch, isFetching } = useQuery<DigestResponse>({
    queryKey: ['intelligence-digest', tab],
    queryFn: () => api.get(endpoint),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Generating {tab} digest…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load {tab} digest.
      </div>
    )
  }

  const metricLabels = METRIC_LABELS[tab] ?? {}
  const metricEntries = Object.entries(data.metrics)

  const generatedDate = new Date(data.generated_at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-5">
      {/* Summary narrative */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground capitalize">{tab} Summary</h3>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{data.summary_text}</p>
        <p className="mt-3 text-[11px] text-muted-foreground">Generated {generatedDate}</p>
      </div>

      {/* Metrics grid */}
      {metricEntries.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Metrics</h4>
          <div className="flex flex-wrap gap-3">
            {metricEntries.map(([key, val]) => (
              <MetricCard
                key={key}
                label={metricLabels[key] ?? key.replace(/_/g, ' ')}
                value={val}
              />
            ))}
          </div>
        </div>
      )}

      {/* Source tables */}
      {data.sources.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Generated from live data
          </p>
          <div className="space-y-1.5">
            {data.sources.map((src, i) => (
              <SourceBadge key={i} table={src.table} description={src.description} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'daily',   label: 'Daily'   },
  { key: 'weekly',  label: 'Weekly'  },
  { key: 'monthly', label: 'Monthly' },
]

export function WorkforceDigest() {
  const [activeTab, setActiveTab] = useState<TabKey>('daily')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Workforce Digest</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rule-based workforce summaries. Data sourced live from Emvora — no AI inference.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active tab content — remounts on switch to auto-refresh */}
      <DigestTab key={activeTab} tab={activeTab} />
    </div>
  )
}

export default WorkforceDigest
