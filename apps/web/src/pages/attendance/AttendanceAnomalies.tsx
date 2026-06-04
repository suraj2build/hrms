/**
 * AttendanceAnomalies — /admin/attendance/anomalies
 *
 * Repurposed as a READ-ONLY HR monitoring view.
 * Shows department-level anomaly rates — NOT individual actionable rows.
 *
 * Why: At scale (4000+ employees) raw anomaly lists are unactionable.
 * Anomalies are resolved via the regularisation workflow (manager approval).
 * This view gives HR leadership oversight into which departments need attention.
 *
 * Data: GET /attendance/anomalies/summary?month=YYYY-MM
 */

import { useState, useMemo }     from 'react'
import { useNavigate }           from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronLeft, ChevronRight,
  BarChart3, ArrowRight, Loader2,
  ShieldAlert, CheckCircle2, RefreshCw,
} from 'lucide-react'
import { toast }                 from 'sonner'
import { PageContainer }         from '@/components/layout/PageContainer'
import { Button }                from '@/components/ui/button'
import { cn }                    from '@/lib/utils'
import { api }                   from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeptRow {
  department_id:        string | null
  department_name:      string
  employee_count:       number
  affected_employees:   number
  anomaly_count:        number
  unresolved_count:     number
  high_severity_count:  number
  anomaly_rate:         number | null
  by_type: {
    no_punch:        number
    missing_punch:   number
    missing_out:     number
    late:            number
    excessive_hours: number
  }
}

