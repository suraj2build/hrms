import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Users, UserMinus, Wallet, Activity, CalendarCheck, ArrowUpDown } from 'lucide-react'
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout } from '@/components/exec/ExecShell'
import { Viz, ChartTip, NoData } from '@/components/exec/viz'
import { C, GRID, AXIS, fmtMonth } from '@/components/exec/exec-utils'

interface TrendsData {
  months: Array<{ month: string; attendance_rate: number; leave_days_approved: number; payroll_gross: number | null; payroll_headcount: number | null; joiners: number; exits: number; net_headcount: number }>
}

export default function TrendsView() {
  const { data: t } = useQuery<TrendsData>({ queryKey: ['exec-trends'], queryFn: () => api.get<{ data?: TrendsData } & TrendsData>('/executive/trends').then((r) => r.data ?? r), staleTime: 5 * 60_000 })
  const months = useMemo(() => t?.months ?? [], [t])

  const metrics = useMemo(() => {
    if (months.length < 2) return { cagr: null as number | null, attrition: null as number | null, runrate: null as number | null, netChange: null as number | null }
    const first = months[0], last = months[months.length - 1]
    const yrs = months.length / 12
    const cagr = first.net_headcount > 0 && last.net_headcount > 0
      ? (Math.pow(last.net_headcount / first.net_headcount, 1 / Math.max(yrs, 1 / 12)) - 1) * 100 : null
    const exits = months.reduce((s, m) => s + (m.exits ?? 0), 0)
    const avgHc = months.reduce((s, m) => s + (m.net_headcount ?? 0), 0) / months.length
    const attrition = avgHc > 0 ? (exits / avgHc) * 100 : null
    const lastGross = [...months].reverse().find(m => m.payroll_gross != null)?.payroll_gross ?? null
    const runrate = lastGross != null ? (lastGross * 12) : null
    const netChange = last.net_headcount - first.net_headcount
    return { cagr, attrition, runrate, netChange }
  }, [months])

  const combined = months.map(m => ({
    month: fmtMonth(m.month),
    headcount: m.net_headcount ?? 0,
    payroll: m.payroll_gross != null ? +(m.payroll_gross / 1e7).toFixed(2) : null,
    attrition: m.net_headcount > 0 ? +(m.exits / m.net_headcount * 100).toFixed(2) : 0,
    attendance: +(m.attendance_rate ?? 0).toFixed(1),
  }))
  const flow = months.map(m => ({ month: fmtMonth(m.month), joiners: m.joiners ?? 0, exits: -(m.exits ?? 0), net: (m.joiners ?? 0) - (m.exits ?? 0) }))

  const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`)
  const cr = (n: number | null) => (n == null ? '—' : n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : `₹${(n / 1e5).toFixed(1)}L`)

  return (
    <ExecLayout title="Trends & Forecasting" subtitle="Long-run workforce, cost and attrition trends · live data">
      {/* KPI ribbon */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Headcount Growth" value={fmtPct(metrics.cagr)} icon={Users} tone="primary" deltaLabel="Annualised" />
        <KpiCard label="Attrition · TTM" value={fmtPct(metrics.attrition)} icon={UserMinus} tone="destructive" deltaLabel="Trailing 12m" />
        <KpiCard label="Payroll Run-rate" value={cr(metrics.runrate)} icon={Wallet} tone="info" deltaLabel="Annualised" />
        <KpiCard label="Net Change" value={metrics.netChange == null ? '—' : `${metrics.netChange >= 0 ? '+' : ''}${metrics.netChange}`} icon={ArrowUpDown} tone={(metrics.netChange ?? 0) >= 0 ? 'success' : 'destructive'} deltaLabel="Over window" />
      </section>

      {/* Combined long-run trend */}
      <Viz icon={TrendingUp} title="Workforce, Payroll & Attrition" sub="Headcount & payroll ₹Cr (bars) · attrition % (line)">
        {combined.length > 0 ? (
          <div className="h-[280px]">
            <ResponsiveContainer>
              <ComposedChart data={combined} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis yAxisId="l" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis yAxisId="r" orientation="right" unit="%" tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip fmt={(v: number, p: { dataKey?: string }) => (p.dataKey === 'attrition' ? `${v}%` : p.dataKey === 'payroll' ? `₹${v}Cr` : v)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                <Bar yAxisId="l" dataKey="headcount" name="Headcount" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={16} />
                <Bar yAxisId="l" dataKey="payroll" name="Payroll ₹Cr" fill={C.teal} radius={[3, 3, 0, 0]} maxBarSize={16} />
                <Line yAxisId="r" type="monotone" dataKey="attrition" name="Attrition %" stroke={C.rose} strokeWidth={2.5} dot={{ r: 2.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <NoData text="Long-run trends appear once a few months of operational data accumulate." />}
      </Viz>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Viz icon={CalendarCheck} title="Attendance Trend" sub="Monthly attendance rate (%)">
          {combined.length > 0 ? (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <ComposedChart data={combined} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <defs><linearGradient id="attTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.teal} stopOpacity={0.35} /><stop offset="100%" stopColor={C.teal} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis domain={[60, 100]} unit="%" tick={AXIS} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v: number) => `${v}%`} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Area type="monotone" dataKey="attendance" name="Attendance %" stroke={C.teal} strokeWidth={2.5} fill="url(#attTrend)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Attendance trend appears once attendance is processed." />}
        </Viz>

        <Viz icon={Activity} title="Joiners vs Exits" sub="Monthly flow · net line">
          {flow.length > 0 ? (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <ComposedChart data={flow} margin={{ top: 6, right: 8, left: -16, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                  <ReferenceLine y={0} stroke={GRID} />
                  <Tooltip content={<ChartTip fmt={(v: number) => Math.abs(v)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="joiners" name="Joiners" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="exits" name="Exits" fill={C.rose} radius={[0, 0, 3, 3]} maxBarSize={18} />
                  <Line type="monotone" dataKey="net" name="Net" stroke={C.blue} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Flow appears once monthly movement is recorded." />}
        </Viz>
      </section>
    </ExecLayout>
  )
}
