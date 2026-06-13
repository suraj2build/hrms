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
  // O5.9
  avg_trust_score: number | null
  trust_distribution: Record<string, number>
  trust_trend: Array<{ month: string; avg_score: number }>
}

const RISK_TONE: Record<string, { ring: string; text: string; fill: string }> = {
  low:    { ring: 'text-success',     text: 'text-success',     fill: 'var(--success)' },
  medium: { ring: 'text-warning',     text: 'text-warning',     fill: 'var(--warning)' },
  high:   { ring: 'text-destructive', text: 'text-destructive', fill: 'var(--destructive)' },
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

  const sevEntries = Object.entries(c?.gov_by_severity ?? {})

  return (
    <ExecLayout title="Compliance & Risk" subtitle="Statutory risk, incidents and governance posture · live data">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Compliance Score" value={c ? `${score}` : '—'} icon={Gauge} tone={status === 'high' ? 'destructive' : status === 'medium' ? 'warning' : 'success'} hint={`Risk: ${status}`} />
        <KpiCard label="Open Breaches" value={(c?.sla_breached_30d ?? 0).toLocaleString()} icon={FileWarning} tone="destructive" hint={c ? `${(c.sla_breach_rate * 100).toFixed(0)}% breach rate` : undefined} />
        <KpiCard label="At-Risk (Trust)" value={(c?.trust_at_risk ?? 0).toLocaleString()} icon={ShieldAlert} tone="warning" hint={c ? `${c.trust_high_risk} high · ${c.trust_medium_risk} med` : undefined} />
        <KpiCard label="Open Incidents" value={(c?.open_incidents ?? 0).toLocaleString()} icon={AlertTriangle} tone="info" hint={c ? `${c.critical_incidents} critical` : undefined} />
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
              <div className="grid grid-cols-2 gap-3 mb-3">
                <StatTile label="Overdue" value={overdue.length.toLocaleString()} tone={overdue.length ? 'destructive' : 'muted'} />
                <StatTile label="Due in 30 days" value={dueSoon.length ? dueSoon.length.toLocaleString() : (deadlines.length - overdue.length).toLocaleString()} tone="warning" />
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
