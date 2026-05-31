/**
 * MyPayslips — /ess/payroll/my-slips
 *
 * ESS self-service page: employees view their own finalized pay slips.
 *
 * Uses GET /payroll/my-slips to list slips.
 * Uses GET /payroll/slips/:id for the full breakdown.
 *
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState }   from 'react'
import { useQuery }   from '@tanstack/react-query'
import {
  DollarSign, ChevronDown, ChevronUp,
  Loader2, AlertCircle, FileText,
  TrendingDown, TrendingUp, Calendar,
  BookOpen,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlipSummary {
  id:               string
  month:            string
  gross_pay:        number
  lop_amount:       number
  total_deductions: number
  net_pay:          number
  lop_days:         number
  payable_days:     number
  total_working_days: number
  overtime_hours:   number
  status:           'draft' | 'finalized' | 'held'
  held_reason:      string | null
  warning:          string | null
}

interface ComponentSnapshot {
  salary_component_id: string
  name:                string
  code:                string
  component_type:      'earning' | 'deduction' | 'employer_contribution'
  calc_type:           string
  value:               number
  monthly_amount:      number
  annual_amount:       number
  sequence:            number
}

interface SlipDetail extends SlipSummary {
  ctc_monthly:           number
  employer_contributions:number
  component_breakdown:   ComponentSnapshot[]
}

interface LedgerEntry {
  id:                  string
  month:               string
  event_type:          string
  event_description:   string
  impact_type:         string | null
  impact_amount:       number | null
  source_entity_type:  string | null
  created_at:          string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n)
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  })
}

/** Returns a short explanation of how a deduction/employer-contribution was computed. */
function getCalcHint(
  c:          ComponentSnapshot,
  basicAmt:   number,
  grossAmt:   number,
  ctcAmt:     number,
): string {
  switch (c.calc_type) {
    case 'pct_of_basic':
      return `${c.value}% of Basic (${fmtCurrency(basicAmt)})`
    case 'pct_of_ctc':
      return `${c.value}% of CTC (${fmtCurrency(ctcAmt)})`
    case 'pct_of_gross':
      return `${c.value}% of Gross (${fmtCurrency(grossAmt)})`
    case 'fixed':
      return 'Fixed amount'
    default:
      return c.calc_type ?? ''
  }
}

// ── Event type display helpers ─────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  leave_deducted:        'Leave Deducted',
  payable_days_changed:  'Payable Days Changed',
  lop_applied:           'LOP Applied',
  correction_approved:   'Correction Approved',
  attendance_recomputed: 'Attendance Recomputed',
  ot_added:              'Overtime Added',
  policy_changed:        'Policy Changed',
  retro_adjustment:      'Retro Adjustment',
  payroll_computed:      'Payroll Computed',
  payroll_finalized:     'Payroll Finalized',
  anomaly_resolved:      'Anomaly Resolved',
  manual_note:           'HR Note',
}

const EVENT_BADGE: Record<string, 'destructive' | 'warning' | 'success' | 'secondary' | 'outline'> = {
  leave_deducted:        'warning',
  payable_days_changed:  'warning',
  lop_applied:           'destructive',
  correction_approved:   'success',
  attendance_recomputed: 'secondary',
  ot_added:              'success',
  policy_changed:        'outline',
  retro_adjustment:      'warning',
  payroll_computed:      'secondary',
  payroll_finalized:     'success',
  anomaly_resolved:      'success',
  manual_note:           'outline',
}

// ── SalaryChangesSection ───────────────────────────────────────────────────────

