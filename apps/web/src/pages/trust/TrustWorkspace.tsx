/**
 * TrustWorkspace — /admin/trust
 *
 * Passive workforce trust & compliance intelligence view.
 * READ-ONLY (except regulatory approve/reject for hr_admin).
 * Shows:
 *   1. Verification    — recent verification check results
 *   2. Trust Signals   — lowest trust-score employees
 *   3. Duplicates      — detected duplicate alerts
 *   4. Regulatory      — pending regulatory revision pipeline
 *
 * Explainability drawer opens on row click.
 * Sprint 3: Trust & Compliance Intelligence.
 */

import { useState }                                            from 'react'
import { useQuery, useMutation, useQueryClient }               from '@tanstack/react-query'
import { toast }                                               from 'sonner'
import {
  ShieldCheck, AlertTriangle, Copy, FileText,
  CheckCircle2, XCircle, ShieldAlert, ShieldX, BarChart2,
}                                                              from 'lucide-react'
import { PageContainer }                                       from '@/components/layout/PageContainer'
import { PageHeader }                                          from '@/components/layout/PageHeader'
import { SectionCard }                                         from '@/components/layout/SectionCard'
import { Badge }                                               from '@/components/ui/badge'
import { Button }                                              from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger }            from '@/components/ui/tabs'
import {
  SeverityBadge,
  ExplainabilityDrawer,
}                                                              from '@/components/ui/intelligence/index.js'
import { api }                                                 from '@/lib/api/client'
import { cn }                                                  from '@/lib/utils'
import { useAuthStore }                                        from '@/stores/authStore'

// ── Local types (self-contained — no API type imports) ────────────────────────

interface Explainability {
  summary?:              string
  confidence_score?:     number
  contributing_factors?: string[]
  recommended_actions?:  string[]
}

interface VerificationEvent {
  id:                string
  entity_id:         string
  entity_type:       string
  verification_type: string
  status:            string
  score:             number
  flags:             string[]
  verified_at:       string
  explainability?:   Explainability
}

interface TrustScore {
  id:              string
  entity_id:       string
  entity_type:     string
  score_type:      string
  score:           number
  severity:        string
  factors:         string[]
  strengths?:      string[]
  risks?:          string[]
  recommendations?: string[]
  computed_at:     string
  explainability?: Explainability
}

interface DuplicateEvent {
  id:                   string
  entity_id:            string
  duplicate_type:       string
  matching_entity_ids:  string[]
  severity:             string
  detected_at:          string
  explainability?:      Explainability
}

interface ComplianceRevision {
  id:               string
  revision_type:    string
  jurisdiction:     string
  title:            string
  description:      string
  old_value?:       number
  new_value?:       number
  unit?:            string
  effective_from:   string
  status:           string
  ingested_at:      string
  explainability?:  Explainability
}

// ── Drawer item type used by all sub-tabs ─────────────────────────────────────

interface DrawerItem {
  label:       string
  timestamp:   string
  explainability?: Explainability
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'verified'      ? 'default'     :
    status === 'failed'        ? 'destructive' :
    status === 'inconclusive'  ? 'secondary'   :
    status === 'approved'      ? 'default'     :
    status === 'rejected'      ? 'destructive' :
    'outline'
  return (
    <Badge variant={variant} className="capitalize text-xs">
      {status}
    </Badge>
  )
}

function ScoreBar({ score, severity }: { score: number; severity?: string }) {
  const colour =
    severity === 'critical' ? 'bg-destructive'  :
    severity === 'high'     ? 'bg-accent-coral'   :
    severity === 'medium'   ? 'bg-warning'   :
    score < 60              ? 'bg-accent-coral'   :
    'bg-success'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', colour)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(score)}</span>
    </div>
  )
}

function truncateId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

// ── Verification Tab ──────────────────────────────────────────────────────────

