/**
 * EnterpriseControlCenter — /admin/enterprise
 *
 * Unified enterprise intelligence console for admin-only audiences:
 * enterprise admins, compliance teams, operational leadership, investigations.
 *
 * 6 tabs — all queries lazy (enabled only when tab is active):
 *   1. Governance     — compliance alerts, risk summary, incidents, event timeline
 *   2. Trust & Identity — trust scores, verifications, duplicates, regulatory pipeline
 *   3. Operations     — domain health, SLA breaches, security signals, heatmap
 *   4. Security       — high/critical security signals, platform health, queue status
 *   5. Audit & Replay — decision lineage, replay sessions, audit statistics
 *   6. Intelligence   — fabric health, event clusters, knowledge entries
 *
 * Design: progressive disclosure, compact density, ExplainabilityDrawer on click.
 */

import { useState }               from 'react'
import { useQuery }               from '@tanstack/react-query'
import {
  ShieldCheck, AlertTriangle, Activity, Lock,
  RotateCcw, Brain, ChevronRight,
  CheckCircle2, BookOpen, Cpu,
  BarChart3, Server, Zap, AlertCircle, Loader2,
} from 'lucide-react'
import { PageContainer }          from '@/components/layout/PageContainer'
import { PageHeader }             from '@/components/layout/PageHeader'
import { SectionCard }            from '@/components/layout/SectionCard'
import { Badge }                  from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  SeverityBadge,
  RiskIndicator,
  HealthIndicator,
  ExplainabilityDrawer,
  IntelligenceCard,
  UnifiedTimeline,
  IntelligenceEmptyState,
  IntelligenceLoadingSkeleton,
  OperationalSummary,
} from '@/components/ui/intelligence/index.js'
import { api }                    from '@/lib/api/client'
import { cn }                     from '@/lib/utils'

// ── Shared local types ────────────────────────────────────────────────────────

interface Explainability {
  summary?:              string
  confidence_score?:     number
  contributing_factors?: string[]
  recommended_actions?:  string[]
}

interface DrawerItem {
  title:       string
  timestamp?:  string
  explainability?: Explainability
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString() } catch { return iso }
}

function truncateId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

/** Humanize an entity_type token, e.g. "payroll_run" → "Payroll Run". */
function humanizeType(t?: string | null): string {
  return (t ?? 'record').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * User-facing label for an entity reference — NEVER a raw UUID.
 * Prefers a resolved name from the API, falling back to the humanized type.
 */
function entityLabel(e: { entity_type?: string | null; entity_name?: string | null }): string {
  return e.entity_name ?? humanizeType(e.entity_type)
}

function ScoreBar({ score, severity, invert = false }: { score: number; severity?: string; invert?: boolean }) {
  const colour = invert
    ? (score >= 75 ? 'bg-destructive' : score >= 50 ? 'bg-warning' : 'bg-success')
    : (severity === 'critical' ? 'bg-destructive'
      : severity === 'high'    ? 'bg-accent-coral'
      : severity === 'warning' ? 'bg-warning'
      : score >= 75            ? 'bg-success'
      : score >= 50            ? 'bg-warning'
      : 'bg-destructive')
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', colour)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(score)}</span>
    </div>
  )
}

// ── Types per domain ──────────────────────────────────────────────────────────

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
  governance_context?: { compliance_flags?: string[]; risk_score?: number }
}

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
}

interface TrustScore {
  id:          string
  entity_id:   string
  entity_type: string
  score_type:  string
  score:       number
  severity:    string
  factors:     string[]
  computed_at: string
  explainability?: Explainability
}

interface VerificationEvent {
  id:                string
  entity_id:         string
  verification_type: string
  status:            string
  score:             number
  flags:             string[]
  verified_at:       string
  explainability?:   Explainability
}

interface DuplicateEvent {
  id:                  string
  entity_id:           string
  duplicate_type:      string
  matching_entity_ids: string[]
  severity:            string
  detected_at:         string
  explainability?:     Explainability
}

interface ComplianceRevision {
  id:             string
  revision_type:  string
  jurisdiction:   string
  title:          string
  description:    string
  effective_from: string
  status:         string
  ingested_at:    string
  explainability?: Explainability
}

interface DomainHealthSignal {
  domain:      string
  score:       number
  severity:    'healthy' | 'warning' | 'critical' | string
  factors:     string[]
  computed_at: string
  explainability?: Explainability
}

interface SlaBreachEvent {
  sla_id:          string
  entity_id:       string
  entity_type:     string
  breach_severity: string
  description:     string
  breached_at:     string
  explainability?: Explainability
}

interface SecuritySignal {
  signal_type:   string
  entity_id:     string
  entity_type:   string
  severity:      string
  description:   string
  detected_at:   string
  explainability?: Explainability
}

interface HeatmapCell {
  dimension_id:    string
  dimension_label: string
  value:           number
  severity:        string
  event_count:     number
}

interface FabricHealthSnapshot {
  overall_score:         number
  governance_health:     number
  trust_health:          number
  operational_health:    number
  security_health:       number
  active_orchestrations: number
  pending_slas:          number
  open_incidents:        number
  computed_at:           string
  explainability?:       Explainability
}

interface DecisionGraphNode {
  node_id:     string
  node_type:   string
  entity_id:   string
  entity_type: string
  description: string
  timestamp:   string
  actor_id?:   string
  explainability?: Explainability
}

interface ReplaySession {
  id?:             string
  entity_id:       string
  entity_type:     string
  replay_from:     string
  replay_to:       string
  events_replayed: number
  status:          string
  created_at?:     string
}

interface AuditStats {
  total_events:    number
  events_today:    number
  critical_count:  number
  modules_covered: number
}

interface EventCluster {
  cluster_id:  string
  event_type:  string
  count:       number
  severity:    string
  first_seen:  string
  last_seen:   string
}

