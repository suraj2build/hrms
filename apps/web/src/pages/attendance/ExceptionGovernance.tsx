/**
 * ExceptionGovernance — /attendance/exceptions
 *
 * Admin-only workspace for structured attendance exception management.
 * Supports reviewing, acknowledging, escalating, resolving, and dismissing
 * attendance exceptions across the tenant.
 *
 * Access: hr_admin, super_admin only.
 */

import { useState }                          from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ShieldAlert, AlertTriangle, CheckCircle2, Clock,
  Loader2, ChevronDown,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type ExceptionSeverity = 'low' | 'medium' | 'high' | 'critical'
type ExceptionStatus   = 'open' | 'acknowledged' | 'resolved' | 'escalated' | 'dismissed'

interface AttendanceException {
  id:                   string
  employee_id:          string
  date:                 string
  exception_type:       string
  category:             string
  severity:             ExceptionSeverity
  status:               ExceptionStatus
  payroll_impacting:    boolean
  requires_investigation: boolean
  sla_due_at:           string | null
  sla_breached:         boolean
  note:                 string | null
  resolution_note:      string | null
  created_at:           string
  employees?: {
    first_name:    string
    last_name:     string
    employee_code: string
  }
}

interface ExceptionSummary {
  total_open:        number
  total_sla_breached: number
  by_category: Array<{ category: string; count: number; open_count: number }>
  by_severity: Array<{ severity: string; count: number }>
}

interface ExceptionListResponse {
  data:  AttendanceException[]
  total: number
}

interface UpdateExceptionBody {
  status:           ExceptionStatus
  resolution_note?: string
}

// ── Filters ────────────────────────────────────────────────────────────────────

interface Filters {
  category:    string
  severity:    string
  status:      string
  sla_breached: boolean
}

const INITIAL_FILTERS: Filters = {
  category:    '',
  severity:    '',
  status:      '',
  sla_breached: false,
}

const CATEGORIES = ['punch', 'shift', 'roster', 'policy', 'device', 'geo', 'integrity', 'payroll']
const SEVERITIES: ExceptionSeverity[] = ['low', 'medium', 'high', 'critical']
const STATUSES:   ExceptionStatus[]   = ['open', 'acknowledged', 'resolved', 'escalated', 'dismissed']

// ── Badge helpers ──────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const SEVERITY_VARIANT: Record<ExceptionSeverity, BadgeVariant> = {
  low:      'secondary',
  medium:   'warning',
  high:     'destructive',
  critical: 'destructive',
}

