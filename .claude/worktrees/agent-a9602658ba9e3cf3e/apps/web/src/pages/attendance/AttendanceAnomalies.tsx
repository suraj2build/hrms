/**
 * AttendanceAnomalies — /attendance/anomalies
 *
 * Two views in one page:
 *   - Employee view (/my)  — own anomalies for the current month, read-only
 *   - HR view (default)    — all tenant anomalies with filter/search + resolve action
 *
 * Access:
 *   - Any authenticated user can see their own anomalies.
 *   - Only hr_admin / super_admin can see the full HR table and resolve anomalies.
 *
 * Design rules: design-system tokens only — no raw hex / bg-gray-* / text-blue-*.
 */

import { useState }                  from 'react'
import { Link }                      from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                     from 'sonner'
import {
  AlertTriangle, Loader2,
  CheckCircle2, GitBranch, ShieldQuestion, ClipboardEdit, Search, TrendingUp,
} from 'lucide-react'

import { PageContainer }     from '@/components/layout/PageContainer'
import { PageHeader }        from '@/components/layout/PageHeader'
import { SectionCard }       from '@/components/layout/SectionCard'
import { StatusStrip }       from '@/components/layout/StatusStrip'
import { PeriodLockBanner }  from '@/components/layout/PeriodLockBanner'
import { usePeriodLock }     from '@/hooks/usePeriodLock'
import {
  TableToolbar,
  BulkActionBar,
  PaginationBar,
  EmptyTableState,
} from '@/components/table'
import { Badge }             from '@/components/ui/badge'
import { Button }            from '@/components/ui/button'
import { Input }             from '@/components/ui/input'
import { api }               from '@/lib/api/client'
import { useAuthStore }      from '@/stores/authStore'
import { cn }                from '@/lib/utils'
import { ForensicsDrawer }   from '@/components/operational/ForensicsDrawer'
import { PolicyExplainPanel, type PolicyResolutionInfo } from '@/components/operational/PolicyChain'

// ── Types ──────────────────────────────────────────────────────────────────────

type AnomalyType     = 'missing_out' | 'no_punch' | 'late' | 'excessive_hours'
type AnomalySeverity = 'low' | 'medium' | 'high'

interface AnomalyRow {
  id:               string
  date:             string
  type:             AnomalyType
  message:          string
  severity:         AnomalySeverity
  resolved:         boolean
  created_at:       string
  resolved_at:      string | null
  // HR-only fields
  employee_id?:     string | null
  employee_name?:   string | null
  employee_code?:   string | null
  resolved_by_name?: string | null
}

interface AnomalyResponse {
  data:   AnomalyRow[]
  total:  number
  limit:  number
  offset: number
}

interface HrFilters {
  from:        string
  to:          string
  employee_id: string
  type:        '' | AnomalyType
  severity:    '' | AnomalySeverity
  resolved:    '' | 'true' | 'false'
}

const EMPTY_HR_FILTERS: HrFilters = {
  from:        '',
  to:          '',
  employee_id: '',
  type:        '',
  severity:    '',
  resolved:    'false',   // default: show unresolved only
}

const PAGE_SIZE = 50

// ── Badge helpers ──────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' | 'default'

const TYPE_VARIANT: Record<AnomalyType, BadgeVariant> = {
  missing_out:     'warning',
  no_punch:        'destructive',
  late:            'warning',
  excessive_hours: 'secondary',
}

const TYPE_LABEL: Record<AnomalyType, string> = {
  missing_out:     'Missing OUT',
  no_punch:        'No Punch',
  late:            'Late Arrival',
  excessive_hours: 'Excessive Hours',
}

