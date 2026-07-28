/**
 * Analytics Studio — query resolver.
 *
 * Maps an AnalyticsQuery → ChartData by calling canonical dataset APIs.
 * All API calls are parallel where possible.
 */

import { api } from '@/lib/api/client'
import {
  type AnalyticsQuery, type ChartData, type ChartSeries,
  type TimeRangeId, type MeasureId, type DatasetId, type DimensionId,
  type DrillStep,
  DATASET_CATALOG, DRILL_FILTER_PARAM,
} from './types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

export function seriesColor(idx: number): string {
  return SERIES_COLORS[idx % SERIES_COLORS.length]
}

export function getMonths(range: TimeRangeId, anchor?: string | null): string[] {
  const n = range === 'current_month' ? 1 : range === 'last_3m' ? 3 : range === 'last_6m' ? 6 : 12
  // Anchor the window on the latest month with data (e.g. last finalized payroll
  // run) when available — otherwise fall back to the current calendar month.
  let endY: number, endM0: number
  if (anchor && /^\d{4}-\d{2}$/.test(anchor)) {
    const [ay, am] = anchor.split('-').map(Number)
    endY = ay; endM0 = am - 1
  } else {
    const now = new Date()
    endY = now.getFullYear(); endM0 = now.getMonth()
  }
  const months: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(endY, endM0 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

/** Latest month with finalized payroll data, cached per session. Falls back to null. */
let _anchorPromise: Promise<string | null> | null = null
export function getAnchorMonth(): Promise<string | null> {
  if (!_anchorPromise) {
    _anchorPromise = api.get<{ month: string | null }>('/datasets/payroll-cost/anchor')
      .then(r => r?.month ?? null)
      .catch(() => null)
  }
  return _anchorPromise
}

export function fmtMonthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}

function measureLabel(measure: MeasureId, dataset: DatasetId, dimension: DimensionId): string {
  const ds  = DATASET_CATALOG.find(d => d.id === dataset)
  const dim = ds?.dimensions.find(d => d.id === dimension)
  return dim?.measures.find(m => m.id === measure)?.label ?? measure
}

function measureFormat(measure: MeasureId): 'currency' | 'percent' | 'number' {
  switch (measure) {
    case 'gross_cost': case 'net_cost': case 'avg_salary':
    case 'total_ctc':  case 'avg_ctc':
      return 'currency'
    case 'attendance_pct':
      return 'percent'
    default:
      return 'number'
  }
}

function empty(label: string, fmt: 'currency' | 'percent' | 'number' = 'number'): ChartData {
  return { labels: [], series: [], format: fmt, measureLabel: label, isEmpty: true }
}

// ── Canonical dataset response shapes (partial; fields are optional) ────────────

interface DeptRow {
  name?: string
  department_id?: string
  id?: string
  gross?: number
  net?: number
  headcount?: number
  count?: number
  joiners?: number
  exits?: number
}
interface GroupRow {
  label?: string
  key?: string
  gross?: number
  net?: number
  headcount?: number
  count?: number
  joiners?: number
  new_joiners?: number
  avg_tenure_months?: number
  on_probation?: number
  confirmed?: number
  total_days?: number
  request_count?: number
  avg_days_per_employee?: number
  total_ctc?: number
  avg_ctc?: number
  exits?: number
  avg_notice_days?: number
  avg_tenure_at_exit_months?: number
}
interface EmploymentTypeRow { type?: string; count?: number }
interface TrendRow { month?: string; joiners?: number; exits?: number; net?: number }
interface DatasetSummary {
  total_gross?: number
  total_net?: number
  headcount?: number
  avg_attendance_rate?: number
  total_lop_days?: number
}
interface PayrollResponse {
  by_department?: DeptRow[]
  by_group?: GroupRow[]
  summary?: DatasetSummary
}
interface HeadcountResponse {
  by_department?: DeptRow[]
  by_group?: GroupRow[]
  by_employment_type?: EmploymentTypeRow[]
  monthly_trend?: TrendRow[]
}
interface GroupResponse { by_group?: GroupRow[] }
interface AttendanceResponse { summary?: DatasetSummary }

// ── Canonical dataset response shapes (partial; fields are optional) ────────────

interface DeptRow {
  name?: string
  department_id?: string
  id?: string
  gross?: number
  net?: number
  headcount?: number
  count?: number
  joiners?: number
  exits?: number
}
interface GroupRow {
  label?: string
  key?: string
  gross?: number
  net?: number
  headcount?: number
  count?: number
  joiners?: number
  new_joiners?: number
  avg_tenure_months?: number
  on_probation?: number
  confirmed?: number
  total_days?: number
  request_count?: number
  avg_days_per_employee?: number
  total_ctc?: number
  avg_ctc?: number
  exits?: number
  avg_notice_days?: number
  avg_tenure_at_exit_months?: number
}
interface EmploymentTypeRow { type?: string; count?: number }
interface TrendRow { month?: string; joiners?: number; exits?: number; net?: number }
interface DatasetSummary {
  total_gross?: number
  total_net?: number
  headcount?: number
  avg_attendance_rate?: number
  total_lop_days?: number
}
interface PayrollResponse {
  by_department?: DeptRow[]
  by_group?: GroupRow[]
  summary?: DatasetSummary
}
interface HeadcountResponse {
  by_department?: DeptRow[]
  by_group?: GroupRow[]
  by_employment_type?: EmploymentTypeRow[]
  monthly_trend?: TrendRow[]
}
interface GroupResponse { by_group?: GroupRow[] }
interface AttendanceResponse { summary?: DatasetSummary }

function buildFilterStr(drillFilters: Record<string, string>): string {
  return Object.entries(drillFilters)
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join('')
}

function extractFilters(drillStack: DrillStep[]): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const step of drillStack) {
    const param = DRILL_FILTER_PARAM[step.dimensionId]
    if (param) filters[param] = step.dimensionValue
  }
  return filters
}

