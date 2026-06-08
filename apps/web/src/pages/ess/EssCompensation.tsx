/**
 * EssCompensation — /ess/compensation · /manager/self/compensation
 *
 * "My Compensation" total-rewards workspace (premium layout).
 *   Overview   — total-rewards / CTC composition hero, employment card, stat tiles
 *   Salary     — salary structure table + Rate vs Actuals month comparison
 *   Pay Slips  — finalized slips list, YTD summary, per-slip isolated print
 *   Bonuses    — incentive history (awaiting backend — honest empty state)
 *   Benefits   — perks & insurance (awaiting backend — honest empty state)
 *   Tax        — IT statement: regime, tax computation, TDS YTD (real)
 *   History    — compensation revision timeline + Gross vs Net trend chart
 *
 * Every figure is wired to live API data — no mock numbers. Tabs without a
 * backing endpoint show a clear "coming soon" state rather than fabricated data.
 * Design: design-system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useEffect } from 'react'
import { useQuery }                     from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTip, ResponsiveContainer,
} from 'recharts'
import {
  DollarSign, ChevronDown, ChevronUp,
  Loader2, AlertCircle, FileText,
  TrendingDown, TrendingUp, Calendar,
  BookOpen, Printer, BarChart2,
  AlertTriangle,
  Receipt,
  Wallet, Gift, ShieldCheck, History as HistoryIcon,
  Building2, ArrowUpRight, PiggyBank, Clock,
  Sparkles,
} from 'lucide-react'
import { EVENT_LABEL, EVENT_BADGE } from '@/lib/payroll-constants'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import {
  IntelligenceLoadingSkeleton,
} from '@/components/ui/intelligence/index.js'
import {
  getAxisStyle, getGridStyle, getTooltipStyle, getChartColor,
} from '@/components/ui/chart'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SlipSummary {
  slip_id:           string
  month:             string
  gross_pay:         number
  lop_amount:        number
  total_deductions:  number
  net_pay:           number
  lop_days:          number
  payable_days:      number
  total_working_days: number
  overtime_hours:    number
  status:            'draft' | 'finalized' | 'held'
  held_reason:       string | null
  warning:           string | null
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
  ctc_monthly:            number
  employer_contributions: number
  component_breakdown:    ComponentSnapshot[]
}

interface LedgerEntry {
  id:                 string
  month:              string
  event_type:         string
  event_description:  string
  impact_type:        string | null
  impact_amount:      number | null
  source_entity_type: string | null
  created_at:         string
}

interface ActiveComp {
  id:             string
  ctc_annual:     number
  ctc_monthly:    number
  effective_from: string
  salary_structures?: { name: string }
  employee_compensation_components?: CompComponent[]
}

interface CompComponent {
  id:               string
  computed_monthly: number
  computed_annual:  number
  sequence:         number
  salary_components?: {
    name:           string
    code:           string
    component_type: 'earning' | 'deduction' | 'employer_contribution'
    is_taxable:     boolean
  }
}

interface CompRevision {
  id:                string
  revision_type:     string
  status:            'pending' | 'approved' | 'rejected' | 'withdrawn'
  effective_date:    string
  before_ctc_annual: number | null
  new_ctc_annual:    number
  delta_pct:         number | null
  notes:             string | null
  created_at:        string
}

interface TrendRow {
  month:     string
  gross_pay: number
  net_pay:   number
}

// Employment identity — from /employees/:id/full-profile
interface FullProfile {
  employee: {
    first_name:    string
    last_name:     string
    employee_code: string
    joining_date:  string | null
  }
  job_info: {
    employment_type: string
    effective_from:  string
    departments:     { name: string } | null
    designations:    { name: string } | null
    work_locations:  { name: string; city: string } | null
    manager:         { first_name: string; last_name: string; employee_code: string } | null
  } | null
  bank_statutory: {
    bank_name:             string | null
    account_number_masked: string | null
    ifsc:                  string | null
    pan:                   string | null
    uan:                   string | null
    pf_number:             string | null
    esi_number:            string | null
  } | null
}

// Tax computation — from /payroll/statutory/tds/it-statement/my
interface ITStatement {
  financial_year:      string
  regime:              'old' | 'new'
  gross_salary:        number
  taxable_income:      number
  total_tax_payable:   number
  tds_by_employer_ytd: number
  balance_tax_payable: number
  monthly_recovery:    number
  remaining_months:    number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const REV_STATUS_BADGE: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'destructive',
  withdrawn: 'secondary',
}

const REV_TYPE_LABEL: Record<string, string> = {
  increment:   'Increment',
  promotion:   'Promotion',
  revision:    'Revision',
  correction:  'Correction',
  restructure: 'Restructure',
  retro:       'Retro',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n)
}

/** Full Indian currency (₹12,00,000). Was compact (K/L) — switched to full per
 *  UAT feedback so salary-structure rates and totals read in plain rupees. */
function fmtCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  return fmtCurrency(n)
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  })
}

function fmtMonthShort(m: string): string {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-IN', {
    month: 'short', year: '2-digit',
  })
}

function fmtDate(s: string): string {
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function getCalcHint(c: ComponentSnapshot, basicAmt: number, grossAmt: number, ctcAmt: number): string {
  switch (c.calc_type) {
    case 'pct_of_basic':  return `${c.value}% of Basic (${fmtCurrency(basicAmt)})`
    case 'pct_of_ctc':    return `${c.value}% of CTC (${fmtCurrency(ctcAmt)})`
    case 'pct_of_gross':  return `${c.value}% of Gross (${fmtCurrency(grossAmt)})`
    case 'fixed':         return 'Fixed amount'
    default:              return c.calc_type ?? ''
  }
}

// ── Print utility — isolates one slip to print ─────────────────────────────────

function printSlip(slipId: string) {
  const existing = document.getElementById('__slip-print-style')
  existing?.remove()

  const style = document.createElement('style')
  style.id = '__slip-print-style'
  style.textContent = `
    @media print {
      body * { visibility: hidden !important; }
      #slip-print-${slipId},
      #slip-print-${slipId} * { visibility: visible !important; }
      #slip-print-${slipId} {
        position: fixed !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important;
        background: white !important;
        padding: 24px !important;
        box-sizing: border-box !important;
      }
    }
  `
  document.head.appendChild(style)
  window.addEventListener('afterprint', () => style.remove(), { once: true })
  window.print()
}

// ── SalaryChangesSection ───────────────────────────────────────────────────────

function SalaryChangesSection({ employeeId, month }: { employeeId: string; month: string }) {
  const { data, isLoading, isError, refetch } = useQuery<{ data: LedgerEntry[] }>({
    queryKey:  ['my-salary-ledger', employeeId, month],
    queryFn:   () => api.get(`/payroll/ledger/${employeeId}?month=${month}`),
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
      ) : isError ? (
        <div className="flex items-center justify-between px-3 py-3 text-xs">
          <span className="flex items-center gap-1.5 text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />Failed to load salary change history.
          </span>
          <button onClick={() => refetch()} className="text-primary text-[10px] underline hover:opacity-70">
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          No salary-affecting events recorded for this month.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {entries.map(entry => (
            <div key={entry.id} className="px-3 py-2.5 flex items-start gap-3">
              <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={EVENT_BADGE[entry.event_type] ?? 'outline'} className="rounded-full text-[9px] h-4">
                    {EVENT_LABEL[entry.event_type] ?? entry.event_type}
                  </Badge>
                  {entry.impact_amount != null && entry.impact_amount !== 0 && (
                    <span className={cn('text-[10px] font-mono font-semibold',
                      entry.impact_amount < 0 ? 'text-destructive' : 'text-success')}>
                      {entry.impact_amount > 0 ? '+' : ''}{entry.impact_amount} day{Math.abs(entry.impact_amount) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{entry.event_description}</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                  {(() => { const d=new Date(entry.created_at.length===10?entry.created_at+'T12:00:00Z':entry.created_at); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()}
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
    queryKey:  ['my-slip-detail', slipId],
    queryFn:   () => api.get(`/payroll/slips/${slipId}`),
    staleTime: 300_000,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />Loading pay slip…
    </div>
  )
  if (isError || !data?.data) return (
    <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />Failed to load slip details.
    </div>
  )

  const slip         = data.data
  const earnings     = slip.component_breakdown.filter(c => c.component_type === 'earning')
  const deductions   = slip.component_breakdown.filter(c => c.component_type === 'deduction')
  const empContribs  = slip.component_breakdown.filter(c => c.component_type === 'employer_contribution')
  const basicComponent = earnings.find(c => c.code.toLowerCase() === 'basic' || c.name.toLowerCase().includes('basic'))
  const basicAmt     = basicComponent?.monthly_amount ?? 0
  const grossForLop  = slip.lop_amount > 0 && slip.lop_days > 0 ? slip.gross_pay + slip.lop_amount : slip.gross_pay
  const dailyRate    = slip.total_working_days > 0 ? grossForLop / slip.total_working_days : 0

  return (
    <div className="space-y-4 pt-1">
      {slip.warning && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{slip.warning}
        </div>
      )}

      {/* Attendance summary */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Working Days', value: slip.total_working_days, cls: 'text-foreground'  },
          { label: 'Payable Days', value: slip.payable_days,       cls: 'text-success'     },
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
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">CTC Monthly</span>
            <span className="font-medium text-muted-foreground">{fmtCurrency(slip.ctc_monthly)}</span>
          </div>
          {slip.lop_days > 0 ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-destructive">
                <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3" />LOP Deduction</span>
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
          {deductions.length > 0 && (
            <div className="flex items-center justify-between text-destructive">
              <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3" />Statutory Deductions</span>
              <span className="font-medium">– {fmtCurrency(slip.total_deductions - slip.lop_amount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-1.5 mt-0.5">
            <span className="font-semibold text-sm">Net Pay</span>
            <span className="font-bold text-success text-sm">{fmtCurrency(slip.net_pay)}</span>
          </div>
          {slip.employer_contributions > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-1">
              <span>Employer Contributions (not deducted)</span>
              <span>{fmtCurrency(slip.employer_contributions)}</span>
            </div>
          )}
          {slip.overtime_hours > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Overtime Hours</span><span>{slip.overtime_hours}h</span>
            </div>
          )}
        </div>
      </div>

      {/* Component breakdown */}
      {slip.component_breakdown.length > 0 && (
        <div className="space-y-3">
          {[
            { title: 'Earnings',               items: earnings,   showHints: false },
            { title: 'Deductions',             items: deductions, showHints: true  },
            { title: 'Employer Contributions', items: empContribs,showHints: true  },
          ].filter(g => g.items.length > 0).map(({ title, items, showHints }) => (
            <div key={title}>
              <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>
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
                      const hint = showHints ? getCalcHint(c, basicAmt, slip.gross_pay, slip.ctc_monthly) : ''
                      return (
                        <tr key={c.salary_component_id} className={cn('border-t border-border/40', i % 2 !== 0 && 'bg-muted/10')}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">({c.code})</span>
                            {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
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

      {employeeId && <SalaryChangesSection employeeId={employeeId} month={month} />}
    </div>
  )
}

// ── PrintableSlip — off-screen slip render used for print-on-demand ─────────────
// The flat Pay Slips table has no inline expansion; clicking a row's PDF action
// mounts this off-screen, waits for the slip detail to load, then prints just it.

function PrintableSlip({
  slip, employeeId, onDone,
}: {
  slip: SlipSummary
  employeeId: string
  onDone: () => void
}) {
  // Shares the ['my-slip-detail', id] cache with SlipDetailCard — no double fetch.
  const { isSuccess, isError } = useQuery<{ data: SlipDetail }>({
    queryKey:  ['my-slip-detail', slip.slip_id],
    queryFn:   () => api.get(`/payroll/slips/${slip.slip_id}`),
    staleTime: 300_000,
  })

  useEffect(() => {
    if (isError) { onDone(); return }
    if (isSuccess) {
      // Allow SlipDetailCard to paint from cache before printing.
      const tid = setTimeout(() => { printSlip(slip.slip_id); onDone() }, 200)
      return () => clearTimeout(tid)
    }
  }, [isSuccess, isError, slip.slip_id, onDone])

  return (
    <div className="fixed -left-[9999px] top-0 w-[800px]" aria-hidden>
      <div id={`slip-print-${slip.slip_id}`}>
        <div className="mb-4 pb-3 border-b border-border">
          <h2 className="text-lg font-bold">Pay Slip — {fmtMonth(slip.month)}</h2>
          <p className="text-xs text-muted-foreground">
            Printed on {(() => { const d=new Date(); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()}` })()}
          </p>
        </div>
        <SlipDetailCard slipId={slip.slip_id} employeeId={employeeId} month={slip.month} />
      </div>
    </div>
  )
}

// ── YTDSummary ─────────────────────────────────────────────────────────────────

function YTDSummary({ slips }: { slips: SlipSummary[] }) {
  const now     = new Date()
  const fyYear  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const fyStart = `${fyYear}-04`
  const fyEnd   = `${fyYear + 1}-03`
  const fySlips = slips.filter(s => s.month >= fyStart && s.month <= fyEnd)
  if (fySlips.length === 0) return null

  const ytdGross      = fySlips.reduce((s, r) => s + (r.gross_pay ?? 0),        0)
  const ytdNet        = fySlips.reduce((s, r) => s + (r.net_pay ?? 0),          0)
  const ytdDeductions = fySlips.reduce((s, r) => s + (r.total_deductions ?? 0), 0)
  const ytdLop        = fySlips.reduce((s, r) => s + (r.lop_amount ?? 0),       0)
  const ytdOt         = fySlips.reduce((s, r) => s + (r.overtime_hours ?? 0),   0)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Year-to-Date Summary</p>
        <span className="text-xs text-muted-foreground ml-1">FY {fyYear}–{fyYear + 1} · {fySlips.length} months</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        {[
          { label: 'YTD Gross',      value: fmtCurrency(ytdGross),     color: '' },
          { label: 'YTD Net',        value: fmtCurrency(ytdNet),        color: 'text-success' },
          { label: 'YTD Deductions', value: fmtCurrency(ytdDeductions), color: 'text-destructive' },
          { label: 'YTD LOP',        value: fmtCurrency(ytdLop),        color: ytdLop > 0 ? 'text-warning' : 'text-muted-foreground' },
          { label: 'YTD OT Hours',   value: `${ytdOt.toFixed(1)}h`,    color: '' },
        ].map(k => (
          <div key={k.label} className="p-2.5 rounded-lg bg-muted/40">
            <p className="text-muted-foreground mb-0.5">{k.label}</p>
            <p className={cn('font-bold tabular-nums', k.color)}>{k.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RevisionTimeline ───────────────────────────────────────────────────────────

function RevisionTimeline({ revisions }: { revisions: CompRevision[] }) {
  if (revisions.length === 0) return (
    <p className="text-xs text-muted-foreground py-6 text-center">No compensation revisions on record.</p>
  )

  return (
    <div className="relative pl-5">
      {/* Vertical line */}
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />

      <div className="space-y-3">
        {revisions.map(rev => (
          <div key={rev.id} className="relative">
            {/* Timeline dot */}
            <div className={cn(
              'absolute -left-[14px] top-2 w-2.5 h-2.5 rounded-full border-2 border-background ring-2',
              rev.status === 'approved'  ? 'bg-success ring-success/30' :
              rev.status === 'rejected'  ? 'bg-destructive ring-destructive/30' :
              rev.status === 'pending'   ? 'bg-warning ring-warning/30' :
              'bg-muted-foreground/40 ring-muted/30',
            )} />

            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">
                  {REV_TYPE_LABEL[rev.revision_type] ?? rev.revision_type}
                </span>
                <Badge variant={REV_STATUS_BADGE[rev.status]} className="rounded-full text-[9px]">
                  {rev.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                  Eff. {fmtDate(rev.effective_date)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className="text-muted-foreground font-mono">
                  {fmtCompact(rev.before_ctc_annual)} → {fmtCompact(rev.new_ctc_annual)}
                </span>
                {rev.delta_pct != null && (
                  <span className={cn('font-semibold', rev.delta_pct >= 0 ? 'text-success' : 'text-destructive')}>
                    {rev.delta_pct > 0 ? '+' : ''}{rev.delta_pct.toFixed(1)}%
                  </span>
                )}
              </div>
              {rev.notes && (
                <p className="text-[10px] text-muted-foreground mt-0.5 italic">{rev.notes}</p>
              )}
              <p className="text-[9px] text-muted-foreground/50 mt-1">Initiated {fmtDate(rev.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── StatTile — icon + label + value + hint (Overview / Salary headers) ──────────

function StatTile({
  icon: Icon, label, value, hint, accent = 'primary',
}: {
  icon: React.ElementType
  label: string
  value: string
  hint?: string
  accent?: 'primary' | 'success' | 'muted'
}) {
  const tone =
    accent === 'success' ? 'bg-success/10 text-success' :
    accent === 'muted'   ? 'bg-muted text-muted-foreground' :
                           'bg-primary/10 text-primary'
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className={cn('rounded-lg p-2.5 flex-shrink-0', tone)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-lg font-bold text-foreground tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

// ── EmploymentCard — identity details (Overview side rail) ──────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

function EmploymentCard({ profile, comp }: { profile?: FullProfile; comp?: ActiveComp }) {
  const emp = profile?.employee
  const job = profile?.job_info
  const mgr = job?.manager
  return (
    <SectionCard title="Employment" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
      <div className="space-y-2.5 text-sm">
        <DetailRow label="Employee ID"  value={emp?.employee_code ?? '—'} />
        <DetailRow label="Designation"  value={job?.designations?.name ?? '—'} />
        <DetailRow label="Department"   value={job?.departments?.name ?? '—'} />
        <DetailRow label="Reporting to" value={mgr ? `${mgr.first_name} ${mgr.last_name}` : '—'} />
        <DetailRow label="Location"     value={job?.work_locations?.name ?? '—'} />
        <DetailRow label="Date of joining" value={emp?.joining_date ? fmtDate(emp.joining_date) : '—'} />
        {comp?.salary_structures?.name && (
          <DetailRow label="Salary structure" value={comp.salary_structures.name} />
        )}
        {comp?.effective_from && (
          <DetailRow label="CTC effective" value={fmtDate(comp.effective_from)} />
        )}
      </div>
    </SectionCard>
  )
}

// ── ComingSoon — honest placeholder for tabs without a backing endpoint ─────────

function ComingSoon({ icon: Icon, title, blurb }: { icon: React.ElementType; title: string; blurb: string }) {
  return (
    <SectionCard>
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-2xl bg-muted/60 p-4">
          <Icon className="h-8 w-8 text-muted-foreground/70" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <Badge variant="secondary" className="rounded-full text-[10px] gap-1">
              <Sparkles className="h-3 w-3" /> Coming soon
            </Badge>
          </div>
          <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">{blurb}</p>
        </div>
      </div>
    </SectionCard>
  )
}

// ── SalaryGroup — labelled component rows for the Salary structure table ─────────

function SalaryGroup({ label, items }: { label: string; items: CompComponent[] }) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={3} className="px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </td>
      </tr>
      {[...items].sort((a, b) => a.sequence - b.sequence).map(c => (
        <tr key={c.id} className="border-b border-border/40 last:border-0">
          <td className="px-5 py-2.5">
            <span className="font-medium text-foreground">{c.salary_components?.name}</span>
            {c.salary_components?.is_taxable && (
              <Badge className="ml-2 rounded-full text-[9px]" variant="outline">Taxable</Badge>
            )}
          </td>
          <td className="px-5 py-2.5 text-right tabular-nums">{fmtCurrency(c.computed_monthly)}</td>
          <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(c.computed_annual)}</td>
        </tr>
      ))}
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = 'overview' | 'salary' | 'payslips' | 'bonuses' | 'benefits' | 'tax' | 'history'

export function EssCompensation() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? ''

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('overview')

  // ── Slip queued for print (Pay Slips flat table) ──────────────────────────
  const [printSlipId, setPrintSlipId] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  // All finalized slips (used by Pay Slips tab + month selector)
  const { data: slipsData, isLoading: slipsLoading, isFetching: slipsFetching,
          isError: slipsError, refetch: refetchSlips } =
    useQuery<{ data: SlipSummary[] }>({
      queryKey:  ['my-payslips'],
      queryFn:   () => api.get('/payroll/my-slips'),
      staleTime: 120_000,
    })

  const slips = slipsData?.data ?? []

  // Active compensation (CTC structure) — always loaded
  // Active compensation with its raw component breakdown (incl. employer
  // contributions + nested salary_components). This endpoint returns the active
  // record(s) with employee_compensation_components — the shape this tab renders.
  const { data: compData, isLoading: compLoading, isError: compError } = useQuery<{ data: ActiveComp[] }>({
    queryKey:  ['ess-comp-active', employeeId],
    queryFn:   () => api.get(`/payroll/compensation/employee/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Gross vs Net trend chart
  const { data: trendData } = useQuery<{ data: TrendRow[] }>({
    queryKey:  ['ess-payslip-trend', employeeId],
    queryFn:   () => api.get('/payroll/slips/trend?months=6'),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Employment identity — for the Overview employment card + header subtitle
  const { data: profileData } = useQuery<FullProfile>({
    queryKey:  ['ess-comp-full-profile', employeeId],
    queryFn:   () => api.get(`/employees/${employeeId}/full-profile`),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Revision history — lazy, only when History tab is first visited
  const [revVisited, setRevVisited] = useState(false)
  useEffect(() => { if (tab === 'history') setRevVisited(true) }, [tab])
  const { data: revData, isLoading: revLoading } = useQuery<{ data: CompRevision[] }>({
    queryKey:  ['ess-comp-revisions', employeeId],
    queryFn:   () => api.get(`/compensation/revisions/employee/${employeeId}`),
    enabled:   !!employeeId && revVisited,
    staleTime: 120_000,
  })

  // IT statement (tax) — lazy, only when Tax tab is first visited
  const [taxVisited, setTaxVisited] = useState(false)
  useEffect(() => { if (tab === 'tax') setTaxVisited(true) }, [tab])
  const { data: taxData, isLoading: taxLoading, isError: taxError } = useQuery<ITStatement | null>({
    queryKey:  ['ess-comp-it-statement', employeeId],
    queryFn:   async () => {
      const res = await api.get<ITStatement>('/payroll/statutory/tds/it-statement/my')
      return res ?? null
    },
    enabled:   !!employeeId && taxVisited,
    staleTime: 300_000,
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  // Endpoint returns active record(s) — take the most recent active one.
  const comp       = Array.isArray(compData?.data) ? compData!.data[0] : (compData?.data as ActiveComp | undefined)
  const bank       = profileData?.bank_statutory ?? undefined
  const revisions  = revData?.data ?? []
  const components  = comp?.employee_compensation_components ?? []
  const earnings    = components.filter(c => c.salary_components?.component_type === 'earning')
  const deductions  = components.filter(c => c.salary_components?.component_type === 'deduction')
  const empContribs = components.filter(c => c.salary_components?.component_type === 'employer_contribution')
  const sumMonthly  = (arr: typeof components) => arr.reduce((s, c) => s + (c.computed_monthly ?? 0), 0)
  const grossMonthly    = sumMonthly(earnings)
  const employerMonthly = sumMonthly(empContribs)
  const ctcMonthlyCalc  = Math.round((grossMonthly + employerMonthly) * 100) / 100

  const chartData = (trendData?.data ?? []).map(s => ({
    month: fmtMonthShort(s.month),
    Gross: Math.round(s.gross_pay / 1000),
    Net:   Math.round(s.net_pay   / 1000),
  }))

  const latest = slips[0]

  // Net take-home for the salary-structure card. The master structure has no
  // employee statutory lines (PF/ESI/PT/LWF/TDS), so they must come from the latest
  // finalized payslip. Use the full-rate statutory (total_deductions minus LOP,
  // since LOP is a paid-day reduction, not a standing deduction). Null until there's
  // a payslip — we never show net = gross (which would be wrong).
  const estEmpDeductions = latest
    ? Math.max(0, Math.round(((latest.total_deductions ?? 0) - (latest.lop_amount ?? 0)) * 100) / 100)
    : null
  const netMonthly = estEmpDeductions != null
    ? Math.round((grossMonthly - estEmpDeductions) * 100) / 100
    : null

  const annualCtc = ctcMonthlyCalc > 0 ? ctcMonthlyCalc * 12 : (comp?.ctc_annual ?? 0)

  // CTC composition for the Overview rewards bar. When a payslip exists we can
  // split the gross into take-home vs employee statutory deductions; otherwise we
  // show the gross-vs-employer split. All figures are real — no estimates beyond
  // the statutory deductions already sourced from the latest finalized slip.
  const rewardSegments = (netMonthly != null && estEmpDeductions != null
    ? [
        { label: 'Net take-home',          monthly: netMonthly,        color: 'bg-primary'   },
        { label: 'Employee deductions',    monthly: estEmpDeductions,  color: 'bg-warning'   },
        { label: 'Employer contributions', monthly: employerMonthly,   color: 'bg-success'   },
      ]
    : [
        { label: 'Gross earnings',         monthly: grossMonthly,      color: 'bg-primary'   },
        { label: 'Employer contributions', monthly: employerMonthly,   color: 'bg-success'   },
      ]
  ).filter(s => s.monthly > 0)
  const rewardTotal = rewardSegments.reduce((s, r) => s + r.monthly, 0)

  // YoY uplift — only shown when we have a real approved revision delta on record.
  const latestDelta = (revData?.data ?? []).find(r => r.status === 'approved' && r.delta_pct != null)?.delta_pct ?? null

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="Pay & Compensation" subtitle="Your pay slips, salary structure and revision history" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const headerName = profileData?.employee
    ? `${profileData.employee.first_name} ${profileData.employee.last_name}`
    : (profile?.full_name ?? 'My Compensation')
  const headerMeta = [
    profileData?.job_info?.designations?.name,
    profileData?.job_info?.departments?.name,
  ].filter(Boolean).join(' · ')

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Self' }, { label: 'Compensation' }]}
        title="My Compensation"
        subtitle={headerMeta ? `${headerName} · ${headerMeta}` : headerName}
        actions={
          tab === 'payslips' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />Print / PDF
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => refetchSlips()} disabled={slipsFetching}>
                {slipsFetching
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <DollarSign className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* ── Tab switcher — underline tabs, horizontally scrollable ───────────── */}
      <div className="-mx-1 overflow-x-auto border-b border-border scrollbar-none">
        <div className="flex min-w-max gap-1 px-1">
          {([
            { key: 'overview', label: 'Overview',             icon: BarChart2    },
            { key: 'salary',   label: 'Salary',               icon: Wallet       },
            { key: 'payslips', label: 'Pay Slips',            icon: FileText     },
            { key: 'bonuses',  label: 'Bonuses & Incentives', icon: Gift         },
            { key: 'benefits', label: 'Benefits',             icon: ShieldCheck  },
            { key: 'tax',      label: 'Tax',                  icon: Building2     },
            { key: 'history',  label: 'History',              icon: HistoryIcon  },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'relative flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Total rewards / CTC composition hero */}
          <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-card">
            <div className="bg-primary px-6 py-5 text-primary-foreground">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-primary-foreground/70">Total annual CTC</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                    {compLoading ? '…' : fmtCurrency(annualCtc)}
                  </p>
                  {comp?.salary_structures?.name && (
                    <p className="mt-1 text-xs text-primary-foreground/70">{comp.salary_structures.name}</p>
                  )}
                </div>
                {latestDelta != null && (
                  <Badge className="gap-1 rounded-full bg-success text-success-foreground hover:bg-success">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {latestDelta > 0 ? '+' : ''}{latestDelta.toFixed(1)}% last revision
                  </Badge>
                )}
              </div>
            </div>
            <div className="p-6">
              {rewardTotal > 0 ? (
                <>
                  <div className="mb-5 flex h-3 w-full overflow-hidden rounded-full bg-muted">
                    {rewardSegments.map(s => (
                      <div key={s.label} className={s.color}
                        style={{ width: `${(s.monthly / rewardTotal) * 100}%` }} />
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {rewardSegments.map(s => (
                      <div key={s.label} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="flex items-center gap-2.5">
                          <span className={cn('h-2.5 w-2.5 rounded-full', s.color)} />
                          <div>
                            <p className="text-sm font-medium text-foreground">{s.label}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {Math.round((s.monthly / rewardTotal) * 100)}% · {fmtCurrency(s.monthly)}/mo
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtCurrency(s.monthly * 12)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {netMonthly != null
                      ? 'Composition reflects take-home, statutory deductions and employer contributions that make up your CTC.'
                      : 'Net take-home split appears once your first payslip is finalized.'}
                  </p>
                </>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No active compensation on record. Contact HR.
                </p>
              )}
            </div>
          </div>

          {/* Employment identity */}
          <EmploymentCard profile={profileData} comp={comp} />

          {/* Stat tiles */}
          <StatTile
            icon={Wallet}
            label="Monthly take-home"
            value={netMonthly != null ? fmtCurrency(netMonthly) : (latest ? fmtCurrency(latest.net_pay) : '—')}
            hint={latest ? `${fmtMonthShort(latest.month)} payslip` : 'After first payslip'}
            accent="success"
          />
          <StatTile
            icon={DollarSign}
            label="Monthly CTC"
            value={ctcMonthlyCalc > 0 ? fmtCurrency(ctcMonthlyCalc) : (comp?.ctc_monthly ? fmtCurrency(comp.ctc_monthly) : '—')}
            hint="Gross + employer contributions"
          />
          <StatTile
            icon={PiggyBank}
            label="Employer contributions"
            value={employerMonthly > 0 ? fmtCurrency(employerMonthly) : '—'}
            hint="Added to CTC · not deducted"
            accent="muted"
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: PAY SLIPS                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'payslips' && (
        <>
          {/* YTD Summary strip */}
          {slips.length > 0 && <YTDSummary slips={slips} />}

          {/* Pay slips — flat table */}
          <SectionCard
            title="Pay slips"
            description={slips.length > 0 ? `${slips.length} finalized` : undefined}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            noPadding
          >
            {slipsLoading ? (
              <div className="p-4"><IntelligenceLoadingSkeleton rows={5} /></div>
            ) : slipsError ? (
              <div className="m-4 flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />Failed to load pay slips. Please try again.
              </div>
            ) : slips.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <DollarSign className="h-10 w-10 opacity-30" />
                <p className="text-sm">No finalized pay slips yet.</p>
                <p className="text-xs opacity-70">Pay slips appear here once HR finalizes the payroll run.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-5 py-2.5 text-left font-medium">Pay period</th>
                      <th className="px-5 py-2.5 text-right font-medium">Gross</th>
                      <th className="px-5 py-2.5 text-right font-medium">Deductions</th>
                      <th className="px-5 py-2.5 text-right font-medium">Net pay</th>
                      <th className="px-5 py-2.5 text-left font-medium">Status</th>
                      <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map(slip => (
                      <tr key={slip.slip_id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <p className="font-medium text-foreground">{fmtMonth(slip.month)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {slip.payable_days} / {slip.total_working_days} days
                            {slip.lop_days > 0 && <span className="text-destructive"> · {slip.lop_days} LOP</span>}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(slip.gross_pay)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">−{fmtCurrency(slip.total_deductions)}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-success">{fmtCurrency(slip.net_pay)}</td>
                        <td className="px-5 py-3">
                          <Badge variant="success" className="rounded-full text-[10px] capitalize">{slip.status}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 gap-1.5 text-xs text-primary"
                            disabled={printSlipId === slip.slip_id}
                            onClick={() => setPrintSlipId(slip.slip_id)}
                          >
                            {printSlipId === slip.slip_id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                            PDF
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Off-screen render that prints the chosen slip, then clears itself */}
          {printSlipId && (() => {
            const s = slips.find(x => x.slip_id === printSlipId)
            return s
              ? <PrintableSlip slip={s} employeeId={employeeId} onDone={() => setPrintSlipId(null)} />
              : null
          })()}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: SALARY                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'salary' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Salary structure — clean Component / Monthly / Annual table */}
          <SectionCard
            className="lg:col-span-2"
            title="Salary structure"
            description={comp?.effective_from ? `Effective ${fmtDate(comp.effective_from)}` : undefined}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />Download
              </Button>
            }
            noPadding
          >
            {compError && (
              <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Failed to load data. Please refresh and try again.
              </div>
            )}
            {compLoading ? (
              <div className="p-4"><IntelligenceLoadingSkeleton rows={5} /></div>
            ) : components.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">No salary components configured. Contact HR.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-5 py-2.5 text-left font-medium">Component</th>
                      <th className="px-5 py-2.5 text-right font-medium">Monthly</th>
                      <th className="px-5 py-2.5 text-right font-medium">Annual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Earnings',               items: earnings    },
                      { label: 'Employer contributions', items: empContribs },
                    ].filter(g => g.items.length > 0).map(({ label, items }) => (
                      <SalaryGroup key={label} label={label} items={items} />
                    ))}
                    {/* Total CTC */}
                    <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                      <td className="px-5 py-3">Total CTC</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(ctcMonthlyCalc)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(annualCtc)}</td>
                    </tr>
                    {/* Take-home reference row */}
                    {netMonthly != null && (
                      <tr className="border-t border-border/60 text-success">
                        <td className="px-5 py-3 font-medium">
                          Net take-home
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">after PF · ESI · PT · LWF · TDS</span>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtCurrency(netMonthly)}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtCurrency(netMonthly * 12)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {netMonthly != null && latest && (
                  <p className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border/40">
                    Net take-home estimated using statutory deductions from your {fmtMonthShort(latest.month)} payslip.
                    Employer contributions are part of CTC but not deducted from pay.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* Bank & pay schedule — real masked data from full-profile */}
          <SectionCard title="Bank & pay schedule" icon={<Wallet className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2.5 text-sm">
              <DetailRow label="Pay frequency" value="Monthly" />
              <DetailRow label="Pay date"      value="Last working day" />
              <DetailRow label="Bank"
                value={bank?.bank_name
                  ? `${bank.bank_name}${bank.account_number_masked ? ` ${bank.account_number_masked}` : ''}`
                  : 'Not on file'} />
              <DetailRow label="IFSC" value={bank?.ifsc ?? '—'} />
              <DetailRow label="UAN"  value={bank?.uan ?? '—'} />
              <DetailRow label="PAN"  value={bank?.pan ?? '—'} />
              {bank?.pf_number && <DetailRow label="PF number" value={bank.pf_number} />}
              <div className="mt-1 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                Bank, PAN and UAN are managed by HR. Contact HR to update these details.
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: BONUSES & INCENTIVES                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'bonuses' && (
        <ComingSoon
          icon={Gift}
          title="Bonuses & Incentives"
          blurb="Performance bonuses, variable pay and referral incentives will appear here once incentive payouts are published to employee self-service."
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: BENEFITS                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'benefits' && (
        <ComingSoon
          icon={ShieldCheck}
          title="Benefits & Perks"
          blurb="Group health insurance, term life cover and other perks will be listed here once the benefits catalogue is enabled for your organization."
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: TAX                                                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'tax' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard
            className="lg:col-span-2"
            title="Income tax computation"
            icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
          >
            {taxLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : taxError || !taxData ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <FileText className="h-8 w-8 opacity-30" />
                <p className="text-sm">No tax statement available yet.</p>
                <p className="text-xs opacity-70">Your projected IT statement appears once payroll has processed for the current financial year.</p>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Gross salary</span>
                  <span className="tabular-nums">{fmtCurrency(taxData.gross_salary)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">Taxable income</span>
                  <span className="tabular-nums">{fmtCurrency(taxData.taxable_income)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="font-semibold">Total tax payable</span>
                  <span className="font-semibold tabular-nums">{fmtCurrency(taxData.total_tax_payable)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">TDS deducted (YTD)</span>
                  <span className="tabular-nums text-success">{fmtCurrency(taxData.tds_by_employer_ytd)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">Balance tax payable</span>
                  <span className="tabular-nums">{fmtCurrency(taxData.balance_tax_payable)}</span>
                </div>
                {taxData.remaining_months > 0 && (
                  <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                    <span className="text-muted-foreground">
                      Monthly recovery
                      <span className="text-[10px] ml-1 opacity-70">over {taxData.remaining_months} mo</span>
                    </span>
                    <span className="tabular-nums">{fmtCurrency(taxData.monthly_recovery)}</span>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Tax regime" icon={<Receipt className="h-4 w-4 text-muted-foreground" />}>
            {taxData ? (
              <div className="space-y-2.5 text-sm">
                <DetailRow label="Financial year" value={taxData.financial_year} />
                <DetailRow label="Selected regime" value={taxData.regime === 'new' ? 'New regime' : 'Old regime'} />
                <DetailRow label="Estimated tax" value={fmtCurrency(taxData.total_tax_payable)} />
                <DetailRow label="TDS YTD" value={fmtCurrency(taxData.tds_by_employer_ytd)} />
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Regime details appear with your IT statement.
              </p>
            )}
          </SectionCard>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: HISTORY                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <>
          <SectionCard
            title="Compensation revision history"
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          >
            {revLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : (
              <RevisionTimeline revisions={revisions} />
            )}
          </SectionCard>

          {/* Gross vs Net trend */}
          {chartData.length > 0 && (
            <SectionCard
              title="Gross vs Net — last 6 months"
              icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
            >
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="month" {...axisStyle} />
                  <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
                  <RechartsTip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
                  <Line type="monotone" dataKey="Gross"
                    stroke={getChartColor('chart1')} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Net"
                    stroke={getChartColor('active')} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  )
}
