/**
 * ActionCenter — Phase 2 Intelligence
 * /admin/intelligence/action-center
 *
 * Surfaces observations triggered by recent events (last 48h).
 * Read-only suggestion layer — every item is a suggestion, not a directive.
 * No mock data. All observations cite their source table.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import {
  Loader2, RefreshCw, UserPlus, LogOut, Package, AlertCircle, Info, CheckCircle,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionObservation {
  id: string
  event_type: string
  title: string
  suggestion: string
  source_table: string
  source_count: number
  generated_at: string
}

interface ActionCenterResponse {
  observations: ActionObservation[]
  total: number
  generated_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  new_hire:                  UserPlus,
  separation_initiated:      LogOut,
  asset_assigned:            Package,
  asset_separation_overlap:  AlertCircle,
  on_notice:                 Info,
}

const EVENT_COLOR: Record<string, string> = {
  new_hire:                 'border-info bg-info',
  separation_initiated:     'border-accent-coral bg-accent-coral',
  asset_assigned:           'border-border bg-muted',
  asset_separation_overlap: 'border-destructive bg-destructive',
  on_notice:                'border-warning bg-warning',
}

const EVENT_ICON_COLOR: Record<string, string> = {
  new_hire:                 'text-info',
  separation_initiated:     'text-accent-coral',
  asset_assigned:           'text-muted-foreground',
  asset_separation_overlap: 'text-destructive',
  on_notice:                'text-warning',
}

const EVENT_LABEL: Record<string, string> = {
  new_hire:                 'New Hire',
  separation_initiated:     'Separation',
  asset_assigned:           'Asset Activity',
  asset_separation_overlap: 'Asset Risk',
  on_notice:                'Notice Period',
}

function groupByEventType(obs: ActionObservation[]): Record<string, ActionObservation[]> {
  const map: Record<string, ActionObservation[]> = {}
  for (const o of obs) {
    if (!map[o.event_type]) map[o.event_type] = []
    map[o.event_type].push(o)
  }
  return map
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ObservationCard({ obs }: { obs: ActionObservation }) {
  const Icon = EVENT_ICON[obs.event_type] ?? CheckCircle
  const cardClass = ['rounded-lg border p-4 flex gap-4', EVENT_COLOR[obs.event_type] ?? 'border-border bg-card'].join(' ')
  const iconClass = ['mt-0.5 shrink-0', EVENT_ICON_COLOR[obs.event_type] ?? 'text-muted-foreground'].join(' ')

  return (
    <div className={cardClass}>
      <Icon className={['h-5 w-5', iconClass].join(' ')} />
      <div className="flex flex-col gap-1 min-w-0">
        <p className="font-medium text-sm leading-snug">{obs.title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{obs.suggestion}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Source: <span className="font-mono">{obs.source_table}</span>
          {' · '}
          {obs.source_count} record{obs.source_count !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  )
}

function EventGroup({ eventType, items }: { eventType: string; items: ActionObservation[] }) {
  const label = EVENT_LABEL[eventType] ?? eventType
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      {items.map(obs => <ObservationCard key={obs.id} obs={obs} />)}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ActionCenter() {
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<ActionCenterResponse>({
    queryKey: ['intelligence', 'action-center'],
    queryFn: () =>
      api
        .get<ActionCenterResponse & { data?: ActionCenterResponse }>('/intelligence/action-center')
        .then((r) => r.data ?? r),
    refetchInterval: 2 * 60 * 1000, // 2-minute auto-refetch
    staleTime:       90 * 1000,
  })

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Action Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Observations from workforce events in the last 48 hours. All items are suggestions — review and act at your discretion.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          {isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading observations…</span>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Unable to load action center data.{' '}
          {error instanceof Error ? error.message : 'Unknown error.'}{' '}
          <button className="underline ml-1" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {/* Content */}
      {data && !isLoading && (
        <>
          {/* Meta bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{data.total} observation{data.total !== 1 ? 's' : ''} from the last 48 hours</span>
            {updatedAt && <span>Updated {updatedAt}</span>}
          </div>

          {/* Empty state */}
          {data.total === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <CheckCircle className="h-10 w-10 text-success" />
              <p className="font-medium text-base">No recent activity</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                No significant workforce events were detected in the last 48 hours. Check back after new activity occurs.
              </p>
            </div>
          )}

          {/* Grouped observations */}
          {data.total > 0 && (() => {
            const groups = groupByEventType(data.observations)
            // Render in priority order
            const ORDER = ['asset_separation_overlap', 'separation_initiated', 'on_notice', 'new_hire', 'asset_assigned']
            const keys = [
              ...ORDER.filter(k => groups[k]),
              ...Object.keys(groups).filter(k => !ORDER.includes(k)),
            ]
            return (
              <div className="flex flex-col gap-8">
                {keys.map(k => (
                  <EventGroup key={k} eventType={k} items={groups[k]} />
                ))}
              </div>
            )
          })()}
        </>
      )}
    </PageContainer>
  )
}
