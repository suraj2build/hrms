/**
 * Analytics Studio — /admin/reports/analytics
 *
 * Guided workforce analytics: select dataset → dimension → metric → time range
 * → visualization. No SQL, no exports required, no leaving the page.
 *
 * Consumes canonical dataset APIs only (/datasets/headcount, /datasets/payroll-cost,
 * /datasets/attendance). Results are cached via TanStack Query.
 */

import { useState, useCallback }  from 'react'
import { useQuery }               from '@tanstack/react-query'
import {
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  BarChart3, LineChart as LineIcon, PieChart as PieIcon,
  Table2, LayoutGrid, Download, Bookmark, X,
  Loader2, AlertTriangle, Sparkles,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { getAxisStyle, getGridStyle, getTooltipStyle } from '@/components/ui/chart'
import { cn }             from '@/lib/utils'

import {
  type AnalyticsQuery, type ChartData, type ChartTypeId,
  type SavedView,
  DATASET_CATALOG, TIME_RANGES, DEFAULT_QUERY,
} from '@/lib/analytics/types'
import { resolveQuery, exportToCSV, fmtMonthLabel } from '@/lib/analytics/resolver'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtVal(v: number, format: 'currency' | 'percent' | 'number'): string {
  if (format === 'currency') {
    if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`
    if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(1)}L`
    return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }
  if (format === 'percent') return `${v.toFixed(1)}%`
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function toRechartsRows(data: ChartData): Record<string, any>[] {
  return data.labels.map((label, i) => {
    const row: Record<string, any> = { label }
    for (const s of data.series) row[s.name] = s.values[i] ?? 0
    return row
  })
}

function chartTitle(q: AnalyticsQuery): string {
  const ds  = DATASET_CATALOG.find(d => d.id === q.dataset)
  const dim = ds?.dimensions.find(d => d.id === q.dimension)
  const msr = dim?.measures.find(m => m.id === q.measure)
  const tr  = TIME_RANGES.find(t => t.id === q.timeRange)
  return `${msr?.label ?? q.measure} · ${ds?.label ?? q.dataset} by ${dim?.label ?? q.dimension} · ${tr?.label ?? q.timeRange}`
}

// ── Saved views (localStorage) ────────────────────────────────────────────────

function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('hrms-analytics-views') ?? '[]') }
    catch { return [] }
  })

  const save = useCallback((name: string, query: AnalyticsQuery) => {
    const view: SavedView = {
      id: `${Date.now()}`, name, query, savedAt: new Date().toISOString(),
    }
    setViews(prev => {
      const next = [...prev, view]
      localStorage.setItem('hrms-analytics-views', JSON.stringify(next))
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setViews(prev => {
      const next = prev.filter(v => v.id !== id)
      localStorage.setItem('hrms-analytics-views', JSON.stringify(next))
      return next
    })
  }, [])

  return { views, save, remove }
}

// ── Chart type picker icon ─────────────────────────────────────────────────────

const CHART_TYPES: Array<{ id: ChartTypeId; Icon: React.ComponentType<any>; label: string }> = [
  { id: 'trend',   Icon: LineIcon,  label: 'Trend'   },
  { id: 'bar',     Icon: BarChart3, label: 'Bar'     },
  { id: 'donut',   Icon: PieIcon,   label: 'Donut'   },
  { id: 'heatmap', Icon: LayoutGrid, label: 'Heatmap' },
  { id: 'table',   Icon: Table2,    label: 'Table'   },
]

// ── Visualization components ──────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Sparkles className="h-8 w-8 opacity-30" />
      <p className="text-sm">No data for <span className="font-medium">{label}</span></p>
      <p className="text-xs">Try adjusting the time range or selecting a different metric</p>
    </div>
  )
}

