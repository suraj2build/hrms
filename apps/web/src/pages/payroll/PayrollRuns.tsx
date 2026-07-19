/**
 * PayrollRuns — /admin/payroll
 *
 * HR admin page for triggering payroll runs, viewing run history,
 * and drilling into individual employee pay slips.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState, useRef, useEffect }    from 'react'
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
import { Badge, type BadgeProps } from '@/components/ui/badge'
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
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import {
  IntelligenceLoadingSkeleton,
  IntelligenceEmptyState,
} from '@/components/ui/intelligence/index.js'
import {
  PFModeBadge,
  ESIStatusBadge,
  StatutoryExplainer,
  StatutorySummaryStrip,
  InfoTooltip,
  TooltipProvider,
  PF_MODE_TOOLTIP,
  ESI_STATUS_TOOLTIP,
  PF_MODE_EXPLAIN,
  ESI_STATUS_EXPLAIN,
  type PFMode,
  type ESIStatusType,
} from '@/components/payroll/StatutoryBadges'

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
  status:           'queued' | 'draft' | 'partial_failed' | 'processing' | 'finalized' | 'failed' | 'frozen' | 'reopened'
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
  // ── Processing progress (migration 378/379) ──────────────────────────────
  total_employee_count:     number | null
  processed_employee_count: number
  started_processing_at:    string | null
  last_heartbeat_at:        string | null
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

// ── Statutory contribution types (for slip detail statutory section) ─────────

interface EPFContributionRow {
  pf_wages:              number
  employee_contribution: number
  employer_pf:           number
  employer_eps:          number
  edli_contribution:     number
  is_capped:             boolean
}

interface ESIContributionRow {
  esi_wages:             number
  is_eligible:           boolean
  employee_contribution: number
  employer_contribution: number
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
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
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

const STATUS_BADGE: Record<string, BadgeProps['variant']> = {
  queued:         'secondary',
  draft:          'secondary',
  partial_failed: 'warning',
  processing:     'warning',
  finalized:      'success',
  failed:         'destructive',
  frozen:         'default',
  reopened:       'warning',
}

/** Human-readable status labels */
const STATUS_LABEL: Record<string, string> = {
  queued:         'Queued',
  draft:          'Draft',
  partial_failed: 'Partial',
  processing:     'Processing',
  finalized:      'Finalized',
  failed:         'Failed',
  frozen:         'Frozen',
  reopened:       'Reopened',
}