// ── Payroll: by department ────────────────────────────────────────────────────
// For trend/heatmap: fetch all N months in parallel, pivot by department.
// For bar/donut/table: fetch only the latest month.

async function payrollByDept(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)
  const fs     = buildFilterStr(drillFilters)

  const needsAllMonths = q.chartType === 'trend' || q.chartType === 'heatmap'
  const fetchMonths = needsAllMonths ? months : [months[months.length - 1]]

  const results = await Promise.all(
    fetchMonths.map(m => api.get<PayrollResponse>(`/datasets/payroll-cost?month=${m}${fs}`).catch(() => null))
  )

  function deptVal(row: DeptRow | undefined): number {
    if (!row) return 0
    switch (q.measure) {
      case 'gross_cost': return row.gross ?? 0
      case 'net_cost':   return row.net   ?? 0
      case 'headcount':  return row.headcount ?? 0
      case 'avg_salary': return (row.headcount ?? 0) > 0 ? Math.round(((row.gross ?? 0) / (row.headcount as number))) : 0
      default:           return 0
    }
  }

  if (fetchMonths.length === 1) {
    const result = results[0]
    const allDepts = [...(result?.by_department ?? [])]
      .sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0))
    const depts = allDepts.slice(0, 12)
    return {
      labels:       depts.map(d => d.name ?? ''),
      labelIds:     depts.map(d => d.department_id ?? ''),
      series:       [{ name: label, color: seriesColor(0), values: depts.map(deptVal) }],
      csvLabels:    allDepts.map(d => d.name ?? ''),
      csvSeries:    [{ name: label, color: seriesColor(0), values: allDepts.map(deptVal) }],
      format,
      measureLabel: label,
      isEmpty:      depts.length === 0,
    }
  }

  // Pick the chart's departments from the latest month that actually has data,
  // so a trailing empty month (e.g. current month not yet finalized) doesn't
  // blank the whole trend.
  const pivotResult = [...results].reverse().find(r => (r?.by_department ?? []).length > 0)
  const topDepts = [...(pivotResult?.by_department ?? [])]
    .sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0))
    .slice(0, 8)
    .map(d => ({ name: d.name, id: d.department_id ?? '' }))

  if (topDepts.length === 0) return empty(label, format)

  const series: ChartSeries[] = topDepts.map((dept, idx) => ({
    name:   dept.name ?? '',
    color:  seriesColor(idx),
    values: results.map(r => {
      const row = (r?.by_department ?? []).find(d => d.name === dept.name)
      return deptVal(row)
    }),
  }))

  return { labels: fetchMonths.map(fmtMonthLabel), series, format, measureLabel: label, isEmpty: false }
}

// ── Payroll: by location / grade / designation (R3.2) ────────────────────────

