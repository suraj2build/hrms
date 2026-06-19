/**
 * Data Explorer — resolver.
 *
 * Consumes CANONICAL dataset endpoints only. Transforms a canonical response
 * into uniform explorer rows + summary statistics. The terminal drill resolves
 * to a real employee list via GET /employees (with dimension filters).
 */

import { api } from '@/lib/api/client'
import {
  type SurfaceConfig, type ExplorerDimension, type DateRangeId,
  type SummaryStat, type MetricCol,
} from './config'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExplorerRow {
  key:     string
  label:   string
  metrics: Record<string, number>
}

export interface DrillStep {
  dimensionId:    string
  filterParam?:   string
  value:          string
  label:          string
}

export interface ExplorerResult {
  rows:    ExplorerRow[]
  /** raw summary block from the canonical endpoint (surface-level totals) */
  summary: Record<string, unknown> | null
}

export interface EmployeeRow {
  id:            string
  employee_code: string
  full_name:     string
  email:         string | null
  department:    string | null
  designation:   string | null
  status:        string
}

// ── Date helpers ────────────────────────────────────────────────────────────────

function rangeMonths(range: DateRangeId, anchor?: string | null): { from: string; to: string; month: string } {
  const n = range === 'current_month' ? 1 : range === 'last_3m' ? 3 : range === 'last_6m' ? 6 : 12
  // Anchor on the latest month with data (finalized payroll) when available.
  let endY: number, endM0: number
  if (anchor && /^\d{4}-\d{2}$/.test(anchor)) {
    const [ay, am] = anchor.split('-').map(Number)
    endY = ay; endM0 = am - 1
  } else {
    const now = new Date()
    endY = now.getFullYear(); endM0 = now.getMonth()
  }
  const to    = `${endY}-${String(endM0 + 1).padStart(2, '0')}`
  const start = new Date(endY, endM0 - (n - 1), 1)
  const from  = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
  return { from, to, month: to }
}

/** Latest month with finalized payroll data, cached per session. */
let _anchorPromise: Promise<string | null> | null = null
function getAnchorMonth(): Promise<string | null> {
  if (!_anchorPromise) {
    _anchorPromise = api.get<{ month: string | null }>('/datasets/payroll-cost/anchor')
      .then(r => r?.month ?? null)
      .catch(() => null)
  }
  return _anchorPromise
}

// ── Query building ──────────────────────────────────────────────────────────────

function buildDateParams(surface: SurfaceConfig, range: DateRangeId, anchor: string | null): string {
  const { from, to, month } = rangeMonths(range, anchor)
  switch (surface.paramStyle) {
    case 'from_to': return `from=${from}&to=${to}`
    case 'month':   return `month=${month}`
    case 'none':    return ''
  }
}

function buildDrillParams(drillStack: DrillStep[]): string {
  return drillStack
    .filter(s => s.filterParam)
    .map(s => `${s.filterParam}=${encodeURIComponent(s.value)}`)
    .join('&')
}

function join(...parts: string[]): string {
  const qs = parts.filter(Boolean).join('&')
  return qs ? `?${qs}` : ''
}

// ── Resolve a surface + dimension into explorer rows ────────────────────────────

export async function resolveExplorer(
  surface:    SurfaceConfig,
  dimension:  ExplorerDimension,
  range:      DateRangeId,
  drillStack: DrillStep[],
): Promise<ExplorerResult> {
  const anchor = await getAnchorMonth()
  const qs = join(
    `group_by=${dimension.id}`,
    buildDateParams(surface, range, anchor),
    buildDrillParams(drillStack),
  )

  const res = await api
    .get<Record<string, unknown>>(`${surface.endpoint}${qs}`)
    .catch(() => null)
  if (!res) return { rows: [], summary: null }

  const rawRows = (res[dimension.rowsKey] as Record<string, unknown>[] | undefined) ?? []

  const rows: ExplorerRow[] = rawRows.map(r => {
    const metrics: Record<string, number> = {}
    for (const m of surface.metrics) metrics[m.id] = Number(r[m.id] ?? 0)
    return {
      key:   String(r[dimension.keyField] ?? ''),
      label: String(r[dimension.labelField] ?? '—'),
      metrics,
    }
  })

  return { rows, summary: (res.summary as Record<string, unknown> | undefined) ?? null }
}

// ── Summary statistics over a chosen metric column ──────────────────────────────

export function computeStat(rows: ExplorerRow[], metric: MetricCol, stat: SummaryStat): number {
  const vals = rows.map(r => r.metrics[metric.id] ?? 0)
  if (vals.length === 0) return 0

  switch (stat) {
    case 'count':
      return vals.length
    case 'sum':
      return round(vals.reduce((a, b) => a + b, 0))
    case 'average':
      return round(vals.reduce((a, b) => a + b, 0) / vals.length)
    case 'median': {
      const sorted = [...vals].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0
        ? round((sorted[mid - 1] + sorted[mid]) / 2)
        : round(sorted[mid])
    }
    case 'percentage': {
      // Share of the largest group against the total — a quick concentration read
      const total = vals.reduce((a, b) => a + b, 0)
      const max   = Math.max(...vals)
      return total > 0 ? round((max / total) * 100) : 0
    }
  }
}

function round(n: number): number { return Math.round(n * 100) / 100 }

// ── Terminal drill → employee list ──────────────────────────────────────────────
// Maps drill filter params to /employees query params.

const FILTER_TO_EMP_PARAM: Record<string, string> = {
  filter_department_id:  'department_id',
  filter_location_id:    'location_id',
  filter_grade_id:       'grade_id',
  filter_designation_id: 'designation_id',
}

export async function resolveEmployeeList(drillStack: DrillStep[]): Promise<EmployeeRow[]> {
  const params: string[] = ['status=active', 'limit=200']
  for (const step of drillStack) {
    if (!step.filterParam) continue
    const empParam = FILTER_TO_EMP_PARAM[step.filterParam]
    if (empParam) params.push(`${empParam}=${encodeURIComponent(step.value)}`)
  }

  interface RawEmployee {
    id: string
    employee_code: string
    first_name?: string | null
    last_name?: string | null
    email?: string | null
    department?: { name?: string | null } | null
    designation?: { name?: string | null } | null
    status: string
  }
  const res = await api
    .get<{ data?: RawEmployee[] }>(`/employees?${params.join('&')}`)
    .catch(() => null)
  const rows: RawEmployee[] = res?.data ?? []

  return rows.map(e => ({
    id:            e.id,
    employee_code: e.employee_code,
    full_name:     `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
    email:         e.email ?? null,
    department:    e.department?.name    ?? null,
    designation:   e.designation?.name   ?? null,
    status:        e.status,
  }))
}

// ── CSV / Excel export ──────────────────────────────────────────────────────────

export function exportRows(
  rows:    ExplorerRow[],
  metrics: MetricCol[],
  surfaceLabel: string,
  format:  'csv' | 'excel',
): void {
  if (rows.length === 0) return

  const headers = ['Group', ...metrics.map(m => m.label)]
  const body    = rows.map(r => [r.label, ...metrics.map(m => r.metrics[m.id] ?? 0)])

  const sep  = '\t'
  const text = [headers, ...body].map(cols => cols.join(format === 'excel' ? sep : ',')).join('\n')

  const mime = format === 'excel'
    ? 'application/vnd.ms-excel;charset=utf-8;'
    : 'text/csv;charset=utf-8;'
  const ext  = format === 'excel' ? 'xls' : 'csv'

  const blob = new Blob([text], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `explorer-${surfaceLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}
