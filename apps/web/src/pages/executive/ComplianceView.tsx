import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, AlertTriangle, FileWarning, Gauge, ClipboardCheck, TrendingUp } from 'lucide-react'
import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, StatTile } from '@/components/exec/ExecShell'
import { Viz, ChartTip, NoData, PeriodSlicer } from '@/components/exec/viz'
import { CAT, GRID, AXIS, slicePeriod, type Period } from '@/components/exec/exec-utils'

interface ComplianceData {
  open_incidents: number; critical_incidents: number; total_incidents_30d: number
  open_exceptions: number; sla_breached_30d: number; sla_breach_rate: number
  trust_high_risk: number; trust_medium_risk: number; trust_at_risk: number
  trust_total: number; trust_verified: number; trust_verification_pct: number
  gov_total_30d: number; gov_by_severity: Record<string, number>
  open_duplicates: number; compliance_risk_score: number; risk_status: 'low' | 'medium' | 'high'
  posture_index?: number
  posture_band?: 'low' | 'medium' | 'high' | 'critical'
  posture_components?: Record<'trust' | 'compliance' | 'governance' | 'security' | 'privacy' | 'certification', { score: number; weight: number }>
  avg_trust_score: number | null
  trust_distribution: Record<string, number>
  trust_trend: Array<{ month: string; avg_score: number }>
  lifecycle?: {
    expiry_risk_index: number; total_at_risk: number; overdue: number; due_7: number; due_30: number
    documentation_health: number; documents_at_risk: number; contract_exposure: number; probation_exposure: number
  }
}

const RISK_TONE: Record<string, { text: string; fill: string }> = {
  low: { text: 'text-success', fill: 'var(--success)' },
  medium: { text: 'text-warning', fill: 'var(--warning)' },
  high: { text: 'text-destructive', fill: 'var(--destructive)' },
  critical: { text: 'text-destructive', fill: 'var(--destructive)' },
}
const POSTURE_LABELS: Record<string, string> = {
  trust: 'Trust', compliance: 'Compliance', governance: 'Governance',
  security: 'Security', privacy: 'Privacy', certification: 'Certification',
}

interface CalDeadline { id: string; label: string; compliance_type: string; jurisdiction: string; due_date: string; status: string; days_to_due: number }

function RiskGauge({ value, fill, text, caption }: { value: number; fill: string; text: string; caption: string }) {
  return (
    <div className="relative mx-auto mt-1 h-44 w-44">
      <ResponsiveContainer>
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: 'v', value, fill }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background={{ fill: 'var(--muted)' }} dataKey="value" cornerRadius={12} angleAxisId={0} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`text-4xl font-bold tabular-nums ${text}`}>{value}</div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{caption}</div>
      </div>
    </div>
  )
}

