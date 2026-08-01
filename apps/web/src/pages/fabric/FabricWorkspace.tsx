/**
 * FabricWorkspace — /admin/fabric
 *
 * Enterprise Orchestration Fabric — Sprint 5.
 * Unified intelligence workspace: health, composition, decisions, orchestration,
 * replay, and knowledge layer. READ-ONLY. Explainability drawer on row click.
 */

import { useState }                                            from 'react'
import { useQuery, useMutation, useQueryClient }               from '@tanstack/react-query'
import { toast }                                               from 'sonner'
import {
  Activity, GitBranch, Workflow,
  RotateCcw, BookOpen, ChevronRight,
  AlertTriangle, CheckCircle2, Info,
  Cpu, Search,
  Play, Clock,
} from 'lucide-react'
import { PageContainer }                                       from '@/components/layout/PageContainer'
import { PageHeader }                                          from '@/components/layout/PageHeader'
import { SectionCard }                                         from '@/components/layout/SectionCard'
import { MetricCard, MetricRow }                               from '@/components/dashboard/MetricCard'
import { Badge }                                               from '@/components/ui/badge'
import { Button }                                              from '@/components/ui/button'
import { Input }                                               from '@/components/ui/input'
import { Label }                                               from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger }            from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle }        from '@/components/ui/sheet'
import {
  ExplainabilityDrawer,
  IntelligenceLoadingSkeleton,
}                                                              from '@/components/ui/intelligence/index.js'
import { api }                                                 from '@/lib/api/client'
import { cn }                                                  from '@/lib/utils'
import { EmployeeSelector }                                    from '@/components/filters/EmployeeSelector'

// ── Local types ───────────────────────────────────────────────────────────────

interface Explainability {
  summary?:              string
  confidence_score?:     number
  contributing_factors?: string[]
  recommended_actions?:  string[]
}

