import { useQuery } from '@tanstack/react-query'
import { Users2, Heart, GraduationCap, Network, Lightbulb, ShieldCheck, CalendarCheck, Sparkles, ChevronRight } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, Panel, EmptyBody, StatTile, TIP, PALETTE } from '@/components/exec/ExecShell'

interface ChroSnapshot {
  gender_distribution: Record<string, number>
  employment_type_distribution: Record<string, number>
  leave_utilization_pct: number; trust_high_risk: number; narrative: string
  trust_verified?: number; trust_total?: number; trust_verification_pct?: number
  pending_revisions?: number; approved_revisions?: number
}

export default function ChroView() {
  const { data: chro } = useQuery<ChroSnapshot>({ queryKey: ['exec-chro'], queryFn: () => api.get('/executive/chro').then((r: any) => r.data ?? r), staleTime: 5 * 60_000 })

  const gender = Object.entries(chro?.gender_distribution ?? {}).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] }))
  const genderTotal = gender.reduce((s, g) => s + g.value, 0)
  const femalePct = genderTotal > 0 ? ((gender.find(g => /female|^f$/i.test(g.name))?.value ?? 0) / genderTotal) * 100 : null

  return (
    <ExecLayout title="People & Culture (CHRO)" subtitle="Engagement, diversity, development and succession · live where available">
      {/* KPIs — most are gaps; leave / trust / diversity are real */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Leave Utilisation" value={chro ? `${chro.leave_utilization_pct.toFixed(0)}%` : '—'} icon={CalendarCheck} tone="primary" hint="Of entitlement" />
        <KpiCard label="Diversity (F)" value={femalePct == null ? '—' : `${femalePct.toFixed(1)}%`} icon={Sparkles} tone="info" hint="Org-wide" />
        <KpiCard label="Trust High-Risk" value={(chro?.trust_high_risk ?? 0).toLocaleString()} icon={ShieldCheck} tone="warning" hint={chro?.trust_verification_pct != null ? `${chro.trust_verification_pct.toFixed(0)}% verified` : undefined} />
        <KpiCard label="Engagement (eNPS)" value="—" icon={Heart} tone="success" hint="Survey not wired" />
      </section>

      {/* Diversity (real pie) + Engagement trend (empty) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel icon={Users2} iconClass="text-primary" title="Gender Diversity" subtitle="Org-wide distribution">
          {gender.length > 0 ? (
            <>
              <div className="mt-2 h-52">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={gender} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="var(--background)" strokeWidth={2}>
                      {gender.map(g => <Cell key={g.name} fill={g.color} />)}
                    </Pie>
                    <Tooltip contentStyle={TIP} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-2">
                {gender.map(g => (
                  <div key={g.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} /><span className="capitalize">{g.name}</span></div>
                    <span className="font-medium tabular-nums text-muted-foreground">{g.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyBody text="No gender distribution data." />}
        </Panel>

        <Panel className="xl:col-span-2" icon={Heart} iconClass="text-destructive" title="Engagement Trend" subtitle="eNPS & engagement score over time">
          <EmptyBody text="Engagement and eNPS trends need the engagement survey module, which isn't wired up yet." />
        </Panel>
      </section>

      {/* Performance distribution (empty) + L&D (empty) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel icon={Users2} iconClass="text-info" title="Performance Distribution" subtitle="Rating bands across the org">
          <EmptyBody text="Performance rating distribution needs the performance-review module, which isn't enabled yet." />
        </Panel>
        <Panel icon={GraduationCap} iconClass="text-success" title="Learning & Development" subtitle="Training coverage & hours">
          <EmptyBody text="L&D coverage (training hours, completion, certifications) isn't tracked in the executive view yet." />
        </Panel>
      </section>

      {/* Succession (empty) + AI insight (real narrative) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" icon={Network} iconClass="text-primary" title="Succession Pipeline" subtitle="Bench strength for key roles">
          <EmptyBody text="Succession planning (key roles, ready-now successors, bench strength) needs the talent module, which isn't wired up yet." />
        </Panel>

        <Panel icon={Lightbulb} iconClass="text-warning" title="CHRO Insight">
          {chro?.narrative ? (
            <div className="mt-3 rounded-xl border border-success/30 bg-success/5 p-3">
              <div className="mb-1 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Auto-generated</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className="text-xs leading-relaxed text-muted-foreground">{chro.narrative}</p>
              {(chro.pending_revisions != null || chro.approved_revisions != null) && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatTile label="Pending Revisions" value={(chro.pending_revisions ?? 0).toLocaleString()} tone="warning" />
                  <StatTile label="Approved" value={(chro.approved_revisions ?? 0).toLocaleString()} tone="success" />
                </div>
              )}
            </div>
          ) : <EmptyBody text="The CHRO narrative will appear once the snapshot is generated." />}
        </Panel>
      </section>
    </ExecLayout>
  )
}
