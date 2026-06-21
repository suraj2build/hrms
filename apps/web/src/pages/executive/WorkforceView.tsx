import { useQuery } from '@tanstack/react-query'
import { Users, Users2, MapPin, Layers, TrendingUp, Cake, Clock } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, Panel, EmptyBody } from '@/components/exec/ExecShell'
import { TIP, fmtNum } from '@/components/exec/exec-utils'

interface WorkforceData {
  employee_count: number
  monthly_trends: Array<{ month: string; joiners: number; exits: number; net: number }>
  dept_distribution: Array<{ dept: string; count: number; pct: number }>
  employment_type_distribution: Array<{ type: string; count: number; pct: number }>
  gender_distribution: Record<string, number>
  total_joiners_period: number; total_exits_period: number
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export default function WorkforceView() {
  const { data: wf } = useQuery<WorkforceData>({ queryKey: ['exec-workforce'], queryFn: () => api.get<{ data?: WorkforceData } & WorkforceData>('/executive/workforce').then((r) => r.data ?? r), staleTime: 5 * 60_000 })

  const joinersSpark = (wf?.monthly_trends ?? []).map(t => t.joiners)
  const exitsSpark   = (wf?.monthly_trends ?? []).map(t => t.exits)
  const hcSpark      = (wf?.monthly_trends ?? []).map(t => t.net)
  const mix = (wf?.employment_type_distribution ?? [])

  return (
    <ExecLayout title="Workforce Analytics" subtitle="Composition, demographics and structure of the manpower base · live data">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active Headcount" value={fmtNum(wf?.employee_count)} icon={Users} tone="primary" spark={hcSpark} />
        <KpiCard label="Joiners (period)" value={fmtNum(wf?.total_joiners_period)} icon={Users2} tone="success" spark={joinersSpark} />
        <KpiCard label="Exits (period)" value={fmtNum(wf?.total_exits_period)} icon={TrendingUp} tone="destructive" spark={exitsSpark} hint={wf ? `Net ${wf.total_joiners_period - wf.total_exits_period >= 0 ? '+' : ''}${wf.total_joiners_period - wf.total_exits_period}` : undefined} />
        <KpiCard label="Departments" value={fmtNum(wf?.dept_distribution.length)} icon={MapPin} tone="info" />
      </section>

      {/* Department table */}
      <Panel icon={Users} iconClass="text-primary" title="Department Composition" subtitle="Headcount is live · attrition / diversity / growth not broken down per department">
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Department</th>
                <th className="py-2 text-right font-medium">Headcount</th>
                <th className="py-2 text-right font-medium">Share</th>
                <th className="py-2 text-right font-medium">Open</th>
                <th className="py-2 text-right font-medium">Attrition</th>
                <th className="py-2 text-right font-medium">Female %</th>
                <th className="py-2 text-right font-medium">YoY Growth</th>
              </tr>
            </thead>
            <tbody>
              {(wf?.dept_distribution ?? []).map(d => (
                <tr key={d.dept} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2.5 font-medium">{d.dept}</td>
                  <td className="py-2.5 text-right tabular-nums">{d.count}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{d.pct}%</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                </tr>
              ))}
              {(wf?.dept_distribution.length ?? 0) === 0 && <tr><td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">No department data.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Location (empty) + Mix (real) */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel className="xl:col-span-2" icon={MapPin} iconClass="text-primary" title="Headcount by Location" subtitle="Geographic distribution">
          <EmptyBody text="Headcount by location isn't aggregated yet — work-location is captured per employee but not rolled up for the executive view." />
        </Panel>
        <Panel icon={Layers} iconClass="text-success" title="Employment Mix" subtitle="By type · current">
          {mix.length > 0 ? (
            <div className="mt-3 space-y-3">
              {mix.map((m, i) => (
                <div key={m.type}>
                  <div className="mb-1 flex justify-between text-xs"><span className="capitalize">{m.type}</span><span className="font-medium tabular-nums">{m.pct}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: COLORS[i % COLORS.length] }} /></div>
                </div>
              ))}
            </div>
          ) : <EmptyBody text="No employment-type data." />}
        </Panel>
      </section>

      {/* Age + Tenure (both empty) */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel icon={Cake} iconClass="text-info" title="Age Distribution" subtitle="By age band">
          <EmptyBody text="Age-band distribution isn't available yet (date-of-birth isn't aggregated for analytics)." />
        </Panel>
        <Panel icon={Clock} iconClass="text-success" title="Tenure Distribution" subtitle="By tenure band">
          <EmptyBody text="Tenure-band distribution isn't available yet." />
        </Panel>
      </section>

      {/* Monthly net trend (real) + Span (empty) */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel icon={TrendingUp} iconClass="text-primary" title="Joiners vs Exits" subtitle="Last 12 months">
          {(wf?.monthly_trends?.length ?? 0) > 0 ? (
            <div className="mt-3 h-56">
              <ResponsiveContainer>
                <BarChart data={wf!.monthly_trends.map(t => ({ ...t, m: t.month.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={TIP} />
                  <Bar dataKey="joiners" name="Joiners" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="exits" name="Exits" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyBody text="Joiner/exit trend will appear once data is available." />}
        </Panel>
        <Panel icon={Layers} iconClass="text-warning" title="Span of Control" subtitle="Avg vs ideal by layer">
          <EmptyBody text="Span-of-control analysis needs the reporting hierarchy modelled for the executive view." />
        </Panel>
      </section>
    </ExecLayout>
  )
}
