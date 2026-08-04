/**
 * ExecutiveIntelligenceCenter — /admin/executive  (CEO View)
 *
 * BI-style "Manpower Intelligence Center" — a dense, Power BI / Tableau-style
 * report canvas. Slim report header → KPI ribbon → a 12-col grid of real
 * visuals (ranked bars, diverging flow, donuts, combo, trends, gauge) → a
 * drill-down department table. Every visual is wired to the live /executive/*
 * API; the period slicer windows the trend charts.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, ArrowRight, Building2, CalendarCheck, ChevronRight,
  Coins, Download, Layers, ShieldCheck, Sparkles, TrendingDown, TrendingUp,
  UserMinus, Users, Wallet,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  LabelList, Line, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { DrillDownSheet, type DeptRow } from '@/components/exec/DrillDownSheet'
import { ExecLayout, ExecErrorBanner } from '@/components/exec/ExecShell'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── Real /executive response shapes ─────────────────────────────────────────────

interface CeoSnapshot {
  employee_count: number; joiners_30d: number; exits_30d: number
  net_headcount_change: number; attendance_rate: number; absence_rate: number
  payroll_cost_current: number; payroll_net_current: number; avg_cost_per_employee: number
  open_exceptions: number; open_incidents: number; pending_revisions: number
  total_attention_items: number; narrative: string
}
interface ChroSnapshot {
  gender_distribution: Record<string, number>
  employment_type_distribution: Record<string, number>
  leave_utilization_pct: number; trust_high_risk: number; narrative: string
}
interface WorkforceData {
  employee_count: number
  monthly_trends: Array<{ month: string; joiners: number; exits: number; net: number }>
  dept_distribution: Array<{ dept: string; count: number; pct: number }>
  employment_type_distribution: Array<{ type: string; count: number; pct: number }>
  gender_distribution: Record<string, number>
  total_joiners_period: number; total_exits_period: number
}
interface FinancialData {
  payroll_current_gross: number; payroll_current_net: number; payroll_mom_change: number
  payroll_cost_trend: Array<{ month: string; total_gross: number; employee_count: number; avg_cost_per_head: number }>
  dept_cost_breakdown: Array<{ dept: string; headcount: number; total_gross: number; total_net: number; ot_cost: number }>
  component_mix?: {
    month: string; fixed_pay: number; variable_pay: number; statutory_cost: number
    ot_cost: number; employee_deductions: number; gross_total: number; has_data: boolean
  }
}
interface ComplianceData {
  open_incidents: number; critical_incidents: number; open_exceptions: number
  trust_high_risk: number; compliance_risk_score: number; risk_status: 'low' | 'medium' | 'high'
}
interface TrendsData {
  months: Array<{ month: string; attendance_rate: number; leave_days_approved: number; payroll_gross: number | null; payroll_headcount: number | null; joiners: number; exits: number; net_headcount: number }>
}

// ── Palette & helpers ────────────────────────────────────────────────────────────

const C = {
  blue: '#2E6FE6', teal: '#15B8A6', violet: '#7C5CFC', amber: '#E0A53B',
  cyan: '#22B8CF', rose: '#E5564B', green: '#1FA968', slate: '#64748B',
}
const CAT = [C.blue, C.teal, C.violet, C.amber, C.cyan, C.rose, C.green, C.slate]
const GRID = 'var(--border)'
const AXIS = { fontSize: 10, fill: 'var(--muted-foreground)' } as const

function cr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`
  return `₹${Math.round(n).toLocaleString()}`
}
function fmtMonth(ym: string): string {
  try { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1).toLocaleString('default', { month: 'short' }) }
  catch { return ym }
}
function genderColor(k: string): string {
  const x = k.toLowerCase()
  if (/female|^f$/.test(x)) return C.teal
  if (/male|^m$/.test(x)) return C.blue
  return C.violet
}
const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function ExecutiveIntelligenceCenter() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<'30D' | 'QTD' | 'YTD' | '12M'>('12M')
  const [drillDept, setDrillDept] = useState<DeptRow | null>(null)

  const ceoQ        = useQuery<CeoSnapshot>({ queryKey: ['exec-ceo'],        queryFn: () => api.get<{ data?: CeoSnapshot } & CeoSnapshot>('/executive/ceo').then((r) => r.data ?? r),        staleTime: 5 * 60_000 })
  const chroQ       = useQuery<ChroSnapshot>({ queryKey: ['exec-chro'],       queryFn: () => api.get<{ data?: ChroSnapshot } & ChroSnapshot>('/executive/chro').then((r) => r.data ?? r),       staleTime: 5 * 60_000 })
  const workforceQ  = useQuery<WorkforceData>({ queryKey: ['exec-workforce'],  queryFn: () => api.get<{ data?: WorkforceData } & WorkforceData>('/executive/workforce').then((r) => r.data ?? r),  staleTime: 5 * 60_000 })
  const financialQ  = useQuery<FinancialData>({ queryKey: ['exec-financial'],  queryFn: () => api.get<{ data?: FinancialData } & FinancialData>('/executive/financial').then((r) => r.data ?? r),  staleTime: 5 * 60_000 })
  const complianceQ = useQuery<ComplianceData>({ queryKey: ['exec-compliance'], queryFn: () => api.get<{ data?: ComplianceData } & ComplianceData>('/executive/compliance').then((r) => r.data ?? r), staleTime: 5 * 60_000 })
  const trendsQ     = useQuery<TrendsData>({ queryKey: ['exec-trends'],      queryFn: () => api.get<{ data?: TrendsData } & TrendsData>('/executive/trends').then((r) => r.data ?? r),      staleTime: 5 * 60_000 })

  const ceo = ceoQ.data, chro = chroQ.data, wf = workforceQ.data, fin = financialQ.data, comp = complianceQ.data, trends = trendsQ.data

  // Period slicer → trend window (months)
  const winMonths = period === '30D' ? 2 : period === 'QTD' ? 3 : period === 'YTD' ? Math.max(2, new Date().getMonth() + 1) : 12
  const win = <T,>(arr: T[]): T[] => arr.slice(-winMonths)

  // ── Derived (all from real data) ──────────────────────────────────────────────

  const genderFemalePct = useMemo(() => {
    const g = wf?.gender_distribution ?? chro?.gender_distribution ?? {}
    const total = Object.values(g).reduce((s, v) => s + v, 0)
    const female = Object.entries(g).find(([k]) => /female|^f$/i.test(k))?.[1] ?? 0
    return total > 0 ? (female / total) * 100 : null
  }, [wf, chro])

  const attritionTTM = useMemo(() => {
    const m = trends?.months ?? []
    if (m.length === 0) return null
    const exits = m.reduce((s, r) => s + (r.exits ?? 0), 0)
    const avgHc = m.reduce((s, r) => s + (r.net_headcount ?? 0), 0) / m.length
    return avgHc > 0 ? (exits / avgHc) * 100 : null
  }, [trends])

  // Headcount vs payroll cost (combo)
  const hcCost = win((fin?.payroll_cost_trend ?? []).map(r => ({
    month: fmtMonth(r.month), headcount: r.employee_count, cost: +(r.total_gross / 1e7).toFixed(2),
  })))

  // Joiners vs exits — diverging flow
  const flow = win((trends?.months ?? []).map(r => ({
    month: fmtMonth(r.month), joiners: r.joiners ?? 0, exits: -(r.exits ?? 0), net: (r.joiners ?? 0) - (r.exits ?? 0),
  })))

  // Department headcount — ranked
  const deptHeadcount = useMemo(() => [...(wf?.dept_distribution ?? [])]
    .sort((a, b) => b.count - a.count).slice(0, 8)
    .map((d, i) => ({ dept: d.dept, count: d.count, color: CAT[i % CAT.length] })), [wf])

  // Department cost — ranked (₹L)
  const deptCost = useMemo(() => [...(fin?.dept_cost_breakdown ?? [])]
    .sort((a, b) => b.total_gross - a.total_gross).slice(0, 8)
    .map(d => ({ dept: d.dept, value: +(d.total_gross / 1e5).toFixed(2), gross: d.total_gross })), [fin])

  // Employment-type composition (donut)
  const mixData = (wf?.employment_type_distribution ?? []).map((d, i) => ({ name: tc(d.type), value: d.count, color: CAT[i % CAT.length] }))

  // Gender (donut)
  const genderData = useMemo(() => {
    const g = wf?.gender_distribution ?? chro?.gender_distribution ?? {}
    return Object.entries(g).filter(([, v]) => v > 0).map(([k, v]) => ({ name: tc(k), value: v, color: genderColor(k) }))
  }, [wf, chro])
  const genderTotal = genderData.reduce((s, d) => s + d.value, 0)

  // Cost / head trend (₹K)
  const cphTrend = win((fin?.payroll_cost_trend ?? []).map(r => ({ month: fmtMonth(r.month), cph: +(r.avg_cost_per_head / 1000).toFixed(1) })))

  // Attendance & leave
  const attLeave = win((trends?.months ?? []).map(r => ({
    month: fmtMonth(r.month), attendance: +(r.attendance_rate ?? 0).toFixed(1), leave: r.leave_days_approved ?? 0,
  })))

  // Payroll component mix
  const mixSegs = useMemo(() => {
    const m = fin?.component_mix
    if (!m || !m.has_data) return []
    return [
      { label: 'Fixed Pay', value: m.fixed_pay, color: C.blue },
      { label: 'Variable Pay', value: m.variable_pay, color: C.teal },
      { label: 'Statutory', value: m.statutory_cost, color: C.violet },
      { label: 'Overtime', value: m.ot_cost, color: C.amber },
    ].filter(s => s.value > 0)
  }, [fin])
  const mixTotal = mixSegs.reduce((s, x) => s + x.value, 0)

  // Compliance risk gauge
  const riskScore = comp?.compliance_risk_score ?? 0
  const riskColor = comp?.risk_status === 'high' ? C.rose : comp?.risk_status === 'medium' ? C.amber : C.green

  // Department table
  const deptRows: DeptRow[] = useMemo(() => {
    const costByDept = new Map((fin?.dept_cost_breakdown ?? []).map(d => [d.dept, d]))
    const rows = (wf?.dept_distribution ?? []).map(d => {
      const c = costByDept.get(d.dept)
      const gross = c?.total_gross ?? 0
      const headcount = c?.headcount ?? d.count
      return {
        name: d.dept, headcount, cost: gross / 1e7,
        costPerHead: headcount > 0 && gross > 0 ? gross / headcount / 1000 : null,
        net: c?.total_net ?? null, ot: c?.ot_cost ?? null,
        open: null, attrition: null, productivity: null, female: null, contract: null, growth: null,
      } as DeptRow
    })
    return rows.sort((a, b) => b.headcount - a.headcount)
  }, [wf, fin])

  const insights = [
    ceo?.narrative ? { label: 'CEO Summary', body: ceo.narrative } : null,
    chro?.narrative ? { label: 'CHRO Summary', body: chro.narrative } : null,
  ].filter(Boolean) as { label: string; body: string }[]

  const loading = ceoQ.isLoading || workforceQ.isLoading
  // F29: 6 independent snapshot queries feed this page — previously none of
  // their isError states were checked, so a failed fetch rendered every KPI
  // as '—' and every chart as "No data", identical to a genuinely-empty
  // tenant, with no signal anything broke.
  const anyError = ceoQ.isError || chroQ.isError || workforceQ.isError || financialQ.isError || complianceQ.isError || trendsQ.isError
  const retryAll = () => { ceoQ.refetch(); chroQ.refetch(); workforceQ.refetch(); financialQ.refetch(); complianceQ.refetch(); trendsQ.refetch() }
  const fmtNum = (n: number | undefined | null) => (n ?? 0).toLocaleString()
  const asOf = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  function exportDepts() {
    const rows = [['Department', 'Headcount', 'Cost (Cr)', 'Cost/Head (K)'], ...deptRows.map(d => [d.name, String(d.headcount), d.cost.toFixed(2), d.costPerHead?.toFixed(1) ?? ''])]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'department-manpower.csv'; a.click()
  }

  const netFlow = (ceo?.joiners_30d ?? 0) - (ceo?.exits_30d ?? 0)
  const kpis = [
    { label: 'Active Headcount', value: fmtNum(ceo?.employee_count), trend: ceo ? +(ceo.net_headcount_change / Math.max(1, ceo.employee_count) * 100).toFixed(1) : undefined, trendLabel: '30D', icon: Users, variant: 'neutral' as const, subtitle: ceo ? `+${ceo.joiners_30d} / -${ceo.exits_30d}` : undefined },
    { label: 'Net Flow · 30D', value: `${netFlow >= 0 ? '+' : ''}${netFlow}`, icon: netFlow >= 0 ? TrendingUp : TrendingDown, variant: (netFlow >= 0 ? 'success' : 'destructive') as 'success' | 'destructive', subtitle: ceo ? `Joiners − exits · ${ceo.joiners_30d} in · ${ceo.exits_30d} out` : 'Joiners − exits' },
    { label: 'Attrition · TTM', value: attritionTTM == null ? '—' : `${attritionTTM.toFixed(1)}%`, icon: UserMinus, variant: 'destructive' as const, subtitle: 'Annualised' },
    { label: 'Monthly Payroll', value: cr(fin?.payroll_current_gross ?? 0), trend: fin?.payroll_mom_change, trendLabel: 'MoM', icon: Wallet, variant: 'info' as const },
    { label: 'Cost / Head', value: cr(ceo?.avg_cost_per_employee ?? 0), icon: Coins, variant: 'neutral' as const, subtitle: 'Monthly avg' },
    { label: 'Attendance', value: ceo ? `${ceo.attendance_rate.toFixed(1)}%` : '—', icon: CalendarCheck, variant: 'success' as const, subtitle: ceo ? `${ceo.absence_rate.toFixed(1)}% absent` : undefined },
  ]

  return (
    <ExecLayout
      title="Manpower Intelligence Center"
      subtitle={`CEO view · ${loading ? 'loading…' : 'live data'}`}
      actions={
        <div className="flex items-center gap-2">
          <div className="hidden items-center rounded-lg border bg-muted/40 p-0.5 sm:flex">
            {(['30D', 'QTD', 'YTD', '12M'] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', period === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{p}</button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportDepts}><Download className="h-3.5 w-3.5" /> Export</Button>
        </div>
      }
    >
      {anyError && <ExecErrorBanner onRetry={retryAll} />}
      {/* Report header band */}
      <section className="relative overflow-hidden rounded-xl border bg-[image:var(--gradient-primary)] px-5 py-4 text-primary-foreground shadow-[var(--shadow-elegant)]">
        <div className="absolute -right-16 -top-20 h-48 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider backdrop-blur">
              <Activity className="h-3 w-3" /> Live · as of {asOf}
            </div>
            <h1 className="text-lg font-semibold tracking-tight md:text-xl">
              {ceo?.employee_count != null
                ? <>{fmtNum(ceo.employee_count)} active employees · {cr(fin?.payroll_current_gross ?? 0)} monthly payroll</>
                : 'Executive manpower overview'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeaderStat label="Attendance" value={ceo ? `${ceo.attendance_rate.toFixed(1)}%` : '—'} />
            <HeaderStat label="Net 30D" value={ceo ? `${ceo.net_headcount_change >= 0 ? '+' : ''}${ceo.net_headcount_change}` : '—'} />
            <HeaderStat label="At-Risk" value={fmtNum(comp?.trust_high_risk)} />
            <HeaderStat label="Critical" value={fmtNum(comp?.critical_incidents)} tone="danger" />
          </div>
        </div>
      </section>

      {/* KPI ribbon */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => <MetricCard key={k.label} {...k} />)}
      </section>

      {/* Visual grid */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Headcount vs payroll cost */}
        <Viz className="lg:col-span-8" icon={Users} title="Headcount vs Payroll Cost"
          sub="Active employees (bars) · payroll ₹Cr (line)" right={<Slice period={period} />}>
          {hcCost.length > 0 ? (
            <div className="h-[224px]">
              <ResponsiveContainer>
                <ComposedChart data={hcCost} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="l" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={AXIS} tickLine={false} axisLine={false} unit="Cr" />
                  <Tooltip content={<ChartTip fmt={(v: number, p: { dataKey?: string }) => (p.dataKey === 'cost' ? `₹${v}Cr` : v)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar yAxisId="l" dataKey="headcount" name="Headcount" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={34} />
                  <Line yAxisId="r" type="monotone" dataKey="cost" name="Payroll ₹Cr" stroke={C.amber} strokeWidth={2.5} dot={{ r: 2.5, fill: C.amber }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Trend appears once payroll has run for a few months." />}
        </Viz>

        {/* Workforce composition donut */}
        <Viz className="lg:col-span-4" icon={Layers} title="Workforce Composition" sub="By employment type">
          {mixData.length > 0 ? (
            <DonutBlock data={mixData} centerValue={fmtNum(wf?.employee_count)} centerLabel="employees" />
          ) : <NoData text="No composition data." />}
        </Viz>

        {/* Joiners vs exits */}
        <Viz className="lg:col-span-4" icon={Activity} title="Joiners vs Exits" sub="Monthly flow · net line" right={<Slice period={period} />}>
          {flow.length > 0 ? (
            <div className="h-[200px]">
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

        {/* Department headcount ranked */}
        <Viz className="lg:col-span-4" icon={Building2} title="Headcount by Department" sub="Top departments">
          {deptHeadcount.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer>
                <BarChart data={deptHeadcount} layout="vertical" margin={{ top: 2, right: 28, left: 4, bottom: 2 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="dept" width={88} tick={{ ...AXIS }} tickLine={false} axisLine={false}
                    tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 12)}…` : v)} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="count" name="Headcount" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {deptHeadcount.map((d) => <Cell key={d.dept} fill={d.color} />)}
                    <LabelList dataKey="count" position="right" className="fill-foreground" style={{ fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="No department headcount data." />}
        </Viz>

        {/* Gender donut */}
        <Viz className="lg:col-span-4" icon={Users} title="Gender Diversity" sub="Org-wide split">
          {genderData.length > 0 ? (
            <DonutBlock data={genderData} centerValue={genderFemalePct == null ? '—' : `${genderFemalePct.toFixed(0)}%`} centerLabel="female" total={genderTotal} />
          ) : <NoData text="No gender distribution data." />}
        </Viz>

        {/* Department cost ranked */}
        <Viz className="lg:col-span-8" icon={Wallet} title="Payroll Cost by Department" sub="Gross monthly cost · ranked"
          right={<Badge variant="secondary" className="text-[10px]">{cr(fin?.payroll_current_gross ?? 0)} total</Badge>}>
          {deptCost.length > 0 ? (
            <div className="h-[224px]">
              <ResponsiveContainer>
                <BarChart data={deptCost} layout="vertical" margin={{ top: 2, right: 56, left: 4, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} unit="L" />
                  <YAxis type="category" dataKey="dept" width={96} tick={{ ...AXIS }} tickLine={false} axisLine={false}
                    tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)} />
                  <Tooltip content={<ChartTip fmt={(_v: number, p: { payload?: { gross?: number } }) => cr(p.payload?.gross ?? 0)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar dataKey="value" name="Gross cost" fill={C.teal} radius={[0, 4, 4, 0]} maxBarSize={20}>
                    <LabelList dataKey="gross" position="right" formatter={(v: number) => cr(v)} className="fill-foreground" style={{ fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="No department cost data." />}
        </Viz>

        {/* Compliance risk gauge */}
        <Viz className="lg:col-span-4" icon={ShieldCheck} title="Compliance Risk" sub="Composite risk score">
          <div className="flex flex-col items-center">
            <div className="relative h-[140px] w-full">
              <ResponsiveContainer>
                <RadialBarChart innerRadius="68%" outerRadius="100%" data={[{ value: riskScore, fill: riskColor }]} startAngle={180} endAngle={0}>
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar background={{ fill: 'var(--muted)' }} dataKey="value" cornerRadius={10} angleAxisId={0} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center">
                <span className="text-3xl font-bold tabular-nums" style={{ color: riskColor }}>{riskScore.toFixed(0)}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: riskColor }}>{comp?.risk_status ?? '—'} risk</span>
              </div>
            </div>
            <div className="mt-1 grid w-full grid-cols-3 gap-2 text-center">
              <MiniStat label="Incidents" value={fmtNum(comp?.open_incidents)} tone={(comp?.open_incidents ?? 0) > 0 ? 'destructive' : 'success'} />
              <MiniStat label="Critical" value={fmtNum(comp?.critical_incidents)} tone="destructive" />
              <MiniStat label="Exceptions" value={fmtNum(comp?.open_exceptions)} tone={(comp?.open_exceptions ?? 0) > 0 ? 'destructive' : 'success'} />
            </div>
          </div>
        </Viz>

        {/* Attendance & leave */}
        <Viz className="lg:col-span-5" icon={CalendarCheck} title="Attendance & Leave" sub="Attendance % · approved leave days" right={<Slice period={period} />}>
          {attLeave.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer>
                <ComposedChart data={attLeave} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <defs><linearGradient id="attA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.teal} stopOpacity={0.35} /><stop offset="100%" stopColor={C.teal} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="l" domain={[60, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" />
                  <YAxis yAxisId="r" orientation="right" tick={AXIS} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v: number, p: { dataKey?: string }) => (p.dataKey === 'attendance' ? `${v}%` : `${v} days`)} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Bar yAxisId="r" dataKey="leave" name="Leave days" fill={C.violet} radius={[3, 3, 0, 0]} maxBarSize={16} opacity={0.55} />
                  <Area yAxisId="l" type="monotone" dataKey="attendance" name="Attendance %" stroke={C.teal} strokeWidth={2.5} fill="url(#attA)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Attendance trend appears once attendance is processed." />}
        </Viz>

        {/* Cost per head trend */}
        <Viz className="lg:col-span-4" icon={Coins} title="Cost per Head" sub="Avg monthly ₹K" right={<Slice period={period} />}>
          {cphTrend.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer>
                <AreaChart data={cphTrend} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <defs><linearGradient id="cphA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.35} /><stop offset="100%" stopColor={C.blue} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="K" />
                  <Tooltip content={<ChartTip fmt={(v: number) => `₹${v}K`} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                  <Area type="monotone" dataKey="cph" name="Cost/head" stroke={C.blue} strokeWidth={2.5} fill="url(#cphA)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData text="Cost-per-head appears once payroll history builds up." />}
        </Viz>

        {/* Payroll component mix */}
        <Viz className="lg:col-span-3" icon={Wallet} title="Cost Mix" sub="By component">
          {mixSegs.length > 0 ? (
            <div className="flex h-[200px] flex-col justify-center gap-3">
              <div className="flex h-3 overflow-hidden rounded-full">
                {mixSegs.map(s => <div key={s.label} style={{ width: `${(s.value / mixTotal) * 100}%`, background: s.color }} title={s.label} />)}
              </div>
              {mixSegs.map(s => (
                <div key={s.label} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                  <span className="font-medium tabular-nums">{cr(s.value)} · {((s.value / mixTotal) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          ) : <NoData text="Component mix appears once a payroll run is finalised." />}
        </Viz>
      </section>

      {/* Department table */}
      <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Department Manpower Analysis</h3><Badge variant="secondary" className="ml-1">{deptRows.length} depts</Badge></div>
            <p className="text-xs text-muted-foreground">Headcount &amp; payroll cost are live · click a row to drill down</p>
          </div>
          <Button variant="ghost" size="sm" className="text-xs" onClick={exportDepts}>Export <Download className="ml-1 h-3 w-3" /></Button>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <th className="px-3 py-2 text-right font-medium">Headcount</th>
                <th className="px-3 py-2 text-right font-medium">Cost ₹Cr</th>
                <th className="px-3 py-2 text-right font-medium">Cost/Head</th>
                <th className="px-3 py-2 text-right font-medium">OT Cost</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {deptRows.map((d) => (
                <tr key={d.name} onClick={() => setDrillDept(d)} className="cursor-pointer hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{d.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.headcount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">₹{d.cost.toFixed(1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{d.costPerHead == null ? '—' : `₹${d.costPerHead.toFixed(1)}K`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{d.ot ? cr(d.ot) : '—'}</td>
                  <td className="px-3 py-2.5 text-right"><ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></td>
                </tr>
              ))}
              {deptRows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-xs text-muted-foreground">No department data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* AI insights + exceptions */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Viz className="lg:col-span-4" icon={Sparkles} title="AI Manpower Insights" right={<Badge variant="secondary" className="text-[10px]">Auto</Badge>}>
          <div className="space-y-2.5">
            {insights.length > 0 ? insights.map((ins) => (
              <div key={ins.label} className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{ins.label}</div>
                <p className="text-xs leading-relaxed text-muted-foreground">{ins.body}</p>
              </div>
            )) : <NoData text="Narrative insights appear once the snapshot is generated." />}
          </div>
        </Viz>

        <Viz className="lg:col-span-8" icon={AlertTriangle} title="Manpower Exceptions & Actions"
          right={<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate('/admin/intelligence/action-center')}>Action Center <ArrowRight className="ml-1 h-3 w-3" /></Button>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Open Exceptions" value={fmtNum(ceo?.open_exceptions)} tone={(ceo?.open_exceptions ?? 0) > 0 ? 'destructive' : 'success'} boxed />
            <MiniStat label="Open Incidents" value={fmtNum(comp?.open_incidents)} tone={(comp?.open_incidents ?? 0) > 0 ? 'destructive' : 'success'} boxed />
            <MiniStat label="Critical" value={fmtNum(comp?.critical_incidents)} tone="destructive" boxed />
            <MiniStat label="Pending Revisions" value={fmtNum(ceo?.pending_revisions)} tone="muted" boxed />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">An itemised exception feed lives in the Action Center — these are the live roll-up counts.</p>
        </Viz>
      </section>

      <footer className="pb-4 pt-2 text-center text-[11px] text-muted-foreground">
        Manpower Intelligence Center · HRMS · Confidential · Live data
      </footer>

      <DrillDownSheet open={!!drillDept} onOpenChange={(o) => !o && setDrillDept(null)} dept={drillDept} />
    </ExecLayout>
  )
}

// ── Reusable bits ────────────────────────────────────────────────────────────────

function Viz({ title, sub, icon: Icon, right, className, children }: {
  title: string; sub?: string; icon?: React.ComponentType<{ className?: string }>
  right?: React.ReactNode; className?: string; children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-3.5 shadow-[var(--shadow-card)]', className)}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          <div>
            <h3 className="text-[13px] font-semibold leading-tight text-foreground">{title}</h3>
            {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function DonutBlock({ data, centerValue, centerLabel, total }: {
  data: { name: string; value: number; color: string }[]; centerValue: string; centerLabel: string; total?: number
}) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={46} outerRadius={68} paddingAngle={2} stroke="var(--background)" strokeWidth={2}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTip fmt={(v: number) => `${v} · ${sum > 0 ? ((v / sum) * 100).toFixed(0) : 0}%`} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} /><span className="capitalize text-foreground">{d.name}</span></span>
            <span className="font-medium tabular-nums text-muted-foreground">{d.value} · {sum > 0 ? ((d.value / sum) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartTip({ active, payload, label, fmt }: {
  active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; fill?: string; dataKey?: string; payload?: Record<string, unknown> }>
  label?: string; fmt?: (v: number, p: { dataKey?: string; payload?: Record<string, unknown> }) => React.ReactNode
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-[11px] shadow-md">
      {label != null && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums text-foreground">{fmt ? fmt(p.value ?? 0, p) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

function NoData({ text }: { text: string }) {
  return <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 text-center text-[11px] leading-relaxed text-muted-foreground">{text}</div>
}

function Slice({ period }: { period: string }) {
  return <Badge variant="secondary" className="text-[10px] font-medium">{period}</Badge>
}

function HeaderStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className={cn('rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-white backdrop-blur', tone === 'danger' && 'bg-destructive/25')}>
      <div className="text-[9px] font-medium uppercase tracking-wider text-white/75">{label}</div>
      <div className="text-base font-semibold tabular-nums leading-tight">{value}</div>
    </div>
  )
}

function MiniStat({ label, value, tone, boxed }: { label: string; value: string; tone: 'success' | 'destructive' | 'muted'; boxed?: boolean }) {
  const cls = tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
  return (
    <div className={cn(boxed && 'rounded-lg border bg-background/40 p-2.5')}>
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-base font-semibold tabular-nums', cls)}>{value}</div>
    </div>
  )
}
