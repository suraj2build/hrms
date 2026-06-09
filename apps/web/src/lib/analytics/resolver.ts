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
  DATASET_CATALOG,
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

export function getMonths(range: TimeRangeId): string[] {
  const n = range === 'current_month' ? 1 : range === 'last_3m' ? 3 : range === 'last_6m' ? 6 : 12
  const now = new Date()
  const months: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
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
    case 'gross_cost': case 'net_cost': case 'avg_salary': return 'currency'
    case 'attendance_pct': return 'percent'
    default: return 'number'
  }
}

function empty(label: string, fmt: 'currency' | 'percent' | 'number' = 'number'): ChartData {
  return { labels: [], series: [], format: fmt, measureLabel: label, isEmpty: true }
}

// ── Payroll: by department ────────────────────────────────────────────────────
// For trend/heatmap: fetch all N months in parallel, pivot by department.
// For bar/donut/table: fetch only the latest month.

async function payrollByDept(q: AnalyticsQuery, months: string[]): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)

  const needsAllMonths = q.chartType === 'trend' || q.chartType === 'heatmap'
  const fetchMonths = needsAllMonths ? months : [months[months.length - 1]]

  const results = await Promise.all(
    fetchMonths.map(m => api.get<any>(`/datasets/payroll-cost?month=${m}`).catch(() => null))
  )

  function deptVal(row: any): number {
    if (!row) return 0
    switch (q.measure) {
      case 'gross_cost': return row.gross ?? 0
      case 'net_cost':   return row.net   ?? 0
      case 'headcount':  return row.headcount ?? 0
      case 'avg_salary': return row.headcount > 0 ? Math.round((row.gross / row.headcount)) : 0
      default:           return 0
    }
  }

  if (fetchMonths.length === 1) {
    // Single-period view (bar, donut, table)
    const result = results[0]
    const depts = ([...(result?.by_department ?? [])] as any[])
      .sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0))
      .slice(0, 12)
    return {
      labels:       depts.map(d => d.name),
      series:       [{ name: label, color: seriesColor(0), values: depts.map(deptVal) }],
      format,
      measureLabel: label,
      isEmpty:      depts.length === 0,
    }
  }

  // Multi-month: pivot department × month
  const lastResult  = results[results.length - 1]
  const topDepts = ([...(lastResult?.by_department ?? [])] as any[])
    .sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0))
    .slice(0, 8)
    .map(d => ({ name: d.name }))

  if (topDepts.length === 0) return empty(label, format)

  const series: ChartSeries[] = topDepts.map((dept, idx) => ({
    name:   dept.name,
    color:  seriesColor(idx),
    values: results.map(r => {
      const row = (r?.by_department ?? []).find((d: any) => d.name === dept.name)
      return deptVal(row)
    }),
  }))

  return {
    labels:       fetchMonths.map(fmtMonthLabel),
    series,
    format,
    measureLabel: label,
    isEmpty:      false,
  }
}

// ── Payroll: over time (aggregate totals) ─────────────────────────────────────

async function payrollOverTime(q: AnalyticsQuery, months: string[]): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)

  const results = await Promise.all(
    months.map(m => api.get<any>(`/datasets/payroll-cost?month=${m}`).catch(() => null))
  )

  function totalVal(r: any): number {
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

// ── Headcount: by department (current snapshot) ───────────────────────────────

async function headcountByDept(q: AnalyticsQuery, months: string[]): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const result = await api.get<any>(`/datasets/headcount?from=${from}&to=${to}`).catch(() => null)

  const depts = ([...(result?.by_department ?? [])] as any[])
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 12)

  function deptVal(d: any): number {
    switch (q.measure) {
      case 'headcount': return d.count   ?? 0
      case 'joiners':   return d.joiners ?? 0
      case 'exits':     return d.exits   ?? 0
      default:          return 0
    }
  }

  return {
    labels:       depts.map(d => d.name),
    series:       [{ name: label, color: seriesColor(1), values: depts.map(deptVal) }],
    format:       'number',
    measureLabel: label,
    isEmpty:      depts.length === 0,
  }
}

// ── Headcount: by employment type (current snapshot) ─────────────────────────

async function headcountByEmploymentType(q: AnalyticsQuery, months: string[]): Promise<ChartData> {
  const from   = months[0]
  const to     = months[months.length - 1]
  const result = await api.get<any>(`/datasets/headcount?from=${from}&to=${to}`).catch(() => null)

  const types = (result?.by_employment_type ?? []) as any[]

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  return {
    labels:       types.map(t => capitalize(t.type ?? 'Unknown')),
    series:       [{ name: 'Headcount', color: seriesColor(1), values: types.map(t => t.count ?? 0) }],
    format:       'number',
    measureLabel: 'Headcount',
    isEmpty:      types.length === 0,
  }
}

// ── Headcount: over time (monthly trend) ──────────────────────────────────────

async function headcountOverTime(q: AnalyticsQuery, months: string[]): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const from   = months[0]
  const to     = months[months.length - 1]
  const result = await api.get<any>(`/datasets/headcount?from=${from}&to=${to}`).catch(() => null)

  const trend    = (result?.monthly_trend ?? []) as any[]
  const trendMap = new Map<string, any>()
  for (const t of trend) trendMap.set(t.month, t)

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

async function attendanceOverTime(q: AnalyticsQuery, months: string[]): Promise<ChartData> {
  const label  = measureLabel(q.measure, q.dataset, q.dimension)
  const format = measureFormat(q.measure)

  const results = await Promise.all(
    months.map(m => api.get<any>(`/datasets/attendance?month=${m}`).catch(() => null))
  )

  function attVal(r: any): number {
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

// ── Main entry ────────────────────────────────────────────────────────────────

export async function resolveQuery(q: AnalyticsQuery): Promise<ChartData> {
  const months = getMonths(q.timeRange)

  switch (`${q.dataset}:${q.dimension}`) {
    case 'payroll:department':      return payrollByDept(q, months)
    case 'payroll:time':            return payrollOverTime(q, months)
    case 'headcount:department':    return headcountByDept(q, months)
    case 'headcount:employment_type': return headcountByEmploymentType(q, months)
    case 'headcount:time':          return headcountOverTime(q, months)
    case 'attendance:time':         return attendanceOverTime(q, months)
    default:
      return empty(q.measure, measureFormat(q.measure))
  }
}

// ── CSV export helper ─────────────────────────────────────────────────────────

export function exportToCSV(data: ChartData, q: AnalyticsQuery): void {
  if (data.isEmpty || data.labels.length === 0) return

  const headers = data.series.length === 1
    ? ['Label', data.measureLabel]
    : ['Label', ...data.series.map(s => s.name)]

  const rows = data.labels.map((label, i) =>
    data.series.length === 1
      ? [label, data.series[0].values[i] ?? 0]
      : [label, ...data.series.map(s => s.values[i] ?? 0)]
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
