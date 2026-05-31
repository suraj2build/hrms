/**
 * OperationalIntelligenceWorkspace — /admin/operations
 *
 * Passive operational intelligence view. Sprint 4.
 * Tabs:
 *   1. Health       — domain health scores + overall score
 *   2. Heatmaps     — risk intensity by domain
 *   3. SLA          — tracked items + breach events
 *   4. Simulations  — run simulations + history
 *   5. Automation   — activity log + trigger list
 *   6. Security     — passive security event log
 *
 * No direct mutation of operational data.
 * Explainability drawer on row/card click.
 */

import { useState }                                            from 'react'
import { useQuery, useMutation }                               from '@tanstack/react-query'
import { toast }                                               from 'sonner'
import {
  Activity, ShieldAlert, Clock, Zap, Play,
  ChevronRight, BarChart3, AlertTriangle,
  CheckCircle2, Server, Lock, Users,
  TrendingUp, FlaskConical,
} from 'lucide-react'
import { PageContainer }                                       from '@/components/layout/PageContainer'
import { PageHeader }                                          from '@/components/layout/PageHeader'
import { SectionCard }                                         from '@/components/layout/SectionCard'
import { Badge }                                               from '@/components/ui/badge'
import { Button }                                              from '@/components/ui/button'
import { Input }                                               from '@/components/ui/input'
import { Label }                                               from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger }            from '@/components/ui/tabs'
import {
  SeverityBadge,
  ExplainabilityDrawer,
  IntelligenceLoadingSkeleton,
}                                                              from '@/components/ui/intelligence/index.js'
import { api }                                                 from '@/lib/api/client'
import { cn }                                                  from '@/lib/utils'

// ── Local types ───────────────────────────────────────────────────────────────

interface Explainability {
  summary?:              string
  confidence_score?:     number
  contributing_factors?: string[]
  recommended_actions?:  string[]
}

interface DomainHealthSignal {
  domain:      string
  score:       number
  severity:    'healthy' | 'warning' | 'critical'
  factors:     string[]
  computed_at: string
  explainability?: Explainability
}

interface OperationalSummaryData {
  overall_health:   number
  domains:          DomainHealthSignal[]
  sla_breaches:     number
  security_signals: number
  computed_at:      string
}

interface HeatmapCell {
  dimension_id:    string
  dimension_label: string
  value:           number
  severity:        string
  event_count:     number
  period:          string
}

interface HeatmapSnapshot {
  domain:      string
  period:      string
  cells:       HeatmapCell[]
  computed_at: string
}

interface SlaStatus {
  sla_id:          string
  entity_id:       string
  entity_type:     string
  org_id:          string
  started_at:      string
  due_at:          string
  breached:        boolean
  hours_elapsed:   number
  hours_remaining: number
}

interface SlaBreachEvent {
  sla_id:          string
  entity_id:       string
  entity_type:     string
  org_id:          string
  breach_severity: string
  description:     string
  breached_at:     string
  explainability?: Explainability
}

interface SlaResponse {
  tracked:     SlaStatus[]
  breaches:    SlaBreachEvent[]
  definitions: Array<{ sla_id: string; name: string; entity_type: string; threshold_hours: number }>
}

interface AutomationActivity {
  id:          string
  action_type: string
  entity_id:   string
  entity_type: string
  message:     string
  severity:    string
  fired_at:    string
  explainability?: Explainability
}

interface AutomationTrigger {
  trigger_id:  string
  name:        string
  description: string
  event_types: string[]
  enabled:     boolean
  safeguards:  string[]
}

interface SimulationResultSummary {
  affected_count:   number
  estimated_impact: number
  impact_unit:      string
  risk_level:       string
  key_findings:     string[]
  explainability?:  Explainability
}

interface SimulationRun {
  org_id:          string
  simulation_type: string
  label:           string
  result_summary:  SimulationResultSummary
  created_at?:     string
  created_by?:     string
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

// ── Drawer item type ──────────────────────────────────────────────────────────

interface DrawerItem {
  label:           string
  timestamp:       string
  explainability?: Explainability
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ScoreBar({ score, invert = false }: { score: number; invert?: boolean }) {
  // invert = true → high score is bad (risk heatmap)
  const colour = invert
    ? score >= 75 ? 'bg-destructive' : score >= 50 ? 'bg-orange-500' : 'bg-emerald-500'
    : score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-yellow-500' : 'bg-destructive'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', colour)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(score)}</span>
    </div>
  )
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('en-IN') } catch { return iso }
}

