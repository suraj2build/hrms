/**
 * GovernanceWorkspace — /admin/governance
 *
 * Passive intelligence view. READ-ONLY.
 * Shows:
 *   1. Governance Timeline — last 30 platform events
 *   2. Compliance Alerts — high/critical events from /governance/compliance/alerts
 *   3. Risk Summary — top risk signals from /governance/risk/summary
 *   4. Incident Correlation Panel — open incidents grouped by module
 *
 * Non-invasive. No controls that mutate data.
 * Explainability drawer opens on row click.
 * Sprint 2: Governance Intelligence Layer.
 */

import { useState }        from 'react'
import { useQuery }        from '@tanstack/react-query'
import {
  Activity, ShieldAlert, BarChart2, AlertCircle,
  CheckCircle2, ExternalLink,
  ChevronRight,
}                          from 'lucide-react'
import { PageContainer }   from '@/components/layout/PageContainer'
import { PageHeader }      from '@/components/layout/PageHeader'
import { SectionCard }     from '@/components/layout/SectionCard'
import { Badge }           from '@/components/ui/badge'
import { Button }          from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  SeverityBadge,
  ExplainabilityDrawer,
  IntelligenceEmptyState,
  RiskIndicator,
}                          from '@/components/ui/intelligence/index.js'
import { api }             from '@/lib/api/client'
import { cn }              from '@/lib/utils'
import { useNavigate }     from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlatformEvent {
  id?:         string
  event_id?:   string
  event_type:  string
  module?:     string
  entity_type: string
  entity_id:   string
  severity?:   string
  timestamp:   string
  payload?:    Record<string, unknown>
  governance_context?: {
    compliance_flags?: string[]
    risk_score?: number
  }
}

interface ComplianceAlert extends PlatformEvent {}

interface RiskEntity {
  entity_id:   string
  entity_type: string
  score:       number
  severity:    string
  count:       number
}

interface Incident {
  id:                   string
  incident_type:        string
  severity:             string
  title:                string
  status:               string
  related_entity_type?: string
  created_at:           string
  metadata?:            Record<string, unknown>
}

// ── Score bar helper ──────────────────────────────────────────────────────────

function ScoreBar({ score, severity }: { score: number; severity: string }) {
  const colour =
    severity === 'critical' ? 'bg-destructive' :
    severity === 'high'     ? 'bg-orange-500'  :
    severity === 'warning'  ? 'bg-yellow-500'  :
    'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', colour)} style={{ width: `${score}%` }} />
      </div>
      <RiskIndicator score={score} />
    </div>
  )
}

// ── Drawer state type ─────────────────────────────────────────────────────────

interface DrawerEvent {
  event_type:  string
  entity_type: string
  entity_id:   string
  timestamp:   string
  severity?:   string
  payload?:    Record<string, unknown>
  governance_context?: Record<string, unknown>
}

// ── Main component ────────────────────────────────────────────────────────────