function TrendChart({ data }: { data: ChartData }) {
  const rows   = toRechartsRows(data)
  const axis   = getAxisStyle()
  const tip    = getTooltipStyle()

  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid {...getGridStyle()} />
        <XAxis dataKey="label" {...axis} />
        <YAxis
          {...axis}
          tickFormatter={v => fmtVal(v, data.format)}
          width={data.format === 'currency' ? 70 : 50}
        />
        <Tooltip
          contentStyle={tip}
          formatter={(v: number, name: string) => [fmtVal(v, data.format), name]}
        />
        {data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {data.series.map(s => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function BarChartView({ data }: { data: ChartData }) {
  const rows = toRechartsRows(data)
  const axis = getAxisStyle()
  const tip  = getTooltipStyle()

  const isGrouped = data.series.length > 1

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
        <CartesianGrid {...getGridStyle()} vertical={false} />
        <XAxis
          dataKey="label"
          {...axis}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={60}
        />
        <YAxis
          {...axis}
          tickFormatter={v => fmtVal(v, data.format)}
          width={data.format === 'currency' ? 70 : 50}
        />
        <Tooltip
          contentStyle={tip}
          formatter={(v: number, name: string) => [fmtVal(v, data.format), name]}
        />
        {isGrouped && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {data.series.map((s, idx) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            fill={s.color}
            radius={idx === data.series.length - 1 ? [3, 3, 0, 0] : undefined}
            maxBarSize={40}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function DonutChart({ data }: { data: ChartData }) {
  const s = data.series[0]
  if (!s) return null

  const segments = data.labels.map((label, i) => ({
    name:  label,
    value: s.values[i] ?? 0,
  })).filter(seg => seg.value > 0)

  const COLORS = [
    'var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)',
    'var(--color-chart-4)', 'var(--color-chart-5)',
    'var(--color-info)', 'var(--color-accent-violet)', 'var(--color-accent-teal)',
  ]

  const total = segments.reduce((acc, seg) => acc + seg.value, 0)

  return (
    <div className="flex items-center gap-6">
      <div className="flex-shrink-0">
        <PieChart width={260} height={260}>
          <Pie
            data={segments}
            cx={130}
            cy={130}
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            dataKey="value"
          >
            {segments.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={getTooltipStyle()}
            formatter={(v: number, name: string) => [fmtVal(v, data.format), name]}
          />
        </PieChart>
      </div>

      <div className="flex-1 space-y-1.5 min-w-0 max-h-[260px] overflow-y-auto pr-1">
        {segments.map((seg, i) => (
          <div key={seg.name} className="flex items-center gap-2 min-w-0">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-xs text-foreground truncate flex-1">{seg.name}</span>
            <span className="text-xs font-medium text-foreground flex-shrink-0">
              {fmtVal(seg.value, data.format)}
            </span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {total > 0 ? `${((seg.value / total) * 100).toFixed(1)}%` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HeatmapChart({ data }: { data: ChartData }) {
  const maxVal = Math.max(1, ...data.series.flatMap(s => s.values))

  return (
    <div className="overflow-auto">
      <table className="text-xs border-collapse" style={{ minWidth: '100%' }}>
        <thead>
          <tr>
            <th className="p-2 text-left sticky left-0 bg-card z-10 border-b border-r border-border font-medium text-muted-foreground min-w-[140px]">
              —
            </th>
            {data.labels.map(l => (
              <th key={l} className="p-2 text-center border-b border-border font-medium text-muted-foreground whitespace-nowrap min-w-[72px]">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.series.map(s => (
            <tr key={s.name}>
              <td className="p-2 font-medium whitespace-nowrap sticky left-0 bg-card z-10 border-r border-b border-border text-foreground text-xs max-w-[180px] truncate">
                {s.name}
              </td>
              {s.values.map((v, vi) => {
                const intensity = v / maxVal
                const bg = `hsl(240 60% ${Math.round(95 - intensity * 38)}%)`
                const fg = intensity > 0.55 ? 'hsl(0 0% 98%)' : 'hsl(240 20% 15%)'
                return (
                  <td
                    key={vi}
                    className="p-1.5 text-center border-b border-border"
                    style={{ backgroundColor: bg, color: fg }}
                    title={`${s.name} / ${data.labels[vi]}: ${fmtVal(v, data.format)}`}
                  >
                    {fmtVal(v, data.format)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DataTableView({ data }: { data: ChartData }) {
  const isMultiSeries = data.series.length > 1

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="p-2 text-left font-medium text-muted-foreground">Label</th>
            {isMultiSeries
              ? data.series.map(s => (
                  <th key={s.name} className="p-2 text-right font-medium text-muted-foreground">{s.name}</th>
                ))
              : <th className="p-2 text-right font-medium text-muted-foreground">{data.measureLabel}</th>
            }
          </tr>
        </thead>
        <tbody>
          {data.labels.map((label, i) => (
            <tr key={label} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
              <td className="p-2 text-foreground font-medium">{label}</td>
              {isMultiSeries
                ? data.series.map(s => (
                    <td key={s.name} className="p-2 text-right tabular-nums text-foreground">
                      {fmtVal(s.values[i] ?? 0, data.format)}
                    </td>
                  ))
                : <td className="p-2 text-right tabular-nums text-foreground">
                    {fmtVal(data.series[0]?.values[i] ?? 0, data.format)}
                  </td>
              }
            </tr>
          ))}
        </tbody>
        {data.labels.length > 0 && data.series.length === 1 && (
          <tfoot>
            <tr className="border-t-2 border-border">
              <td className="p-2 font-semibold text-foreground">Total</td>
              <td className="p-2 text-right font-semibold tabular-nums text-foreground">
                {fmtVal(
                  (data.series[0]?.values ?? []).reduce((a, b) => a + b, 0),
                  data.format,
                )}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function ChartDisplay({ data, chartType }: { data: ChartData; chartType: ChartTypeId }) {
  if (data.isEmpty) return <EmptyState label={data.measureLabel} />

  switch (chartType) {
    case 'trend':   return <TrendChart   data={data} />
    case 'bar':     return <BarChartView data={data} />
    case 'donut':   return <DonutChart   data={data} />
    case 'heatmap': return data.series.length > 1 ? <HeatmapChart data={data} /> : <BarChartView data={data} />
    case 'table':   return <DataTableView data={data} />
  }
}

// ── Inline select helper ──────────────────────────────────────────────────────

function Sel<T extends string>({
  label, value, options, onChange, className,
}: {
  label:    string
  value:    T
  options:  Array<{ id: T; label: string }>
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AnalyticsStudio() {
  const [query, setQuery]         = useState<AnalyticsQuery>(DEFAULT_QUERY)
  const [saveOpen, setSaveOpen]   = useState(false)
  const [saveName, setSaveName]   = useState('')
  const [showTable, setShowTable] = useState(false)
  const { views, save, remove }   = useSavedViews()

  // ── Derived catalog state ─────────────────────────────────────────────────

  const ds  = DATASET_CATALOG.find(d => d.id === query.dataset)!
  const dim = ds.dimensions.find(d => d.id === query.dimension) ?? ds.dimensions[0]

  function setDataset(id: typeof query.dataset) {
    const newDs  = DATASET_CATALOG.find(d => d.id === id)!
    const newDim = newDs.dimensions[0]
    const newMsr = newDim.measures[0]
    setQuery({ ...query, dataset: id, dimension: newDim.id, measure: newMsr.id })
  }

  function setDimension(id: typeof query.dimension) {
    const newDim = ds.dimensions.find(d => d.id === id)!
    const newMsr = newDim.measures[0]
    setQuery({ ...query, dimension: id, measure: newMsr.id })
  }

  // ── Data fetch ────────────────────────────────────────────────────────────

  const { data: chartData, isLoading, error } = useQuery<ChartData>({
    queryKey: ['analytics', query.dataset, query.dimension, query.measure, query.timeRange],
    queryFn:  () => resolveQuery(query),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  // ── Save view ─────────────────────────────────────────────────────────────

  function handleSave() {
    if (!saveName.trim()) return
    save(saveName.trim(), query)
    setSaveName('')
    setSaveOpen(false)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Analytics Studio"
        subtitle="Answer workforce questions instantly — no exports, no reports required"
        breadcrumb={[{ label: 'Reports', href: '/admin/reports' }, { label: 'Analytics Studio' }]}
      />

      {/* ── Saved views ─────────────────────────────────────────────────── */}
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mr-1">Saved</span>
          {views.map(v => (
            <button
              key={v.id}
              onClick={() => setQuery(v.query)}
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

      {/* ── Query control bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 mb-4 rounded-lg border border-border bg-card px-3 py-2.5">
        {/* Dataset */}
        <Sel
          label="Dataset"
          value={query.dataset}
          options={DATASET_CATALOG.map(d => ({ id: d.id, label: d.label }))}
          onChange={setDataset}
        />

        {/* Dimension */}
        <Sel
          label="Group by"
          value={query.dimension}
          options={ds.dimensions.map(d => ({ id: d.id, label: d.label }))}
          onChange={setDimension}
        />

        {/* Measure */}
        <Sel
          label="Metric"
          value={query.measure}
          options={dim.measures.map(m => ({ id: m.id, label: m.label }))}
          onChange={v => setQuery({ ...query, measure: v })}
        />

        {/* Time range */}
        <Sel
          label="Period"
          value={query.timeRange}
          options={TIME_RANGES}
          onChange={v => setQuery({ ...query, timeRange: v })}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Chart type icons */}
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          {CHART_TYPES.map(({ id, Icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => setQuery({ ...query, chartType: id })}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded transition-colors',
                query.chartType === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        {/* Save view */}
        <div className="relative">
          {saveOpen ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaveOpen(false) }}
                placeholder="View name…"
                className="h-8 w-32 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="h-8 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Save
              </button>
              <button onClick={() => setSaveOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSaveOpen(true)}
              className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Bookmark className="h-3 w-3" />
              Save view
            </button>
          )}
        </div>

        {/* Export */}
        <button
          onClick={() => chartData && exportToCSV(chartData, query)}
          disabled={!chartData || chartData.isEmpty}
          className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-3 w-3" />
          Export CSV
        </button>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4 mb-3">
        {/* Chart header */}
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{chartData?.measureLabel ?? '—'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{chartTitle(query)}</p>
          </div>
          {chartData && !chartData.isEmpty && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
              <span>{chartData.labels.length} {query.dimension === 'time' ? 'periods' : 'groups'}</span>
              {chartData.series.length > 1 && <span>{chartData.series.length} series</span>}
            </div>
          )}
        </div>

        {/* Chart content */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm">Failed to load data</p>
            <p className="text-xs">Check that payroll data exists for the selected period</p>
          </div>
        ) : chartData ? (
          <ChartDisplay data={chartData} chartType={query.chartType} />
        ) : null}
      </div>

      {/* ── Data table (collapsible) ─────────────────────────────────────── */}
      {chartData && !chartData.isEmpty && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <button
            onClick={() => setShowTable(p => !p)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
          >
            <span>Data Table</span>
            <span className="text-muted-foreground">{showTable ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showTable && (
            <div className="border-t border-border">
              <DataTableView data={chartData} />
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
