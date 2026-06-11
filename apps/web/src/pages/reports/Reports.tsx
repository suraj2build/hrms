/**
 * Reports — Operational Reporting Platform
 *
 * Nine operational report surfaces:
 *   1. Headcount & Attrition      — workforce visibility, joiner/separation trend
 *   2. Attendance & LOP           — attendance summary, loss-of-pay analysis per employee
 *   3. Salary Register            — monthly CTC & component breakdown, payroll validation
 *   4. Statutory Compliance       — PF, ESI, PT, LWF register (India)
 *   5. Muster Roll                — daily attendance grid (.xlsx export, server-generated)
 *   6. Salary Sheet               — processed payslip register (.xlsx export, server-generated)
 *   7. Leave Register             — leave request register (.xlsx export, server-generated)
 *   8. Payroll Register           — bank disbursement register, masked preview, full .xlsx
 *   9. Att. vs Payroll Comparison — cross-module reconciliation, mismatch detection (.xlsx)
 *
 * Operational hardening:
 *   - Department filter wired to backend on all tabs
 *   - Employee search (client-side) on all tabs
 *   - Export feedback via toast + row count displayed on button
 *   - "Generated at" timestamp after each fetch
 *   - Totals footer row pinned to each table
 *   - Contextual deep-links to related operational workflows
 *   - Compact enterprise density (not a BI dashboard)
 *   - Operational empty states with actionable guidance
 *   - Server-generated .xlsx exports (tabs 5-7) with freeze panes + metadata sheet
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Link }                           from 'react-router-dom'
import { useQuery }                       from '@tanstack/react-query'
import { toast }                          from 'sonner'
import {
  Download, Users, Clock, Briefcase, ShieldCheck,
  RefreshCw, Filter, Search, ArrowUpRight,
  AlertTriangle, FileText, Info, CalendarDays,
  Banknote, BookOpen, Loader2, ArrowLeftRight, CreditCard,
} from 'lucide-react'
import { api }                            from '@/lib/api/client'
import { useAuthStore }                   from '@/stores/authStore'
import { Button }                         from '@/components/ui/button'
import { Input }                          from '@/components/ui/input'
import { DateInput }                      from '@/components/ui/date-input'
import { Badge }                          from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer }                  from '@/components/layout/PageContainer'
import { PageHeader }                     from '@/components/layout/PageHeader'
import { useBasePath }                    from '@/lib/routing'
import { cn }                             from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Department { id: string; name: string }

interface HeadcountRow {
  employee_code: string; name: string; department: string
  employment_type: string; joining_date: string; status: string
}
interface HeadcountData {
  summary:  { total_employees: number; active_employees: number; total_separations: number }
  monthly_trend: { month: string; joiners: number; separations: number }[]
  department_breakdown: { dept: string; count: number }[]
  employment_type_breakdown: { type: string; count: number }[]
  employees: HeadcountRow[]
}

interface AttRow {
  employee_code: string; name: string; department: string
  present: number; absent: number; late: number; half_day: number
  total_work_hours: number; total_late_minutes: number; total_overtime_minutes: number
  leave_days: number
}
interface AttData {
  from: string; to: string
  totals: { present: number; absent: number; late: number; half_day: number; total_work_hours: number; leave_days: number }
  rows: AttRow[]
}

interface SalaryRow {
  employee_code: string; name: string; department: string; employment_type: string
  ctc_annual: number; ctc_monthly: number; effective_from: string
  components: Record<string, number>
}
interface SalaryData {
  month: string
  component_columns: string[]
  totals: { employee_count: number; total_ctc_annual: number; total_ctc_monthly: number }
  rows: SalaryRow[]
}

interface StatutoryRow {
  employee_code: string; name: string; department: string; employment_type: string
  ctc_monthly: number; ctc_annual: number
  uan: string | null; pf_number: string | null
  pf_employee_monthly: number | null; pf_employer_monthly: number | null
  esi_number: string | null; esi_applicable: boolean
  esi_employee_monthly: number | null; esi_employer_monthly: number | null
  pan: string | null; pt_applicable: boolean; lwf_applicable: boolean; tax_regime: string
}
interface StatutoryData {
  totals: {
    employee_count: number; pf_employees: number; esi_employees: number
    pt_employees: number; lwf_employees: number
    total_pf_employee: number; total_pf_employer: number
    total_esi_employee: number; total_esi_employer: number
  }
  rows: StatutoryRow[]
}

// ── New report types (tabs 5-7) ───────────────────────────────────────────────

interface MusterEmployee {
  employee_id:   string
  employee_code: string
  name:          string
  days:          Array<{ date: string; status: string | null; work_hours: number; late_minutes: number }>
}
interface MusterData {
  month:     string
  employees: MusterEmployee[]
}

interface PayrollRunSummary {
  id:           string
  month:        string
  status:       string
  total_gross:  number
  total_net:    number
  total_deductions: number
  total_lop_amount: number
  employee_count:   number
  finalized_at: string | null
  created_at:   string
}

// LeaveRequestPreview kept for future leave-report use
// interface LeaveRequestPreview { ... }

interface ComparisonRow {
  employee_id:           string
  employee_code:         string
  name:                  string
  department:            string
  att_payable_days:      number
  att_lop_days:          number
  payroll_payable_days:  number | null
  payroll_lop_days:      number | null
  diff_payable:          number
  diff_lop:              number
  is_mismatch:           boolean
  has_payroll_slip:      boolean
  last_recompute:        string | null
  pending_anomalies:     number
  pending_leaves:        number
}
interface ComparisonData {
  month:      string
  run_id:     string | null
  run_status: string | null
  run_found:  boolean
  rows:       ComparisonRow[]
  summary: {
    total_employees:     number
    mismatch_count:      number
    no_slip_count:       number
    no_attendance_count: number
  }
}

interface PayrollRegisterRow {
  employee_id:      string
  employee_code:    string
  name:             string
  department:       string
  bank_name:        string | null
  /** Always masked (XXXX1234) in this preview response. Full value only in Excel export. */
  account_number:   string | null
  ifsc_code:        string | null
  branch_name:      string | null
  account_type:     string | null  // 'savings' | 'current' | 'salary'
  bank_complete:    boolean
  gross_pay:        number
  lop_amount:       number
  total_deductions: number
  net_pay:          number
  slip_status:      string
  held_reason:      string | null
  payment_status:   'READY' | 'MISSING_BANK' | 'ON_HOLD' | 'PENDING'
}
interface PayrollRegisterData {
  month:     string
  run: {
    id:             string
    status:         string
    finalized_at:   string | null
    employee_count: number
    total_gross:    number
    total_net:      number
  } | null
  run_found:  boolean
  rows:       PayrollRegisterRow[]
  summary: {
    total_employees:    number
    ready_count:        number
    on_hold_count:      number
    missing_bank_count: number
    pending_count:      number
    total_gross:        number
    total_deductions:   number
    total_net:          number
    ready_net:          number
    on_hold_net:        number
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function firstOfMonth() {
  return `${currentMonth()}-01`
}
function today() {
  return new Date().toISOString().slice(0, 10)
}
function monthMinus(n: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Month state for payroll-based reports. Defaults to the latest month with
 * finalized payroll (so the report lands on real data instead of an empty
 * current month) until the user picks a month explicitly.
 */
function usePayrollMonthState(): [string, (m: string) => void] {
  const { data: anchor } = useQuery<{ month: string | null }>({
    queryKey:  ['payroll-anchor'],
    queryFn:   () => api.get('/datasets/payroll-cost/anchor'),
    staleTime: 5 * 60_000,
    retry:     false,
  })
  const [month, setMonth] = useState(currentMonth())
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current && anchor?.month) setMonth(anchor.month)
  }, [anchor?.month])
  const update = useCallback((m: string) => { touched.current = true; setMonth(m) }, [])
  return [month, update]
}

/** Download CSV and fire a success toast with row count */
function exportCSV(filename: string, rows: Record<string, unknown>[], label: string) {
  if (!rows.length) {
    toast.error('Nothing to export', { description: 'Apply filters and load data first.' })
    return
  }
  const cols   = Object.keys(rows[0])
  const header = cols.join(',')
  const body   = rows.map(r =>
    cols.map(c => {
      const v = r[c] ?? ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  ).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
  toast.success(`${label} exported`, {
    description: `${rows.length} row${rows.length !== 1 ? 's' : ''} — ${filename}`,
  })
}

/**
 * Authenticated Excel download via api.getRaw().
 * Triggers browser file-save dialog; shows toast on success or failure.
 */
async function downloadXlsx(
  endpoint: string,
  filename: string,
  setLoading: (v: boolean) => void,
): Promise<void> {
  setLoading(true)
  try {
    const resp = await api.getRaw(endpoint)
    const blob = await resp.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
    toast.success('Excel downloaded', { description: filename })
  } catch (e: any) {
    toast.error('Export failed', { description: e?.message ?? String(e) })
  } finally {
    setLoading(false)
  }
}

// ── Compact metric chip ───────────────────────────────────────────────────────

function MetricChip({ label, value, highlight }: {
  label: string; value: string; highlight?: 'success' | 'destructive' | 'warning' | 'none'
}) {
  const valClass = highlight === 'success'     ? 'text-success'
                 : highlight === 'destructive' ? 'text-destructive'
                 : highlight === 'warning'     ? 'text-warning'
                 : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-0.5 min-w-[120px]">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">{label}</p>
      <p className={cn('text-lg font-bold leading-tight', valClass)}>{value}</p>
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <div className="flex flex-wrap gap-3 items-end p-3">
        <Filter className="h-3.5 w-3.5 text-muted-foreground self-center mb-0.5 flex-shrink-0" />
        {children}
      </div>
      {meta && (
        <div className="border-t border-border/50 px-4 py-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {meta}
        </div>
      )}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

// ── Department select (shared) ────────────────────────────────────────────────

function DeptSelect({ value, onChange, departments }: {
  value: string
  onChange: (v: string) => void
  departments: Department[]
}) {
  return (
    <FilterField label="Department">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-xs rounded-md border border-input bg-background px-2 w-44 text-foreground"
      >
        <option value="">All departments</option>
        {departments.map(d => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </FilterField>
  )
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn(
      'px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border',
      right ? 'text-right' : 'text-left',
    )}>
      {children}
    </th>
  )
}

function Td({ children, right, mono, bold, muted, highlight }: {
  children: React.ReactNode; right?: boolean; mono?: boolean
  bold?: boolean; muted?: boolean; highlight?: 'destructive' | 'warning' | 'success'
}) {
  return (
    <td className={cn(
      'px-3 py-1.5 text-xs border-b border-border/40 whitespace-nowrap',
      right       ? 'text-right'       : 'text-left',
      mono        ? 'font-mono'        : '',
      bold        ? 'font-semibold text-foreground' : '',
      muted       ? 'text-muted-foreground' : '',
      highlight === 'destructive' ? 'text-destructive font-semibold' : '',
      highlight === 'warning'     ? 'text-warning font-semibold'     : '',
      highlight === 'success'     ? 'text-success font-semibold'     : '',
      !bold && !muted && !highlight ? 'text-muted-foreground' : '',
    )}>
      {children}
    </td>
  )
}

function TdTotal({ children, right, bold, colSpan, highlight }: {
  children?: React.ReactNode; right?: boolean; bold?: boolean; colSpan?: number
  highlight?: 'destructive' | 'warning' | 'success'
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-3 py-2 text-xs font-semibold bg-muted/50 text-foreground border-t-2 border-border whitespace-nowrap',
        right ? 'text-right' : 'text-left',
        bold  ? 'font-bold'  : '',
        highlight === 'destructive' ? 'text-destructive' : '',
        highlight === 'warning'     ? 'text-warning'     : '',
        highlight === 'success'     ? 'text-success'     : '',
      )}
    >
      {children ?? null}
    </td>
  )
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border overflow-auto max-h-[560px] shadow-sm">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  )
}

function StickyThead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-muted/50 sticky top-0 z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
      {children}
    </thead>
  )
}

