/**
 * EssCompensation — /ess/compensation
 *
 * Combined Pay & Compensation workspace for ESS:
 *   Tab 1 "Pay Slips"        — finalized slips list, YTD summary, per-slip isolated print
 *   Tab 2 "Compensation"     — CTC breakdown + month-picker Rate vs Actuals comparison table
 *   Tab 3 "Revision History" — compensation revision timeline + Gross vs Net trend chart
 *
 * Replaces the former separate /ess/payroll/my-slips page.
 * Design: design-system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useMemo, useEffect } from 'react'
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

/** Compact: ₹12.5L / ₹52.3K / ₹850 */
function fmtCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${Math.round(n)}`
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

// ── SlipCard ───────────────────────────────────────────────────────────────────

function SlipCard({ slip, prevSlip, employeeId }: { slip: SlipSummary; prevSlip?: SlipSummary; employeeId: string }) {
  const [expanded,     setExpanded]     = useState(false)
  const [pendingPrint, setPendingPrint] = useState(false)

  const momDiff = prevSlip != null ? slip.net_pay - prevSlip.net_pay : null
  const momPct  = prevSlip != null && prevSlip.net_pay > 0
    ? (slip.net_pay - prevSlip.net_pay) / prevSlip.net_pay * 100
    : null

  function handlePrint(e: React.MouseEvent) {
    e.stopPropagation()
    if (!expanded) {
      setExpanded(true)
      setPendingPrint(true)
    } else {
      printSlip(slip.slip_id)
    }
  }

  useEffect(() => {
    if (pendingPrint && expanded) {
      setPendingPrint(false)
      // Allow SlipDetailCard to mount and its query to settle before printing
      const tid = setTimeout(() => printSlip(slip.slip_id), 300)
      return () => clearTimeout(tid)
    }
  }, [pendingPrint, expanded, slip.slip_id])

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
              {slip.lop_days > 0 && <span className="text-destructive">· {slip.lop_days} LOP</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-bold text-success">{fmtCurrency(slip.net_pay)}</p>
            {momDiff != null && momPct != null ? (
              <div className={cn('flex items-center justify-end gap-0.5 text-[10px] font-medium',
                momDiff >= 0 ? 'text-success' : 'text-destructive')}>
                {momDiff >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                {momDiff >= 0 ? '+' : ''}{momPct.toFixed(1)}% vs prev
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Net Pay</p>
            )}
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Compact summary */}
      <div className="flex items-center gap-4 px-4 pb-3 text-xs text-muted-foreground border-t border-border/40">
        <span>Gross: <span className="font-medium text-foreground">{fmtCurrency(slip.gross_pay)}</span></span>
        <span>Deductions: <span className="font-medium text-destructive">{fmtCurrency(slip.total_deductions)}</span></span>
        {slip.overtime_hours > 0 && <span>OT: <span className="font-medium text-foreground">{slip.overtime_hours}h</span></span>}
        <Badge variant="success" className="rounded-full text-[10px] ml-auto capitalize">{slip.status}</Badge>
        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
          title="Print / Save as PDF"
        >
          <Printer className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-xs">Print</span>
        </button>
      </div>

      {/* Expanded detail — wrapped with print ID */}
      {expanded && (
        <div id={`slip-print-${slip.slip_id}`} className="px-4 pb-4 border-t border-border/60">
          {/* Print-only header */}
          <div className="hidden print:block mb-4 pb-3 border-b border-border">
            <h2 className="text-lg font-bold">Pay Slip — {fmtMonth(slip.month)}</h2>
            <p className="text-xs text-muted-foreground">Printed on {(() => { const d=new Date(); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()}` })()}</p>
          </div>
          <SlipDetailCard slipId={slip.slip_id} employeeId={employeeId} month={slip.month} />
        </div>
      )}
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

// ── RateVsActualsTable ─────────────────────────────────────────────────────────

interface RvaRow {
  code:    string
  name:    string
  type:    'earning' | 'deduction' | 'employer_contribution'
  ctcRate: number | null
  actual:  number | null
}