interface SummaryResp {
  month: string
  summary: {
    total:         number
    unresolved:    number
    high_severity: number
    by_type:       Record<string, number>
  }
  by_department: DeptRow[]
  trend: Array<{ month: string; total: number; unresolved: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString('default', { month: 'long', year: 'numeric' })
}

function prevMonth(ym: string) {
  const d = new Date(`${ym}-01`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function nextMonth(ym: string) {
  const d = new Date(`${ym}-01`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function rateColor(rate: number | null) {
  if (rate == null) return 'text-muted-foreground'
  if (rate >= 3)    return 'text-destructive font-bold'
  if (rate >= 1.5)  return 'text-warning font-semibold'
  if (rate >= 0.5)  return 'text-foreground'
  return 'text-success'
}

function RateBar({ rate, max }: { rate: number; max: number }) {
  const pct = max > 0 ? Math.min((rate / max) * 100, 100) : 0
  const color = rate >= 3 ? 'bg-destructive' : rate >= 1.5 ? 'bg-warning' : rate >= 0.5 ? 'bg-primary' : 'bg-success'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── KPI tile ──────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, icon: Icon, iconBg, iconColor, valueColor,
}: {
  label: string; value: string | number; sub?: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string; iconColor: string; valueColor?: string
}) {
  return (
    <div className="rounded-2xl bg-card shadow-card p-5 flex flex-col gap-3">
      <span className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0', iconBg)}>
        <Icon className={cn('h-5 w-5', iconColor)} />
      </span>
      <div>
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className={cn('font-display text-[2rem] font-black tabular-nums leading-none mt-1', valueColor ?? 'text-foreground')}>
          {value ?? '—'}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  )
}

// ── AttendanceAnomalies ───────────────────────────────────────────────────────

export default function AttendanceAnomalies() {
  const nav = useNavigate()
  const qc  = useQueryClient()
  const [month, setMonth] = useState(currentMonth)
  const isCurrentMonth    = month === currentMonth()

  const { data, isLoading, error } = useQuery<SummaryResp>({
    queryKey: ['anomaly-summary', month],
    queryFn:  () => api.get(`/attendance/anomalies/summary?month=${month}`),
    staleTime: 5 * 60_000,
  })

  // Reconcile: auto-resolve anomalies that the current attendance contradicts
  // (e.g. stale "no punch" after attendance was recomputed to present/leave).
  const reconcileMut = useMutation<{ scanned: number; auto_resolved: number }, Error>({
    mutationFn: () => api.post('/attendance/anomalies/reconcile', {}),
    onSuccess: (res: any) => {
      const r = res?.auto_resolved ?? res?.data?.auto_resolved ?? 0
      toast.success('Anomalies reconciled', {
        description: `${r} stale anomal${r === 1 ? 'y' : 'ies'} auto-resolved against current attendance.`,
      })
      qc.invalidateQueries({ queryKey: ['anomaly-summary'] })
    },
    onError: (e) => toast.error('Reconcile failed', { description: e.message }),
  })

  const maxRate = useMemo(() => {
    if (!data?.by_department) return 1
    return Math.max(...data.by_department.map(d => d.anomaly_rate ?? 0), 1)
  }, [data])

  // Trend: compare current vs prev month total
  const trend = useMemo(() => {
    if (!data?.trend || data.trend.length < 2) return null
    const curr = data.trend[data.trend.length - 1]?.total ?? 0
    const prev = data.trend[data.trend.length - 2]?.total ?? 0
    if (prev === 0) return null
    const pct = Math.round(((curr - prev) / prev) * 100)
    return { pct, up: curr > prev }
  }, [data])

  return (
    <PageContainer>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Anomaly Monitor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Department-level attendance anomaly rates — read-only oversight view
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Reconcile — clears anomalies contradicted by current attendance */}
          <Button
            variant="outline" size="sm" className="h-9 gap-1.5"
            onClick={() => reconcileMut.mutate()}
            disabled={reconcileMut.isPending}
            title="Auto-resolve stale anomalies (e.g. 'no punch' on days now marked present/leave)"
          >
            {reconcileMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reconcile
          </Button>

          {/* Month navigation */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-1 py-1 shadow-card">
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg"
              onClick={() => setMonth(prevMonth)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold text-foreground px-2 min-w-[130px] text-center">
              {fmtMonth(month)}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg"
              disabled={isCurrentMonth}
              onClick={() => setMonth(nextMonth)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center py-16 gap-2 text-destructive/70">
          <AlertTriangle className="h-4 w-4" /> Failed to load — please refresh
        </div>
      )}

      {data && (
        <>
          {/* ── KPI strip ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <KpiTile
              label="Total Anomalies"
              value={data.summary.total}
              sub={trend ? `${trend.up ? '↑' : '↓'} ${Math.abs(trend.pct)}% vs last month` : 'This month'}
              icon={AlertTriangle}
              iconBg={data.summary.total > 100 ? 'bg-amber-50' : 'bg-muted'}
              iconColor={data.summary.total > 100 ? 'text-amber-600' : 'text-muted-foreground'}
              valueColor={data.summary.total > 100 ? 'text-amber-700' : undefined}
            />
            <KpiTile
              label="Unresolved"
              value={data.summary.unresolved}
              sub="No regularisation submitted"
              icon={ShieldAlert}
              iconBg={data.summary.unresolved > 50 ? 'bg-destructive/8' : 'bg-muted'}
              iconColor={data.summary.unresolved > 50 ? 'text-destructive' : 'text-muted-foreground'}
              valueColor={data.summary.unresolved > 50 ? 'text-destructive' : undefined}
            />
            <KpiTile
              label="High Severity"
              value={data.summary.high_severity}
              sub="Needs priority attention"
              icon={AlertTriangle}
              iconBg="bg-rose-50"
              iconColor="text-rose-600"
              valueColor={data.summary.high_severity > 0 ? 'text-rose-700' : undefined}
            />
            <KpiTile
              label="Departments Affected"
              value={data.by_department.filter(d => d.anomaly_count > 0).length}
              sub={`of ${data.by_department.length} total`}
              icon={BarChart3}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
            />
          </div>

          {/* ── 3-month trend strip ───────────────────────────────── */}
          {data.trend.length > 0 && (
            <div className="rounded-2xl bg-card shadow-card px-5 py-4 mb-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
                3-Month Trend
              </p>
              <div className="flex items-end gap-6">
                {data.trend.map((t, i) => {
                  const isLatest = i === data.trend.length - 1
                  const maxVal   = Math.max(...data.trend.map(x => x.total), 1)
                  const barH     = Math.max(Math.round((t.total / maxVal) * 64), 4)
                  return (
                    <div key={t.month} className="flex flex-col items-center gap-1.5">
                      <span className={cn('text-[11px] font-bold tabular-nums', isLatest ? 'text-primary' : 'text-muted-foreground')}>
                        {t.total}
                      </span>
                      <div
                        className={cn('w-10 rounded-t-md transition-all', isLatest ? 'bg-primary' : 'bg-muted')}
                        style={{ height: `${barH}px` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{fmtMonth(t.month).split(' ')[0]}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Department table ──────────────────────────────────── */}
          <div className="rounded-2xl bg-card shadow-card overflow-hidden">
            {/* Notice banner */}
            <div className="flex items-center gap-2.5 px-4 py-3 bg-primary/[0.04] border-b border-primary/10">
              <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
              <p className="text-[12px] text-primary/80 font-medium">
                Anomalies are resolved via the <strong>Regularisation workflow</strong> — employees submit requests, managers approve.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs border-primary/20 text-primary hover:bg-primary/5 flex-shrink-0"
                onClick={() => nav('/admin/attendance/regularisation')}
              >
                Manager Queue <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_2fr] gap-4 px-4 py-2.5 border-b border-border bg-muted/20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Department</span>
              <span className="text-right">Employees</span>
              <span className="text-right">Anomalies</span>
              <span className="text-right">Unresolved</span>
              <span className="text-right">Rate / emp</span>
              <span>Breakdown</span>
            </div>

            {data.by_department.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <CheckCircle2 className="h-10 w-10 text-success/40" />
                <p className="text-sm font-medium text-muted-foreground">No anomalies recorded this month</p>
              </div>
            )}

            {data.by_department.map((dept, i) => (
              <div
                key={dept.department_id ?? i}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_2fr] gap-4 items-center px-4 py-3 border-b border-border/40 hover:bg-muted/20 transition-colors last:border-0"
              >
                {/* Department name */}
                <div>
                  <p className="text-sm font-semibold text-foreground">{dept.department_name}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {dept.affected_employees} of {dept.employee_count} employees affected
                  </p>
                </div>

                {/* Employee count */}
                <p className="text-sm tabular-nums text-right text-muted-foreground">{dept.employee_count}</p>

                {/* Anomaly count */}
                <p className={cn('text-sm tabular-nums text-right font-semibold',
                  dept.anomaly_count > 50 ? 'text-destructive' : dept.anomaly_count > 20 ? 'text-warning' : 'text-foreground'
                )}>
                  {dept.anomaly_count}
                </p>

                {/* Unresolved */}
                <p className={cn('text-sm tabular-nums text-right',
                  dept.unresolved_count > 20 ? 'text-destructive font-semibold' : 'text-muted-foreground'
                )}>
                  {dept.unresolved_count}
                </p>

                {/* Rate */}
                <div className="text-right">
                  <p className={cn('text-sm tabular-nums', rateColor(dept.anomaly_rate))}>
                    {dept.anomaly_rate != null ? dept.anomaly_rate.toFixed(1) : '—'}
                  </p>
                  {dept.anomaly_rate != null && (
                    <RateBar rate={dept.anomaly_rate} max={maxRate} />
                  )}
                </div>

                {/* Type breakdown pills */}
                <div className="flex flex-wrap gap-1">
                  {Object.entries(dept.by_type)
                    .filter(([, v]) => v > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <span
                        key={type}
                        className="inline-flex items-center text-[9.5px] font-semibold bg-muted text-muted-foreground rounded-full px-2 py-0.5 capitalize"
                      >
                        {type.replace(/_/g, ' ')} · {count}
                      </span>
                    ))
                  }
                </div>
              </div>
            ))}
          </div>

          {/* ── Footer note ───────────────────────────────────────── */}
          <p className="text-[11px] text-muted-foreground text-center mt-4">
            Anomaly rate = anomalies ÷ active employee count · Data refreshed every 5 minutes
          </p>
        </>
      )}
    </PageContainer>
  )
}

// Named export alias for router compatibility
// (App.tsx and AttendanceWorkspace.tsx lazy-import this as a named export)
export { AttendanceAnomalies }