async function payrollByGroup(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)
  const month  = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<PayrollResponse>(`/datasets/payroll-cost?month=${month}&group_by=${q.dimension}${fs}`).catch(() => null)

  const allGroups = [...(result?.by_group ?? [])]
  const groups    = allGroups.slice(0, 12)

  function groupVal(g: GroupRow): number {
    switch (q.measure) {
      case 'gross_cost': return g.gross     ?? 0
      case 'net_cost':   return g.net       ?? 0
      case 'headcount':  return g.headcount ?? 0
      case 'avg_salary': return (g.headcount ?? 0) > 0 ? Math.round(((g.gross ?? 0) / (g.headcount as number))) : 0
      default:           return 0
    }
  }

  return {
    labels:       groups.map(g => g.label ?? ''),
    labelIds:     groups.map(g => g.key ?? ''),
    series:       [{ name: label, color: seriesColor(0), values: groups.map(groupVal) }],
    csvLabels:    allGroups.map(g => g.label ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(0), values: allGroups.map(groupVal) }],
    format,
    measureLabel: label,
    isEmpty:      groups.length === 0,
  }
}

// ── Payroll: over time (aggregate totals) ─────────────────────────────────────

async function payrollOverTime(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)
  const fs     = buildFilterStr(drillFilters)

  const results = await Promise.all(
    months.map(m => api.get<PayrollResponse>(`/datasets/payroll-cost?month=${m}${fs}`).catch(() => null))
  )

  function totalVal(r: PayrollResponse | null): number {
    if (!r) return 0
    switch (q.measure) {
      case 'gross_cost': return r.summary?.total_gross ?? 0
      case 'net_cost':   return r.summary?.total_net   ?? 0
      case 'headcount':  return r.summary?.headcount   ?? 0
      default:           return 0
    }
  }

  return {
    labels:       months.map(fmtMonthLabel),
    series:       [{ name: label, color: seriesColor(0), values: results.map(totalVal) }],
    format,
    measureLabel: label,
    isEmpty:      results.every(r => totalVal(r) === 0),
  }
}

// ── Headcount: by location / grade / gender (R3.2) ───────────────────────────

