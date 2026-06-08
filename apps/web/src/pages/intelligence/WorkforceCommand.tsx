/**
 * WorkforceCommand — HR Command Center
 * /admin/intelligence/workforce-command
 *
 * Read-only intelligence page. Fetches live derived observations from the
 * intelligence API. No mock data. Every observation cites its source table.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Loader2, ChevronDown, ChevronUp, RefreshCw,
  AlertTriangle, TrendingUp, Users, Clock, Package, Shield, Info,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourceRecord { table: string; count: number; sample?: string }

interface Observation {
  id: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'info'
  title: string
  body: string
  source_records: SourceRecord[]
  generated_at: string
}

interface WorkforceCommandData {
  summary:        string
  critical_count: number
  high_count:     number
  observations:   Observation[]
  kpis:           Record<string, number | string | null>
  generated_at:   string
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-50 border-red-200',
  high:     'bg-orange-50 border-orange-200',
  medium:   'bg-yellow-50 border-yellow-200',
  info:     'bg-blue-50 border-blue-200',
}

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  onboarding: Users,
  separation: TrendingUp,
  compliance: Shield,
  assets:     Package,
  payroll:    Clock,
  leave:      Clock,
}

function KpiTile({ label, value, urgent }: { label: string; value: number | string | null; urgent?: boolean }) {
  return (
    <div className={['rounded-lg border p-4 flex flex-col gap-1', urgent ? 'border-red-200 bg-red-50' : 'border-border bg-card'].join(' ')}>
      <span className={['text-2xl font-bold', urgent ? 'text-red-700' : 'text-foreground'].join(' ')}>
        {value ?? 0}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function ObservationCard({ obs }: { obs: Observation }) {
  const [open, setOpen] = useState(false)
  const Icon = CAT_ICON[obs.category] ?? Info
  return (
    <div className={['rounded-lg border p-4 space-y-2', SEV_COLORS[obs.severity] ?? ''].join(' ')}>
      <div className="flex items-start gap-3">
        <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-foreground">{obs.title}</span>
            <Badge
              variant={obs.severity === 'critical' ? 'destructive' : 'secondary'}
              className="text-[10px] px-1.5 py-0 capitalize"
            >
              {obs.severity}
            </Badge>
          </div>
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Why is this flagged?
          </button>
          {open && (
            <div className="mt-2 space-y-2 text-xs border-t border-border/40 pt-2">
              <p className="leading-relaxed text-foreground/80">{obs.body}</p>
              <div className="flex flex-wrap gap-1.5">
                {obs.source_records.map((sr, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/5 text-[10px] font-mono"
                  >
                    {sr.table} · {sr.count} record{sr.count !== 1 ? 's' : ''}
                    {sr.sample ? <span className="text-muted-foreground ml-1">({sr.sample})</span> : null}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Generated: {new Date(obs.generated_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkforceCommand() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<{ data: WorkforceCommandData }>({
    queryKey: ['intelligence-workforce-command'],
    queryFn:  () => api.get('/intelligence/workforce-command'),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
  const d = data?.data

  return (
    <PageContainer className="max-w-6xl">

      {/* Gradient header */}
      <div className="rounded-xl bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] text-white p-5 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Workforce Command Center</h1>
          <p className="text-sm text-white/80">
            Real-time workforce intelligence — derived from live operational data
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {d && d.critical_count > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-xs font-medium">
                <AlertTriangle className="h-3 w-3" /> {d.critical_count} critical
              </span>
            )}
            {d && d.high_count > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-xs font-medium">
                {d.high_count} high priority
              </span>
            )}
            {d && d.critical_count === 0 && d.high_count === 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-xs font-medium">
                <Shield className="h-3 w-3" /> All signals normal
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="bg-white/10 border-white/20 text-white hover:bg-white/20 flex-shrink-0"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={'h-3.5 w-3.5 mr-1.5' + (isFetching ? ' animate-spin' : '')} />
          Refresh
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading workforce intelligence…</span>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
          <p className="text-sm text-destructive font-medium">Failed to load intelligence data</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {d && (
        <>
          {/* AI summary — promoted above metrics: lead with the takeaway */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Workforce Attention Summary
            </p>
            <p className="text-sm leading-relaxed text-foreground">{d.summary}</p>
            <p className="text-[11px] text-muted-foreground">
              Sources: employees · onboarding_sessions · employee_separation · employee_asset_ledger
            </p>
          </div>

          {/* Needs Attention — actionable metrics (highlight when non-zero) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Needs Attention</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiTile label="On Notice"           value={d.kpis.on_notice}           urgent={Number(d.kpis.on_notice) > 0} />
              <KpiTile label="Stalled Onboarding"  value={d.kpis.stalled_onboarding}  urgent={Number(d.kpis.stalled_onboarding) > 0} />
              <KpiTile label="Pending Separations" value={d.kpis.pending_separations} urgent={Number(d.kpis.pending_separations) > 0} />
              <KpiTile label="Assets at Risk"      value={d.kpis.assets_at_risk}      urgent={Number(d.kpis.assets_at_risk) > 0} />
              <KpiTile label="Probation Due"       value={d.kpis.probation_due}       urgent={Number(d.kpis.probation_due) > 5} />
            </div>
          </div>

          {/* Workforce — context metrics (steady-state) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Workforce</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiTile label="Active Employees"  value={d.kpis.active_headcount} />
              <KpiTile label="Joined This Month" value={d.kpis.joiners_this_month} />
            </div>
          </div>

          {/* Observations */}
          {d.observations.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center space-y-2">
              <Shield className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="text-sm font-medium text-foreground">All workforce signals within normal range</p>
              <p className="text-xs text-muted-foreground">No critical or high-priority items detected</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto leading-relaxed">
                Observations appear when AI detects issues such as stalled onboarding, at-risk separations, compliance gaps, or overdue asset returns. Check back daily.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Items Requiring Attention ({d.observations.length})
                </p>
                <Link to="/admin/intelligence/action-center" className="text-xs font-medium text-primary hover:underline">
                  View Action Center →
                </Link>
              </div>
              {d.observations.map(obs => <ObservationCard key={obs.id} obs={obs} />)}
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}

export default WorkforceCommand