const SLIP_STATUS_BADGE: Record<string, BadgeProps['variant']> = {
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
    const sign = (n ?? 0) >= 0 ? '+' : ''
    return `${sign}${(n ?? 0).toFixed(1)}%`
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

  // Statutory detail — lazy-fetched per employee+month for PF mode + ESI status
  const { data: epfData } = useQuery<{ data: EPFContributionRow[] }>({
    queryKey: ['epf-contrib-slip', slip.employee_id, slip.month],
    queryFn:  () => api.get(`/payroll/statutory/epf/contributions?month=${slip.month}&employee_id=${slip.employee_id}`),
    staleTime: 120_000,
  })
  const { data: esiData } = useQuery<{ data: ESIContributionRow[] }>({
    queryKey: ['esi-contrib-slip', slip.employee_id, slip.month],
    queryFn:  () => api.get(`/payroll/statutory/esi/contributions?month=${slip.month}&employee_id=${slip.employee_id}`),
    staleTime: 120_000,
  })

  const epfRow = epfData?.data?.[0] ?? null
  const esiRow = esiData?.data?.[0] ?? null

  // Derive PF mode and ESI status from contribution records
  const pfMode: PFMode | null = epfRow
    ? (epfRow.is_capped ? 'capped' : 'actual')
    : null

  const esiStatus: ESIStatusType | null = esiRow
    ? (esiRow.is_eligible ? 'eligible' : 'not_applicable')
    : null

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
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(c => (
                      <tr key={c.salary_component_id} className="border-b border-border/40">
                        <td className="py-1.5 px-2 font-medium">{c.name}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{c.calc_type}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtCurrency(c.monthly_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* Statutory Deductions — EPF & ESI visibility */}
        {(epfRow || esiRow) && (
          <TooltipProvider>
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">

            {/* Compact summary strip */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Statutory Deductions
              </p>
              <StatutorySummaryStrip
                items={[
                  ...(pfMode ? [{ label: 'PF', value: pfMode === 'capped' ? 'Capped' : 'Actual', accent: false }] : []),
                  ...(esiStatus ? [{ label: 'ESI', value: esiStatus === 'eligible' ? 'Active' : 'N/A', accent: false }] : []),
                ]}
              />
            </div>

            {/* EPF section — only show detail when there's something to explain */}
            {epfRow && pfMode && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">EPF</span>
                  <PFModeBadge mode={pfMode} />
                  <InfoTooltip text={PF_MODE_TOOLTIP[pfMode]} />
                </div>
                {/* "Why?" explainer — only shown for exceptions */}
                {pfMode !== 'actual' && (
                  <p className="text-[10px] text-muted-foreground leading-snug pl-0.5">
                    {PF_MODE_EXPLAIN[pfMode]}
                  </p>
                )}
                <div className="space-y-1 pl-0.5">
                  <StatutoryExplainer
                    label="PF Wage Basis"
                    value={`${fmtCurrency(epfRow.pf_wages)}${epfRow.is_capped ? ' (capped)' : ''}`}
                    tooltip="Wages on which PF is calculated. May differ from gross pay when HRA or other non-PF components are excluded."
                  />
                  <StatutoryExplainer label="Employee PF"  value={fmtCurrency(epfRow.employee_contribution)} />
                  <StatutoryExplainer label="Employer EPF" value={fmtCurrency(epfRow.employer_pf)}          muted tooltip="Employer's PF contribution (3.67% of PF wages, ceiling-capped)." />
                  <StatutoryExplainer label="Employer EPS" value={fmtCurrency(epfRow.employer_eps)}         muted tooltip="Employees' Pension Scheme — 8.33% of PF wages, always capped at ₹15,000." />
                  {epfRow.edli_contribution > 0 && (
                    <StatutoryExplainer label="EDLI" value={fmtCurrency(epfRow.edli_contribution)} muted tooltip="Employees' Deposit Linked Insurance — 0.5% of PF wages, max ₹75/month." />
                  )}
                </div>
              </div>
            )}

            {epfRow && esiRow && <div className="border-t border-border/40" />}

            {/* ESI section */}
            {esiRow && esiStatus && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">ESI</span>
                  <ESIStatusBadge status={esiStatus} />
                  <InfoTooltip text={ESI_STATUS_TOOLTIP[esiStatus]} />
                </div>
                {/* "Why?" explainer for exceptions only */}
                {esiStatus === 'not_applicable' && (
                  <p className="text-[10px] leading-snug pl-0.5 text-muted-foreground">
                    {ESI_STATUS_EXPLAIN[esiStatus]}
                  </p>
                )}
                {esiRow.is_eligible ? (
                  <div className="space-y-1 pl-0.5">
                    <StatutoryExplainer label="ESI Wage Basis"  value={fmtCurrency(esiRow.esi_wages)}             tooltip="Gross wages on which ESI is calculated — should equal gross pay for ESI-eligible employees." />
                    <StatutoryExplainer label="Employee ESI"    value={fmtCurrency(esiRow.employee_contribution)} />
                    <StatutoryExplainer label="Employer ESI"    value={fmtCurrency(esiRow.employer_contribution)} muted tooltip="Employer ESI at 3.25% of ESI wages." />
                  </div>
                ) : null}
              </div>
            )}
          </div>
          </TooltipProvider>
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
            <div className="px-4 pt-4">
              <IntelligenceLoadingSkeleton rows={6} />
            </div>
          ) : slips.length === 0 ? (
            <IntelligenceEmptyState
              title="No slips found"
              description="No pay slips match your search criteria for this run."
            />
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
                      <Badge variant={SLIP_STATUS_BADGE[slip.status]} className="rounded-full text-[10px]">
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

// ── EmployeeSelectorMulti ─────────────────────────────────────────────────────
// Multi-select wrapper used by the scoped dry run dialog.

function EmployeeSelectorMulti({
  value,
  onChange,
}: {
  value:    string[]
  onChange: (v: string[]) => void
}) {
  return (
    <EmployeeSelector
      value={value}
      onChange={(v) => onChange(Array.isArray(v) ? v : v ? [v] : [])}
      multiple
      placeholder="Search and select employees…"
      className="w-full"
    />
  )
}

// ── ProcessingProgressBar ─────────────────────────────────────────────────────
// Full-card live progress display while a run is computing.
// Shows batch-by-batch status, animated counter, and ETA.

const BATCH_SIZE = 500

function fmtEta(sec: number): string {
  if (sec < 60)  return `~${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`
}

function ProcessingProgressBar({ run }: { run: PayrollRun }) {
  const total       = run.total_employee_count ?? run.employee_count ?? 0
  const serverCount = run.processed_employee_count ?? 0

  // Animated display counter — ticks smoothly from prev known value to new one
  const displayRef  = useRef(serverCount)
  const [display, setDisplay] = useState(serverCount)
  const rafRef      = useRef<number | null>(null)

  useEffect(() => {
    const from = displayRef.current
    const to   = serverCount
    if (from === to) return

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    const steps    = Math.max(1, Math.abs(to - from))
    const duration = Math.min(4500, steps * 15)  // 15 ms/employee, cap 4.5 s
    const startTs  = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTs) / duration)
      const cur = Math.round(from + (to - from) * progress)
      // Keep ref in sync on every frame so a mid-animation poll starts from the
      // current visual position, not the last completed target (prevents backward jumps).
      displayRef.current = cur
      setDisplay(cur)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [serverCount])

  const numBatches    = Math.max(1, Math.ceil(total / BATCH_SIZE))
  const overallPct    = total > 0 ? Math.min(100, Math.round((display / total) * 100)) : 0

  // Active batch = the batch that contains the displayed count
  const activeBatchIdx = total > 0 ? Math.min(numBatches - 1, Math.floor(display / BATCH_SIZE)) : 0
  const activeBatchStart = activeBatchIdx * BATCH_SIZE
  const activeBatchEnd   = Math.min((activeBatchIdx + 1) * BATCH_SIZE, total)
  const activeBatchSize  = activeBatchEnd - activeBatchStart
  const activeBatchDone  = Math.max(0, display - activeBatchStart)
  const activeBatchPct   = activeBatchSize > 0
    ? Math.min(100, Math.round((activeBatchDone / activeBatchSize) * 100))
    : 0

  // ETA based on server-side count (not display)
  const startedAt = run.started_processing_at ? new Date(run.started_processing_at).getTime() : null
  const elapsedMs = startedAt ? Date.now() - startedAt : null
  const rate      = elapsedMs && serverCount > 0 ? serverCount / elapsedMs : null
  const etaSec    = rate && total > serverCount ? Math.ceil((total - serverCount) / rate / 1000) : null

  // Zombie detection: prefer last_heartbeat_at (updated every 5 s by the server).
  // A heartbeat older than 3 min means the job died without cleaning up.
  // Fall back to elapsed-time heuristic when heartbeat has never been written.
  const heartbeatAt  = run.last_heartbeat_at ? new Date(run.last_heartbeat_at).getTime() : null
  const heartbeatAge = heartbeatAt ? (Date.now() - heartbeatAt) / 60_000 : null
  const elapsedMin   = startedAt ? (Date.now() - startedAt) / 60_000 : 0
  const isLikelyZombie = total > 0 && (
    heartbeatAge !== null ? heartbeatAge > 3 : (elapsedMin > 10 && serverCount === 0)
  )

  if (isLikelyZombie) {
    return (
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Run may be stuck</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Processing started {Math.floor(elapsedMin)} min ago but no progress has been recorded.
            The server may have restarted — it will auto-recover on next deploy, or re-trigger the run.
          </p>
        </div>
      </div>
    )
  }

  // total = 0 means the run just started and backend hasn't written the count yet
  if (total === 0) {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Initialising payroll run…</p>
          <div className="h-2 rounded-full bg-primary/40 animate-pulse" />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
          <span>Fetching employee list — first update in a moment</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Batch status pills ─────────────────────────────────────────── */}
      {numBatches > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: numBatches }, (_, i) => {
            const bStart = i * BATCH_SIZE
            const bEnd   = Math.min((i + 1) * BATCH_SIZE, total)
            const bDone  = Math.max(0, Math.min(display - bStart, bEnd - bStart))
            const isDone = bDone >= (bEnd - bStart)
            const isActive = i === activeBatchIdx && !isDone

            return (
              <span
                key={i}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all',
                  isDone
                    ? 'bg-success/15 border-success/30 text-success'
                    : isActive
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-muted/50 border-border text-muted-foreground',
                )}
              >
                {isDone
                  ? <><CheckCircle2 className="h-2.5 w-2.5" /> B{i + 1} ✓</>
                  : isActive
                  ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Batch {i + 1}</>
                  : <>○ B{i + 1}</>
                }
              </span>
            )
          })}
        </div>
      )}

      {/* ── Active batch progress bar ──────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">
            {numBatches > 1
              ? `Batch ${activeBatchIdx + 1} of ${numBatches}`
              : 'Processing employees'}
          </span>
          <span className="font-mono font-bold text-primary tabular-nums">
            {activeBatchDone.toLocaleString()}
            <span className="font-normal text-muted-foreground">
              /{activeBatchSize.toLocaleString()}
            </span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${activeBatchPct}%` }}
          />
        </div>
      </div>

      {/* ── Overall progress ────────────────────────────────────────────── */}
      {numBatches > 1 && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/40 transition-[width] duration-300"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      )}

      {/* ── Summary row ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
          <span className="tabular-nums">
            <strong className="text-foreground font-mono">{display.toLocaleString()}</strong>
            {' '}/ {total.toLocaleString()} employees
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{overallPct}%</span>
          {etaSec !== null && etaSec > 0 && (
            <span>{fmtEta(etaSec)} left</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── DryRunProgressView ───────────────────────────────────────────────────────
// Simulated progress for dry run API calls (synchronous — no server feedback).
// Uses elapsed time + estimated rate to animate the counter visually.
// Caps at 93% so it never reaches 100% before the response arrives.

function DryRunProgressView({ total }: { total: number | null }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!total) return
    // For small tenants (≤10 employees) the run finishes in under a second, so
    // animate to the full count — false-100% window is imperceptible.
    // For larger runs cap at 93% so the bar never falsely shows completion.
    const cap     = total <= 10 ? total : Math.floor(total * 0.93)
    const rateMs  = 80  // ~80 ms per employee at ~10× concurrency
    const startTs = performance.now()

    const tick = (now: number) => {
      const cur = Math.min(cap, Math.floor((now - startTs) / rateMs))
      setDisplay(cur)
      if (cur < cap) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [total])

  // Indeterminate only when total is unknown (full dry run before any run history exists)
  if (!total) {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Simulating payroll…</p>
          <div className="h-2 rounded-full bg-primary/40 animate-pulse" />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
          <span>Processing all employees — no DB writes</span>
        </div>
      </div>
    )
  }

  const cap        = total <= 10 ? total : Math.floor(total * 0.93)
  const numBatches = Math.max(1, Math.ceil(total / BATCH_SIZE))
  const overallPct = total > 0 ? Math.round((display / total) * 100) : 0
  const activeBatchIdx = Math.min(numBatches - 1, Math.floor(display / BATCH_SIZE))
  const activeBatchStart = activeBatchIdx * BATCH_SIZE
  const activeBatchEnd   = Math.min((activeBatchIdx + 1) * BATCH_SIZE, total)
  const activeBatchSize  = activeBatchEnd - activeBatchStart
  const activeBatchDone  = Math.max(0, display - activeBatchStart)
  const activeBatchPct   = activeBatchSize > 0
    ? Math.round((activeBatchDone / activeBatchSize) * 100)
    : 0

  return (
    <div className="space-y-3">
      {/* Batch pills */}
      {numBatches > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: numBatches }, (_, i) => {
            const bStart  = i * BATCH_SIZE
            const bEnd    = Math.min((i + 1) * BATCH_SIZE, total)
            const bDone   = Math.max(0, Math.min(display - bStart, bEnd - bStart))
            const isDone   = bDone >= (bEnd - bStart)
            const isActive = i === activeBatchIdx && !isDone
            return (
              <span key={i} className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all',
                isDone    ? 'bg-success/15 border-success/30 text-success'
                : isActive ? 'bg-primary/10 border-primary/40 text-primary'
                : 'bg-muted/50 border-border text-muted-foreground',
              )}>
                {isDone
                  ? <><CheckCircle2 className="h-2.5 w-2.5" /> B{i + 1} ✓</>
                  : isActive
                  ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Batch {i + 1}</>
                  : <>○ B{i + 1}</>
                }
              </span>
            )
          })}
        </div>
      )}

      {/* Active batch progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">
            {numBatches > 1 ? `Batch ${activeBatchIdx + 1} of ${numBatches}` : 'Simulating employees'}
          </span>
          <span className="font-mono font-bold text-primary tabular-nums">
            {activeBatchDone.toLocaleString()}
            <span className="font-normal text-muted-foreground">/{activeBatchSize.toLocaleString()}</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${activeBatchPct}%` }}
          />
        </div>
      </div>

      {/* Overall thin bar */}
      {numBatches > 1 && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/40 transition-[width] duration-150"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      )}

      {/* Summary row */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
          <span className="tabular-nums">
            <strong className="text-foreground font-mono">{display.toLocaleString()}</strong>
            {' '}/ {total.toLocaleString()} simulated · no DB writes
          </span>
        </div>
        <span className="font-mono font-semibold text-foreground">{overallPct}%</span>
      </div>
    </div>
  )
}

