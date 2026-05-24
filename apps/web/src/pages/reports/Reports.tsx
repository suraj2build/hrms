/**
 * Reports — Operational Reporting Platform
 *
 * Four operational report surfaces:
 *   1. Headcount & Attrition   — workforce visibility, joiner/separation trend
 *   2. Attendance & LOP        — attendance summary, loss-of-pay analysis per employee
 *   3. Salary Register         — monthly CTC & component breakdown, payroll validation
 *   4. Statutory Compliance    — PF, ESI, PT, LWF register (India)
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
 */

import { useState, useCallback, useMemo } from 'react'
import { Link }                           from 'react-router-dom'
import { useQuery }                       from '@tanstack/react-query'
import { toast }                          from 'sonner'
import {
  Download, Users, Clock, Briefcase, ShieldCheck,
  RefreshCw, Filter, Search, ArrowUpRight,
  AlertTriangle, FileText, Info,
} from 'lucide-react'
import { api }                            from '@/lib/api/client'
import { Button }                         from '@/components/ui/button'
import { Input }                          from '@/components/ui/input'
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

function TdTotal({ children, right, bold, colSpan }: {
  children?: React.ReactNode; right?: boolean; bold?: boolean; colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-3 py-2 text-xs font-semibold bg-muted/50 text-foreground border-t-2 border-border whitespace-nowrap',
        right ? 'text-right' : 'text-left',
        bold  ? 'font-bold'  : '',
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
            <RefreshCw className="h-5 w-5 text-muted-foreground/40 animate-spin" />
            <p className="text-xs text-muted-foreground">Loading report data…</p>
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
        'Work Hours':       r.total_work_hours.toFixed(1),
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
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-xs w-36" />
        </FilterField>
        <FilterField label="To date">
          <Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-8 text-xs w-36" />
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
                <Td right bold>{r.total_work_hours.toFixed(1)}</Td>
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
  const [month,   setMonth]   = useState(currentMonth())
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
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export function Reports() {
  const basePath = useBasePath()

  // Departments list — shared across all tabs
  const { data: deptData } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
    staleTime: 300_000,
  })
  const departments = deptData?.data ?? []

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        subtitle="Operational HR reporting — headcount, attendance, payroll, and statutory compliance"
        breadcrumb={[{ label: 'Reports' }]}
      />

      {/* Report catalog strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { icon: Users,      label: 'Headcount & Attrition', desc: 'Workforce visibility · joiner / separation trend', tab: 'headcount' },
          { icon: Clock,      label: 'Attendance & LOP',       desc: 'Per-employee attendance · loss-of-pay analysis',    tab: 'attendance' },
          { icon: Briefcase,  label: 'Salary Register',        desc: 'Monthly CTC · component breakdown · payroll base',  tab: 'salary' },
          { icon: ShieldCheck,label: 'Statutory Compliance',   desc: 'PF · ESI · PT · LWF register (India)',              tab: 'statutory' },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-start gap-2.5">
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground leading-tight truncate">{label}</p>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Report tabs */}
      <Tabs defaultValue="headcount" className="w-full">
        <TabsList className="h-9 gap-0.5">
          <TabsTrigger value="headcount"  className="gap-1.5 text-xs h-7 px-3">
            <Users className="h-3.5 w-3.5" /> Headcount
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5 text-xs h-7 px-3">
            <Clock className="h-3.5 w-3.5" /> Attendance &amp; LOP
          </TabsTrigger>
          <TabsTrigger value="salary"     className="gap-1.5 text-xs h-7 px-3">
            <Briefcase className="h-3.5 w-3.5" /> Salary Register
          </TabsTrigger>
          <TabsTrigger value="statutory"  className="gap-1.5 text-xs h-7 px-3">
            <ShieldCheck className="h-3.5 w-3.5" /> Statutory
          </TabsTrigger>
        </TabsList>

        <TabsContent value="headcount"  className="mt-4">
          <HeadcountReport  departments={departments} basePath={basePath} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceReport departments={departments} basePath={basePath} />
        </TabsContent>
        <TabsContent value="salary"     className="mt-4">
          <SalaryRegister   departments={departments} basePath={basePath} />
        </TabsContent>
        <TabsContent value="statutory"  className="mt-4">
          <StatutoryReport  departments={departments} basePath={basePath} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
