/**
 * Payroll Investigation Workspace — Phase 2
 * /admin/payroll/investigate?employee_id=UUID&month=YYYY-MM
 *
 * Single-pane explainable payroll investigation for one employee × one month.
 * Shows: attendance summary, leave impact, OT contribution, corrections,
 *        payroll diff, anomalies, recompute history, explainability ledger,
 *        payroll blockers, and month-over-month variance.
 *
 * Can be reached from:
 *   - PayrollRuns → per-employee slip → "Investigate"
 *   - InvestigationPanel → employee card → "Investigate Payroll"
 *   - WorkforceAnalytics → reliability/absenteeism drill-down → payroll link
 */

import { useState }           from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery }            from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, Users, Calendar,
  TrendingDown, TrendingUp, ArrowLeft, FileText, Activity,
  ChevronDown, ChevronUp, BookOpen, ShieldAlert,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttSummary {
  total_days: number; payable_days: number; lop_days: number
  present_days: number; late_days: number; absent_days: number
  leave_days: number; holiday_days: number; half_days: number
  total_work_hours: number; total_ot_hours: number; total_late_minutes: number
}

interface Leave {
  id: string; from_date: string; to_date: string; status: string
  approved_at: string | null; leave_type: string | null; is_paid: boolean
}

interface Correction {
  id: string; date: string; reason: string; status: string
  approved_at: string | null
  requested_check_in: string | null; requested_check_out: string | null
}

interface Anomaly {
  id: string; date: string; type: string; severity: string
  message: string; resolved: boolean
}

interface AuditEntry {
  id: string; date: string; source: string
  before_status: string | null; after_status: string
  created_at: string
}

interface PayrollSlip {
  id: string; gross_pay: number; lop_amount: number
  total_deductions: number; net_pay: number
  payable_days: number; lop_days: number; total_working_days: number
  overtime_hours: number; ctc_monthly: number; status: string
  component_breakdown?: ComponentSnapshot[]
  held_reason?: string | null; warning?: string | null
  month?: string
  payroll_runs?: { id: string; month: string; status: string; finalized_at: string | null }
}

interface ComponentSnapshot {
  name: string; code: string; component_type: string
  calc_type: string; value: number; monthly_amount: number
}

interface LedgerEntry {
  id: string; event_type: string; event_description: string
  impact_type: string | null; impact_amount: number | null
  before_value: string | null; after_value: string | null
  source_entity_type: string | null; source_entity_id: string | null
  created_at: string; created_by_name: string | null
}

interface Variance {
  net_pay_diff: number; gross_pay_diff: number; deductions_diff: number
  lop_days_diff: number; payable_days_diff: number; ot_hours_diff: number
  lop_amount_diff: number; prev_month: string
}

