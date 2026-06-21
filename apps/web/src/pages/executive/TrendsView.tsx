import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Users, UserMinus, Wallet, Sparkles, LineChart as LineIcon, CalendarRange, Layers } from 'lucide-react'
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from 'recharts'
import { api } from '@/lib/api/client'
import { KpiCard } from '@/components/exec/KpiCard'
import { ExecLayout, Panel, EmptyBody } from '@/components/exec/ExecShell'
import { TIP, fmtMonth } from '@/components/exec/exec-utils'

interface TrendsData {
  months: Array<{ month: string; attendance_rate: number; leave_days_approved: number; payroll_gross: number | null; payroll_headcount: number | null; joiners: number; exits: number; net_headcount: number }>
}

export default function TrendsView() {
  const { data: t } = useQuery<TrendsData>({ queryKey: ['exec-trends'], queryFn: () => api.get<{ data?: TrendsData } & TrendsData>('/executive/trends').then((r) => r.data ?? r), staleTime: 5 * 60_000 })
  const months = useMemo(() => t?.months ?? [], [t])

  // Derived metrics — all from real monthly series.
  const metrics = useMemo(() => {
    if (months.length < 2) return { cagr: null as number | null, attrition: null as number | null, runrate: null as number | null }
    const first = months[0], last = months[months.length - 1]
    const yrs = months.length / 12
    const cagr = first.net_headcount > 0 && last.net_headcount > 0
      ? (Math.pow(last.net_headcount / first.net_headcount, 1 / Math.max(yrs, 1 / 12)) - 1) * 100 : null
    const exits = months.reduce((s, m) => s + (m.exits ?? 0), 0)
    const avgHc = months.reduce((s, m) => s + (m.net_headcount ?? 0), 0) / months.length
    const attrition = avgHc > 0 ? (exits / avgHc) * 100 : null
    const lastGross = [...months].reverse().find(m => m.payroll_gross != null)?.payroll_gross ?? null
    const runrate = lastGross != null ? (lastGross * 12) : null
    return { cagr, attrition, runrate }
  }, [months])

  const hcSpark = months.map(m => m.net_headcount)
  const attrSpark = months.map(m => (m.net_headcount > 0 ? +(m.exits / m.net_headcount * 100).toFixed(2) : 0))
  const payrollSpark = months.map(m => (m.payroll_gross != null ? +(m.payroll_gross / 1e7).toFixed(2) : 0))

  const combined = months.map(m => ({
    month: fmtMonth(m.month),
    headcount: m.net_headcount ?? 0,
    payroll: m.payroll_gross != null ? +(m.payroll_gross / 1e7).toFixed(2) : null,
    attrition: m.net_headcount > 0 ? +(m.exits / m.net_headcount * 100).toFixed(2) : 0,
    attendance: +(m.attendance_rate ?? 0).toFixed(1),
  }))

  const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`)
  const cr = (n: number | null) => (n == null ? '—' : n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : `₹${(n / 1e5).toFixed(1)}L`)

  return (
    <ExecLayout title="Trends & Forecasting" subtitle="Long-run workforce, cost and attrition trends · live data">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Headcount Growth" value={fmtPct(metrics.cagr)} icon={Users} tone="primary" spark={hcSpark} hint="Annualised" />
        <KpiCard label="Attrition (TTM)" value={fmtPct(metrics.attrition)} icon={UserMinus} tone="destructive" spark={attrSpark} hint="Trailing 12m" />
        <KpiCard label="Payroll Run-rate" value={cr(metrics.runrate)} icon={Wallet} tone="info" spark={payrollSpark} hint="Annualised" />
        <KpiCard label="Forecast Confidence" value="—" icon={Sparkles} tone="success" hint="ML model not enabled" />
      </section>

      {/* Combined long-run trend (real) */}
      <Panel icon={TrendingUp} iconClass="text-primary" title="Workforce, Payroll & Attrition Trend" subtitle="Headcount & payroll (₹ Cr) bars · attrition % line · last 12 months">
        {combined.length > 0 ? (
          <div className="mt-4 h-64">
            <ResponsiveContainer>
              <ComposedChart data={combined}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <Tooltip contentStyle={TIP} />
                <Bar yAxisId="left" dataKey="headcount" name="Headcount" fill="var(--chart-1)" radius={[3, 3, 0, 0]} barSize={14} />
                <Bar yAxisId="left" dataKey="payroll" name="Payroll ₹Cr" fill="var(--chart-3)" radius={[3, 3, 0, 0]} barSize={14} />
                <Line yAxisId="right" type="monotone" dataKey="attrition" name="Attrition %" stroke="var(--chart-5)" strokeWidth={2.5} dot={{ r: 3 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyBody text="Long-run trends will appear once a few months of operational data have accumulated." />}
      </Panel>

      {/* Attendance trend (real) + Attrition forecast (empty) */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel icon={LineIcon} iconClass="text-success" title="Attendance Trend" subtitle="Monthly attendance rate (%)">
          {combined.length > 0 ? (
            <div className="mt-3 h-56">
              <ResponsiveContainer>
                <ComposedChart data={combined}>
                  <defs><linearGradient id="attTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis domain={[70, 100]} unit="%" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={TIP} />
                  <Area type="monotone" dataKey="attendance" name="Attendance %" stroke="var(--chart-2)" strokeWidth={2.5} fill="url(#attTrend)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyBody text="Attendance trend will appear once attendance is processed." />}
        </Panel>

        <Panel icon={Sparkles} iconClass="text-info" title="Attrition Forecast" subtitle="Predicted attrition · next 6 months">
          <EmptyBody text="Forward-looking attrition forecasting (ML with confidence bands) isn't available yet — it needs the workforce intelligence engine enabled." />
        </Panel>
      </section>

      {/* Seasonality (empty) + Cohort retention (empty) */}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel icon={CalendarRange} iconClass="text-warning" title="Seasonality" subtitle="Month-of-year patterns">
          <EmptyBody text="Seasonality decomposition needs at least two full years of history; we currently surface a 12-month window." />
        </Panel>
        <Panel icon={Layers} iconClass="text-primary" title="Cohort Retention" subtitle="Retention by joining cohort">
          <EmptyBody text="Cohort retention curves aren't available yet — they need joiner cohorts tracked over time for the executive view." />
        </Panel>
      </section>
    </ExecLayout>
  )
}
