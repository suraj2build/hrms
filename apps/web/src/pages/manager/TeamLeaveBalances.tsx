/**
 * TeamLeaveBalances — Manager Console
 *
 * Read-only view of each direct report's leave balance for the current year.
 * One row per employee; leave types as columns. Helps managers make informed
 * approval decisions without needing to open each employee's profile.
 */

import { useState, useMemo }  from 'react'
import { useQuery }           from '@tanstack/react-query'
import { Search, RefreshCw, Users, CalendarDays } from 'lucide-react'
import { api }                from '@/lib/api/client'
import { PageContainer }      from '@/components/layout/PageContainer'
import { PageHeader }         from '@/components/layout/PageHeader'
import { Input }              from '@/components/ui/input'
import { Button }             from '@/components/ui/button'
import { Badge }              from '@/components/ui/badge'
import { cn }                 from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveTypeBalance {
  leave_type_id:      string
  leave_type_name:    string
  is_paid:            boolean
  balance:            number
  annual_entitlement: number | null
  used:               number
}

interface EmployeeBalance {
  employee_id:   string
  employee_code: string
  name:          string
  department:    string | null
  balances:      LeaveTypeBalance[]
}

interface TeamBalancesResponse {
  data: EmployeeBalance[]
  year: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function BalanceCell({ b }: { b: LeaveTypeBalance }) {
  const pct = b.annual_entitlement ? (b.balance / b.annual_entitlement) * 100 : null
  const low = pct !== null && pct <= 25

  return (
    <div className="text-center">
      <span className={cn(
        'text-sm font-semibold tabular-nums',
        b.balance === 0 ? 'text-destructive' : low ? 'text-warning' : 'text-foreground',
      )}>
        {b.balance}
      </span>
      {b.annual_entitlement !== null && (
        <span className="text-[10px] text-muted-foreground block leading-none mt-0.5">
          / {b.annual_entitlement}
        </span>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TeamLeaveBalances() {
  const [search, setSearch] = useState('')

  const { data, isLoading, isError, refetch, isFetching } = useQuery<TeamBalancesResponse>({
    queryKey:  ['manager-team-leave-balances'],
    queryFn:   () => api.get('/attendance/leave/team-balances'),
    staleTime: 60_000,
  })

  const rows       = data?.data ?? []
  const year       = data?.year ?? new Date().getFullYear()

  // Collect all unique leave types across the team (for column headers)
  const leaveTypes = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; is_paid: boolean }>()
    for (const emp of rows) {
      for (const b of emp.balances) {
        if (!seen.has(b.leave_type_id)) {
          seen.set(b.leave_type_id, {
            id:      b.leave_type_id,
            name:    b.leave_type_name,
            is_paid: b.is_paid,
          })
        }
      }
    }
    // Paid types first, then unpaid
    return [...seen.values()].sort((a, b) => (b.is_paid ? 1 : 0) - (a.is_paid ? 1 : 0))
  }, [rows])

  // Client-side search
  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.employee_code.toLowerCase().includes(q) ||
      (r.department ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader
          title="Leave Balances"
          subtitle={`Team leave balance overview — ${year}`}
          breadcrumb={[{ label: 'Leave Balances' }]}
        />
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading team balances…
        </div>
      </PageContainer>
    )
  }

  if (isError) {
    return (
      <PageContainer>
        <PageHeader
          title="Leave Balances"
          subtitle={`Team leave balance overview — ${year}`}
          breadcrumb={[{ label: 'Leave Balances' }]}
        />
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <p className="text-sm">Failed to load team leave balances.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      </PageContainer>
    )
  }

  // ── Empty ────────────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Leave Balances"
          subtitle={`Team leave balance overview — ${year}`}
          breadcrumb={[{ label: 'Leave Balances' }]}
        />
        <div className="flex flex-col items-center justify-center py-24 gap-2 text-muted-foreground">
          <Users className="h-8 w-8 opacity-40" />
          <p className="text-sm font-medium">No direct reports found</p>
          <p className="text-xs">Leave balances will appear here once team members are assigned to you.</p>
        </div>
      </PageContainer>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Leave Balances"
        subtitle={`Team leave balance overview — ${year}`}
        breadcrumb={[{ label: 'Leave Balances' }]}
      />

      {/* Summary chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{rows.length} team member{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{leaveTypes.length} leave type{leaveTypes.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative w-full sm:w-72">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8 h-8 text-sm"
          placeholder="Search by name, ID, or department…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                Employee
              </th>
              <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                Department
              </th>
              {leaveTypes.map(lt => (
                <th
                  key={lt.id}
                  className="text-center text-xs font-semibold text-muted-foreground px-3 py-2.5 whitespace-nowrap min-w-[90px]"
                >
                  <div>{lt.name}</div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] px-1 py-0 mt-0.5 font-medium',
                      lt.is_paid
                        ? 'border-green-500/30 text-green-600 bg-green-500/5'
                        : 'border-muted-foreground/30 text-muted-foreground',
                    )}
                  >
                    {lt.is_paid ? 'Paid' : 'Unpaid'}
                  </Badge>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={2 + leaveTypes.length} className="text-center text-xs text-muted-foreground py-10">
                  No employees match your search.
                </td>
              </tr>
            ) : (
              filtered.map(emp => {
                const balanceById = Object.fromEntries(
                  emp.balances.map(b => [b.leave_type_id, b])
                )
                return (
                  <tr key={emp.employee_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-sm font-medium text-foreground">{emp.name}</p>
                      <p className="text-[11px] text-muted-foreground">{emp.employee_code}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {emp.department ?? '—'}
                    </td>
                    {leaveTypes.map(lt => {
                      const b = balanceById[lt.id]
                      return (
                        <td key={lt.id} className="px-3 py-3">
                          {b ? (
                            <BalanceCell b={b} />
                          ) : (
                            <span className="block text-center text-xs text-muted-foreground/40">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>

          {/* Totals footer — sum of remaining balances per leave type */}
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground" colSpan={2}>
                  Team Total
                </td>
                {leaveTypes.map(lt => {
                  const total = filtered.reduce((sum, emp) => {
                    const b = emp.balances.find(b => b.leave_type_id === lt.id)
                    return sum + (b?.balance ?? 0)
                  }, 0)
                  return (
                    <td key={lt.id} className="px-3 py-2.5 text-center">
                      <span className="text-xs font-semibold tabular-nums">{total}</span>
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Balance = remaining days · / N = annual entitlement · Red = 0 days · Amber = ≤ 25% remaining
      </p>
    </PageContainer>
  )
}
