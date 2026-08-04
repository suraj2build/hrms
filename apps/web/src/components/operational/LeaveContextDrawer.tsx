/**
 * LeaveContextDrawer
 *
 * Right-side slide-over giving a manager the context they need to approve or
 * reject a pending LEAVE request — the information the request row itself does
 * not carry:
 *
 *   • Leave balances    — current balance per leave type (is this within balance?)
 *   • Team overlap      — teammates already approved off during the window
 *                         (coverage risk)
 *   • Recent history    — the employee's last few leave requests (pattern)
 *
 * Data: GET /manager/team/leave-context?employee_id=&from=&to=
 *
 * NOTE: This replaces the attendance-forensics drawer on the leave tab — a punch
 * timeline is meaningless for a future-dated leave request. Forensics remains on
 * the regularisation tab where a past-date punch trace is the relevant evidence.
 */
import { useQuery } from '@tanstack/react-query'
import {
  CalendarClock, Wallet, Users, History, Info, XCircle, AlertTriangle,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { api }   from '@/lib/api/client'
import { AttendanceTrendCard, type AttendanceTrend } from './AttendanceTrendCard'
import { fmtDateShort } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LeaveContextTarget {
  employeeId:   string
  from:         string
  to:           string
  employeeName?: string
}

interface LeaveContextResponse {
  employee: { id: string; name: string; employee_code: string }
  window:   { from: string; to: string }
  balances: Array<{ leave_type_id: string; leave_type: string; is_paid: boolean; balance: number }>
  team_overlap: Array<{ name: string; employee_code: string | null; leave_type: string | null; from_date: string; to_date: string; days: number }>
  history:  Array<{ leave_type: string; from_date: string; to_date: string; days: number; status: string }>
  attendance: AttendanceTrend
}

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = {
  APPROVED:  'success',
  PENDING:   'warning',
  REJECTED:  'destructive',
  CANCELLED: 'secondary',
}

function fmtDate(iso: string): string {
  return fmtDateShort(iso)
}

function fmtRange(from: string, to: string): string {
  return from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`
}

// ── Component ───────────────────────────────────────────────────────────────────

interface Props {
  target:  LeaveContextTarget | null
  onClose: () => void
}

export function LeaveContextDrawer({ target, onClose }: Props) {
  const { data, isLoading, isError } = useQuery<LeaveContextResponse>({
    queryKey:  ['leave-context', target?.employeeId, target?.from, target?.to],
    queryFn:   () => api.get(`/manager/team/leave-context?employee_id=${target!.employeeId}&from=${target!.from}&to=${target!.to}`),
    enabled:   !!target,
    staleTime: 60_000,
  })

  return (
    <Sheet open={!!target} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Leave Context
          </SheetTitle>
          <SheetDescription>
            {target?.employeeName ?? data?.employee.name ?? 'Employee'}
            {target && <> · {fmtRange(target.from, target.to)}</>}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-3">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center py-12 gap-2 text-center">
              <XCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-destructive">Failed to load leave context</p>
            </div>
          )}

          {data && (
            <div className="space-y-5">
              {/* ── Balances ─────────────────────────────────────────────── */}
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-2">
                  <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                  Leave balances
                </h3>
                {data.balances.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No balance records.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {data.balances.map(b => (
                      <div key={b.leave_type_id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] text-muted-foreground truncate">{b.leave_type}</span>
                          <Badge variant={b.is_paid ? 'success' : 'secondary'} className="rounded-full text-[8px] px-1.5 py-0">
                            {b.is_paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </div>
                        <div className="text-base font-bold text-foreground tabular-nums mt-0.5">
                          {b.balance}
                          <span className="text-[10px] font-medium text-muted-foreground ml-1">days left</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Attendance trend (recent reliability) ────────────────── */}
              {data.attendance && <AttendanceTrendCard trend={data.attendance} />}

              {/* ── Team overlap (coverage risk) ─────────────────────────── */}
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  Team off during this window
                  {data.team_overlap.length > 0 && (
                    <Badge variant="warning" className="rounded-full text-[9px] px-1.5 py-0 ml-1">
                      {data.team_overlap.length}
                    </Badge>
                  )}
                </h3>
                {data.team_overlap.length === 0 ? (
                  <div className="flex items-center gap-1.5 text-xs text-success">
                    <Info className="h-3.5 w-3.5" />
                    No teammates are on approved leave during this period.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] text-warning mb-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Coverage overlap — review before approving.
                    </div>
                    <div className="space-y-1.5">
                      {data.team_overlap.map((o, i) => (
                        <div key={i} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5 text-xs">
                          <div className="min-w-0">
                            <span className="font-medium text-foreground">{o.name}</span>
                            {o.leave_type && <span className="text-muted-foreground"> · {o.leave_type}</span>}
                          </div>
                          <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                            {fmtRange(o.from_date, o.to_date)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {/* ── Recent history ───────────────────────────────────────── */}
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-2">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  Recent leave history
                </h3>
                {data.history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No prior leave requests.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.history.map((h, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5 text-xs">
                        <div className="min-w-0">
                          <span className="font-medium text-foreground">{h.leave_type}</span>
                          <span className="text-muted-foreground"> · {h.days}d</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-muted-foreground tabular-nums">{fmtRange(h.from_date, h.to_date)}</span>
                          <Badge variant={STATUS_BADGE[h.status] ?? 'outline'} className="rounded-full text-[8px] px-1.5 py-0 capitalize">
                            {h.status.toLowerCase()}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
