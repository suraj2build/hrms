/**
 * CollisionLog — /admin/leave/collision-log
 *
 * HR admin view of all leave collision resolutions.
 * A collision occurs when a leave application overlaps with a holiday,
 * another leave, or a restricted period; the collision engine resolves it
 * automatically per the configured policy and logs the outcome here.
 *
 * Access: hr_admin / super_admin only.
 * Design: design-system tokens only.
 */

import { useState }           from 'react'
import { useQuery, keepPreviousData }           from '@tanstack/react-query'
import {
  GitMerge, ShieldAlert, Search, ChevronLeft, ChevronRight,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge, type BadgeProps }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { DateInput }      from '@/components/ui/date-input'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CollisionRow {
  id:               string
  collision_date:   string
  collision_type:   string
  resolution:       string
  original_status:  string | null
  resolved_status:  string | null
  created_at:       string
  employee_name:    string | null
  employee_code:    string | null
}

interface CollisionResponse {
  data:   CollisionRow[]
  total:  number
  limit:  number
  offset: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const COLLISION_TYPE_LABEL: Record<string, string> = {
  leave_on_holiday:          'Leave on Holiday',
  leave_overlap:             'Overlapping Leave',
  leave_on_restricted:       'Restricted Period',
  sandwich_auto_applied:     'Sandwich Auto-Applied',
  optional_holiday_conflict: 'Optional Holiday Conflict',
}

const RESOLUTION_LABEL: Record<string, string> = {
  auto_approved:     'Auto-Approved',
  auto_rejected:     'Auto-Rejected',
  converted_to_pl:   'Converted to PL',
  split:             'Split',
  manual_override:   'Manual Override',
  status_changed:    'Status Changed',
}

function collisionTypeBadge(type: string) {
  const label = COLLISION_TYPE_LABEL[type] ?? type
  const variant: BadgeProps['variant'] =
    type === 'leave_on_restricted'      ? 'destructive' :
    type === 'sandwich_auto_applied'    ? 'warning' :
    type === 'leave_on_holiday'         ? 'secondary' :
                                          'outline'
  return <Badge variant={variant} className="rounded-full text-[10px] whitespace-nowrap">{label}</Badge>
}

function resolutionBadge(resolution: string) {
  const label = RESOLUTION_LABEL[resolution] ?? resolution
  const variant: BadgeProps['variant'] =
    resolution === 'auto_approved'  ? 'success' :
    resolution === 'auto_rejected'  ? 'destructive' :
    resolution === 'manual_override'? 'warning' :
                                      'secondary'
  return <Badge variant={variant} className="rounded-full text-[10px] whitespace-nowrap">{label}</Badge>
}

function fmtDate(iso: string) {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtDatetime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

// ── Main page ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export function CollisionLog() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [filters, setFilters]   = useState({ from: '', to: '', employee_id: '' })
  const [applied, setApplied]   = useState({ from: '', to: '', employee_id: '' })
  const [search,  setSearch]    = useState('')
  const [page,    setPage]      = useState(0)

  const offset = page * PAGE_SIZE

  const { data, isLoading } = useQuery<CollisionResponse>({
    queryKey: ['collision-log', applied, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (applied.from)        params.set('from', applied.from)
      if (applied.to)          params.set('to', applied.to)
      if (applied.employee_id) params.set('employee_id', applied.employee_id)
      params.set('limit',  String(PAGE_SIZE))
      params.set('offset', String(offset))
      return api.get(`/leave/collision/log?${params}`)
    },
    enabled: isAdmin,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  function applyFilters() {
    setPage(0)
    setApplied({ ...filters })
  }

  function clearFilters() {
    const empty = { from: '', to: '', employee_id: '' }
    setFilters(empty)
    setApplied(empty)
    setSearch('')
    setPage(0)
  }

  const rows = (data?.data ?? []).filter(r =>
    !search ||
    r.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
    COLLISION_TYPE_LABEL[r.collision_type]?.toLowerCase().includes(search.toLowerCase()) ||
    RESOLUTION_LABEL[r.resolution]?.toLowerCase().includes(search.toLowerCase())
  )

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE)

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Collision Log" subtitle="Leave collision resolution history" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">Access restricted to HR admins</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leave Collision Log"
        subtitle="Audit trail of all collision resolutions applied by the leave engine"
      />

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <DateInput
              value={filters.from}
              onChange={v => setFilters(p => ({ ...p, from: v }))}
              className="h-8 text-xs w-36"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <DateInput
              value={filters.to}
              min={filters.from}
              onChange={v => setFilters(p => ({ ...p, to: v }))}
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
          <Button size="sm" className="h-8 text-xs" onClick={applyFilters}>
            <Search className="h-3.5 w-3.5 mr-1" />
            Filter
          </Button>
          {(applied.from || applied.to || applied.employee_id) && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFilters}>
              Clear
            </Button>
          )}

          {/* Client-side search */}
          <div className="ml-auto">
            <Input
              placeholder="Search name, type, resolution…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs w-56"
            />
          </div>
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard
        title={`Collision Records${data?.total ? ` (${data.total})` : ''}`}
        icon={<GitMerge className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
            <GitMerge className="h-8 w-8 opacity-30" />
            <p className="text-sm">No collision records found{(applied.from || applied.to) ? ' in this range' : ''}.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      'Date', 'Employee', 'Collision Type', 'Resolution',
                      'Before → After', 'Logged At',
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
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                        {fmtDate(row.collision_date)}
                      </td>
                      <td className="px-3 py-2">
                        {row.employee_name ? (
                          <>
                            <span className="font-medium text-foreground">{row.employee_name}</span>
                            {row.employee_code && (
                              <span className="text-muted-foreground ml-1">#{row.employee_code}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {collisionTypeBadge(row.collision_type)}
                      </td>
                      <td className="px-3 py-2">
                        {resolutionBadge(row.resolution)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.original_status || row.resolved_status ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <span className="capitalize">{row.original_status ?? '—'}</span>
                            <span className="text-muted-foreground/50">→</span>
                            <span className="capitalize font-medium text-foreground">
                              {row.resolved_status ?? '—'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                        {fmtDatetime(row.created_at)}
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
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
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
                  <span className="text-xs text-muted-foreground px-2">
                    {page + 1} / {totalPages}
                  </span>
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
