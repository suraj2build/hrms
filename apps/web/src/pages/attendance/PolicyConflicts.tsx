/**
 * PolicyConflicts — /attendance/policy-conflicts
 *
 * HR admin view of all attendance policy collision detections and
 * resolution traces. Shows conflict type, which policies collided,
 * how they were resolved, and whether payroll was impacted.
 *
 * Access: hr_admin / super_admin only.
 */

import { useState }      from 'react'
import { useQuery }      from '@tanstack/react-query'
import { EmployeeLabel } from '@/components/employee/EmployeeLabel'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import {
  ShieldAlert, GitMerge, Search,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { DateInput }      from '@/components/ui/date-input'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { MetricCard }     from '@/components/dashboard/MetricCard'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PolicyConflict {
  id: string
  employee_id: string
  date: string
  conflict_type: string
  policy_a: string
  policy_b: string
  resolution: string
  resolution_detail: string | null
  confidence_impact: number
  payroll_impacting: boolean
  created_at: string
  employees?: {
    first_name: string
    last_name: string
    employee_code: string
  }
}

// Matches GET /attendance/policy-conflicts/summary
interface ConflictSummary {
  total: number
  by_type:           Record<string, number>
  by_severity:       Record<string, number>
  payroll_impacting: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function fmtDate(iso: string): string {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtDatetime(iso: string): string {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10)
}

function conflictTypeBadge(type: string) {
  const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return (
    <Badge variant="outline" className="rounded-full text-[10px] whitespace-nowrap">
      {label}
    </Badge>
  )
}

function resolutionBadge(resolution: string) {
  const label = resolution.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const variant: 'success' | 'warning' | 'destructive' | 'secondary' =
    resolution === 'resolved'       ? 'success'
    : resolution === 'overridden'   ? 'warning'
    : resolution === 'unresolved'   ? 'destructive'
    : 'secondary'
  return (
    <Badge variant={variant} className="rounded-full text-[10px] whitespace-nowrap">
      {label}
    </Badge>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function PolicyConflicts() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [filters, setFilters] = useState({
    date_from:   defaultDateFrom(),
    date_to:     defaultDateTo(),
    employee_id: '',
    resolution:  '',
  })
  const [applied, setApplied] = useState({ ...filters })
  const [search,  setSearch]  = useState('')
  const [page,    setPage]    = useState(0)

  const offset = page * PAGE_SIZE

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: listData, isLoading } = useQuery<{ data: PolicyConflict[]; total: number }>({
    queryKey: ['policy-conflicts-list', applied, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (applied.date_from)   params.set('from', applied.date_from)
      if (applied.date_to)     params.set('to',   applied.date_to)
      if (applied.employee_id) params.set('employee_id', applied.employee_id)
      return api.get(`/attendance/policy-conflicts?${params}`)
    },
    enabled:   isAdmin,
    staleTime: 60_000,
  })

  // The summary API is month-scoped — derive the month from the range end.
  const summaryMonth = (applied.date_to || applied.date_from || '').slice(0, 7)
  const { data: summaryData } = useQuery<ConflictSummary>({
    queryKey: ['policy-conflicts-summary', summaryMonth],
    queryFn: () => {
      const params = new URLSearchParams()
      if (summaryMonth) params.set('month', summaryMonth)
      return api.get(`/attendance/policy-conflicts/summary?${params}`)
    },
    enabled:   isAdmin,
    staleTime: 60_000,
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  function applyFilters() {
    setPage(0)
    setApplied({ ...filters })
  }

  function clearFilters() {
    const reset = { date_from: defaultDateFrom(), date_to: defaultDateTo(), employee_id: '', resolution: '' }
    setFilters(reset)
    setApplied(reset)
    setSearch('')
    setPage(0)
  }

  // ── Access guard ───────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Policy Conflicts"
          subtitle="Attendance policy collision detection and resolution trace"
        />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const conflicts = (listData?.data ?? []).filter(c =>
    !search ||
    `${c.employees?.first_name ?? ''} ${c.employees?.last_name ?? ''}`.toLowerCase().includes(search.toLowerCase()) ||
    c.employees?.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
    c.conflict_type.toLowerCase().includes(search.toLowerCase()) ||
    c.resolution.toLowerCase().includes(search.toLowerCase())
  )

  const summary  = summaryData
  const top3Types = Object.entries(summary?.by_type ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([conflict_type, count]) => ({ conflict_type, count }))

  const totalPages = Math.ceil((listData?.total ?? listData?.data?.length ?? 0) / PAGE_SIZE)

  return (
    <PageContainer>
      <PageHeader
        title="Policy Conflicts"
        subtitle="Attendance policy collision detection and resolution trace"
      />

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total */}
          <MetricCard
            label="Total Conflicts"
            value={summary.total}
            subtitle="in selected date range"
          />

          {/* Payroll impacting */}
          <MetricCard
            label="Payroll Impacting"
            value={summary.payroll_impacting}
            icon={summary.payroll_impacting > 0 ? AlertTriangle : undefined}
            variant={summary.payroll_impacting > 0 ? 'destructive' : 'success'}
            subtitle={summary.payroll_impacting > 0 ? 'Affect payroll' : 'None affect payroll'}
          />

          {/* Top types */}
          <SectionCard>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Top Conflict Types</p>
            <div className="space-y-1.5">
              {top3Types.length === 0 && (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
              {top3Types.map(t => (
                <div key={t.conflict_type} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground truncate">
                    {t.conflict_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  <Badge variant="secondary" className="rounded-full text-[10px] tabular-nums">{t.count}</Badge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Filters */}
      <SectionCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date From</label>
            <DateInput
              value={filters.date_from}
              onChange={v => setFilters(p => ({ ...p, date_from: v }))}
              className="h-8 text-xs w-36"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date To</label>
            <DateInput
              value={filters.date_to}
              min={filters.date_from}
              onChange={v => setFilters(p => ({ ...p, date_to: v }))}
              className="h-8 text-xs w-36"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Employee</label>
            <EmployeeSelector
              placeholder="All employees"
              value={filters.employee_id}
              onChange={v => setFilters(p => ({ ...p, employee_id: typeof v === 'string' ? v : (v[0] ?? '') }))}
              className="w-56"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Resolution</label>
            <Input
              placeholder="e.g. resolved"
              value={filters.resolution}
              onChange={e => setFilters(p => ({ ...p, resolution: e.target.value }))}
              className="h-8 text-xs w-36"
            />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={applyFilters}>
            <Search className="h-3.5 w-3.5 mr-1" />
            Filter
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFilters}>
            Clear
          </Button>
          <div className="ml-auto">
            <Input
              placeholder="Search employee, type…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs w-52"
            />
          </div>
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard
        title={`Policy Conflict Records${listData?.data?.length ? ` (${listData.data.length})` : ''}`}
        icon={<GitMerge className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground text-sm">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading…
          </div>
        ) : conflicts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
            <GitMerge className="h-8 w-8 opacity-30" />
            <p className="text-sm">No policy conflicts found in this range.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      'Employee', 'Date', 'Conflict Type',
                      'Policy A', 'Policy B', 'Resolution',
                      'Payroll Impact', 'Logged At',
                    ].map(h => (
                      <th
                        key={h}
                        className="text-left text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map(c => (
                    <tr key={c.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                      {/* Employee */}
                      <td className="px-3 py-2.5">
                        {c.employees ? (
                          <>
                            <p className="font-medium text-foreground">
                              {c.employees.first_name} {c.employees.last_name}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              #{c.employees.employee_code}
                            </p>
                          </>
                        ) : (
                          <EmployeeLabel id={c.employee_id} className="text-[10px] text-muted-foreground" />
                        )}
                      </td>
                      {/* Date */}
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {fmtDate(c.date)}
                      </td>
                      {/* Conflict type */}
                      <td className="px-3 py-2.5">
                        {conflictTypeBadge(c.conflict_type)}
                      </td>
                      {/* Policy A */}
                      <td className="px-3 py-2.5 max-w-[140px]">
                        <p className="text-foreground truncate" title={c.policy_a}>{c.policy_a}</p>
                      </td>
                      {/* Policy B */}
                      <td className="px-3 py-2.5 max-w-[140px]">
                        <p className="text-foreground truncate" title={c.policy_b}>{c.policy_b}</p>
                      </td>
                      {/* Resolution */}
                      <td className="px-3 py-2.5">
                        <div className="space-y-0.5">
                          {resolutionBadge(c.resolution)}
                          {c.resolution_detail && (
                            <p className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={c.resolution_detail}>
                              {c.resolution_detail}
                            </p>
                          )}
                        </div>
                      </td>
                      {/* Payroll impact */}
                      <td className="px-3 py-2.5 text-center">
                        {c.payroll_impacting ? (
                          <Badge variant="destructive" className="rounded-full text-[10px]">Yes</Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-full text-[10px]">No</Badge>
                        )}
                      </td>
                      {/* Logged At */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {fmtDatetime(c.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={page === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => p + 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </PageContainer>
  )
}