const SEVERITY_VARIANT: Record<AnomalySeverity, BadgeVariant> = {
  low:    'outline',
  medium: 'warning',
  high:   'destructive',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** Days elapsed since an ISO timestamp */
function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function ageLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days}d`
}

function ageBadgeVariant(days: number): BadgeVariant {
  if (days >= 5) return 'destructive'
  if (days >= 2) return 'warning'
  return 'secondary'
}

// ── Quick filter presets ────────────────────────────────────────────────────────

interface QuickPreset {
  label:     string
  filters:   Partial<HrFilters>
}

function buildQuickPresets(): QuickPreset[] {
  const today     = new Date().toISOString().slice(0, 10)
  const weekStart = (() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1))  // Monday
    return d.toISOString().slice(0, 10)
  })()

  return [
    { label: 'High Only',    filters: { severity: 'high',   resolved: 'false', type: '', from: '', to: '' } },
    { label: 'No Punch',     filters: { type: 'no_punch',   resolved: 'false', severity: '', from: '', to: '' } },
    { label: 'Missing OUT',  filters: { type: 'missing_out', resolved: 'false', severity: '', from: '', to: '' } },
    { label: 'Today',        filters: { from: today, to: today, resolved: 'false', type: '', severity: '' } },
    { label: 'This Week',    filters: { from: weekStart, to: today, resolved: 'false', type: '', severity: '' } },
    { label: 'All Open',     filters: { resolved: 'false', type: '', severity: '', from: '', to: '' } },
  ]
}

// ── Policy resolution builder ──────────────────────────────────────────────────

const ANOMALY_RULE_DESCRIPTIONS: Record<AnomalyType, { name: string; desc: string }> = {
  missing_out: {
    name: 'Missing OUT Detection Rule',
    desc: 'A check-in was detected without a corresponding check-out punch. Attendance hours cannot be computed until a check-out is recorded. If genuine, the employee should submit a regularisation request.',
  },
  no_punch: {
    name: 'No Punch Detection Rule',
    desc: 'No attendance punches were recorded for this scheduled working day. The employee will be marked absent unless a leave application is approved or a regularisation request is submitted and approved.',
  },
  late: {
    name: 'Late Arrival Detection Rule',
    desc: 'The first check-in for this day was recorded after the allowed grace period for the employee\'s assigned shift. Late minutes are computed from shift start time plus the configured grace window.',
  },
  excessive_hours: {
    name: 'Excessive Hours Detection Rule',
    desc: 'Total logged work hours significantly exceeded the expected shift duration. This may indicate a missing OUT punch from a prior session or genuine extended work. Review the punch timeline for clarity.',
  },
}

/** Build a synthetic PolicyResolutionInfo from an anomaly row for the explainer panel */
function buildAnomalyPolicyResolution(row: AnomalyRow): PolicyResolutionInfo {
  const rule = ANOMALY_RULE_DESCRIPTIONS[row.type]
  return {
    policy_id:   null,
    policy_name: rule.name,
    source:      'default',
    rules: [
      {
        leave_type_name:    TYPE_LABEL[row.type],
        eligible:           false,
        eligibility_reason: `${row.message} — ${rule.desc}`,
      },
    ],
  }
}

// ── Employee self-view ─────────────────────────────────────────────────────────

function MyAnomaliesView() {
  const now      = new Date()
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [typeFilter, setTypeFilter] = useState<'' | AnomalyType>('')

  const { data, isLoading, isError, refetch } = useQuery<AnomalyResponse>({
    queryKey: ['my-anomalies', monthStr, typeFilter],
    queryFn:  () => {
      const params = new URLSearchParams({ limit: '50', offset: '0' })
      if (typeFilter) params.set('type', typeFilter)
      return api.get<AnomalyResponse>(`/attendance/anomalies/my?${params}`)
    },
    staleTime: 60_000,
  })

  const rows  = data?.data  ?? []
  const total = data?.total ?? 0

  return (
    <SectionCard
      title={`My Anomalies — ${total} unresolved`}
      icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      action={
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as '' | AnomalyType)}
            className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
          >
            <option value="">All types</option>
            <option value="missing_out">Missing OUT</option>
            <option value="no_punch">No Punch</option>
            <option value="late">Late</option>
            <option value="excessive_hours">Excessive Hours</option>
          </select>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="text-sm text-destructive">Failed to load anomalies</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 text-success opacity-70" />
          <p className="text-sm font-medium text-foreground">All clear!</p>
          <p className="text-xs">No attendance anomalies detected for this month.</p>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(row => (
            <div
              key={row.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-md border transition-colors',
                row.resolved
                  ? 'border-border/40 bg-muted/20 opacity-60'
                  : 'border-border bg-card',
              )}
            >
              {/* Severity indicator */}
              <AlertTriangle
                className={cn(
                  'h-4 w-4 flex-shrink-0 mt-0.5',
                  row.severity === 'high'   && 'text-destructive',
                  row.severity === 'medium' && 'text-warning',
                  row.severity === 'low'    && 'text-muted-foreground',
                )}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-1.5 mb-1">
                  <span className="text-xs font-semibold text-foreground">{fmtDate(row.date)}</span>
                  <Badge variant={TYPE_VARIANT[row.type]} className="rounded-full text-[10px] px-2">
                    {TYPE_LABEL[row.type]}
                  </Badge>
                  <Badge variant={SEVERITY_VARIANT[row.severity]} className="rounded-full text-[10px] px-2">
                    {row.severity}
                  </Badge>
                  {row.resolved && (
                    <Badge variant="success" className="rounded-full text-[10px] px-2">Resolved</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{row.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ── HR table view ──────────────────────────────────────────────────────────────

function HrAnomaliesView() {
  const qc = useQueryClient()
  const [filters, setFilters] = useState<HrFilters>(EMPTY_HR_FILTERS)
  const [applied, setApplied] = useState<HrFilters>(EMPTY_HR_FILTERS)
  const [page,    setPage]    = useState(1)
  // Live employee search — client-side filter on current page rows
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [resolving, setResolving] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [forensicsTarget, setForensicsTarget] = useState<{
    employeeId: string; date: string; employeeName?: string
  } | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  // Derive offset from page
  const offset = (page - 1) * PAGE_SIZE

  const { data, isLoading, isError, refetch } = useQuery<AnomalyResponse>({
    queryKey: ['attendance-anomalies', applied, page],
    queryFn:  () => {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(offset),
      })
      if (applied.from)        params.set('from',        applied.from)
      if (applied.to)          params.set('to',          applied.to)
      if (applied.employee_id) params.set('employee_id', applied.employee_id)
      if (applied.type)        params.set('type',        applied.type)
      if (applied.severity)    params.set('severity',    applied.severity)
      if (applied.resolved)    params.set('resolved',    applied.resolved)
      return api.get<AnomalyResponse>(`/attendance/anomalies?${params}`)
    },
    staleTime: 30_000,
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/attendance/anomalies/${id}/resolve`, {}),
    onSuccess: () => {
      setResolving(null)
      qc.invalidateQueries({ queryKey: ['attendance-anomalies'] })
      toast.success('Anomaly resolved')
    },
    onError: (e: Error) => {
      setResolving(null)
      toast.error('Failed to resolve anomaly', { description: e.message })
    },
  })

  const bulkResolveMutation = useMutation({
    mutationFn: () =>
      api.post('/attendance/anomalies/bulk-resolve', { ids: [...selectedIds] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-anomalies'] })
      setSelectedIds(new Set())
      toast.success('Selected anomalies resolved')
    },
    onError: (e: Error) => toast.error('Failed to resolve anomalies', { description: e.message }),
  })

  const allRows = data?.data  ?? []
  const total   = data?.total ?? 0

  // Client-side employee search filter
  const rows = employeeSearch.trim()
    ? allRows.filter(r => {
        const q = employeeSearch.toLowerCase()
        return (
          (r.employee_name ?? '').toLowerCase().includes(q) ||
          (r.employee_code ?? '').toLowerCase().includes(q)
        )
      })
    : allRows

  // Payroll risk: unresolved no_punch rows directly affect payroll (absent → no payable day)
  const payrollRiskCount = rows.filter(r => !r.resolved && (r.type === 'no_punch' || r.type === 'missing_out')).length

  // Derive resolved/unresolved counts from current page rows (best effort without API counts)
  const resolvedCount   = rows.filter(r => r.resolved).length
  const unresolvedCount = rows.filter(r => !r.resolved).length

  // Severity breakdown — for current page unresolved rows only
  const highCount   = rows.filter(r => !r.resolved && r.severity === 'high').length
  const mediumCount = rows.filter(r => !r.resolved && r.severity === 'medium').length
  const lowCount    = rows.filter(r => !r.resolved && r.severity === 'low').length

  const quickPresets = buildQuickPresets()

  function applyPreset(preset: QuickPreset) {
    const next = { ...EMPTY_HR_FILTERS, ...preset.filters } as HrFilters
    setFilters(next)
    setApplied(next)
    setPage(1)
    setSelectedIds(new Set())
  }

  // Period lock awareness
  const lockMonth = applied.from ? applied.from.slice(0, 7) : new Date().toISOString().slice(0, 7)
  const { state: periodState } = usePeriodLock(lockMonth)

  function applyFilters() {
    setPage(1)
    setApplied({ ...filters })
  }

  function resetFilters() {
    setFilters(EMPTY_HR_FILTERS)
    setApplied(EMPTY_HR_FILTERS)
    setPage(1)
  }

  function handleResolve(id: string) {
    setResolving(id)
    resolveMutation.mutate(id)
  }

  // Build filter chips from applied state
  const filterChips = [
    ...(applied.from     ? [{ key: 'from',     label: `From: ${applied.from}` }]              : []),
    ...(applied.to       ? [{ key: 'to',       label: `To: ${applied.to}` }]                  : []),
    ...(applied.type     ? [{ key: 'type',     label: `Type: ${applied.type}` }]               : []),
    ...(applied.severity ? [{ key: 'severity', label: `Severity: ${applied.severity}` }]       : []),
    ...(applied.resolved !== ''
      ? [{ key: 'resolved', label: applied.resolved === 'true' ? 'Resolved' : 'Unresolved' }]
      : []),
  ]

  function handleRemoveChip(key: string) {
    const next = { ...applied }
    if (key === 'from')     { next.from     = ''; setFilters(f => ({ ...f, from: '' })) }
    if (key === 'to')       { next.to       = ''; setFilters(f => ({ ...f, to: '' })) }
    if (key === 'type')     { next.type     = ''; setFilters(f => ({ ...f, type: '' })) }
    if (key === 'severity') { next.severity = ''; setFilters(f => ({ ...f, severity: '' })) }
    if (key === 'resolved') { next.resolved = ''; setFilters(f => ({ ...f, resolved: '' })) }
    setApplied(next)
    setPage(1)
  }

  function handleClearAllChips() {
    resetFilters()
  }

  // Row selection helpers
  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rows.map(r => r.id)))
    }
  }

  return (
    <SectionCard
      title={`Anomalies${total ? ` (${total})` : ''}`}
      icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      noPadding
    >
      {/* Quick filter presets */}
      <div className="flex items-center gap-1.5 flex-wrap px-4 pt-3 pb-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mr-1">Quick:</span>
        {quickPresets.map(preset => {
          // Determine if this preset is currently active
          const isActive = Object.entries(preset.filters).every(
            ([k, v]) => applied[k as keyof HrFilters] === v
          )
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                'text-[10px] px-2.5 py-1 rounded-full border transition-colors',
                isActive
                  ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      {/* Filter toolbar */}
      <TableToolbar
        left={
          <>
            {/* Live employee search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search employee…"
                value={employeeSearch}
                onChange={e => setEmployeeSearch(e.target.value)}
                className="h-8 text-xs pl-7 w-44"
              />
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">From</label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.from}
                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">To</label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.to}
                min={filters.from}
                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              />
            </div>

            {/* Type */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Type</label>
              <select
                value={filters.type}
                onChange={e => setFilters(f => ({ ...f, type: e.target.value as HrFilters['type'] }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">All Types</option>
                <option value="missing_out">Missing OUT</option>
                <option value="no_punch">No Punch</option>
                <option value="late">Late Arrival</option>
                <option value="excessive_hours">Excessive Hours</option>
              </select>
            </div>

            {/* Severity */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Severity</label>
              <select
                value={filters.severity}
                onChange={e => setFilters(f => ({ ...f, severity: e.target.value as HrFilters['severity'] }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">All Severities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Status</label>
              <select
                value={filters.resolved}
                onChange={e => setFilters(f => ({ ...f, resolved: e.target.value as HrFilters['resolved'] }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">All</option>
                <option value="false">Unresolved</option>
                <option value="true">Resolved</option>
              </select>
            </div>

            {/* Apply / Clear */}
            <div className="flex items-end gap-2 pt-5">
              <Button className="h-8 text-xs" onClick={applyFilters}>Apply</Button>
              <Button variant="ghost" className="h-8 text-xs" onClick={resetFilters}>Clear</Button>
            </div>
          </>
        }
        right={
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()}>
            Refresh
          </Button>
        }
        filterChips={filterChips}
        onRemoveChip={handleRemoveChip}
        onClearAllChips={filterChips.length > 0 ? handleClearAllChips : undefined}
      />

      {/* Period lock banner */}
      {periodState !== 'OPEN' && (
        <PeriodLockBanner state={periodState} month={lockMonth} className="mx-4 mt-3" />
      )}

      {/* Payroll risk signal */}
      {payrollRiskCount > 0 && applied.resolved !== 'true' && (
        <div className="mx-4 mt-1 flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-md px-3 py-2">
          <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>{payrollRiskCount}</strong> unresolved no-punch / missing-OUT anomal{payrollRiskCount !== 1 ? 'ies' : 'y'} — these directly affect payroll payable days.
          </span>
        </div>
      )}

      {/* Status strip */}
      <StatusStrip items={[
        { label: 'Total',      value: total,          variant: 'default'  },
        { label: 'Unresolved', value: unresolvedCount, variant: 'warning', hideWhenZero: false },
        { label: 'High',       value: highCount,      variant: 'destructive', hideWhenZero: true },
        { label: 'Medium',     value: mediumCount,    variant: 'warning',     hideWhenZero: true },
        { label: 'Low',        value: lowCount,       variant: 'default',     hideWhenZero: true },
        { label: 'Resolved',   value: resolvedCount,  variant: 'success',     hideWhenZero: true },
      ]} />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          actions={[{
            id:      'resolve',
            label:   'Resolve Selected',
            icon:    CheckCircle2,
            onClick: () => bulkResolveMutation.mutate(),
            loading: bulkResolveMutation.isPending,
          }]}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      {/* Content */}
      <div className="px-4 pb-4">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading anomalies…</span>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm text-destructive">Failed to load anomalies</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <EmptyTableState
            preset={filterChips.length > 0 ? 'no-results' : 'no-anomalies'}
          />
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div className="overflow-x-auto -mx-1 mt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {/* Select all checkbox */}
                  <th className="py-2 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      onChange={toggleAll}
                      className="rounded border-border"
                    />
                  </th>
                  {['Date', 'Employee', 'Type', 'Severity', 'Message', 'Detected', 'Age', 'Status', 'Policy', ''].map(h => (
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
                  <>
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-border/50 hover:bg-muted/20 transition-colors',
                      row.resolved && 'opacity-60',
                      selectedIds.has(row.id) && 'bg-primary/5',
                    )}
                  >
                    {/* Row checkbox */}
                    <td className="py-2.5 px-3 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="rounded border-border"
                      />
                    </td>

                    {/* Date */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-foreground text-xs tabular-nums">
                      {fmtDate(row.date)}
                    </td>

                    {/* Employee */}
                    <td className="py-2.5 px-3">
                      <p className="font-medium text-foreground text-xs leading-tight">
                        {row.employee_name ?? '—'}
                      </p>
                      {row.employee_code && (
                        <p className="text-[10px] text-muted-foreground font-mono">{row.employee_code}</p>
                      )}
                    </td>

                    {/* Type */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge variant={TYPE_VARIANT[row.type]} className="rounded-full text-[10px] px-2">
                        {TYPE_LABEL[row.type]}
                      </Badge>
                    </td>

                    {/* Severity */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge variant={SEVERITY_VARIANT[row.severity]} className="rounded-full text-[10px] px-2 capitalize">
                        {row.severity}
                      </Badge>
                    </td>

                    {/* Message */}
                    <td className="py-2.5 px-3 max-w-xs">
                      <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
                        {row.message}
                      </p>
                    </td>

                    {/* Detected at */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtDatetime(row.created_at)}
                    </td>

                    {/* Age — only shown for unresolved rows */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {!row.resolved ? (
                        <Badge
                          variant={ageBadgeVariant(ageDays(row.created_at))}
                          className="rounded-full text-[10px] px-1.5"
                        >
                          {ageLabel(ageDays(row.created_at))}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {row.resolved ? (
                        <div>
                          <Badge variant="success" className="rounded-full text-[10px] px-2">Resolved</Badge>
                          {row.resolved_at && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {fmtDatetime(row.resolved_at)}
                            </p>
                          )}
                          {row.resolved_by_name && (
                            <p className="text-[10px] text-muted-foreground">by {row.resolved_by_name}</p>
                          )}
                        </div>
                      ) : (
                        <Badge variant="warning" className="rounded-full text-[10px] px-2">Open</Badge>
                      )}
                    </td>

                    {/* Policy context column */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn(
                          'h-7 text-xs transition-colors',
                          expandedRowId === row.id
                            ? 'text-primary bg-primary/10 hover:bg-primary/15'
                            : 'text-muted-foreground hover:text-primary hover:bg-primary/5',
                        )}
                        title="Show policy context for this anomaly"
                        onClick={() => setExpandedRowId(prev => prev === row.id ? null : row.id)}
                      >
                        <ShieldQuestion className="h-3.5 w-3.5" />
                        <span className="ml-1 hidden sm:inline">Why?</span>
                      </Button>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {/* Forensics timeline deep-link */}
                        {row.employee_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-info hover:text-info hover:bg-info/10"
                            title="Open attendance timeline"
                            onClick={() => setForensicsTarget({
                              employeeId:   row.employee_id!,
                              date:         row.date,
                              employeeName: row.employee_name ?? undefined,
                            })}
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                            <span className="ml-1 hidden sm:inline">Timeline</span>
                          </Button>
                        )}

                        {/* Correction workflow link — for missing punch anomalies that require a correction request */}
                        {!row.resolved && (row.type === 'missing_out' || row.type === 'no_punch') && row.employee_id && (
                          <Link
                            to={`/admin/attendance/corrections?employeeId=${row.employee_id}&date=${row.date}`}
                            className="inline-flex items-center gap-1 h-7 px-2 text-xs text-warning hover:text-warning hover:bg-warning/10 rounded-md transition-colors"
                            title="Route to Corrections workflow for this employee"
                          >
                            <ClipboardEdit className="h-3.5 w-3.5" />
                            <span className="ml-0.5 hidden sm:inline">Correct</span>
                          </Link>
                        )}

                        {!row.resolved && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-success hover:text-success hover:bg-success/10"
                            disabled={resolving === row.id || resolveMutation.isPending}
                            onClick={() => handleResolve(row.id)}
                          >
                            {resolving === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1">Resolve</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Policy context expansion row */}
                  {expandedRowId === row.id && (
                    <tr className="bg-muted/10">
                      <td colSpan={11} className="px-6 pb-4 pt-1">
                        <div className="border border-primary/20 rounded-md p-3 bg-card max-w-2xl">
                          <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                            <ShieldQuestion className="h-3.5 w-3.5 text-primary" />
                            Why was this anomaly flagged?
                          </p>
                          <PolicyExplainPanel
                            resolution={buildAnomalyPolicyResolution(row)}
                            compact
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <PaginationBar
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      {/* Forensics drawer — opens when a "Timeline" button is clicked */}
      <ForensicsDrawer
        target={forensicsTarget}
        onClose={() => setForensicsTarget(null)}
      />
    </SectionCard>
  )
}

// ── Page component ─────────────────────────────────────────────────────────────

export function AttendanceAnomalies() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Anomalies"
        subtitle={
          isAdmin
            ? 'System-detected irregularities — policy violations, suspicious patterns, and unresolved punch exceptions'
            : 'System-detected anomalies in your attendance records'
        }
      />

      {/* Employee self-view — always visible */}
      {!isAdmin && <MyAnomaliesView />}

      {/* HR view — full table with filters + resolve */}
      {isAdmin && (
        <>
          <HrAnomaliesView />

          {/* Divider + personal view for admins who also want to see their own */}
          <SectionCard
            title="My Anomalies"
            icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          >
            <p className="text-xs text-muted-foreground mb-3">
              Your personal attendance anomalies — these also appear in the HR table above.
            </p>
            <MyAnomaliesView />
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