function truncateId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// ── Domain icon map ───────────────────────────────────────────────────────────

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  payroll:    <TrendingUp className="h-4 w-4" />,
  attendance: <Clock className="h-4 w-4" />,
  governance: <ShieldAlert className="h-4 w-4" />,
  trust:      <Users className="h-4 w-4" />,
  approvals:  <CheckCircle2 className="h-4 w-4" />,
  system:     <Server className="h-4 w-4" />,
}

// ── Summary Strip ─────────────────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: OperationalSummaryData | undefined }) {
  if (!summary) return null
  const healthyCount  = summary.domains.filter(d => d.severity === 'healthy').length
  const warningCount  = summary.domains.filter(d => d.severity === 'warning').length
  const criticalCount = summary.domains.filter(d => d.severity === 'critical').length
  const gaugeColour   =
    summary.overall_health >= 75 ? 'text-emerald-600' :
    summary.overall_health >= 50 ? 'text-yellow-600'  :
    'text-destructive'

  return (
    <div className="flex items-center gap-6 p-4 rounded-lg border bg-muted/20 flex-wrap">
      <div className="flex items-center gap-3">
        <div className={cn('text-4xl font-bold tabular-nums', gaugeColour)}>
          {summary.overall_health}
        </div>
        <div>
          <p className="text-xs font-medium">Overall Health</p>
          <p className="text-xs text-muted-foreground">0–100 scale</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {healthyCount > 0  && <Badge variant="default"     className="gap-1"><CheckCircle2 className="h-3 w-3" />{healthyCount} healthy</Badge>}
        {warningCount > 0  && <Badge variant="secondary"   className="gap-1"><AlertTriangle className="h-3 w-3" />{warningCount} warning</Badge>}
        {criticalCount > 0 && <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" />{criticalCount} critical</Badge>}
      </div>
      <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Lock className="h-3.5 w-3.5" />
          {summary.sla_breaches} SLA breaches
        </span>
        <span className="flex items-center gap-1">
          <ShieldAlert className="h-3.5 w-3.5" />
          {summary.security_signals} security signals
        </span>
      </div>
    </div>
  )
}

// ── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab() {
  const [drawer, setDrawer] = useState<DrawerItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['operations', 'health'],
    queryFn:  () => api.get<{ signals: DomainHealthSignal[] }>('/operations/health'),
  })

  const signals = data?.signals ?? []

  return (
    <>
      <SectionCard title="Domain Health Signals" description="Real-time operational health scores across all platform domains">
        {isLoading && <IntelligenceLoadingSkeleton rows={3} cardHeight="h-24" />}
        {!isLoading && signals.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No health signals available.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
          {signals.map(s => (
            <button
              key={s.domain}
              onClick={() => setDrawer({ label: `${s.domain} health`, timestamp: s.computed_at, explainability: s.explainability })}
              className="text-left rounded-lg border p-4 hover:bg-muted/30 transition-colors space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium capitalize">
                  {DOMAIN_ICONS[s.domain] ?? <Activity className="h-4 w-4" />}
                  {s.domain}
                </div>
                <SeverityBadge severity={s.severity} />
              </div>
              <ScoreBar score={s.score} />
              {s.factors.length > 0 && (
                <ul className="space-y-0.5">
                  {s.factors.slice(0, 2).map((f, i) => (
                    <li key={i} className="text-xs text-muted-foreground truncate">{f}</li>
                  ))}
                  {s.factors.length > 2 && (
                    <li className="text-xs text-muted-foreground">+{s.factors.length - 2} more factors</li>
                  )}
                </ul>
              )}
              {s.factors.length === 0 && (
                <p className="text-xs text-muted-foreground">No anomalies detected</p>
              )}
            </button>
          ))}
        </div>
      </SectionCard>
      <ExplainabilityDrawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        title={drawer?.label ?? 'Intelligence Details'}
        explainability={drawer?.explainability}
      >
        {drawer && <p className="text-xs text-muted-foreground">{fmtDate(drawer.timestamp)}</p>}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Heatmaps Tab ──────────────────────────────────────────────────────────────

const HEATMAP_DOMAINS = ['payroll', 'attendance', 'governance', 'trust', 'approvals'] as const
type HeatmapDomain = typeof HEATMAP_DOMAINS[number]

function HeatmapsTab() {
  const [selectedDomain, setSelectedDomain] = useState<HeatmapDomain>('payroll')

  const { data, isLoading } = useQuery({
    queryKey: ['operations', 'heatmap', selectedDomain],
    queryFn:  () => api.get<HeatmapSnapshot>(`/operations/heatmaps/${selectedDomain}`),
  })

  const cells = data?.cells ?? []

  return (
    <SectionCard
      title="Risk Heatmap"
      description="Operational risk intensity by entity and domain"
    >
      <div className="flex gap-2 flex-wrap mb-4">
        {HEATMAP_DOMAINS.map(d => (
          <Button
            key={d}
            size="sm"
            variant={selectedDomain === d ? 'default' : 'outline'}
            onClick={() => setSelectedDomain(d)}
            className="capitalize"
          >
            {d}
          </Button>
        ))}
      </div>

      {isLoading && <IntelligenceLoadingSkeleton rows={4} cardHeight="h-10" />}
      {!isLoading && cells.length === 0 && (
        <div className="py-10 text-center space-y-2">
          <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No risk data for {selectedDomain} domain</p>
        </div>
      )}
      {!isLoading && cells.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left font-medium pb-2 pr-4">Entity</th>
                <th className="text-left font-medium pb-2 pr-4">Risk Score</th>
                <th className="text-left font-medium pb-2 pr-4">Severity</th>
                <th className="text-left font-medium pb-2">Events</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cells.map(cell => (
                <tr key={cell.dimension_id} className="hover:bg-muted/20 transition-colors">
                  <td className="py-2 pr-4 font-mono text-xs">{cell.dimension_label}</td>
                  <td className="py-2 pr-4"><ScoreBar score={cell.value} invert /></td>
                  <td className="py-2 pr-4"><SeverityBadge severity={cell.severity} /></td>
                  <td className="py-2 text-muted-foreground tabular-nums">{cell.event_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ── SLA Tab ───────────────────────────────────────────────────────────────────

function SlaTab() {
  const [drawer, setDrawer] = useState<DrawerItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['operations', 'sla'],
    queryFn:  () => api.get<SlaResponse>('/operations/sla'),
  })

  const tracked  = data?.tracked  ?? []
  const breaches = data?.breaches ?? []

  return (
    <>
      <div className="space-y-4">
        <SectionCard title="Active SLA Tracking" description="Items currently being tracked against SLA thresholds">
          {isLoading && <IntelligenceLoadingSkeleton rows={3} cardHeight="h-10" />}
          {!isLoading && tracked.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No items currently tracked.</p>
          )}
          {!isLoading && tracked.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium pb-2 pr-4">Entity Type</th>
                    <th className="text-left font-medium pb-2 pr-4">SLA</th>
                    <th className="text-left font-medium pb-2 pr-4">Hours Remaining</th>
                    <th className="text-left font-medium pb-2">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tracked.map(t => (
                    <tr key={`${t.sla_id}:${t.entity_id}`} className="hover:bg-muted/20">
                      <td className="py-2 pr-4 capitalize">{t.entity_type.replace(/_/g, ' ')}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{t.sla_id}</td>
                      <td className="py-2 pr-4">
                        <span className={cn('tabular-nums text-sm', t.hours_remaining < 4 ? 'text-destructive font-medium' : '')}>
                          {t.hours_remaining.toFixed(1)}h
                        </span>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{fmtDate(t.due_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="SLA Breach Events" description="Overdue items that breached their SLA threshold">
          {!isLoading && breaches.length === 0 && (
            <div className="py-6 text-center space-y-1">
              <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-500" />
              <p className="text-sm text-muted-foreground">No SLA breaches</p>
            </div>
          )}
          {breaches.length > 0 && (
            <div className="divide-y">
              {breaches.map((b, i) => (
                <button
                  key={i}
                  onClick={() => setDrawer({ label: b.description, timestamp: b.breached_at, explainability: b.explainability })}
                  className="w-full text-left py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-medium truncate">{b.description}</p>
                      <p className="text-xs text-muted-foreground">{b.entity_type} · {fmtDate(b.breached_at)}</p>
                    </div>
                    <SeverityBadge severity={b.breach_severity} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
      <ExplainabilityDrawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        title={drawer?.label ?? 'Intelligence Details'}
        explainability={drawer?.explainability}
      >
        {drawer && <p className="text-xs text-muted-foreground">{fmtDate(drawer.timestamp)}</p>}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Simulations Tab ───────────────────────────────────────────────────────────

function SimulationsTab() {
  const [result, setResult] = useState<SimulationRun | null>(null)
  const [resultDrawer, setResultDrawer] = useState(false)

  // Payroll form
  const [payroll, setPayroll] = useState({ affected_count: '', avg_ctc_increase: '', months_in_period: '12' })
  // Compliance form
  const [compliance, setCompliance] = useState({ threshold_type: '', old_threshold: '', new_threshold: '', affected_count: '' })
  // Overtime form
  const [overtime, setOvertime] = useState({ affected_count: '', avg_ot_hours_per_week: '', ot_rate_per_hour: '', weeks: '4' })

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['operations', 'simulate', 'history'],
    queryFn:  () => api.get<{ runs: SimulationRun[] }>('/operations/simulate/history'),
  })

  const payrollMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<SimulationRun>('/operations/simulate/payroll', body),
    onSuccess: (data) => {
      setResult(data)
      setResultDrawer(true)
      refetchHistory()
      toast.success('Payroll impact simulation complete')
    },
    onError: () => toast.error('Simulation failed'),
  })

  const complianceMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<SimulationRun>('/operations/simulate/compliance', body),
    onSuccess: (data) => {
      setResult(data)
      setResultDrawer(true)
      refetchHistory()
      toast.success('Compliance simulation complete')
    },
    onError: () => toast.error('Simulation failed'),
  })

  const overtimeMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<SimulationRun>('/operations/simulate/overtime', body),
    onSuccess: (data) => {
      setResult(data)
      setResultDrawer(true)
      refetchHistory()
      toast.success('Overtime simulation complete')
    },
    onError: () => toast.error('Simulation failed'),
  })

  const runs = historyData?.runs ?? []

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Payroll Impact */}
          <SectionCard title="Payroll Impact" description="Estimate cost of compensation changes">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Affected Employees</Label>
                <Input
                  type="number" placeholder="100"
                  value={payroll.affected_count}
                  onChange={e => setPayroll(p => ({ ...p, affected_count: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Avg CTC Increase (₹/month)</Label>
                <Input
                  type="number" placeholder="5000"
                  value={payroll.avg_ctc_increase}
                  onChange={e => setPayroll(p => ({ ...p, avg_ctc_increase: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Months in Period</Label>
                <Input
                  type="number" placeholder="12"
                  value={payroll.months_in_period}
                  onChange={e => setPayroll(p => ({ ...p, months_in_period: e.target.value }))}
                />
              </div>
              <Button
                size="sm" className="w-full gap-1"
                onClick={() => payrollMutation.mutate(payroll as unknown as Record<string, unknown>)}
                disabled={payrollMutation.isPending}
              >
                <Play className="h-3.5 w-3.5" />
                {payrollMutation.isPending ? 'Running…' : 'Run Simulation'}
              </Button>
            </div>
          </SectionCard>

          {/* Compliance Threshold */}
          <SectionCard title="Compliance Threshold" description="Model statutory threshold change impact">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Threshold Type</Label>
                <Input
                  placeholder="pf_ceiling"
                  value={compliance.threshold_type}
                  onChange={e => setCompliance(p => ({ ...p, threshold_type: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Old Threshold</Label>
                <Input
                  type="number" placeholder="15000"
                  value={compliance.old_threshold}
                  onChange={e => setCompliance(p => ({ ...p, old_threshold: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">New Threshold</Label>
                <Input
                  type="number" placeholder="21000"
                  value={compliance.new_threshold}
                  onChange={e => setCompliance(p => ({ ...p, new_threshold: e.target.value }))}
                />
              </div>
              <Button
                size="sm" className="w-full gap-1"
                onClick={() => complianceMutation.mutate({ ...compliance, affected_count: compliance.affected_count || '0' } as unknown as Record<string, unknown>)}
                disabled={complianceMutation.isPending}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                {complianceMutation.isPending ? 'Running…' : 'Run Simulation'}
              </Button>
            </div>
          </SectionCard>

          {/* Overtime Growth */}
          <SectionCard title="Overtime Growth" description="Estimate overtime cost projection">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Affected Employees</Label>
                <Input
                  type="number" placeholder="50"
                  value={overtime.affected_count}
                  onChange={e => setOvertime(p => ({ ...p, affected_count: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Avg OT Hours/Week</Label>
                <Input
                  type="number" placeholder="8"
                  value={overtime.avg_ot_hours_per_week}
                  onChange={e => setOvertime(p => ({ ...p, avg_ot_hours_per_week: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">OT Rate (₹/hour)</Label>
                <Input
                  type="number" placeholder="200"
                  value={overtime.ot_rate_per_hour}
                  onChange={e => setOvertime(p => ({ ...p, ot_rate_per_hour: e.target.value }))}
                />
              </div>
              <Button
                size="sm" className="w-full gap-1"
                onClick={() => overtimeMutation.mutate(overtime as unknown as Record<string, unknown>)}
                disabled={overtimeMutation.isPending}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                {overtimeMutation.isPending ? 'Running…' : 'Run Simulation'}
              </Button>
            </div>
          </SectionCard>
        </div>

        {/* Simulation Result */}
        {result && (
          <SectionCard title="Latest Simulation Result" description={result.label}>
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" className="capitalize">{result.simulation_type.replace(/_/g, ' ')}</Badge>
                <SeverityBadge severity={result.result_summary.risk_level} />
                <span className="text-sm font-medium">
                  {result.result_summary.estimated_impact.toLocaleString('en-IN')} {result.result_summary.impact_unit}
                </span>
                <span className="text-xs text-muted-foreground">{result.result_summary.affected_count} employees affected</span>
              </div>
              <ul className="space-y-1">
                {result.result_summary.key_findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {result.result_summary.explainability?.summary && (
                <p className="text-xs text-muted-foreground border-t pt-2">{result.result_summary.explainability.summary}</p>
              )}
            </div>
          </SectionCard>
        )}

        {/* History */}
        <SectionCard title="Simulation History" description="Previous analytical runs">
          {runs.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No simulations yet.</p>}
          {runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium pb-2 pr-4">Label</th>
                    <th className="text-left font-medium pb-2 pr-4">Type</th>
                    <th className="text-left font-medium pb-2 pr-4">Affected</th>
                    <th className="text-left font-medium pb-2 pr-4">Impact</th>
                    <th className="text-left font-medium pb-2 pr-4">Risk</th>
                    <th className="text-left font-medium pb-2">Run At</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="py-2 pr-4 text-sm max-w-[200px] truncate">{r.label}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-xs capitalize">{r.simulation_type.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{r.result_summary.affected_count}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {r.result_summary.estimated_impact.toLocaleString('en-IN')} {r.result_summary.impact_unit}
                      </td>
                      <td className="py-2 pr-4"><SeverityBadge severity={r.result_summary.risk_level} /></td>
                      <td className="py-2 text-xs text-muted-foreground">{r.created_at ? fmtDate(r.created_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Result explanation sheet */}
      {result && (
        <ExplainabilityDrawer
          open={resultDrawer}
          onClose={() => setResultDrawer(false)}
          title={result.label}
          explainability={result.result_summary.explainability}
        />
      )}
    </>
  )
}

// ── Automation Tab ────────────────────────────────────────────────────────────

function AutomationTab() {
  const [drawer, setDrawer] = useState<DrawerItem | null>(null)

  const { data: triggersData, isLoading: triggersLoading } = useQuery({
    queryKey: ['operations', 'automation', 'triggers'],
    queryFn:  () => api.get<{ triggers: AutomationTrigger[] }>('/operations/automation/triggers'),
  })

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['operations', 'automation', 'activity'],
    queryFn:  () => api.get<{ activities: AutomationActivity[] }>('/operations/automation/activity'),
  })

  const triggers   = triggersData?.triggers   ?? []
  const activities = activityData?.activities ?? []

  return (
    <>
      <div className="space-y-4">
        <SectionCard title="Registered Triggers" description="Configured automation triggers — advisory only, none mutate data">
          {triggersLoading && <IntelligenceLoadingSkeleton rows={3} cardHeight="h-20" />}
          <div className="divide-y">
            {triggers.map(t => (
              <div key={t.trigger_id} className="py-3 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.name}</span>
                  <Badge variant={t.enabled ? 'default' : 'outline'} className="text-xs">
                    {t.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t.description}</p>
                <div className="flex gap-1 flex-wrap">
                  {t.event_types.map(et => (
                    <Badge key={et} variant="outline" className="text-xs font-mono">{et}</Badge>
                  ))}
                </div>
                <ul className="space-y-0.5 mt-1">
                  {t.safeguards.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Recent Automation Activity" description="Last 50 automation actions fired (audit log)">
          {activityLoading && <IntelligenceLoadingSkeleton rows={4} cardHeight="h-14" />}
          {!activityLoading && activities.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No automation activity yet.</p>
          )}
          {activities.length > 0 && (
            <div className="divide-y">
              {activities.map(a => (
                <button
                  key={a.id}
                  onClick={() => setDrawer({ label: a.message, timestamp: a.fired_at, explainability: a.explainability })}
                  className="w-full text-left py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize shrink-0">{a.action_type}</Badge>
                        <span className="text-xs text-muted-foreground capitalize shrink-0">{a.entity_type}</span>
                      </div>
                      <p className="text-sm truncate">{a.message}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SeverityBadge severity={a.severity} />
                      <span className="text-xs text-muted-foreground">{fmtDate(a.fired_at)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
      <ExplainabilityDrawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        title={drawer?.label ?? 'Intelligence Details'}
        explainability={drawer?.explainability}
      >
        {drawer && <p className="text-xs text-muted-foreground">{fmtDate(drawer.timestamp)}</p>}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Security Tab ──────────────────────────────────────────────────────────────

function SecurityTab() {
  const [drawer, setDrawer] = useState<DrawerItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['operations', 'security', 'signals'],
    queryFn:  () => api.get<{ signals: SecuritySignal[] }>('/operations/security/signals'),
  })

  const signals = data?.signals ?? []

  return (
    <>
      <SectionCard title="Security Intelligence Signals" description="Passive behavioral anomaly detection — advisory only">
        {isLoading && <IntelligenceLoadingSkeleton rows={4} cardHeight="h-14" />}
        {!isLoading && signals.length === 0 && (
          <div className="py-10 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500" />
            <p className="text-sm text-muted-foreground">No security signals detected</p>
          </div>
        )}
        {signals.length > 0 && (
          <div className="divide-y">
            {signals.map((s, i) => (
              <button
                key={i}
                onClick={() => setDrawer({ label: s.description, timestamp: s.detected_at, explainability: s.explainability })}
                className="w-full text-left py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono shrink-0">
                        {s.signal_type.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground shrink-0">{truncateId(s.entity_id)}</span>
                    </div>
                    <p className="text-sm truncate">{s.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SeverityBadge severity={s.severity} />
                    <span className="text-xs text-muted-foreground">{fmtDate(s.detected_at)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>
      <ExplainabilityDrawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        title={drawer?.label ?? 'Intelligence Details'}
        explainability={drawer?.explainability}
      >
        {drawer && <p className="text-xs text-muted-foreground">{fmtDate(drawer.timestamp)}</p>}
      </ExplainabilityDrawer>
    </>
  )
}

// ── Main Workspace ────────────────────────────────────────────────────────────

export default function OperationalIntelligenceWorkspace() {
  const { data: summary } = useQuery({
    queryKey: ['operations', 'summary'],
    queryFn:  () => api.get<OperationalSummaryData>('/operations/summary'),
    refetchInterval: 60_000,  // refresh every 60s
  })

  return (
    <PageContainer>
      <PageHeader
        title="Operational Intelligence"
        subtitle="Enterprise operational health & controlled automation — Sprint 4"
      />

      <SummaryStrip summary={summary} />

      <Tabs defaultValue="health" className="mt-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="health"      className="gap-1.5"><Activity className="h-3.5 w-3.5" />Health</TabsTrigger>
          <TabsTrigger value="heatmaps"    className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Heatmaps</TabsTrigger>
          <TabsTrigger value="sla"         className="gap-1.5"><Clock className="h-3.5 w-3.5" />SLA</TabsTrigger>
          <TabsTrigger value="simulations" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" />Simulations</TabsTrigger>
          <TabsTrigger value="automation"  className="gap-1.5"><Zap className="h-3.5 w-3.5" />Automation</TabsTrigger>
          <TabsTrigger value="security"    className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" />Security</TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="health">
            <HealthTab />
          </TabsContent>
          <TabsContent value="heatmaps">
            <HeatmapsTab />
          </TabsContent>
          <TabsContent value="sla">
            <SlaTab />
          </TabsContent>
          <TabsContent value="simulations">
            <SimulationsTab />
          </TabsContent>
          <TabsContent value="automation">
            <AutomationTab />
          </TabsContent>
          <TabsContent value="security">
            <SecurityTab />
          </TabsContent>
        </div>
      </Tabs>
    </PageContainer>
  )
}
