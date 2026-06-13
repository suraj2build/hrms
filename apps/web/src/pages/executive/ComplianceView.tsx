import { useQuery } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, AlertTriangle, FileWarning, Gauge, ClipboardCheck, ScrollText, TrendingUp } from 'lucide-react'
import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, Panel, EmptyBody, StatTile, PALETTE } from '@/components/exec/ExecShell'

interface ComplianceData {
  open_incidents: number; critical_incidents: number; total_incidents_30d: number
  open_exceptions: number; sla_breached_30d: number; sla_breach_rate: number
  trust_high_risk: number; trust_medium_risk: number; trust_at_risk: number
  trust_total: number; trust_verified: number; trust_verification_pct: number
  gov_total_30d: number; gov_by_severity: Record<string, number>
  open_duplicates: number; compliance_risk_score: number; risk_status: 'low' | 'medium' | 'high'
  // R2 — Risk Posture Index
  posture_index?: number
  posture_band?: 'low' | 'medium' | 'high' | 'critical'
  posture_components?: Record<'trust' | 'compliance' | 'governance' | 'security' | 'privacy' | 'certification', { score: number; weight: number }>
  // O5.9
  avg_trust_score: number | null
  trust_distribution: Record<string, number>
  trust_trend: Array<{ month: string; avg_score: number }>
  // P3.5 — workforce lifecycle expiry exposure
  lifecycle?: {
    expiry_risk_index: number
    total_at_risk: number
    overdue: number
    due_7: number
    due_30: number
    documentation_health: number
    documents_at_risk: number
    contract_exposure: number
    probation_exposure: number
  }
}

const RISK_TONE: Record<string, { ring: string; text: string; fill: string }> = {
  low:      { ring: 'text-success',     text: 'text-success',     fill: 'var(--success)' },
  medium:   { ring: 'text-warning',     text: 'text-warning',     fill: 'var(--warning)' },
  high:     { ring: 'text-destructive', text: 'text-destructive', fill: 'var(--destructive)' },
  critical: { ring: 'text-destructive', text: 'text-destructive', fill: 'var(--destructive)' },
}

const POSTURE_LABELS: Record<string, string> = {
  trust: 'Trust', compliance: 'Compliance', governance: 'Governance',
  security: 'Security', privacy: 'Privacy', certification: 'Certification',
}

interface CalDeadline { id: string; label: string; compliance_type: string; jurisdiction: string; due_date: string; status: string; days_to_due: number }