export function GovernanceWorkspace() {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerEvent, setDrawerEvent] = useState<DrawerEvent | null>(null)

  // ── Data queries ────────────────────────────────────────────────────────────

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['governance', 'events'],
    queryFn:  () => api.get<{ events: PlatformEvent[] }>('/governance/events?limit=30'),
  })

  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['governance', 'compliance-alerts'],
    queryFn:  () => api.get<{ alerts: ComplianceAlert[] }>('/governance/compliance/alerts'),
  })

  const { data: riskData, isLoading: riskLoading } = useQuery({
    queryKey: ['governance', 'risk-summary'],
    queryFn:  () => api.get<{ risks: RiskEntity[] }>('/governance/risk/summary'),
  })

  const { data: incidentsData, isLoading: incidentsLoading } = useQuery({
    queryKey: ['governance', 'incidents'],
    queryFn:  () => api.get<{ incidents: Incident[] }>('/governance/incidents?limit=20'),
  })

  const events    = eventsData?.events   ?? []
  const alerts    = alertsData?.alerts   ?? []
  const risks     = riskData?.risks      ?? []
  const incidents = incidentsData?.incidents ?? []

  // ── Drawer helpers ──────────────────────────────────────────────────────────

  function openDrawer(ev: PlatformEvent) {
    setDrawerEvent({
      event_type:  ev.event_type,
      entity_type: ev.entity_type,
      entity_id:   ev.entity_id,
      timestamp:   ev.timestamp,
      severity:    ev.severity,
      payload:     ev.payload,
      governance_context: ev.governance_context as Record<string, unknown> | undefined,
    })
    setDrawerOpen(true)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Governance Intelligence"
        subtitle="Passive observability — read only"
        breadcrumb={[{ label: 'Admin', href: '/admin/control-center' }, { label: 'Governance' }]}
      />

      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList className="h-9">
          <TabsTrigger value="timeline"   className="gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" /> Timeline
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-1.5 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" /> Compliance
          </TabsTrigger>
          <TabsTrigger value="risk"       className="gap-1.5 text-xs">
            <BarChart2 className="h-3.5 w-3.5" /> Risk
          </TabsTrigger>
          <TabsTrigger value="incidents"  className="gap-1.5 text-xs">
            <AlertCircle className="h-3.5 w-3.5" /> Incidents
          </TabsTrigger>
        </TabsList>

        {/* ── Timeline ──────────────────────────────────────────────────────── */}
        <TabsContent value="timeline">
          <SectionCard
            title="Platform Event Timeline"
            description="Last 30 governance events. Click a row to inspect."
          >
            {eventsLoading ? (
              <IntelligenceEmptyState icon={<Activity className="h-8 w-8" />} title="Loading events…" />
            ) : events.length === 0 ? (
              <IntelligenceEmptyState icon={<Activity className="h-8 w-8" />} title="No events recorded yet." />
            ) : (
              <div className="divide-y divide-border">
                {events.map((ev, i) => (
                  <button
                    key={ev.event_id ?? ev.id ?? i}
                    className="w-full flex items-center gap-3 px-1 py-3 hover:bg-muted/40 transition-colors text-left group"
                    onClick={() => openDrawer(ev)}
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-medium text-foreground truncate max-w-[200px]">
                          {ev.event_type}
                        </span>
                        {ev.module && (
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {ev.module}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {ev.entity_type} · {ev.entity_id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SeverityBadge severity={ev.severity ?? 'info'} />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Compliance ────────────────────────────────────────────────────── */}
        <TabsContent value="compliance">
          <SectionCard
            title="Compliance Alerts"
            description="High and critical severity governance events."
          >
            {alertsLoading ? (
              <IntelligenceEmptyState icon={<ShieldAlert className="h-8 w-8" />} title="Loading alerts…" />
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-emerald-600">
                <CheckCircle2 className="h-8 w-8 opacity-60" />
                <p className="text-sm font-medium">No active compliance alerts</p>
                <p className="text-xs text-muted-foreground">All governance checks are passing.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {alerts.map((al, i) => (
                  <button
                    key={al.event_id ?? al.id ?? i}
                    className="w-full flex items-center gap-3 px-1 py-3 hover:bg-muted/40 transition-colors text-left group"
                    onClick={() => openDrawer(al)}
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <span className="font-mono text-xs font-medium text-foreground truncate block max-w-[220px]">
                        {al.event_type}
                      </span>
                      <p className="text-xs text-muted-foreground truncate">
                        {al.entity_type} · {al.entity_id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SeverityBadge severity={al.severity ?? 'high'} />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {(() => { const _d = new Date(al.timestamp); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}-${_d.getUTCFullYear()}` })()}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Risk ──────────────────────────────────────────────────────────── */}
        <TabsContent value="risk">
          <SectionCard
            title="Risk Summary"
            description="Top risk signals by entity, computed from historical governance events."
          >
            {riskLoading ? (
              <IntelligenceEmptyState icon={<BarChart2 className="h-8 w-8" />} title="Computing risk signals…" />
            ) : risks.length === 0 ? (
              <IntelligenceEmptyState icon={<BarChart2 className="h-8 w-8" />} title="No risk signals detected." />
            ) : (
              <div className="divide-y divide-border">
                {risks.map((r, i) => (
                  <div key={`${r.entity_type}:${r.entity_id}:${i}`} className="flex items-center gap-3 px-1 py-3">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="text-xs font-medium text-foreground capitalize">{r.entity_type}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{r.entity_id}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <ScoreBar score={r.score} severity={r.severity} />
                      <SeverityBadge severity={r.severity} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Incidents ─────────────────────────────────────────────────────── */}
        <TabsContent value="incidents">
          <SectionCard
            title="Open Incidents"
            description="Active governance incidents grouped by module."
            action={
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-7"
                onClick={() => navigate('/system/incidents')}
              >
                View all <ExternalLink className="h-3 w-3" />
              </Button>
            }
          >
            {incidentsLoading ? (
              <IntelligenceEmptyState icon={<AlertCircle className="h-8 w-8" />} title="Loading incidents…" />
            ) : incidents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-emerald-600">
                <CheckCircle2 className="h-8 w-8 opacity-60" />
                <p className="text-sm font-medium">No open incidents</p>
                <p className="text-xs text-muted-foreground">All incidents are resolved.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {incidents.map(inc => (
                  <div key={inc.id} className="flex items-center gap-3 px-1 py-3">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="text-xs font-medium text-foreground truncate">{inc.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {inc.incident_type}
                        {inc.related_entity_type ? ` · ${inc.related_entity_type}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SeverityBadge severity={inc.severity} />
                      <Badge variant="outline" className="text-[10px] capitalize">{inc.status}</Badge>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {(() => { const _d = new Date(inc.created_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}-${_d.getUTCFullYear()}` })()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Explainability Drawer */}
      <ExplainabilityDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Event Details"
        explainability={
          drawerEvent
            ? {
                summary:              drawerEvent.event_type
                  ? `${drawerEvent.event_type} — review recommended for ${drawerEvent.entity_type} ${drawerEvent.entity_id}`
                  : undefined,
                contributing_factors: (drawerEvent.governance_context as any)?.compliance_flags as string[] | undefined,
                recommended_actions:  ['Review the flagged record', 'Verify with HR admin'],
              }
            : undefined
        }
      />
    </PageContainer>
  )
}
