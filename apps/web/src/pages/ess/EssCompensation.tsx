/**
 * EssCompensation — /ess/compensation (Employee Self-Service)
 *
 * Compensation transparency view for employees:
 * - Current CTC breakdown
 * - Compensation revision history (read-only)
 * - Monthly payslip trend (gross vs net)
 *
 * Access: all authenticated roles (employees see own data).
 */

import { useState }                          from 'react'
import { useQuery }                          from '@tanstack/react-query'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  DollarSign, TrendingUp, FileText,
  ChevronDown, ChevronUp, CheckCircle2,
  Clock, XCircle, AlertTriangle,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { Badge }            from '@/components/ui/badge'
import {
  getAxisStyle, getGridStyle, getTooltipStyle, getChartColor,
} from '@/components/ui/chart'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ActiveComp {
  id:              string
  ctc_annual:      number
  ctc_monthly:     number
  effective_from:  string
  salary_structures?: { name: string }
  employee_compensation_components?: CompComponent[]
}

interface CompComponent {
  id:               string
  computed_monthly: number
  computed_annual:  number
  sequence:         number
  salary_components?: {
    name:             string
    code:             string
    component_type:   'earning' | 'deduction' | 'employer_contribution'
    is_taxable:       boolean
  }
}

interface CompRevision {
  id:               string
  revision_type:    string
  status:           'pending' | 'approved' | 'rejected' | 'withdrawn'
  effective_date:   string
  before_ctc_annual: number | null
  new_ctc_annual:   number
  delta_pct:        number | null
  notes:            string | null
  created_at:       string
}