interface InvestigationData {
  employee: { id: string; name: string; code: string; department: string | null; designation: string | null }
  month: string; range: { from: string; to: string }
  attendance: AttSummary
  leaves:           Leave[]
  corrections:      Correction[]
  anomalies:        Anomaly[]
  recompute_history: AuditEntry[]
  current_slip:     PayrollSlip | null
  prev_slip:        (PayrollSlip & { month: string }) | null
  variance:         Variance | null
  blocker:          { is_blocked: boolean; reasons: string[] }
  ledger:           LedgerEntry[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
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

const SEVERITY_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  high: 'destructive', medium: 'warning', low: 'secondary',
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  attendance_recomputed: 'Recomputed',
  correction_approved:   'Correction',
  leave_deducted:        'Leave',
  ot_added:              'Overtime',
  policy_changed:        'Policy',
  retro_adjustment:      'Retro',
  payable_days_changed:  'Days Changed',
  lop_applied:           'LOP Applied',
  payroll_computed:      'Payroll Run',
  payroll_finalized:     'Finalized',
  anomaly_resolved:      'Anomaly',
  manual_note:           'Note',
}

const EVENT_TYPE_COLOR: Record<string, string> = {
  attendance_recomputed: 'text-info',
  correction_approved:   'text-success',
  leave_deducted:        'text-warning',
  lop_applied:           'text-destructive',
  payroll_computed:      'text-primary',
  payroll_finalized:     'text-success',
  anomaly_resolved:      'text-muted-foreground',
  manual_note:           'text-muted-foreground',
}

// ── StatMini ─────────────────────────────────────────────────────────────────

function StatMini({ label, value, colorClass }: { label: string; value: string | number; colorClass?: string }) {
  return (
    <div className="text-center p-2 rounded-md bg-muted/40">
      <p className="text-[10px] text-muted-foreground mb-0.5 leading-tight">{label}</p>
      <p className={cn('text-base font-bold tabular-nums', colorClass ?? 'text-foreground')}>{value}</p>
    </div>
  )
}

// ── DiffBadge ─────────────────────────────────────────────────────────────────

function DiffBadge({ diff, prefix = '', suffix = '', invertColor = false }: {
  diff: number; prefix?: string; suffix?: string; invertColor?: boolean
}) {
  if (diff === 0) return <span className="text-xs text-muted-foreground">—</span>
  const isPositive = invertColor ? diff < 0 : diff > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums',
      isPositive ? 'text-success' : 'text-destructive')}>
      {diff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {prefix}{diff > 0 ? '+' : ''}{diff.toFixed(0)}{suffix}
    </span>
  )
}

// ── Section Accordions ────────────────────────────────────────────────────────