const STATUS_VARIANT: Record<ExceptionStatus, BadgeVariant> = {
  open:         'warning',
  acknowledged: 'outline',
  resolved:     'success',
  escalated:    'destructive',
  dismissed:    'secondary',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function slaLabel(sla_due_at: string | null, sla_breached: boolean): string {
  if (!sla_due_at) return '—'
  if (sla_breached) return 'Breached'
  const diff = new Date(sla_due_at).getTime() - Date.now()
  if (diff <= 0) return 'Overdue'
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs < 1) return `< 1h`
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

// ── Action dropdown ────────────────────────────────────────────────────────────

interface ActionDropdownProps {
  exception:    AttendanceException
  onAction:     (id: string, status: ExceptionStatus) => void
  isPending:    boolean
}

function ActionDropdown({ exception, onAction, isPending }: ActionDropdownProps) {
  const [open, setOpen] = useState(false)

  const actions: Array<{ label: string; status: ExceptionStatus; disabled?: boolean }> = [
    { label: 'Acknowledge', status: 'acknowledged', disabled: exception.status === 'acknowledged' },
    { label: 'Escalate',    status: 'escalated',    disabled: exception.status === 'escalated' },
    { label: 'Resolve',     status: 'resolved',     disabled: exception.status === 'resolved' },
    { label: 'Dismiss',     status: 'dismissed',    disabled: exception.status === 'dismissed' },
  ]

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1"
        disabled={isPending}
        onClick={() => setOpen(o => !o)}
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Actions'}
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <>
          {/* Click-away overlay */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 min-w-[140px] rounded-md border border-border bg-card shadow-md py-1">
            {actions.map(action => (
              <button
                key={action.status}
                type="button"
                disabled={action.disabled}
                className={cn(
                  'w-full text-left text-xs px-3 py-1.5 transition-colors',
                  action.disabled
                    ? 'text-muted-foreground/40 cursor-not-allowed'
                    : 'text-foreground hover:bg-muted',
                )}
                onClick={() => {
                  if (!action.disabled) {
                    onAction(exception.id, action.status)
                    setOpen(false)
                  }
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function ExceptionGovernance() {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [filters,  setFilters]  = useState<Filters>(INITIAL_FILTERS)
  const [applied,  setApplied]  = useState<Filters>(INITIAL_FILTERS)
  const [page,     setPage]     = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const PAGE_SIZE = 50

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: summaryData, isLoading: summaryLoading } = useQuery<{ data: ExceptionSummary }>({
    queryKey: ['exception-summary'],
    queryFn:  () => api.get('/attendance/exceptions/summary'),
    staleTime: 60_000,
    enabled: isAdmin,
  })

  const { data: listData, isLoading: listLoading, isError, refetch } =
    useQuery<ExceptionListResponse>({
      queryKey: ['exception-list', applied, page],
      queryFn:  () => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
        if (applied.category)    params.set('category',    applied.category)
        if (applied.severity)    params.set('severity',    applied.severity)
        if (applied.status)      params.set('status',      applied.status)
        if (applied.sla_breached) params.set('sla_breached', 'true')
        return api.get<ExceptionListResponse>(`/attendance/exceptions?${params}`)
      },
      staleTime: 30_000,
      enabled: isAdmin,
    })

  // ── Mutation ─────────────────────────────────────────────────────────────────

  const updateMutation = useMutation<
    AttendanceException,
    Error,
    { id: string; body: UpdateExceptionBody }
  >({
    mutationFn: ({ id, body }) =>
      api.put<AttendanceException>(`/attendance/exceptions/${id}`, body),
    onSuccess: () => {
      setPendingId(null)
      qc.invalidateQueries({ queryKey: ['exception-list'] })
      qc.invalidateQueries({ queryKey: ['exception-summary'] })
      toast.success('Exception status updated')
    },
    onError: (e: Error) => {
      setPendingId(null)
      toast.error('Failed to update exception', { description: e.message })
    },
  })

  function handleAction(id: string, status: ExceptionStatus) {
    setPendingId(id)
    updateMutation.mutate({ id, body: { status } })
  }

  // ── Derived summary values ────────────────────────────────────────────────────

  const summary = summaryData?.data
  const rows    = listData?.data  ?? []
  const total   = listData?.total ?? 0

  const highCriticalCount = summary
    ? (summary.by_severity.find(s => s.severity === 'high')?.count ?? 0) +
      (summary.by_severity.find(s => s.severity === 'critical')?.count ?? 0)
    : 0

  // requires_investigation is not in summary; derive from current page rows
  const requiresInvestigationCount = rows.filter(r => r.requires_investigation).length

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Exception Governance"
          subtitle="Acknowledge, escalate, and resolve system-flagged attendance exceptions"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-16 gap-2 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Access restricted</p>
            <p className="text-xs text-muted-foreground/60">
              This workspace is available to HR administrators only.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Exception Governance"
        subtitle="Structured attendance exception management"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => refetch()}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* ── Summary cards ── */}
      {summaryLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading summary…
        </div>
      ) : (
        <MetricRow cols={4}>
          <MetricCard
            label="Total Open"
            value={summary?.total_open ?? 0}
            icon={ShieldAlert}
            variant={(summary?.total_open ?? 0) > 0 ? 'warning' : 'success'}
          />
          <MetricCard
            label="SLA Breached"
            value={summary?.total_sla_breached ?? 0}
            icon={Clock}
            variant={(summary?.total_sla_breached ?? 0) > 0 ? 'destructive' : 'neutral'}
          />
          <MetricCard
            label="High / Critical"
            value={highCriticalCount}
            icon={AlertTriangle}
            variant={highCriticalCount > 0 ? 'destructive' : 'neutral'}
          />
          <MetricCard
            label="Requires Investigation"
            value={requiresInvestigationCount}
            icon={ShieldAlert}
            variant={requiresInvestigationCount > 0 ? 'warning' : 'neutral'}
          />
        </MetricRow>
      )}

      {/* ── Exceptions table ── */}
      <SectionCard
        title={`Exceptions${total ? ` (${total})` : ''}`}
        icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
        noPadding
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border">
          {/* Category */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Category</label>
            <select
              value={filters.category}
              onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
              className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Severity</label>
            <select
              value={filters.severity}
              onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}
              className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">All Severities</option>
              {SEVERITIES.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Status</label>
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* SLA Breached */}
          <div className="flex items-center gap-2 pb-0.5">
            <input
              id="sla-breached"
              type="checkbox"
              checked={filters.sla_breached}
              onChange={e => setFilters(f => ({ ...f, sla_breached: e.target.checked }))}
              className="rounded border-border"
            />
            <label htmlFor="sla-breached" className="text-xs text-foreground cursor-pointer select-none">
              SLA Breached
            </label>
          </div>

          {/* Apply / Clear */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => { setApplied({ ...filters }); setPage(0) }}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setFilters(INITIAL_FILTERS); setApplied(INITIAL_FILTERS); setPage(0) }}
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Table content */}
        <div className="px-4 pb-4">
          {listLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading exceptions…</span>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-2 py-12">
              <p className="text-sm text-destructive">Failed to load exceptions.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          )}

          {!listLoading && !isError && rows.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2 text-center">
              <CheckCircle2 className="h-8 w-8 text-success opacity-60" />
              <p className="text-sm font-medium text-foreground">No exceptions found</p>
              <p className="text-xs text-muted-foreground">
                Adjust your filters or check back later.
              </p>
            </div>
          )}

          {!listLoading && !isError && rows.length > 0 && (
            <div className="overflow-x-auto -mx-1 mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      'Employee', 'Date', 'Type', 'Category',
                      'Severity', 'Status', 'SLA', 'Payroll Impact', '',
                    ].map(h => (
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
                      {/* Employee */}
                      <td className="py-2.5 px-3">
                        {row.employees ? (
                          <div>
                            <p className="text-xs font-medium text-foreground leading-tight">
                              {row.employees.first_name} {row.employees.last_name}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                              {row.employees.employee_code}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-xs text-foreground tabular-nums">
                        {fmtDate(row.date)}
                      </td>

                      {/* Type */}
                      <td className="py-2.5 px-3 max-w-[160px]">
                        <p className="text-xs text-foreground truncate">{row.exception_type}</p>
                        {row.requires_investigation && (
                          <p className="text-[10px] text-warning mt-0.5">Investigation required</p>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="text-xs text-muted-foreground capitalize">{row.category}</span>
                      </td>

                      {/* Severity badge */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <Badge
                          variant={SEVERITY_VARIANT[row.severity]}
                          className="rounded-full text-[10px] px-2 capitalize"
                        >
                          {row.severity}
                        </Badge>
                      </td>

                      {/* Status badge */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <Badge
                          variant={STATUS_VARIANT[row.status]}
                          className="rounded-full text-[10px] px-2 capitalize"
                        >
                          {row.status}
                        </Badge>
                      </td>

                      {/* SLA */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.sla_due_at ? (
                          <div>
                            <span
                              className={cn(
                                'text-xs font-medium',
                                row.sla_breached ? 'text-destructive' : 'text-foreground',
                              )}
                            >
                              {slaLabel(row.sla_due_at, row.sla_breached)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">
                              {fmtDateTime(row.sla_due_at)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Payroll Impact */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.payroll_impacting ? (
                          <Badge variant="destructive" className="rounded-full text-[10px] px-2">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">No</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <ActionDropdown
                          exception={row}
                          onAction={handleAction}
                          isPending={pendingId === row.id && updateMutation.isPending}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={page === 0 || listLoading}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={(page + 1) * PAGE_SIZE >= total || listLoading}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Category breakdown */}
      {summary && summary.by_category.length > 0 && (
        <SectionCard
          title="By Category"
          icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {summary.by_category.map(cat => (
              <div
                key={cat.category}
                className="rounded-md border border-border bg-muted/20 px-3 py-2.5"
              >
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1 capitalize">
                  {cat.category}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-lg font-bold text-foreground">{cat.open_count}</span>
                  <span className="text-xs text-muted-foreground">/ {cat.count} total</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </PageContainer>
  )
}
