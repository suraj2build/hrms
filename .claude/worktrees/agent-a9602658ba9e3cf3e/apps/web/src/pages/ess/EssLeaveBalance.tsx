/**
 * EssLeaveBalance — /ess/leave/balance
 *
 * Shows the employee's leave balance per type for the current year,
 * plus a recent leave history table and a quick-apply CTA.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useMemo }  from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link }     from 'react-router-dom'
import {
  CalendarDays, ArrowRight, AlertTriangle, Loader2,
  CheckCircle2, XCircle, Clock3, Info, Plus,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BalanceRow {
  id:           string
  leave_type_id: string
  balance:      number
  year:         number
  leave_types:  { id: string; name: string; is_paid: boolean }
}

interface LeaveApp {
  id:          string
  from_date:   string
  to_date:     string
  status:      string
  reason?:     string
  leave_types?: { name: string }
  created_at:  string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString([], {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T12:00:00Z`)
  const b = new Date(`${to}T12:00:00Z`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'destructive' | 'secondary' | 'outline'> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
}

// ── Balance card ──────────────────────────────────────────────────────────────

function BalanceCard({ row }: { row: BalanceRow }) {
  const pct    = Math.min(100, (row.balance / 30) * 100)
  const low    = row.balance <= 3 && row.balance > 0
  const empty  = row.balance === 0
  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-2 transition-colors',
      empty ? 'border-destructive/20 bg-destructive/5'
      : low  ? 'border-warning/25 bg-warning/5'
      :        'border-border bg-card',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{row.leave_types.name}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            FY {row.year} · {row.leave_types.is_paid ? 'Paid' : 'Unpaid'}
          </p>
        </div>
        <div className="text-right">
          <p className={cn(
            'text-2xl font-bold tabular-nums',
            empty ? 'text-destructive' : low ? 'text-warning' : 'text-foreground',
          )}>
            {row.balance}
          </p>
          <p className="text-[10px] text-muted-foreground">days left</p>
        </div>
      </div>

      {/* Simple progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            empty ? 'bg-destructive/60' : low ? 'bg-warning' : 'bg-success',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {empty && (
        <p className="text-[10px] text-destructive flex items-center gap-1">
          <XCircle className="h-3 w-3" /> Balance exhausted
        </p>
      )}
      {low && !empty && (
        <p className="text-[10px] text-warning flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Low balance — {row.balance} day{row.balance !== 1 ? 's' : ''} remaining
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssLeaveBalance() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null

  const { data: balData, isLoading: balLoading } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['ess-leave-balance', employeeId],
    queryFn:  () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  const { data: leaveData, isLoading: leaveLoading } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['ess-leave-history', employeeId],
    queryFn:  () => api.get('/attendance/leave/my'),
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  const balances   = balData?.data   ?? []
  const allLeaves  = leaveData?.data ?? []

  // Show last 8 leave applications
  const recentLeaves = useMemo(
    () => [...allLeaves].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8),
    [allLeaves],
  )

  const totalBalance = useMemo(
    () => balances.filter(b => b.leave_types.is_paid).reduce((s, b) => s + b.balance, 0),
    [balances],
  )

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="Leave Balance" subtitle="Your leave entitlements and history" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leave Balance"
        subtitle="Your leave entitlements, balances, and application history"
        actions={
          <Link to="/ess/leave/apply">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Apply Leave
            </Button>
          </Link>
        }
      />

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      {!balLoading && balances.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-info/20 bg-info/5 px-4 py-3 text-xs text-info">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            You have <strong>{totalBalance} paid leave day{totalBalance !== 1 ? 's' : ''}</strong> remaining
            across {balances.filter(b => b.leave_types.is_paid && b.balance > 0).length} leave type{balances.filter(b => b.leave_types.is_paid && b.balance > 0).length !== 1 ? 's' : ''} this year.
          </span>
        </div>
      )}

      {/* ── Balance grid ──────────────────────────────────────────────────── */}
      <SectionCard
        title="Leave Balances"
        icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
        action={
          <Link to="/ess/leave">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
              All leaves <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        }
      >
        {balLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading balances…
          </div>
        ) : balances.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <CalendarDays className="h-8 w-8 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium text-foreground">No balances configured</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Your leave balances haven't been set up yet. Contact HR to configure your leave entitlements.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {balances.map(row => (
              <BalanceCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Recent leave history ─────────────────────────────────────────── */}
      <SectionCard
        title="Recent Leave History"
        icon={<Clock3 className="h-4 w-4 text-muted-foreground" />}
        action={
          <Link to="/ess/leave">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        }
      >
        {leaveLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading history…
          </div>
        ) : recentLeaves.length === 0 ? (
          <div className="flex items-center gap-2.5 py-4 text-muted-foreground text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
            <span>No leave applications yet.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3 text-xs font-medium">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Period</th>
                  <th className="text-center py-2 px-3 text-xs font-medium">Days</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentLeaves.map(r => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-foreground text-xs">
                      {r.leave_types?.name ?? 'Leave'}
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {fmtDate(r.from_date)}
                      {r.from_date !== r.to_date && <> → {fmtDate(r.to_date)}</>}
                    </td>
                    <td className="py-2 px-3 text-center text-xs font-medium text-foreground tabular-nums">
                      {daysBetween(r.from_date, r.to_date)}
                    </td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={STATUS_VARIANT[r.status] ?? 'outline'}
                        className="rounded-full text-[10px] capitalize"
                      >
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Leave policy note ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          Leave balances are updated after each approval. Carry-forward balances are credited at the start of the next financial year as per company policy.
        </span>
      </div>
    </PageContainer>
  )
}