export default function ComplianceView() {
  const [period, setPeriod] = useState<Period>('12M')
  const { data: c } = useQuery<ComplianceData>({ queryKey: ['exec-compliance'], queryFn: () => api.get<{ data?: ComplianceData } & ComplianceData>('/executive/compliance').then((r) => r.data ?? r), staleTime: 5 * 60_000 })
  const { data: cal } = useQuery<{ data: CalDeadline[] }>({ queryKey: ['exec-compliance-calendar'], queryFn: () => api.get('/compliance/calendar/upcoming?within_days=30'), staleTime: 5 * 60_000 })
  const deadlines = cal?.data ?? []
  const overdue = deadlines.filter(d => d.status === 'overdue')
  const dueSoon = deadlines.filter(d => d.status === 'due_soon')

  const score = c?.compliance_risk_score ?? 0
  const status = c?.risk_status ?? 'low'
  const tone = RISK_TONE[status]

  const lc = c?.lifecycle
  const lcStatus = !lc ? 'low' : lc.expiry_risk_index >= 50 ? 'high' : lc.expiry_risk_index >= 20 ? 'medium' : 'low'
  const lcTone = RISK_TONE[lcStatus]

  const sevEntries = Object.entries(c?.gov_by_severity ?? {})
  const postureIdx = c?.posture_index ?? 0
  const postureBand = c?.posture_band ?? 'low'
  const postureTone = RISK_TONE[postureBand]
  const postureComps = c?.posture_components
    ? (['compliance', 'trust', 'governance', 'security', 'privacy', 'certification'] as const).map(k => ({ key: k, ...c.posture_components![k] }))
    : []

  return (
    <ExecLayout title="Compliance & Risk" subtitle="Statutory risk, incidents and governance posture · live data"
      actions={<PeriodSlicer value={period} onChange={setPeriod} />}>
      {/* KPI ribbon */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Risk Posture Index" value={c?.posture_index != null ? `${postureIdx}` : '—'} icon={ShieldAlert} tone={postureBand === 'high' || postureBand === 'critical' ? 'destructive' : postureBand === 'medium' ? 'warning' : 'success'} deltaLabel={`${postureBand} · composite`} />
        <KpiCard label="Compliance Score" value={c ? `${score}` : '—'} icon={Gauge} tone={status === 'high' ? 'destructive' : status === 'medium' ? 'warning' : 'success'} deltaLabel={`Risk: ${status}`} />
        <KpiCard label="Open Breaches" value={c ? c.sla_breached_30d.toLocaleString() : '—'} icon={FileWarning} tone="destructive" hint={c ? `${c.sla_breach_rate.toFixed(0)}% rate` : undefined} />
        <KpiCard label="Open Incidents" value={c ? c.open_incidents.toLocaleString() : '—'} icon={AlertTriangle} tone="info" hint={c ? `${c.critical_incidents} critical` : undefined} />
      </section>

      {/* Risk posture composite */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-4" icon={ShieldAlert} title="Risk Posture Index" sub="6-domain weighted composite (0–100)">
          {c?.posture_index != null ? <RiskGauge value={postureIdx} fill={postureTone.fill} text={postureTone.text} caption={`${postureBand} risk`} />
            : <NoData text="Risk posture index appears once the compliance snapshot is generated." />}
        </Viz>

        <Viz className="lg:col-span-8" icon={Gauge} title="Posture Breakdown" sub="Per-domain risk contribution · sorted by weight">
          {postureComps.length > 0 ? (
            <div className="space-y-2.5">
              {postureComps.map(({ key, score: s, weight }) => {
                const color = s >= 50 ? 'var(--destructive)' : s >= 25 ? 'var(--warning)' : 'var(--success)'
                return (
                  <div key={key}>
                    <div className="mb-1 flex justify-between text-xs"><span>{POSTURE_LABELS[key]} <span className="text-muted-foreground">· {(weight * 100).toFixed(0)}% wt</span></span><span className="font-medium tabular-nums">{s}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${s}%`, background: color }} /></div>
                  </div>
                )
              })}
            </div>
          ) : <NoData text="Per-domain breakdown appears once the compliance snapshot is generated." />}
        </Viz>
      </section>

      {/* Compliance score + statutory deadlines */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-4" icon={ShieldCheck} title="Compliance Score" sub="Composite compliance score (0–100)">
          {c ? (
            <>
              <RiskGauge value={score} fill={tone.fill} text={tone.text} caption={`${status} risk`} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatTile label="Trust Verified" value={`${c.trust_verification_pct.toFixed(0)}%`} tone="success" />
                <StatTile label="Open Duplicates" value={c.open_duplicates.toLocaleString()} tone="muted" />
              </div>
            </>
          ) : <NoData text="Risk posture appears once the compliance snapshot is generated." />}
        </Viz>

        <Viz className="lg:col-span-8" icon={ClipboardCheck} title="Statutory Filing Deadlines" sub="EPF / ESI / PT / TDS / LWF / 24Q · next 30 days + overdue">
          {deadlines.length === 0 ? (
            <NoData text="No statutory filings due in the next 30 days. Enable PF/ESI/PT/TDS (and LWF states) in statutory settings to populate this." />
          ) : (
            <div>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <StatTile label="Overdue" value={overdue.length.toLocaleString()} tone={overdue.length ? 'destructive' : 'muted'} />
                <StatTile label="Due This Week" value={dueSoon.length.toLocaleString()} tone="warning" />
                <StatTile label="Due This Month" value={(deadlines.length - overdue.length).toLocaleString()} tone="muted" />
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {deadlines.map(d => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5">
                    <div className="min-w-0"><p className="truncate text-xs font-medium">{d.label}</p><p className="text-[10px] text-muted-foreground">{d.jurisdiction} · {d.compliance_type}</p></div>
                    <span className={`whitespace-nowrap text-[11px] font-medium tabular-nums ${d.status === 'overdue' ? 'text-destructive' : d.status === 'due_soon' ? 'text-warning' : 'text-muted-foreground'}`}>
                      {d.status === 'overdue' ? `${Math.abs(d.days_to_due)}d late` : `in ${d.days_to_due}d`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Viz>
      </section>

      {/* Lifecycle exposure */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-4" icon={Gauge} title="Expiry Risk Index" sub="Composite lifecycle exposure (0–100)">
          {lc ? (
            <>
              <RiskGauge value={lc.expiry_risk_index} fill={lcTone.fill} text={lcTone.text} caption={`${lc.total_at_risk} at risk`} />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <StatTile label="Overdue" value={lc.overdue.toLocaleString()} tone={lc.overdue ? 'destructive' : 'muted'} />
                <StatTile label="Due ≤7d" value={lc.due_7.toLocaleString()} tone="warning" />
                <StatTile label="Due ≤30d" value={lc.due_30.toLocaleString()} tone="muted" />
              </div>
            </>
          ) : <NoData text="Lifecycle exposure appears once documents, contracts or probation records carry expiry dates." />}
        </Viz>

        <Viz className="lg:col-span-8" icon={ClipboardCheck} title="Lifecycle Exposure Breakdown" sub="Documentation health · contract & probation exposure">
          {lc ? (
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Documentation Health" value={`${lc.documentation_health}/100`} tone={lc.documentation_health >= 80 ? 'success' : lc.documentation_health >= 50 ? 'warning' : 'destructive'} />
              <StatTile label="Documents at Risk" value={lc.documents_at_risk.toLocaleString()} tone={lc.documents_at_risk ? 'warning' : 'muted'} />
              <StatTile label="Contract Exposure" value={lc.contract_exposure.toLocaleString()} tone={lc.contract_exposure ? 'warning' : 'muted'} />
              <StatTile label="Probation Exposure" value={lc.probation_exposure.toLocaleString()} tone={lc.probation_exposure ? 'warning' : 'muted'} />
            </div>
          ) : <NoData text="No workforce lifecycle exposure to report. Capture expiry dates on documents, identity records and contracts to populate this." />}
        </Viz>
      </section>

      {/* Governance severity + trust */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-4" icon={AlertTriangle} title="Governance Events" sub="By severity · last 30 days">
          {sevEntries.length > 0 ? (
            <div className="space-y-2.5">
              {sevEntries.map(([sev, n], i) => {
                const max = Math.max(...sevEntries.map(([, v]) => v))
                return (
                  <div key={sev}>
                    <div className="mb-1 flex justify-between text-xs"><span className="capitalize">{sev}</span><span className="font-medium tabular-nums">{n}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${max ? (n / max) * 100 : 0}%`, background: CAT[i % CAT.length] }} /></div>
                  </div>
                )
              })}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <StatTile label="Total 30d" value={(c?.gov_total_30d ?? 0).toLocaleString()} tone="muted" />
                <StatTile label="Incidents" value={(c?.total_incidents_30d ?? 0).toLocaleString()} tone="muted" />
                <StatTile label="Exceptions" value={(c?.open_exceptions ?? 0).toLocaleString()} tone="destructive" />
              </div>
            </div>
          ) : <NoData text="No governance events recorded in the last 30 days." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={ShieldCheck} title="Trust Distribution" sub="Employees by trust risk severity">
          {c && Object.keys(c.trust_distribution ?? {}).length > 0 ? (
            <div className="space-y-2.5">
              {(['low', 'medium', 'high', 'critical'] as const).filter(s => (c.trust_distribution?.[s] ?? 0) > 0).map((sev) => {
                const n = c.trust_distribution[sev] ?? 0
                const max = Math.max(...Object.values(c.trust_distribution))
                const color = sev === 'low' ? 'var(--success)' : sev === 'medium' ? 'var(--warning)' : 'var(--destructive)'
                return (
                  <div key={sev}>
                    <div className="mb-1 flex justify-between text-xs capitalize"><span>{sev} risk</span><span className="font-medium tabular-nums">{n}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${max ? (n / max) * 100 : 0}%`, background: color }} /></div>
                  </div>
                )
              })}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <StatTile label="Avg Trust" value={c.avg_trust_score != null ? `${c.avg_trust_score}/100` : '—'} tone="muted" />
                <StatTile label="Verified" value={`${c.trust_verification_pct.toFixed(0)}%`} tone="success" />
              </div>
            </div>
          ) : <NoData text="Trust scores are computed when identity verification runs. No employee scores yet." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={TrendingUp} title="Trust Score Trend" sub="Average trust score · last 6 months">
          {c && (c.trust_trend ?? []).length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer>
                <LineChart data={slicePeriod(c.trust_trend, period)} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Line type="monotone" dataKey="avg_score" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 2 }} name="Avg score" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Trust trend requires at least one month of scored employees." />}
        </Viz>
      </section>
    </ExecLayout>
  )
}