function RateVsActualsTable({ comp, slipDetail }: { comp: ActiveComp | undefined; slipDetail: SlipDetail | undefined }) {
  const compComponents = comp?.employee_compensation_components ?? []
  const slipComponents = slipDetail?.component_breakdown        ?? []

  // Merge by component code: start with CTC structure, overlay actuals
  const map = new Map<string, RvaRow>()
  for (const c of compComponents) {
    const code = c.salary_components?.code ?? c.id
    map.set(code, {
      code,
      name:    c.salary_components?.name ?? 'Unknown',
      type:    c.salary_components?.component_type ?? 'earning',
      ctcRate: c.computed_monthly,
      actual:  null,
    })
  }
  for (const c of slipComponents) {
    const existing = map.get(c.code)
    if (existing) {
      existing.actual = c.monthly_amount
    } else {
      map.set(c.code, { code: c.code, name: c.name, type: c.component_type, ctcRate: null, actual: c.monthly_amount })
    }
  }

  const allRows  = Array.from(map.values())
  const earnings = allRows.filter(r => r.type === 'earning')
  const deductions = allRows.filter(r => r.type === 'deduction')
  const empContrib = allRows.filter(r => r.type === 'employer_contribution')

  // Totals for net pay summary
  const ctcNetEst = earnings.reduce((s, r) => s + (r.ctcRate ?? 0), 0)
    - deductions.reduce((s, r) => s + (r.ctcRate ?? 0), 0)
  const actualNet = slipDetail?.net_pay ?? null

  function VarianceRow({ row, isEarning }: { row: RvaRow; isEarning: boolean }) {
    const variance    = row.ctcRate != null && row.actual != null ? row.actual - row.ctcRate : null
    const variancePct = variance != null && row.ctcRate != null && row.ctcRate !== 0
      ? (variance / row.ctcRate) * 100 : null
    // Good variance: earning → actual ≥ rate. Deduction → actual ≤ rate.
    const isGood = variance == null ? null
      : isEarning ? variance >= 0 : variance <= 0
    return (
      <td className={cn('px-3 py-2 text-right font-mono font-medium text-xs',
        isGood === null     ? 'text-muted-foreground' :
        isGood              ? 'text-success'           : 'text-destructive',
        variance === 0 && 'text-muted-foreground/50',
      )}>
        {variance == null ? '—' : (
          <>
            {variance > 0 ? '+' : ''}{fmtCurrency(variance)}
            {variancePct != null && (
              <span className="text-[9px] ml-1 opacity-70">({variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%)</span>
            )}
          </>
        )}
      </td>
    )
  }

  function GroupTable({ title, rows, isEarning }: { title: string; rows: RvaRow[]; isEarning: boolean }) {
    if (rows.length === 0) return null
    return (
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Component</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">CTC Rate</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Actual</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.code} className={cn('border-t border-border/40', i % 2 !== 0 && 'bg-muted/10')}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">({row.code})</span>
                    {row.ctcRate == null && <span className="ml-2 text-[9px] text-warning">actuals only</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {row.ctcRate != null ? fmtCurrency(row.ctcRate) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn('px-3 py-2 text-right font-mono text-xs', row.actual == null && 'text-muted-foreground')}>
                    {row.actual != null ? fmtCurrency(row.actual) : '—'}
                  </td>
                  <VarianceRow row={row} isEarning={isEarning} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {slipDetail && slipDetail.lop_days > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          LOP applied: {slipDetail.lop_days} day{slipDetail.lop_days !== 1 ? 's' : ''} — actuals reflect proportional reduction across all earnings.
        </div>
      )}

      <GroupTable title="Earnings"               rows={earnings}    isEarning={true}  />
      <GroupTable title="Deductions"             rows={deductions}  isEarning={false} />
      <GroupTable title="Employer Contributions" rows={empContrib}  isEarning={true}  />

      {/* Net Pay summary */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3 gap-4 flex-wrap">
        <span className="text-sm font-semibold">Net Pay</span>
        <div className="flex items-center gap-6 text-xs">
          <div className="text-right">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">CTC Rate (est.)</p>
            <p className="font-mono font-semibold tabular-nums">{fmtCurrency(ctcNetEst)}</p>
          </div>
          {actualNet != null && (
            <>
              <div className="text-right">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Actual</p>
                <p className="font-mono font-bold text-success tabular-nums">{fmtCurrency(actualNet)}</p>
              </div>
              <div className={cn('text-right', actualNet < ctcNetEst ? 'text-destructive' : 'text-success')}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Variance</p>
                <p className="font-mono font-semibold tabular-nums">
                  {actualNet - ctcNetEst > 0 ? '+' : ''}{fmtCurrency(actualNet - ctcNetEst)}
                </p>
              </div>
            </>
          )}
        </div>
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

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = 'payslips' | 'compensation' | 'revisions'

export function EssCompensation() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? ''

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('payslips')

  // ── Month selected for Rate vs Actuals ────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>('')

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

  // Auto-select most recent month when slips load
  useEffect(() => {
    if (slips.length > 0 && !selectedMonth) {
      setSelectedMonth(slips[0].month)
    }
  }, [slips, selectedMonth])

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

  // Payslip detail for the selected month (Rate vs Actuals) — lazy on comp tab
  const selectedSlip   = useMemo(() => slips.find(s => s.month === selectedMonth), [slips, selectedMonth])
  const { data: rvaSlipData, isLoading: rvaLoading } = useQuery<{ data: SlipDetail }>({
    queryKey:  ['my-slip-detail', selectedSlip?.slip_id ?? ''],
    queryFn:   () => api.get(`/payroll/slips/${selectedSlip!.slip_id}`),
    enabled:   !!selectedSlip && tab === 'compensation',
    staleTime: 300_000,
  })

  // Gross vs Net trend chart
  const { data: trendData } = useQuery<{ data: TrendRow[] }>({
    queryKey:  ['ess-payslip-trend', employeeId],
    queryFn:   () => api.get('/payroll/slips/trend?months=6'),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Revision history — lazy, only when Revisions tab is first visited
  const [revVisited, setRevVisited] = useState(false)
  useEffect(() => { if (tab === 'revisions') setRevVisited(true) }, [tab])
  const { data: revData, isLoading: revLoading } = useQuery<{ data: CompRevision[] }>({
    queryKey:  ['ess-comp-revisions', employeeId],
    queryFn:   () => api.get(`/compensation/revisions/employee/${employeeId}`),
    enabled:   !!employeeId && revVisited,
    staleTime: 120_000,
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  // Endpoint returns active record(s) — take the most recent active one.
  const comp       = Array.isArray(compData?.data) ? compData!.data[0] : (compData?.data as ActiveComp | undefined)
  const revisions  = revData?.data ?? []
  const components  = comp?.employee_compensation_components ?? []
  const earnings    = components.filter(c => c.salary_components?.component_type === 'earning')
  const deductions  = components.filter(c => c.salary_components?.component_type === 'deduction')
  const empContribs = components.filter(c => c.salary_components?.component_type === 'employer_contribution')
  const sumMonthly  = (arr: typeof components) => arr.reduce((s, c) => s + (c.computed_monthly ?? 0), 0)
  const grossMonthly    = sumMonthly(earnings)
  const employerMonthly = sumMonthly(empContribs)
  const dedMonthly      = sumMonthly(deductions)
  const ctcMonthlyCalc  = Math.round((grossMonthly + employerMonthly) * 100) / 100
  const netMonthly      = Math.round((grossMonthly - dedMonthly) * 100) / 100

  const chartData = (trendData?.data ?? []).map(s => ({
    month: fmtMonthShort(s.month),
    Gross: Math.round(s.gross_pay / 1000),
    Net:   Math.round(s.net_pay   / 1000),
  }))

  const latest = slips[0]

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

  return (
    <PageContainer>
      <PageHeader
        title="Pay & Compensation"
        subtitle="Pay slips, salary structure, and revision history"
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

      {/* ── Tab switcher ──────────────────────────────────────────────────── */}
      <div className="flex rounded-lg border border-border/50 overflow-hidden w-fit">
        {([
          { key: 'payslips',      label: 'Pay Slips',         icon: FileText   },
          { key: 'compensation',  label: 'Compensation',      icon: DollarSign },
          { key: 'revisions',     label: 'Revision History',  icon: TrendingUp },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors',
              key !== 'payslips' && 'border-l border-border/50',
              tab === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: PAY SLIPS                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'payslips' && (
        <>
          {/* Latest slip summary cards */}
          {latest && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Latest Month',  value: fmtMonth(latest.month), cls: '' },
                { label: 'Net Pay',       value: fmtCurrency(latest.net_pay), cls: 'text-success' },
                { label: 'Payable Days',  value: `${latest.payable_days} / ${latest.total_working_days}`, cls: '' },
                {
                  label: 'LOP Days',
                  value: String(latest.lop_days),
                  cls: latest.lop_days > 0 ? 'text-destructive' : 'text-success',
                },
              ].map(k => (
                <div key={k.label} className="p-4 rounded-lg border border-border bg-card">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className={cn('text-sm font-bold mt-1', k.cls)}>{k.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* YTD Summary */}
          {slips.length > 0 && <YTDSummary slips={slips} />}

          {/* Slip list */}
          <SectionCard
            title="Pay Slip History"
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          >
            {slipsLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : slipsError ? (
              <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />Failed to load pay slips. Please try again.
              </div>
            ) : slips.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <DollarSign className="h-10 w-10 opacity-30" />
                <p className="text-sm">No finalized pay slips yet.</p>
                <p className="text-xs opacity-70">Pay slips appear here once HR finalizes the payroll run.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {slips.map((slip, idx) => (
                  <SlipCard key={slip.slip_id} slip={slip} prevSlip={slips[idx + 1]} employeeId={employeeId} />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: COMPENSATION                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'compensation' && (
        <>
          {/* CTC Summary cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Annual CTC</p>
                <p className="text-2xl font-bold text-foreground tabular-nums">
                  {compLoading ? '…' : fmtCompact(comp?.ctc_annual)}
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
                  {compLoading ? '…' : fmtCompact(comp?.ctc_monthly)}
                </p>
                {comp?.salary_structures?.name && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{comp.salary_structures.name}</p>
                )}
              </div>
            </div>
          </div>

          {/* Rate vs Actuals — month picker */}
          <SectionCard
            title="Rate vs Actuals"
            icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
            action={
              slips.length > 0 ? (
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  {slips.map(s => (
                    <option key={s.month} value={s.month}>{fmtMonth(s.month)}</option>
                  ))}
                </select>
              ) : undefined
            }
          >
            {slips.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No finalized payslips yet — Rate vs Actuals will appear once your first payslip is processed.
              </p>
            ) : rvaLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : (
              <RateVsActualsTable comp={comp} slipDetail={rvaSlipData?.data} />
            )}
          </SectionCard>

          {/* Salary structure (base CTC components) */}
          <SectionCard
            title="Salary Structure"
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          >
            {compError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Failed to load data. Please refresh and try again.
              </div>
            )}
            {compLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : components.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No salary components configured. Contact HR.</p>
            ) : (
              <div className="space-y-4">
                {[
                  { label: 'Earnings',                items: earnings   },
                  { label: 'Deductions',              items: deductions },
                  { label: 'Employer Contributions',  items: empContribs },
                ].filter(g => g.items.length > 0).map(({ label, items }) => (
                  <div key={label}>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{label}</p>
                    <div className="space-y-1">
                      {items.sort((a, b) => a.sequence - b.sequence).map(c => (
                        <div key={c.id}
                          className={cn('flex items-center justify-between px-3 py-2 rounded-md text-sm',
                            label === 'Deductions' ? 'bg-destructive/5' : label === 'Employer Contributions' ? 'bg-muted/20' : 'bg-muted/30')}>
                          <div>
                            <span className="font-medium text-foreground">{c.salary_components?.name}</span>
                            {c.salary_components?.is_taxable && (
                              <Badge className="ml-2 rounded-full text-[9px]" variant="outline">Taxable</Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <p className={cn('font-semibold tabular-nums',
                              label === 'Deductions' ? 'text-destructive' : label === 'Employer Contributions' ? 'text-muted-foreground' : 'text-success')}>
                              {label === 'Deductions' ? '-' : ''}{fmtCompact(c.computed_monthly)}<span className="text-xs text-muted-foreground">/mo</span>
                            </p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              {fmtCompact(c.computed_annual)}/yr
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* CTC reconciliation footer */}
                <div className="pt-3 border-t border-border space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Gross Earnings</span>
                    <span className="font-semibold tabular-nums">{fmtCompact(grossMonthly)}/mo</span>
                  </div>
                  {empContribs.length > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Employer Contributions</span>
                      <span className="tabular-nums text-muted-foreground">{fmtCompact(employerMonthly)}/mo</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm rounded-md bg-primary/5 px-3 py-2">
                    <span className="font-bold uppercase tracking-wide text-primary text-xs">Total CTC</span>
                    <div className="text-right">
                      <p className="font-bold tabular-nums">{fmtCompact(ctcMonthlyCalc)}/mo</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">{fmtCompact(comp?.ctc_annual)}/yr</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Net Take-Home</span>
                    <span className="font-semibold tabular-nums text-success">{fmtCompact(netMonthly)}/mo</span>
                  </div>
                </div>

                {comp?.effective_from && (
                  <p className="text-[10px] text-muted-foreground pt-3 border-t border-border">
                    Effective from {fmtDate(comp.effective_from)}
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* Trend chart */}
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

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: REVISION HISTORY                                               */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'revisions' && (
        <SectionCard
          title="Compensation Revision History"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        >
          {revLoading ? (
            <IntelligenceLoadingSkeleton rows={4} />
          ) : (
            <RevisionTimeline revisions={revisions} />
          )}
        </SectionCard>
      )}
    </PageContainer>
  )
}