interface FabricHealthSnapshot {
  tenant_id:                string
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

interface IntelligenceComposition {
  entity_id:          string
  entity_type:        string
  tenant_id:             string
  governance_score:   number
  trust_score:        number
  operational_health: number
  security_risk:      number
  composite_risk:     number
  severity:           string
  factors:            string[]
  computed_at:        string
  explainability?:    Explainability
}

interface DecisionGraphNode {
  node_id:     string
  node_type:   string
  entity_id:   string
  entity_type: string
  tenant_id:      string
  description: string
  timestamp:   string
  actor_id?:   string
  metadata?:   Record<string, unknown>
  explainability?: Explainability
}

interface OrchestrationStep {
  step_id:      string
  step_name:    string
  status:       string
  started_at?:  string
  completed_at?: string
}

interface OrchestrationActivity {
  activity_id:   string
  tenant_id:        string
  workflow_type: string
  entity_id:     string
  entity_type:   string
  status:        string
  steps:         OrchestrationStep[]
  started_at:    string
  completed_at?: string
  metadata?:     Record<string, unknown>
  explainability?: Explainability
}

interface ReplaySession {
  id?:             string
  tenant_id:          string
  entity_id:       string
  entity_type:     string
  replay_from:     string
  replay_to:       string
  events_replayed: number
  status:          string
  result_summary?: Record<string, unknown>
  created_at?:     string
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

interface ModuleDependency {
  from_module:     string
  to_module:       string
  dependency_type: string
  strength:        number
  description:     string
}

// ── Helper components ─────────────────────────────────────────────────────────

function severityColor(sev: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (sev === 'critical') return 'destructive'
  if (sev === 'high')     return 'destructive'
  if (sev === 'warning')  return 'secondary'
  return 'outline'
}

function scoreColor(score: number) {
  if (score >= 75) return 'text-success dark:text-success'
  if (score >= 50) return 'text-warning dark:text-warning'
  return 'text-destructive'
}

/** Humanize an entity_type token, e.g. "payroll_run" → "Payroll Run". */
function humanizeType(t?: string | null): string {
  return (t ?? 'record').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function ScoreBar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  // When invert=true, lower value is better (e.g. risk)
  const display = value ?? 0
  const color = invert
    ? (value <= 25 ? 'bg-success' : value <= 50 ? 'bg-warning' : 'bg-destructive')
    : (value >= 75 ? 'bg-success' : value >= 50 ? 'bg-warning' : 'bg-destructive')

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-medium tabular-nums', invert ? (value <= 25 ? 'text-success dark:text-success' : value <= 50 ? 'text-warning dark:text-warning' : 'text-destructive') : scoreColor(display))}>
          {display.toFixed(0)}/100
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${display}%` }} />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FabricWorkspace() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab]         = useState('health')
  const [drawerItem, setDrawerItem]       = useState<{ explainability?: Explainability; description?: string; title?: string } | null>(null)
  const [drawerOpen, setDrawerOpen]       = useState(false)

  // Compose form state
  const [composeEntityId, setComposeEntityId]     = useState('')
  const [composeEntityType, setComposeEntityType] = useState('employee')
  const [composeResult, setComposeResult]         = useState<IntelligenceComposition | null>(null)

  // Replay form state
  const [replayEntityId, setReplayEntityId]     = useState('')
  const [replayEntityType, setReplayEntityType] = useState('employee')
  const [replayFrom, setReplayFrom]             = useState('')
  const [replayTo, setReplayTo]                 = useState('')
  const [replayResult, setReplayResult]         = useState<ReplaySession | null>(null)

  // Escalation form state
  const [escalateEntityId, setEscalateEntityId]     = useState('')
  const [escalateEntityType, setEscalateEntityType] = useState('employee')
  const [escalateReason, setEscalateReason]         = useState('')
  const [escalateTo, setEscalateTo]                 = useState('')

  // Knowledge search
  const [knowledgeSearch, setKnowledgeSearch] = useState('')
  const [knowledgeEntry, setKnowledgeEntry]   = useState<KnowledgeEntry | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery<FabricHealthSnapshot>({
    queryKey: ['fabric-health'],
    queryFn: () => api.get('/fabric/health'),
    refetchInterval: 60_000,
  })

  const { data: decisionsData, isLoading: decisionsLoading } = useQuery<{ nodes: DecisionGraphNode[]; total: number }>({
    queryKey: ['fabric-decisions'],
    queryFn: () => api.get('/fabric/decisions?limit=50'),
    enabled: activeTab === 'decisions',
  })

  const { data: orchestrationData, isLoading: orchestrationLoading } = useQuery<{ activities: OrchestrationActivity[]; total: number }>({
    queryKey: ['fabric-orchestration'],
    queryFn: () => api.get('/fabric/orchestration?limit=20'),
    enabled: activeTab === 'orchestration',
  })

  const { data: replayData, isLoading: replayLoading } = useQuery<{ sessions: ReplaySession[]; total: number }>({
    queryKey: ['fabric-replay-sessions'],
    queryFn: () => api.get('/fabric/replay/sessions?limit=20'),
    enabled: activeTab === 'replay',
  })

  const { data: knowledgeData } = useQuery<{ entries: KnowledgeEntry[]; total: number }>({
    queryKey: ['fabric-knowledge', knowledgeSearch],
    queryFn: () => api.get(`/fabric/knowledge?text=${encodeURIComponent(knowledgeSearch)}`),
    enabled: activeTab === 'knowledge',
  })

  const { data: fedDeps } = useQuery<{ dependencies: ModuleDependency[]; total: number }>({
    queryKey: ['fabric-federation-deps'],
    queryFn: () => api.get('/fabric/federation/dependencies'),
    enabled: activeTab === 'health',
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const composeMutation = useMutation<IntelligenceComposition, Error, Record<string, unknown>>({
    mutationFn: (body) => api.post('/fabric/compose', body) as Promise<IntelligenceComposition>,
    onSuccess: (data) => setComposeResult(data),
    onError: () => toast.error('Composition failed'),
  })

  const replayMutation = useMutation<ReplaySession, Error, Record<string, unknown>>({
    mutationFn: (body) => api.post('/fabric/replay', body) as Promise<ReplaySession>,
    onSuccess: (data) => {
      setReplayResult(data)
      toast.success(`Replay complete — ${data.events_replayed} events replayed`)
      qc.invalidateQueries({ queryKey: ['fabric-replay-sessions'] })
    },
    onError: () => toast.error('Replay failed'),
  })

  const escalateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/fabric/orchestration/escalate', body),
    onSuccess: () => {
      toast.success('Escalation coordinated')
      setEscalateEntityId('')
      setEscalateReason('')
      qc.invalidateQueries({ queryKey: ['fabric-orchestration'] })
    },
    onError: () => toast.error('Escalation failed'),
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  function openDrawer(item: { explainability?: Explainability; description?: string; title?: string }) {
    setDrawerItem(item)
    setDrawerOpen(true)
  }

  function stepStatusIcon(status: string) {
    if (status === 'completed') return <CheckCircle2 className="size-3.5 text-success" />
    if (status === 'active')    return <Activity className="size-3.5 text-primary animate-pulse" />
    if (status === 'failed')    return <AlertTriangle className="size-3.5 text-destructive" />
    return <div className="size-3.5 rounded-full border-2 border-muted-foreground/30" />
  }

  // ── Health strip ───────────────────────────────────────────────────────────

  const healthScores = health ? [
    { label: 'Overall',     value: health.overall_score },
    { label: 'Governance',  value: health.governance_health },
    { label: 'Trust',       value: health.trust_health },
    { label: 'Operations',  value: health.operational_health },
    { label: 'Security',    value: health.security_health },
  ] : []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Fabric Intelligence"
      />

      {/* Health strip */}
      {health && (
        <div className="mb-6 rounded-xl border bg-card p-4">
          <MetricRow cols={5}>
            {healthScores.map(s => (
              <MetricCard
                key={s.label}
                compact
                label={s.label}
                value={(s.value ?? 0).toFixed(0)}
                variant={(s.value ?? 0) >= 75 ? 'success' : (s.value ?? 0) >= 50 ? 'warning' : 'destructive'}
              />
            ))}
          </MetricRow>
          <div className="mb-3" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Workflow className="size-3" />{health.active_orchestrations} active orchestrations</span>
            <span className="flex items-center gap-1"><Clock className="size-3" />{health.pending_slas} pending SLAs</span>
            <span className="flex items-center gap-1"><AlertTriangle className="size-3" />{health.open_incidents} open incidents</span>
            <button onClick={() => refetchHealth()} className="ml-auto text-primary hover:underline">Refresh</button>
          </div>
        </div>
      )}
      {healthLoading && (
        <div className="mb-6 rounded-xl border bg-card p-4 animate-pulse h-20" />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="health"><Activity className="size-3.5 mr-1.5" />Fabric Health</TabsTrigger>
          <TabsTrigger value="intelligence"><Cpu className="size-3.5 mr-1.5" />Intelligence</TabsTrigger>
          <TabsTrigger value="decisions"><GitBranch className="size-3.5 mr-1.5" />Decision Lineage</TabsTrigger>
          <TabsTrigger value="orchestration"><Workflow className="size-3.5 mr-1.5" />Orchestration</TabsTrigger>
          <TabsTrigger value="replay"><RotateCcw className="size-3.5 mr-1.5" />Replay</TabsTrigger>
          <TabsTrigger value="knowledge"><BookOpen className="size-3.5 mr-1.5" />Knowledge</TabsTrigger>
        </TabsList>

        {/* ── Fabric Health tab ────────────────────────────────────────────── */}
        <TabsContent value="health" className="space-y-6">
          {health ? (
            <>
              {/* Overall score display */}
              <SectionCard title="Overall Fabric Health">
                <div className="flex items-center gap-8">
                  <div className="relative size-28 shrink-0">
                    <div className="absolute inset-0 rounded-full border-8 border-muted" />
                    <div
                      className={cn('absolute inset-0 rounded-full border-8 transition-all', health.overall_score >= 75 ? 'border-success' : health.overall_score >= 50 ? 'border-warning' : 'border-destructive')}
                      style={{ clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(health.overall_score / 100 * 2 * Math.PI)}% ${50 - 50 * Math.cos(health.overall_score / 100 * 2 * Math.PI)}%, 50% 50%)` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={cn('text-2xl font-bold tabular-nums', scoreColor(health.overall_score))}>{health.overall_score}</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3">
                    <ScoreBar label="Governance Health"   value={health.governance_health} />
                    <ScoreBar label="Trust Health"        value={health.trust_health} />
                    <ScoreBar label="Operational Health"  value={health.operational_health} />
                    <ScoreBar label="Security Health"     value={health.security_health} />
                  </div>
                </div>
                {health.explainability?.summary && (
                  <button
                    className="mt-4 flex items-center gap-1.5 text-xs text-primary hover:underline"
                    onClick={() => openDrawer({ explainability: health.explainability })}
                  >
                    <Info className="size-3.5" />View explainability
                  </button>
                )}
              </SectionCard>

              {/* Module federation map */}
              {fedDeps && (
                <SectionCard title="Module Dependency Map">
                  <div className="space-y-2">
                    {fedDeps.dependencies.map((dep, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <Badge variant="outline" className="text-xs font-mono">{dep.from_module}</Badge>
                        <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                        <Badge variant="outline" className="text-xs font-mono">{dep.to_module}</Badge>
                        <Badge variant={dep.dependency_type === 'triggers' ? 'default' : dep.dependency_type === 'impacts' ? 'secondary' : 'outline'} className="text-xs">
                          {dep.dependency_type}
                        </Badge>
                        <span className="text-muted-foreground text-xs ml-auto">{((dep.strength ?? 0) * 100).toFixed(0)}% strength</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </>
          ) : !healthLoading ? (
            <SectionCard title="Fabric Health">
              <p className="text-sm text-muted-foreground">No health data available. Trigger a refresh.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchHealth()}>Compute Health</Button>
            </SectionCard>
          ) : null}
        </TabsContent>

        {/* ── Intelligence tab ─────────────────────────────────────────────── */}
        <TabsContent value="intelligence" className="space-y-6">
          <SectionCard title="Entity Intelligence Composition">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1.5">
                <Label htmlFor="comp-entity-id">Entity ID</Label>
                {composeEntityType === 'employee' ? (
                  <EmployeeSelector
                    value={composeEntityId}
                    onChange={(v) => setComposeEntityId(typeof v === 'string' ? v : '')}
                    placeholder="Search by name or employee code…"
                  />
                ) : (
                  <Input id="comp-entity-id" placeholder="UUID" value={composeEntityId} onChange={e => setComposeEntityId(e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comp-entity-type">Entity Type</Label>
                <Input id="comp-entity-type" placeholder="employee" value={composeEntityType} onChange={e => setComposeEntityType(e.target.value)} />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!composeEntityId || composeMutation.isPending}
              onClick={() => composeMutation.mutate({ entity_id: composeEntityId, entity_type: composeEntityType })}
            >
              <Play className="size-3.5 mr-1.5" />{composeMutation.isPending ? 'Computing...' : 'Compose'}
            </Button>

            {composeResult && (
              <div className="mt-6 rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{(composeResult as { entity_name?: string }).entity_name ?? humanizeType(composeResult.entity_type)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(composeResult.computed_at).toLocaleString()}</p>
                  </div>
                  <Badge variant={severityColor(composeResult.severity)}>{composeResult.severity.toUpperCase()}</Badge>
                </div>
                <div className="space-y-2">
                  <ScoreBar label="Governance Score"   value={composeResult.governance_score} />
                  <ScoreBar label="Trust Score"        value={composeResult.trust_score} />
                  <ScoreBar label="Operational Health" value={composeResult.operational_health} />
                  <ScoreBar label="Security Risk"      value={composeResult.security_risk} invert />
                  <div className="pt-1 border-t">
                    <ScoreBar label="Composite Risk" value={composeResult.composite_risk} invert />
                  </div>
                </div>
                {composeResult.factors.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Contributing Factors</p>
                    <ul className="space-y-1">
                      {composeResult.factors.map((f, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5"><AlertTriangle className="size-3 mt-0.5 shrink-0 text-warning" />{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {composeResult.explainability && (
                  <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => openDrawer(composeResult)}>
                    <Info className="size-3.5" />View explainability
                  </button>
                )}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Decision Lineage tab ─────────────────────────────────────────── */}
        <TabsContent value="decisions">
          <SectionCard title="Recent Decision Graph Nodes">
            {decisionsLoading ? (
              <IntelligenceLoadingSkeleton rows={5} cardHeight="h-10" />
            ) : !decisionsData?.nodes.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No decision nodes recorded yet.</p>
            ) : (
              <div className="space-y-1">
                {decisionsData.nodes.map(node => (
                  <button
                    key={node.node_id}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => openDrawer(node)}
                  >
                    <Badge variant="outline" className="text-xs shrink-0">{node.node_type}</Badge>
                    <span className="text-xs text-muted-foreground shrink-0">{node.entity_type}</span>
                    <span className="text-sm flex-1 truncate">{node.description}</span>
                    {node.actor_id && <span className="text-xs text-muted-foreground shrink-0 font-mono">{node.actor_id.slice(0, 8)}</span>}
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(node.timestamp).toLocaleString()}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Orchestration tab ────────────────────────────────────────────── */}
        <TabsContent value="orchestration" className="space-y-6">
          <SectionCard title="Recent Orchestration Activities">
            {orchestrationLoading ? (
              <IntelligenceLoadingSkeleton rows={4} cardHeight="h-14" />
            ) : !orchestrationData?.activities.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No orchestration activities recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {orchestrationData.activities.map(act => (
                  <div key={act.activity_id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={act.status === 'active' ? 'default' : act.status === 'completed' ? 'outline' : 'secondary'} className="text-xs">{act.status}</Badge>
                      <span className="text-sm font-medium">{act.workflow_type.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{act.entity_type} · {new Date(act.started_at).toLocaleString()}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {act.steps.map(step => (
                        <div key={step.step_id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {stepStatusIcon(step.status)}
                          <span>{step.step_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Coordinate Escalation">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1.5">
                <Label>Entity ID</Label>
                {escalateEntityType === 'employee' ? (
                  <EmployeeSelector
                    value={escalateEntityId}
                    onChange={(v) => setEscalateEntityId(typeof v === 'string' ? v : '')}
                    placeholder="Search by name or employee code…"
                  />
                ) : (
                  <Input placeholder="UUID" value={escalateEntityId} onChange={e => setEscalateEntityId(e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Entity Type</Label>
                <Input placeholder="employee" value={escalateEntityType} onChange={e => setEscalateEntityType(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Reason</Label>
                <Input placeholder="Reason for escalation" value={escalateReason} onChange={e => setEscalateReason(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Escalate To (optional)</Label>
                {/* Backend requires escalate_to to be a resolved employee UUID
                    (EscalateSchema: z.string().uuid()) — a free-text name/role
                    would always fail validation. Search-by-name/code, submit the id. */}
                <EmployeeSelector
                  value={escalateTo}
                  onChange={(v) => setEscalateTo(typeof v === 'string' ? v : '')}
                  placeholder="Search by name or employee code…"
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!escalateEntityId || !escalateReason || escalateMutation.isPending}
              onClick={() => escalateMutation.mutate({ entity_id: escalateEntityId, entity_type: escalateEntityType, reason: escalateReason, escalate_to: escalateTo || undefined })}
            >
              {escalateMutation.isPending ? 'Coordinating...' : 'Coordinate Escalation'}
            </Button>
          </SectionCard>
        </TabsContent>

        {/* ── Replay tab ───────────────────────────────────────────────────── */}
        <TabsContent value="replay" className="space-y-6">
          <SectionCard title="Start Replay Session">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1.5">
                <Label>Entity ID</Label>
                {replayEntityType === 'employee' ? (
                  <EmployeeSelector
                    value={replayEntityId}
                    onChange={(v) => setReplayEntityId(typeof v === 'string' ? v : '')}
                    placeholder="Search by name or employee code…"
                  />
                ) : (
                  <Input placeholder="UUID" value={replayEntityId} onChange={e => setReplayEntityId(e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Entity Type</Label>
                <Input placeholder="employee" value={replayEntityType} onChange={e => setReplayEntityType(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>From</Label>
                <Input type="datetime-local" value={replayFrom} onChange={e => setReplayFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input type="datetime-local" value={replayTo} onChange={e => setReplayTo(e.target.value)} />
              </div>
            </div>
            <Button
              size="sm"
              disabled={!replayEntityId || !replayFrom || !replayTo || replayMutation.isPending}
              onClick={() => replayMutation.mutate({ entity_id: replayEntityId, entity_type: replayEntityType, from: new Date(replayFrom).toISOString(), to: new Date(replayTo).toISOString() })}
            >
              <RotateCcw className="size-3.5 mr-1.5" />{replayMutation.isPending ? 'Replaying...' : 'Start Replay'}
            </Button>

            {replayResult && (
              <div className="mt-4 rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={replayResult.status === 'completed' ? 'outline' : replayResult.status === 'failed' ? 'destructive' : 'default'}>{replayResult.status}</Badge>
                  <span className="text-sm font-medium">{replayResult.events_replayed} events replayed</span>
                </div>
                {replayResult.result_summary && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {!!replayResult.result_summary['event_types'] && (
                      <p>Event types: {(replayResult.result_summary['event_types'] as string[]).join(', ')}</p>
                    )}
                    {!!replayResult.result_summary['severity_peak'] && (
                      <p>Peak severity: <Badge variant={severityColor(replayResult.result_summary['severity_peak'] as string)} className="text-xs">{replayResult.result_summary['severity_peak'] as string}</Badge></p>
                    )}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent Replay Sessions">
            {replayLoading ? (
              <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />
            ) : !replayData?.sessions.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No replay sessions recorded yet.</p>
            ) : (
              <div className="space-y-1">
                {replayData.sessions.map((s, i) => (
                  <div key={s.id ?? i} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 text-sm">
                    <Badge variant={s.status === 'completed' ? 'outline' : s.status === 'failed' ? 'destructive' : 'default'} className="text-xs shrink-0">{s.status}</Badge>
                    <span className="text-muted-foreground text-xs shrink-0">{s.entity_type}</span>
                    <span className="text-xs flex-1 truncate text-muted-foreground">{(s as { entity_name?: string }).entity_name ?? '—'}</span>
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">{s.events_replayed} events</span>
                    <span className="text-xs text-muted-foreground shrink-0">{s.created_at ? new Date(s.created_at).toLocaleString() : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Knowledge tab ────────────────────────────────────────────────── */}
        <TabsContent value="knowledge" className="space-y-6">
          <SectionCard title="Enterprise Knowledge Layer">
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search knowledge entries..."
                  value={knowledgeSearch}
                  onChange={e => setKnowledgeSearch(e.target.value)}
                />
              </div>
            </div>

            {!knowledgeData?.entries.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No entries found. Try a different search.</p>
            ) : (
              <div className="space-y-2">
                {knowledgeData.entries.map(entry => (
                  <button
                    key={entry.key}
                    className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors space-y-2"
                    onClick={() => setKnowledgeEntry(entry)}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{entry.domain}</Badge>
                      <span className="text-sm font-medium">{entry.title}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{entry.effective_from}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{entry.content.slice(0, 120)}{entry.content.length > 120 ? '…' : ''}</p>
                    <div className="flex gap-1 flex-wrap">
                      {entry.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Knowledge entry drawer */}
      <Sheet open={!!knowledgeEntry} onOpenChange={v => !v && setKnowledgeEntry(null)}>
        <SheetContent className="w-[480px]">
          <SheetHeader>
            <SheetTitle>{knowledgeEntry?.title}</SheetTitle>
          </SheetHeader>
          {knowledgeEntry && (
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex gap-2">
                <Badge variant="outline">{knowledgeEntry.domain}</Badge>
                <span className="text-muted-foreground">Effective from {knowledgeEntry.effective_from}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">{knowledgeEntry.content}</p>
              <div className="flex gap-1 flex-wrap">
                {knowledgeEntry.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground">{tag}</span>
                ))}
              </div>
              {knowledgeEntry.source && (
                <p className="text-xs text-muted-foreground border-t pt-3">Source: {knowledgeEntry.source}</p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Explainability drawer */}
      <ExplainabilityDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Explainability"
        explainability={drawerItem?.explainability}
      />
    </PageContainer>
  )
}