export default function ComplianceView() {
  const { data: c } = useQuery<ComplianceData>({ queryKey: ['exec-compliance'], queryFn: () => api.get('/executive/compliance').then((r: any) => r.data ?? r), staleTime: 5 * 60_000 })
  const { data: cal } = useQuery<{ data: CalDeadline[] }>({ queryKey: ['exec-compliance-calendar'], queryFn: () => api.get('/compliance/calendar/upcoming?within_days=30'), staleTime: 5 * 60_000 })
  const deadlines = cal?.data ?? []
  const overdue   = deadlines.filter(d => d.status === 'overdue')
  const dueSoon   = deadlines.filter(d => d.status === 'due_soon')

  const score = c?.compliance_risk_score ?? 0
  const status = c?.risk_status ?? 'low'
  const tone = RISK_TONE[status]
  const gauge = [{ name: 'score', value: score, fill: tone.fill }]

  const lc = c?.lifecycle
  const lcStatus = !lc ? 'low' : lc.expiry_risk_index >= 50 ? 'high' : lc.expiry_risk_index >= 20 ? 'medium' : 'low'
  const lcTone = RISK_TONE[lcStatus]

  const sevEntries = Object.entries(c?.gov_by_severity ?? {})

  const postureIdx  = c?.posture_index ?? 0
  const postureBand = c?.posture_band ?? 'low'
  const postureTone = RISK_TONE[postureBand]
  const postureGauge = [{ name: 'posture', value: postureIdx, fill: postureTone.fill }]
  const postureComps = c?.posture_components
    ? (['compliance', 'trust', 'governance', 'security', 'privacy', 'certification'] as const)
        .map(k => ({ key: k, ...c.posture_components![k] }))
    : []

  return (
    <ExecLayout title="Compliance & Risk" subtitle="Statutory risk, incidents and governance posture · live data">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Risk Posture Index" value={c?.posture_index != null ? `${postureIdx}` : '—'} icon={ShieldAlert} tone={postureBand === 'high' || postureBand === 'critical' ? 'destructive' : postureBand === 'medium' ? 'warning' : 'success'} hint={`${postureBand} · 6-domain composite`} />
        <KpiCard label="Compliance Score" value={c ? `${score}` : '—'} icon={Gauge} tone={status === 'high' ? 'destructive' : status === 'medium' ? 'warning' : 'success'} hint={`Risk: ${status}`} />
        <KpiCard label="Open Breaches" value={(c?.sla_breached_30d ?? 0).toLocaleString()} icon={FileWarning} tone="destructive" hint={c ? `${(c.sla_breach_rate * 100).toFixed(0)}% breach rate` : undefined} />
        <KpiCard label="Open Incidents" value={(c?.open_incidents ?? 0).toLocaleString()} icon={AlertTriangle} tone="info" hint={c ? `${c.critical_incidents} critical` : undefined} />
      </section>

      {/* R2 — Risk Posture Index: canonical 6-domain composite */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel icon={ShieldAlert} iconClass={postureTone.text} title="Risk Posture Index" subtitle="Weighted composite of six risk domains (0–100, higher = more risk)">
          {c?.posture_index != null ? (
            <>
              <div className="relative mx-auto mt-2 h-52 w-52">
                <ResponsiveContainer>
                  <RadialBarChart innerRadius="72%" outerRadius="100%" data={postureGauge} startAngle={90} endAngle={-270}>
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar background={{ fill: 'var(--muted)' }} dataKey="value" cornerRadius={12} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className={`text-4xl font-bold tabular-nums ${postureTone.text}`}>{postureIdx}</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{postureBand} risk</div>
                </div>
              </div>
            </>
          ) : <EmptyBody text="Risk posture index appears once the compliance snapshot is generated." />}
        </Panel>

        <Panel className="xl:col-span-2" icon={Gauge} iconClass="text-primary" title="Posture Breakdown" subtitle="Per-domain risk contribution · sorted by weight">
          {postureComps.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {postureComps.map(({ key, score: s, weight }) => {
                const color = s >= 50 ? 'var(--destructive)' : s >= 25 ? 'var(--warning)' : 'var(--success)'
                return (
                  <div key={key}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{POSTURE_LABELS[key]} <span className="text-muted-foreground">· {(weight * 100).toFixed(0)}% wt</span></span>
                      <span className="font-medium tabular-nums">{s}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${s}%`, background: color }} /></div>
                  </div>
                )
              })}
            </div>
          ) : <EmptyBody text="Per-domain breakdown appears once the compliance snapshot is generated." />}
        </Panel>
      </section>

      {/* Risk posture (real radial) + Statutory matrix (empty) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel icon={ShieldCheck} iconClass={tone.text} title="Risk Posture" subtitle="Composite compliance score (0–100)">
          {c ? (
            <>
              <div className="relative mx-auto mt-2 h-52 w-52">
                <ResponsiveContainer>
                  <RadialBarChart innerRadius="72%" outerRadius="100%" data={gauge} startAngle={90} endAngle={-270}>
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar background={{ fill: 'var(--muted)' }} dataKey="value" cornerRadius={12} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className={`text-4xl font-bold tabular-nums ${tone.text}`}>{score}</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{status} risk</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <StatTile label="Trust Verified" value={`${c.trust_verification_pct.toFixed(0)}%`} tone="success" />
                <StatTile label="Open Duplicates" value={c.open_duplicates.toLocaleString()} tone="muted" />
              </div>
            </>
          ) : <EmptyBody text="Risk posture will appear once the compliance snapshot is generated." />}
        </Panel>

        <Panel className="xl:col-span-2" icon={ClipboardCheck} iconClass="text-primary" title="Statutory Filing Deadlines" subtitle="EPF / ESI / PT / TDS / LWF / 24Q · next 30 days + overdue">
          {deadlines.length === 0 ? (
            <EmptyBody text="No statutory filings due in the next 30 days. Enable PF/ESI/PT/TDS (and LWF states) in statutory settings to populate this." />
          ) : (
            <div className="mt-2">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <StatTile label="Overdue" value={overdue.length.toLocaleString()} tone={overdue.length ? 'destructive' : 'muted'} />
                <StatTile label="Due This Week" value={dueSoon.length.toLocaleString()} tone="warning" />
                <StatTile label="Due This Month" value={(deadlines.length - overdue.length).toLocaleString()} tone="muted" />
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {deadlines.slice(0, 12).map(d => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{d.label}</p>
                      <p className="text-[10px] text-muted-foreground">{d.jurisdiction} · {d.compliance_type}</p>
                    </div>
                    <span className={`text-[11px] font-medium tabular-nums whitespace-nowrap ${d.status === 'overdue' ? 'text-destructive' : d.status === 'due_soon' ? 'text-warning' : 'text-muted-foreground'}`}>
                      {d.status === 'overdue' ? `${Math.abs(d.days_to_due)}d late` : `in ${d.days_to_due}d`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </section>

      {/* P3.5 — Workforce Lifecycle Exposure (single source: lifecycle-expiry) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel icon={Gauge} iconClass={lc && lc.expiry_risk_index >= 50 ? 'text-destructive' : lc && lc.expiry_risk_index >= 20 ? 'text-warning' : 'text-success'} title="Expiry Risk Index" subtitle="Composite lifecycle exposure (0–100)">
          {lc ? (
            <>
              <div className="relative mx-auto mt-2 h-52 w-52">
                <ResponsiveContainer>
                  <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: 'idx', value: lc.expiry_risk_index, fill: lcTone.fill }]} startAngle={90} endAngle={-270}>
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar background={{ fill: 'var(--muted)' }} dataKey="value" cornerRadius={12} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className={`text-4xl font-bold tabular-nums ${lcTone.text}`}>{lc.expiry_risk_index}</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{lc.total_at_risk} at risk</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <StatTile label="Overdue" value={lc.overdue.toLocaleString()} tone={lc.overdue ? 'destructive' : 'muted'} />
                <StatTile label="Due ≤7d" value={lc.due_7.toLocaleString()} tone="warning" />
                <StatTile label="Due ≤30d" value={lc.due_30.toLocaleString()} tone="muted" />
              </div>
            </>
          ) : <EmptyBody text="Lifecycle exposure appears once documents, contracts or probation records carry expiry dates." />}
        </Panel>

        <Panel className="xl:col-span-2" icon={ClipboardCheck} iconClass="text-primary" title="Lifecycle Exposure Breakdown" subtitle="Documentation health · contract & probation exposure">
          {lc ? (
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-2">
              <StatTile label="Documentation Health" value={`${lc.documentation_health}/100`} tone={lc.documentation_health >= 80 ? 'success' : lc.documentation_health >= 50 ? 'warning' : 'destructive'} />
              <StatTile label="Documents at Risk" value={lc.documents_at_risk.toLocaleString()} tone={lc.documents_at_risk ? 'warning' : 'muted'} />
              <StatTile label="Contract Exposure" value={lc.contract_exposure.toLocaleString()} tone={lc.contract_exposure ? 'warning' : 'muted'} />
              <StatTile label="Probation Exposure" value={lc.probation_exposure.toLocaleString()} tone={lc.probation_exposure ? 'warning' : 'muted'} />
            </div>
          ) : <EmptyBody text="No workforce lifecycle exposure to report. Capture expiry dates on documents, identity records, passports/visas and contracts to populate this." />}
        </Panel>
      </section>

      {/* Incidents by severity (real) + Governance log (empty) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel icon={AlertTriangle} iconClass="text-warning" title="Governance Events by Severity" subtitle="Last 30 days">
          {sevEntries.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {sevEntries.map(([sev, n], i) => {
                const max = Math.max(...sevEntries.map(([, v]) => v))
                return (
                  <div key={sev}>
                    <div className="mb-1 flex justify-between text-xs"><span className="capitalize">{sev}</span><span className="font-medium tabular-nums">{n}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${max ? (n / max) * 100 : 0}%`, background: PALETTE[i % PALETTE.length] }} /></div>
                  </div>
                )
              })}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <StatTile label="Total (30d)" value={(c?.gov_total_30d ?? 0).toLocaleString()} tone="muted" />
                <StatTile label="Incidents (30d)" value={(c?.total_incidents_30d ?? 0).toLocaleString()} tone="muted" />
                <StatTile label="Open Exceptions" value={(c?.open_exceptions ?? 0).toLocaleString()} tone="destructive" />
              </div>
            </div>
          ) : <EmptyBody text="No governance events recorded in the last 30 days." />}
        </Panel>

        <Panel icon={ScrollText} iconClass="text-info" title="Governance Audit Log" subtitle="Recent governance actions">
          <EmptyBody text="An itemised governance audit log isn't surfaced in the executive view — only roll-up counts are available. The detailed log lives in the governance module." />
        </Panel>
      </section>

      {/* O5.9 — Trust Intelligence Panel */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel icon={ShieldCheck} iconClass="text-primary" title="Trust Distribution" subtitle="Employees by trust risk severity">
          {c && Object.keys(c.trust_distribution ?? {}).length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {(['low', 'medium', 'high', 'critical'] as const)
                .filter(s => (c.trust_distribution?.[s] ?? 0) > 0)
                .map((sev, i) => {
                  const n   = c.trust_distribution[sev] ?? 0
                  const max = Math.max(...Object.values(c.trust_distribution))
                  const color = sev === 'low' ? 'var(--success)' : sev === 'medium' ? 'var(--warning)' : 'var(--destructive)'
                  return (
                    <div key={sev}>
                      <div className="mb-1 flex justify-between text-xs capitalize"><span>{sev} risk</span><span className="font-medium tabular-nums">{n}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${max ? (n / max) * 100 : 0}%`, background: color }} /></div>
                    </div>
                  )
                })}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <StatTile label="Avg Trust Score" value={c.avg_trust_score != null ? `${c.avg_trust_score}/100` : '—'} tone="muted" />
                <StatTile label="Verified" value={`${c.trust_verification_pct.toFixed(0)}%`} tone="success" />
              </div>
            </div>
          ) : <EmptyBody text="Trust scores are computed when identity verification runs. No employee scores yet." />}
        </Panel>

        <Panel icon={TrendingUp} iconClass="text-info" title="Trust Score Trend" subtitle="Average trust score · last 6 months">
          {c && (c.trust_trend ?? []).length > 0 ? (
            <div className="mt-3 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={c.trust_trend} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={28} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="avg_score" stroke="var(--primary)" strokeWidth={2} dot={false} name="Avg score" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyBody text="Trust trend data requires at least one month of scored employees." />}
        </Panel>
      </section>
    </ExecLayout>
  )
}
