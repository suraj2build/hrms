import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, Users2, TrendingUp, Building2, Layers, Activity } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, ExecErrorBanner } from '@/components/exec/ExecShell'
import { Viz, DonutBlock, ChartTip, NoData, PeriodSlicer } from '@/components/exec/viz'
import { C, CAT, GRID, AXIS, genderColor, tc, fmtNum, fmtMonth, slicePeriod, type Period } from '@/components/exec/exec-utils'

interface WorkforceData {
  employee_count: number
  monthly_trends: Array<{ month: string; joiners: number; exits: number; net: number }>
  dept_distribution: Array<{ dept: string; count: number; pct: number }>
  employment_type_distribution: Array<{ type: string; count: number; pct: number }>
  gender_distribution: Record<string, number>
  total_joiners_period: number; total_exits_period: number
}

export default function WorkforceView() {
  const [period, setPeriod] = useState<Period>('12M')
  const { data: wf, isError, refetch } = useQuery<WorkforceData>({ queryKey: ['exec-workforce'], queryFn: () => api.get<{ data?: WorkforceData } & WorkforceData>('/executive/workforce').then((r) => r.data ?? r), staleTime: 5 * 60_000 })

  const deptRanked = useMemo(() => [...(wf?.dept_distribution ?? [])]
    .sort((a, b) => b.count - a.count).slice(0, 10)
    .map((d, i) => ({ dept: d.dept, count: d.count, pct: d.pct, color: CAT[i % CAT.length] })), [wf])

  const mixData = (wf?.employment_type_distribution ?? []).map((d, i) => ({ name: tc(d.type), value: d.count, color: CAT[i % CAT.length] }))

  const genderData = useMemo(() => Object.entries(wf?.gender_distribution ?? {})
    .filter(([, v]) => v > 0).map(([k, v]) => ({ name: tc(k), value: v, color: genderColor(k) })), [wf])
  const genderTotal = genderData.reduce((s, d) => s + d.value, 0)
  const femalePct = genderTotal > 0 ? ((genderData.find(g => /female|^f$/i.test(g.name))?.value ?? 0) / genderTotal) * 100 : null

  const flow = slicePeriod((wf?.monthly_trends ?? []).map(t => ({ month: fmtMonth(t.month), joiners: t.joiners, exits: -t.exits, net: t.net })), period)
  const net = (wf?.total_joiners_period ?? 0) - (wf?.total_exits_period ?? 0)

  return (
    <ExecLayout title="Workforce Analytics" subtitle="Composition, movement and structure of the manpower base · live data"
      actions={<PeriodSlicer value={period} onChange={setPeriod} />}>
      {isError && <ExecErrorBanner onRetry={() => refetch()} />}
      {/* KPI ribbon */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active Headcount" value={fmtNum(wf?.employee_count)} icon={Users} tone="primary" />
        <KpiCard label="Joiners · period" value={fmtNum(wf?.total_joiners_period)} icon={Users2} tone="success" />
        <KpiCard label="Exits · period" value={fmtNum(wf?.total_exits_period)} icon={TrendingUp} tone="destructive" deltaLabel={`Net ${net >= 0 ? '+' : ''}${net}`} />
        <KpiCard label="Departments" value={fmtNum(wf?.dept_distribution.length)} icon={Building2} tone="info" />
      </section>

      {/* Visual grid */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-8" icon={Building2} title="Headcount by Department" sub="Ranked · top 10">
          {deptRanked.length > 0 ? (
            <div className="h-[260px]">
              <ResponsiveContainer>
                <BarChart data={deptRanked} layout="vertical" margin={{ top: 2, right: 36, left: 4, bottom: 2 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="dept" width={104} tick={{ ...AXIS }} tickLine={false} axisLine={false}
                    tickFormatter={(v: string) => (v.length > 15 ? `${v.slice(0, 15)}…` : v)} />
                  <Tooltip content={<ChartTip fmt={(v: number, p: { payload?: Record<string, unknown> }) => `${v} · ${p.payload?.pct ?? 0}%`} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="count" name="Headcount" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {deptRanked.map((d) => <Cell key={d.dept} fill={d.color} />)}
                    <LabelList dataKey="count" position="right" className="fill-foreground" style={{ fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="No department headcount data." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={Layers} title="Workforce Composition" sub="By employment type">
          {mixData.length > 0 ? (
            <DonutBlock data={mixData} centerValue={fmtNum(wf?.employee_count)} centerLabel="employees" />
          ) : <NoData text="No employment-type data." />}
        </Viz>

        <Viz className="lg:col-span-8" icon={Activity} title="Joiners vs Exits" sub="Monthly flow · net line">
          {flow.length > 0 ? (
            <div className="h-[240px]">
              <ResponsiveContainer>
                <ComposedChart data={flow} margin={{ top: 6, right: 8, left: -16, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                  <ReferenceLine y={0} stroke={GRID} />
                  <Tooltip content={<ChartTip fmt={(v: number) => Math.abs(v)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="joiners" name="Joiners" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="exits" name="Exits" fill={C.rose} radius={[0, 0, 3, 3]} maxBarSize={20} />
                  <Line type="monotone" dataKey="net" name="Net" stroke={C.blue} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Joiner / exit flow appears once monthly movement is recorded." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={Users2} title="Gender Diversity" sub="Org-wide split">
          {genderData.length > 0 ? (
            <DonutBlock data={genderData} centerValue={femalePct == null ? '—' : `${femalePct.toFixed(0)}%`} centerLabel="female" total={genderTotal} />
          ) : <NoData text="No gender distribution data." />}
        </Viz>
      </section>

      {/* Department table */}
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Department Composition</h3></div>
        <p className="text-xs text-muted-foreground">Headcount &amp; share are live · attrition / diversity not broken down per department</p>
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <th className="px-3 py-2 text-right font-medium">Headcount</th>
                <th className="px-3 py-2 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(wf?.dept_distribution ?? []).map(d => (
                <tr key={d.dept} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{d.dept}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.count}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{d.pct}%</td>
                </tr>
              ))}
              {(wf?.dept_distribution.length ?? 0) === 0 && <tr><td colSpan={3} className="px-3 py-10 text-center text-xs text-muted-foreground">No department data.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </ExecLayout>
  )
}