// ── RunLifecycleBar ───────────────────────────────────────────────────────────
// Phase 2: Payroll lifecycle clarity — visual pipeline for each run card.
// Maps the 4 backend statuses onto a 4-step governance pipeline.

function RunLifecycleBar({ run }: { run: PayrollRun }) {
  if (run.status === 'processing') {
    return <ProcessingProgressBar run={run} />
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
// Shown when finalization is blocked by a bypass-able gate:
//   MISSING_ATTENDANCE_DATA — some employees have no attendance records
//   ATTENDANCE_NOT_LOCKED   — attendance period is still open (not closed)
//   OPEN_BLOCKERS           — unresolved payroll run blockers exist
// All overrides are persisted to payroll_finalize_overrides (SOX audit trail).

const BYPASS_COPY: Record<string, { title: string; body: string; placeholder: string }> = {
  MISSING_ATTENDANCE_DATA: {
    title:       'Bypass — Missing Attendance Data',
    body:        'Some employees have no processed attendance records. They will receive full pay (0 LOP assumed). This override is audit-logged.',
    placeholder: 'e.g. Attendance system was down — verified manually with managers',
  },
  ATTENDANCE_NOT_LOCKED: {
    title:       'Bypass — Attendance Period Not Locked',
    body:        'The attendance period for this month is still open. Locking it first is recommended to prevent last-minute punch changes from affecting pay. Bypassing will finalize with current data.',
    placeholder: 'e.g. Period lock is delayed; all anomalies verified and accepted by HR',
  },
  OPEN_BLOCKERS: {
    title:       'Bypass — Open Payroll Blockers',
    body:        'There are unresolved blockers on this payroll run (validation failures, coverage issues, etc.). Bypassing will finalize despite these — they will be audit-logged.',
    placeholder: 'e.g. Blockers reviewed and accepted — minor edge cases not affecting payroll accuracy',
  },
}

function ForceOverrideDialog({
  run,
  errorCode,
  missingEmployees,
  overrideReason,
  onReasonChange,
  onConfirm,
  onCancel,
  pending,
}: {
  run:              PayrollRun
  errorCode:        string
  missingEmployees: MissingAttendanceEmployee[]
  overrideReason:   string
  onReasonChange:   (v: string) => void
  onConfirm:        () => void
  onCancel:         () => void
  pending:          boolean
}) {
  const reasonTooShort = overrideReason.trim().length < 10
  const copy = BYPASS_COPY[errorCode] ?? BYPASS_COPY.OPEN_BLOCKERS

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {copy.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="p-3 rounded-md bg-warning/10 border border-warning/20 text-warning text-xs">
            <p className="font-semibold mb-1">{fmtMonth(run.month)}</p>
            <p>{copy.body}</p>
          </div>

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
              placeholder={copy.placeholder}
              value={overrideReason}
              onChange={e => onReasonChange(e.target.value)}
              disabled={pending}
            />
            {reasonTooShort && overrideReason.length > 0 && (
              <p className="text-[10px] text-destructive mt-1">Please provide at least 10 characters.</p>
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
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
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
  onRerunRequest,
  finalizePending,
  freezePending,
  reopenPending,
  rerunPending,
}: {
  run:               PayrollRun
  onViewSlips:       (r: PayrollRun) => void
  onFinalizeRequest: (r: PayrollRun) => void
  onViewVariance:    (r: PayrollRun) => void
  onFreezeRequest:   (r: PayrollRun) => void
  onReopenRequest:   (r: PayrollRun) => void
  onRerunRequest:    (r: PayrollRun) => void
  finalizePending:   boolean
  freezePending:     boolean
  reopenPending:     boolean
  rerunPending:      boolean
}) {
  const navigate     = useNavigate()
  const heldCount    = run.held_count    ?? 0
  const warningCount = run.warning_count ?? 0
  const isQueued     = run.status === 'queued'
  const isProcessing = run.status === 'processing'
  const isActive     = isQueued || isProcessing

  return (
    <div className={cn(
      'p-4 rounded-lg border bg-card space-y-3',
      isActive ? 'border-primary/30 bg-primary/[0.02]' : 'border-border',
    )}>

      {/* Header row: month + status badge + held/warning chips */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{fmtMonth(run.month)}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {(run.total_employee_count ?? run.employee_count ?? 0).toLocaleString()} employee{(run.total_employee_count ?? run.employee_count ?? 0) !== 1 ? 's' : ''}
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
          <Badge variant={STATUS_BADGE[run.status]} className="rounded-full text-xs capitalize">
            {STATUS_LABEL[run.status] ?? run.status}
          </Badge>
        </div>
      </div>

      {/* Queued: waiting for the background worker to pick up the job */}
      {isQueued && (
        <div className="space-y-2">
          <div className="h-2 rounded-full bg-primary/30 animate-pulse" />
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0" />
            <span>Queued — waiting for worker to start…</span>
          </div>
        </div>
      )}

      {/* Processing: full live progress panel */}
      {isProcessing && <ProcessingProgressBar run={run} />}

      {/* All other statuses: lifecycle pipeline */}
      {!isActive && <RunLifecycleBar run={run} />}

      {/* Completion summary for draft/partial_failed/failed — show totals clearly */}
      {(run.status === 'draft' || run.status === 'partial_failed' || run.status === 'failed') &&
       (run.total_employee_count ?? 0) > 0 && (() => {
        const total   = run.total_employee_count ?? 0
        const success = run.employee_count ?? 0
        const failed  = run.failure_summary?.total_failed ?? 0
        return (
          <div className="grid grid-cols-3 gap-1.5">
            <div className="p-2 rounded-md bg-success/10 border border-success/20 text-center">
              <p className="text-[9px] text-muted-foreground mb-0.5">Completed</p>
              <p className="text-sm font-bold text-success tabular-nums">{success.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-md bg-destructive/10 border border-destructive/20 text-center">
              <p className="text-[9px] text-muted-foreground mb-0.5">Failed</p>
              <p className="text-sm font-bold text-destructive tabular-nums">{failed.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/40 border border-border text-center">
              <p className="text-[9px] text-muted-foreground mb-0.5">Total</p>
              <p className="text-sm font-bold text-foreground tabular-nums">{total.toLocaleString()}</p>
            </div>
          </div>
        )
      })()}

      {/* Financials — hidden while processing (all zeros), shown once complete */}
      {!isProcessing && (
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
      )}

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

        {/* Failed + partial_failed: Re-run button */}
        {(run.status === 'failed' || run.status === 'partial_failed') && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 flex-1 border-primary/40 text-primary hover:bg-primary/5"
            disabled={rerunPending}
            onClick={() => onRerunRequest(run)}
          >
            {rerunPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />
            }
            Re-run
          </Button>
        )}

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
              {(() => { const _s = ev.time; const _dt = new Date(_s.length === 10 ? _s + 'T12:00:00Z' : _s); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_dt.getTime()) ? '—' : `${String(_dt.getUTCDate()).padStart(2,'0')}-${_M[_dt.getUTCMonth()]}-${_dt.getUTCFullYear()}` })()}
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

  // Force-finalize state: populated when backend returns a bypass-able error
  const [forceOverrideRun, setForceOverrideRun]       = useState<PayrollRun | null>(null)
  const [forceOverrideCode, setForceOverrideCode]     = useState<'MISSING_ATTENDANCE_DATA' | 'ATTENDANCE_NOT_LOCKED' | 'OPEN_BLOCKERS' | ''>('')
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
    dry_run:                      boolean
    scoped:                       boolean
    fetch_method?:                'rpc' | 'range_fallback' | 'scoped_in'
    api_commit?:                  string
    month:                        string
    tenant_id:                    string
    employee_count:               number
    active_employees_in_system:   number
    total_employees_in_system:    number
    total_working_days:           number
    ok_count:                     number
    failed_count:                 number
    warnings?:                    string[]
    results:                      DryRunEmployeeResult[]
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
      (e instanceof Error ? e.message : undefined) ?? 'Dry run failed',
    ),
  })

  // ── Selected-employees dry run ───────────────────────────────────────────────
  const [scopedDryRunOpen, setScopedDryRunOpen] = useState(false)
  const [scopedEmpIds, setScopedEmpIds]         = useState<string[]>([])
  const scopedDryRunMutation = useMutation({
    mutationFn: (empIds: string[]) =>
      api.post('/payroll/runs', { month: runMonth, dry_run: true, employee_ids: empIds }) as Promise<DryRunData>,
    onSuccess: (data: DryRunData) => {
      setScopedDryRunOpen(false)
      setScopedEmpIds([])
      setDryRunData(data)
      setDryRunOpen(true)
    },
    onError: (e: unknown) => toast.error(
      (e instanceof Error ? e.message : undefined) ?? 'Scoped dry run failed',
    ),
  })

  // ── Re-run a failed/partial-failed run ──────────────────────────────────────
  const rerunMutation = useMutation({
    mutationFn: (month: string) => api.post('/payroll/runs', { month }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Payroll re-run triggered')
    },
    onError: (e: unknown) => toast.error(
      (e instanceof Error ? e.message : undefined) ?? 'Re-run failed',
    ),
  })

  // ── Runs list — auto-polls every 5 s while any run is processing ───────────
  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery<{
    data: PayrollRun[]; total: number
  }>({
    queryKey: ['payroll-runs'],
    queryFn:  () => api.get('/payroll/runs?limit=20&offset=0'),
    enabled:  isAdmin,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const runs = (query.state.data as { data: PayrollRun[] } | undefined)?.data ?? []
      // Poll while any run is queued (waiting for worker) or actively processing
      return runs.some(r => r.status === 'queued' || r.status === 'processing') ? 5000 : false
    },
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
    onError: (e: unknown) => setRunError(e instanceof Error ? e.message : 'Failed to trigger payroll run'),
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
      const code = e instanceof ApiError ? (e.error as string) : ''
      if (code === 'MISSING_ATTENDANCE_DATA' || code === 'ATTENDANCE_NOT_LOCKED' || code === 'OPEN_BLOCKERS') {
        const employees = code === 'MISSING_ATTENDANCE_DATA'
          ? ((e as ApiError).data?.missing_attendance_employees as MissingAttendanceEmployee[] | undefined) ?? []
          : []
        setMissingEmployees(employees)
        setOverrideReason('')
        setForceOverrideCode(code as 'MISSING_ATTENDANCE_DATA' | 'ATTENDANCE_NOT_LOCKED' | 'OPEN_BLOCKERS')
        setForceOverrideRun(activeFinalizeRun)
        setActiveFinalizeRun(null)
        setRunError('')
      } else {
        setRunError(e instanceof Error ? e.message : 'Failed to finalize run')
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
      toast.error(e instanceof Error ? e.message : 'Force-finalize failed — please retry')
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
      toast.error(e instanceof Error ? e.message : 'Failed to freeze period')
    },
  })

  // ── Reopen run (frozen → reopened) ───────────────────────────────────────────
  const reopenMutation = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      api.post(`/payroll/runs/${runId}/rollback`, { reason }),
    onSuccess: () => {
      setActiveReopenRun(null)
      setReopenReason('')
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      toast.success('Period reopened — audit entry recorded', {
        description: 'Trigger a new correction run for this month.',
      })
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'Failed to reopen period')
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
                  disabled={runMonth >= todayYM}
                  onClick={() => setRunMonth(nextMonthStr(runMonth))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {runMonth > todayYM && (
                <p className="text-[10px] text-destructive flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3 w-3 flex-shrink-0" />
                  Future month — payroll cannot be run for upcoming periods
                </p>
              )}
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
                disabled={triggerMutation.isPending || dryRunMutation.isPending || runMonth > todayYM}
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

            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              disabled={scopedDryRunMutation.isPending}
              onClick={() => { setScopedEmpIds([]); setScopedDryRunOpen(true) }}
            >
              <Users className="h-3.5 w-3.5" />
              Run for Selected Employees…
            </Button>

            <p className="text-[10px] text-muted-foreground">
              <strong>Dry Run</strong> simulates payroll without any DB writes — safe to run anytime.
              Re-running for the same month will replace the existing draft run. Finalized runs cannot be replaced.
            </p>

            {/* ── Scoped Dry Run Dialog ─────────────────────────────────────── */}
            <Dialog open={scopedDryRunOpen} onOpenChange={scopedDryRunMutation.isPending ? undefined : setScopedDryRunOpen}>
              <DialogContent className="max-w-md" onInteractOutside={scopedDryRunMutation.isPending ? (e) => e.preventDefault() : undefined}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-primary" />
                    {scopedDryRunMutation.isPending ? `Simulating — ${scopedEmpIds.length} Employees` : 'Dry Run — Selected Employees'}
                  </DialogTitle>
                </DialogHeader>

                {scopedDryRunMutation.isPending ? (
                  <div className="space-y-4 py-2">
                    <DryRunProgressView total={scopedEmpIds.length} />
                    <p className="text-[10px] text-muted-foreground text-center">
                      Simulating payroll for {scopedEmpIds.length} employee{scopedEmpIds.length !== 1 ? 's' : ''} — no data will be written.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Month: {fmtMonth(runMonth)}
                      </label>
                      <p className="text-[10px] text-muted-foreground">
                        Search and select employees to include in this scoped dry run.
                        Up to 500 employees can be selected.
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Employees ({scopedEmpIds.length} selected)
                      </label>
                      <EmployeeSelectorMulti
                        value={scopedEmpIds}
                        onChange={setScopedEmpIds}
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => setScopedDryRunOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5"
                        disabled={scopedEmpIds.length === 0}
                        onClick={() => scopedDryRunMutation.mutate(scopedEmpIds)}
                      >
                        <Search className="h-3.5 w-3.5" />Run Dry Run
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* ── Full Dry Run Progress Dialog ───────────────────────────────── */}
            {(() => {
              // Best estimate of employee count: use most recent run that has a known total.
              // Totals ≤ 5 are ignored — they come from previously-broken runs and make the
              // progress bar lie ("1/1 · 100%") while thousands of employees are processing.
              const knownTotal = runs
                .map(r => r.total_employee_count ?? r.employee_count ?? 0)
                .find(n => n > 5) ?? null
              return (
            <Dialog open={dryRunMutation.isPending} onOpenChange={() => {}}>
              <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <Search className="h-4 w-4 text-primary" />
                    Dry Run — {fmtMonth(runMonth)}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <DryRunProgressView total={knownTotal} />
                  <p className="text-[10px] text-muted-foreground text-center">
                    Simulating payroll for all employees — no data will be written.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
              )
            })()}

            {/* ── Dry Run Results Dialog ─────────────────────────────────────── */}
            <Dialog open={dryRunOpen} onOpenChange={setDryRunOpen}>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <Search className="h-4 w-4 text-primary" />
                    Dry Run Results — {dryRunData ? fmtMonth(dryRunData.month) : ''}
                  </DialogTitle>
                </DialogHeader>
                {dryRunData && (
                  <div className="space-y-3">
                    {/* Warnings from server — e.g. most employees are not 'active' */}
                    {dryRunData.warnings && dryRunData.warnings.length > 0 && (
                      <div className="space-y-1.5">
                        {dryRunData.warnings.map((w, i) => (
                          <div key={i} className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-warning" />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Batch completion pills — all green since done */}
                    {Math.ceil(dryRunData.employee_count / BATCH_SIZE) > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: Math.ceil(dryRunData.employee_count / BATCH_SIZE) }, (_, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border bg-success/15 border-success/30 text-success">
                            <CheckCircle2 className="h-2.5 w-2.5" /> B{i + 1} ✓
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Completion summary — matches live run style */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2.5 rounded-md bg-success/10 border border-success/20 text-center">
                        <p className="text-[9px] text-muted-foreground mb-0.5">Succeeded</p>
                        <p className={cn('text-lg font-bold tabular-nums', dryRunData.ok_count === dryRunData.employee_count ? 'text-success' : 'text-warning')}>
                          {dryRunData.ok_count.toLocaleString()}
                        </p>
                      </div>
                      <div className={cn('p-2.5 rounded-md text-center border', dryRunData.failed_count > 0 ? 'bg-destructive/10 border-destructive/20' : 'bg-muted/40 border-border')}>
                        <p className="text-[9px] text-muted-foreground mb-0.5">Failed</p>
                        <p className={cn('text-lg font-bold tabular-nums', dryRunData.failed_count > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                          {dryRunData.failed_count.toLocaleString()}
                        </p>
                      </div>
                      <div className="p-2.5 rounded-md bg-muted/40 border border-border text-center">
                        <p className="text-[9px] text-muted-foreground mb-0.5">Active · {dryRunData.total_working_days}d</p>
                        <p className="text-lg font-bold tabular-nums text-foreground">
                          {dryRunData.employee_count.toLocaleString()}
                        </p>
                        {dryRunData.total_employees_in_system > dryRunData.employee_count && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            of {dryRunData.total_employees_in_system.toLocaleString()} total
                          </p>
                        )}
                      </div>
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

                    {/* CRITICAL: Suspiciously low employee count on a FULL run — scoped runs are excluded */}
                    {!dryRunData.scoped && dryRunData.employee_count <= 5 && (
                      <div className="rounded-md border-2 border-destructive bg-destructive/10 px-4 py-3">
                        <div className="flex items-center gap-2 font-semibold text-destructive text-sm mb-2">
                          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                          Only {dryRunData.employee_count} employee(s) processed — this is wrong
                        </div>
                        <dl className="text-xs space-y-1 font-mono bg-muted/60 rounded px-3 py-2">
                          <div className="flex gap-2"><dt className="text-muted-foreground min-w-[180px]">Fetched by fetchAllRows:</dt><dd className="font-bold text-destructive">{dryRunData.employee_count}</dd></div>
                          <div className="flex gap-2"><dt className="text-muted-foreground min-w-[180px]">Direct active count (HEAD):</dt><dd className="font-bold">{dryRunData.active_employees_in_system}</dd></div>
                          <div className="flex gap-2"><dt className="text-muted-foreground min-w-[180px]">Total all statuses (HEAD):</dt><dd className="font-bold">{dryRunData.total_employees_in_system}</dd></div>
                          <div className="flex gap-2"><dt className="text-muted-foreground min-w-[180px]">Tenant ID:</dt><dd className="break-all">{dryRunData.tenant_id}</dd></div>
                          <div className="flex gap-2"><dt className="text-muted-foreground min-w-[180px]">Fetch method:</dt><dd className="font-bold">{dryRunData.fetch_method ?? 'unknown (old API)'}</dd></div>
                          <div className="flex gap-2"><dt className="text-muted-foreground min-w-[180px]">API version:</dt><dd>{dryRunData.api_commit ?? 'unknown'}</dd></div>
                        </dl>
                        <p className="text-[10px] text-muted-foreground mt-2">
                          {!dryRunData.fetch_method
                            ? 'Fetch method missing — Railway is still running an OLD deployment. Wait for the deploy to finish and re-run.'
                            : dryRunData.fetch_method === 'range_fallback'
                              ? 'DB function get_active_employees_for_payroll is NOT installed — run migration 380 in the Supabase SQL Editor, then re-run.'
                              : 'Fetched via DB function (rpc) yet the count is still low — check Railway logs for payroll_dry_run_critical_low_employee_count.'}
                        </p>
                      </div>
                    )}

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
                {dryRunData && (dryRunData.scoped || dryRunData.employee_count > 5) && (
                  <p className="text-[9px] text-muted-foreground/40 text-right font-mono mt-1">
                    tenant: {dryRunData.tenant_id}
                  </p>
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
              <IntelligenceLoadingSkeleton rows={4} />
            ) : runs.length === 0 ? (
              <IntelligenceEmptyState
                title="No payroll runs yet"
                description="Use the panel on the left to process your first payroll run."
              />
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
                    onRerunRequest={(run) => rerunMutation.mutate(run.month)}
                    finalizePending={finalizeMutation.isPending && finalizeMutation.variables === run.id}
                    freezePending={freezeMutation.isPending && freezeMutation.variables === run.id}
                    reopenPending={reopenMutation.isPending && reopenMutation.variables?.runId === run.id}
                    rerunPending={rerunMutation.isPending && rerunMutation.variables === run.month}
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

      {/* Force-override dialog — shown when backend blocks finalize with a bypass-able error */}
      {forceOverrideRun && (
        <ForceOverrideDialog
          run={forceOverrideRun}
          errorCode={forceOverrideCode}
          missingEmployees={missingEmployees}
          overrideReason={overrideReason}
          onReasonChange={setOverrideReason}
          onConfirm={() => forceFinalizeMutation.mutate({
            runId:  forceOverrideRun.id,
            reason: overrideReason,
          })}
          onCancel={() => {
            setForceOverrideRun(null)
            setForceOverrideCode('')
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
