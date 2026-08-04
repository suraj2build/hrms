/**
 * RegularisationContextDrawer
 *
 * Decision-support panel for approving an attendance regularisation. A raw punch
 * trace is useless here (the request exists *because* punches are missing), so
 * this leads with what actually drives the call:
 *
 *   • the requested correction (in/out, reason)        — passed from the row
 *   • what's currently recorded for that date          — the correction's effect
 *   • the employee's recent attendance trend           — pattern / reliability
 *   • recent regularisation history                    — frequency signal
 *
 * Data: GET /manager/team/regularisation-context?employee_id=&date=
 */
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Clock, History, XCircle, FileClock } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { api }   from '@/lib/api/client'
import { AttendanceTrendCard, type AttendanceTrend } from './AttendanceTrendCard'
import { fmtDateShort } from '@/lib/utils'

export interface RegularisationContextTarget {
  employeeId:    string
  date:          string
  employeeName?: string
  requestedIn?:  string | null
  requestedOut?: string | null
  reason?:       string | null
}

interface RegContextResponse {
  employee: { id: string; name: string; employee_code: string }
  date:     string
  attendance: AttendanceTrend
  current_record: { status: string; work_hours: number; late_minutes: number; overtime_minutes: number } | null
  history: Array<{ date: string; status: string; reason: string; created_at: string }>
}

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = {
  approved: 'success', pending: 'warning', rejected: 'destructive',
  present: 'success', late: 'warning', absent: 'destructive', half_day: 'secondary',
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
function fmtDate(d: string): string {
  return fmtDateShort(d)
}

interface Props {
  target:  RegularisationContextTarget | null
  onClose: () => void
}

export function RegularisationContextDrawer({ target, onClose }: Props) {
  const { data, isLoading, isError } = useQuery<RegContextResponse>({
    queryKey:  ['regularisation-context', target?.employeeId, target?.date],
    queryFn:   () => api.get(`/manager/team/regularisation-context?employee_id=${target!.employeeId}&date=${target!.date}`),
    enabled:   !!target,
    staleTime: 60_000,
  })

  return (
    <Sheet open={!!target} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Regularisation Context
          </SheetTitle>
          <SheetDescription>
            {target?.employeeName ?? data?.employee.name ?? 'Employee'}
            {target && <> · {fmtDate(target.date)}</>}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          {/* The request — available immediately from the row */}
          {target && (
            <div className="rounded-md border border-primary/30 bg-primary/[0.04] p-3 mb-4">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Requested:</span>
                  <span className="font-semibold text-foreground tabular-nums">{fmtTime(target.requestedIn)}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold text-foreground tabular-nums">{fmtTime(target.requestedOut)}</span>
                </div>
                {data?.current_record && (
                  <Badge variant={STATUS_BADGE[data.current_record.status] ?? 'outline'} className="rounded-full text-[9px] capitalize">
                    now: {data.current_record.status.replace('_', ' ')} · {data.current_record.work_hours}h
                  </Badge>
                )}
              </div>
              {target.reason && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{target.reason}</p>}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-10 gap-3">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center py-10 gap-2 text-center">
              <XCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-destructive">Failed to load context</p>
            </div>
          )}

          {data && (
            <div className="space-y-5">
              <AttendanceTrendCard trend={data.attendance} />

              {/* Regularisation history — frequency / pattern signal */}
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-2">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  Recent regularisations
                  <Badge variant={data.history.length > 3 ? 'warning' : 'secondary'} className="rounded-full text-[9px] px-1.5 py-0 ml-1">
                    {data.history.length}
                  </Badge>
                </h3>
                {data.history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No prior regularisation requests.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.history.map((h, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-1.5 text-xs">
                        <div className="min-w-0 flex items-center gap-1.5">
                          <FileClock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-foreground tabular-nums">{fmtDate(h.date)}</span>
                          {h.reason && <span className="text-muted-foreground truncate">· {h.reason}</span>}
                        </div>
                        <Badge variant={STATUS_BADGE[h.status] ?? 'outline'} className="rounded-full text-[8px] px-1.5 py-0 capitalize flex-shrink-0">
                          {h.status}
                        </Badge>
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
