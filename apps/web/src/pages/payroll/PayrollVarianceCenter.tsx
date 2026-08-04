/**
 * PayrollVarianceCenter — /admin/payroll/variance
 *
 * Month-over-month variance intelligence: sudden net-pay changes, LOP spikes,
 * overtime spikes, deduction anomalies, zero-net employees, negative net risks.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }                     from 'react'
import { Link }                                  from 'react-router-dom'
import { useQuery }                              from '@tanstack/react-query'
import {
  TrendingDown, AlertTriangle, Search,
  Users, BarChart2, ChevronDown,
  ChevronRight, ArrowUpRight, ArrowDownRight,
  Minus, Filter, RefreshCw, Info, Loader2,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { cn, formatCurrency as fmtCurrency } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayrollRun {
  id:               string
  month:            string
  status:           string
  employee_count:   number
  total_gross:      number
  total_net:        number
  created_at:       string
}

interface VarianceRow {
  employee_id:   string
  employee_name: string
  employee_code: string
  department:    string | null
  current_gross: number
  prev_gross:    number
  current_net:   number
  prev_net:      number
  delta_amount:  number
  delta_pct:     number
  flagged:       boolean
  reason:        string | null
  lop_days:      number
  prev_lop_days: number
  overtime_hours:      number
  prev_overtime_hours: number
}

type AnomalyType = 'all' | 'flagged' | 'zero_net' | 'lop_spike' | 'ot_spike' | 'net_drop' | 'net_spike'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function DeltaChip({ value, pct, small }: { value: number; pct: number; small?: boolean }) {
  const isUp = value >= 0
  return (
    <div className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium',
      small ? 'text-[10px]' : 'text-xs',
      isUp ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
    )}>
      {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isUp ? '+' : ''}{fmtCurrency(value)}
      <span className="opacity-70">({isUp ? '+' : ''}{(pct ?? 0).toFixed(1)}%)</span>
    </div>
  )
}

// ── Anomaly Filters ────────────────────────────────────────────────────────────

const ANOMALY_FILTERS: { key: AnomalyType; label: string; color: string }[] = [
  { key: 'all',       label: 'All Employees', color: '' },
  { key: 'flagged',   label: 'Flagged',       color: 'text-warning' },
  { key: 'zero_net',  label: 'Zero Net',      color: 'text-destructive' },
  { key: 'lop_spike', label: 'LOP Spike',     color: 'text-warning' },
  { key: 'ot_spike',  label: 'OT Spike',      color: 'text-info' },
  { key: 'net_drop',  label: 'Net Drop >20%', color: 'text-destructive' },
  { key: 'net_spike', label: 'Net Spike >20%',color: 'text-success' },
]

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollVarianceCenter() {
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [anomalyFilter, setAnomalyFilter] = useState<AnomalyType>('all')
  const [search, setSearch] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // All runs (for run selector)
  const { data: runsRaw, isLoading: runsLoading } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-variance-list'],
    queryFn:  () => api.get('/payroll/runs?limit=12'),
    staleTime: 60_000,
  })
  const runs = runsRaw?.data ?? []

  // Auto-select latest run
  const activeRunId = selectedRun ?? runs[0]?.id ?? null
  const activeRun   = runs.find(r => r.id === activeRunId) ?? runs[0] ?? null

  // Variance data for selected run
  const { data: varianceRaw, isLoading: varLoading, refetch } = useQuery<{ data: VarianceRow[] }>({
    queryKey: ['payroll-variance', activeRunId],
    queryFn:  () => api.get(`/payroll/runs/${activeRunId}/variance`),
    enabled:  !!activeRunId,
    staleTime: 60_000,
  })
  const allRows: VarianceRow[] = useMemo(() => varianceRaw?.data ?? [], [varianceRaw])

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const flagged    = allRows.filter(r => r.flagged)
    const zeroNet    = allRows.filter(r => r.current_net <= 0)
    const lopSpike   = allRows.filter(r => r.lop_days > r.prev_lop_days + 2)
    const otSpike    = allRows.filter(r => r.overtime_hours > r.prev_overtime_hours * 1.5 && r.overtime_hours > 4)
    const netDrop    = allRows.filter(r => r.delta_pct < -20)
    const netSpike   = allRows.filter(r => r.delta_pct > 20)
    const avgDelta   = allRows.length > 0 ? allRows.reduce((s, r) => s + r.delta_amount, 0) / allRows.length : 0
    const maxDrop    = allRows.reduce((min, r) => r.delta_pct < min ? r.delta_pct : min, 0)
    return { flagged, zeroNet, lopSpike, otSpike, netDrop, netSpike, avgDelta, maxDrop }
  }, [allRows])

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let rows = allRows
    if (anomalyFilter === 'flagged')   rows = rows.filter(r => r.flagged)
    if (anomalyFilter === 'zero_net')  rows = rows.filter(r => r.current_net <= 0)
    if (anomalyFilter === 'lop_spike') rows = rows.filter(r => r.lop_days > r.prev_lop_days + 2)
    if (anomalyFilter === 'ot_spike')  rows = rows.filter(r => r.overtime_hours > r.prev_overtime_hours * 1.5 && r.overtime_hours > 4)
    if (anomalyFilter === 'net_drop')  rows = rows.filter(r => r.delta_pct < -20)
    if (anomalyFilter === 'net_spike') rows = rows.filter(r => r.delta_pct > 20)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        (r.employee_name ?? '').toLowerCase().includes(q) ||
        (r.employee_code ?? '').toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q),
      )
    }
    return [...rows].sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))
  }, [allRows, anomalyFilter, search])

  const toggleRow = (id: string) =>
    setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <PageContainer>
      <PageHeader
        title="Variance Intelligence"
        subtitle="Month-over-month anomaly detection and net-pay variance analysis"
        actions={
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={varLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', varLoading && 'animate-spin')} />Refresh
          </Button>
        }
      />

      {/* Run Selector */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        {runsLoading
          ? <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading runs…</div>
          : runs.map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedRun(r.id)}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                r.id === activeRunId
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
              )}
            >
              {fmtMonth(r.month)}
              {r.status === 'finalized' && <span className="ml-1 opacity-60">✓</span>}
            </button>
          ))
        }
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {[
          { label: 'Total Employees',   value: allRows.length,           color: '',                  icon: <Users className="h-3.5 w-3.5" /> },
          { label: 'Flagged Anomalies', value: stats.flagged.length,     color: stats.flagged.length > 0 ? 'text-warning' : 'text-success', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
          { label: 'Zero Net Pay',      value: stats.zeroNet.length,     color: stats.zeroNet.length > 0 ? 'text-destructive' : 'text-success', icon: <Minus className="h-3.5 w-3.5" /> },
          { label: 'LOP Spikes',        value: stats.lopSpike.length,    color: stats.lopSpike.length > 0 ? 'text-warning' : 'text-success', icon: <TrendingDown className="h-3.5 w-3.5" /> },
          { label: 'Net Drop >20%',     value: stats.netDrop.length,     color: stats.netDrop.length > 0 ? 'text-destructive' : 'text-success', icon: <ArrowDownRight className="h-3.5 w-3.5" /> },
          { label: 'Net Spike >20%',    value: stats.netSpike.length,    color: stats.netSpike.length > 0 ? 'text-info' : 'text-success', icon: <ArrowUpRight className="h-3.5 w-3.5" /> },
        ].map(k => (
          <div key={k.label} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">{k.icon}<span>{k.label}</span></div>
            <p className={cn('text-xl font-bold tabular-nums', k.color, varLoading && 'animate-pulse text-muted-foreground/30')}>{varLoading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      {/* Anomaly Type Filter Tabs */}
      <div className="mb-4 flex items-center gap-1 overflow-x-auto pb-1">
        <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mr-1" />
        {ANOMALY_FILTERS.map(f => {
          const count = f.key === 'all' ? allRows.length
            : f.key === 'flagged' ? stats.flagged.length
            : f.key === 'zero_net' ? stats.zeroNet.length
            : f.key === 'lop_spike' ? stats.lopSpike.length
            : f.key === 'ot_spike' ? stats.otSpike.length
            : f.key === 'net_drop' ? stats.netDrop.length
            : stats.netSpike.length
          return (
            <button
              key={f.key}
              onClick={() => setAnomalyFilter(f.key)}
              className={cn(
                'flex-shrink-0 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors',
                anomalyFilter === f.key
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
                f.color,
              )}
            >
              {f.label}
              {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="mb-3 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-8 text-xs"
          placeholder="Search employee name, code, or department…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Variance Table */}
      <SectionCard
        title={`Employee Variance (${filteredRows.length})`}
        icon={<BarChart2 className="h-4 w-4" />}
        description={activeRun ? `${fmtMonth(activeRun.month)} vs previous month` : undefined}
      >
        {varLoading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />Loading variance data…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-1.5">
            <BarChart2 className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No variance data for this filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Employee', 'Dept', 'Prev Net', 'Current Net', 'Δ Net', 'LOP Δ', 'OT Δ', 'Flag', ''].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const isExpanded = expandedRows.has(row.employee_id)
                  const lopDelta   = (row.lop_days ?? 0) - (row.prev_lop_days ?? 0)
                  const otDelta    = (row.overtime_hours ?? 0) - (row.prev_overtime_hours ?? 0)
                  return (
                    <>
                      <tr
                        key={row.employee_id}
                        className={cn(
                          'border-b border-border/50 hover:bg-muted/20 cursor-pointer',
                          row.flagged && 'bg-warning/5',
                          row.current_net <= 0 && 'bg-destructive/5',
                        )}
                        onClick={() => toggleRow(row.employee_id)}
                      >
                        <td className="px-3 py-2 font-medium">
                          <div>{row.employee_name}</div>
                          <div className="text-[10px] text-muted-foreground">{row.employee_code}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.department ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtCurrency(row.prev_net)}</td>
                        <td className={cn('px-3 py-2 tabular-nums font-semibold', row.current_net <= 0 ? 'text-destructive' : '')}>
                          {fmtCurrency(row.current_net)}
                        </td>
                        <td className="px-3 py-2">
                          <DeltaChip value={row.delta_amount} pct={row.delta_pct} small />
                        </td>
                        <td className={cn('px-3 py-2 tabular-nums', lopDelta > 2 ? 'text-warning font-semibold' : 'text-muted-foreground')}>
                          {lopDelta > 0 ? `+${lopDelta}` : lopDelta}d
                        </td>
                        <td className={cn('px-3 py-2 tabular-nums', otDelta > 8 ? 'text-info font-semibold' : 'text-muted-foreground')}>
                          {otDelta > 0 ? `+${otDelta.toFixed(1)}` : otDelta.toFixed(1)}h
                        </td>
                        <td className="px-3 py-2">
                          {row.flagged
                            ? <Badge variant="outline" className="text-warning border-warning/40 text-[9px] rounded-full">Flagged</Badge>
                            : row.current_net <= 0
                              ? <Badge variant="outline" className="text-destructive border-destructive/30 text-[9px] rounded-full">Zero Net</Badge>
                              : <span className="text-muted-foreground">—</span>
                          }
                        </td>
                        <td className="px-3 py-2">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${row.employee_id}-detail`} className="bg-muted/10 border-b border-border/50">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div>
                                <p className="text-muted-foreground mb-0.5">Prev Gross</p>
                                <p className="font-medium">{fmtCurrency(row.prev_gross)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-0.5">Current Gross</p>
                                <p className="font-medium">{fmtCurrency(row.current_gross)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-0.5">LOP Days (prev → cur)</p>
                                <p className="font-medium">{row.prev_lop_days} → {row.lop_days}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-0.5">OT Hours (prev → cur)</p>
                                <p className="font-medium">{row.prev_overtime_hours?.toFixed(1) ?? 0} → {row.overtime_hours?.toFixed(1) ?? 0}</p>
                              </div>
                              {row.reason && (
                                <div className="col-span-4 flex items-start gap-1.5 px-2 py-1.5 bg-warning/5 border border-warning/20 rounded-md">
                                  <Info className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
                                  <span className="text-warning">{row.reason}</span>
                                </div>
                              )}
                            </div>
                            <div className="mt-2 flex gap-2">
                              <Link to={`/admin/employees?id=${row.employee_id}`}
                                className="text-[10px] text-primary underline-offset-2 hover:underline">
                                View Employee Profile →
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