interface PayslipRow {
  month:       string
  total_gross: number
  total_net:   number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${Math.round(n)}`
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' })
}

const STATUS_BADGE: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'destructive',
  withdrawn: 'secondary',
}

const STATUS_ICON: Record<string, React.ElementType> = {
  pending:   Clock,
  approved:  CheckCircle2,
  rejected:  XCircle,
  withdrawn: XCircle,
}

const TYPE_LABEL: Record<string, string> = {
  increment:   'Increment',
  promotion:   'Promotion',
  revision:    'Revision',
  correction:  'Correction',
  restructure: 'Restructure',
  retro:       'Retro',
}

// Component type color classes (reserved for future use)
// earning: 'text-success', deduction: 'text-destructive', employer_contribution: 'text-info'

// ── Main page ─────────────────────────────────────────────────────────────────

export function EssCompensation() {
  const { profile }        = useAuthStore()
  const employeeId         = profile?.employee_id as string | undefined
  const [showHistory, setShowHistory] = useState(false)

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  // ── Queries ──────────────────────────────────────────────────────────────

  const compQ = useQuery<{ data: ActiveComp }>({
    queryKey: ['ess-comp-active', employeeId],
    queryFn:  () => api.get(`/employees/${employeeId}/compensation`),
    enabled:  !!employeeId,
    staleTime: 300_000,
  })

  const revQ = useQuery<{ data: CompRevision[] }>({
    queryKey: ['ess-comp-revisions', employeeId],
    queryFn:  () => api.get(`/compensation/revisions/employee/${employeeId}`),
    enabled:  !!employeeId && showHistory,
    staleTime: 120_000,
  })

  // Payslips — last 6 months from payroll runs
  const slipsQ = useQuery<{ data: PayslipRow[] }>({
    queryKey: ['ess-payslip-trend', employeeId],
    queryFn:  () => api.get(`/payroll/slips/trend?employee_id=${employeeId}&months=6`),
    enabled:  !!employeeId,
    staleTime: 300_000,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const comp       = compQ.data?.data
  const revisions  = revQ.data?.data ?? []
  const slipTrend  = slipsQ.data?.data ?? []
  const components = comp?.employee_compensation_components ?? []

  const earnings   = components.filter(c => c.salary_components?.component_type === 'earning')
  const deductions = components.filter(c => c.salary_components?.component_type === 'deduction')

  const chartData = slipTrend.map(s => ({
    month: monthLabel(s.month),
    Gross: Math.round(s.total_gross / 1000),
    Net:   Math.round(s.total_net / 1000),
  }))

  // ── No employee linked ────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="My Compensation" subtitle="Your salary structure and revision history" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Your profile is not linked to an employee record. Contact HR.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="My Compensation"
        subtitle="Your current CTC, salary components, and revision history"
      />

      {/* CTC summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-primary/10">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Annual CTC</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {compQ.isLoading ? '…' : fmt(comp?.ctc_annual)}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-success/10">
            <TrendingUp className="h-5 w-5 text-success" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monthly CTC</p>
            <p className="text-2xl font-bold text-success tabular-nums">
              {compQ.isLoading ? '…' : fmt(comp?.ctc_monthly)}
            </p>
            {comp?.salary_structures?.name && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {comp.salary_structures.name}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Salary components */}
      <SectionCard
        title="Salary Structure"
        icon={<FileText className="h-4 w-4 text-muted-foreground" />}
      >
        {compQ.isLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-6 text-center">
            Loading structure…
          </div>
        )}
        {!compQ.isLoading && components.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No salary components configured. Contact HR.
          </p>
        )}
        {!compQ.isLoading && components.length > 0 && (
          <>
            <div className="space-y-4">
              {earnings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                    Earnings
                  </p>
                  <div className="space-y-1">
                    {earnings.sort((a, b) => a.sequence - b.sequence).map(c => (
                      <div key={c.id}
                        className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 text-sm">
                        <div>
                          <span className="font-medium text-foreground">
                            {c.salary_components?.name}
                          </span>
                          {c.salary_components?.is_taxable && (
                            <Badge className="ml-2 rounded-full text-[9px]" variant="outline">Taxable</Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-success tabular-nums">
                            {fmt(c.computed_monthly)}<span className="text-xs text-muted-foreground">/mo</span>
                          </p>
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            {fmt(c.computed_annual)}/yr
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deductions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                    Deductions
                  </p>
                  <div className="space-y-1">
                    {deductions.sort((a, b) => a.sequence - b.sequence).map(c => (
                      <div key={c.id}
                        className="flex items-center justify-between px-3 py-2 rounded-md bg-destructive/5 text-sm">
                        <span className="font-medium text-foreground">
                          {c.salary_components?.name}
                        </span>
                        <div className="text-right">
                          <p className="font-semibold text-destructive tabular-nums">
                            -{fmt(c.computed_monthly)}<span className="text-xs text-muted-foreground">/mo</span>
                          </p>
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            -{fmt(c.computed_annual)}/yr
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {comp?.effective_from && (
              <p className="text-[10px] text-muted-foreground pt-3 border-t border-border mt-3">
                Effective from {fmtDate(comp.effective_from)}
              </p>
            )}
          </>
        )}
      </SectionCard>

      {/* Payslip trend chart */}
      {chartData.length > 0 && (
        <SectionCard
          title="Gross vs Net — Last 6 Months"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="month" {...axisStyle} />
              <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
              <Line type="monotone" dataKey="Gross"
                stroke={getChartColor('chart1')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Net"
                stroke={getChartColor('active')} strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* Revision history */}
      <SectionCard
        title="Revision History"
        icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        action={
          <button
            className="text-xs text-primary hover:underline flex items-center gap-1"
            onClick={() => setShowHistory(v => !v)}
          >
            {showHistory
              ? <><ChevronUp className="h-3.5 w-3.5" />Hide</>
              : <><ChevronDown className="h-3.5 w-3.5" />Show</>}
          </button>
        }
      >
        {!showHistory && (
          <p className="text-xs text-muted-foreground py-2">
            Click "Show" to view your compensation revision history.
          </p>
        )}
        {showHistory && revQ.isLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-6 text-center">
            Loading history…
          </div>
        )}
        {showHistory && !revQ.isLoading && revisions.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No compensation revisions on record.
          </p>
        )}
        {showHistory && !revQ.isLoading && revisions.length > 0 && (
          <div className="space-y-2">
            {revisions.map(rev => {
              const StatusIcon = STATUS_ICON[rev.status] ?? Clock
              return (
                <div key={rev.id}
                  className="flex items-start gap-3 border border-border rounded-md px-3 py-2.5">
                  <StatusIcon className={cn('h-4 w-4 flex-shrink-0 mt-0.5',
                    rev.status === 'approved'  ? 'text-success'
                    : rev.status === 'rejected' ? 'text-destructive'
                    : 'text-warning'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground">
                        {TYPE_LABEL[rev.revision_type] ?? rev.revision_type}
                      </span>
                      <Badge variant={STATUS_BADGE[rev.status]} className="rounded-full text-[9px]">
                        {rev.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        Eff. {fmtDate(rev.effective_date)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                      <span>{fmt(rev.before_ctc_annual)} → {fmt(rev.new_ctc_annual)}</span>
                      {rev.delta_pct != null && (
                        <span className={cn('font-medium',
                          rev.delta_pct >= 0 ? 'text-success' : 'text-destructive')}>
                          {rev.delta_pct > 0 ? '+' : ''}{rev.delta_pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {rev.notes && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 italic">{rev.notes}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
                    {fmtDate(rev.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