function Accordion({ title, icon, badge, children, defaultOpen = false }: {
  title: string; icon?: React.ReactNode; badge?: React.ReactNode
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold">{title}</span>
          {badge}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PayrollInvestigation() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [searchParams, setSearchParams] = useSearchParams()
  const employeeId = searchParams.get('employee_id') ?? ''
  const month      = searchParams.get('month') ?? new Date().toISOString().slice(0, 7)

  const { data, isLoading, isError, refetch } = useQuery<InvestigationData>({
    queryKey:  ['payroll-investigate', employeeId, month],
    queryFn:   () => api.get(`/payroll/investigate/${employeeId}?month=${month}`),
    enabled:   !!employeeId && isAdmin,
    staleTime: 60_000,
  })

  function navigate(newMonth: string) {
    setSearchParams(prev => { prev.set('month', newMonth); return prev })
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 text-destructive/50" />
          <p className="text-sm font-medium text-foreground">HR admin access required</p>
        </div>
      </PageContainer>
    )
  }

  if (!employeeId) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Users className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium text-foreground">No employee selected</p>
          <p className="text-xs text-center">Navigate here from a payroll slip or investigation panel.</p>
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/payroll">Back to Payroll</Link>
          </Button>
        </div>
      </PageContainer>
    )
  }

  const d = data

  return (
    <PageContainer>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title={
          isLoading ? 'Payroll Investigation' :
          d ? `${d.employee.name} · ${month}` : 'Payroll Investigation'
        }
        subtitle={
          d ? `${d.employee.code}${d.employee.department ? ' · ' + d.employee.department : ''}` :
          'Loading investigation context…'
        }
        actions={
          <div className="flex items-center gap-2">
            {/* Month navigation */}
            <Button size="sm" variant="outline" onClick={() => navigate(prevMonthStr(month))}>
              ← {prevMonthStr(month)}
            </Button>
            <span className="text-xs font-mono font-semibold text-foreground px-2">{month}</span>
            <Button size="sm" variant="outline" onClick={() => navigate(nextMonthStr(month))}>
              {nextMonthStr(month)} →
            </Button>
            <Button size="sm" variant="ghost" onClick={() => refetch()}>↺</Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/payroll"><ArrowLeft className="h-3.5 w-3.5 mr-1" />Payroll</Link>
            </Button>
          </div>
        }
      />

      {/* ── Loading / error ────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center gap-3 py-16 text-muted-foreground justify-center">
          <Activity className="h-6 w-6 animate-pulse" />
          <p className="text-sm">Loading investigation data…</p>
        </div>
      )}
      {isError && (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 text-destructive/50" />
            <p className="text-sm">Failed to load investigation data.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        </SectionCard>
      )}

      {d && !isLoading && (
        <div className="space-y-4">

          {/* ── Quick Navigation Links ──────────────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to={`/admin/employees/${d.employee.id}`}>
                <Users className="h-3.5 w-3.5 mr-1" />Employee Profile
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/admin/attendance/forensics?employee_id=${d.employee.id}`}>
                <Activity className="h-3.5 w-3.5 mr-1" />Attendance Forensics
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/admin/attendance/anomalies?employee_id=${d.employee.id}`}>
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />Anomalies
              </Link>
            </Button>
          </div>

          {/* ── Blocker Alert ───────────────────────────────────────────── */}
          {d.blocker.is_blocked && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-warning">Payroll Investigation Alerts</p>
                <ul className="mt-1 space-y-0.5">
                  {d.blocker.reasons.map((r, i) => (
                    <li key={i} className="text-xs text-foreground">• {r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Attendance Summary ──────────────────────────────────────── */}
          <SectionCard
            title="Attendance Summary"
            icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
              <StatMini label="Total Days"    value={d.attendance.total_days} />
              <StatMini label="Payable"       value={d.attendance.payable_days}    colorClass="text-success" />
              <StatMini label="LOP Days"      value={d.attendance.lop_days}        colorClass={d.attendance.lop_days > 0 ? 'text-destructive' : 'text-foreground'} />
              <StatMini label="Present"       value={d.attendance.present_days}    colorClass="text-success" />
              <StatMini label="Late"          value={d.attendance.late_days}       colorClass={d.attendance.late_days > 0 ? 'text-warning' : 'text-foreground'} />
              <StatMini label="Absent"        value={d.attendance.absent_days}     colorClass={d.attendance.absent_days > 0 ? 'text-destructive' : 'text-foreground'} />
              <StatMini label="Leave"         value={d.attendance.leave_days} />
              <StatMini label="Holidays"      value={d.attendance.holiday_days} />
              <StatMini label="Half Days"     value={d.attendance.half_days} />
              <StatMini label="Work Hours"    value={`${d.attendance.total_work_hours}h`} />
              <StatMini label="OT Hours"      value={`${d.attendance.total_ot_hours}h`}    colorClass={d.attendance.total_ot_hours > 0 ? 'text-info' : 'text-foreground'} />
              <StatMini label="Late (min)"    value={d.attendance.total_late_minutes}       colorClass={d.attendance.total_late_minutes > 0 ? 'text-warning' : 'text-foreground'} />
            </div>
          </SectionCard>

          {/* ── Payroll Slip & Variance (2-col) ────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Current Slip */}
            <SectionCard
              title={`Payroll Slip — ${month}`}
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
              action={
                d.current_slip ? (
                  <Badge
                    variant={d.current_slip.status === 'finalized' ? 'success' : d.current_slip.status === 'held' ? 'destructive' : 'secondary'}
                    className="rounded-full text-[10px] capitalize"
                  >
                    {d.current_slip.status}
                  </Badge>
                ) : undefined
              }
            >
              {!d.current_slip ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Payroll not computed yet for {month}.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {d.current_slip.warning && (
                    <div className="flex items-start gap-2 p-2 rounded bg-warning/10 text-warning text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      {d.current_slip.warning}
                    </div>
                  )}
                  {d.current_slip.held_reason && (
                    <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      Held: {d.current_slip.held_reason}
                    </div>
                  )}
                  {[
                    { label: 'CTC Monthly',       value: fmtCurrency(d.current_slip.ctc_monthly) },
                    { label: 'Total Working Days', value: d.current_slip.total_working_days },
                    { label: 'Payable Days',       value: d.current_slip.payable_days },
                    { label: 'LOP Days',           value: d.current_slip.lop_days },
                    { label: 'Gross Pay',          value: fmtCurrency(d.current_slip.gross_pay) },
                    { label: 'LOP Deduction',      value: fmtCurrency(d.current_slip.lop_amount) },
                    { label: 'Total Deductions',   value: fmtCurrency(d.current_slip.total_deductions) },
                    { label: 'OT Hours',           value: `${d.current_slip.overtime_hours ?? 0}h` },
                    { label: 'Net Pay',            value: fmtCurrency(d.current_slip.net_pay) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center text-xs border-b border-border/40 pb-1.5">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={cn('font-semibold tabular-nums',
                        label === 'Net Pay' ? 'text-success text-sm' :
                        (label === 'LOP Deduction' || label === 'LOP Days') ? 'text-destructive' : 'text-foreground'
                      )}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* MoM Variance */}
            <SectionCard
              title="Month-over-Month Variance"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
            >
              {!d.variance ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  {d.prev_slip ? 'No variance data (current month not computed).' : `No previous slip for ${prevMonthStr(month)}.`}
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  <p className="text-[10px] text-muted-foreground mb-2">vs. {d.variance.prev_month}</p>
                  {[
                    { label: 'Net Pay',       diff: d.variance.net_pay_diff,     prefix: '₹', invertColor: false },
                    { label: 'Gross Pay',     diff: d.variance.gross_pay_diff,   prefix: '₹', invertColor: false },
                    { label: 'Deductions',    diff: d.variance.deductions_diff,  prefix: '₹', invertColor: true  },
                    { label: 'LOP Amount',    diff: d.variance.lop_amount_diff,  prefix: '₹', invertColor: true  },
                    { label: 'Payable Days',  diff: d.variance.payable_days_diff, prefix: '', suffix: ' days', invertColor: false },
                    { label: 'LOP Days',      diff: d.variance.lop_days_diff,    prefix: '', suffix: ' days', invertColor: true  },
                    { label: 'OT Hours',      diff: d.variance.ot_hours_diff,    prefix: '', suffix: 'h', invertColor: false },
                  ].map(({ label, diff, prefix, suffix, invertColor }) => (
                    <div key={label} className="flex justify-between items-center border-b border-border/40 pb-1.5">
                      <span className="text-muted-foreground">{label}</span>
                      <DiffBadge diff={diff} prefix={prefix} suffix={suffix} invertColor={invertColor} />
                    </div>
                  ))}

                  {/* prev slip summary */}
                  {d.prev_slip && (
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <p className="text-muted-foreground">Prev Net Pay</p>
                        <p className="font-semibold tabular-nums">{fmtCurrency(d.prev_slip.net_pay)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Curr Net Pay</p>
                        <p className="font-semibold tabular-nums text-success">{fmtCurrency(d.current_slip?.net_pay)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </div>

          {/* ── Explainability Ledger ───────────────────────────────────── */}
          <Accordion
            title="Explainability Ledger"
            icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
            badge={
              d.ledger.length > 0 ? (
                <Badge variant="secondary" className="rounded-full text-[10px] ml-1">{d.ledger.length}</Badge>
              ) : undefined
            }
            defaultOpen={d.ledger.length > 0}
          >
            {d.ledger.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No ledger entries for this month. Entries are automatically created when leaves are approved, corrections are applied, or payroll is computed.
              </p>
            ) : (
              <div className="space-y-0">
                {d.ledger.map((entry, i) => (
                  <div
                    key={entry.id}
                    className={cn('flex items-start gap-3 py-3 text-xs', i < d.ledger.length - 1 && 'border-b border-border/40')}
                  >
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                      <div className={cn('w-2 h-2 rounded-full', EVENT_TYPE_COLOR[entry.event_type]?.replace('text-', 'bg-') ?? 'bg-muted-foreground')} />
                      {i < d.ledger.length - 1 && <div className="w-px h-full mt-1 bg-border/50" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className={cn('font-medium', EVENT_TYPE_COLOR[entry.event_type] ?? 'text-muted-foreground')}>
                          {EVENT_TYPE_LABEL[entry.event_type] ?? entry.event_type}
                        </span>
                        {entry.impact_amount != null && entry.impact_amount !== 0 && (
                          <span className={cn('font-bold tabular-nums',
                            entry.impact_amount < 0 ? 'text-destructive' : 'text-success')}>
                            {entry.impact_amount > 0 ? '+' : ''}{fmtCurrency(entry.impact_amount)}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(entry.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-foreground/80 leading-relaxed">{entry.event_description}</p>
                      {(entry.before_value || entry.after_value) && (
                        <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                          {entry.before_value && <span>{entry.before_value}</span>}
                          {entry.before_value && entry.after_value && <span> → </span>}
                          {entry.after_value && <span className="text-foreground">{entry.after_value}</span>}
                        </p>
                      )}
                      {entry.created_by_name && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">by {entry.created_by_name}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Accordion>

          {/* ── Leave Impact ───────────────────────────────────────────── */}
          <Accordion
            title="Leave Impact"
            icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
            badge={d.leaves.length > 0 ? <Badge variant="secondary" className="rounded-full text-[10px] ml-1">{d.leaves.length}</Badge> : undefined}
            defaultOpen={d.leaves.length > 0}
          >
            {d.leaves.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No approved leaves in {month}.</p>
            ) : (
              <div className="space-y-2">
                {d.leaves.map(lv => (
                  <div key={lv.id} className="flex items-start justify-between gap-3 text-xs p-2 rounded-md border border-border/50">
                    <div>
                      <p className="font-medium">{lv.leave_type ?? 'Leave'}</p>
                      <p className="text-muted-foreground">{fmtDate(lv.from_date)} — {fmtDate(lv.to_date)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={lv.is_paid ? 'success' : 'warning'} className="rounded-full text-[10px]">
                        {lv.is_paid ? 'Paid' : 'Unpaid / LOP'}
                      </Badge>
                      {lv.approved_at && (
                        <span className="text-[10px] text-muted-foreground">Approved {fmtDate(lv.approved_at)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Accordion>

          {/* ── Corrections ─────────────────────────────────────────────── */}
          <Accordion
            title="Attendance Corrections"
            icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
            badge={d.corrections.length > 0 ? <Badge variant="secondary" className="rounded-full text-[10px] ml-1">{d.corrections.length}</Badge> : undefined}
          >
            {d.corrections.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No approved corrections in {month}.</p>
            ) : (
              <div className="space-y-2">
                {d.corrections.map(c => (
                  <div key={c.id} className="flex items-start justify-between gap-3 text-xs p-2 rounded-md border border-border/50">
                    <div>
                      <p className="font-medium">{fmtDate(c.date)}</p>
                      <p className="text-muted-foreground">{c.reason}</p>
                      {c.requested_check_in && (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          IN: {fmtTime(c.requested_check_in)}{c.requested_check_out ? ` · OUT: ${fmtTime(c.requested_check_out)}` : ''}
                        </p>
                      )}
                    </div>
                    <Badge variant="success" className="rounded-full text-[10px]">Approved</Badge>
                  </div>
                ))}
              </div>
            )}
          </Accordion>

          {/* ── Anomalies ───────────────────────────────────────────────── */}
          <Accordion
            title="Attendance Anomalies"
            icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
            badge={
              d.anomalies.filter(a => !a.resolved).length > 0
                ? <Badge variant="destructive" className="rounded-full text-[10px] ml-1">{d.anomalies.filter(a => !a.resolved).length} open</Badge>
                : d.anomalies.length > 0
                ? <Badge variant="secondary" className="rounded-full text-[10px] ml-1">{d.anomalies.length} total</Badge>
                : undefined
            }
            defaultOpen={d.anomalies.filter(a => !a.resolved).length > 0}
          >
            {d.anomalies.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No anomalies in {month}.</p>
            ) : (
              <div className="space-y-2">
                {d.anomalies.map(a => (
                  <div
                    key={a.id}
                    className={cn('flex items-start justify-between gap-3 text-xs p-2 rounded-md border',
                      a.resolved ? 'border-border/50 bg-muted/20' : 'border-destructive/30 bg-destructive/5')}
                  >
                    <div>
                      <p className="font-medium">{fmtDate(a.date)} · <span className="capitalize">{a.type.replace(/_/g, ' ')}</span></p>
                      <p className="text-muted-foreground">{a.message}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {a.resolved
                        ? <Badge variant="secondary" className="rounded-full text-[10px]">Resolved</Badge>
                        : <Badge variant={SEVERITY_VARIANT[a.severity] ?? 'secondary'} className="rounded-full text-[10px] capitalize">{a.severity}</Badge>
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Accordion>

          {/* ── Recompute History ──────────────────────────────────────── */}
          <Accordion
            title="Recompute History"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            badge={d.recompute_history.length > 0 ? <Badge variant="secondary" className="rounded-full text-[10px] ml-1">{d.recompute_history.length}</Badge> : undefined}
          >
            {d.recompute_history.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No attendance recomputes logged for {month}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border text-muted-foreground">
                    {['Date', 'Source', 'Before', 'After', 'When'].map(h => (
                      <th key={h} className="text-left py-1.5 px-2 font-medium">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {d.recompute_history.map(r => (
                      <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="py-1.5 px-2 font-mono">{r.date}</td>
                        <td className="py-1.5 px-2 capitalize">{r.source}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{r.before_status ?? '—'}</td>
                        <td className="py-1.5 px-2">
                          <Badge variant={r.after_status === 'present' ? 'success' : r.after_status === 'absent' ? 'destructive' : 'secondary'} className="rounded-full text-[10px] capitalize">
                            {r.after_status}
                          </Badge>
                        </td>
                        <td className="py-1.5 px-2 text-muted-foreground tabular-nums">
                          {new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Accordion>

          {/* ── Component Breakdown (from current slip) ─────────────────── */}
          {d.current_slip?.component_breakdown && d.current_slip.component_breakdown.length > 0 && (
            <Accordion
              title="Salary Component Breakdown"
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="space-y-1">
                {/* Earnings */}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Earnings</p>
                {d.current_slip.component_breakdown
                  .filter(c => c.component_type === 'earning')
                  .map(c => (
                    <div key={c.code} className="flex justify-between text-xs py-1 border-b border-border/30">
                      <span className="text-foreground">{c.name}</span>
                      <span className="font-semibold tabular-nums text-success">{fmtCurrency(c.monthly_amount)}</span>
                    </div>
                  ))}
                {/* Deductions */}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-2 mb-1">Deductions</p>
                {d.current_slip.component_breakdown
                  .filter(c => c.component_type === 'deduction')
                  .map(c => (
                    <div key={c.code} className="flex justify-between text-xs py-1 border-b border-border/30">
                      <div>
                        <span className="text-foreground">{c.name}</span>
                        <span className="text-muted-foreground ml-1 text-[10px]">
                          ({c.calc_type === 'pct_of_basic' ? `${c.value}% of Basic` :
                            c.calc_type === 'pct_of_ctc' ? `${c.value}% of CTC` :
                            c.calc_type === 'pct_of_gross' ? `${c.value}% of Gross` :
                            'Fixed'})
                        </span>
                      </div>
                      <span className="font-semibold tabular-nums text-destructive">−{fmtCurrency(c.monthly_amount)}</span>
                    </div>
                  ))}
              </div>
            </Accordion>
          )}

        </div>
      )}
    </PageContainer>
  )
}