async function headcountByGroup(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<HeadcountResponse>(`/datasets/headcount?from=${from}&to=${to}&group_by=${q.dimension}${fs}`).catch(() => null)

  const allGroups = [...(result?.by_group ?? [])]
  const groups    = allGroups.slice(0, 12)

  function groupVal(g: GroupRow): number {
    switch (q.measure) {
      case 'headcount': return g.count   ?? 0
      case 'joiners':   return g.joiners ?? 0
      default:          return 0
    }
  }

  return {
    labels:       groups.map(g => g.label ?? ''),
    labelIds:     groups.map(g => g.key ?? ''),
    series:       [{ name: label, color: seriesColor(1), values: groups.map(groupVal) }],
    csvLabels:    allGroups.map(g => g.label ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(1), values: allGroups.map(groupVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      groups.length === 0,
  }
}

// ── Headcount: by department (current snapshot) ───────────────────────────────

async function headcountByDept(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<HeadcountResponse>(`/datasets/headcount?from=${from}&to=${to}${fs}`).catch(() => null)

  const allDepts = [...(result?.by_department ?? [])]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
  const depts = allDepts.slice(0, 12)

  function deptVal(d: DeptRow): number {
    switch (q.measure) {
      case 'headcount': return d.count   ?? 0
      case 'joiners':   return d.joiners ?? 0
      case 'exits':     return d.exits   ?? 0
      default:          return 0
    }
  }

  return {
    labels:       depts.map(d => d.name ?? ''),
    labelIds:     depts.map(d => d.id ?? ''),
    series:       [{ name: label, color: seriesColor(1), values: depts.map(deptVal) }],
    csvLabels:    allDepts.map(d => d.name ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(1), values: allDepts.map(deptVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      depts.length === 0,
  }
}

// ── Headcount: by employment type (current snapshot) ─────────────────────────

async function headcountByEmploymentType(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<HeadcountResponse>(`/datasets/headcount?from=${from}&to=${to}${fs}`).catch(() => null)

  const types = result?.by_employment_type ?? []

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  return {
    labels:       types.map(t => capitalize(t.type ?? 'Unknown')),
    labelIds:     types.map(t => t.type ?? ''),
    series:       [{ name: 'Headcount', color: seriesColor(1), values: types.map(t => t.count ?? 0) }],
    format:       'number',
    measureLabel: 'Headcount',
    isEmpty:      types.length === 0,
  }
}

// ── Headcount: over time (monthly trend) ──────────────────────────────────────

async function headcountOverTime(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<HeadcountResponse>(`/datasets/headcount?from=${from}&to=${to}${fs}`).catch(() => null)

  const trend    = result?.monthly_trend ?? []
  const trendMap = new Map<string, TrendRow>()
  for (const t of trend) trendMap.set(t.month ?? '', t)

  function trendVal(m: string): number {
    const t = trendMap.get(m)
    switch (q.measure) {
      case 'joiners':    return t?.joiners ?? 0
      case 'exits':      return t?.exits   ?? 0
      case 'net_change': return t?.net     ?? 0
      default:           return 0
    }
  }

  return {
    labels:       months.map(fmtMonthLabel),
    series:       [{ name: label, color: seriesColor(1), values: months.map(trendVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      false,
  }
}

// ── Attendance: over time ─────────────────────────────────────────────────────

async function attendanceOverTime(q: AnalyticsQuery, months: string[], _drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)

  const results = await Promise.all(
    months.map(m => api.get<AttendanceResponse>(`/datasets/attendance?month=${m}`).catch(() => null))
  )

  function attVal(r: AttendanceResponse | null): number {
    if (!r) return 0
    switch (q.measure) {
      case 'attendance_pct': return r.summary?.avg_attendance_rate ?? 0
      case 'lop_days':       return r.summary?.total_lop_days      ?? 0
      default:               return 0
    }
  }

  return {
    labels:       months.map(fmtMonthLabel),
    series:       [{ name: label, color: seriesColor(2), values: results.map(attVal) }],
    format,
    measureLabel: label,
    isEmpty:      results.every(r => r === null),
  }
}

// ── R3.1: Employees dataset (flexible group_by) ───────────────────────────────

async function employeesByGroup(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<GroupResponse>(`/datasets/employees?group_by=${q.dimension}&from=${from}&to=${to}${fs}`).catch(() => null)

  const allGroups = [...(result?.by_group ?? [])]
  const groups    = allGroups.slice(0, 12)

  function groupVal(g: GroupRow): number {
    switch (q.measure) {
      case 'headcount':         return g.headcount         ?? 0
      case 'joiners':           return g.new_joiners       ?? 0
      case 'avg_tenure_months': return g.avg_tenure_months ?? 0
      case 'on_probation':      return g.on_probation      ?? 0
      case 'confirmed':         return g.confirmed         ?? 0
      default:                  return 0
    }
  }

  return {
    labels:       groups.map(g => g.label ?? ''),
    labelIds:     groups.map(g => g.key ?? ''),
    series:       [{ name: label, color: seriesColor(3), values: groups.map(groupVal) }],
    csvLabels:    allGroups.map(g => g.label ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(3), values: allGroups.map(groupVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      groups.length === 0,
  }
}

// ── R3.1: Leave dataset (flexible group_by) ───────────────────────────────────

async function leaveByGroup(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<GroupResponse>(`/datasets/leave?group_by=${q.dimension}&from=${from}&to=${to}${fs}`).catch(() => null)

  const allGroups = [...(result?.by_group ?? [])]
  const groups    = allGroups.slice(0, 12)

  function groupVal(g: GroupRow): number {
    switch (q.measure) {
      case 'leave_days':            return g.total_days            ?? 0
      case 'request_count':         return g.request_count         ?? 0
      case 'avg_days_per_employee': return g.avg_days_per_employee ?? 0
      default:                      return 0
    }
  }

  return {
    labels:       groups.map(g => g.label ?? ''),
    labelIds:     groups.map(g => g.key ?? ''),
    series:       [{ name: label, color: seriesColor(4), values: groups.map(groupVal) }],
    csvLabels:    allGroups.map(g => g.label ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(4), values: allGroups.map(groupVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      groups.length === 0,
  }
}

// ── R3.1: Compensation dataset (flexible group_by) ────────────────────────────

async function compensationByGroup(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)
  const month  = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<GroupResponse>(`/datasets/compensation?group_by=${q.dimension}&month=${month}${fs}`).catch(() => null)

  const allGroups = [...(result?.by_group ?? [])]
  const groups    = allGroups.slice(0, 12)

  function groupVal(g: GroupRow): number {
    switch (q.measure) {
      case 'total_ctc': return g.total_ctc ?? 0
      case 'avg_ctc':   return g.avg_ctc   ?? 0
      case 'headcount': return g.headcount ?? 0
      default:          return 0
    }
  }

  return {
    labels:       groups.map(g => g.label ?? ''),
    labelIds:     groups.map(g => g.key ?? ''),
    series:       [{ name: label, color: seriesColor(0), values: groups.map(groupVal) }],
    csvLabels:    allGroups.map(g => g.label ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(0), values: allGroups.map(groupVal) }],
    format,
    measureLabel: label,
    isEmpty:      groups.length === 0,
  }
}

// ── R3.1: Separation dataset (flexible group_by) ──────────────────────────────

async function separationByGroup(q: AnalyticsQuery, months: string[], drillFilters: Record<string, string>): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const fs     = buildFilterStr(drillFilters)
  const result = await api.get<GroupResponse>(`/datasets/separation?group_by=${q.dimension}&from=${from}&to=${to}${fs}`).catch(() => null)

  const allGroups = [...(result?.by_group ?? [])]
  const groups    = allGroups.slice(0, 12)

  function groupVal(g: GroupRow): number {
    switch (q.measure) {
      case 'exits':               return g.exits                      ?? 0
      case 'avg_notice_days':     return g.avg_notice_days            ?? 0
      case 'avg_tenure_at_exit':  return g.avg_tenure_at_exit_months  ?? 0
      default:                    return 0
    }
  }

  return {
    labels:       groups.map(g => g.label ?? ''),
    labelIds:     groups.map(g => g.key ?? ''),
    series:       [{ name: label, color: seriesColor(1), values: groups.map(groupVal) }],
    csvLabels:    allGroups.map(g => g.label ?? ''),
    csvSeries:    [{ name: label, color: seriesColor(1), values: allGroups.map(groupVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      groups.length === 0,
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function resolveQuery(q: AnalyticsQuery, drillStack: DrillStep[] = []): Promise<ChartData> {
  const anchor       = await getAnchorMonth()
  const months       = getMonths(q.timeRange, anchor)
  const drillFilters = extractFilters(drillStack)

  switch (`${q.dataset}:${q.dimension}`) {
    // Payroll
    case 'payroll:department':    return payrollByDept(q, months, drillFilters)
    case 'payroll:location':
    case 'payroll:grade':
    case 'payroll:designation':   return payrollByGroup(q, months, drillFilters)
    case 'payroll:time':          return payrollOverTime(q, months, drillFilters)
    // Headcount
    case 'headcount:department':  return headcountByDept(q, months, drillFilters)
    case 'headcount:location':
    case 'headcount:grade':
    case 'headcount:gender':      return headcountByGroup(q, months, drillFilters)
    case 'headcount:employment_type': return headcountByEmploymentType(q, months, drillFilters)
    case 'headcount:time':        return headcountOverTime(q, months, drillFilters)
    // Attendance
    case 'attendance:time':       return attendanceOverTime(q, months, drillFilters)
    // R3.1 — Employees
    case 'employees:department':
    case 'employees:location':
    case 'employees:designation':
    case 'employees:grade':
    case 'employees:gender':
    case 'employees:employment_type':
    case 'employees:site':            // R5 — site geography
    case 'employees:region':
    case 'employees:zone':            return employeesByGroup(q, months, drillFilters)
    // R3.1 — Leave
    case 'leave:leave_type':
    case 'leave:department':
    case 'leave:employment_type':    return leaveByGroup(q, months, drillFilters)
    // R3.1 — Compensation
    case 'compensation:department':
    case 'compensation:grade':
    case 'compensation:designation':
    case 'compensation:location':    return compensationByGroup(q, months, drillFilters)
    // R3.1 — Separation
    case 'separation:exit_type':
    case 'separation:department':
    case 'separation:location':      return separationByGroup(q, months, drillFilters)

    default:
      return empty(q.measure, measureFormat(q.measure))
  }
}

// ── CSV export helper ─────────────────────────────────────────────────────────

export function exportToCSV(data: ChartData, q: AnalyticsQuery): void {
  if (data.isEmpty || data.labels.length === 0) return

  // Charts cap "by group" bars at the top 12 (readability) — export must still
  // include every row, so prefer the untruncated csvLabels/csvSeries when present.
  const labels = data.csvLabels ?? data.labels
  const series = data.csvSeries ?? data.series

  const headers = series.length === 1
    ? ['Label', data.measureLabel]
    : ['Label', ...series.map(s => s.name)]

  const rows = labels.map((label, i) =>
    series.length === 1
      ? [label, series[0].values[i] ?? 0]
      : [label, ...series.map(s => s.values[i] ?? 0)]
  )

  const csv  = [headers, ...rows].map(row => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `analytics-${q.dataset}-${q.dimension}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
