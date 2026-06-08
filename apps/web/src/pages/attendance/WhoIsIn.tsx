/**
 * Who Is In — Real-time Attendance Status Board
 *
 * Four columns: Not Yet In / Late Arrivals / On Time / Out of Office
 * Tenant-wide (admin view). Auto-refreshes every 5 minutes.
 */

import { useState, useMemo }  from 'react'
import { useQuery }           from '@tanstack/react-query'
import {
  Calendar, Search, Download, RefreshCw,
  UserCheck, UserX, Plane,
  AlertCircle,
} from 'lucide-react'
import { api }             from '@/lib/api/client'
import { PageContainer }   from '@/components/layout/PageContainer'
import { PageHeader }      from '@/components/layout/PageHeader'
import { Input }           from '@/components/ui/input'
import { DateInput }       from '@/components/ui/date-input'
import { Button }          from '@/components/ui/button'
import { Badge }           from '@/components/ui/badge'
import { cn }              from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NotYetInEmp   { employee_id: string; employee_code: string; name: string; department: string | null; shift_name: string | null; expected_time: string | null }
interface LateEmp       { employee_id: string; employee_code: string; name: string; department: string | null; shift_name: string | null; check_in: string; late_minutes: number; late_by: string }
interface OnTimeEmp     { employee_id: string; employee_code: string; name: string; department: string | null; shift_name: string | null; check_in: string; early_minutes: number; early_by: string }
interface OooEmp        { employee_id: string; employee_code: string; name: string; department: string | null; status: string; days: number; applied: boolean }

