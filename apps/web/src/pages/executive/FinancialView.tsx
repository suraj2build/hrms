import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wallet, IndianRupee, Users, Clock, Building2, TrendingUp, Gauge, CalendarClock, LogOut, Activity, Layers } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, StatTile } from '@/components/exec/ExecShell'
import { Viz, ChartTip, NoData } from '@/components/exec/viz'
import { C, CAT, GRID, AXIS, cr, fmtMonth } from '@/components/exec/exec-utils'

type FlagTone = 'high' | 'medium' | 'normal'

interface FinancialData {
  payroll_current_gross: number; payroll_current_net: number; payroll_mom_change: number
  payroll_current_month?: string
  variance_flag?: FlagTone
  payroll_cost_trend: Array<{ month: string; total_gross: number; employee_count: number; avg_cost_per_head: number }>
  dept_cost_breakdown: Array<{ dept: string; headcount: number; total_gross: number; total_net: number; ot_cost: number }>
  total_revision_delta?: number; avg_revision_pct?: number
  revisions_by_type?: Record<string, number>; approved_revisions_count?: number
  component_mix?: {
    month: string; fixed_pay: number; variable_pay: number; statutory_cost: number
    ot_cost: number; employee_deductions: number; gross_total: number; has_data: boolean
  }
  ot_trend?: Array<{ month: string; ot_cost: number }>
  ot_cost_total?: number
  ot_dependency_pct?: number; ot_dependency_flag?: FlagTone
  leave_liability?: number; leave_liability_employees?: number; leave_liability_days?: number
  ff_exposure?: number; ff_active_separations?: number
}

const flagTone = (f?: FlagTone): 'warning' | 'destructive' | 'success' =>
  f === 'high' ? 'destructive' : f === 'medium' ? 'warning' : 'success'