interface KnowledgeEntry {
  key:            string
  domain:         string
  title:          string
  content:        string
  tags:           string[]
  effective_from: string
  source?:        string
}

// ── Platform health / enterprise types ───────────────────────────────────────

interface EnterpriseHealth {
  status:       string
  latency_ms?:  number
  services?:    Array<{ name: string; status: string }>
}

interface QueueStatus {
  queue_depth:     number
  listeners:       number
  dead_letter:     number
  processing_rate: number
  listeners_detail?: Array<{ name: string; active: boolean; lag: number }>
}

// ── Tab 1: Governance ─────────────────────────────────────────────────────────

function GovernanceTab({ onDrawerOpen }: { onDrawerOpen: (item: DrawerItem) => void }) {
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['enterprise-control-governance', 'alerts'],
    queryFn:  () => api.get<{ alerts: PlatformEvent[] }>('/governance/compliance/alerts'),
  })

  const { data: riskData, isLoading: riskLoading } = useQuery({
    queryKey: ['enterprise-control-governance', 'risk'],
    queryFn:  () => api.get<{ risks: RiskEntity[] }>('/governance/risk/summary'),
  })

  const { data: incidentsData, isLoading: incidentsLoading } = useQuery({
    queryKey: ['enterprise-control-governance', 'incidents'],
    queryFn:  () => api.get<{ incidents: Incident[] }>('/governance/incidents'),
  })

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['enterprise-control-governance', 'events'],
    queryFn:  () => api.get<{ events: PlatformEvent[] }>('/governance/events?limit=20'),
  })

  const alerts    = alertsData?.alerts    ?? []
  const risks     = riskData?.risks       ?? []
  const incidents = incidentsData?.incidents ?? []
  const rawEvents = eventsData?.events    ?? []

  // Map to UnifiedTimeline format
  const timelineEvents = rawEvents.map(ev => ({
    id:          ev.event_id ?? ev.id ?? ev.entity_id,
    timestamp:   ev.timestamp,
    title:       ev.event_type,
    description: entityLabel(ev),
    severity:    ev.severity,
    module:      ev.module,
  }))

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <OperationalSummary
        loading={alertsLoading && riskLoading && incidentsLoading}
        items={[
          { label: 'Active Alerts',  value: alerts.length,    severity: alerts.some(a => a.severity === 'critical') ? 'critical' : alerts.length > 0 ? 'warning' : 'info' },
          { label: 'Risk Signals',   value: risks.length,     severity: risks.some(r => r.severity === 'critical') ? 'critical' : 'info' },
          { label: 'Open Incidents', value: incidents.length, severity: incidents.length > 0 ? 'warning' : 'info' },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Compliance Alerts */}
        <SectionCard title="Compliance Alerts" description="High and critical severity governance events">
          {alertsLoading
            ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
            : alerts.length === 0
            ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-success">
                <CheckCircle2 className="h-7 w-7 opacity-60" />
                <p className="text-sm font-medium">No active compliance alerts</p>
              </div>
            )
            : (
              <div className="divide-y divide-border">
                {alerts.map((al, i) => (
                  <button
                    key={al.event_id ?? al.id ?? i}
                    className="w-full flex items-center gap-3 py-2.5 hover:bg-muted/40 transition-colors text-left group"
                    onClick={() => onDrawerOpen({
                      title: al.event_type,
                      timestamp: al.timestamp,
                      explainability: {
                        summary: `${al.event_type} — ${entityLabel(al)}`,
                        contributing_factors: al.governance_context?.compliance_flags,
                      },
                    })}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono font-medium truncate">{al.event_type}</p>
                      <p className="text-xs text-muted-foreground truncate">{entityLabel(al)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <SeverityBadge severity={al.severity ?? 'high'} />
                      <span className="text-[10px] text-muted-foreground">{fmtTime(al.timestamp)}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </SectionCard>

        {/* Risk Summary */}
        <SectionCard title="Risk Summary" description="Top risk signals by entity">
          {riskLoading
            ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
            : risks.length === 0
            ? <IntelligenceEmptyState icon={<BarChart3 className="h-7 w-7" />} title="No risk signals detected" />
            : (
              <div className="divide-y divide-border">
                {risks.slice(0, 8).map((r, i) => (
                  <div key={`${r.entity_type}:${r.entity_id}:${i}`} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium capitalize">{r.entity_type}</p>
                      <p className="text-xs text-muted-foreground truncate">{entityLabel(r)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ScoreBar score={r.score} severity={r.severity} />
                      <RiskIndicator score={r.score} />
                      <SeverityBadge severity={r.severity} />
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </SectionCard>
      </div>

      {/* Open Incidents */}
      <SectionCard title="Open Incidents" description="Active governance incidents">
        {incidentsLoading
          ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-10" />
          : incidents.length === 0
          ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-success">
              <CheckCircle2 className="h-7 w-7 opacity-60" />
              <p className="text-sm font-medium">No open incidents</p>
            </div>
          )
          : (
            <div className="divide-y divide-border">
              {incidents.map(inc => (
                <IntelligenceCard
                  key={inc.id}
                  title={inc.title}
                  subtitle={inc.incident_type + (inc.related_entity_type ? ` · ${inc.related_entity_type}` : '')}
                  severity={inc.severity}
                  meta={[
                    { label: 'Status',  value: inc.status },
                    { label: 'Created', value: fmtDate(inc.created_at) },
                  ]}
                  onClick={() => onDrawerOpen({ title: inc.title, timestamp: inc.created_at })}
                  className="my-1 border-0 rounded-none"
                />
              ))}
            </div>
          )
        }
      </SectionCard>

      {/* Event Timeline */}
      <SectionCard title="Platform Event Timeline" description="Last 20 governance events">
        <UnifiedTimeline
          events={timelineEvents}
          loading={eventsLoading}
          onEventClick={ev => onDrawerOpen({ title: ev.title, timestamp: ev.timestamp })}
          emptyMessage="No governance events recorded yet."
        />
      </SectionCard>
    </div>
  )
}

// ── Tab 2: Trust & Identity ───────────────────────────────────────────────────

function TrustTab({ onDrawerOpen }: { onDrawerOpen: (item: DrawerItem) => void }) {
  const { data: scoresData, isLoading: scoresLoading } = useQuery({
    queryKey: ['enterprise-control-trust', 'scores'],
    queryFn:  () => api.get<{ scores: TrustScore[] }>('/trust/scores?limit=30'),
  })

  const { data: verificationsData, isLoading: verificationsLoading } = useQuery({
    queryKey: ['enterprise-control-trust', 'verifications'],
    queryFn:  () => api.get<{ verifications: VerificationEvent[] }>('/trust/verifications?limit=30'),
  })

  const { data: duplicatesData, isLoading: duplicatesLoading } = useQuery({
    queryKey: ['enterprise-control-trust', 'duplicates'],
    queryFn:  () => api.get<{ duplicates: DuplicateEvent[] }>('/trust/duplicates?limit=30'),
  })

  const { data: regulatoryData, isLoading: regulatoryLoading } = useQuery({
    queryKey: ['enterprise-control-trust', 'regulatory'],
    queryFn:  () => api.get<{ revisions: ComplianceRevision[] }>('/trust/regulatory/pending'),
  })

  const { data: verStatsData, isLoading: verStatsLoading } = useQuery({
    queryKey: ['enterprise-control-trust', 'ver-stats'],
    queryFn:  () => api.get<{
      verified: number; pending: number; degraded: number; needs_review: number
      retry_queue?: { pending: number }
    }>('/trust/verifications/stats'),
  })

  const { data: integrationsData, isLoading: integrationsLoading } = useQuery({
    queryKey: ['enterprise-control-trust', 'integrations'],
    queryFn:  () => api.get<{ providers: Record<string, string> }>('/integrations/status'),
  })

  const scores     = scoresData?.scores     ?? []
  const verifications = verificationsData?.verifications ?? []
  const duplicates = duplicatesData?.duplicates ?? []
  const revisions  = regulatoryData?.revisions  ?? []

  const lowTrust = scores.filter(s => s.score < 80)

  return (
    <div className="space-y-4">
      <OperationalSummary
        loading={scoresLoading && verificationsLoading && duplicatesLoading}
        items={[
          { label: 'Low Trust',      value: lowTrust.length,        severity: lowTrust.length > 0 ? 'warning' : 'info' },
          { label: 'Verifications',  value: verifications.length,   severity: 'info' },
          { label: 'Duplicates',     value: duplicates.length,      severity: duplicates.length > 0 ? 'high' : 'info' },
          { label: 'Pending Review', value: revisions.length,       severity: revisions.length > 0 ? 'warning' : 'info' },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trust Scores */}
        <SectionCard title="Trust Signals" description="Employees with lowest trust scores">
          {scoresLoading
            ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-14" />
            : lowTrust.length === 0
            ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-success">
                <CheckCircle2 className="h-7 w-7 opacity-60" />
                <p className="text-sm font-medium">All trust scores are healthy</p>
              </div>
            )
            : (
              <div className="divide-y divide-border">
                {lowTrust.slice(0, 8).map(s => (
                  <button
                    key={s.id}
                    className="w-full text-left py-2.5 hover:bg-muted/30 transition-colors group"
                    onClick={() => onDrawerOpen({
                      title:         `Trust ${s.score}/100 — ${entityLabel(s)}`,
                      timestamp:     s.computed_at,
                      explainability: s.explainability,
                    })}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{entityLabel(s)}</span>
                          <Badge variant="outline" className="text-xs capitalize">{s.score_type}</Badge>
                        </div>
                        <ScoreBar score={s.score} severity={s.severity} />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <RiskIndicator score={s.score} />
                        <SeverityBadge severity={s.severity} />
                        <ChevronRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </SectionCard>

        {/* Verifications */}
        <SectionCard title="Verification Checks" description="Recent identity verification events">
          {verificationsLoading
            ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
            : verifications.length === 0
            ? <IntelligenceEmptyState icon={<ShieldCheck className="h-7 w-7" />} title="No verification events" />
            : (
              <div className="divide-y divide-border">
                {verifications.slice(0, 8).map(v => (
                  <button
                    key={v.id}
                    className="w-full text-left py-2.5 hover:bg-muted/30 transition-colors"
                    onClick={() => onDrawerOpen({
                      title:         `${v.verification_type} — ${(v as { entity_name?: string }).entity_name ?? '—'}`,
                      timestamp:     v.verified_at,
                      explainability: v.explainability,
                    })}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-xs text-muted-foreground">{(v as { entity_name?: string }).entity_name ?? '—'}</span>
                        <span className="mx-1.5 text-muted-foreground">·</span>
                        <span className="text-xs capitalize">{v.verification_type.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          variant={v.status === 'verified' ? 'default' : v.status === 'failed' ? 'destructive' : 'outline'}
                          className="text-xs capitalize"
                        >
                          {v.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{fmtTime(v.verified_at)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Duplicates */}
        <SectionCard title="Duplicate Alerts" description="Workforce identity duplication signals">
          {duplicatesLoading
            ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-10" />
            : duplicates.length === 0
            ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-success">
                <CheckCircle2 className="h-7 w-7 opacity-60" />
                <p className="text-sm font-medium">No duplicate alerts</p>
              </div>
            )
            : (
              <div className="divide-y divide-border">
                {duplicates.slice(0, 6).map(d => (
                  <button
                    key={d.id}
                    className="w-full text-left py-2.5 hover:bg-muted/30 transition-colors"
                    onClick={() => onDrawerOpen({
                      title:         `Duplicate ${d.duplicate_type} — ${(d as { entity_name?: string }).entity_name ?? '—'}`,
                      timestamp:     d.detected_at,
                      explainability: d.explainability,
                    })}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{(d as { entity_name?: string }).entity_name ?? '—'}</span>
                        <Badge variant="outline" className="text-xs capitalize">{d.duplicate_type.replace(/_/g, ' ')}</Badge>
                        <span className="text-xs text-muted-foreground">{d.matching_entity_ids.length + 1} affected</span>
                      </div>
                      <SeverityBadge severity={d.severity} />
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </SectionCard>

        {/* Regulatory */}
        <SectionCard title="Regulatory Pipeline" description="Pending compliance revisions awaiting review">
          {regulatoryLoading
            ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-14" />
            : revisions.length === 0
            ? <IntelligenceEmptyState icon={<BookOpen className="h-7 w-7" />} title="No pending revisions" />
            : (
              <div className="divide-y divide-border">
                {revisions.map(r => (
                  <button
                    key={r.id}
                    className="w-full text-left py-2.5 hover:bg-muted/30 transition-colors"
                    onClick={() => onDrawerOpen({
                      title:         r.title,
                      timestamp:     r.ingested_at,
                      explainability: r.explainability,
                    })}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <Badge variant="outline" className="text-xs capitalize">{r.revision_type.replace(/_/g, ' ')}</Badge>
                          <Badge variant="secondary" className="text-xs">{r.jurisdiction}</Badge>
                        </div>
                        <p className="text-xs font-medium truncate">{r.title}</p>
                        <p className="text-xs text-muted-foreground">Effective: {r.effective_from}</p>
                      </div>
                      <Badge variant="outline" className="capitalize text-xs shrink-0">{r.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </SectionCard>
      </div>

      {/* Verification Operations */}
      <SectionCard title="Verification Operations" description="Provider status and verification queue summary">
        {(verStatsLoading || integrationsLoading)
          ? <IntelligenceLoadingSkeleton rows={2} cardHeight="h-10" />
          : (
            <div className="space-y-3">
              {/* Metric row */}
              {verStatsData && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="rounded-lg border bg-muted/10 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">Verified</p>
                    <p className="text-lg font-bold text-success">{verStatsData.verified}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">Pending</p>
                    <p className="text-lg font-bold text-muted-foreground">{verStatsData.pending}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">Degraded</p>
                    <p className="text-lg font-bold text-warning">{verStatsData.degraded}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">Need Review</p>
                    <p className="text-lg font-bold text-warning">{verStatsData.needs_review}</p>
                  </div>
                </div>
              )}

              {/* Provider status pills */}
              {integrationsData?.providers && (() => {
                const PAN_BANK_PROVIDERS = ['surepass_pan', 'decentro_pan', 'signzy_pan', 'razorpay_ifsc']
                const PROVIDER_LABELS: Record<string, string> = {
                  surepass_pan: 'PAN',
                  decentro_pan: 'PAN',
                  signzy_pan:   'PAN',
                  razorpay_ifsc: 'Bank Account',
                }
                const filtered = PAN_BANK_PROVIDERS.filter(p => integrationsData.providers![p] !== undefined)
                if (filtered.length === 0) return null
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {filtered.map(p => {
                      const status = integrationsData.providers![p]
                      const isActive = status === 'active'
                      return (
                        <span
                          key={p}
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                            isActive ? 'bg-success/10 text-success' : 'bg-muted/40 text-muted-foreground'
                          )}
                        >
                          {PROVIDER_LABELS[p] ?? p}
                        </span>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Retry queue */}
              {verStatsData?.retry_queue?.pending != null && verStatsData.retry_queue.pending > 0 && (
                <p className="text-xs text-warning">
                  {verStatsData.retry_queue.pending} pending {verStatsData.retry_queue.pending === 1 ? 'retry' : 'retries'} in queue
                </p>
              )}
            </div>
          )
        }
      </SectionCard>
    </div>
  )
}

// ── Tab 3: Operations ─────────────────────────────────────────────────────────

function OperationsTab({ onDrawerOpen }: { onDrawerOpen: (item: DrawerItem) => void }) {
  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ['enterprise-control-operations', 'health'],
    queryFn:  () => api.get<{ signals: DomainHealthSignal[] }>('/operations/health'),
  })

  const { data: slaData, isLoading: slaLoading } = useQuery({
    queryKey: ['enterprise-control-operations', 'sla'],
    queryFn:  () => api.get<{ breaches: SlaBreachEvent[] }>('/operations/sla/breaches'),
  })

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery({
    queryKey: ['enterprise-control-operations', 'heatmap'],
    queryFn:  () => api.get<{ cells: HeatmapCell[] }>('/operations/heatmaps'),
  })

  const signals  = healthData?.signals  ?? []
  const breaches = slaData?.breaches    ?? []
  const cells    = heatmapData?.cells   ?? []

  return (
    <div className="space-y-4">
      <OperationalSummary
        loading={healthLoading && slaLoading}
        items={[
          { label: 'Healthy Domains',  value: signals.filter(s => s.severity === 'healthy').length,  severity: 'info' },
          { label: 'Warning Domains',  value: signals.filter(s => s.severity === 'warning').length,  severity: signals.some(s => s.severity === 'warning') ? 'warning' : 'info' },
          { label: 'Critical Domains', value: signals.filter(s => s.severity === 'critical').length, severity: signals.some(s => s.severity === 'critical') ? 'critical' : 'info' },
          { label: 'SLA Breaches',     value: breaches.length,                                        severity: breaches.length > 0 ? 'high' : 'info' },
        ]}
      />

      {/* Domain Health */}
      <SectionCard title="Domain Health" description="Real-time operational health scores">
        {healthLoading
          ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-24" />
          : signals.length === 0
          ? <IntelligenceEmptyState icon={<Activity className="h-7 w-7" />} title="No health signals available" />
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {signals.map(s => (
                <button
                  key={s.domain}
                  className="text-left rounded-lg border p-3 hover:bg-muted/30 transition-colors space-y-2"
                  onClick={() => onDrawerOpen({
                    title:         `${s.domain} health`,
                    timestamp:     s.computed_at,
                    explainability: s.explainability,
                  })}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium capitalize">{s.domain}</span>
                    <HealthIndicator score={s.score} signal={s.severity} />
                  </div>
                  <ScoreBar score={s.score} severity={s.severity === 'healthy' ? undefined : s.severity} />
                  {s.factors.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">{s.factors[0]}</p>
                  )}
                </button>
              ))}
            </div>
          )
        }
      </SectionCard>

      {/* SLA Breaches */}
      <SectionCard title="SLA Breach Events" description="Items that have exceeded their SLA threshold">
        {slaLoading
          ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-10" />
          : breaches.length === 0
          ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-success">
              <CheckCircle2 className="h-7 w-7 opacity-60" />
              <p className="text-sm font-medium">No SLA breaches</p>
            </div>
          )
          : (
            <div className="divide-y divide-border">
              {breaches.map((b, i) => (
                <button
                  key={i}
                  className="w-full text-left py-2.5 hover:bg-muted/30 transition-colors"
                  onClick={() => onDrawerOpen({
                    title:         b.description,
                    timestamp:     b.breached_at,
                    explainability: b.explainability,
                  })}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{b.description}</p>
                      <p className="text-xs text-muted-foreground">{b.entity_type} · {fmtDate(b.breached_at)}</p>
                    </div>
                    <SeverityBadge severity={b.breach_severity} />
                  </div>
                </button>
              ))}
            </div>
          )
        }
      </SectionCard>

      {/* Heatmap preview */}
      <SectionCard title="Risk Heatmap" description="Top risk entities across all domains">
        {heatmapLoading
          ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
          : cells.length === 0
          ? <IntelligenceEmptyState icon={<BarChart3 className="h-7 w-7" />} title="No heatmap data" />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left font-medium pb-2 pr-4">Entity</th>
                    <th className="text-left font-medium pb-2 pr-4">Risk Score</th>
                    <th className="text-left font-medium pb-2 pr-4">Severity</th>
                    <th className="text-left font-medium pb-2">Events</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cells.slice(0, 8).map(cell => (
                    <tr key={cell.dimension_id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2 pr-4 font-mono">{cell.dimension_label}</td>
                      <td className="py-2 pr-4"><ScoreBar score={cell.value} invert /></td>
                      <td className="py-2 pr-4"><SeverityBadge severity={cell.severity} /></td>
                      <td className="py-2 text-muted-foreground tabular-nums">{cell.event_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </SectionCard>
    </div>
  )
}

// ── Tab 4: Security ───────────────────────────────────────────────────────────

function SecurityTab({ onDrawerOpen }: { onDrawerOpen: (item: DrawerItem) => void }) {
  const { data: signalsData, isLoading: signalsLoading } = useQuery({
    queryKey: ['enterprise-control-security', 'signals'],
    queryFn:  () => api.get<{ signals: SecuritySignal[] }>('/operations/security/signals'),
  })

  const { data: platformHealth, isLoading: platformLoading } = useQuery({
    queryKey: ['enterprise-control-security', 'platform-health'],
    queryFn:  () => api.get<EnterpriseHealth>('/enterprise/health'),
  })

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['enterprise-control-security', 'queue'],
    queryFn:  () => api.get<QueueStatus>('/enterprise/queue'),
  })

  const signals = signalsData?.signals ?? []
  const highCritical = signals.filter(s => s.severity === 'high' || s.severity === 'critical')

  return (
    <div className="space-y-4">
      {/* Platform health summary */}
      <OperationalSummary
        loading={platformLoading && queueLoading && signalsLoading}
        items={[
          { label: 'Platform Status',  value: platformHealth?.status ?? '—',       severity: platformHealth?.status === 'healthy' ? 'info' : 'warning' },
          { label: 'Security Signals', value: signals.length,                       severity: signals.length > 0 ? 'warning' : 'info' },
          { label: 'High/Critical',    value: highCritical.length,                  severity: highCritical.length > 0 ? 'critical' : 'info' },
          { label: 'Queue Depth',      value: queueData?.queue_depth ?? '—',        severity: (queueData?.queue_depth ?? 0) > 100 ? 'warning' : 'info' },
          { label: 'Dead Letter',      value: queueData?.dead_letter ?? '—',        severity: (queueData?.dead_letter ?? 0) > 0 ? 'high' : 'info' },
        ]}
      />

      {/* High/Critical signals */}
      <SectionCard title="Security Intelligence" description="High and critical behavioral anomaly signals">
        {signalsLoading
          ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-14" />
          : highCritical.length === 0
          ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-success">
              <CheckCircle2 className="h-7 w-7 opacity-60" />
              <p className="text-sm font-medium">No high or critical security signals</p>
            </div>
          )
          : (
            <div className="divide-y divide-border">
              {highCritical.map((s, i) => (
                <IntelligenceCard
                  key={i}
                  title={s.description}
                  subtitle={`${s.signal_type.replace(/_/g, ' ')} · ${entityLabel(s)}`}
                  severity={s.severity}
                  meta={[{ label: 'Type', value: s.entity_type }, { label: 'Detected', value: fmtTime(s.detected_at) }]}
                  onClick={() => onDrawerOpen({
                    title:         s.description,
                    timestamp:     s.detected_at,
                    explainability: s.explainability,
                  })}
                  className="my-1 border-0 rounded-none"
                />
              ))}
            </div>
          )
        }
      </SectionCard>

      {/* All signals list */}
      {signals.length > highCritical.length && (
        <SectionCard title="All Security Signals" description="Complete security signal log">
          <div className="divide-y divide-border">
            {signals.filter(s => s.severity !== 'high' && s.severity !== 'critical').slice(0, 6).map((s, i) => (
              <button
                key={i}
                className="w-full text-left py-2.5 hover:bg-muted/30 transition-colors"
                onClick={() => onDrawerOpen({
                  title:         s.description,
                  timestamp:     s.detected_at,
                  explainability: s.explainability,
                })}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Badge variant="outline" className="text-xs font-mono mb-0.5">{s.signal_type.replace(/_/g, ' ')}</Badge>
                    <p className="text-xs truncate">{s.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SeverityBadge severity={s.severity} />
                    <span className="text-[10px] text-muted-foreground">{fmtTime(s.detected_at)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Listener health */}
      {queueData?.listeners_detail && queueData.listeners_detail.length > 0 && (
        <SectionCard title="Queue Listener Health" description="Event listener status and consumer lag">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left font-medium pb-2 pr-4">Listener</th>
                  <th className="text-left font-medium pb-2 pr-4">Status</th>
                  <th className="text-left font-medium pb-2">Lag</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {queueData.listeners_detail.map((l, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="py-2 pr-4 font-mono">{l.name}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={l.active ? 'default' : 'destructive'} className="text-xs">
                        {l.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-2 tabular-nums">{l.lag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Tab 5: Audit & Replay ─────────────────────────────────────────────────────

function AuditReplayTab({ onDrawerOpen }: { onDrawerOpen: (item: DrawerItem) => void }) {
  const { data: decisionsData, isLoading: decisionsLoading } = useQuery({
    queryKey: ['enterprise-control-audit', 'decisions'],
    queryFn:  () => api.get<{ nodes: DecisionGraphNode[] }>('/fabric/decisions?limit=50'),
  })

  const { data: replayData, isLoading: replayLoading } = useQuery({
    queryKey: ['enterprise-control-audit', 'replays'],
    queryFn:  () => api.get<{ sessions: ReplaySession[] }>('/fabric/replay/sessions?limit=20'),
  })

  const { data: auditStats, isLoading: statsLoading } = useQuery({
    queryKey: ['enterprise-control-audit', 'stats'],
    queryFn:  () => api.get<AuditStats>('/enterprise/audit/stats'),
  })

  const { data: clustersData, isLoading: clustersLoading } = useQuery({
    queryKey: ['enterprise-control-audit', 'clusters'],
    queryFn:  () => api.get<{ clusters: EventCluster[] }>('/observability/clusters'),
  })

  const nodes    = decisionsData?.nodes    ?? []
  const sessions = replayData?.sessions    ?? []
  const clusters = clustersData?.clusters  ?? []

  // Map decision nodes to UnifiedTimeline format
  const decisionEvents = nodes.map(n => ({
    id:          n.node_id,
    timestamp:   n.timestamp,
    title:       n.description,
    description: `${n.node_type} · ${n.entity_type}`,
    module:      n.actor_id ? n.actor_id.slice(0, 8) : undefined,
  }))

  return (
    <div className="space-y-4">
      {/* Audit stats */}
      <OperationalSummary
        loading={statsLoading}
        items={[
          { label: 'Total Events',      value: auditStats?.total_events    ?? '—', severity: 'info' },
          { label: 'Events Today',      value: auditStats?.events_today    ?? '—', severity: 'info' },
          { label: 'Critical Events',   value: auditStats?.critical_count  ?? '—', severity: (auditStats?.critical_count ?? 0) > 0 ? 'critical' : 'info' },
          { label: 'Modules Covered',   value: auditStats?.modules_covered ?? '—', severity: 'info' },
        ]}
      />

      {/* Decision Lineage */}
      <SectionCard title="Decision Lineage" description="Recent platform decision graph nodes">
        <UnifiedTimeline
          events={decisionEvents}
          loading={decisionsLoading}
          onEventClick={ev => {
            const node = nodes.find(n => n.node_id === ev.id)
            onDrawerOpen({
              title:         ev.title,
              timestamp:     ev.timestamp,
              explainability: node?.explainability,
            })
          }}
          emptyMessage="No decision nodes recorded yet."
        />
      </SectionCard>

      {/* Replay Sessions */}
      <SectionCard title="Replay Sessions" description="Recent event replay session history">
        {replayLoading
          ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
          : sessions.length === 0
          ? <IntelligenceEmptyState icon={<RotateCcw className="h-7 w-7" />} title="No replay sessions yet" />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left font-medium pb-2 pr-4">Entity</th>
                    <th className="text-left font-medium pb-2 pr-4">Type</th>
                    <th className="text-left font-medium pb-2 pr-4">Events</th>
                    <th className="text-left font-medium pb-2 pr-4">Status</th>
                    <th className="text-left font-medium pb-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sessions.map((s, i) => (
                    <tr key={s.id ?? i} className="hover:bg-muted/20">
                      <td className="py-2 pr-4">{entityLabel(s)}</td>
                      <td className="py-2 pr-4 capitalize">{s.entity_type}</td>
                      <td className="py-2 pr-4 tabular-nums">{s.events_replayed}</td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={s.status === 'completed' ? 'outline' : s.status === 'failed' ? 'destructive' : 'default'}
                          className="text-xs capitalize"
                        >
                          {s.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {s.created_at ? fmtDate(s.created_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </SectionCard>

      {/* Event Clusters */}
      <SectionCard title="Event Clusters" description="Platform event frequency clustering">
        {clustersLoading
          ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-10" />
          : clusters.length === 0
          ? <IntelligenceEmptyState icon={<Activity className="h-7 w-7" />} title="No event clusters" />
          : (
            <div className="divide-y divide-border">
              {clusters.slice(0, 8).map(c => (
                <div key={c.cluster_id} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate">{c.event_type}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtTime(c.last_seen)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs tabular-nums font-medium">{c.count}×</span>
                    <SeverityBadge severity={c.severity} />
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </SectionCard>
    </div>
  )
}

// ── Tab 6: Intelligence ───────────────────────────────────────────────────────

function IntelligenceTab({ onDrawerOpen }: { onDrawerOpen: (item: DrawerItem) => void }) {
  const { data: fabricHealth, isLoading: fabricLoading } = useQuery({
    queryKey: ['enterprise-control-intelligence', 'fabric-health'],
    queryFn:  () => api.get<FabricHealthSnapshot>('/fabric/health'),
  })

  const { data: clustersData, isLoading: clustersLoading } = useQuery({
    queryKey: ['enterprise-control-intelligence', 'clusters'],
    queryFn:  () => api.get<{ clusters: EventCluster[] }>('/observability/clusters'),
  })

  const { data: knowledgeData, isLoading: knowledgeLoading } = useQuery({
    queryKey: ['enterprise-control-intelligence', 'knowledge'],
    queryFn:  () => api.get<{ entries: KnowledgeEntry[] }>('/fabric/knowledge'),
  })

  const clusters = clustersData?.clusters ?? []
  const entries  = knowledgeData?.entries ?? []

  const healthScores = fabricHealth ? [
    { label: 'Overall',     value: `${fabricHealth.overall_score}`,     severity: fabricHealth.overall_score < 50 ? 'critical' : fabricHealth.overall_score < 75 ? 'warning' : 'info' as const },
    { label: 'Governance',  value: `${fabricHealth.governance_health}`,  severity: fabricHealth.governance_health < 50 ? 'critical' : 'info' as const },
    { label: 'Trust',       value: `${fabricHealth.trust_health}`,       severity: fabricHealth.trust_health < 50 ? 'critical' : 'info' as const },
    { label: 'Operations',  value: `${fabricHealth.operational_health}`, severity: fabricHealth.operational_health < 50 ? 'critical' : 'info' as const },
    { label: 'Security',    value: `${fabricHealth.security_health}`,    severity: fabricHealth.security_health < 50 ? 'critical' : 'info' as const },
    { label: 'Orchestrations', value: fabricHealth.active_orchestrations, severity: 'info' as const },
    { label: 'Pending SLAs',   value: fabricHealth.pending_slas,          severity: fabricHealth.pending_slas > 0 ? 'warning' : 'info' as const },
    { label: 'Open Incidents', value: fabricHealth.open_incidents,         severity: fabricHealth.open_incidents > 0 ? 'warning' : 'info' as const },
  ] : []

  return (
    <div className="space-y-4">
      {/* Fabric Health */}
      <SectionCard title="Fabric Health Snapshot" description="Cross-domain intelligence health scores">
        {fabricLoading
          ? <IntelligenceLoadingSkeleton rows={2} cardHeight="h-12" />
          : fabricHealth
          ? (
            <>
              <OperationalSummary items={healthScores} />
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Governance Health',  score: fabricHealth.governance_health  },
                  { label: 'Trust Health',        score: fabricHealth.trust_health       },
                  { label: 'Operations Health',   score: fabricHealth.operational_health },
                  { label: 'Security Health',     score: fabricHealth.security_health    },
                ].map(item => (
                  <button
                    key={item.label}
                    className="text-left rounded-lg border p-3 hover:bg-muted/30 transition-colors space-y-1.5"
                    onClick={() => onDrawerOpen({
                      title:         item.label,
                      timestamp:     fabricHealth.computed_at,
                      explainability: fabricHealth.explainability,
                    })}
                  >
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <div className="flex items-center gap-2">
                      <HealthIndicator score={item.score} signal={item.score >= 75 ? 'healthy' : item.score >= 50 ? 'degraded' : 'critical'} />
                      <RiskIndicator score={item.score} />
                    </div>
                    <ScoreBar score={item.score} />
                  </button>
                ))}
              </div>
            </>
          )
          : <IntelligenceEmptyState icon={<Cpu className="h-7 w-7" />} title="No fabric health data" />
        }
      </SectionCard>

      {/* Event frequency clusters */}
      <SectionCard title="Event Frequency" description="Intelligence signal clustering by event type">
        {clustersLoading
          ? <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
          : clusters.length === 0
          ? <IntelligenceEmptyState icon={<Activity className="h-7 w-7" />} title="No event clusters" />
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {clusters.slice(0, 8).map(c => (
                <IntelligenceCard
                  key={c.cluster_id}
                  title={c.event_type}
                  subtitle={`${c.count} occurrences · last ${fmtTime(c.last_seen)}`}
                  severity={c.severity}
                />
              ))}
            </div>
          )
        }
      </SectionCard>

      {/* Knowledge entries */}
      <SectionCard title="Knowledge Layer" description="Enterprise knowledge base entries">
        {knowledgeLoading
          ? <IntelligenceLoadingSkeleton rows={3} cardHeight="h-14" />
          : entries.length === 0
          ? <IntelligenceEmptyState icon={<BookOpen className="h-7 w-7" />} title="No knowledge entries" />
          : (
            <div className="divide-y divide-border">
              {entries.slice(0, 8).map(entry => (
                <div key={entry.key} className="py-3 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs">{entry.domain}</Badge>
                    <span className="text-xs font-medium">{entry.title}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{entry.effective_from}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {entry.content.slice(0, 140)}{entry.content.length > 140 ? '…' : ''}
                  </p>
                  {entry.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {entry.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        }
      </SectionCard>
    </div>
  )
}

// ── Operational health card ───────────────────────────────────────────────────

interface PlatformMetrics {
  timestamp:  string
  event_bus:  { handler_count: number; total_emitted: number; total_failed: number; failure_rate_pct: number; status: string }
  queue:      { pending: number; running: number; completed_24h: number; dead_24h: number; retry_queue_size: number; stuck_jobs: number; status: string }
  webhooks:   { deliveries_24h: number; failed_24h: number; pending: number; status: string }
}

function StatusDot({ status }: { status: string }) {
  if (status === 'healthy')  return <span className="h-2 w-2 rounded-full bg-success inline-block" />
  if (status === 'warning')  return <span className="h-2 w-2 rounded-full bg-warning  inline-block" />
  return <span className="h-2 w-2 rounded-full bg-destructive inline-block" />
}

function OperationalHealthCard() {
  const { data, isLoading } = useQuery<PlatformMetrics>({
    queryKey:  ['enterprise-ops-metrics'],
    queryFn:   () => api.get('/metrics'),
    staleTime: 30_000,
    retry:     false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading platform health…
      </div>
    )
  }

  if (!data) return null

  const overallOk = data.event_bus.status === 'healthy'
    && data.queue.status !== 'degraded'
    && data.webhooks.status === 'healthy'

  const pills = [
    {
      icon:  <Server className="h-3 w-3" />,
      label: 'Queue',
      value: data.queue.pending > 0 ? `${data.queue.pending} pending` : 'idle',
      warn:  data.queue.stuck_jobs > 0 ? `${data.queue.stuck_jobs} stuck` : null,
      status: data.queue.status,
    },
    {
      icon:  <Zap className="h-3 w-3" />,
      label: 'Event Bus',
      value: `${data.event_bus.handler_count} listeners`,
      warn:  data.event_bus.total_failed > 0 ? `${data.event_bus.total_failed} failed` : null,
      status: data.event_bus.status,
    },
    {
      icon:  <Activity className="h-3 w-3" />,
      label: 'Webhooks',
      value: `${data.webhooks.deliveries_24h} delivered`,
      warn:  data.webhooks.failed_24h > 0 ? `${data.webhooks.failed_24h} failed` : null,
      status: data.webhooks.status,
    },
    {
      icon:  <RotateCcw className="h-3 w-3" />,
      label: 'Retry Queue',
      value: `${data.queue.retry_queue_size} jobs`,
      warn:  data.queue.dead_24h > 5 ? `${data.queue.dead_24h} dead` : null,
      status: data.queue.retry_queue_size > 10 ? 'warning' : 'healthy',
    },
  ]

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-2.5',
      overallOk ? 'border-border/50 bg-muted/10' : 'border-warning/40 bg-warning/5',
    )}>
      {/* Overall status badge */}
      <div className="flex items-center gap-1.5">
        {overallOk
          ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          : <AlertCircle  className="h-3.5 w-3.5 text-warning" />
        }
        <span className="text-xs font-semibold">
          {overallOk ? 'Platform healthy' : 'Platform degraded'}
        </span>
      </div>

      <div className="h-3 w-px bg-border hidden sm:block" />

      {/* Metric pills */}
      {pills.map(pill => (
        <div key={pill.label} className="flex items-center gap-1.5 text-xs">
          <StatusDot status={pill.status} />
          <span className="text-muted-foreground">{pill.label}</span>
          <span className="font-medium text-foreground">{pill.value}</span>
          {pill.warn && (
            <span className="text-warning font-medium">· {pill.warn}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EnterpriseControlCenter() {
  const [activeTab, setActiveTab] = useState('governance')
  const [drawerItem, setDrawerItem] = useState<DrawerItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  function openDrawer(item: DrawerItem) {
    setDrawerItem(item)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
  }

  const tabProps = { onDrawerOpen: openDrawer }

  return (
    <PageContainer>
      <PageHeader
        title="Enterprise Control Center"
        subtitle="Unified intelligence console — governance, trust, operations, security, and audit"
        breadcrumb={[{ label: 'Admin', href: '/admin/control-center' }, { label: 'Control Center' }]}
      />

      {/* Compact platform health banner — queue, event bus, webhook, retry status */}
      <OperationalHealthCard />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-9 flex-wrap gap-0.5">
          <TabsTrigger value="governance" className="gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" /> Governance
          </TabsTrigger>
          <TabsTrigger value="trust" className="gap-1.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5" /> Trust &amp; Identity
          </TabsTrigger>
          <TabsTrigger value="operations" className="gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" /> Operations
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5 text-xs">
            <Lock className="h-3.5 w-3.5" /> Security
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5 text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Audit &amp; Replay
          </TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-1.5 text-xs">
            <Brain className="h-3.5 w-3.5" /> Intelligence
          </TabsTrigger>
        </TabsList>

        {/* Tab context strip — one-line orientation for first-time users */}
        {(() => {
          const desc: Record<string, string> = {
            governance:   'Compliance alerts, risk incidents, and the platform event timeline.',
            trust:        'Employee trust scores, verification events, duplicate signals, and the regulatory pipeline.',
            operations:   'Domain health scores, SLA breaches, security signals, and the operational heatmap.',
            security:     'High and critical security signals, platform health status, and the job queue.',
            audit:        'Decision lineage, replay sessions, and a statistical view of audit activity.',
            intelligence: 'Fabric health, event clusters, and the knowledge layer.',
          }
          return desc[activeTab]
            ? <p className="text-[11.5px] text-muted-foreground/60 -mt-2 px-1">{desc[activeTab]}</p>
            : null
        })()}

        <TabsContent value="governance">
          {activeTab === 'governance' && <GovernanceTab {...tabProps} />}
        </TabsContent>

        <TabsContent value="trust">
          {activeTab === 'trust' && <TrustTab {...tabProps} />}
        </TabsContent>

        <TabsContent value="operations">
          {activeTab === 'operations' && <OperationsTab {...tabProps} />}
        </TabsContent>

        <TabsContent value="security">
          {activeTab === 'security' && <SecurityTab {...tabProps} />}
        </TabsContent>

        <TabsContent value="audit">
          {activeTab === 'audit' && <AuditReplayTab {...tabProps} />}
        </TabsContent>

        <TabsContent value="intelligence">
          {activeTab === 'intelligence' && <IntelligenceTab {...tabProps} />}
        </TabsContent>
      </Tabs>

      <ExplainabilityDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={drawerItem?.title ?? 'Intelligence Details'}
        explainability={drawerItem?.explainability}
      >
        {drawerItem?.timestamp && (
          <p className="text-xs text-muted-foreground mt-2">{fmtDate(drawerItem.timestamp)}</p>
        )}
      </ExplainabilityDrawer>
    </PageContainer>
  )
}
