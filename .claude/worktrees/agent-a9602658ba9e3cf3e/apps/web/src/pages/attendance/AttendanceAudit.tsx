/**
 * AttendanceAudit — /attendance/audit
 *
 * HR admin view of the attendance_audit_log table.
 * Shows who changed what, when, and why (source).
 *
 * Features:
 *   · Table view (default) — paginated, filterable
 *   · Timeline view — per-employee vertical change history
 *   · CSV export of current filtered results
 *   · Stat strip: totals by source, unique employees
 *
 * Access: hr_admin and super_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useMemo }  from 'react'
import { useQuery }            from '@tanstack/react-query'
import {
  FileSearch, ShieldAlert, RefreshCw,
  LayoutList, GitCommitVertical, Download,
} from 'lucide-react'

import { StatusChangePill }   from '@/components/operational/AttendanceDiff'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }        from '@/components/layout/PageHeader'
import { SectionCard }       from '@/components/layout/SectionCard'
import { PeriodLockBanner }  from '@/components/layout/PeriodLockBanner'
import {
  TableToolbar,
  PaginationBar,
  EmptyTableState,
} from '@/components/table'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import { usePeriodLock }  from '@/hooks/usePeriodLock'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditRow {
  id:              string
  date:            string
  source:          'system' | 'regularisation' | 'leave'
  before_status:   string | null
  after_status:    string
  created_at:      string
  metadata:        Record<string, unknown> | null
  employee_id:     string | null
  employee_name:   string | null
  employee_code:   string | null
  changed_by_name: string | null
}

interface AuditResponse {
  data:   AuditRow[]
  total:  number
  limit:  number
  offset: number
}

interface Filters {
  from:        string
  to:          string
  employee_id: string
  source:      '' | 'system' | 'regularisation' | 'leave'
}

const EMPTY_FILTERS: Filters = {
  from:        '',
  to:          '',
  employee_id: '',
  source:      '',
}

const PAGE_SIZE = 50

type ViewMode = 'table' | 'timeline'

// ── Status badge helpers ──────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' | 'default'

const SOURCE_VARIANT: Record<string, BadgeVariant> = {
  system:          'secondary',
  regularisation:  'warning',
  leave:           'outline',
}

const SOURCE_LABEL: Record<string, string> = {
  system:          'System',
  regularisation:  'Regularisation',
  leave:           'Leave',
}

// Source-specific icon/colour dot for timeline
const SOURCE_DOT: Record<string, string> = {
  system:          'bg-muted-foreground',
  regularisation:  'bg-warning',
  leave:           'bg-primary',
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** Convert rows to CSV and trigger browser download */
function exportCsv(rows: AuditRow[]) {
  const headers = ['Date', 'Employee Name', 'Employee Code', 'Source', 'Before Status', 'After Status', 'Changed At', 'Changed By']
  const escape  = (v: string | null) => (v === null || v === undefined) ? '' : `"${String(v).replace(/"/g, '""')}"`
  const lines   = [
    headers.join(','),
    ...rows.map(r => [
      r.date,
      escape(r.employee_name),
      escape(r.employee_code),
      r.source,
      r.before_status ?? '',
      r.after_status,
      new Date(r.created_at).toISOString(),
      escape(r.changed_by_name),
    ].join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `attendance-audit-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Timeline component ────────────────────────────────────────────────────────

function TimelineView({ rows }: { rows: AuditRow[] }) {
  // Group by employee
  const grouped = useMemo(() => {
    const map = new Map<string, AuditRow[]>()
    for (const row of rows) {
      const key = row.employee_id ?? 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return map
  }, [rows])

  if (rows.length === 0) {
    return (
      <EmptyTableState preset="no-audit" />
    )
  }

  return (
    <div className="p-4 space-y-8">
      {Array.from(grouped.entries()).map(([empId, empRows]) => {
        const first = empRows[0]
        return (
          <div key={empId}>
            {/* Employee header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                {(first.employee_name ?? '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {first.employee_name ?? 'Unknown Employee'}
                </p>
                {first.employee_code && (
                  <p className="text-[10px] text-muted-foreground font-mono">{first.employee_code}</p>
                )}
              </div>
              <Badge variant="secondary" className="ml-auto text-[10px] rounded-full">
                {empRows.length} change{empRows.length !== 1 ? 's' : ''}
              </Badge>
            </div>

            {/* Timeline entries */}
            <div className="relative ml-3.5 space-y-0">
              {/* Vertical line */}
              <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />

              {empRows.map((row, idx) => (
                <div key={row.id} className="relative pl-6 pb-4">
                  {/* Node dot */}
                  <div className={cn(
                    'absolute left-[-4px] top-[6px] h-2 w-2 rounded-full ring-2 ring-card',
                    SOURCE_DOT[row.source] ?? 'bg-muted-foreground',
                  )} />

                  <div className="flex flex-col gap-0.5">
                    {/* Date chip + timestamp */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono tabular-nums font-medium">{fmtDate(row.date)}</span>
                      <span className="opacity-60">·</span>
                      <span>{fmtDatetime(row.created_at)}</span>
                      {idx === 0 && (
                        <Badge variant="secondary" className="ml-1 text-[8px] px-1 py-0 rounded-sm">Latest</Badge>
                      )}
                    </div>

                    {/* Change row */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={SOURCE_VARIANT[row.source] ?? 'secondary'} className="text-[10px] rounded-full capitalize">
                        {SOURCE_LABEL[row.source] ?? row.source}
                      </Badge>
                      <StatusChangePill
                        before={row.before_status}
                        after={row.after_status}
                        className="text-[10px]"
                      />
                    </div>

                    {/* Changed by */}
                    {row.changed_by_name && (
                      <p className="text-[10px] text-muted-foreground">
                        by {row.changed_by_name}
                      </p>
                    )}
                    {!row.changed_by_name && row.source === 'system' && (
                      <p className="text-[10px] text-muted-foreground">by Processor</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AttendanceAudit() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [filters,  setFilters]  = useState<Filters>(EMPTY_FILTERS)
  const [applied,  setApplied]  = useState<Filters>(EMPTY_FILTERS)
  const [page,     setPage]     = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  // Period lock — show banner when filtering to a specific month
  const lockMonth = applied.from ? applied.from.slice(0, 7) : ''
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(lockMonth || new Date().toISOString().slice(0, 7))

  const offset = (page - 1) * PAGE_SIZE

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<AuditResponse>({
    queryKey: ['attendance-audit', applied, page],
    queryFn:  () => {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(offset),
      })
      if (applied.from)        params.set('from',        applied.from)
      if (applied.to)          params.set('to',          applied.to)
      if (applied.employee_id) params.set('employee_id', applied.employee_id)
      if (applied.source)      params.set('source',      applied.source)
      return api.get<AuditResponse>(`/attendance/audit?${params}`)
    },
    enabled:   isAdmin,
    staleTime: 30_000,
  })

  const rows  = data?.data  ?? []
  const total = data?.total ?? 0

  // ── Source breakdown counts ────────────────────────────────────────────────
  const systemCount         = rows.filter(r => r.source === 'system').length
  const regularisationCount = rows.filter(r => r.source === 'regularisation').length
  const leaveCount          = rows.filter(r => r.source === 'leave').length
  const uniqueEmployees     = new Set(rows.map(r => r.employee_id).filter(Boolean)).size

  const hasActiveFilters =
    !!applied.from || !!applied.to || !!applied.source || !!applied.employee_id

  function handleApply() {
    setPage(1)
    setApplied({ ...filters })
  }

  function handleClear() {
    setFilters(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setPage(1)
  }

  function handleRemoveChip(key: string) {
    const next = { ...applied, [key]: '' } as Filters
    setFilters(next)
    setApplied(next)
    setPage(1)
  }

  // ── Active chips ───────────────────────────────────────────────────────────
  const activeChips = [
    ...(applied.from        ? [{ key: 'from',        label: `From: ${applied.from}` }]                           : []),
    ...(applied.to          ? [{ key: 'to',          label: `To: ${applied.to}` }]                               : []),
    ...(applied.source      ? [{ key: 'source',      label: `Source: ${SOURCE_LABEL[applied.source]}` }]         : []),
    ...(applied.employee_id ? [{ key: 'employee_id', label: `Employee: ${applied.employee_id.slice(0, 8)}…` }]   : []),
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Attendance Audit Log"
        subtitle="Track every attendance status change — system, leave, or correction"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can view the audit log.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <>
          {/* Period lock banner — shown when filtering to a locked period */}
          {lockMonth && periodLocked && (
            <PeriodLockBanner state={periodState} month={lockMonth} />
          )}

          {/* ── Stat strip ──────────────────────────────────────────────── */}
          {rows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'This Page',      value: rows.length,          cls: 'text-foreground' },
                { label: 'System',         value: systemCount,          cls: 'text-muted-foreground' },
                { label: 'Regularisation', value: regularisationCount,  cls: 'text-warning' },
                { label: 'Leave',          value: leaveCount,           cls: 'text-primary' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">{label}</p>
                  <p className={cn('text-xl font-bold tabular-nums', cls)}>{value}</p>
                  {label === 'This Page' && uniqueEmployees > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{uniqueEmployees} employee{uniqueEmployees !== 1 ? 's' : ''}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <SectionCard
            title={`Audit Log${total ? ` (${total.toLocaleString()} entries)` : ''}`}
            icon={<FileSearch className="h-4 w-4 text-muted-foreground" />}
            noPadding
          >
            <TableToolbar
              left={
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="date"
                    value={filters.from}
                    onChange={e => setFilters(p => ({ ...p, from: e.target.value }))}
                    className="h-7 text-xs w-32"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={filters.to}
                    onChange={e => setFilters(p => ({ ...p, to: e.target.value }))}
                    className="h-7 text-xs w-32"
                  />
                  <select
                    value={filters.source}
                    onChange={e => setFilters(p => ({ ...p, source: e.target.value as Filters['source'] }))}
                    className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none focus:ring-1 ring-primary/50"
                  >
                    <option value="">All Sources</option>
                    <option value="system">System</option>
                    <option value="regularisation">Regularisation</option>
                    <option value="leave">Leave</option>
                  </select>
                  <Input
                    placeholder="Employee UUID…"
                    value={filters.employee_id}
                    onChange={e => setFilters(p => ({ ...p, employee_id: e.target.value }))}
                    className="h-7 text-xs w-40"
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={handleApply}>Apply</Button>
                  {hasActiveFilters && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleClear}>Clear</Button>
                  )}
                </div>
              }
              right={
                <div className="flex items-center gap-1">
                  {/* View mode toggle */}
                  <Button
                    size="sm"
                    variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                    className="h-7 w-7 p-0"
                    title="Table view"
                    onClick={() => setViewMode('table')}
                  >
                    <LayoutList className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant={viewMode === 'timeline' ? 'secondary' : 'ghost'}
                    className="h-7 w-7 p-0"
                    title="Timeline view"
                    onClick={() => setViewMode('timeline')}
                  >
                    <GitCommitVertical className="h-3.5 w-3.5" />
                  </Button>

                  {/* CSV export */}
                  {rows.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => exportCsv(rows)}
                      title="Export current page to CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => refetch()}
                    disabled={isLoading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              }
              filterChips={activeChips}
              onRemoveChip={handleRemoveChip}
              onClearAllChips={handleClear}
            />

            {/* Loading skeleton */}
            {isLoading && (
              <div className="divide-y divide-border">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                    <div className="h-3 w-16 bg-muted rounded" />
                    <div className="h-3 w-24 bg-muted rounded" />
                    <div className="h-5 w-20 bg-muted rounded-full" />
                    <div className="h-3 w-8 bg-muted rounded ml-1" />
                    <div className="h-5 w-14 bg-muted rounded-full ml-1" />
                    <div className="h-3 flex-1 bg-muted rounded" />
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {isError && (
              <div className="flex flex-col items-center gap-2 py-12">
                <p className="text-sm text-destructive">Failed to load audit log</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
              </div>
            )}

            {/* Empty */}
            {!isLoading && !isError && rows.length === 0 && (
              <EmptyTableState preset={hasActiveFilters ? 'no-results' : 'no-audit'} />
            )}

            {/* Content */}
            {!isLoading && !isError && rows.length > 0 && (
              <>
                {/* ── Timeline view ─────────────────────────────────────── */}
                {viewMode === 'timeline' && <TimelineView rows={rows} />}

                {/* ── Table view ────────────────────────────────────────── */}
                {viewMode === 'table' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          {['Date', 'Employee', 'Source', 'Change', 'Recorded At', 'Changed By'].map(h => (
                            <th
                              key={h}
                              className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr
                            key={row.id}
                            className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                          >
                            {/* Date */}
                            <td className="py-3 px-3 whitespace-nowrap text-foreground text-xs tabular-nums">
                              {fmtDate(row.date)}
                            </td>

                            {/* Employee */}
                            <td className="py-3 px-3">
                              <p className="font-medium text-foreground leading-tight">
                                {row.employee_name ?? '—'}
                              </p>
                              {row.employee_code && (
                                <p className="text-[10px] text-muted-foreground font-mono">{row.employee_code}</p>
                              )}
                            </td>

                            {/* Source badge */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <Badge
                                variant={SOURCE_VARIANT[row.source] ?? 'secondary'}
                                className="rounded-full text-[10px] capitalize"
                              >
                                {SOURCE_LABEL[row.source] ?? row.source}
                              </Badge>
                            </td>

                            {/* Before → After */}
                            <td className="py-3 px-3">
                              <StatusChangePill
                                before={row.before_status}
                                after={row.after_status}
                              />
                            </td>

                            {/* Timestamp */}
                            <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                              {fmtDatetime(row.created_at)}
                            </td>

                            {/* Changed by */}
                            <td className="py-3 px-3 text-xs text-muted-foreground">
                              {row.changed_by_name ?? (row.source === 'system' ? 'Processor' : '—')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <PaginationBar
                  total={total}
                  page={page}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              </>
            )}
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