export default function FinancialView() {
  const { data: fin } = useQuery<FinancialData>({ queryKey: ['exec-financial'], queryFn: () => api.get<{ data?: FinancialData } & FinancialData>('/executive/financial').then((r) => r.data ?? r), staleTime: 5 * 60_000 })

  const trend = fin?.payroll_cost_trend ?? []
  const latestCph = trend.length ? trend[trend.length - 1].avg_cost_per_head : 0
  const totalOt = fin?.ot_cost_total ?? (fin?.dept_cost_breakdown ?? []).reduce((s, d) => s + (d.ot_cost ?? 0), 0)
  const otDepPct = fin?.ot_dependency_pct ?? 0
  const leaveLiability = fin?.leave_liability ?? 0
  const ffExposure = fin?.ff_exposure ?? 0

  const trendData = trend.map(t => ({ month: fmtMonth(t.month), gross: +(t.total_gross / 1e7).toFixed(2), head: t.employee_count }))
  const deptRows = useMemo(() => [...(fin?.dept_cost_breakdown ?? [])].sort((a, b) => b.total_gross - a.total_gross), [fin])
  const deptCost = deptRows.slice(0, 8).map(d => ({ dept: d.dept, value: +(d.total_gross / 1e5).toFixed(2), gross: d.total_gross }))
  const otByDept = deptRows.filter(d => (d.ot_cost ?? 0) > 0).slice(0, 8).map((d, i) => ({ dept: d.dept, value: +(d.ot_cost / 1e5).toFixed(1), ot: d.ot_cost, color: CAT[i % CAT.length] }))
  const revByType = Object.entries(fin?.revisions_by_type ?? {}).map(([type, n], i) => ({ type, n, color: CAT[i % CAT.length] }))

  const mix = fin?.component_mix
  const mixSegments = mix && mix.has_data
    ? [
        { label: 'Fixed Pay', value: mix.fixed_pay, color: C.blue },
        { label: 'Variable Pay', value: mix.variable_pay, color: C.teal },
        { label: 'Statutory', value: mix.statutory_cost, color: C.violet },
        { label: 'Overtime', value: mix.ot_cost, color: C.amber },
      ].filter(s => s.value > 0)
    : []
  const mixTotal = mixSegments.reduce((s, m) => s + m.value, 0)
  const otTrend = (fin?.ot_trend ?? []).filter(t => t.ot_cost > 0).map(t => ({ month: fmtMonth(t.month), ot: +(t.ot_cost / 1e5).toFixed(1) }))

  return (
    <ExecLayout title="Financial Analytics" subtitle="Payroll cost, department spend and exposure · live data">
      {/* KPI ribbon — payroll */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Gross Payroll · MTD" value={cr(fin?.payroll_current_gross ?? 0)} delta={fin?.payroll_mom_change} deltaLabel="MoM" icon={Wallet} tone="primary" />
        <KpiCard label="Net Payout" value={cr(fin?.payroll_current_net ?? 0)} icon={IndianRupee} tone="success" hint={fin ? `${((fin.payroll_current_net / Math.max(1, fin.payroll_current_gross)) * 100).toFixed(0)}% of gross` : undefined} />
        <KpiCard label="Cost / Head" value={latestCph ? cr(latestCph) : '—'} icon={Users} tone="info" deltaLabel="Per month" />
        <KpiCard label="Overtime Cost" value={totalOt ? cr(totalOt) : '—'} icon={Clock} tone="warning" deltaLabel={fin?.payroll_current_month ? fmtMonth(fin.payroll_current_month) : 'Current'} />
      </section>

      {/* KPI ribbon — exposure */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="OT Dependency" value={`${otDepPct.toFixed(1)}%`} icon={Gauge} tone={flagTone(fin?.ot_dependency_flag)}
          hint={fin?.ot_dependency_flag === 'high' ? 'OT >25% gross' : fin?.ot_dependency_flag === 'medium' ? 'OT >15%' : 'Healthy'} />
        <KpiCard label="Payroll Variance" value={`${fin?.payroll_mom_change != null ? (fin.payroll_mom_change > 0 ? '+' : '') + fin.payroll_mom_change.toFixed(1) : '0.0'}%`} icon={Activity} tone={flagTone(fin?.variance_flag)}
          hint={fin?.variance_flag === 'high' ? 'High swing' : fin?.variance_flag === 'medium' ? 'Notable swing' : 'Stable'} />
        <KpiCard label="Leave Liability" value={leaveLiability ? cr(leaveLiability) : '—'} icon={CalendarClock} tone="info"
          hint={fin?.leave_liability_days ? `${fin.leave_liability_days.toLocaleString('en-IN')} days` : 'Encashable'} />
        <KpiCard label="F&F Exposure" value={ffExposure ? cr(ffExposure) : '—'} icon={LogOut} tone={ffExposure > 0 ? 'warning' : 'success'}
          hint={fin?.ff_active_separations ? `${fin.ff_active_separations} pending` : 'None pending'} />
      </section>

      {/* Visual grid */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-8" icon={TrendingUp} title="Payroll Cost Trend" sub="Gross payroll ₹Cr (bars) · headcount (line)">
          {trendData.length > 0 ? (
            <div className="h-[240px]">
              <ResponsiveContainer>
                <ComposedChart data={trendData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="l" tick={AXIS} tickLine={false} axisLine={false} unit="Cr" />
                  <YAxis yAxisId="r" orientation="right" tick={AXIS} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v: number, p: { dataKey?: string }) => (p.dataKey === 'gross' ? `₹${v}Cr` : v)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar yAxisId="l" dataKey="gross" name="Gross ₹Cr" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="r" type="monotone" dataKey="head" name="Headcount" stroke={C.amber} strokeWidth={2.5} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Payroll cost trend appears once payroll has run for a few months." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={Layers} title="Cost Mix" sub={mix ? `${fmtMonth(mix.month)} · by component` : 'By component'}>
          {mixSegments.length > 0 ? (
            <div className="space-y-3">
              <div className="flex h-3 overflow-hidden rounded-full">
                {mixSegments.map(s => <div key={s.label} style={{ width: `${(s.value / mixTotal) * 100}%`, background: s.color }} title={s.label} />)}
              </div>
              {mixSegments.map(s => (
                <div key={s.label} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                  <span className="font-medium tabular-nums">{cr(s.value)} · {((s.value / mixTotal) * 100).toFixed(0)}%</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Employer-side cost. Employee deductions ({cr(mix?.employee_deductions ?? 0)}) excluded.</p>
            </div>
          ) : <NoData text="Component mix appears once a payroll run is finalised." />}
        </Viz>

        <Viz className="lg:col-span-8" icon={Building2} title="Payroll Cost by Department" sub="Gross monthly cost · ranked"
          right={<span className="text-[10px] font-medium text-muted-foreground">{cr(fin?.payroll_current_gross ?? 0)} total</span>}>
          {deptCost.length > 0 ? (
            <div className="h-[240px]">
              <ResponsiveContainer>
                <BarChart data={deptCost} layout="vertical" margin={{ top: 2, right: 56, left: 4, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} unit="L" />
                  <YAxis type="category" dataKey="dept" width={104} tick={{ ...AXIS }} tickLine={false} axisLine={false}
                    tickFormatter={(v: string) => (v.length > 15 ? `${v.slice(0, 15)}…` : v)} />
                  <Tooltip content={<ChartTip fmt={(_v: number, p: { payload?: { gross?: number } }) => cr(p.payload?.gross ?? 0)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="value" name="Gross cost" fill={C.teal} radius={[0, 4, 4, 0]} maxBarSize={20}>
                    <LabelList dataKey="gross" position="right" formatter={(v: number) => cr(v)} className="fill-foreground" style={{ fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="No department cost data." />}
        </Viz>

        <Viz className="lg:col-span-4" icon={IndianRupee} title="Compensation Revisions" sub="Approved salary revisions">
          {(fin?.total_revision_delta != null || revByType.length > 0) ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Total Delta" value={cr(fin?.total_revision_delta ?? 0)} tone="primary" />
                <StatTile label="Avg" value={fin?.avg_revision_pct != null ? `${fin.avg_revision_pct.toFixed(1)}%` : '—'} tone="success" />
                <StatTile label="Approved" value={(fin?.approved_revisions_count ?? 0).toLocaleString()} tone="muted" />
              </div>
              {revByType.length > 0 && (
                <div className="space-y-2">
                  {revByType.map(r => {
                    const max = Math.max(...revByType.map(x => x.n))
                    return (
                      <div key={r.type}>
                        <div className="mb-1 flex justify-between text-[11px]"><span className="capitalize">{r.type.replace(/_/g, ' ')}</span><span className="font-medium tabular-nums">{r.n}</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} /></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : <NoData text="No approved compensation revisions in the current window." />}
        </Viz>

        <Viz className="lg:col-span-6" icon={Clock} title="Overtime by Department" sub="OT cost ₹Lakh · current period">
          {otByDept.length > 0 ? (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <BarChart data={otByDept} layout="vertical" margin={{ top: 2, right: 40, left: 4, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} unit="L" />
                  <YAxis type="category" dataKey="dept" width={96} tick={{ ...AXIS }} tickLine={false} axisLine={false}
                    tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)} />
                  <Tooltip content={<ChartTip fmt={(_v: number, p: { payload?: { ot?: number } }) => cr(p.payload?.ot ?? 0)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="value" name="OT ₹L" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {otByDept.map(d => <Cell key={d.dept} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="No overtime cost recorded for the current period." />}
        </Viz>

        <Viz className="lg:col-span-6" icon={Clock} title="Overtime Cost Trend" sub="Monthly OT cost ₹Lakh">
          {otTrend.length > 0 ? (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <BarChart data={otTrend} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="L" />
                  <Tooltip content={<ChartTip fmt={(v: number) => `₹${v}L`} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="ot" name="OT ₹L" fill={C.amber} radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Overtime trend appears once payroll has run with overtime for a few months." />}
        </Viz>
      </section>

      {/* Department cost table */}
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Cost by Department</h3></div>
        <p className="text-xs text-muted-foreground">Headcount, gross &amp; overtime are live · budget / variance not configured</p>
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <th className="px-3 py-2 text-right font-medium">Headcount</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 text-right font-medium">OT Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deptRows.map(d => (
                <tr key={d.dept} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{d.dept}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.headcount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{cr(d.total_gross)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{cr(d.total_net)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{d.ot_cost ? cr(d.ot_cost) : '—'}</td>
                </tr>
              ))}
              {deptRows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-xs text-muted-foreground">No department cost data.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </ExecLayout>
  )
}
