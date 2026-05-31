/**
 * PayrollRuns — /admin/payroll
 *
 * HR admin page for triggering payroll runs, viewing run history,
 * and drilling into individual employee pay slips.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState }                       from 'react'
import { Link, useNavigate }                     from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Play, Lock,
  ShieldAlert, Download, Eye, Loader2,
  DollarSign, Users, TrendingDown, CheckCircle2,
  AlertCircle, RefreshCw, FileText, X,
  AlertTriangle, ChevronDown, ChevronUp, TrendingUp, BarChart2, Search,
  Scale, XCircle, ShieldCheck,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FailureSummaryGroup {
  failure_stage:  string
  reason:         string
  count:          number
  employee_codes: string[]
}

interface FailureSummary {
  total_failed:    number
  total_employees: number
  dominant_stage:  string
  dominant_reason: string
  groups:          FailureSummaryGroup[]
}

// ── Payroll Run State Machine ─────────────────────────────────────────────────
//
//   Draft ──► Processing ──► Finalized ──► Frozen ──► (Reopened)
//              │                                         │
//              └─► Failed / Partial Failed               └─► Draft (new correction run)
//
// frozen:   Period is immutably sealed — no reruns, no mutation.
//           Requires explicit "Lock Period" action after finalization.
// reopened: Admin unlocked a frozen period for corrections (mandatory reason + audit trail).
//           A new correction run should be created; the frozen run remains in audit history.

interface PayrollRun {
  id:               string
  month:            string
  status:           'draft' | 'partial_failed' | 'processing' | 'finalized' | 'failed' | 'frozen' | 'reopened'
  employee_count:   number
  total_gross:      number
  total_deductions: number
  total_net:        number
  total_lop_amount: number
  held_count:       number        // slips in held status
  warning_count:    number        // slips with warnings
  error_message:    string | null
  /** Structured per-stage failure breakdown — present when status = failed | partial_failed */
  failure_summary:  FailureSummary | null
  notes:            string | null
  created_at:       string
  finalized_at:     string | null
  approved_by_name: string | null // who finalized
  // ── Enterprise integrity fields (Phase 3) ──────────────────────────────────
  created_by_name:  string | null // who triggered the run
  frozen_at:        string | null // when period was frozen
  frozen_by_name:   string | null // who froze the period
  reopened_at:      string | null // when period was reopened
  reopened_by_name: string | null // who reopened the period
  reopen_reason:    string | null // mandatory audit reason for reopen
}

