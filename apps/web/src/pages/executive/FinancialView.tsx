import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wallet, IndianRupee, Users, Clock, PieChart as PieIcon, Building2, TrendingUp } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, Panel, EmptyBody, StatTile, TIP, PALETTE, cr, fmtMonth } from '@/components/exec/ExecShell'

interface FinancialData {
  payroll_current_gross: number; payroll_current_net: number; payroll_mom_change: number
  payroll_cost_trend: Array<{ month: string; total_gross: number; employee_count: number; avg_cost_per_head: number }>
  dept_cost_breakdown: Array<{ dept: string; headcount: number; total_gross: number; total_net: number; ot_cost: number }>
  total_revision_delta?: number; avg_revision_pct?: number
  revisions_by_type?: Record<string, number>; approved_revisions_count?: number
}

export default function FinancialView() {
  const { data: fin } = useQuery<FinancialData>({ queryKey: ['exec-financial'], queryFn: () => api.get('/executive/financial').then((r: any) => r.data ?? r), staleTime: 5 * 60_000 })

  const trend = fin?.payroll_cost_trend ?? []
  const grossSpark = trend.map(t => +(t.total_gross / 1e7).toFixed(2))
  const headSpark  = trend.map(t => t.employee_count)
  const cphSpark   = trend.map(t => +(t.avg_cost_per_head / 1000).toFixed(1))

  const latestCph = trend.length ? trend[trend.length - 1].avg_cost_per_head : 0
  const totalOt = (fin?.dept_cost_breakdown ?? []).reduce((s, d) => s + (d.ot_cost ?? 0), 0)

  const trendData = trend.map(t => ({ month: fmtMonth(t.month), gross: +(t.total_gross / 1e7).toFixed(2), head: t.employee_count }))
  const deptRows = useMemo(
    () => [...(fin?.dept_cost_breakdown ?? [])].sort((a, b) => b.total_gross - a.total_gross),
    [fin],
  )
  const otByDept = deptRows.filter(d => (d.ot_cost ?? 0) > 0).map((d, i) => ({ dept: d.dept, ot: +(d.ot_cost / 1e5).toFixed(1), color: PALETTE[i % PALETTE.length] }))
  const revByType = Object.entries(fin?.revisions_by_type ?? {}).map(([type, n], i) => ({ type, n, color: PALETTE[i % PALETTE.length] }))

  return (
    <ExecLayout title="Financial Analytics" subtitle="Payroll cost, department spend and compensation revisions · live data">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Gross Payroll (MTD)" value={cr(fin?.payroll_current_gross ?? 0)} delta={fin?.payroll_mom_change} deltaLabel="MoM" icon={Wallet} tone="primary" spark={grossSpark} />
        <KpiCard label="Net Payout" value={cr(fin?.payroll_current_net ?? 0)} icon={IndianRupee} tone="success" spark={grossSpark} hint={fin ? `${((fin.payroll_current_net / Math.max(1, fin.payroll_current_gross)) * 100).toFixed(0)}% of gross` : undefined} />
        <KpiCard label="Cost / Head" value={latestCph ? cr(latestCph) : '—'} icon={Users} tone="info" spark={cphSpark} hint="Per month" />
        <KpiCard label="Overtime Cost" value={totalOt ? cr(totalOt) : '—'} icon={Clock} tone="warning" hint="Current period" />
      </section>

      {/* Payroll trend (real) + payroll mix (empty) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" icon={TrendingUp} iconClass="text-primary" title="Payroll Cost Trend" subtitle="Gross payroll (₹ Cr) bars · headcount line">
          {trendData.length > 0 ? (
            <div className="mt-4 h-72">
              <ResponsiveContainer>
                <ComposedChart data={trendData}>
                  <defs><linearGradient id="grossA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={TIP} />
                  <Bar yAxisId="left" dataKey="gross" name="Gross ₹Cr" fill="var(--chart-1)" radius={[4, 4, 0, 0]} barSize={18} />
                  <Line yAxisId="right" type="monotone" dataKey="head" name="Headcount" stroke="var(--chart-3)" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyBody text="Payroll cost trend will appear once payroll has run for a few months." />}
        </Panel>

        <Panel icon={PieIcon} iconClass="text-success" title="Payroll Cost Mix" subtitle="By component (₹ Cr)"
          badge={undefined}>
          <EmptyBody text="Component-level payroll breakdown (fixed / variable / statutory / OT) isn't exposed yet — only gross & net totals are available." />
        </Panel>
      </section>

      {/* Cost by department (real headcount + gross + ot) */}
      <Panel icon={Building2} iconClass="text-primary" title="Cost by Department" subtitle="Headcount, gross & overtime are live · budget / variance not configured">
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <th className="px-3 py-2 text-right font-medium">Headcount</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 text-right font-medium">OT Cost</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
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
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                </tr>
              ))}
              {deptRows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-xs text-muted-foreground">No department cost data.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Comp revision impact (real) + Overtime by dept (real) */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel icon={IndianRupee} iconClass="text-info" title="Compensation Revision Impact" subtitle="Approved salary revisions">
          {(fin?.total_revision_delta != null || revByType.length > 0) ? (
            <>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <StatTile label="Total Delta" value={cr(fin?.total_revision_delta ?? 0)} tone="primary" />
                <StatTile label="Avg Revision" value={fin?.avg_revision_pct != null ? `${fin.avg_revision_pct.toFixed(1)}%` : '—'} tone="success" />
                <StatTile label="Approved" value={(fin?.approved_revisions_count ?? 0).toLocaleString()} tone="muted" />
              </div>
              {revByType.length > 0 && (
                <div className="mt-4 space-y-2.5">
                  {revByType.map(r => {
                    const max = Math.max(...revByType.map(x => x.n))
                    return (
                      <div key={r.type}>
                        <div className="mb-1 flex justify-between text-xs"><span className="capitalize">{r.type.replace(/_/g, ' ')}</span><span className="font-medium tabular-nums">{r.n}</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} /></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : <EmptyBody text="No approved compensation revisions in the current window." />}
        </Panel>

        <Panel icon={Clock} iconClass="text-warning" title="Overtime by Department" subtitle="Overtime cost (₹ Lakh) · current period">
          {otByDept.length > 0 ? (
            <div className="mt-3 h-64">
              <ResponsiveContainer>
                <BarChart data={otByDept} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis type="category" dataKey="dept" width={90} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={TIP} />
                  <Bar dataKey="ot" name="OT ₹L" radius={[0, 4, 4, 0]}>
                    {otByDept.map(d => <Cell key={d.dept} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyBody text="No overtime cost recorded for the current period. A month-by-month overtime trend isn't aggregated yet." />}
        </Panel>
      </section>
    </ExecLayout>
  )
}
