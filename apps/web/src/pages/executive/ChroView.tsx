import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users2, Sparkles, ShieldCheck, CalendarCheck, Lightbulb, ChevronRight, UserPlus, Clock, Briefcase, Filter, Layers, BadgeCheck } from 'lucide-react'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, StatTile } from '@/components/exec/ExecShell'
import { Viz, DonutBlock, NoData } from '@/components/exec/viz'
import { CAT, genderColor, tc } from '@/components/exec/exec-utils'

interface HiringFunnel {
  applied: number; screening: number; interviewing: number; offer: number; hired: number; rejected: number; withdrawn: number
}

interface ChroSnapshot {
  gender_distribution: Record<string, number>
  employment_type_distribution: Record<string, number>
  leave_utilization_pct: number; trust_high_risk: number; narrative: string
  trust_verified?: number; trust_total?: number; trust_verification_pct?: number
  pending_revisions?: number; approved_revisions?: number
  recruitment_active?: boolean
  hiring_funnel?: HiringFunnel
  offers_extended?: number; offers_accepted?: number; offer_acceptance_rate?: number
  avg_time_to_offer?: number | null; avg_time_to_hire?: number | null
  open_requisitions?: number
}

const FUNNEL_STAGES: Array<{ key: keyof HiringFunnel; label: string }> = [
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'interviewing', label: 'Interviewing' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
]

export default function ChroView() {
  const { data: chro } = useQuery<ChroSnapshot>({ queryKey: ['exec-chro'], queryFn: () => api.get<{ data?: ChroSnapshot } & ChroSnapshot>('/executive/chro').then((r) => r.data ?? r), staleTime: 5 * 60_000 })

  const genderData = useMemo(() => Object.entries(chro?.gender_distribution ?? {})
    .filter(([, v]) => v > 0).map(([k, v]) => ({ name: tc(k), value: v, color: genderColor(k) })), [chro])
  const genderTotal = genderData.reduce((s, g) => s + g.value, 0)
  const femalePct = genderTotal > 0 ? ((genderData.find(g => /female|^f$/i.test(g.name))?.value ?? 0) / genderTotal) * 100 : null

  const mixData = useMemo(() => Object.entries(chro?.employment_type_distribution ?? {})
    .filter(([, v]) => v > 0).map(([k, v], i) => ({ name: tc(k), value: v, color: CAT[i % CAT.length] })), [chro])
  const mixTotal = mixData.reduce((s, m) => s + m.value, 0)

  const funnel = chro?.hiring_funnel
  const recruitmentLive = !!chro?.recruitment_active && !!funnel
  const funnelRows = funnel ? FUNNEL_STAGES.map((s, i) => ({ ...s, value: funnel[s.key], color: CAT[i % CAT.length] })) : []
  const funnelMax = funnelRows.reduce((m, r) => Math.max(m, r.value), 0)

  return (
    <ExecLayout title="People & Culture (CHRO)" subtitle="Diversity, talent acquisition and trust · live where available">
      {/* KPI ribbon — talent & culture */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Leave Utilisation" value={chro ? `${chro.leave_utilization_pct.toFixed(0)}%` : '—'} icon={CalendarCheck} tone="primary" deltaLabel="Of entitlement" />
        <KpiCard label="Diversity · F" value={femalePct == null ? '—' : `${femalePct.toFixed(1)}%`} icon={Sparkles} tone="info" deltaLabel="Org-wide" />
        <KpiCard label="Trust High-Risk" value={chro ? chro.trust_high_risk.toLocaleString() : '—'} icon={ShieldCheck} tone="warning" />
        <KpiCard label="Identity Verified" value={chro?.trust_verification_pct != null ? `${chro.trust_verification_pct.toFixed(0)}%` : '—'} icon={BadgeCheck} tone="success" deltaLabel="Of workforce" />
      </section>

      {/* KPI ribbon — talent acquisition */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Offer Acceptance" value={recruitmentLive ? `${(chro?.offer_acceptance_rate ?? 0).toFixed(0)}%` : '—'} icon={UserPlus}
          tone={(chro?.offer_acceptance_rate ?? 0) >= 80 ? 'success' : (chro?.offer_acceptance_rate ?? 0) >= 60 ? 'warning' : 'destructive'}
          hint={recruitmentLive ? `${chro?.offers_accepted ?? 0}/${chro?.offers_extended ?? 0}` : 'No data'} />
        <KpiCard label="Time to Hire" value={chro?.avg_time_to_hire != null ? `${chro.avg_time_to_hire}d` : '—'} icon={Clock} tone="info" deltaLabel="Apply → hired" />
        <KpiCard label="Time to Offer" value={chro?.avg_time_to_offer != null ? `${chro.avg_time_to_offer}d` : '—'} icon={Clock} tone="primary" deltaLabel="Apply → offer" />
        <KpiCard label="Open Requisitions" value={recruitmentLive ? (chro?.open_requisitions ?? 0).toLocaleString() : '—'} icon={Briefcase} tone="warning" deltaLabel="Currently open" />
      </section>

      {/* Visual grid */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-4" icon={Users2} title="Gender Diversity" sub="Org-wide split">
          {genderData.length > 0 ? (
            <DonutBlock data={genderData} centerValue={femalePct == null ? '—' : `${femalePct.toFixed(0)}%`} centerLabel="female" total={genderTotal} />
          ) : <NoData text="No gender distribution data." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={Layers} title="Workforce Composition" sub="By employment type">
          {mixData.length > 0 ? (
            <DonutBlock data={mixData} centerValue={mixTotal.toLocaleString()} centerLabel="employees" total={mixTotal} />
          ) : <NoData text="No employment-type data." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={Filter} title="Hiring Funnel" sub="Conversion across stages · rolling 6m">
          {recruitmentLive && funnelMax > 0 ? (
            <div className="space-y-2.5">
              {funnelRows.map((r, i) => {
                const prev = i > 0 ? funnelRows[i - 1].value : null
                const conv = prev && prev > 0 ? Math.round((r.value / prev) * 100) : null
                return (
                  <div key={r.key}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium">{r.label}</span>
                      <span className="tabular-nums text-muted-foreground">{r.value.toLocaleString()}{conv != null && <span className="ml-1.5 text-[10px]">({conv}%)</span>}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(r.value / funnelMax) * 100}%`, background: r.color }} /></div>
                  </div>
                )
              })}
            </div>
          ) : <NoData text="The hiring funnel populates once applications are recorded in the recruitment module." />}
        </Viz>
      </section>

      {/* CHRO narrative */}
      <Viz icon={Lightbulb} title="CHRO Insight" sub="Auto-generated from the live snapshot">
        {chro?.narrative ? (
          <div className="rounded-lg border border-success/30 bg-success/5 p-3">
            <div className="mb-1 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></div>
            <p className="text-xs leading-relaxed text-muted-foreground">{chro.narrative}</p>
            {(chro.pending_revisions != null || chro.approved_revisions != null) && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
                <StatTile label="Pending Revisions" value={(chro.pending_revisions ?? 0).toLocaleString()} tone="warning" />
                <StatTile label="Approved" value={(chro.approved_revisions ?? 0).toLocaleString()} tone="success" />
              </div>
            )}
          </div>
        ) : <NoData text="The CHRO narrative appears once the snapshot is generated." />}
      </Viz>
    </ExecLayout>
  )
}