interface WhoIsInData {
  date:          string
  summary: {
    not_yet_in:    { count: number; pct: number }
    late_arrivals: { count: number; pct: number }
    on_time:       { count: number; pct: number }
    out_of_office: { count: number; pct: number }
    total:         number
  }
  not_yet_in:    NotYetInEmp[]
  late_arrivals: LateEmp[]
  on_time:       OnTimeEmp[]
  out_of_office: {
    on_leave: number; holiday: number; off_day: number; rest_day: number
    employees: OooEmp[]
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso: string) {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Column card wrapper ────────────────────────────────────────────────────────

type Tone = 'neutral' | 'destructive' | 'success' | 'info'

const TONE_CLS: Record<Tone, { head: string; icon: string; badge: string }> = {
  neutral:     { head: 'bg-muted/40',     icon: 'text-muted-foreground', badge: 'bg-background/70 text-foreground' },
  destructive: { head: 'bg-destructive/[0.06]', icon: 'text-destructive', badge: 'bg-destructive/10 text-destructive' },
  success:     { head: 'bg-success/[0.06]', icon: 'text-success',   badge: 'bg-success/10 text-success' },
  info:        { head: 'bg-info/[0.06]',    icon: 'text-info',      badge: 'bg-info/10 text-info' },
}

function Column({
  title, count, tone, icon: Icon, onDownload, children,
}: {
  title:      string
  count:      number
  tone:       Tone
  icon:       React.ComponentType<{ className?: string }>
  onDownload: () => void
  children:   React.ReactNode
}) {
  const t = TONE_CLS[tone]
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-elev-1 h-[60vh] min-h-[360px] max-h-[680px]">
      {/* Header */}
      <div className={cn('flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0', t.head)}>
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', t.icon)} />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className={cn('text-xs font-bold tabular-nums rounded-full px-2 py-0.5', t.badge)}>
            {count}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-50 hover:opacity-100" onClick={onDownload}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60 min-h-0">
        {children}
      </div>
    </div>
  )
}

// Centered empty-state filler for a column body
function ColumnEmpty({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon className="h-7 w-7 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}

// ── Employee row ───────────────────────────────────────────────────────────────

function EmpRow({ name, code, right }: { name: string; code: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground">#{code}</p>
      </div>
      <div className="text-right ml-3 flex-shrink-0">{right}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function WhoIsIn() {
  const [date,   setDate]   = useState(today)
  const [search, setSearch] = useState('')

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<WhoIsInData>({
    queryKey:  ['who-is-in', date],
    queryFn:   () => api.get(`/attendance/who-is-in?date=${date}`),
    staleTime: 5 * 60 * 1000,   // 5-min cache
    refetchInterval: 5 * 60 * 1000,
  })

  // Client-side search across all columns
  const q = search.trim().toLowerCase()

  const notYetIn = useMemo(() =>
    (data?.not_yet_in ?? []).filter(e =>
      !q || e.name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)
    ), [data, q])

  const lateArrivals = useMemo(() =>
    (data?.late_arrivals ?? []).filter(e =>
      !q || e.name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)
    ), [data, q])

  const onTime = useMemo(() =>
    (data?.on_time ?? []).filter(e =>
      !q || e.name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)
    ), [data, q])

  const outOfOfficeEmps = useMemo(() =>
    (data?.out_of_office.employees ?? []).filter(e =>
      !q || e.name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)
    ), [data, q])

  const summary  = data?.summary
  const ooo      = data?.out_of_office
  const lastSync = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null

  // ── Download handlers ────────────────────────────────────────────────────────

  function dlNotYetIn() {
    downloadCSV(`not-yet-in-${date}.csv`, [
      ['Employee', 'Code', 'Department', 'Shift', 'Expected Time'],
      ...notYetIn.map(e => [e.name, e.employee_code, e.department ?? '', e.shift_name ?? '', e.expected_time ?? '']),
    ])
  }
  function dlLate() {
    downloadCSV(`late-arrivals-${date}.csv`, [
      ['Employee', 'Code', 'Department', 'Late By', 'Check-In Time'],
      ...lateArrivals.map(e => [e.name, e.employee_code, e.department ?? '', e.late_by, e.check_in]),
    ])
  }
  function dlOnTime() {
    downloadCSV(`on-time-${date}.csv`, [
      ['Employee', 'Code', 'Department', 'Early By', 'Check-In Time'],
      ...onTime.map(e => [e.name, e.employee_code, e.department ?? '', e.early_by, e.check_in]),
    ])
  }
  function dlOoo() {
    downloadCSV(`out-of-office-${date}.csv`, [
      ['Employee', 'Code', 'Department', 'Status'],
      ...outOfOfficeEmps.map(e => [e.name, e.employee_code, e.department ?? '', e.status]),
    ])
  }

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Who Is In" subtitle="Real-time attendance status" breadcrumb={[{ label: 'Who Is In' }]} />
        <div className="flex items-center justify-center py-32 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading attendance data…
        </div>
      </PageContainer>
    )
  }

  if (isError) {
    return (
      <PageContainer>
        <PageHeader title="Who Is In" subtitle="Real-time attendance status" breadcrumb={[{ label: 'Who Is In' }]} />
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm">Failed to load attendance data.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      </PageContainer>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <PageContainer spacing="tight">
      <PageHeader
        title="Who Is In"
        subtitle="Real-time attendance status board"
        breadcrumb={[{ label: 'Who Is In' }]}
      />

      {/* ── Controls row ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date picker */}
        <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-card">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <DateInput
            value={date}
            onChange={setDate}
            className="text-sm bg-transparent outline-none text-foreground"
          />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-9 text-sm w-56"
            placeholder="Search by name or ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1" />

        {lastSync && (
          <span className="text-[11px] text-muted-foreground">Last synced {lastSync}</span>
        )}
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────────────── */}
      {summary && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground">
              Employees Information for &nbsp;<span className="text-foreground">{fmtDate(date)}</span>
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
            {[
              { label: 'Not Yet In',    count: summary.not_yet_in.count,    pct: summary.not_yet_in.pct,    color: 'text-muted-foreground' },
              { label: 'Late In',       count: summary.late_arrivals.count,  pct: summary.late_arrivals.pct,  color: 'text-destructive'       },
              { label: 'On-Time',       count: summary.on_time.count,        pct: summary.on_time.pct,        color: 'text-success'           },
              { label: 'Out of Office', count: summary.out_of_office.count,  pct: summary.out_of_office.pct,  color: 'text-info'              },
            ].map(({ label, count, pct, color }) => (
              <div key={label} className="px-4 py-3.5 text-center">
                <p className={cn('font-display text-2xl font-bold tabular-nums', color)}>{(pct ?? 0).toFixed(1)}%</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  <span className="font-semibold text-foreground">{count}</span> {label.toLowerCase()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Four columns ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

        {/* Not Yet In */}
        <Column
          title="Not Yet In"
          count={notYetIn.length}
          tone="neutral"
          icon={UserX}
          onDownload={dlNotYetIn}
        >
          {notYetIn.length === 0 ? (
            <ColumnEmpty icon={UserCheck} text="All employees accounted for" />
          ) : (
            notYetIn.map(e => (
              <EmpRow key={e.employee_id} name={e.name} code={e.employee_code} right={
                <div>
                  {e.expected_time && (
                    <p className="text-xs font-mono text-muted-foreground">{e.expected_time.slice(0, 5)}</p>
                  )}
                </div>
              } />
            ))
          )}
        </Column>

        {/* Late Arrivals */}
        <Column
          title="Late Arrivals"
          count={lateArrivals.length}
          tone="destructive"
          icon={AlertCircle}
          onDownload={dlLate}
        >
          {lateArrivals.length === 0 ? (
            <ColumnEmpty icon={AlertCircle} text="No late arrivals" />
          ) : (
            lateArrivals.map(e => (
              <EmpRow key={e.employee_id} name={e.name} code={e.employee_code} right={
                <div className="text-right">
                  <p className="text-xs font-semibold text-destructive">{e.late_by}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{e.check_in}</p>
                </div>
              } />
            ))
          )}
        </Column>

        {/* On Time */}
        <Column
          title="On Time"
          count={onTime.length}
          tone="success"
          icon={UserCheck}
          onDownload={dlOnTime}
        >
          {onTime.length === 0 ? (
            <ColumnEmpty icon={UserCheck} text="No on-time arrivals yet" />
          ) : (
            onTime.map(e => (
              <EmpRow key={e.employee_id} name={e.name} code={e.employee_code} right={
                <div className="text-right">
                  {e.early_minutes > 0 && (
                    <p className="text-xs font-semibold text-success">{e.early_by}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground font-mono">{e.check_in}</p>
                </div>
              } />
            ))
          )}
        </Column>

        {/* Out of Office */}
        <Column
          title="Out of Office"
          count={outOfOfficeEmps.length}
          tone="info"
          icon={Plane}
          onDownload={dlOoo}
        >
          {/* Sub-counts strip */}
          {ooo && (
            <div className="grid grid-cols-4 divide-x divide-border/60 border-b border-border/60 bg-muted/20">
              {[
                { label: 'On Leave', val: ooo.on_leave  },
                { label: 'Holiday',  val: ooo.holiday   },
                { label: 'Off Day',  val: ooo.off_day   },
                { label: 'Rest Day', val: ooo.rest_day  },
              ].map(({ label, val }) => (
                <div key={label} className="py-2 text-center">
                  <p className="text-sm font-bold tabular-nums">{val}</p>
                  <p className="text-[9px] text-muted-foreground leading-tight">{label}</p>
                </div>
              ))}
            </div>
          )}

          {outOfOfficeEmps.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
              <Plane className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No one out of office</p>
            </div>
          ) : (
            outOfOfficeEmps.map(e => (
              <EmpRow key={e.employee_id} name={e.name} code={e.employee_code} right={
                <div className="text-right flex flex-col items-end gap-1">
                  <p className="text-xs text-muted-foreground">{e.days} Day{e.days !== 1 ? 's' : ''}</p>
                  {e.applied && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-info/40 text-info bg-info/5">
                      Applied
                    </Badge>
                  )}
                </div>
              } />
            ))
          )}
        </Column>

      </div>
    </PageContainer>
  )
}