function VerificationTab() {
  const [drawerItem, setDrawerItem] = useState<DrawerItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['trust', 'verifications'],
    queryFn:  () => api.get<{ verifications: VerificationEvent[] }>('/trust/verifications?limit=30'),
  })

  const items = data?.verifications ?? []

  return (
    <>
      <SectionCard title="Recent Verification Checks" description="Last 30 identity verification events">
        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No verification events yet.</p>
        )}
        {!isLoading && items.length > 0 && (
          <div className="divide-y">
            {items.map(v => (
              <button
                key={v.id}
                onClick={() => setDrawerItem({
                  label:          `${v.verification_type} verification — ${v.entity_id}`,
                  timestamp:      v.verified_at,
                  explainability: v.explainability,
                })}
                className="w-full text-left px-0 py-3 hover:bg-muted/30 transition-colors rounded-sm"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {truncateId(v.entity_id)}
                    </span>
                    <Badge variant="outline" className="text-xs capitalize shrink-0">
                      {v.verification_type.replace('_', ' ')}
                    </Badge>
                    <StatusBadge status={v.status} />
                  </div>
                  <div className="flex items-center gap-3">
                    <ScoreBar score={v.score} />
                    {v.flags.length > 0 && (
                      <div className="flex gap-1 flex-wrap max-w-48">
                        {v.flags.slice(0, 2).map(f => (
                          <Badge key={f} variant="secondary" className="text-xs">{f.replace(/_/g, ' ')}</Badge>
                        ))}
                        {v.flags.length > 2 && (
                          <Badge variant="secondary" className="text-xs">+{v.flags.length - 2}</Badge>
                        )}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(v.verified_at)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <ExplainabilityDrawer
        open={!!drawerItem}
        onClose={() => setDrawerItem(null)}
        title={drawerItem?.label ?? 'Intelligence Details'}
        explainability={drawerItem?.explainability}
      >
        {drawerItem && (
          <p className="text-xs text-muted-foreground">{fmtDate(drawerItem.timestamp)}</p>
        )}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Trust Signals Tab ─────────────────────────────────────────────────────────

interface TrustDrilldown {
  entityId:  string
  score:     TrustScore
}

function TrustSignalsTab() {
  const [drilldown, setDrilldown] = useState<TrustDrilldown | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['trust', 'scores'],
    queryFn:  () => api.get<{ scores: TrustScore[] }>('/trust/scores?limit=50'),
  })

  // Full trust breakdown for the drilled-down employee (O5.10)
  const drillQ = useQuery({
    queryKey: ['employee-trust', drilldown?.entityId],
    queryFn:  () => api.get<{ data: TrustScore }>(`/employees/${drilldown!.entityId}/trust`).then(r => r.data),
    enabled:  !!drilldown?.entityId,
    staleTime: 120_000,
  })

  const items    = data?.scores ?? []
  const lowTrust = items.filter(s => s.score < 80)

  // Aggregate metrics for header (O5.10)
  const totalScored = items.length
  const bySeveity   = items.reduce((acc: Record<string, number>, s) => {
    acc[s.severity] = (acc[s.severity] ?? 0) + 1
    return acc
  }, {})
  const avgScore = totalScored > 0
    ? Math.round(items.reduce((sum, s) => sum + s.score, 0) / totalScored)
    : null

  const detail = drillQ.data ?? drilldown?.score ?? null

  return (
    <>
      {/* Aggregate header */}
      {totalScored > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Scored', value: totalScored, icon: BarChart2, cls: 'text-foreground' },
            { label: 'Low risk', value: bySeveity.low ?? 0, icon: ShieldCheck, cls: 'text-success' },
            { label: 'Medium / High', value: (bySeveity.medium ?? 0) + (bySeveity.high ?? 0), icon: ShieldAlert, cls: 'text-warning' },
            { label: 'Critical', value: bySeveity.critical ?? 0, icon: ShieldX, cls: 'text-destructive' },
          ].map(({ label, value, icon: Icon, cls }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
              <Icon className={cn('h-4 w-4 shrink-0', cls)} />
              <div>
                <p className="text-base font-semibold tabular-nums">{value}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionCard
        title="Trust Signals"
        description={avgScore != null ? `Avg score ${avgScore}/100 · employees below 80 shown` : 'Employees with lowest trust scores (below 80)'}
      >
        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {!isLoading && lowTrust.length === 0 && (
          <div className="py-8 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-success mx-auto" />
            <p className="text-sm font-medium">All trust scores are healthy</p>
            <p className="text-xs text-muted-foreground">No employees with scores below 80.</p>
          </div>
        )}
        {!isLoading && lowTrust.length > 0 && (
          <div className="divide-y">
            {lowTrust.map(s => (
              <button
                key={s.id}
                onClick={() => setDrilldown({ entityId: s.entity_id, score: s })}
                className="w-full text-left px-0 py-3 hover:bg-muted/30 transition-colors rounded-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{truncateId(s.entity_id)}</span>
                      <Badge variant="outline" className="text-xs capitalize">{s.score_type}</Badge>
                      <SeverityBadge severity={s.severity} />
                    </div>
                    <ScoreBar score={s.score} severity={s.severity} />
                    {(s.risks ?? s.factors).slice(0, 2).length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {(s.risks ?? s.factors).slice(0, 2).map((f, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="text-muted-foreground mt-0.5">•</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {fmtDate(s.computed_at)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Employee drilldown drawer (O5.10) */}
      <ExplainabilityDrawer
        open={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldown ? `Trust breakdown — ${truncateId(drilldown.entityId)}` : 'Trust Details'}
        explainability={detail?.explainability}
      >
        {drilldown && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ScoreBar score={drilldown.score.score} severity={drilldown.score.severity} />
              <SeverityBadge severity={drilldown.score.severity} />
            </div>

            {drillQ.isLoading && <p className="text-xs text-muted-foreground">Loading full breakdown…</p>}

            {detail?.strengths && detail.strengths.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-success uppercase tracking-wide">Strengths</p>
                {detail.strengths.map((s, i) => (
                  <p key={i} className="text-xs text-foreground flex gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />{s}
                  </p>
                ))}
              </div>
            )}

            {detail?.risks && detail.risks.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-warning uppercase tracking-wide">Risks</p>
                {detail.risks.map((r, i) => (
                  <p key={i} className="text-xs text-foreground flex gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />{r}
                  </p>
                ))}
              </div>
            )}

            {detail?.recommendations && detail.recommendations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#2E6FE6] uppercase tracking-wide">Recommendations</p>
                {detail.recommendations.map((rec, i) => (
                  <p key={i} className="text-xs text-foreground flex gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#2E6FE6] shrink-0 mt-0.5" />{rec}
                  </p>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Computed {fmtDate(drilldown.score.computed_at)}
            </p>
          </div>
        )}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Duplicates Tab ────────────────────────────────────────────────────────────

function DuplicatesTab() {
  const [drawerItem, setDrawerItem] = useState<DrawerItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['trust', 'duplicates'],
    queryFn:  () => api.get<{ duplicates: DuplicateEvent[] }>('/trust/duplicates?limit=30'),
  })

  const items = data?.duplicates ?? []

  return (
    <>
      <SectionCard title="Duplicate Alerts" description="Workforce identity duplication signals">
        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <div className="py-8 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-success mx-auto" />
            <p className="text-sm font-medium">No duplicate alerts detected</p>
            <p className="text-xs text-muted-foreground">Workforce identity data appears clean.</p>
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <div className="divide-y">
            {items.map(d => (
              <button
                key={d.id}
                onClick={() => setDrawerItem({
                  label:          `Duplicate ${d.duplicate_type} — ${d.entity_id}`,
                  timestamp:      d.detected_at,
                  explainability: d.explainability,
                })}
                className="w-full text-left px-0 py-3 hover:bg-muted/30 transition-colors rounded-sm"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {truncateId(d.entity_id)}
                    </span>
                    <Badge variant="outline" className="text-xs capitalize shrink-0">
                      {d.duplicate_type.replace(/_/g, ' ')}
                    </Badge>
                    <SeverityBadge severity={d.severity} />
                    <span className="text-xs text-muted-foreground">
                      {d.matching_entity_ids.length + 1} affected
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(d.detected_at)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <ExplainabilityDrawer
        open={!!drawerItem}
        onClose={() => setDrawerItem(null)}
        title={drawerItem?.label ?? 'Intelligence Details'}
        explainability={drawerItem?.explainability}
      >
        {drawerItem && (
          <p className="text-xs text-muted-foreground">{fmtDate(drawerItem.timestamp)}</p>
        )}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Regulatory Tab ────────────────────────────────────────────────────────────

function RegulatoryTab() {
  const [drawerItem, setDrawerItem]   = useState<DrawerItem | null>(null)
  const [confirmId, setConfirmId]     = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const queryClient                   = useQueryClient()
  const { hasRole }                   = useAuthStore()
  const isAdmin                       = hasRole('hr_admin')

  const { data, isLoading } = useQuery({
    queryKey: ['trust', 'regulatory', 'pending'],
    queryFn:  () => api.get<{ revisions: ComplianceRevision[] }>('/trust/regulatory/revisions?status=pending_review'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/trust/regulatory/revisions/${id}/approve`, {}),
    onSuccess:  () => {
      toast.success('Revision marked as approved. Benchmarks require a separate manual update.')
      queryClient.invalidateQueries({ queryKey: ['trust', 'regulatory'] })
      setConfirmId(null)
    },
    onError: () => {
      toast.error('Failed to approve revision')
      setConfirmId(null)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/trust/regulatory/revisions/${id}/reject`, {}),
    onSuccess:  () => {
      toast.success('Revision rejected.')
      queryClient.invalidateQueries({ queryKey: ['trust', 'regulatory'] })
      setConfirmId(null)
    },
    onError: () => {
      toast.error('Failed to reject revision')
      setConfirmId(null)
    },
  })

  const items     = data?.revisions ?? []
  const isMutating = approveMutation.isPending || rejectMutation.isPending

  return (
    <>
      <SectionCard
        title="Regulatory Pipeline"
        description="Pending compliance revision events — human review required before activation"
      >
        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <div className="py-8 text-center space-y-2">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">No pending revisions</p>
            <p className="text-xs text-muted-foreground">All regulatory changes have been reviewed.</p>
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <div className="divide-y">
            {items.map(r => (
              <div key={r.id} className="py-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <button
                    className="text-left flex-1 min-w-0 hover:bg-muted/20 transition-colors rounded-sm"
                    onClick={() => setDrawerItem({
                      label:          r.title,
                      timestamp:      r.ingested_at,
                      explainability: r.explainability,
                    })}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className="text-xs capitalize shrink-0">
                        {r.revision_type.replace(/_/g, ' ')}
                      </Badge>
                      <Badge variant="secondary" className="text-xs shrink-0">{r.jurisdiction}</Badge>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{r.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {r.old_value !== undefined && r.new_value !== undefined && (
                        <span>{r.old_value} → {r.new_value} {r.unit ?? ''}</span>
                      )}
                      <span>Effective: {r.effective_from}</span>
                      <span>Ingested: {fmtDate(r.ingested_at)}</span>
                    </div>
                  </button>

                  {isAdmin && r.status === 'pending_review' && (
                    confirmId?.id === r.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <p className="text-xs text-muted-foreground">
                          {confirmId.action === 'approve' ? 'Approve?' : 'Reject?'}
                        </p>
                        <Button
                          size="sm"
                          variant={confirmId.action === 'approve' ? 'default' : 'destructive'}
                          className="h-7 text-xs"
                          disabled={isMutating}
                          onClick={() => {
                            if (confirmId.action === 'approve') approveMutation.mutate(r.id)
                            else rejectMutation.mutate(r.id)
                          }}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => setConfirmId({ id: r.id, action: 'approve' })}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 text-destructive border-destructive/40 hover:bg-destructive/5"
                          onClick={() => setConfirmId({ id: r.id, action: 'reject' })}
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </Button>
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <ExplainabilityDrawer
        open={!!drawerItem}
        onClose={() => setDrawerItem(null)}
        title={drawerItem?.label ?? 'Intelligence Details'}
        explainability={drawerItem?.explainability}
      >
        {drawerItem && (
          <p className="text-xs text-muted-foreground">{fmtDate(drawerItem.timestamp)}</p>
        )}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TrustWorkspace() {
  return (
    <PageContainer>
      <PageHeader
        title="Trust Intelligence"
        subtitle="Workforce verification & compliance signals — read only"
      />

      <Tabs defaultValue="verification" className="mt-6">
        <TabsList className="mb-6">
          <TabsTrigger value="verification" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verification
          </TabsTrigger>
          <TabsTrigger value="trust" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Trust Signals
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            Duplicates
          </TabsTrigger>
          <TabsTrigger value="regulatory" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Regulatory
          </TabsTrigger>
        </TabsList>

        <TabsContent value="verification">
          <VerificationTab />
        </TabsContent>

        <TabsContent value="trust">
          <TrustSignalsTab />
        </TabsContent>

        <TabsContent value="duplicates">
          <DuplicatesTab />
        </TabsContent>

        <TabsContent value="regulatory">
          <RegulatoryTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