// ── Report meta row ───────────────────────────────────────────────────────────

function ReportMeta({ generatedAt, rows, context }: {
  generatedAt: Date | null; rows: number; context?: React.ReactNode
}) {
  if (!generatedAt) return null
  return (
    <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
      <Info className="h-3 w-3 flex-shrink-0" />
      <span>Generated {fmtTime(generatedAt)} · {rows} record{rows !== 1 ? 's' : ''}</span>
      {context && <span className="text-muted-foreground/60">·</span>}
      {context}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function ReportEmpty({ loading, message, guidance }: {
  loading?: boolean; message: string; guidance?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center h-36 gap-2 text-center px-4">
      {loading
        ? <>
            <Loader2 className="h-5 w-5 text-muted-foreground/50 animate-spin" />
            <p className="text-sm text-muted-foreground">{message ?? 'Loading…'}</p>
          </>
        : <>
            <FileText className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">{message}</p>
            {guidance && <p className="text-xs text-muted-foreground/70 max-w-sm">{guidance}</p>}
          </>
      }
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  active:    'bg-success/10 text-success border-success/20',
  inactive:  'bg-muted text-muted-foreground border-border',
  on_notice: 'bg-warning/10 text-warning border-warning/20',
  separated: 'bg-destructive/10 text-destructive border-destructive/20',
}

// ── Row search helper ─────────────────────────────────────────────────────────

function matchSearch(q: string, ...fields: (string | number | null | undefined)[]) {
  if (!q) return true
  const lower = q.toLowerCase()
  return fields.some(f => f != null && String(f).toLowerCase().includes(lower))
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEADCOUNT REPORT
// ─────────────────────────────────────────────────────────────────────────────

function HeadcountReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [from,    setFrom]    = useState(monthMinus(11))
  const [to,      setTo]      = useState(currentMonth())
  const [empType, setEmpType] = useState('')
  const [deptId,  setDeptId]  = useState('')
  const [search,  setSearch]  = useState('')
  const [genAt,   setGenAt]   = useState<Date | null>(null)

  const params = new URLSearchParams({
    from, to,
    ...(empType ? { employment_type: empType } : {}),
    ...(deptId  ? { department_id:   deptId }  : {}),
  })

  const { data, isLoading, refetch, isFetching } = useQuery<HeadcountData>({
    queryKey: ['report-headcount', from, to, empType, deptId],
    queryFn:  async () => {
      const r = await api.get<HeadcountData>(`/reports/headcount?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const filtered = useMemo(() =>
    (data?.employees ?? []).filter(r =>
      matchSearch(search, r.employee_code, r.name, r.department, r.employment_type)
    ), [data, search])

  const doExport = useCallback(() => {
    exportCSV(
      `headcount_${from}_to_${to}${deptId ? `_dept` : ''}.csv`,
      filtered.map(r => ({
        'Employee Code':    r.employee_code,
        'Name':             r.name,
        'Department':       r.department,
        'Employment Type':  r.employment_type,
        'Joining Date':     r.joining_date,
        'Status':           r.status,
      })),
      'Headcount report',
    )
  }, [filtered, from, to, deptId])

  return (
    <div className="space-y-4">
      <FilterBar
        meta={<ReportMeta generatedAt={genAt} rows={filtered.length}
          context={<Link to={`${basePath}/people`} className="flex items-center gap-0.5 text-primary hover:underline">People Directory <ArrowUpRight className="h-2.5 w-2.5" /></Link>}
        />}
      >
        <FilterField label="From month">
          <Input type="month" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <FilterField label="To month">
          <Input type="month" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <FilterField label="Employment type">
          <select value={empType} onChange={e => setEmpType(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 w-36 text-foreground">
            <option value="">All types</option>
            <option value="permanent">Permanent</option>
            <option value="contract">Contract</option>
            <option value="probation">Probation</option>
            <option value="intern">Intern</option>
          </select>
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doExport} disabled={!filtered.length} className="h-8 text-xs gap-1">
            <Download className="h-3 w-3" />
            Export CSV {filtered.length ? `(${filtered.length})` : ''}
          </Button>
        </div>
      </FilterBar>

      {/* KPI chips */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Total Employees"    value={fmt(data.summary.total_employees)} />
          <MetricChip label="Active"             value={fmt(data.summary.active_employees)} highlight="success" />
          <MetricChip label="Separations"        value={fmt(data.summary.total_separations)} highlight={data.summary.total_separations > 0 ? 'destructive' : 'none'} />
          <MetricChip label="Showing (filtered)" value={fmt(filtered.length)} />
        </div>
      )}

      {/* Monthly trend mini-table */}
      {data?.monthly_trend && data.monthly_trend.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Monthly Movement</p>
          <div className="rounded-lg border border-border overflow-auto max-h-[200px]">
            <table className="w-full text-xs border-collapse">
              <StickyThead>
                <tr>
                  <Th>Month</Th>
                  <Th right>Joiners</Th>
                  <Th right>Separations</Th>
                  <Th right>Net</Th>
                </tr>
              </StickyThead>
              <tbody>
                {data.monthly_trend.map(m => {
                  const net = m.joiners - m.separations
                  return (
                    <tr key={m.month} className="hover:bg-muted/20 transition-colors">
                      <Td bold>{m.month}</Td>
                      <Td right highlight={m.joiners > 0 ? 'success' : undefined}>
                        {m.joiners > 0 ? `+${m.joiners}` : '—'}
                      </Td>
                      <Td right highlight={m.separations > 0 ? 'destructive' : undefined}>
                        {m.separations > 0 ? `-${m.separations}` : '—'}
                      </Td>
                      <Td right highlight={net > 0 ? 'success' : net < 0 ? 'destructive' : undefined}>
                        {net > 0 ? `+${net}` : net < 0 ? `${net}` : '—'}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Employee search */}
      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code, department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      )}

      {/* Employee table */}
      {isLoading && <ReportEmpty loading message="Loading headcount report…" />}
      {!isLoading && !filtered.length && (
        <ReportEmpty
          message="No employees match the selected filters."
          guidance="Adjust the date range, employment type, or department to broaden the report scope."
        />
      )}
      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th>Type</Th>
              <Th>Joining Date</Th>
              <Th>Status</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.employee_code} className="hover:bg-muted/20 transition-colors">
                <Td mono>{r.employee_code}</Td>
                <Td bold>{r.name}</Td>
                <Td>{r.department}</Td>
                <Td>{r.employment_type}</Td>
                <Td>{r.joining_date}</Td>
                <Td>
                  <span className={cn(
                    'px-2 py-0.5 rounded-full text-[10px] font-medium border',
                    STATUS_CLS[r.status] ?? 'bg-muted text-muted-foreground border-border',
                  )}>
                    {r.status.replace('_', ' ')}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold>{filtered.length} employees</TdTotal>
              <TdTotal />
              <TdTotal>{deptId ? departments.find(d => d.id === deptId)?.name ?? 'Filtered dept' : 'All departments'}</TdTotal>
              <TdTotal>{empType || 'All types'}</TdTotal>
              <TdTotal />
              <TdTotal>{data ? fmt(data.summary.active_employees) + ' active' : ''}</TdTotal>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ATTENDANCE & LOP REPORT
// ─────────────────────────────────────────────────────────────────────────────

function AttendanceReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [from,   setFrom]   = useState(firstOfMonth())
  const [to,     setTo]     = useState(today())
  const [deptId, setDeptId] = useState('')
  const [search, setSearch] = useState('')
  const [sortLop, setSortLop] = useState(false)
  const [genAt,  setGenAt]  = useState<Date | null>(null)

  const params = new URLSearchParams({
    from, to,
    ...(deptId ? { department_id: deptId } : {}),
  })

  const { data, isLoading, refetch, isFetching } = useQuery<AttData>({
    queryKey: ['report-attendance', from, to, deptId],
    queryFn:  async () => {
      const r = await api.get<AttData>(`/reports/attendance-summary?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const filtered = useMemo(() => {
    let rows = (data?.rows ?? []).filter(r =>
      matchSearch(search, r.employee_code, r.name, r.department)
    )
    if (sortLop) rows = [...rows].sort((a, b) => b.absent - a.absent)
    return rows
  }, [data, search, sortLop])

  const lopEmployees = useMemo(() => filtered.filter(r => r.absent >= 3).length, [filtered])

  const doExport = useCallback(() => {
    exportCSV(
      `attendance_lop_${from}_to_${to}.csv`,
      filtered.map(r => ({
        'Employee Code':    r.employee_code,
        'Name':             r.name,
        'Department':       r.department,
        'Present Days':     r.present,
        'LOP / Absent':     r.absent,
        'Late Days':        r.late,
        'Half Days':        r.half_day,
        'Leave Days':       r.leave_days,
        'Work Hours':       (r.total_work_hours ?? 0).toFixed(1),
        'Late Minutes':     r.total_late_minutes,
        'OT Minutes':       r.total_overtime_minutes,
      })),
      'Attendance & LOP report',
    )
  }, [filtered, from, to])

  const totals = data?.totals

  return (
    <div className="space-y-4">
      <FilterBar
        meta={
          <ReportMeta generatedAt={genAt} rows={filtered.length}
            context={
              <span className="flex items-center gap-2">
                <Link to={`${basePath}/attendance/corrections`} className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                  Corrections <ArrowUpRight className="h-2.5 w-2.5" />
                </Link>
                <Link to={`${basePath}/attendance/regularisation`} className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                  Regularisation <ArrowUpRight className="h-2.5 w-2.5" />
                </Link>
              </span>
            }
          />
        }
      >
        <FilterField label="From date">
          <DateInput value={from} onChange={setFrom} className="h-8 text-xs w-36" />
        </FilterField>
        <FilterField label="To date">
          <DateInput value={to} min={from} onChange={setTo} className="h-8 text-xs w-36" />
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <FilterField label="Sort by LOP">
          <button
            onClick={() => setSortLop(v => !v)}
            className={cn(
              'h-8 px-3 text-xs rounded-md border transition-colors',
              sortLop
                ? 'bg-destructive/10 border-destructive/30 text-destructive font-semibold'
                : 'bg-background border-input text-muted-foreground hover:bg-muted',
            )}
          >
            {sortLop ? '↓ LOP (high first)' : 'Default order'}
          </button>
        </FilterField>
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doExport} disabled={!filtered.length} className="h-8 text-xs gap-1">
            <Download className="h-3 w-3" />
            Export CSV {filtered.length ? `(${filtered.length})` : ''}
          </Button>
        </div>
      </FilterBar>

      {/* LOP alert banner */}
      {lopEmployees > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>{lopEmployees} employee{lopEmployees !== 1 ? 's' : ''}</strong> with 3+ LOP days in this period.
            {' '}Verify against payroll before processing.
          </span>
        </div>
      )}

      {/* KPI chips */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Total Present"  value={fmt(totals?.present ?? 0)} highlight="success" />
          <MetricChip label="LOP / Absent"   value={fmt(totals?.absent ?? 0)} highlight={(totals?.absent ?? 0) > 0 ? 'destructive' : 'none'} />
          <MetricChip label="Late Days"      value={fmt(totals?.late ?? 0)} highlight={(totals?.late ?? 0) > 0 ? 'warning' : 'none'} />
          <MetricChip label="Leave Days"     value={fmt(totals?.leave_days ?? 0)} />
          <MetricChip label="Total Hours"    value={`${(totals?.total_work_hours ?? 0).toFixed(0)}h`} />
        </div>
      )}

      {/* Employee search */}
      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code, department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading attendance report…" />}
      {!isLoading && !filtered.length && (
        <ReportEmpty
          message="No attendance records for this period."
          guidance="Process attendance for the selected date range, or broaden the filters."
        />
      )}

      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th right>Present</Th>
              <Th right>LOP</Th>
              <Th right>Late</Th>
              <Th right>Half Day</Th>
              <Th right>Leave Days</Th>
              <Th right>Work Hrs</Th>
              <Th right>Late Mins</Th>
              <Th right>OT Mins</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.employee_code} className={cn('hover:bg-muted/20 transition-colors', r.absent >= 3 && 'bg-destructive/3')}>
                <Td mono>{r.employee_code}</Td>
                <Td bold>{r.name}</Td>
                <Td>{r.department}</Td>
                <Td right highlight="success">{r.present}</Td>
                <Td right highlight={r.absent > 0 ? (r.absent >= 3 ? 'destructive' : 'warning') : undefined}>
                  {r.absent > 0 ? r.absent : '—'}
                </Td>
                <Td right highlight={r.late > 0 ? 'warning' : undefined}>{r.late > 0 ? r.late : '—'}</Td>
                <Td right>{r.half_day > 0 ? r.half_day : '—'}</Td>
                <Td right>{r.leave_days > 0 ? r.leave_days : '—'}</Td>
                <Td right bold>{(r.total_work_hours ?? 0).toFixed(1)}</Td>
                <Td right>{r.total_late_minutes > 0 ? r.total_late_minutes : '—'}</Td>
                <Td right>{r.total_overtime_minutes > 0 ? r.total_overtime_minutes : '—'}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={3}>Totals — {filtered.length} employees</TdTotal>
              <TdTotal right bold>{filtered.reduce((s, r) => s + r.present, 0)}</TdTotal>
              <TdTotal right bold>{filtered.reduce((s, r) => s + r.absent, 0)}</TdTotal>
              <TdTotal right>{filtered.reduce((s, r) => s + r.late, 0)}</TdTotal>
              <TdTotal right>{filtered.reduce((s, r) => s + r.half_day, 0)}</TdTotal>
              <TdTotal right>{filtered.reduce((s, r) => s + r.leave_days, 0)}</TdTotal>
              <TdTotal right bold>{filtered.reduce((s, r) => s + r.total_work_hours, 0).toFixed(1)}</TdTotal>
              <TdTotal right>{filtered.reduce((s, r) => s + r.total_late_minutes, 0)}</TdTotal>
              <TdTotal right>{filtered.reduce((s, r) => s + r.total_overtime_minutes, 0)}</TdTotal>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SALARY REGISTER
// ─────────────────────────────────────────────────────────────────────────────

function SalaryRegister({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [month,   setMonth]   = usePayrollMonthState()
  const [empType, setEmpType] = useState('')
  const [deptId,  setDeptId]  = useState('')
  const [search,  setSearch]  = useState('')
  const [genAt,   setGenAt]   = useState<Date | null>(null)

  const params = new URLSearchParams({
    month,
    ...(empType ? { employment_type: empType } : {}),
    ...(deptId  ? { department_id:   deptId }  : {}),
  })

  const { data, isLoading, refetch, isFetching } = useQuery<SalaryData>({
    queryKey: ['report-salary', month, empType, deptId],
    queryFn:  async () => {
      const r = await api.get<SalaryData>(`/reports/salary-register?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const filtered = useMemo(() =>
    (data?.rows ?? []).filter(r =>
      matchSearch(search, r.employee_code, r.name, r.department, r.employment_type)
    ), [data, search])

  const doExport = useCallback(() => {
    if (!data) return
    exportCSV(
      `salary_register_${month}${deptId ? '_dept' : ''}.csv`,
      filtered.map(r => ({
        'Employee Code':    r.employee_code,
        'Name':             r.name,
        'Department':       r.department,
        'Employment Type':  r.employment_type,
        'CTC Monthly (₹)': r.ctc_monthly,
        'CTC Annual (₹)':  r.ctc_annual,
        'Effective From':   r.effective_from,
        ...Object.fromEntries(
          (data.component_columns ?? []).map(col => [`${col} (₹)`, r.components[col] ?? 0])
        ),
      })),
      'Salary register',
    )
  }, [filtered, data, month, deptId])

  const totalMonthly = filtered.reduce((s, r) => s + r.ctc_monthly, 0)
  const totalAnnual  = filtered.reduce((s, r) => s + r.ctc_annual,  0)

  return (
    <div className="space-y-4">
      <FilterBar
        meta={
          <ReportMeta generatedAt={genAt} rows={filtered.length}
            context={
              <Link to={`${basePath}/payroll/runs`} className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Payroll Runs <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
            }
          />
        }
      >
        <FilterField label="Payroll month">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <FilterField label="Employment type">
          <select value={empType} onChange={e => setEmpType(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 w-36 text-foreground">
            <option value="">All types</option>
            <option value="permanent">Permanent</option>
            <option value="contract">Contract</option>
            <option value="probation">Probation</option>
            <option value="intern">Intern</option>
          </select>
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doExport} disabled={!filtered.length} className="h-8 text-xs gap-1">
            <Download className="h-3 w-3" />
            Export CSV {filtered.length ? `(${filtered.length})` : ''}
          </Button>
        </div>
      </FilterBar>

      {/* KPI chips */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Employees on Payroll" value={fmt(filtered.length)} />
          <MetricChip label="Monthly CTC"          value={fmtCurrency(totalMonthly)} />
          <MetricChip label="Annual CTC"           value={fmtCurrency(totalAnnual)} />
        </div>
      )}

      {/* Employee search */}
      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code, department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading salary register…" />}
      {!isLoading && !filtered.length && (
        <ReportEmpty
          message="No active compensation records found."
          guidance="Ensure employees have active salary structures set up in Compensation Master."
        />
      )}

      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th>Type</Th>
              <Th right>CTC Monthly</Th>
              <Th right>CTC Annual</Th>
              {(data?.component_columns ?? []).map(col => <Th key={col} right>{col}</Th>)}
              <Th>Effective From</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.employee_code} className="hover:bg-muted/20 transition-colors">
                <Td mono>{r.employee_code}</Td>
                <Td bold>{r.name}</Td>
                <Td>{r.department}</Td>
                <Td>{r.employment_type}</Td>
                <Td right bold>{fmtCurrency(r.ctc_monthly)}</Td>
                <Td right>{fmtCurrency(r.ctc_annual)}</Td>
                {(data?.component_columns ?? []).map(col => (
                  <Td key={col} right>
                    {r.components[col] ? fmtCurrency(r.components[col]) : '—'}
                  </Td>
                ))}
                <Td>{r.effective_from}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={4}>{filtered.length} employees</TdTotal>
              <TdTotal right bold>{fmtCurrency(totalMonthly)}</TdTotal>
              <TdTotal right>{fmtCurrency(totalAnnual)}</TdTotal>
              {(data?.component_columns ?? []).map(col => (
                <TdTotal key={col} right>
                  {fmtCurrency(filtered.reduce((s, r) => s + (r.components[col] ?? 0), 0))}
                </TdTotal>
              ))}
              <TdTotal />
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. STATUTORY COMPLIANCE REGISTER
// ─────────────────────────────────────────────────────────────────────────────

function StatutoryReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [scheme,  setScheme]  = useState('')
  const [empType, setEmpType] = useState('')
  const [deptId,  setDeptId]  = useState('')
  const [search,  setSearch]  = useState('')
  const [genAt,   setGenAt]   = useState<Date | null>(null)

  const params = new URLSearchParams({
    ...(scheme  ? { scheme }                   : {}),
    ...(empType ? { employment_type: empType } : {}),
    ...(deptId  ? { department_id:   deptId }  : {}),
  })

  const { data, isLoading, refetch, isFetching } = useQuery<StatutoryData>({
    queryKey: ['report-statutory', scheme, empType, deptId],
    queryFn:  async () => {
      const r = await api.get<StatutoryData>(`/reports/statutory?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const filtered = useMemo(() =>
    (data?.rows ?? []).filter(r =>
      matchSearch(search, r.employee_code, r.name, r.department, r.pan, r.uan)
    ), [data, search])

  const doExport = useCallback(() => {
    exportCSV(
      `statutory_register${scheme ? `_${scheme}` : ''}.csv`,
      filtered.map(r => ({
        'Employee Code':     r.employee_code,
        'Name':              r.name,
        'Department':        r.department,
        'Employment Type':   r.employment_type,
        'CTC Monthly (₹)':   r.ctc_monthly,
        'PAN':               r.pan ?? '',
        'UAN':               r.uan ?? '',
        'PF Number':         r.pf_number ?? '',
        'PF Employee (₹)':   r.pf_employee_monthly ?? '',
        'PF Employer (₹)':   r.pf_employer_monthly ?? '',
        'ESI Number':        r.esi_number ?? '',
        'ESI Applicable':    r.esi_applicable ? 'Yes' : 'No',
        'ESI Employee (₹)':  r.esi_employee_monthly ?? '',
        'ESI Employer (₹)':  r.esi_employer_monthly ?? '',
        'PT Applicable':     r.pt_applicable  ? 'Yes' : 'No',
        'LWF Applicable':    r.lwf_applicable ? 'Yes' : 'No',
        'Tax Regime':        r.tax_regime,
      })),
      `Statutory ${scheme ? scheme.toUpperCase() : ''} register`,
    )
  }, [filtered, scheme])

  const check = (v: boolean) =>
    v ? <span className="text-success font-semibold">✓</span>
      : <span className="text-muted-foreground/40">—</span>

  return (
    <div className="space-y-4">
      <FilterBar
        meta={
          <ReportMeta generatedAt={genAt} rows={filtered.length}
            context={
              <span className="flex items-center gap-2">
                <Link to={`${basePath}/payroll/statutory/epf`} className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                  EPF <ArrowUpRight className="h-2.5 w-2.5" />
                </Link>
                <Link to={`${basePath}/payroll/statutory/esi`} className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                  ESI <ArrowUpRight className="h-2.5 w-2.5" />
                </Link>
              </span>
            }
          />
        }
      >
        <FilterField label="Scheme">
          <select value={scheme} onChange={e => setScheme(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 w-36 text-foreground">
            <option value="">All schemes</option>
            <option value="pf">PF only</option>
            <option value="esi">ESI only</option>
            <option value="pt">PT only</option>
            <option value="lwf">LWF only</option>
          </select>
        </FilterField>
        <FilterField label="Employment type">
          <select value={empType} onChange={e => setEmpType(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 w-36 text-foreground">
            <option value="">All types</option>
            <option value="permanent">Permanent</option>
            <option value="contract">Contract</option>
            <option value="probation">Probation</option>
            <option value="intern">Intern</option>
          </select>
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doExport} disabled={!filtered.length} className="h-8 text-xs gap-1">
            <Download className="h-3 w-3" />
            Export CSV {filtered.length ? `(${filtered.length})` : ''}
          </Button>
        </div>
      </FilterBar>

      {/* KPI chips */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="PF Enrolled"     value={fmt(data.totals.pf_employees)} />
          <MetricChip label="ESI Covered"     value={fmt(data.totals.esi_employees)} />
          <MetricChip label="PT Applicable"   value={fmt(data.totals.pt_employees)} />
          <MetricChip label="LWF Applicable"  value={fmt(data.totals.lwf_employees)} />
          <MetricChip label="PF Total/mo"     value={fmtCurrency(data.totals.total_pf_employee + data.totals.total_pf_employer)} />
          <MetricChip label="ESI Total/mo"    value={fmtCurrency(data.totals.total_esi_employee + data.totals.total_esi_employer)} />
        </div>
      )}

      {/* Employee search */}
      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code, PAN, UAN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading statutory register…" />}
      {!isLoading && !filtered.length && (
        <ReportEmpty
          message="No statutory records match the selected filters."
          guidance="Verify that employee bank & statutory details are configured. Use the Scheme filter to narrow results."
        />
      )}

      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th right>CTC/mo</Th>
              <Th>PAN</Th>
              <Th>UAN</Th>
              <Th right>PF Emp.</Th>
              <Th right>PF Er.</Th>
              <Th>ESI No.</Th>
              <Th right>ESI Emp.</Th>
              <Th right>ESI Er.</Th>
              <Th>PT</Th>
              <Th>LWF</Th>
              <Th>Tax</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.employee_code} className="hover:bg-muted/20 transition-colors">
                <Td mono>{r.employee_code}</Td>
                <Td bold>{r.name}</Td>
                <Td>{r.department}</Td>
                <Td right bold>{fmtCurrency(r.ctc_monthly)}</Td>
                <Td mono>{r.pan ?? '—'}</Td>
                <Td mono>{r.uan ?? '—'}</Td>
                <Td right>{r.pf_employee_monthly != null ? fmtCurrency(r.pf_employee_monthly) : '—'}</Td>
                <Td right>{r.pf_employer_monthly != null ? fmtCurrency(r.pf_employer_monthly) : '—'}</Td>
                <Td mono>{r.esi_number ?? '—'}</Td>
                <Td right>{r.esi_employee_monthly != null ? fmtCurrency(r.esi_employee_monthly) : '—'}</Td>
                <Td right>{r.esi_employer_monthly != null ? fmtCurrency(r.esi_employer_monthly) : '—'}</Td>
                <Td>{check(r.pt_applicable)}</Td>
                <Td>{check(r.lwf_applicable)}</Td>
                <Td>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 rounded-sm font-normal">
                    {r.tax_regime}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={3}>{filtered.length} employees</TdTotal>
              <TdTotal right bold>{fmtCurrency(filtered.reduce((s, r) => s + r.ctc_monthly, 0))}</TdTotal>
              <TdTotal /><TdTotal />
              <TdTotal right bold>{fmtCurrency(filtered.reduce((s, r) => s + (r.pf_employee_monthly ?? 0), 0))}</TdTotal>
              <TdTotal right bold>{fmtCurrency(filtered.reduce((s, r) => s + (r.pf_employer_monthly ?? 0), 0))}</TdTotal>
              <TdTotal />
              <TdTotal right bold>{fmtCurrency(filtered.reduce((s, r) => s + (r.esi_employee_monthly ?? 0), 0))}</TdTotal>
              <TdTotal right bold>{fmtCurrency(filtered.reduce((s, r) => s + (r.esi_employer_monthly ?? 0), 0))}</TdTotal>
              <TdTotal /><TdTotal /><TdTotal />
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. MUSTER ROLL (server-generated .xlsx)
// ─────────────────────────────────────────────────────────────────────────────

// Reserved for future muster-roll cell rendering (not yet wired into the table)
const _STATUS_SHORT: Record<string, string> = {
  present: 'P', late: 'L', absent: 'A', half_day: 'H',
  leave: 'LV', holiday: 'HO', weekly_off: 'WO',
}
const _STATUS_CLS_CELL: Record<string, string> = {
  present:    'bg-success/20 text-success',
  late:       'bg-warning/20 text-warning',
  absent:     'bg-destructive/20 text-destructive',
  half_day:   'bg-muted text-muted-foreground',
  leave:      'bg-info/20 text-info',
  holiday:    'bg-info/20 text-info',
  weekly_off: 'bg-muted/30 text-muted-foreground/50',
}
void _STATUS_SHORT; void _STATUS_CLS_CELL // suppress unused-var until wired up

function MusterRollReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [month,      setMonth]      = usePayrollMonthState()
  const [deptId,     setDeptId]     = useState('')
  const [search,     setSearch]     = useState('')
  const [genAt,      setGenAt]      = useState<Date | null>(null)
  const [downloading, setDownloading] = useState(false)

  const params = new URLSearchParams({
    month,
    ...(deptId ? { department_id: deptId } : {}),
  })

  const { data, isLoading, isFetching, refetch } = useQuery<MusterData>({
    queryKey: ['report-muster', month, deptId],
    queryFn:  async () => {
      const r = await api.get<MusterData>(`/attendance/muster?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 120_000,
  })

  // Preview: compact employee × day summary (not the full grid — too wide for browser)
  const employees = data?.employees ?? []
  const filtered  = useMemo(() =>
    employees.filter(e => matchSearch(search, e.employee_code, e.name)),
    [employees, search],
  )

  // Derive dates from data
  const dates = useMemo(() => {
    if (!employees[0]) return []
    return employees[0]?.days?.map(d => d.date) ?? []
  }, [employees])

  // Per-employee summary counts for the preview table
  const summaries = useMemo(() => filtered.map(emp => {
    let P = 0, A = 0, L = 0, LV = 0, H = 0, payable = 0
    for (const d of emp.days) {
      if (!d.status) continue
      switch (d.status) {
        case 'present':    P++;    payable++; break
        case 'late':       L++;    payable++; break
        case 'absent':     A++;    break
        case 'half_day':   H++;    payable += 0.5; break
        case 'leave':      LV++;   payable++; break
        case 'holiday':    payable++; break
        case 'weekly_off': payable++; break
      }
    }
    return { emp, P, A, L, LV, H, payable, lop: Math.max(0, dates.length - payable) }
  }), [filtered, dates])

  const doDownload = useCallback(() => {
    const qs = new URLSearchParams({ month, ...(deptId ? { department_id: deptId } : {}) })
    downloadXlsx(
      `/reports/muster-roll/export?${qs}`,
      `Muster_Roll_${month}${deptId ? '_dept' : ''}.xlsx`,
      setDownloading,
    )
  }, [month, deptId])

  return (
    <div className="space-y-4">
      <FilterBar meta={
        <ReportMeta generatedAt={genAt} rows={filtered.length}
          context={<Link to={`${basePath}/attendance/muster`} className="flex items-center gap-0.5 text-primary hover:underline">Muster Roll <ArrowUpRight className="h-2.5 w-2.5" /></Link>}
        />
      }>
        <FilterField label="Payroll month">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doDownload} disabled={downloading || !data} className="h-8 text-xs gap-1.5">
            {downloading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            {downloading ? 'Generating…' : 'Download Excel'}
          </Button>
        </div>
      </FilterBar>

      {/* Excel export info banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-4 py-2.5 text-xs text-info-foreground">
        <Info className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
        <span>
          Excel export contains <strong>2 sheets</strong>: full day-by-day grid with freeze panes, plus a Summary sheet.
          The preview below shows totals only — open the Excel for the full grid.
        </span>
      </div>

      {/* KPI chips */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Employees" value={fmt(filtered.length)} />
          <MetricChip label="Working Days" value={fmt(dates.length)} />
          <MetricChip label="Total Absent" value={fmt(summaries.reduce((s, r) => s + r.A, 0))} highlight={summaries.reduce((s, r) => s + r.A, 0) > 0 ? 'destructive' : 'none'} />
          <MetricChip label="Total LOP"    value={fmt(summaries.reduce((s, r) => s + r.LV, 0))} />
        </div>
      )}

      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search by name or code…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs pl-8" />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading muster roll preview…" />}
      {!isLoading && !filtered.length && (
        <ReportEmpty
          message="No attendance data for this month."
          guidance="Process attendance for the selected month, then refresh."
        />
      )}

      {/* Summary preview table */}
      {summaries.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th right>Present</Th>
              <Th right>Late</Th>
              <Th right>Absent</Th>
              <Th right>Half Day</Th>
              <Th right>Leave</Th>
              <Th right>Payable Days</Th>
              <Th right>LOP (est.)</Th>
            </tr>
          </StickyThead>
          <tbody>
            {summaries.map(({ emp, P, A, L, LV, H, payable, lop }) => (
              <tr key={emp.employee_id} className={cn('hover:bg-muted/20 transition-colors', A >= 3 && 'bg-destructive/3')}>
                <Td mono>{emp.employee_code}</Td>
                <Td bold>{emp.name}</Td>
                <Td right highlight="success">{P}</Td>
                <Td right highlight={L > 0 ? 'warning' : undefined}>{L > 0 ? L : '—'}</Td>
                <Td right highlight={A > 0 ? (A >= 3 ? 'destructive' : 'warning') : undefined}>{A > 0 ? A : '—'}</Td>
                <Td right>{H > 0 ? H : '—'}</Td>
                <Td right>{LV > 0 ? LV : '—'}</Td>
                <Td right bold>{payable.toFixed(1)}</Td>
                <Td right highlight={lop > 0 ? 'destructive' : undefined}>{lop > 0 ? lop.toFixed(1) : '—'}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={2}>{filtered.length} employees · {fmtMonthFull(month)}</TdTotal>
              <TdTotal right bold>{summaries.reduce((s, r) => s + r.P, 0)}</TdTotal>
              <TdTotal right>{summaries.reduce((s, r) => s + r.L, 0)}</TdTotal>
              <TdTotal right>{summaries.reduce((s, r) => s + r.A, 0)}</TdTotal>
              <TdTotal right>{summaries.reduce((s, r) => s + r.H, 0)}</TdTotal>
              <TdTotal right>{summaries.reduce((s, r) => s + r.LV, 0)}</TdTotal>
              <TdTotal right bold>{summaries.reduce((s, r) => s + r.payable, 0).toFixed(1)}</TdTotal>
              <TdTotal right>{summaries.reduce((s, r) => s + r.lop, 0).toFixed(1)}</TdTotal>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SALARY SHEET (server-generated .xlsx from payroll_slips)
// ─────────────────────────────────────────────────────────────────────────────

function SalarySheetReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [month,       setMonth]       = usePayrollMonthState()
  const [deptId,      setDeptId]      = useState('')
  const [genAt,       setGenAt]       = useState<Date | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Load most recent payroll run for the month (for preview metadata)
  const { data: runsData, isLoading, isFetching, refetch } = useQuery<{ data: PayrollRunSummary[]; total: number }>({
    queryKey: ['report-salary-sheet-run', month],
    queryFn:  async () => {
      const r = await api.get<{ data: PayrollRunSummary[]; total: number }>(`/payroll/runs?limit=5`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  // Most recent run for this month
  const monthRun = useMemo(() =>
    (runsData?.data ?? []).find(r => r.month === month) ?? null,
    [runsData, month],
  )

  const doDownload = useCallback(() => {
    const qs = new URLSearchParams({
      month,
      ...(monthRun ? { run_id: monthRun.id } : {}),
      ...(deptId   ? { department_id: deptId } : {}),
    })
    downloadXlsx(
      `/reports/salary-sheet/export?${qs}`,
      `Salary_Sheet_${month}${monthRun ? `_${monthRun.status}` : ''}.xlsx`,
      setDownloading,
    )
  }, [month, deptId, monthRun])

  const RUN_STATUS_CLS: Record<string, string> = {
    finalized:  'bg-success/10 text-success border-success/20',
    draft:      'bg-warning/10 text-warning border-warning/20',
    processing: 'bg-info/10 text-info border-info/20',
    failed:     'bg-destructive/10 text-destructive border-destructive/20',
  }

  return (
    <div className="space-y-4">
      <FilterBar meta={
        <ReportMeta generatedAt={genAt} rows={monthRun?.employee_count ?? 0}
          context={<Link to={`${basePath}/payroll/runs`} className="flex items-center gap-0.5 text-primary hover:underline">Payroll Runs <ArrowUpRight className="h-2.5 w-2.5" /></Link>}
        />
      }>
        <FilterField label="Payroll month">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={doDownload}
            disabled={downloading || !monthRun}
            title={!monthRun ? 'No payroll run found for this month. Run payroll first.' : undefined}
            className="h-8 text-xs gap-1.5"
          >
            {downloading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            {downloading ? 'Generating…' : 'Download Excel'}
          </Button>
        </div>
      </FilterBar>

      {/* Excel export info */}
      <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-4 py-2.5 text-xs text-info-foreground">
        <Info className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
        <span>
          Excel export contains <strong>2 sheets</strong>: full Salary Sheet (all earnings, deductions, net pay per employee)
          plus a Department Summary. Requires a payroll run for the selected month.
        </span>
      </div>

      {isLoading && <ReportEmpty loading message="Loading payroll run details…" />}

      {!isLoading && !monthRun && (
        <div className="flex items-center gap-2.5 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            No payroll run found for <strong>{fmtMonthFull(month)}</strong>.
            {' '}<Link to={`${basePath}/payroll/runs`} className="underline hover:no-underline">Create a run first →</Link>
          </span>
        </div>
      )}

      {/* Run metadata card */}
      {monthRun && (
        <>
          <div className="flex flex-wrap gap-2">
            <MetricChip label="Employees"   value={fmt(monthRun.employee_count)} />
            <MetricChip label="Total Gross" value={fmtCurrency(monthRun.total_gross)} />
            <MetricChip label="Deductions"  value={fmtCurrency(monthRun.total_deductions)} />
            <MetricChip label="Total Net"   value={fmtCurrency(monthRun.total_net)} highlight="success" />
            <MetricChip label="LOP Total"   value={fmtCurrency(monthRun.total_lop_amount ?? 0)} highlight={(monthRun.total_lop_amount ?? 0) > 0 ? 'warning' : 'none'} />
          </div>

          {/* Run detail row */}
          <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Run status</span>
              <span className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                RUN_STATUS_CLS[monthRun.status] ?? 'bg-muted text-muted-foreground border-border',
              )}>
                {monthRun.status}
              </span>
            </div>
            {monthRun.finalized_at && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>Finalized</span>
                <span className="font-medium text-foreground">{monthRun.finalized_at.slice(0, 10)}</span>
              </div>
            )}
            {monthRun.status !== 'finalized' && (
              <div className="flex items-center gap-1.5 text-warning">
                <AlertTriangle className="h-3 w-3" />
                <span>Run is not finalized — export may contain preliminary figures.</span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <span>Run ID</span>
              <code className="font-mono text-[10px] text-foreground">{monthRun.id.slice(0, 8)}…</code>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. LEAVE REGISTER (server-generated .xlsx)
// ─────────────────────────────────────────────────────────────────────────────

function LeaveRegisterReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [from,        setFrom]        = useState(firstOfMonth())
  const [to,          setTo]          = useState(today())
  const [deptId,      setDeptId]      = useState('')
  const [leaveStatus, setLeaveStatus] = useState('ALL')
  const [search,      setSearch]      = useState('')
  const [genAt,       setGenAt]       = useState<Date | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Load leave types for display
  const { data: leaveTypesData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    staleTime: 300_000,
  })
  const leaveTypes = leaveTypesData?.data ?? [] // reserved for leave-type filter dropdown
  void leaveTypes

  // Preview data from leave-requests JSON endpoint
  const previewParams = new URLSearchParams({
    from_date: from,
    to_date:   to,
    limit:     '200',
    ...(leaveStatus !== 'ALL' ? { status: leaveStatus } : {}),
  })

  const { data: previewData, isLoading, isFetching, refetch } = useQuery<{ data: any[] }>({
    queryKey: ['report-leave-register', from, to, deptId, leaveStatus],
    queryFn:  async () => {
      const r = await api.get<{ data: any[] }>(`/leave-requests?${previewParams}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const allRows = previewData?.data ?? []

  // Client-side dept + name filter for preview
  const filtered = useMemo(() =>
    allRows.filter((r: any) => {
      if (search && !matchSearch(search, r.employee?.employee_code, r.employee?.first_name, r.employee?.last_name)) return false
      return true
    }),
    [allRows, search],
  )

  const totalDays = useMemo(() =>
    filtered.reduce((s: number, r: any) => s + Number(r.computed_days ?? 0), 0),
    [filtered],
  )

  const doDownload = useCallback(() => {
    const qs = new URLSearchParams({
      from,
      to,
      status: leaveStatus,
      ...(deptId ? { department_id: deptId } : {}),
    })
    downloadXlsx(
      `/reports/leave-register/export?${qs}`,
      `Leave_Register_${from}_to_${to}_${leaveStatus.toLowerCase()}.xlsx`,
      setDownloading,
    )
  }, [from, to, deptId, leaveStatus])

  const STATUS_BADGE: Record<string, string> = {
    APPROVED:  'bg-success/10 text-success border-success/20',
    PENDING:   'bg-warning/10 text-warning border-warning/20',
    REJECTED:  'bg-destructive/10 text-destructive border-destructive/20',
    CANCELLED: 'bg-muted text-muted-foreground border-border',
  }

  return (
    <div className="space-y-4">
      <FilterBar meta={
        <ReportMeta generatedAt={genAt} rows={filtered.length}
          context={
            <span className="flex items-center gap-2">
              <Link to={`${basePath}/attendance/leave-requests`} className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Leave Requests <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
            </span>
          }
        />
      }>
        <FilterField label="From date">
          <DateInput value={from} onChange={setFrom} className="h-8 text-xs w-36" />
        </FilterField>
        <FilterField label="To date">
          <DateInput value={to} min={from} onChange={setTo} className="h-8 text-xs w-36" />
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <FilterField label="Status">
          <select
            value={leaveStatus}
            onChange={e => setLeaveStatus(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 w-36 text-foreground"
          >
            <option value="ALL">All statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING">Pending</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </FilterField>
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doDownload} disabled={downloading || !filtered.length} className="h-8 text-xs gap-1.5">
            {downloading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            {downloading ? 'Generating…' : `Download Excel${filtered.length ? ` (${filtered.length})` : ''}`}
          </Button>
        </div>
      </FilterBar>

      {/* Export info */}
      <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-4 py-2.5 text-xs text-info-foreground">
        <Info className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
        <span>
          Excel export contains <strong>2 sheets</strong>: detailed leave register (all requests) plus
          an Employee Summary pivot (days taken per leave type per employee).
        </span>
      </div>

      {/* KPI chips */}
      {previewData && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Total Requests" value={fmt(filtered.length)} />
          <MetricChip label="Total Days"     value={totalDays.toFixed(1)} />
          <MetricChip label="Approved"       value={fmt(filtered.filter((r: any) => r.status === 'APPROVED').length)} highlight="success" />
          <MetricChip label="Pending"        value={fmt(filtered.filter((r: any) => r.status === 'PENDING').length)} highlight={filtered.filter((r: any) => r.status === 'PENDING').length > 0 ? 'warning' : 'none'} />
        </div>
      )}

      {/* Search */}
      {previewData && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search by name or employee code…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs pl-8" />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading leave register…" />}
      {!isLoading && !filtered.length && (
        <ReportEmpty
          message="No leave requests match the selected filters."
          guidance="Adjust the date range or status filter. Leave requests appear here once submitted by employees."
        />
      )}

      {/* Preview table */}
      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Leave Type</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th right>Days</Th>
              <Th>Session</Th>
              <Th>Status</Th>
              <Th>Applied On</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map((r: any, i: number) => {
              const emp = r.employee ?? r.employees
              const lt  = Array.isArray(r.leave_types) ? r.leave_types[0] : r.leave_types
              return (
                <tr key={r.id ?? i} className="hover:bg-muted/20 transition-colors">
                  <Td mono>{emp?.employee_code ?? '—'}</Td>
                  <Td bold>{emp ? `${emp.first_name} ${emp.last_name}` : '—'}</Td>
                  <Td>{lt?.name ?? r.leave_type_name ?? '—'}</Td>
                  <Td>{r.from_date}</Td>
                  <Td>{r.to_date}</Td>
                  <Td right bold>{Number(r.computed_days ?? 0).toFixed(1)}</Td>
                  <Td>{r.session ?? 'full_day'}</Td>
                  <Td>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-medium border',
                      STATUS_BADGE[r.status] ?? 'bg-muted text-muted-foreground border-border',
                    )}>
                      {r.status}
                    </span>
                  </Td>
                  <Td>{r.created_at ? String(r.created_at).slice(0, 10) : '—'}</Td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={5}>{filtered.length} request{filtered.length !== 1 ? 's' : ''}</TdTotal>
              <TdTotal right bold>{totalDays.toFixed(1)}</TdTotal>
              <TdTotal /><TdTotal /><TdTotal />
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PAYROLL REGISTER WITH BANK DETAILS (finance disbursement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SECURITY NOTE — Account Number Display
 * Account numbers in this preview are always masked to XXXX{last4} by the
 * backend before the response is sent.  The Excel export (hr_admin only)
 * returns the values as stored in employee_bank_statutory; full account
 * numbers may appear there if they were entered during onboarding.
 * Treat the downloaded file as a financial document.
 */

const PAYMENT_STATUS_CLS: Record<string, string> = {
  READY:        'bg-success/10 text-success border-success/20',
  MISSING_BANK: 'bg-destructive/10 text-destructive border-destructive/20',
  ON_HOLD:      'bg-warning/10 text-warning border-warning/20',
  PENDING:      'bg-muted text-muted-foreground border-border',
}
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  READY:        'READY',
  MISSING_BANK: 'MISSING BANK',
  ON_HOLD:      'ON HOLD',
  PENDING:      'PENDING',
}
const SLIP_STATUS_CLS: Record<string, string> = {
  finalized: 'bg-success/10 text-success border-success/20',
  draft:     'bg-muted text-muted-foreground border-border',
  held:      'bg-destructive/10 text-destructive border-destructive/20',
}
const RUN_STATUS_CLS: Record<string, string> = {
  finalized:  'bg-success/10 text-success border-success/20',
  draft:      'bg-warning/10 text-warning border-warning/20',
  processing: 'bg-info/10 text-info border-info/20',
  failed:     'bg-destructive/10 text-destructive border-destructive/20',
}

function PayrollRegisterReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [month,        setMonth]        = usePayrollMonthState()
  const [deptId,       setDeptId]       = useState('')
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [genAt,        setGenAt]        = useState<Date | null>(null)
  const [downloading,  setDownloading]  = useState(false)

  const params = new URLSearchParams({
    month,
    ...(deptId ? { department_id: deptId } : {}),
  })

  const { data, isLoading, isFetching, refetch } = useQuery<PayrollRegisterData>({
    queryKey: ['report-payroll-register', month, deptId],
    queryFn:  async () => {
      const r = await api.get<PayrollRegisterData>(`/reports/payroll-register?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const allRows = data?.rows ?? []

  const filtered = useMemo(() => {
    let rows = allRows
    if (statusFilter !== 'ALL') rows = rows.filter(r => r.payment_status === statusFilter)
    if (search) rows = rows.filter(r =>
      matchSearch(search, r.employee_code, r.name, r.department, r.bank_name, r.ifsc_code)
    )
    return rows
  }, [allRows, statusFilter, search])

  const doDownload = useCallback(() => {
    const qs = new URLSearchParams({ month, ...(deptId ? { department_id: deptId } : {}) })
    downloadXlsx(
      `/reports/payroll-register/export?${qs}`,
      `Payroll_Register_${month}.xlsx`,
      setDownloading,
    )
  }, [month, deptId])

  const s = data?.summary
  const runInfo = data?.run

  // Totals across currently-filtered rows for the footer
  const fGross      = filtered.reduce((acc, r) => acc + r.gross_pay,        0)
  const fDeductions = filtered.reduce((acc, r) => acc + r.total_deductions, 0)
  const fNet        = filtered.reduce((acc, r) => acc + r.net_pay,          0)

  return (
    <div className="space-y-4">
      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <FilterBar meta={
        <ReportMeta generatedAt={genAt} rows={filtered.length}
          context={
            <span className="flex items-center gap-3">
              <Link to={`${basePath}/payroll/runs`}
                className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Payroll Runs <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
              <Link to={`${basePath}/people`}
                className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Employee Bank Details <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
            </span>
          }
        />
      }>
        <FilterField label="Payroll month">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <FilterField label="Status">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 w-40 text-foreground"
          >
            <option value="ALL">All statuses</option>
            <option value="READY">Ready to Pay</option>
            <option value="MISSING_BANK">Missing Bank</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="PENDING">Pending</option>
          </select>
        </FilterField>
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doDownload} disabled={downloading || !data?.run_found} className="h-8 text-xs gap-1.5"
            title={!data?.run_found ? 'No payroll run found for this month' : undefined}>
            {downloading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            {downloading ? 'Generating…' : 'Download Excel'}
          </Button>
        </div>
      </FilterBar>

      {/* ── Security note ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-xs text-warning-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
        <span>
          <strong>Sensitive financial data.</strong>{' '}
          Account numbers in this preview are masked. The Excel export contains full account numbers
          as stored in the system — restrict distribution to authorised finance personnel and delete
          after disbursement is confirmed.
        </span>
      </div>

      {/* ── No-run warning ────────────────────────────────────────────────── */}
      {data && !data.run_found && (
        <div className="flex items-center gap-2.5 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            No payroll run found for <strong>{fmtMonthFull(month)}</strong>.
            {' '}<Link to={`${basePath}/payroll/runs`} className="underline hover:no-underline">Create a payroll run →</Link>
          </span>
        </div>
      )}

      {/* ── Unfinalized-run warning ───────────────────────────────────────── */}
      {runInfo && runInfo.status !== 'finalized' && (
        <div className="flex items-center gap-2.5 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Payroll run is <strong>{runInfo.status}</strong> — not yet finalized.
            Net pay figures are preliminary. Finalize the run before disbursing salary.
          </span>
        </div>
      )}

      {/* ── Missing bank details alert ────────────────────────────────────── */}
      {(s?.missing_bank_count ?? 0) > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>{s!.missing_bank_count} employee{s!.missing_bank_count !== 1 ? 's' : ''}</strong>{' '}
            have finalized payslips but are missing bank / IFSC details.
            Salary cannot be disbursed until bank details are added.{' '}
            {statusFilter !== 'MISSING_BANK' && (
              <button
                onClick={() => setStatusFilter('MISSING_BANK')}
                className="underline font-semibold hover:no-underline"
              >
                Show missing only →
              </button>
            )}
          </span>
        </div>
      )}

      {/* ── Run status row ────────────────────────────────────────────────── */}
      {runInfo && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-xs flex-wrap">
          <span className="text-muted-foreground">Payroll run</span>
          <span className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
            RUN_STATUS_CLS[runInfo.status] ?? 'bg-muted text-muted-foreground border-border',
          )}>
            {runInfo.status}
          </span>
          <code className="font-mono text-[10px] text-muted-foreground">{runInfo.id.slice(0, 8)}…</code>
          {runInfo.finalized_at && (
            <span className="text-muted-foreground">
              Finalized: <span className="font-medium text-foreground">{String(runInfo.finalized_at).slice(0, 10)}</span>
            </span>
          )}
          <Link to={`${basePath}/payroll/runs`}
            className="ml-auto flex items-center gap-0.5 text-primary hover:underline text-[11px]">
            Open Run <ArrowUpRight className="h-2.5 w-2.5" />
          </Link>
        </div>
      )}

      {/* ── KPI chips ─────────────────────────────────────────────────────── */}
      {s && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Total Employees"   value={String(s.total_employees)} />
          <MetricChip label="Payment Ready"     value={String(s.ready_count)} highlight={s.ready_count > 0 ? 'success' : 'none'} />
          <MetricChip label="Missing Bank"      value={String(s.missing_bank_count)} highlight={s.missing_bank_count > 0 ? 'destructive' : 'none'} />
          <MetricChip label="On Hold"           value={String(s.on_hold_count)} highlight={s.on_hold_count > 0 ? 'warning' : 'none'} />
          <MetricChip label="Total Net Pay"     value={fmtCurrency(s.total_net)} />
          <MetricChip label="Ready to Disburse" value={fmtCurrency(s.ready_net)} highlight="success" />
          {s.on_hold_net > 0 && (
            <MetricChip label="On Hold Net" value={fmtCurrency(s.on_hold_net)} highlight="warning" />
          )}
        </div>
      )}

      {/* ── Search ────────────────────────────────────────────────────────── */}
      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code, bank name, or IFSC…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading payroll register…" />}
      {!isLoading && data && !filtered.length && (
        <ReportEmpty
          message={statusFilter !== 'ALL' ? `No employees with status "${PAYMENT_STATUS_LABEL[statusFilter] ?? statusFilter}".` : 'No payroll slips found for this run.'}
          guidance={statusFilter !== 'ALL' ? 'Try changing the status filter or check the selected month.' : 'Ensure a payroll run has been processed for this month.'}
        />
      )}

      {/* ── Disbursement table ────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th>Bank</Th>
              <Th>Acct. No (masked)</Th>
              <Th>IFSC</Th>
              <Th>Type</Th>
              <Th right>Gross Pay</Th>
              <Th right>Deductions</Th>
              <Th right>Net Pay</Th>
              <Th>Slip</Th>
              <Th>Status</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map((r: PayrollRegisterRow) => {
              const isOnHold  = r.payment_status === 'ON_HOLD'
              const isMissing = r.payment_status === 'MISSING_BANK'
              return (
                <tr
                  key={r.employee_id}
                  className={cn(
                    'hover:bg-muted/20 transition-colors',
                    isOnHold  && 'bg-warning/5',
                    isMissing && 'bg-destructive/5',
                  )}
                >
                  <Td mono>{r.employee_code}</Td>
                  <Td bold>{r.name}</Td>
                  <Td>{r.department}</Td>

                  {/* Bank details */}
                  <Td highlight={isMissing && !r.bank_name ? 'destructive' : undefined}>
                    {r.bank_name ?? <span className="text-destructive font-semibold">MISSING</span>}
                  </Td>
                  <Td mono highlight={isMissing && !r.account_number ? 'destructive' : undefined}>
                    {r.account_number
                      ? <span className="tracking-wider">{r.account_number}</span>
                      : <span className="text-destructive font-semibold">MISSING</span>}
                  </Td>
                  <Td mono highlight={isMissing && !r.ifsc_code ? 'destructive' : undefined}>
                    {r.ifsc_code ?? <span className="text-destructive font-semibold">MISSING</span>}
                  </Td>
                  <Td muted>{r.account_type ?? '—'}</Td>

                  {/* Pay figures */}
                  <Td right>{fmtCurrency(r.gross_pay)}</Td>
                  <Td right highlight={r.total_deductions > 0 ? 'warning' : undefined}>
                    {r.total_deductions > 0 ? fmtCurrency(r.total_deductions) : '—'}
                  </Td>
                  <Td right bold>{fmtCurrency(r.net_pay)}</Td>

                  {/* Slip status */}
                  <Td>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-medium border',
                      SLIP_STATUS_CLS[r.slip_status] ?? 'bg-muted text-muted-foreground border-border',
                    )}>
                      {r.slip_status}
                    </span>
                  </Td>

                  {/* Payment status */}
                  <Td>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                      PAYMENT_STATUS_CLS[r.payment_status] ?? 'bg-muted text-muted-foreground border-border',
                    )}
                      title={isOnHold && r.held_reason ? `Held: ${r.held_reason}` : undefined}
                    >
                      {PAYMENT_STATUS_LABEL[r.payment_status] ?? r.payment_status}
                    </span>
                    {isOnHold && r.held_reason && (
                      <p className="text-[10px] text-warning mt-0.5 max-w-[160px] truncate" title={r.held_reason}>
                        {r.held_reason}
                      </p>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={7}>{filtered.length} employees · {fmtMonthFull(month)}</TdTotal>
              <TdTotal right bold>{fmtCurrency(fGross)}</TdTotal>
              <TdTotal right>{fmtCurrency(fDeductions)}</TdTotal>
              <TdTotal right bold>{fmtCurrency(fNet)}</TdTotal>
              <TdTotal />
              <TdTotal>
                {filtered.filter(r => r.payment_status === 'READY').length > 0 && (
                  <span className="text-success font-semibold">
                    {filtered.filter(r => r.payment_status === 'READY').length} ready
                  </span>
                )}
              </TdTotal>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. ATTENDANCE vs PAYROLL COMPARISON (cross-module reconciliation)
// ─────────────────────────────────────────────────────────────────────────────

function AttendancePayrollReport({ departments, basePath }: { departments: Department[]; basePath: string }) {
  const [month,        setMonth]        = usePayrollMonthState()
  const [deptId,       setDeptId]       = useState('')
  const [mismatchOnly, setMismatchOnly] = useState(false)
  const [search,       setSearch]       = useState('')
  const [genAt,        setGenAt]        = useState<Date | null>(null)
  const [downloading,  setDownloading]  = useState(false)

  const params = new URLSearchParams({
    month,
    ...(deptId ? { department_id: deptId } : {}),
  })

  const { data, isLoading, isFetching, refetch } = useQuery<ComparisonData>({
    queryKey: ['report-att-payroll', month, deptId],
    queryFn:  async () => {
      const r = await api.get<ComparisonData>(`/reports/attendance-payroll-comparison?${params}`)
      setGenAt(new Date())
      return r
    },
    staleTime: 60_000,
  })

  const allRows = data?.rows ?? []

  const filtered = useMemo(() => {
    let rows = allRows
    if (mismatchOnly) rows = rows.filter(r => r.is_mismatch || !r.has_payroll_slip)
    if (search) rows = rows.filter(r => matchSearch(search, r.employee_code, r.name, r.department))
    return rows
  }, [allRows, mismatchOnly, search])

  const doDownload = useCallback(() => {
    const qs = new URLSearchParams({ month, ...(deptId ? { department_id: deptId } : {}) })
    downloadXlsx(
      `/reports/attendance-payroll-comparison/export?${qs}`,
      `Att_Payroll_Comparison_${month}${deptId ? '_dept' : ''}.xlsx`,
      setDownloading,
    )
  }, [month, deptId])

  const RUN_STATUS_CLS: Record<string, string> = {
    finalized:  'bg-success/10 text-success border-success/20',
    draft:      'bg-warning/10 text-warning border-warning/20',
    processing: 'bg-info/10 text-info border-info/20',
    failed:     'bg-destructive/10 text-destructive border-destructive/20',
  }

  // Running totals for the footer — computed from the currently-filtered rows
  const slippedRows = filtered.filter(r => r.has_payroll_slip)
  const totalAttPayable = filtered.reduce((s, r) => s + (r.att_payable_days ?? 0), 0)
  const totalPrPayable  = slippedRows.reduce((s, r) => s + (r.payroll_payable_days ?? 0), 0)
  const totalDiffPay    = slippedRows.reduce((s, r) => s + (r.diff_payable ?? 0), 0)
  const totalAttLop     = filtered.reduce((s, r) => s + (r.att_lop_days ?? 0), 0)
  const totalPrLop      = slippedRows.reduce((s, r) => s + (r.payroll_lop_days ?? 0), 0)
  const totalDiffLop    = slippedRows.reduce((s, r) => s + (r.diff_lop ?? 0), 0)
  const visibleMismatches = filtered.filter(r => r.is_mismatch).length

  return (
    <div className="space-y-4">
      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <FilterBar meta={
        <ReportMeta generatedAt={genAt} rows={filtered.length}
          context={
            <span className="flex items-center gap-3">
              <Link to={`${basePath}/payroll/runs`}
                className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Payroll Runs <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
              <Link to={`${basePath}/attendance/anomalies`}
                className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Anomalies <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
              <Link to={`${basePath}/attendance/leave-requests`}
                className="flex items-center gap-0.5 text-primary hover:underline text-[11px]">
                Leave Requests <ArrowUpRight className="h-2.5 w-2.5" />
              </Link>
            </span>
          }
        />
      }>
        <FilterField label="Payroll month">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <DeptSelect value={deptId} onChange={setDeptId} departments={departments} />
        <FilterField label="View">
          <button
            onClick={() => setMismatchOnly(v => !v)}
            className={cn(
              'h-8 px-3 text-xs rounded-md border transition-colors',
              mismatchOnly
                ? 'bg-destructive/10 border-destructive/30 text-destructive font-semibold'
                : 'bg-background border-input text-muted-foreground hover:bg-muted',
            )}
          >
            {mismatchOnly ? '⚠ Mismatches only' : 'All employees'}
          </button>
        </FilterField>
        <div className="flex items-end gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8 text-xs gap-1">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} /> Refresh
          </Button>
          <Button size="sm" onClick={doDownload} disabled={downloading || !data} className="h-8 text-xs gap-1.5">
            {downloading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            {downloading ? 'Generating…' : 'Download Excel'}
          </Button>
        </div>
      </FilterBar>

      {/* ── Info banner ───────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-4 py-2.5 text-xs text-info-foreground">
        <Info className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
        <span>
          Compares <strong>attendance_daily</strong> payable / LOP days against the most recent{' '}
          <strong>payroll run</strong> for {data ? fmtMonthFull(month) : month}.
          A row is flagged <strong className="text-destructive">MISMATCH</strong> when attendance
          and payroll differ by more than 0.01 days.
          Excel export includes a dedicated <em>Mismatches</em> sheet for payroll team handoff.
        </span>
      </div>

      {/* ── No-run warning ────────────────────────────────────────────────── */}
      {data && !data.run_found && (
        <div className="flex items-center gap-2.5 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            No payroll run found for <strong>{fmtMonthFull(month)}</strong>.
            Payroll columns will show "—" until a run is processed.{' '}
            <Link to={`${basePath}/payroll/runs`} className="underline hover:no-underline">
              Create a run →
            </Link>
          </span>
        </div>
      )}

      {/* ── Mismatch alert ────────────────────────────────────────────────── */}
      {(data?.summary?.mismatch_count ?? 0) > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>
              {data!.summary.mismatch_count} employee{data!.summary.mismatch_count !== 1 ? 's' : ''}
            </strong>{' '}
            have attendance / payroll mismatches.
            Recompute attendance for affected employees before finalizing payroll.
            {!mismatchOnly && (
              <button
                onClick={() => setMismatchOnly(true)}
                className="ml-2 underline font-semibold hover:no-underline"
              >
                Show mismatches only →
              </button>
            )}
          </span>
        </div>
      )}

      {/* ── Run status row ────────────────────────────────────────────────── */}
      {data?.run_found && data.run_status && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-xs flex-wrap">
          <span className="text-muted-foreground">Payroll run</span>
          <span className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
            RUN_STATUS_CLS[data.run_status] ?? 'bg-muted text-muted-foreground border-border',
          )}>
            {data.run_status}
          </span>
          {data.run_id && (
            <code className="font-mono text-[10px] text-muted-foreground">{data.run_id.slice(0, 8)}…</code>
          )}
          {data.run_status !== 'finalized' && (
            <span className="flex items-center gap-1 text-warning text-[11px]">
              <AlertTriangle className="h-3 w-3" />
              Not finalized — figures may change before payroll is closed
            </span>
          )}
          <Link
            to={`${basePath}/payroll/runs`}
            className="ml-auto flex items-center gap-0.5 text-primary hover:underline text-[11px]"
          >
            Open Run <ArrowUpRight className="h-2.5 w-2.5" />
          </Link>
        </div>
      )}

      {/* ── KPI chips ─────────────────────────────────────────────────────── */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <MetricChip label="Employees"       value={String(data.summary.total_employees)} />
          <MetricChip
            label="Mismatches"
            value={String(data.summary.mismatch_count)}
            highlight={data.summary.mismatch_count > 0 ? 'destructive' : 'success'}
          />
          <MetricChip
            label="No Payroll Slip"
            value={String(data.summary.no_slip_count)}
            highlight={data.summary.no_slip_count > 0 ? 'warning' : 'none'}
          />
          <MetricChip
            label="No Attendance"
            value={String(data.summary.no_attendance_count)}
            highlight={data.summary.no_attendance_count > 0 ? 'warning' : 'none'}
          />
          {mismatchOnly && filtered.length < allRows.length && (
            <MetricChip label="Showing" value={String(filtered.length)} highlight="warning" />
          )}
        </div>
      )}

      {/* ── Search ────────────────────────────────────────────────────────── */}
      {data && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, code, or department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      )}

      {isLoading && <ReportEmpty loading message="Loading comparison report…" />}
      {!isLoading && data && !filtered.length && (
        <ReportEmpty
          message={mismatchOnly
            ? 'No mismatches found for this month.'
            : 'No employee data found for the selected filters.'}
          guidance={mismatchOnly
            ? 'All employees reconcile correctly between attendance and payroll for this month.'
            : 'Ensure attendance has been processed and a payroll run exists for this month.'}
        />
      )}

      {/* ── Comparison table ──────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <TableWrap>
          <StickyThead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              {/* Attendance columns */}
              <Th right>Att. Payable</Th>
              <Th right>PR Payable</Th>
              <Th right>Δ Pay</Th>
              {/* LOP columns */}
              <Th right>Att. LOP</Th>
              <Th right>PR LOP</Th>
              <Th right>Δ LOP</Th>
              {/* Cross-module signals */}
              <Th>Last Recompute</Th>
              <Th right>Anomalies</Th>
              <Th right>Pending Leave</Th>
              {/* Flag */}
              <Th>Status</Th>
            </tr>
          </StickyThead>
          <tbody>
            {filtered.map((r: ComparisonRow) => {
              const isMismatch = r.is_mismatch
              const noSlip     = !r.has_payroll_slip
              return (
                <tr
                  key={r.employee_id}
                  className={cn(
                    'hover:bg-muted/20 transition-colors',
                    isMismatch && 'bg-destructive/5',
                  )}
                >
                  <Td mono>{r.employee_code}</Td>
                  <Td bold>{r.name}</Td>
                  <Td>{r.department}</Td>

                  {/* Attendance payable */}
                  <Td right bold>{(r.att_payable_days ?? 0).toFixed(1)}</Td>

                  {/* Payroll payable */}
                  <Td right>
                    {noSlip
                      ? <span className="text-muted-foreground/40">—</span>
                      : (r.payroll_payable_days ?? 0).toFixed(1)}
                  </Td>

                  {/* Δ payable */}
                  <Td right highlight={
                    isMismatch && Math.abs(r.diff_payable ?? 0) > 0.01
                      ? ((r.diff_payable ?? 0) > 0 ? 'warning' : 'destructive')
                      : undefined
                  }>
                    {noSlip
                      ? '—'
                      : (r.diff_payable ?? 0) === 0
                        ? <span className="text-success">✓</span>
                        : (r.diff_payable ?? 0) > 0
                          ? `+${(r.diff_payable ?? 0).toFixed(2)}`
                          : (r.diff_payable ?? 0).toFixed(2)}
                  </Td>

                  {/* Attendance LOP */}
                  <Td right>
                    {(r.att_lop_days ?? 0) > 0
                      ? <span className="text-warning font-semibold">{(r.att_lop_days ?? 0).toFixed(1)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </Td>

                  {/* Payroll LOP */}
                  <Td right>
                    {noSlip
                      ? <span className="text-muted-foreground/40">—</span>
                      : (r.payroll_lop_days ?? 0) > 0
                        ? (r.payroll_lop_days ?? 0).toFixed(1)
                        : <span className="text-muted-foreground/40">—</span>}
                  </Td>

                  {/* Δ LOP */}
                  <Td right highlight={
                    isMismatch && Math.abs(r.diff_lop ?? 0) > 0.01 ? 'destructive' : undefined
                  }>
                    {noSlip || (r.diff_lop ?? 0) === 0
                      ? <span className="text-muted-foreground/40">—</span>
                      : (r.diff_lop ?? 0) > 0
                        ? `+${(r.diff_lop ?? 0).toFixed(2)}`
                        : (r.diff_lop ?? 0).toFixed(2)}
                  </Td>

                  {/* Last recompute */}
                  <Td muted>
                    {r.last_recompute
                      ? <span className="font-mono text-[10px]">{r.last_recompute.slice(0, 10)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </Td>

                  {/* Pending anomalies — link to anomaly page */}
                  <Td right>
                    {r.pending_anomalies > 0
                      ? (
                          <Link
                            to={`${basePath}/attendance/anomalies`}
                            className="text-destructive font-semibold hover:underline"
                          >
                            {r.pending_anomalies}
                          </Link>
                        )
                      : <span className="text-muted-foreground/40">—</span>}
                  </Td>

                  {/* Pending leave approvals — link to leave-requests page */}
                  <Td right>
                    {r.pending_leaves > 0
                      ? (
                          <Link
                            to={`${basePath}/attendance/leave-requests`}
                            className="text-warning font-semibold hover:underline"
                          >
                            {r.pending_leaves}
                          </Link>
                        )
                      : <span className="text-muted-foreground/40">—</span>}
                  </Td>

                  {/* Status badge */}
                  <Td>
                    {noSlip
                      ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-muted text-muted-foreground border-border">
                            NO SLIP
                          </span>
                        )
                      : isMismatch
                        ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-destructive/10 text-destructive border-destructive/20">
                              MISMATCH
                            </span>
                          )
                        : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-success/10 text-success border-success/20">
                              OK
                            </span>
                          )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <TdTotal bold colSpan={3}>{filtered.length} employees · {fmtMonthFull(month)}</TdTotal>
              <TdTotal right bold>{totalAttPayable.toFixed(1)}</TdTotal>
              <TdTotal right bold>{totalPrPayable.toFixed(1)}</TdTotal>
              <TdTotal right highlight={Math.abs(totalDiffPay) > 0.01 ? 'destructive' : undefined}>
                {totalDiffPay === 0
                  ? '—'
                  : totalDiffPay > 0
                    ? `+${totalDiffPay.toFixed(2)}`
                    : totalDiffPay.toFixed(2)}
              </TdTotal>
              <TdTotal right>{totalAttLop > 0 ? totalAttLop.toFixed(1) : '—'}</TdTotal>
              <TdTotal right>{totalPrLop  > 0 ? totalPrLop.toFixed(1)  : '—'}</TdTotal>
              <TdTotal right highlight={Math.abs(totalDiffLop) > 0.01 ? 'destructive' : undefined}>
                {totalDiffLop === 0
                  ? '—'
                  : totalDiffLop > 0
                    ? `+${totalDiffLop.toFixed(2)}`
                    : totalDiffLop.toFixed(2)}
              </TdTotal>
              <TdTotal /><TdTotal /><TdTotal />
              <TdTotal>
                {visibleMismatches > 0
                  ? <span className="text-destructive font-semibold">{visibleMismatches} mismatch{visibleMismatches !== 1 ? 'es' : ''}</span>
                  : <span className="text-success">✓ All OK</span>}
              </TdTotal>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </div>
  )
}

// ── Shared helpers for new report tabs ────────────────────────────────────────

function fmtMonthFull(m: string): string {
  const [y, mon] = m.split('-').map(Number)
  return new Date(y, mon - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

// Tabs visible to managers (team-level, no salary/statutory/payroll data)
const MANAGER_TABS = new Set(['headcount', 'attendance', 'muster', 'leave-register'])

export function Reports() {
  const { profile } = useAuthStore()
  const basePath = useBasePath()

  const role    = profile?.role ?? ''
  const isAdmin = ['super_admin', 'hr_admin'].includes(role)
  const isMgr   = role === 'manager'

  // Neither admin nor manager — fully blocked
  if (!isAdmin && !isMgr) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-sm text-muted-foreground font-medium">Access restricted to HR administrators.</p>
      </div>
    )
  }

  // Departments list — shared across all tabs
  const { data: deptData } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
    staleTime: 300_000,
  })
  const departments = deptData?.data ?? []

  // Full catalog — filtered per role before render
  const ALL_CATALOG = [
    { icon: Users,          label: 'Headcount & Attrition',      desc: 'Workforce visibility · joiner / separation trend',          tab: 'headcount'          },
    { icon: Clock,          label: 'Attendance & LOP',            desc: 'Per-employee attendance · loss-of-pay analysis',            tab: 'attendance'         },
    { icon: Briefcase,      label: 'Salary Register',             desc: 'Monthly CTC · component breakdown · payroll base',         tab: 'salary'             },
    { icon: ShieldCheck,    label: 'Statutory Compliance',        desc: 'PF · ESI · PT · LWF register (India)',                     tab: 'statutory'          },
    { icon: CalendarDays,   label: 'Muster Roll',                 desc: 'Daily attendance grid · .xlsx export · server-generated',  tab: 'muster'             },
    { icon: Banknote,       label: 'Salary Sheet',                desc: 'Processed payslip register · earnings & deductions',       tab: 'salary-sheet'       },
    { icon: BookOpen,       label: 'Leave Register',              desc: 'Leave request log · employee summary pivot · .xlsx',       tab: 'leave-register'     },
    { icon: ArrowLeftRight, label: 'Att. vs Payroll Comparison',  desc: 'Cross-module reconciliation · mismatch detection · .xlsx', tab: 'comparison'         },
    { icon: CreditCard,     label: 'Payroll Register',            desc: 'Bank disbursement register · masked preview · full .xlsx', tab: 'payroll-register'   },
  ]
  const catalog = isAdmin ? ALL_CATALOG : ALL_CATALOG.filter(c => MANAGER_TABS.has(c.tab))

  return (
    <PageContainer>
      <PageHeader
        title="Team Reports"
        subtitle={
          isAdmin
            ? 'Operational HR reporting — headcount, attendance, payroll, and statutory compliance'
            : 'Team attendance, headcount, leave, and muster roll reports'
        }
        breadcrumb={[{ label: 'Reports' }]}
      />

      {/* Report catalog strip — filtered by role */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2">
        {catalog.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-start gap-2.5">
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground leading-tight truncate">{label}</p>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Report tabs — filtered by role */}
      <Tabs defaultValue="headcount" className="w-full">
        <TabsList className="h-9 gap-0.5 flex-wrap">
          <TabsTrigger value="headcount"     className="gap-1.5 text-xs h-7 px-3">
            <Users className="h-3.5 w-3.5" /> Headcount
          </TabsTrigger>
          <TabsTrigger value="attendance"    className="gap-1.5 text-xs h-7 px-3">
            <Clock className="h-3.5 w-3.5" /> Attendance &amp; LOP
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="salary"      className="gap-1.5 text-xs h-7 px-3">
              <Briefcase className="h-3.5 w-3.5" /> Salary Register
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="statutory"   className="gap-1.5 text-xs h-7 px-3">
              <ShieldCheck className="h-3.5 w-3.5" /> Statutory
            </TabsTrigger>
          )}
          <TabsTrigger value="muster"        className="gap-1.5 text-xs h-7 px-3">
            <CalendarDays className="h-3.5 w-3.5" /> Muster Roll
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="salary-sheet" className="gap-1.5 text-xs h-7 px-3">
              <Banknote className="h-3.5 w-3.5" /> Salary Sheet
            </TabsTrigger>
          )}
          <TabsTrigger value="leave-register" className="gap-1.5 text-xs h-7 px-3">
            <BookOpen className="h-3.5 w-3.5" /> Leave Register
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="comparison"  className="gap-1.5 text-xs h-7 px-3">
              <ArrowLeftRight className="h-3.5 w-3.5" /> Att. vs Payroll
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="payroll-register" className="gap-1.5 text-xs h-7 px-3">
              <CreditCard className="h-3.5 w-3.5" /> Payroll Register
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="headcount"      className="mt-4">
          <HeadcountReport     departments={departments} basePath={basePath} />
        </TabsContent>
        <TabsContent value="attendance"     className="mt-4">
          <AttendanceReport    departments={departments} basePath={basePath} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="salary"       className="mt-4">
            <SalaryRegister    departments={departments} basePath={basePath} />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="statutory"    className="mt-4">
            <StatutoryReport   departments={departments} basePath={basePath} />
          </TabsContent>
        )}
        <TabsContent value="muster"         className="mt-4">
          <MusterRollReport    departments={departments} basePath={basePath} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="salary-sheet" className="mt-4">
            <SalarySheetReport departments={departments} basePath={basePath} />
          </TabsContent>
        )}
        <TabsContent value="leave-register" className="mt-4">
          <LeaveRegisterReport       departments={departments} basePath={basePath} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="comparison"   className="mt-4">
            <AttendancePayrollReport departments={departments} basePath={basePath} />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="payroll-register" className="mt-4">
            <PayrollRegisterReport   departments={departments} basePath={basePath} />
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  )
}
