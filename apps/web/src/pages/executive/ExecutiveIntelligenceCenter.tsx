/**
 * ExecutiveIntelligenceCenter — /admin/executive
 *
 * CEO / CHRO "Manpower Intelligence Center". Single-scroll executive dashboard.
 * Every figure is wired to the live /executive/* API. Panels for which we have
 * no backing data yet (predictive attrition, hiring funnel, exit reasons,
 * position ageing, productivity, per-department attrition, plan/budget, payroll
 * component mix) render an honest "not available yet" empty state rather than
 * fabricated numbers.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, ArrowRight,
  Clock, Download, Gauge, IndianRupee, Lightbulb,
  Sparkles, Target,
  UserMinus, UserPlus, Users, Wallet, CalendarCheck, Info, ChevronRight,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart,
  Legend, Line, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { KpiCard } from '@/components/exec/KpiCard'
import { DrillDownSheet, type DeptRow } from '@/components/exec/DrillDownSheet'
import { ExecLayout } from '@/components/exec/ExecShell'
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

// ── Helpers ─────────────────────────────────────────────────────────────────────

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const TIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } as const

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

  const headcountSpark = (fin?.payroll_cost_trend ?? []).map(r => r.employee_count)
  const attritionSpark = (trends?.months ?? []).map(r => (r.net_headcount > 0 ? +(r.exits / r.net_headcount * 100).toFixed(2) : 0))
  const costSpark      = (fin?.payroll_cost_trend ?? []).map(r => +(r.total_gross / 1e7).toFixed(2))

  const headcountTrend = (fin?.payroll_cost_trend ?? []).map(r => ({ month: fmtMonth(r.month), actual: r.employee_count }))
  const mixData = (wf?.employment_type_distribution ?? []).map((d, i) => ({ name: d.type, value: d.count, color: PALETTE[i % PALETTE.length] }))
  const attendanceTrend = (trends?.months ?? []).map(r => ({ month: fmtMonth(r.month), present: +(r.attendance_rate ?? 0).toFixed(1) }))
  const combinedTrend = (trends?.months ?? []).map(r => ({
    month: fmtMonth(r.month),
    headcount: r.net_headcount ?? 0,
    payroll: r.payroll_gross != null ? +(r.payroll_gross / 1e7).toFixed(2) : null,
    attrition: r.net_headcount > 0 ? +(r.exits / r.net_headcount * 100).toFixed(2) : 0,
  }))

  // Department table — real headcount + cost; per-dept attrition/diversity not available.
  const deptRows: DeptRow[] = useMemo(() => {
    const costByDept = new Map((fin?.dept_cost_breakdown ?? []).map(d => [d.dept, d]))
    const rows = (wf?.dept_distribution ?? []).map(d => {
      const c = costByDept.get(d.dept)
      const gross = c?.total_gross ?? 0
      const headcount = c?.headcount ?? d.count
      return {
        name: d.dept,
        headcount,
        cost: gross / 1e7,
        costPerHead: headcount > 0 && gross > 0 ? gross / headcount / 1000 : null,
        net: c?.total_net ?? null,
        ot: c?.ot_cost ?? null,
        open: null, attrition: null, productivity: null, female: null, contract: null, growth: null,
      } as DeptRow
    })
    return rows.sort((a, b) => b.headcount - a.headcount)
  }, [wf, fin])

  // AI insights from the real CEO/CHRO narratives
  const insights = [
    ceo?.narrative ? { label: 'CEO Summary', body: ceo.narrative, tone: 'border-info/30 bg-info/5' } : null,
    chro?.narrative ? { label: 'CHRO Summary', body: chro.narrative, tone: 'border-success/30 bg-success/5' } : null,
  ].filter(Boolean) as { label: string; body: string; tone: string }[]

  const loading = ceoQ.isLoading || workforceQ.isLoading
  const fmtNum = (n: number | undefined | null) => (n ?? 0).toLocaleString()

  function exportDepts() {
    const rows = [['Department', 'Headcount', 'Cost (Cr)', 'Cost/Head (K)'], ...deptRows.map(d => [d.name, String(d.headcount), d.cost.toFixed(2), d.costPerHead?.toFixed(1) ?? ''])]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'department-manpower.csv'; a.click()
  }

  const kpis = [
    { label: 'Active Headcount', value: fmtNum(ceo?.employee_count), delta: ceo ? +(ceo.net_headcount_change / Math.max(1, ceo.employee_count) * 100).toFixed(1) : undefined, deltaLabel: '30D', icon: Users, tone: 'primary' as const, spark: headcountSpark, hint: ceo ? `+${ceo.joiners_30d} / -${ceo.exits_30d}` : undefined },
    { label: 'Attrition (TTM)', value: attritionTTM == null ? '—' : `${attritionTTM.toFixed(1)}%`, icon: UserMinus, tone: 'destructive' as const, spark: attritionSpark, hint: 'Annualised' },
    { label: 'Manpower Cost', value: cr(fin?.payroll_current_gross ?? 0), delta: fin?.payroll_mom_change, deltaLabel: 'MoM', icon: Wallet, tone: 'info' as const, spark: costSpark, hint: fin ? ceo?.payroll_cost_current ? undefined : undefined : undefined },
    { label: 'Diversity (F)', value: genderFemalePct == null ? '—' : `${genderFemalePct.toFixed(1)}%`, icon: Sparkles, tone: 'info' as const, hint: 'Org-wide' },
    { label: 'Open Exceptions', value: fmtNum(ceo?.open_exceptions), delta: undefined, icon: AlertTriangle, tone: 'destructive' as const, hint: ceo ? `${ceo.open_incidents} incidents` : undefined },
  ]

  return (
    <ExecLayout
      title="Manpower Intelligence Center"
      subtitle={`CEO & CHRO view · ${loading ? 'loading…' : 'live data'}`}
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
        {/* Hero strip */}
        <section className="relative overflow-hidden rounded-2xl border bg-[image:var(--gradient-primary)] p-6 text-primary-foreground shadow-[var(--shadow-elegant)]">
          <div className="absolute -right-20 -top-20 h-56 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute right-10 bottom-0 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium uppercase tracking-wider backdrop-blur">
                <Activity className="h-3 w-3" /> Live · {loading ? 'Loading…' : 'Updated just now'}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                {ceo?.employee_count != null
                  ? <>Workforce at <span className="underline decoration-white/40 underline-offset-4">{fmtNum(ceo.employee_count)} active</span>, payroll {cr(fin?.payroll_current_gross ?? 0)} this month.</>
                  : 'Executive manpower overview'}
              </h1>
              <p className="mt-2 text-sm text-primary-foreground/80">
                {ceo?.narrative ?? 'Real-time headcount, payroll cost, attendance and risk — wired to live operational data.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 lg:gap-6">
              <HeroStat label="Attendance" value={ceo ? `${ceo.attendance_rate.toFixed(1)}%` : '—'} tone="success" />
              <HeroStat label="At-Risk" value={fmtNum(comp?.trust_high_risk)} tone="info" />
              <HeroStat label="Critical Items" value={fmtNum(comp?.critical_incidents)} tone="destructive" />
            </div>
          </div>
        </section>

        {/* KPI grid */}
        <section>
          <SectionHeader title="Critical Manpower KPIs" subtitle="Live snapshot from operational data" icon={Gauge} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
          </div>
        </section>

        {/* Headcount trend + Workforce mix */}
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel className="xl:col-span-2" icon={Users} iconClass="text-primary" title="Headcount Trend"
            subtitle="Active employees per month · plan/budget targets not configured">
            {headcountTrend.length > 0 ? (
              <div className="mt-4 h-60">
                <ResponsiveContainer>
                  <ComposedChart data={headcountTrend}>
                    <defs><linearGradient id="hcArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} domain={['dataMin - 30', 'dataMax + 20']} />
                    <Tooltip contentStyle={TIP} />
                    <Area type="monotone" dataKey="actual" name="Actual" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#hcArea)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyBody text="Headcount trend will appear once payroll has run for a few months." />}
          </Panel>

          <Panel icon={Users} iconClass="text-success" title="Workforce Composition" subtitle="By employment type · current">
            {mixData.length > 0 ? (
              <>
                <div className="mt-2 h-52">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={mixData} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="var(--background)" strokeWidth={2}>
                        {mixData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={TIP} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-2">
                  {mixData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} /><span className="text-foreground capitalize">{d.name}</span></div>
                      <span className="font-medium tabular-nums text-muted-foreground">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <EmptyBody text="No workforce composition data." />}
          </Panel>
        </section>

        {/* Predictive attrition (empty) + Attendance */}
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel className="xl:col-span-2" icon={Sparkles} iconClass="text-info" title="Predictive Attrition · Next 6 Months"
            badge={<Badge variant="secondary" className="bg-info/10 text-info border-info/20">AI</Badge>}
            subtitle="Forecast model not enabled yet">
            <EmptyBody text="Predictive attrition (ML forecast with confidence bands) isn't available yet — it needs the workforce intelligence engine enabled." />
          </Panel>

          <Panel icon={CalendarCheck} iconClass="text-primary" title="Attendance Trend" subtitle="Monthly attendance rate (%)">
            {attendanceTrend.length > 0 ? (
              <>
                <div className="mt-3 h-48">
                  <ResponsiveContainer>
                    <AreaChart data={attendanceTrend}>
                      <defs><linearGradient id="attA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} unit="%" domain={[70, 100]} />
                      <Tooltip contentStyle={TIP} />
                      <Area type="monotone" dataKey="present" name="Present %" stroke="var(--chart-3)" strokeWidth={2.5} fill="url(#attA)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <Separator className="my-3" />
                <div className="grid grid-cols-3 gap-3 text-center">
                  <MiniStat label="Present" value={ceo ? `${ceo.attendance_rate.toFixed(1)}%` : '—'} tone="success" />
                  <MiniStat label="Absence" value={ceo ? `${ceo.absence_rate.toFixed(1)}%` : '—'} tone="destructive" />
                  <MiniStat label="Leave Util" value={chro ? `${chro.leave_utilization_pct.toFixed(0)}%` : '—'} tone="muted" />
                </div>
              </>
            ) : <EmptyBody text="Attendance trend will appear once attendance is processed." />}
          </Panel>
        </section>

        {/* Combined trend + Payroll mix (empty) */}
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel className="xl:col-span-2" icon={IndianRupee} iconClass="text-primary" title="Manpower, Attrition & Payroll Cost Trend"
            badge={<Badge variant="secondary">12 months</Badge>} subtitle="Headcount & payroll (₹ Cr) bars · attrition % line">
            {combinedTrend.length > 0 ? (
              <div className="mt-4 h-60">
                <ResponsiveContainer>
                  <ComposedChart data={combinedTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} unit="%" />
                    <Tooltip contentStyle={TIP} />
                    <Bar yAxisId="left" dataKey="headcount" name="Headcount" fill="var(--chart-1)" radius={[3, 3, 0, 0]} barSize={14} />
                    <Bar yAxisId="left" dataKey="payroll" name="Payroll ₹Cr" fill="var(--chart-3)" radius={[3, 3, 0, 0]} barSize={14} />
                    <Line yAxisId="right" type="monotone" dataKey="attrition" name="Attrition %" stroke="var(--chart-5)" strokeWidth={2.5} dot={{ r: 3 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyBody text="Combined trend will appear once trend data is available." />}
          </Panel>

          <Panel icon={Wallet} iconClass="text-success" title="Payroll Cost Mix" subtitle="By component · monthly"
            badge={<Badge variant="secondary" className="ml-auto">{cr(fin?.payroll_current_gross ?? 0)}</Badge>}>
            {(() => {
              const m = fin?.component_mix
              const segs = m && m.has_data
                ? [
                    { label: 'Fixed Pay',      value: m.fixed_pay,      color: PALETTE[0] },
                    { label: 'Variable Pay',   value: m.variable_pay,   color: PALETTE[1] },
                    { label: 'Statutory Cost', value: m.statutory_cost, color: PALETTE[2] },
                    { label: 'Overtime',       value: m.ot_cost,        color: PALETTE[3] },
                  ].filter(s => s.value > 0)
                : []
              const total = segs.reduce((s, x) => s + x.value, 0)
              if (segs.length === 0) {
                return <EmptyBody text="Component-level payroll mix will appear once a payroll run is finalized for the current month." />
              }
              return (
                <div className="mt-4 space-y-3">
                  <div className="flex h-3 overflow-hidden rounded-full">
                    {segs.map(s => <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={s.label} />)}
                  </div>
                  {segs.map(s => (
                    <div key={s.label} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                      <span className="font-medium tabular-nums">{cr(s.value)} · {((s.value / total) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </Panel>
        </section>

        {/* Position ageing / tenure / reasons — all empty */}
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel icon={Clock} iconClass="text-warning" title="Open Position Ageing" subtitle="Days since requisition opened">
            <EmptyBody text="Requisition ageing isn't surfaced here yet. Open requisitions and the hiring funnel live in the CHRO view → Talent Acquisition." />
          </Panel>
          <Panel icon={UserMinus} iconClass="text-destructive" title="Attrition Ageing · Tenure" subtitle="Exits by tenure band">
            <EmptyBody text="Tenure-band attrition isn't available yet." />
          </Panel>
          <Panel icon={Lightbulb} iconClass="text-info" title="Why People Leave" subtitle="Top reasons (% of exits)"
            badge={<Badge variant="secondary" className="ml-auto">Exit interviews</Badge>}>
            <EmptyBody text="Exit-reason analysis needs exit-interview capture, which isn't wired yet." />
          </Panel>
        </section>

        {/* Hiring funnel (empty) + Diversity (empty) */}
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel icon={UserPlus} iconClass="text-info" title="Hiring Funnel" subtitle="Conversion across stages">
            <EmptyBody text="The hiring funnel and offer-acceptance rate are published in the CHRO view → Talent Acquisition (canonical surface)." />
          </Panel>
          <Panel className="xl:col-span-2" icon={Target} iconClass="text-primary" title="Gender Diversity by Department"
            subtitle="Per-department breakdown not available"
            badge={genderFemalePct != null ? <Badge variant="secondary" className="ml-auto">Org-wide F: {genderFemalePct.toFixed(0)}%</Badge> : undefined}>
            <EmptyBody text="Diversity is only available org-wide right now, not per department. Per-department gender will appear once it's modelled." />
          </Panel>
        </section>

        {/* AI insights + Exceptions */}
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel icon={Lightbulb} iconClass="text-warning" title="AI Manpower Insights" badge={<Badge variant="secondary" className="ml-auto">Auto-generated</Badge>}>
            <div className="mt-3 space-y-3">
              {insights.length > 0 ? insights.map((ins) => (
                <div key={ins.label} className={cn('rounded-xl border p-3', ins.tone)}>
                  <div className="mb-1 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{ins.label}</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ins.body}</p>
                </div>
              )) : <EmptyBody text="Narrative insights will appear once the snapshot is generated." />}
            </div>
          </Panel>

          <Panel className="xl:col-span-2" icon={AlertTriangle} iconClass="text-destructive" title="Manpower Exceptions & Actions"
            badge={<Badge className="bg-destructive/10 text-destructive border-destructive/20" variant="outline">{ceo?.open_exceptions ?? 0} open</Badge>}
            action={<Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate('/admin/intelligence/action-center')}>Action Center <ArrowRight className="ml-1 h-3 w-3" /></Button>}>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Open Exceptions" value={fmtNum(ceo?.open_exceptions)} tone={(ceo?.open_exceptions ?? 0) > 0 ? 'destructive' : 'success'} />
              <MiniStat label="Open Incidents" value={fmtNum(comp?.open_incidents)} tone={(comp?.open_incidents ?? 0) > 0 ? 'destructive' : 'success'} />
              <MiniStat label="Critical" value={fmtNum(comp?.critical_incidents)} tone="destructive" />
              <MiniStat label="Pending Revisions" value={fmtNum(ceo?.pending_revisions)} tone="muted" />
            </div>
            <div className="mt-4">
              <EmptyBody text="A detailed, itemised exception feed lives in the Action Center — these are the live roll-up counts." />
            </div>
          </Panel>
        </section>

        {/* Department analysis — real headcount + cost */}
        <section className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Department Manpower Analysis</h3><Badge variant="secondary" className="ml-1">{deptRows.length} depts</Badge></div>
              <p className="text-xs text-muted-foreground">Headcount &amp; payroll cost are live · click a row to drill down</p>
            </div>
            <Button variant="ghost" size="sm" className="text-xs" onClick={exportDepts}>Export <Download className="ml-1 h-3 w-3" /></Button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Department</th>
                  <th className="px-3 py-2 text-right font-medium">Headcount</th>
                  <th className="px-3 py-2 text-right font-medium">Cost ₹Cr</th>
                  <th className="px-3 py-2 text-right font-medium">Cost/Head</th>
                  <th className="px-3 py-2 text-right font-medium">OT Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Attrition</th>
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">—</td>
                    <td className="px-3 py-2.5 text-right"><ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></td>
                  </tr>
                ))}
                {deptRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-muted-foreground">No department data.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      <footer className="pb-4 pt-2 text-center text-[11px] text-muted-foreground">
        Manpower Intelligence Center · HRMS · Confidential · Live data
      </footer>

      <DrillDownSheet open={!!drillDept} onOpenChange={(o) => !o && setDrillDept(null)} dept={drillDept} />
    </ExecLayout>
  )
}

// ── Reusable bits ────────────────────────────────────────────────────────────────

function Panel({ title, subtitle, icon: Icon, iconClass, badge, action, className, children }: {
  title: string; subtitle?: string; icon: React.ComponentType<{ className?: string }>; iconClass?: string
  badge?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Icon className={cn('h-4 w-4', iconClass)} />
            <h3 className="text-sm font-semibold">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function EmptyBody({ text }: { text: string }) {
  return (
    <div className="mt-4 flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
      <Info className="h-6 w-6 text-muted-foreground/40" />
      <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">{text}</p>
    </div>
  )
}

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <div>
        <div className="flex items-center gap-2">{Icon && <Icon className="h-4 w-4 text-primary" />}<h2 className="text-sm font-semibold">{title}</h2></div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone: 'success' | 'info' | 'destructive' }) {
  const cls = tone === 'success' ? 'bg-success/20' : tone === 'destructive' ? 'bg-destructive/30' : 'bg-white/15'
  return (
    <div className={cn('rounded-xl border border-white/20 p-3 backdrop-blur text-white', cls)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-white/80">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: 'success' | 'destructive' | 'muted' }) {
  const cls = tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', cls)}>{value}</div>
    </div>
  )
}