interface PayrollSlip {
  /** Matches EmployeePayslipView.slip_id from the API read model */
  slip_id:               string
  employee_id:           string
  month:                 string
  total_working_days:    number
  payable_days:          number
  lop_days:              number
  overtime_hours:        number
  ctc_monthly:           number
  gross_pay:             number
  lop_amount:            number
  total_deductions:      number
  net_pay:               number
  employer_contributions:number
  status:                'draft' | 'finalized' | 'held'
  held_reason:           string | null
  warning:               string | null
  /** Null when the employee row has been archived/deleted (orphan slip) */
  employee_name:         string | null
  employee_code:         string | null
  component_breakdown:   ComponentSnapshot[]
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

interface SlipListResponse {
  data:  PayrollSlip[]
  total: number
  limit: number
  offset: number
}

// ── Force-finalize types ──────────────────────────────────────────────────────

interface MissingAttendanceEmployee {
  employee_id:   string
  employee_name: string
  employee_code: string
}

// ── Phase 10 Types ────────────────────────────────────────────────────────────

interface Blocker {
  type:          'no_compensation' | 'no_attendance'
  employee_id:   string
  employee_name: string
  employee_code: string
}

interface BlockerReport {
  month:            string
  total_employees:  number
  ready:            number
  no_compensation:  number
  no_attendance:    number
  open_anomalies:   number
  blockers:         Blocker[]
}

interface EmpVariancePart {
  gross_pay:        number
  net_pay:          number
  lop_days:         number
  lop_amount:       number
  payable_days:     number
  total_deductions: number
}

interface EmpVariance {
  employee_id:   string
  employee_name: string | null
  employee_code: string | null
  current:       EmpVariancePart
  previous:      EmpVariancePart | null
  diff:          { gross_pay: number; net_pay: number; lop_days: number }
  is_new:        boolean
}

interface VarianceSummary {
  total_employees:    number
  employees_changed:  number
  gross_change:       number
  gross_change_pct:   number
  net_change:         number
  net_change_pct:     number
  total_current_gross: number
  total_current_net:   number
  total_prev_gross:    number
  total_prev_net:      number
}

interface VarianceReport {
  current_month:  string
  previous_month: string
  has_previous:   boolean
  summary:        VarianceSummary
  employees:      EmpVariance[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style:    'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  return d.toLocaleString('default', { month: 'long', year: 'numeric' })
}

function prevMonthStr(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonthStr(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_BADGE: Record<string, string> = {
  draft:          'secondary',
  partial_failed: 'warning',
  processing:     'warning',
  finalized:      'success',
  failed:         'destructive',
  frozen:         'default',    // primary — immutably sealed
  reopened:       'warning',    // orange — period unlocked, correction in progress
}

/** Human-readable status labels */
const STATUS_LABEL: Record<string, string> = {
  draft:          'Draft',
  partial_failed: 'Partial',
  processing:     'Processing',
  finalized:      'Finalized',
  failed:         'Failed',
  frozen:         'Frozen',
  reopened:       'Reopened',
}

const SLIP_STATUS_BADGE: Record<string, string> = {
  draft:      'secondary',
  finalized:  'success',
  held:       'warning',
}

// ── ReadinessCheck ────────────────────────────────────────────────────────────

function ReadinessCheck({ month }: { month: string }) {
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading, isError } = useQuery<BlockerReport>({
    queryKey: ['payroll-blockers', month],
    queryFn:  () => api.get(`/payroll/runs/blockers?month=${month}`),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking readiness…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <AlertTriangle className="h-3.5 w-3.5" />
        Could not load readiness data.
      </div>
    )
  }

  const blockerCount = data.blockers.length
  const allReady     = blockerCount === 0

  return (
    <div className="rounded-md border border-border bg-muted/20 overflow-hidden">
      {/* Summary row */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-2.5 text-xs hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          {allReady ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
          )}
          <span className={allReady ? 'text-success font-medium' : 'text-warning font-medium'}>
            {allReady
              ? `${data.ready} employees ready`
              : `${data.ready} ready · ${blockerCount} blocker${blockerCount !== 1 ? 's' : ''}`}
          </span>
          {data.open_anomalies > 0 && (
            <span className="text-destructive ml-1">· {data.open_anomalies} anomal{data.open_anomalies !== 1 ? 'ies' : 'y'}</span>
          )}
        </div>
        {blockerCount > 0 && (
          expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                   : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Blocker list */}
      {expanded && blockerCount > 0 && (
        <div className="border-t border-border divide-y divide-border/40 max-h-40 overflow-y-auto">
          {data.blockers.map(b => (
            <div key={b.employee_id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                b.type === 'no_compensation' ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning',
              )}>
                {b.type === 'no_compensation' ? 'No Comp' : 'No Att.'}
              </span>
              <span className="font-medium text-foreground">{b.employee_name}</span>
              <span className="text-muted-foreground font-mono text-[10px]">#{b.employee_code}</span>
            </div>
          ))}
        </div>
      )}

      {/* Workflow quick-links — validate and reconcile before running */}
      <div className="border-t border-border/40 px-2.5 py-1.5 flex items-center justify-between">
        <Link
          to={`/admin/payroll/validation?month=${month}`}
          className="flex items-center gap-1 text-[10px] text-info hover:text-info hover:underline transition-colors"
        >
          <CheckCircle2 className="h-3 w-3" />
          Validate →
        </Link>
        <Link
          to={`/admin/payroll/reconciliation?month=${month}`}
          className="flex items-center gap-1 text-[10px] text-info hover:text-info hover:underline transition-colors"
        >
          <Scale className="h-3 w-3" />
          Reconcile →
        </Link>
      </div>
    </div>
  )
}

// ── VarianceDialog ────────────────────────────────────────────────────────────

function VarianceDialog({
  run,
  onClose,
}: {
  run:     PayrollRun
  onClose: () => void
}) {
  const { data, isLoading, isError } = useQuery<VarianceReport>({
    queryKey: ['payroll-variance', run.id],
    queryFn:  () => api.get(`/payroll/runs/${run.id}/variance`),
    staleTime: 120_000,
  })

  const fmtDelta = (n: number) => {
    const sign = n >= 0 ? '+' : ''
    return `${sign}${fmtCurrency(Math.abs(n))}`
  }
  const fmtPct = (n: number) => {
    const sign = n >= 0 ? '+' : ''
    return `${sign}${n.toFixed(1)}%`
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
            Month-over-Month Variance — {fmtMonth(run.month)}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading variance…
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-xs text-destructive py-4">
            <AlertCircle className="h-4 w-4" />
            Failed to load variance data.
          </div>
        )}

        {data && !data.has_previous && (
          <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground text-xs">
            <TrendingUp className="h-8 w-8 opacity-30" />
            <p>No previous month run found — this appears to be the first payroll run.</p>
          </div>
        )}

        {data && data.has_previous && (
          <div className="space-y-4">
            {/* Period header */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{fmtMonth(data.previous_month)}</span>
              <span>→</span>
              <span className="font-medium text-foreground">{fmtMonth(data.current_month)}</span>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: 'Gross Change',
                  value: fmtDelta(data.summary.gross_change),
                  sub: fmtPct(data.summary.gross_change_pct),
                  cls: data.summary.gross_change >= 0 ? 'text-success' : 'text-destructive',
                },
                {
                  label: 'Net Pay Change',
                  value: fmtDelta(data.summary.net_change),
                  sub: fmtPct(data.summary.net_change_pct),
                  cls: data.summary.net_change >= 0 ? 'text-success' : 'text-destructive',
                },
                {
                  label: 'Employees Changed',
                  value: data.summary.employees_changed,
                  sub: `of ${data.summary.total_employees}`,
                  cls: 'text-foreground',
                },
                {
                  label: 'Current Net Total',
                  value: fmtCurrency(data.summary.total_current_net),
                  sub: `prev: ${fmtCurrency(data.summary.total_prev_net)}`,
                  cls: 'text-success',
                },
              ].map(({ label, value, sub, cls }) => (
                <div key={label} className="p-3 rounded-md bg-muted/40 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn('text-sm font-bold', cls)}>{value}</p>
                  <p className="text-[10px] text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>

            {/* Employee diff table */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Employee Breakdown (sorted by largest net pay change)
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {['Employee', 'Prev Gross', 'Curr Gross', 'Prev Net', 'Curr Net', 'Δ Net', 'LOP Δ', '', ''].map((h, i) => (
                        <th key={i} className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees.map(emp => {
                      const netDelta = emp.diff.net_pay
                      const isNew    = emp.is_new
                      return (
                        <tr key={emp.employee_id} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <p className="font-medium text-foreground">{emp.employee_name ?? '—'}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{emp.employee_code ?? ''}</p>
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {emp.previous ? fmtCurrency(emp.previous.gross_pay) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono">{fmtCurrency(emp.current.gross_pay)}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {emp.previous ? fmtCurrency(emp.previous.net_pay) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono font-semibold text-success">
                            {fmtCurrency(emp.current.net_pay)}
                          </td>
                          <td className={cn('px-3 py-2 font-mono font-semibold',
                            netDelta > 0 ? 'text-success' : netDelta < 0 ? 'text-destructive' : 'text-muted-foreground',
                          )}>
                            {isNew ? <span className="text-info text-[10px] font-medium">NEW</span> : fmtDelta(netDelta)}
                          </td>
                          <td className={cn('px-3 py-2 font-mono',
                            emp.diff.lop_days > 0 ? 'text-destructive' : emp.diff.lop_days < 0 ? 'text-success' : 'text-muted-foreground',
                          )}>
                            {isNew ? '—' : (emp.diff.lop_days === 0 ? '—' : (emp.diff.lop_days > 0 ? `+${emp.diff.lop_days}` : emp.diff.lop_days))}
                          </td>
                          <td className="px-3 py-2">
                            {isNew && (
                              <span className="rounded-full px-1.5 py-0.5 bg-info/15 text-info text-[10px] font-medium">
                                New
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-warning" asChild>
                              <Link to={`/admin/payroll/investigate?employee_id=${emp.employee_id}&month=${run.month}`} title="Investigate payroll">
                                <Search className="h-3 w-3" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass = 'text-foreground',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  colorClass?: string
}) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card flex items-start gap-3">
      <div className="p-2 rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('font-display text-lg font-bold mt-0.5', colorClass)}>{value}</p>
      </div>
    </div>
  )
}

// ── SlipDetailDialog ──────────────────────────────────────────────────────────

function SlipDetailDialog({
  slip,
  onClose,
}: {
  slip: PayrollSlip
  onClose: () => void
}) {
  const earnings    = slip.component_breakdown.filter(c => c.component_type === 'earning')
  const deductions  = slip.component_breakdown.filter(c => c.component_type === 'deduction')
  const empContribs = slip.component_breakdown.filter(c => c.component_type === 'employer_contribution')

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Pay Slip — {slip.employee_name ?? '(archived employee)'}
            <span className="text-xs text-muted-foreground font-normal ml-1">#{slip.employee_code ?? '—'}</span>
          </DialogTitle>
        </DialogHeader>

        {slip.warning && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-warning text-xs">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {slip.warning}
          </div>
        )}

        {/* Attendance metrics */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Working Days', value: slip.total_working_days },
            { label: 'Payable Days', value: slip.payable_days,     cls: 'text-success' },
            { label: 'LOP Days',     value: slip.lop_days,         cls: 'text-destructive' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="p-2 rounded-md bg-muted/40">
              <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
              <p className={cn('text-lg font-bold', cls ?? 'text-foreground')}>{value}</p>
            </div>
          ))}
        </div>

        {/* Pay summary */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-md border border-border bg-muted/20 text-sm">
          {[
            { label: 'CTC Monthly',          value: fmtCurrency(slip.ctc_monthly),          cls: '' },
            { label: 'Gross Pay',            value: fmtCurrency(slip.gross_pay),            cls: 'text-success' },
            { label: 'LOP Deduction',        value: fmtCurrency(slip.lop_amount),           cls: 'text-destructive' },
            { label: 'Total Deductions',     value: fmtCurrency(slip.total_deductions),     cls: 'text-destructive' },
            { label: 'Net Pay',              value: fmtCurrency(slip.net_pay),              cls: 'text-success font-bold' },
            { label: 'Employer Contribs.',   value: fmtCurrency(slip.employer_contributions), cls: 'text-muted-foreground' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex items-center justify-between col-span-1">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className={cn('text-xs font-semibold', cls)}>{value}</span>
            </div>
          ))}
        </div>

        {/* Component breakdown */}
        {slip.component_breakdown.length > 0 && (
          <div className="space-y-3">
            {[
              { title: 'Earnings',                items: earnings },
              { title: 'Deductions',              items: deductions },
              { title: 'Employer Contributions',  items: empContribs },
            ].filter(g => g.items.length > 0).map(group => (
              <div key={group.title}>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{group.title}</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Component</th>
                      <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Type</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Monthly</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Annual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(c => (
                      <tr key={c.salary_component_id} className="border-b border-border/40">
                        <td className="py-1.5 px-2 font-medium">{c.name}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{c.calc_type}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtCurrency(c.monthly_amount)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{fmtCurrency(c.annual_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {slip.held_reason && (
          <div className="p-3 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
            <span className="font-semibold">Held: </span>{slip.held_reason}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── SlipsPanel ────────────────────────────────────────────────────────────────

function SlipsPanel({
  run,
  onClose,
}: {
  run: PayrollRun
  onClose: () => void
}) {
  const [search, setSearch]       = useState('')
  const [offset, setOffset]       = useState(0)
  const [viewSlip, setViewSlip]   = useState<PayrollSlip | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const LIMIT = 20

  const { data, isLoading } = useQuery<SlipListResponse>({
    queryKey: ['payroll-slips', run.id, offset, search],
    queryFn:  () => api.get(`/payroll/runs/${run.id}/slips?limit=${LIMIT}&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    staleTime: 30_000,
  })

  const slips  = data?.data  ?? []
  const total  = data?.total ?? 0
  const pages  = Math.ceil(total / LIMIT)
  const curPage = Math.floor(offset / LIMIT) + 1

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const response = await api.getRaw(`/payroll/runs/${run.id}/export`)
      const blob = await response.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `payroll-${run.month}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed — please try again')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg shadow-elev-3 border border-border w-full max-w-4xl max-h-[90vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="font-semibold text-sm">{fmtMonth(run.month)} — Pay Slips</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{run.employee_count} employees</p>
          </div>
          <div className="flex items-center gap-2">
            {(run.status === 'finalized' || run.status === 'partial_failed') && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleExport} disabled={isExporting}>
                {isExporting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />
                }
                Export CSV
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <Input
            placeholder="Search employee name or code…"
            value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0) }}
            className="h-8 text-xs"
          />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading slips…
            </div>
          ) : slips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-xs text-muted-foreground gap-2">
              <FileText className="h-8 w-8 opacity-30" />
              No slips found.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {['Employee', 'Working Days', 'Payable Days', 'LOP Days', 'Gross', 'Deductions', 'Net Pay', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slips.map(slip => (
                  <tr key={slip.slip_id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2">
                      <p className="font-medium text-xs">{slip.employee_name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{slip.employee_code}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">{slip.total_working_days}</td>
                    <td className="px-3 py-2 text-xs text-success">{slip.payable_days}</td>
                    <td className="px-3 py-2 text-xs text-destructive">{slip.lop_days}</td>
                    <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(slip.gross_pay)}</td>
                    <td className="px-3 py-2 text-xs font-mono text-destructive">{fmtCurrency(slip.total_deductions)}</td>
                    <td className="px-3 py-2 text-xs font-mono font-semibold text-success">{fmtCurrency(slip.net_pay)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={SLIP_STATUS_BADGE[slip.status] as any} className="rounded-full text-[10px]">
                        {slip.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewSlip(slip)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-warning" asChild>
                        <Link to={`/admin/payroll/investigate?employee_id=${slip.employee_id}&month=${run.month}`} title="Investigate payroll">
                          <Search className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Page {curPage} of {pages} · {total} slips
            </span>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7"
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset(offset + LIMIT)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {viewSlip && <SlipDetailDialog slip={viewSlip} onClose={() => setViewSlip(null)} />}
    </div>
  )
}

// ── FailureSummaryPanel ───────────────────────────────────────────────────────
// Shown inline in RunCard when status = failed | partial_failed.
// Displays the dominant failure reason prominently, with a collapsible
// per-stage breakdown so the admin can see exactly what went wrong without
// opening the Supabase console.

const STAGE_LABEL: Record<string, string> = {
  data_fetch:             'Data fetch',
  compensation_validation:'Compensation',
  computation:            'Computation',
  slip_validation:        'Slip validation',
  db_insert:              'DB insert',
  unexpected:             'Unexpected',
}

/** Truncate a long reason string to a readable length for the compact view. */
function truncateReason(reason: string, maxLen = 90): string {
  if (reason.length <= maxLen) return reason
  return reason.slice(0, maxLen).trimEnd() + '…'
}

function FailureSummaryPanel({
  summary,
  totalEmployees,
}: {
  summary:        FailureSummary
  totalEmployees: number
}) {
  const [expanded, setExpanded] = useState(false)

  const hasMultipleGroups = summary.groups.length > 1

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 overflow-hidden text-xs">

      {/* Dominant failure — always visible */}
      <button
        type="button"
        onClick={() => hasMultipleGroups && setExpanded(v => !v)}
        className={cn(
          'w-full text-left px-2.5 py-2 flex items-start gap-2',
          hasMultipleGroups && 'hover:bg-destructive/10 transition-colors cursor-pointer',
          !hasMultipleGroups && 'cursor-default',
        )}
      >
        <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap',
              'bg-destructive/15 text-destructive',
            )}>
              {STAGE_LABEL[summary.dominant_stage] ?? summary.dominant_stage}
            </span>
            <span className="text-destructive font-medium">
              {summary.total_failed} of {totalEmployees} failed
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed break-words">
            {truncateReason(summary.dominant_reason)}
          </p>
        </div>
        {hasMultipleGroups && (
          <div className="flex-shrink-0 text-muted-foreground">
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />
            }
          </div>
        )}
      </button>

      {/* Per-stage breakdown (collapsible when multiple groups) */}
      {(expanded || !hasMultipleGroups) && summary.groups.length > 0 && (
        <div className="border-t border-destructive/20 divide-y divide-destructive/10">
          {summary.groups.map((g, i) => (
            <div key={i} className="px-2.5 py-1.5 flex items-start gap-2">
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0 mt-0.5 whitespace-nowrap',
                i === 0
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-muted text-muted-foreground',
              )}>
                {STAGE_LABEL[g.failure_stage] ?? g.failure_stage}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground leading-relaxed break-words">
                  {truncateReason(g.reason, 80)}
                </p>
                <p className="text-[9px] text-muted-foreground/70 mt-0.5 font-mono">
                  {g.count} employee{g.count !== 1 ? 's' : ''}
                  {g.employee_codes.length > 0 && (
                    <span className="ml-1">
                      — {g.employee_codes.slice(0, 5).join(', ')}
                      {g.employee_codes.length > 5 && ` +${g.employee_codes.length - 5} more`}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── RunLifecycleBar ───────────────────────────────────────────────────────────
// Phase 2: Payroll lifecycle clarity — visual pipeline for each run card.
// Maps the 4 backend statuses onto a 4-step governance pipeline.

function RunLifecycleBar({ run }: { run: PayrollRun }) {
  if (run.status === 'processing') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-warning">
        <Loader2 className="h-3 w-3 animate-spin" />
        Calculating pay…
      </div>
    )
  }
  if (run.status === 'failed') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-destructive">
        <XCircle className="h-3 w-3" />
        Run failed — re-trigger or investigate
      </div>
    )
  }

  if (run.status === 'partial_failed') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-warning">
        <AlertTriangle className="h-3 w-3" />
        Partial — some employees failed · review before finalizing
      </div>
    )
  }

  // draft or partial_failed: Run ✓ → Validate (link) → Reconcile (link) → Finalize (pending)
  // finalized: all steps ✓
  const isFinalized = run.status === 'finalized'

  const steps: Array<{
    label:  string
    done:   boolean
    href?:  string
  }> = [
    { label: 'Run',       done: true },
    { label: 'Validate',  done: isFinalized, href: isFinalized ? undefined : `/admin/payroll/validation?month=${run.month}` },
    { label: 'Reconcile', done: isFinalized, href: isFinalized ? undefined : `/admin/payroll/reconciliation?month=${run.month}` },
    { label: 'Finalize',  done: isFinalized },
  ]

  return (
    <div className="flex items-center gap-1 text-[10px]">
      {steps.map((step, i) => (
        <React.Fragment key={step.label}>
          {i > 0 && (
            <span className="text-muted-foreground/30 select-none">›</span>
          )}
          {step.href ? (
            <Link
              to={step.href}
              className="text-warning font-medium hover:underline transition-colors"
            >
              {step.label}
            </Link>
          ) : (
            <span className={cn(
              'font-medium',
              step.done ? 'text-success' : 'text-muted-foreground',
            )}>
              {step.done && i < steps.length - 1 ? '✓' : step.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── FinalizeConfirmDialog ─────────────────────────────────────────────────────
// Phase 7: Governance & Freeze UX — confirmation before locking the run.

function FinalizeConfirmDialog({
  run,
  onConfirm,
  onCancel,
  pending,
  errorMessage,
}: {
  run:          PayrollRun
  onConfirm:    () => void
  onCancel:     () => void
  pending:      boolean
  errorMessage?: string
}) {
  const heldCount = run.held_count ?? 0

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-warning" />
            Finalize Payroll — {fmtMonth(run.month)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Irreversibility warning */}
          <div className="p-3 rounded-md bg-warning/10 border border-warning/20 text-warning text-xs">
            <p className="font-semibold mb-1">This action cannot be undone.</p>
            <p>
              Finalizing locks all {run.employee_count} pay slip
              {run.employee_count !== 1 ? 's' : ''} and prevents any further
              modification. Ensure validation and reconciliation are complete
              before proceeding.
            </p>
          </div>

          {/* Run summary */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-md bg-muted/40 space-y-0.5">
              <p className="text-muted-foreground">Employees</p>
              <p className="font-semibold text-foreground text-sm">{run.employee_count}</p>
            </div>
            <div className="p-2.5 rounded-md bg-muted/40 space-y-0.5">
              <p className="text-muted-foreground">Net Payable</p>
              <p className="font-semibold text-success text-sm">{fmtCurrency(run.total_net)}</p>
            </div>
            <div className="p-2.5 rounded-md bg-muted/40 space-y-0.5">
              <p className="text-muted-foreground">Gross Pay</p>
              <p className="font-semibold text-foreground">{fmtCurrency(run.total_gross)}</p>
            </div>
            <div className="p-2.5 rounded-md bg-muted/40 space-y-0.5">
              <p className="text-muted-foreground">LOP Amount</p>
              <p className="font-semibold text-destructive">{fmtCurrency(run.total_lop_amount)}</p>
            </div>
          </div>

          {heldCount > 0 && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold">{heldCount} slip{heldCount !== 1 ? 's' : ''} are held</span>
                {' '}— they will be finalized in held state and excluded from disbursement.
              </span>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {errorMessage}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={pending}
            className="gap-1.5"
          >
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Lock className="h-3.5 w-3.5" />
            }
            {errorMessage ? 'Retry Finalize' : 'Confirm Finalize'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── ForceOverrideDialog ───────────────────────────────────────────────────────
// Shown when the backend returns 422 MISSING_ATTENDANCE_DATA during finalization.
// Operator must enter an override reason before force-finalizing.
// All overrides are persisted by the backend to payroll_finalize_overrides (SOX audit trail).

function ForceOverrideDialog({
  run,
  missingEmployees,
  overrideReason,
  onReasonChange,
  onConfirm,
  onCancel,
  pending,
}: {
  run:              PayrollRun
  missingEmployees: MissingAttendanceEmployee[]
  overrideReason:   string
  onReasonChange:   (v: string) => void
  onConfirm:        () => void
  onCancel:         () => void
  pending:          boolean
}) {
  const reasonTooShort = overrideReason.trim().length < 10

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Force Finalize — Missing Attendance Data
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Warning */}
          <div className="p-3 rounded-md bg-warning/10 border border-warning/20 text-warning text-xs">
            <p className="font-semibold mb-1">
              {missingEmployees.length} employee{missingEmployees.length !== 1 ? 's' : ''} have no attendance
              data for {fmtMonth(run.month)}.
            </p>
            <p>
              These employees will receive <strong>full pay (0 LOP assumed)</strong>.
              Proceeding is irreversible — this override will be logged for audit.
            </p>
          </div>

          {/* Affected employees */}
          {missingEmployees.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Affected Employees ({missingEmployees.length})
              </div>
              <div className="max-h-32 overflow-y-auto divide-y divide-border/40">
                {missingEmployees.map(e => (
                  <div key={e.employee_id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="font-medium">{e.employee_name}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">#{e.employee_code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Override reason */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Override Reason <span className="text-destructive">*</span>
              <span className="ml-1 text-[10px] font-normal">(min 10 characters)</span>
            </label>
            <textarea
              className={cn(
                'w-full rounded-md border bg-transparent px-3 py-2 text-xs resize-none',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-1',
                reasonTooShort && overrideReason.length > 0
                  ? 'border-destructive focus:ring-destructive'
                  : 'border-input focus:ring-ring',
              )}
              rows={3}
              placeholder="e.g. Attendance system was down for these employees — verified manually with managers"
              value={overrideReason}
              onChange={e => onReasonChange(e.target.value)}
              disabled={pending}
            />
            {reasonTooShort && overrideReason.length > 0 && (
              <p className="text-[10px] text-destructive mt-1">
                Please provide at least 10 characters.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || reasonTooShort}
            className="gap-1.5"
          >
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Lock className="h-3.5 w-3.5" />
            }
            Force Finalize
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── AttentionBanner ───────────────────────────────────────────────────────────
// Phase 5: Attention queue — surface items requiring immediate action.
// Shown only when actionable items exist.

function AttentionBanner({ runs }: { runs: PayrollRun[] }) {
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  type Item = { type: 'failed' | 'partial_failed' | 'overdue' | 'held'; label: string }
  const items: Item[] = []

  for (const r of runs) {
    if (r.status === 'failed') {
      // Use structured failure_summary when available for a specific dominant reason
      const failLabel = r.failure_summary
        ? `${STAGE_LABEL[r.failure_summary.dominant_stage] ?? r.failure_summary.dominant_stage}: ${truncateReason(r.failure_summary.dominant_reason, 60)}`
        : (r.error_message ?? 'unknown error')
      items.push({
        type:  'failed',
        label: `${fmtMonth(r.month)} — all ${r.failure_summary?.total_employees ?? '?'} employees failed · ${failLabel}`,
      })
    } else if (r.status === 'partial_failed') {
      const failLabel = r.failure_summary
        ? `${r.failure_summary.total_failed} failed · ${STAGE_LABEL[r.failure_summary.dominant_stage] ?? r.failure_summary.dominant_stage}: ${truncateReason(r.failure_summary.dominant_reason, 50)}`
        : 'some employees failed'
      items.push({
        type:  'partial_failed',
        label: `${fmtMonth(r.month)} partial run — ${failLabel}`,
      })
    } else if (r.status === 'draft' && r.month < currentMonthStr) {
      items.push({
        type:  'overdue',
        label: `${fmtMonth(r.month)} draft is overdue for finalization`,
      })
    } else if (r.status === 'draft' && (r.held_count ?? 0) > 0) {
      items.push({
        type:  'held',
        label: `${r.held_count} slip${r.held_count !== 1 ? 's' : ''} held in ${fmtMonth(r.month)} — resolve before finalizing`,
      })
    }
  }

  if (!items.length) return null

  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-warning">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        {items.length} item{items.length !== 1 ? 's' : ''} need{items.length === 1 ? 's' : ''} attention
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className={cn(
              'mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0',
              item.type === 'failed' ? 'bg-destructive' : 'bg-warning',
              // partial_failed uses warning color (already covered by else branch above)
            )} />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RunCard ───────────────────────────────────────────────────────────────────

function RunCard({
  run,
  onViewSlips,
  onFinalizeRequest,
  onViewVariance,
  onFreezeRequest,
  onReopenRequest,
  finalizePending,
  freezePending,
  reopenPending,
}: {
  run:               PayrollRun
  onViewSlips:       (r: PayrollRun) => void
  onFinalizeRequest: (r: PayrollRun) => void   // opens confirm dialog
  onViewVariance:    (r: PayrollRun) => void
  onFreezeRequest:   (r: PayrollRun) => void   // opens freeze dialog
  onReopenRequest:   (r: PayrollRun) => void   // opens reopen dialog
  finalizePending:   boolean
  freezePending:     boolean
  reopenPending:     boolean
}) {
  const navigate     = useNavigate()
  const heldCount    = run.held_count    ?? 0
  const warningCount = run.warning_count ?? 0

  return (
    <div className="p-4 rounded-lg border border-border bg-card space-y-3">

      {/* Header row: month + status badge + held/warning chips */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{fmtMonth(run.month)}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {run.employee_count} employee{run.employee_count !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {heldCount > 0 && (
            <span className="rounded-full px-1.5 py-0.5 bg-warning/15 text-warning text-[10px] font-medium whitespace-nowrap">
              {heldCount} held
            </span>
          )}
          {warningCount > 0 && (
            <span className="rounded-full px-1.5 py-0.5 bg-warning/10 text-warning text-[10px] whitespace-nowrap">
              {warningCount} warn
            </span>
          )}
          <Badge variant={STATUS_BADGE[run.status] as any} className="rounded-full text-xs capitalize">
            {STATUS_LABEL[run.status] ?? run.status}
          </Badge>
        </div>
      </div>

      {/* Lifecycle pipeline */}
      <RunLifecycleBar run={run} />

      {/* Financials */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-md bg-muted/40">
          <p className="text-[10px] text-muted-foreground mb-0.5">Gross</p>
          <p className="text-xs font-semibold text-foreground">{fmtCurrency(run.total_gross)}</p>
        </div>
        <div className="p-2 rounded-md bg-muted/40">
          <p className="text-[10px] text-muted-foreground mb-0.5">Net Pay</p>
          <p className="text-xs font-semibold text-success">{fmtCurrency(run.total_net)}</p>
        </div>
        <div className="p-2 rounded-md bg-muted/40">
          <p className="text-[10px] text-muted-foreground mb-0.5">LOP</p>
          <p className="text-xs font-semibold text-destructive">{fmtCurrency(run.total_lop_amount)}</p>
        </div>
      </div>

      {/* Structured failure breakdown — shown when failure_summary is available */}
      {run.failure_summary && (
        <FailureSummaryPanel
          summary={run.failure_summary}
          totalEmployees={run.failure_summary.total_employees}
        />
      )}

      {/* Fallback: show error_message when no structured summary (old runs / edge cases) */}
      {!run.failure_summary && run.error_message && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {run.error_message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 pt-1 flex-wrap">
        {/* Always: view slips */}
        <Button
          size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => onViewSlips(run)}
        >
          <Eye className="h-3.5 w-3.5" />
          Slips
        </Button>

        {/* Failed + partial_failed: Review Blockers (primary CTA for failed runs) */}
        {(run.status === 'failed' || run.status === 'partial_failed') && (
          <Button
            size="sm"
            variant={run.status === 'failed' ? 'destructive' : 'outline'}
            className="h-7 text-xs gap-1.5 flex-1"
            onClick={() => navigate(`/admin/payroll/blockers/${run.id}`)}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Review Blockers
            {run.failure_summary && (
              <span className="ml-0.5 rounded-full bg-white/20 px-1 text-[9px] font-bold">
                {run.failure_summary.total_failed}
              </span>
            )}
          </Button>
        )}

        {/* Draft + partial_failed: validate + reconcile workflow links */}
        {(run.status === 'draft' || run.status === 'partial_failed') && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1" asChild>
              <Link to={`/admin/payroll/validation?month=${run.month}`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Validate
              </Link>
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1" asChild>
              <Link to={`/admin/payroll/reconciliation?month=${run.month}`}>
                <Scale className="h-3.5 w-3.5" />
                Reconcile
              </Link>
            </Button>
          </>
        )}

        {/* Finalized: variance report + freeze period */}
        {run.status === 'finalized' && (
          <>
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1"
              onClick={() => onViewVariance(run)}
            >
              <BarChart2 className="h-3.5 w-3.5" />
              Variance
            </Button>
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1 border-primary/40 text-primary hover:bg-primary/5"
              disabled={freezePending}
              onClick={() => onFreezeRequest(run)}
            >
              {freezePending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Lock className="h-3.5 w-3.5" />
              }
              Freeze
            </Button>
          </>
        )}

        {/* Frozen: reopen (break-glass) */}
        {run.status === 'frozen' && (
          <Button
            size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1 border-warning/40 text-warning hover:bg-warning/5"
            disabled={reopenPending}
            onClick={() => onReopenRequest(run)}
          >
            {reopenPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />
            }
            Reopen
          </Button>
        )}

        {/* Draft + partial_failed: finalize (opens confirm dialog) */}
        {(run.status === 'draft' || run.status === 'partial_failed') && (
          <Button
            size="sm" className="h-7 text-xs gap-1.5 flex-1"
            disabled={finalizePending}
            onClick={() => onFinalizeRequest(run)}
          >
            <Lock className="h-3.5 w-3.5" />
            Finalize
          </Button>
        )}
      </div>

      {/* Audit trail — replaces old single-line governance metadata */}
      <PayrollAuditTimeline run={run} />
    </div>
  )
}

// ── FreezeRunDialog ───────────────────────────────────────────────────────────
// Phase 3: Payroll Run Integrity — explicitly seal a finalized period.
// Prevents reruns, compensations mutations, and attendance adjustments for the month.
// Transition: finalized → frozen

function FreezeRunDialog({
  run,
  onConfirm,
  onCancel,
  pending,
}: {
  run:      PayrollRun
  onConfirm: () => void
  onCancel:  () => void
  pending:   boolean
}) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" />
            Freeze Period — {fmtMonth(run.month)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* What freeze means */}
          <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-xs space-y-2">
            <p className="font-semibold text-foreground">Freezing permanently seals this payroll period.</p>
            <ul className="space-y-1 text-muted-foreground list-none">
              {[
                'No further payroll reruns for this month',
                'No compensation changes backdated to this period',
                'No attendance adjustments will affect this run',
                'All pay slips are immutably archived',
                'Statutory filings must be completed before freezing',
              ].map(rule => (
                <li key={rule} className="flex items-start gap-1.5">
                  <ShieldCheck className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>

          {/* Run summary */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { label: 'Period',          value: fmtMonth(run.month) },
              { label: 'Employees',       value: run.employee_count },
              { label: 'Net Payable',     value: fmtCurrency(run.total_net) },
              { label: 'Finalized By',    value: run.approved_by_name ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="p-2 rounded-md bg-muted/40">
                <p className="text-muted-foreground text-[10px]">{label}</p>
                <p className="font-semibold text-foreground text-xs mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={pending} className="gap-1.5">
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Lock className="h-3.5 w-3.5" />
            }
            Freeze Period
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── ReopenRunDialog ───────────────────────────────────────────────────────────
// Phase 3: Payroll Run Integrity — unlock a frozen period for corrections.
// This is a break-glass action requiring mandatory reason (min 20 chars).
// Transition: frozen → reopened
// A NEW correction run should be triggered after reopening.

function ReopenRunDialog({
  run,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  pending,
}: {
  run:            PayrollRun
  reason:         string
  onReasonChange: (v: string) => void
  onConfirm:      () => void
  onCancel:       () => void
  pending:        boolean
}) {
  const tooShort = reason.trim().length < 20

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Reopen Period — {fmtMonth(run.month)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="p-3 rounded-md bg-destructive/5 border border-destructive/20 text-destructive text-xs space-y-1">
            <p className="font-semibold">Break-glass action — use only for genuine corrections.</p>
            <p className="text-muted-foreground">
              Reopening a frozen period is permanent and will be recorded in the audit log
              with your user identity, timestamp, and the reason below. This action cannot be reversed.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Reopen Reason <span className="text-destructive">*</span>
              <span className="ml-1 text-[10px] font-normal">(minimum 20 characters)</span>
            </label>
            <textarea
              className={cn(
                'w-full rounded-md border bg-transparent px-3 py-2 text-xs resize-none',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-1',
                tooShort && reason.length > 0
                  ? 'border-destructive focus:ring-destructive'
                  : 'border-input focus:ring-ring',
              )}
              rows={4}
              placeholder="e.g. Employee salary structure was configured incorrectly for 3 employees — requires re-run with corrected components"
              value={reason}
              onChange={e => onReasonChange(e.target.value)}
              disabled={pending}
            />
            <div className="flex items-center justify-between mt-1">
              {tooShort && reason.length > 0
                ? <p className="text-[10px] text-destructive">Minimum 20 characters required.</p>
                : <span />
              }
              <p className="text-[10px] text-muted-foreground ml-auto">{reason.length} chars</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm" variant="destructive"
            onClick={onConfirm}
            disabled={pending || tooShort}
            className="gap-1.5"
          >
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />
            }
            Reopen Period
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── PayrollAuditTimeline ──────────────────────────────────────────────────────
// Phase 3: Payroll Audit Architecture — who did what, when.
// Displayed in the RunCard governance section.

function PayrollAuditTimeline({ run }: { run: PayrollRun }) {
  type AuditEvent = {
    label:  string
    time:   string
    actor?: string | null
    cls:    string
  }

  const events: AuditEvent[] = []

  events.push({
    label: 'Run triggered',
    time:  run.created_at,
    actor: run.created_by_name,
    cls:   'bg-muted-foreground/40',
  })

  if (run.finalized_at) {
    events.push({
      label: 'Finalized',
      time:  run.finalized_at,
      actor: run.approved_by_name,
      cls:   'bg-success',
    })
  }

  if (run.frozen_at) {
    events.push({
      label: 'Period frozen',
      time:  run.frozen_at,
      actor: run.frozen_by_name,
      cls:   'bg-primary',
    })
  }

  if (run.reopened_at) {
    events.push({
      label: 'Reopened',
      time:  run.reopened_at,
      actor: run.reopened_by_name,
      cls:   'bg-warning',
    })
  }

  if (events.length <= 1) {
    // Just triggered — show the compact single-line version
    return (
      <p className="text-[10px] text-muted-foreground">
        Triggered {new Date(run.created_at).toLocaleString()}
        {run.created_by_name && <span className="font-medium text-foreground"> by {run.created_by_name}</span>}
      </p>
    )
  }

  return (
    <div className="space-y-1 pt-1 border-t border-border/40">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Audit Trail</p>
      {events.map((ev, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px]">
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ev.cls)} />
          <span className="text-muted-foreground">
            {ev.label}
            {' '}
            <span className="text-foreground font-medium">
              {new Date(ev.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            {ev.actor && <span className="text-muted-foreground"> · {ev.actor}</span>}
          </span>
        </div>
      ))}
      {run.reopen_reason && (
        <p className="text-[10px] text-muted-foreground pl-3.5 italic">
          Reopen reason: {run.reopen_reason}
        </p>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PayrollRuns() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const todayYM = new Date().toISOString().slice(0, 7)
  const [runMonth, setRunMonth] = useState(todayYM)
  const [notes, setNotes]       = useState('')
  const [activeSlipsRun, setActiveSlipsRun]           = useState<PayrollRun | null>(null)
  const [activeVarianceRun, setActiveVarianceRun]     = useState<PayrollRun | null>(null)
  const [activeFinalizeRun, setActiveFinalizeRun]     = useState<PayrollRun | null>(null)
  const [runError, setRunError]                       = useState('')

  // Phase 3: Freeze / Reopen state
  const [activeFreezeRun, setActiveFreezeRun]         = useState<PayrollRun | null>(null)
  const [activeReopenRun, setActiveReopenRun]         = useState<PayrollRun | null>(null)
  const [reopenReason, setReopenReason]               = useState('')

  // Force-finalize state: populated when backend returns MISSING_ATTENDANCE_DATA
  const [forceOverrideRun, setForceOverrideRun]       = useState<PayrollRun | null>(null)
  const [missingEmployees, setMissingEmployees]       = useState<MissingAttendanceEmployee[]>([])
  const [overrideReason, setOverrideReason]           = useState('')

  // ── Dry Run state ────────────────────────────────────────────────────────────
  interface DryRunEmployeeResult {
    employee_id:   string
    employee_code: string
    status:        'ok' | 'failed'
    failure_stage?: string
    error?:        string
    result?: {
      gross_pay:        number
      net_pay:          number
      lop_days:         number
      payable_days:     number
      total_deductions: number
      ctc_monthly:      number
    }
    compensation_warnings?: string[]
    validation_errors?: string[]
  }
  interface DryRunData {
    dry_run:           boolean
    month:             string
    employee_count:    number
    total_working_days: number
    ok_count:          number
    failed_count:      number
    results:           DryRunEmployeeResult[]
  }
  const [dryRunOpen, setDryRunOpen]     = useState(false)
  const [dryRunData, setDryRunData]     = useState<DryRunData | null>(null)
  const dryRunMutation = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month: runMonth, dry_run: true }) as Promise<DryRunData>,
    onSuccess: (data: DryRunData) => {
      setDryRunData(data)
      setDryRunOpen(true)
    },
    onError: (e: unknown) => toast.error(
      (e instanceof ApiError ? e.message : (e as any)?.message) ?? 'Dry run failed',
    ),
  })

  // ── Runs list ───────────────────────────────────────────────────────────────
  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery<{
    data: PayrollRun[]; total: number
  }>({
    queryKey: ['payroll-runs'],
    queryFn:  () => api.get('/payroll/runs?limit=20&offset=0'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })

  const runs = runsData?.data ?? []

  // ── Latest summary for header stats ────────────────────────────────────────
  const latestFinalized = runs.find(r => r.status === 'finalized')

  // ── Trigger run ─────────────────────────────────────────────────────────────
  const triggerMutation = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month: runMonth, notes: notes || undefined }),
    onSuccess: () => {
      setNotes('')
      setRunError('')
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Payroll run triggered', { description: fmtMonth(runMonth) })
    },
    onError: (e: any) => setRunError(e?.message ?? 'Failed to trigger payroll run'),
  })

  // ── Finalize run ─────────────────────────────────────────────────────────────
  const finalizeMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/payroll/runs/${runId}/finalize`, {}),
    onSuccess: () => {
      setRunError('')
      setActiveFinalizeRun(null)
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Payroll run finalized')
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.error === 'MISSING_ATTENDANCE_DATA') {
        // Backend blocked finalization: some employees have no attendance data.
        // Surface the force-override dialog instead of a plain error message.
        const employees = (e.data.missing_attendance_employees as MissingAttendanceEmployee[] | undefined) ?? []
        setMissingEmployees(employees)
        setOverrideReason('')
        setForceOverrideRun(activeFinalizeRun)
        setActiveFinalizeRun(null)   // close confirm dialog
        setRunError('')
      } else {
        // Keep dialog open so the error is visible and the user can retry
        setRunError((e as any)?.message ?? 'Failed to finalize run')
      }
    },
  })

  // ── Force-finalize run (override missing-attendance gate) ─────────────────────
  const forceFinalizeMutation = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      api.post(`/payroll/runs/${runId}/finalize`, {
        force_finalize:  true,
        override_reason: reason,
      }),
    onSuccess: () => {
      setForceOverrideRun(null)
      setMissingEmployees([])
      setOverrideReason('')
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Payroll run force-finalized', {
        description: 'Override logged to audit trail. Affected employees received full pay.',
      })
    },
    onError: (e: unknown) => {
      toast.error((e as any)?.message ?? 'Force-finalize failed — please retry')
    },
  })

  // ── Freeze run (finalized → frozen) ─────────────────────────────────────────
  const freezeMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/payroll/runs/${runId}/freeze`, {}),
    onSuccess: () => {
      setActiveFreezeRun(null)
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Period frozen — payroll is now immutably sealed')
    },
    onError: (e: unknown) => {
      toast.error((e as any)?.message ?? 'Failed to freeze period')
    },
  })

  // ── Reopen run (frozen → reopened) ───────────────────────────────────────────
  const reopenMutation = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      api.post(`/payroll/runs/${runId}/reopen`, { reason }),
    onSuccess: () => {
      setActiveReopenRun(null)
      setReopenReason('')
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Period reopened — audit entry recorded', {
        description: 'Trigger a new correction run for this month.',
      })
    },
    onError: (e: unknown) => {
      toast.error((e as any)?.message ?? 'Failed to reopen period')
    },
  })

  // ── Guard ────────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard title="Access Restricted">
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm">Only HR admins can access payroll runs.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Runs"
        subtitle="Execute, validate, and govern the monthly payroll lifecycle"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => refetchRuns()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Phase 6 — KPI Row: latest finalized run signals */}
      {latestFinalized && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Users}
            label={`Employees · ${fmtMonth(latestFinalized.month)}`}
            value={latestFinalized.employee_count}
            colorClass="text-foreground"
          />
          <StatCard
            icon={DollarSign}
            label="Total Net Pay"
            value={fmtCurrency(latestFinalized.total_net)}
            colorClass="text-success"
          />
          <StatCard
            icon={TrendingDown}
            label="LOP Amount"
            value={fmtCurrency(latestFinalized.total_lop_amount)}
            colorClass="text-destructive"
          />
          <StatCard
            icon={FileText}
            label="Held Slips"
            value={latestFinalized.held_count ?? 0}
            colorClass={(latestFinalized.held_count ?? 0) > 0 ? 'text-warning' : 'text-success'}
          />
        </div>
      )}

      {/* Phase 5 — Attention banner: failed runs, overdue drafts, held slips */}
      {runs.length > 0 && <AttentionBanner runs={runs} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trigger Panel */}
        <SectionCard
          title="Process Payroll"
          icon={<Play className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Month</label>
              <div className="flex items-center gap-1.5">
                <Button size="icon" variant="ghost" className="h-8 w-8"
                  onClick={() => setRunMonth(prevMonthStr(runMonth))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 text-center text-sm font-medium border border-border rounded-md py-1.5 px-3 bg-muted/30">
                  {fmtMonth(runMonth)}
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8"
                  onClick={() => setRunMonth(nextMonthStr(runMonth))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Notes (optional)</label>
              <Input
                placeholder="e.g. April 2025 payroll"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            {/* Readiness check */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Pre-Run Readiness</label>
              <ReadinessCheck month={runMonth} />
            </div>

            {runError && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                {runError}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1 h-9 text-sm gap-2"
                disabled={triggerMutation.isPending || dryRunMutation.isPending}
                onClick={() => triggerMutation.mutate()}
              >
                {triggerMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Processing…</>
                  : <><Play className="h-4 w-4" />Run Payroll</>
                }
              </Button>
              <Button
                variant="outline"
                className="h-9 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/5"
                disabled={dryRunMutation.isPending || triggerMutation.isPending}
                onClick={() => dryRunMutation.mutate()}
                title="Simulate payroll without writing to DB"
              >
                {dryRunMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Search className="h-3.5 w-3.5" />
                }
                Dry Run
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              <strong>Dry Run</strong> simulates payroll without any DB writes — safe to run anytime.
              Re-running for the same month will replace the existing draft run. Finalized runs cannot be replaced.
            </p>

            {/* ── Dry Run Results Dialog ─────────────────────────────────────── */}
            <Dialog open={dryRunOpen} onOpenChange={setDryRunOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <Search className="h-4 w-4 text-primary" />
                    Dry Run Results — {dryRunData ? fmtMonth(dryRunData.month) : ''}
                  </DialogTitle>
                </DialogHeader>
                {dryRunData && (
                  <div className="space-y-3">
                    {/* Summary chips */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Employees',     value: dryRunData.employee_count,    color: 'text-foreground' },
                        { label: 'Working Days',  value: dryRunData.total_working_days, color: 'text-foreground' },
                        { label: 'Succeeded',     value: dryRunData.ok_count,           color: dryRunData.ok_count === dryRunData.employee_count ? 'text-success' : 'text-warning' },
                        { label: 'Failed',        value: dryRunData.failed_count,       color: dryRunData.failed_count > 0 ? 'text-destructive' : 'text-success' },
                      ].map(c => (
                        <div key={c.label} className="rounded-md border border-border bg-muted/20 p-2.5 text-center">
                          <p className="text-[10px] text-muted-foreground">{c.label}</p>
                          <p className={cn('text-lg font-bold tabular-nums', c.color)}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Totals from succeeded employees */}
                    {dryRunData.ok_count > 0 && (() => {
                      const ok = dryRunData.results.filter(r => r.status === 'ok')
                      const totalGross  = ok.reduce((s, r) => s + (r.result?.gross_pay ?? 0), 0)
                      const totalNet    = ok.reduce((s, r) => s + (r.result?.net_pay   ?? 0), 0)
                      const fmtR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
                      return (
                        <div className="flex gap-4 p-3 rounded-md bg-success/5 border border-success/20 text-xs">
                          <span className="text-muted-foreground">Projected Gross: <strong className="text-foreground">{fmtR(totalGross)}</strong></span>
                          <span className="text-muted-foreground">Projected Net: <strong className="text-success">{fmtR(totalNet)}</strong></span>
                        </div>
                      )
                    })()}

                    {/* Per-employee table */}
                    <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/80">
                          <tr className="border-b border-border">
                            {['Employee', 'Status', 'Gross', 'Net', 'LOP'].map(h => (
                              <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dryRunData.results.map(r => {
                            const fmtN = (n?: number) => n != null ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n) : '—'
                            return (
                              <tr key={r.employee_id} className={cn('border-b border-border/50', r.status === 'failed' && 'bg-destructive/5')}>
                                <td className="px-3 py-2 font-mono font-medium">{r.employee_code}</td>
                                <td className="px-3 py-2">
                                  {r.status === 'ok'
                                    ? <Badge variant="success"     className="rounded-full text-[9px]">OK</Badge>
                                    : <Badge variant="destructive" className="rounded-full text-[9px]">Failed</Badge>}
                                </td>
                                <td className="px-3 py-2 tabular-nums">{fmtN(r.result?.gross_pay)}</td>
                                <td className="px-3 py-2 tabular-nums">{fmtN(r.result?.net_pay)}</td>
                                <td className="px-3 py-2 tabular-nums">{r.result?.lop_days ?? '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Failed employee details */}
                    {dryRunData.failed_count > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-destructive">Failed employees:</p>
                        {dryRunData.results.filter(r => r.status === 'failed').map(r => (
                          <div key={r.employee_id} className="px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20 text-xs">
                            <span className="font-mono font-medium">{r.employee_code}</span>
                            {' — '}<span className="text-destructive">{r.error ?? r.failure_stage}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </SectionCard>

        {/* Runs List */}
        <div className="lg:col-span-2 space-y-3">
          <SectionCard
            title="Run History"
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          >
            {runsLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />Loading runs…
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                <DollarSign className="h-10 w-10 opacity-30" />
                <p className="text-sm">No payroll runs yet.</p>
                <p className="text-xs opacity-70">Use the panel on the left to process your first payroll.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {runs.map(run => (
                  <RunCard
                    key={run.id}
                    run={run}
                    onViewSlips={setActiveSlipsRun}
                    onViewVariance={setActiveVarianceRun}
                    onFinalizeRequest={(run) => { setRunError(''); setActiveFinalizeRun(run) }}
                    onFreezeRequest={(run) => setActiveFreezeRun(run)}
                    onReopenRequest={(run) => { setReopenReason(''); setActiveReopenRun(run) }}
                    finalizePending={finalizeMutation.isPending && finalizeMutation.variables === run.id}
                    freezePending={freezeMutation.isPending && freezeMutation.variables === run.id}
                    reopenPending={reopenMutation.isPending && (reopenMutation.variables as any)?.runId === run.id}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Slips panel overlay */}
      {activeSlipsRun && (
        <SlipsPanel
          run={activeSlipsRun}
          onClose={() => setActiveSlipsRun(null)}
        />
      )}

      {/* Variance dialog */}
      {activeVarianceRun && (
        <VarianceDialog
          run={activeVarianceRun}
          onClose={() => setActiveVarianceRun(null)}
        />
      )}

      {/* Phase 7 — Finalize confirmation (governance checkpoint) */}
      {activeFinalizeRun && (
        <FinalizeConfirmDialog
          run={activeFinalizeRun}
          onConfirm={() => finalizeMutation.mutate(activeFinalizeRun.id)}
          onCancel={() => { setActiveFinalizeRun(null); setRunError('') }}
          pending={finalizeMutation.isPending}
          errorMessage={runError || undefined}
        />
      )}

      {/* Force-override dialog — shown when backend blocks finalize due to missing attendance */}
      {forceOverrideRun && (
        <ForceOverrideDialog
          run={forceOverrideRun}
          missingEmployees={missingEmployees}
          overrideReason={overrideReason}
          onReasonChange={setOverrideReason}
          onConfirm={() => forceFinalizeMutation.mutate({
            runId:  forceOverrideRun.id,
            reason: overrideReason,
          })}
          onCancel={() => {
            setForceOverrideRun(null)
            setMissingEmployees([])
            setOverrideReason('')
          }}
          pending={forceFinalizeMutation.isPending}
        />
      )}

      {/* Phase 3 — Freeze period dialog */}
      {activeFreezeRun && (
        <FreezeRunDialog
          run={activeFreezeRun}
          onConfirm={() => freezeMutation.mutate(activeFreezeRun.id)}
          onCancel={() => setActiveFreezeRun(null)}
          pending={freezeMutation.isPending}
        />
      )}

      {/* Phase 3 — Reopen frozen period dialog (break-glass) */}
      {activeReopenRun && (
        <ReopenRunDialog
          run={activeReopenRun}
          reason={reopenReason}
          onReasonChange={setReopenReason}
          onConfirm={() => reopenMutation.mutate({ runId: activeReopenRun.id, reason: reopenReason })}
          onCancel={() => { setActiveReopenRun(null); setReopenReason('') }}
          pending={reopenMutation.isPending}
        />
      )}
    </PageContainer>
  )
}