function SalaryChangesSection({ employeeId, month }: { employeeId: string; month: string }) {
  const { data, isLoading } = useQuery<{ data: LedgerEntry[] }>({
    queryKey: ['my-salary-ledger', employeeId, month],
    queryFn:  () => api.get(`/payroll/ledger/${employeeId}?month=${month}`),
    staleTime: 300_000,
    enabled:   !!employeeId,
  })

  const entries = data?.data ?? []

  return (
    <div className="rounded-md border border-border bg-muted/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Why did my salary change? — Event Log
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading changes…
        </div>
      ) : entries.length === 0 ? (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          No salary-affecting events recorded for this month.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {entries.map((entry) => (
            <div key={entry.id} className="px-3 py-2.5 flex items-start gap-3">
              {/* Timeline dot */}
              <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={EVENT_BADGE[entry.event_type] ?? 'outline'}
                    className="rounded-full text-[9px] h-4"
                  >
                    {EVENT_LABEL[entry.event_type] ?? entry.event_type}
                  </Badge>
                  {entry.impact_amount != null && entry.impact_amount !== 0 && (
                    <span className={cn(
                      'text-[10px] font-mono font-semibold',
                      entry.impact_amount < 0 ? 'text-destructive' : 'text-success',
                    )}>
                      {entry.impact_amount > 0 ? '+' : ''}{entry.impact_amount} day{Math.abs(entry.impact_amount) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {entry.event_description}
                </p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                  {new Date(entry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SlipDetailCard ─────────────────────────────────────────────────────────────

function SlipDetailCard({ slipId, employeeId, month }: { slipId: string; employeeId: string; month: string }) {
  const { data, isLoading, isError } = useQuery<{ data: SlipDetail }>({
    queryKey: ['my-slip-detail', slipId],
    queryFn:  () => api.get(`/payroll/slips/${slipId}`),
    staleTime: 300_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />Loading pay slip…
      </div>
    )
  }

  if (isError || !data?.data) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />Failed to load slip details.
      </div>
    )
  }

  const slip      = data.data
  const earnings  = slip.component_breakdown.filter(c => c.component_type === 'earning')
  const deductions = slip.component_breakdown.filter(c => c.component_type === 'deduction')
  const empContribs = slip.component_breakdown.filter(c => c.component_type === 'employer_contribution')

  // Derive basic salary amount from earnings breakdown (for calc hints)
  const basicComponent = earnings.find(c =>
    c.code.toLowerCase() === 'basic' ||
    c.name.toLowerCase().includes('basic')
  )
  const basicAmt = basicComponent?.monthly_amount ?? 0

  // LOP daily rate (derived from gross + LOP)
  const grossForLop = slip.lop_amount > 0 && slip.lop_days > 0
    ? slip.gross_pay + slip.lop_amount  // pre-LOP gross
    : slip.gross_pay
  const dailyRate = slip.total_working_days > 0
    ? grossForLop / slip.total_working_days
    : 0

  return (
    <div className="space-y-4 pt-1">
      {/* Warning banner */}
      {slip.warning && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {slip.warning}
        </div>
      )}

      {/* Attendance summary */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Working Days', value: slip.total_working_days, cls: 'text-foreground' },
          { label: 'Payable Days', value: slip.payable_days,       cls: 'text-success' },
          { label: 'LOP Days',     value: slip.lop_days,           cls: 'text-destructive' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="p-2 rounded-md bg-muted/40">
            <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
            <p className={cn('text-base font-bold', cls)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Net pay walkthrough */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">How Your Pay Was Calculated</p>
        </div>
        <div className="p-3 space-y-1.5 text-xs">
          {/* Gross */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">CTC Monthly</span>
            <span className="font-medium text-muted-foreground">{fmtCurrency(slip.ctc_monthly)}</span>
          </div>
          {/* LOP */}
          {slip.lop_days > 0 ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-destructive">
                <span className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" />
                  LOP Deduction
                </span>
                <span className="font-medium">– {fmtCurrency(slip.lop_amount)}</span>
              </div>
              <div className="pl-4 text-[10px] text-muted-foreground">
                {slip.lop_days} LOP day{slip.lop_days !== 1 ? 's' : ''} × {fmtCurrency(Math.round(dailyRate))}/day
                {' '}({fmtCurrency(Math.round(grossForLop))} ÷ {slip.total_working_days} days)
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-success">
              <span>No LOP</span>
              <span className="text-[10px]">Full attendance</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border/60 pt-1">
            <span className="text-muted-foreground">Gross Pay</span>
            <span className="font-semibold text-foreground">{fmtCurrency(slip.gross_pay)}</span>
          </div>
          {/* Deductions */}
          {deductions.length > 0 && (
            <div className="flex items-center justify-between text-destructive">
              <span className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                Statutory Deductions
              </span>
              <span className="font-medium">– {fmtCurrency(slip.total_deductions - slip.lop_amount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-1.5 mt-0.5">
            <span className="font-semibold text-sm">Net Pay</span>
            <span className="font-bold text-success text-sm">{fmtCurrency(slip.net_pay)}</span>
          </div>
          {slip.employer_contributions > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-1">
              <span>Employer Contributions (not deducted from salary)</span>
              <span>{fmtCurrency(slip.employer_contributions)}</span>
            </div>
          )}
          {slip.overtime_hours > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Overtime Hours Logged</span>
              <span>{slip.overtime_hours}h</span>
            </div>
          )}
        </div>
      </div>

      {/* Component breakdown */}
      {slip.component_breakdown.length > 0 && (
        <div className="space-y-3">
          {[
            { title: 'Earnings',               items: earnings,    icon: TrendingUp,   showHints: false },
            { title: 'Deductions',             items: deductions,  icon: TrendingDown, showHints: true  },
            { title: 'Employer Contributions', items: empContribs, icon: DollarSign,   showHints: true  },
          ].filter(g => g.items.length > 0).map(({ title, items, icon: Icon, showHints }) => (
            <div key={title}>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground">{title}</p>
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Component</th>
                      <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Monthly</th>
                      <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Annual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c, i) => {
                      const hint = showHints
                        ? getCalcHint(c, basicAmt, slip.gross_pay, slip.ctc_monthly)
                        : ''
                      return (
                        <tr key={c.salary_component_id}
                          className={cn('border-t border-border/40', i % 2 === 0 ? '' : 'bg-muted/10')}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">({c.code})</span>
                            {hint && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{fmtCurrency(c.monthly_amount)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtCurrency(c.annual_amount)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {slip.held_reason && (
        <div className="p-2.5 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
          <span className="font-semibold">Held: </span>{slip.held_reason}
        </div>
      )}

      {/* Phase 5 ESS Intelligence — Salary change explainability */}
      {employeeId && <SalaryChangesSection employeeId={employeeId} month={month} />}
    </div>
  )
}

// ── SlipCard ──────────────────────────────────────────────────────────────────

function SlipCard({ slip, prevSlip, employeeId }: { slip: SlipSummary; prevSlip?: SlipSummary; employeeId: string }) {
  const [expanded, setExpanded] = useState(false)

  // MoM net pay diff
  const momDiff = prevSlip != null ? slip.net_pay - prevSlip.net_pay : null
  const momPct  = prevSlip != null && prevSlip.net_pay > 0
    ? ((slip.net_pay - prevSlip.net_pay) / prevSlip.net_pay * 100)
    : null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">{fmtMonth(slip.month)}</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {slip.payable_days} / {slip.total_working_days} days
              {slip.lop_days > 0 && (
                <span className="text-destructive">· {slip.lop_days} LOP</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-bold text-success">{fmtCurrency(slip.net_pay)}</p>
            {momDiff != null && momPct != null ? (
              <div className={cn(
                'flex items-center justify-end gap-0.5 text-[10px] font-medium',
                momDiff >= 0 ? 'text-success' : 'text-destructive',
              )}>
                {momDiff >= 0
                  ? <TrendingUp className="h-2.5 w-2.5" />
                  : <TrendingDown className="h-2.5 w-2.5" />}
                {momDiff >= 0 ? '+' : ''}{momPct.toFixed(1)}% vs prev
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Net Pay</p>
            )}
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          }
        </div>
      </button>

      {/* Compact summary row */}
      <div className="flex items-center gap-4 px-4 pb-3 text-xs text-muted-foreground border-t border-border/40">
        <span>Gross: <span className="font-medium text-foreground">{fmtCurrency(slip.gross_pay)}</span></span>
        <span>Deductions: <span className="font-medium text-destructive">{fmtCurrency(slip.total_deductions)}</span></span>
        {slip.overtime_hours > 0 && (
          <span>OT: <span className="font-medium text-foreground">{slip.overtime_hours}h</span></span>
        )}
        <Badge variant="success" className="rounded-full text-[10px] ml-auto capitalize">{slip.status}</Badge>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/60">
          <SlipDetailCard slipId={slip.id} employeeId={employeeId} month={slip.month} />
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MyPayslips() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? ''

  const { data, isLoading, isError, refetch } = useQuery<{ data: SlipSummary[] }>({
    queryKey: ['my-payslips'],
    queryFn:  () => api.get('/payroll/my-slips'),
    staleTime: 120_000,
  })

  const slips = data?.data ?? []

  // Aggregate for summary from most recent slip
  const latest = slips[0]

  return (
    <PageContainer>
      <PageHeader
        title="My Pay Slips"
        subtitle="Your finalized monthly pay slips"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => refetch()}
          >
            {isLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <DollarSign className="h-3.5 w-3.5" />
            }
            Refresh
          </Button>
        }
      />

      {/* Latest slip summary */}
      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">Latest Month</p>
            <p className="text-sm font-bold mt-1">{fmtMonth(latest.month)}</p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">Net Pay</p>
            <p className="text-sm font-bold text-success mt-1">{fmtCurrency(latest.net_pay)}</p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">Payable Days</p>
            <p className="text-sm font-bold mt-1">{latest.payable_days} / {latest.total_working_days}</p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <p className="text-xs text-muted-foreground">LOP Days</p>
            <p className={cn('text-sm font-bold mt-1', latest.lop_days > 0 ? 'text-destructive' : 'text-success')}>
              {latest.lop_days}
            </p>
          </div>
        </div>
      )}

      {/* Slips list */}
      <SectionCard
        title="Pay Slip History"
        icon={<FileText className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />Loading pay slips…
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />Failed to load pay slips. Please try again.
          </div>
        ) : slips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <DollarSign className="h-10 w-10 opacity-30" />
            <p className="text-sm">No finalized pay slips yet.</p>
            <p className="text-xs opacity-70">Pay slips appear here once your HR team finalizes the payroll run.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {slips.map((slip, idx) => (
              <SlipCard
                key={slip.id}
                slip={slip}
                prevSlip={slips[idx + 1]}
                employeeId={employeeId}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
