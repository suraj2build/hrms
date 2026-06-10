/**
 * Data Explorer — /admin/explorer
 *
 * Table-first investigation surface over the canonical datasets. Pick a surface
 * → group by a dimension → read every metric as a column → drill row-by-row down
 * to the employee list. Save / share views, export CSV / Excel. No new metrics,
 * no new APIs — every number comes from a canonical /datasets/* endpoint.
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Layers, ChevronRight, Download, FileSpreadsheet, Bookmark, X,
  Loader2, AlertTriangle, Users, Search, Link2, Check,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHero }      from '@/components/layout/PageHero'
import { cn }            from '@/lib/utils'

import {
  SURFACES, DATE_RANGES, SUMMARY_STATS,
  type DateRangeId, type SummaryStat, type MetricCol, type MetricFormat,
} from '@/lib/explorer/config'
import {
  resolveExplorer, resolveEmployeeList, computeStat, exportRows,
  type ExplorerRow, type DrillStep, type EmployeeRow,
} from '@/lib/explorer/resolver'

// ── Formatting ──────────────────────────────────────────────────────────────────

function fmt(v: number, format: MetricFormat): string {
  if (format === 'currency') {
    if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)}Cr`
    if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(2)}L`
    return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }
  if (format === 'percent') return `${v.toFixed(1)}%`
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// ── Inline select ───────────────────────────────────────────────────────────────

function Sel<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Saved views (localStorage) ──────────────────────────────────────────────────

interface SavedView {
  id: string; name: string
  surface: string; groupBy: string; range: DateRangeId; stat: SummaryStat; metric: string
}

function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('hrms-explorer-views') ?? '[]') }
    catch { return [] }
  })
  const save = useCallback((v: Omit<SavedView, 'id'>) => {
    setViews(prev => {
      const next = [...prev, { ...v, id: `${Date.now()}` }]
      localStorage.setItem('hrms-explorer-views', JSON.stringify(next))
      return next
    })
  }, [])
  const remove = useCallback((id: string) => {
    setViews(prev => {
      const next = prev.filter(v => v.id !== id)
      localStorage.setItem('hrms-explorer-views', JSON.stringify(next))
      return next
    })
  }, [])
  return { views, save, remove }
}

// ── URL state (share) ───────────────────────────────────────────────────────────

function readUrlState() {
  const p = new URLSearchParams(window.location.search)
  return {
    surface: p.get('surface'),
    groupBy: p.get('group'),
    range:   p.get('range') as DateRangeId | null,
    stat:    p.get('stat') as SummaryStat | null,
    metric:  p.get('metric'),
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DataExplorer() {
  const url0 = useMemo(readUrlState, [])

  const [surfaceId, setSurfaceId] = useState<string>(url0.surface ?? SURFACES[0].id)
  const surface = SURFACES.find(s => s.id === surfaceId) ?? SURFACES[0]

  const [groupBy, setGroupBy]   = useState<string>(url0.groupBy ?? surface.dimensions[0].id)
  const [range, setRange]       = useState<DateRangeId>(url0.range ?? 'last_3m')
  const [stat, setStat]         = useState<SummaryStat>(url0.stat ?? 'sum')
  const [metricId, setMetricId] = useState<string>(url0.metric ?? surface.metrics[0].id)
  const [drillStack, setDrillStack] = useState<DrillStep[]>([])
  const [showEmployees, setShowEmployees] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const { views, save, remove } = useSavedViews()

  const dimension = surface.dimensions.find(d => d.id === groupBy) ?? surface.dimensions[0]
  const metric    = surface.metrics.find(m => m.id === metricId) ?? surface.metrics[0]

  // ── Surface / dimension changes reset drill ────────────────────────────────

  function selectSurface(id: string) {
    const s = SURFACES.find(x => x.id === id)!
    setSurfaceId(id)
    setGroupBy(s.dimensions[0].id)
    setMetricId(s.metrics[0].id)
    setDrillStack([])
    setShowEmployees(false)
  }

  function selectGroupBy(id: string) {
    setGroupBy(id)
    setDrillStack([])
    setShowEmployees(false)
  }

  // ── Drill ──────────────────────────────────────────────────────────────────

  function handleRowClick(row: ExplorerRow) {
    if (!dimension.filterParam) return  // not drillable
    const step: DrillStep = {
      dimensionId: dimension.id,
      filterParam: dimension.filterParam,
      value:       row.key,
      label:       row.label,
    }
    const nextStack = [...drillStack, step]
    setDrillStack(nextStack)

    // Determine next dimension via drill chain
    const chainIdx = surface.drillChain.indexOf(dimension.id)
    const nextDimId = chainIdx >= 0 ? surface.drillChain[chainIdx + 1] : undefined
    const nextDim = nextDimId ? surface.dimensions.find(d => d.id === nextDimId) : undefined

    if (nextDim) {
      setGroupBy(nextDim.id)
    } else if (surface.drillToEmployees) {
      setShowEmployees(true)
    }
  }

  function drillTo(index: number) {
    // index = -1 → clear all; else keep first (index+1) steps
    const kept = index < 0 ? [] : drillStack.slice(0, index + 1)
    setDrillStack(kept)
    setShowEmployees(false)
    const dimId = index < 0
      ? (surface.dimensions[0].id)
      : (() => {
          const lastDim = kept[kept.length - 1]?.dimensionId
          const chainIdx = surface.drillChain.indexOf(lastDim)
          return surface.drillChain[chainIdx + 1] ?? lastDim
        })()
    setGroupBy(dimId)
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: result, isLoading, error } = useQuery({
    queryKey: ['explorer', surface.id, dimension.id, range, drillStack],
    queryFn:  () => resolveExplorer(surface, dimension, range, drillStack),
    staleTime: 5 * 60 * 1000,
    enabled:  !showEmployees,
    retry: 1,
  })

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['explorer-emp', drillStack],
    queryFn:  () => resolveEmployeeList(drillStack),
    staleTime: 5 * 60 * 1000,
    enabled:  showEmployees,
    retry: 1,
  })

  const rows = result?.rows ?? []
  const statValue = useMemo(() => computeStat(rows, metric, stat), [rows, metric, stat])

  // ── Share / save ───────────────────────────────────────────────────────────

  function handleShare() {
    const p = new URLSearchParams()
    p.set('surface', surface.id)
    p.set('group', dimension.id)
    p.set('range', range)
    p.set('stat', stat)
    p.set('metric', metric.id)
    const link = `${window.location.origin}${window.location.pathname}?${p.toString()}`
    navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function handleSave() {
    if (!saveName.trim()) return
    save({ name: saveName.trim(), surface: surface.id, groupBy: dimension.id, range, stat, metric: metric.id })
    setSaveName('')
    setSaveOpen(false)
  }

  function applyView(v: SavedView) {
    setSurfaceId(v.surface)
    setGroupBy(v.groupBy)
    setRange(v.range)
    setStat(v.stat)
    setMetricId(v.metric)
    setDrillStack([])
    setShowEmployees(false)
  }

  const drillable = !!dimension.filterParam

  return (
    <PageContainer>
      <PageHero
        eyebrow="Reports · Explorer"
        title="Data Explorer"
        subtitle="Slice any workforce dataset, drill to the employee, export — without leaving Emvora"
      />

      {/* ── Saved views ─────────────────────────────────────────────────── */}
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mr-1">Saved</span>
          {views.map(v => (
            <button
              key={v.id}
              onClick={() => applyView(v)}
              className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground hover:bg-muted transition-colors"
            >
              <Bookmark className="h-2.5 w-2.5 text-muted-foreground" />
              {v.name}
              <span
                role="button"
                onClick={e => { e.stopPropagation(); remove(v.id) }}
                className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Surface tabs ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {SURFACES.map(s => (
          <button
            key={s.id}
            onClick={() => selectSurface(s.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              s.id === surface.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-border',
            )}
          >
            <Layers className="h-3 w-3" />
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Control bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 mb-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <Sel
          label="Group by"
          value={dimension.id}
          options={surface.dimensions.map(d => ({ id: d.id, label: d.label }))}
          onChange={selectGroupBy}
        />
        {surface.paramStyle !== 'none' && (
          <Sel label="Period" value={range} options={DATE_RANGES as any} onChange={v => setRange(v as DateRangeId)} />
        )}
        <Sel
          label="Metric"
          value={metric.id}
          options={surface.metrics.map(m => ({ id: m.id, label: m.label }))}
          onChange={setMetricId}
        />
        <Sel label="Summary" value={stat} options={SUMMARY_STATS} onChange={setStat} />

        <div className="flex-1" />

        <button
          onClick={() => setSaveOpen(o => !o)}
          className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Bookmark className="h-3 w-3" /> Save
        </button>
        <button
          onClick={handleShare}
          className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Link2 className="h-3 w-3" />}
          {copied ? 'Copied' : 'Share'}
        </button>
        <button
          onClick={() => exportRows(rows, surface.metrics, surface.label, 'csv')}
          disabled={rows.length === 0 || showEmployees}
          className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-3 w-3" /> CSV
        </button>
        <button
          onClick={() => exportRows(rows, surface.metrics, surface.label, 'excel')}
          disabled={rows.length === 0 || showEmployees}
          className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FileSpreadsheet className="h-3 w-3" /> Excel
        </button>
      </div>

      {/* ── Save name input ─────────────────────────────────────────────── */}
      {saveOpen && (
        <div className="flex items-center gap-1 mb-3">
          <input
            autoFocus
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaveOpen(false) }}
            placeholder="View name…"
            className="h-8 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button onClick={handleSave} disabled={!saveName.trim()} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
            Save view
          </button>
        </div>
      )}

      {/* ── Drill breadcrumb ────────────────────────────────────────────── */}
      {drillStack.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs mb-3 flex-wrap">
          <button onClick={() => drillTo(-1)} className="text-muted-foreground hover:text-foreground font-medium">
            {surface.label}
          </button>
          {drillStack.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button
                onClick={() => drillTo(i)}
                className={cn(
                  'transition-colors',
                  i === drillStack.length - 1 && !showEmployees
                    ? 'font-semibold text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            </span>
          ))}
          {showEmployees && (
            <span className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-semibold text-primary flex items-center gap-1"><Users className="h-3 w-3" /> Employees</span>
            </span>
          )}
          <button onClick={() => drillTo(-1)} className="ml-auto text-muted-foreground hover:text-destructive" title="Clear">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ── Summary stat strip ──────────────────────────────────────────── */}
      {!showEmployees && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {SUMMARY_STATS.find(s => s.id === stat)?.label} · {metric.label}
            </p>
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {stat === 'count' ? statValue.toLocaleString('en-IN') : fmt(statValue, stat === 'percentage' ? 'percent' : metric.format)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Groups</p>
            <p className="text-lg font-semibold text-foreground tabular-nums">{rows.length}</p>
          </div>
        </div>
      )}

      {/* ── Main table ──────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {showEmployees ? (
          <EmployeeTable rows={employees ?? []} loading={empLoading} />
        ) : isLoading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm">Failed to load data</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Search className="h-7 w-7 opacity-30" />
            <p className="text-sm">No data for this selection</p>
          </div>
        ) : (
          <GroupTable
            rows={rows}
            metrics={surface.metrics}
            sortMetric={metric.id}
            drillable={drillable}
            onRowClick={handleRowClick}
          />
        )}
      </div>

      {drillable && !showEmployees && rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          Click a row to drill into {surface.drillChain[surface.drillChain.indexOf(dimension.id) + 1]
            ? surface.dimensions.find(d => d.id === surface.drillChain[surface.drillChain.indexOf(dimension.id) + 1])?.label
            : 'the employee list'}
        </p>
      )}
    </PageContainer>
  )
}

// ── Group table ─────────────────────────────────────────────────────────────────

function GroupTable({
  rows, metrics, sortMetric, drillable, onRowClick,
}: {
  rows: ExplorerRow[]
  metrics: MetricCol[]
  sortMetric: string
  drillable: boolean
  onRowClick: (r: ExplorerRow) => void
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.metrics[sortMetric] ?? 0) - (a.metrics[sortMetric] ?? 0)),
    [rows, sortMetric],
  )

  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const m of metrics) t[m.id] = sorted.reduce((s, r) => s + (r.metrics[m.id] ?? 0), 0)
    return t
  }, [sorted, metrics])

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="p-2.5 text-left font-medium text-muted-foreground sticky left-0 bg-muted/30">Group</th>
            {metrics.map(m => (
              <th key={m.id} className={cn('p-2.5 text-right font-medium', m.id === sortMetric ? 'text-foreground' : 'text-muted-foreground')}>
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr
              key={r.key}
              onClick={drillable ? () => onRowClick(r) : undefined}
              className={cn(
                'border-b border-border/50 transition-colors',
                drillable ? 'cursor-pointer hover:bg-primary/5' : 'hover:bg-muted/20',
              )}
            >
              <td className="p-2.5 font-medium text-foreground sticky left-0 bg-card flex items-center gap-1">
                {drillable && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                {r.label}
              </td>
              {metrics.map(m => (
                <td key={m.id} className={cn('p-2.5 text-right tabular-nums', m.id === sortMetric ? 'text-foreground font-medium' : 'text-foreground/80')}>
                  {fmt(r.metrics[m.id] ?? 0, m.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/20">
            <td className="p-2.5 font-semibold text-foreground sticky left-0 bg-muted/20">Total</td>
            {metrics.map(m => (
              <td key={m.id} className="p-2.5 text-right font-semibold tabular-nums text-foreground">
                {m.format === 'percent' ? '—' : fmt(totals[m.id] ?? 0, m.format)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Employee table (terminal drill) ─────────────────────────────────────────────

function EmployeeTable({ rows, loading }: { rows: EmployeeRow[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading employees…</span>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Users className="h-7 w-7 opacity-30" />
        <p className="text-sm">No employees match this drill path</p>
      </div>
    )
  }
  return (
    <div className="overflow-auto">
      <div className="px-3 py-2 border-b border-border bg-muted/20 text-xs text-muted-foreground">
        {rows.length} employee{rows.length === 1 ? '' : 's'}
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="p-2.5 text-left font-medium text-muted-foreground">Code</th>
            <th className="p-2.5 text-left font-medium text-muted-foreground">Name</th>
            <th className="p-2.5 text-left font-medium text-muted-foreground">Department</th>
            <th className="p-2.5 text-left font-medium text-muted-foreground">Designation</th>
            <th className="p-2.5 text-left font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => (
            <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="p-2.5 tabular-nums text-muted-foreground">{e.employee_code}</td>
              <td className="p-2.5 font-medium text-foreground">{e.full_name}</td>
              <td className="p-2.5 text-foreground/80">{e.department ?? '—'}</td>
              <td className="p-2.5 text-foreground/80">{e.designation ?? '—'}</td>
              <td className="p-2.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">{e.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
