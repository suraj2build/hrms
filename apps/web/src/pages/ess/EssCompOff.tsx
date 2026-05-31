/**
 * EssCompOff — /ess/comp-off
 *
 * Employee self-service view for comp-off requests.
 * Shows the employee's own comp-off request history and current balance.
 */

import { useQuery }                from '@tanstack/react-query'
import {
  CalendarPlus, CalendarRange, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type CompOffStatus = 'pending' | 'approved' | 'rejected'
type WorkedReason  = 'holiday' | 'weekly_off'

interface CompOffRequest {
  id:             string
  worked_date:    string
  worked_reason:  WorkedReason
  days_to_credit: number
  status:         CompOffStatus
  notes:          string | null
  approved_at:    string | null
  created_at:     string
  leave_types?:   { id: string; name: string }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<CompOffStatus, 'warning' | 'success' | 'destructive'> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
}
const STATUS_LABEL: Record<CompOffStatus, string> = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}
const REASON_LABEL: Record<WorkedReason, string> = {
  holiday:    'Worked on Holiday',
  weekly_off: 'Worked on Weekly Off',
}

function fmt(d: string) {
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EssCompOff() {
  useAuthStore()

  const { data, isLoading } = useQuery<{ data: CompOffRequest[] }>({
    queryKey: ['comp-off-my'],
    queryFn:  () => api.get('/attendance/comp-off'),
    staleTime: 60_000,
  })
  const requests = data?.data ?? []

  const pending  = requests.filter(r => r.status === 'pending')
  const approved = requests.filter(r => r.status === 'approved')
  const totalCredited = approved.reduce((s, r) => s + r.days_to_credit, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Comp-Off"
        subtitle="Compensatory leave earned for working on holidays and weekly-off days"
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pending Approval',    value: pending.length,           icon: Clock,          cls: 'text-warning' },
          { label: 'Total Days Earned',   value: `${totalCredited}d`,      icon: CheckCircle2,   cls: 'text-success' },
          { label: 'Total Requests',      value: requests.length,          icon: CalendarRange,  cls: 'text-info' },
        ].map(({ label, value, icon: Icon, cls }) => (
          <SectionCard key={label}>
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-lg bg-muted/50', cls)}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className={cn('text-xl font-bold', cls)}>{value}</p>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard
        title="My Comp-Off Requests"
        icon={<CalendarPlus className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="space-y-2 animate-pulse py-4">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded-lg" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <CalendarPlus className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium text-foreground">No comp-off requests yet</p>
            <p className="text-xs text-center max-w-sm">
              When you work on a holiday or weekly-off day, HR will generate a comp-off request on your behalf.
              Once approved, the days are credited to your leave balance.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map(req => (
              <div
                key={req.id}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{fmt(req.worked_date)}</p>
                    <p className="text-[11px] text-muted-foreground">{REASON_LABEL[req.worked_reason]}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] rounded-full">
                    {req.days_to_credit === 0.5 ? 'Half Day' : `${req.days_to_credit} Day`}
                  </Badge>
                  {req.leave_types && (
                    <Badge variant="secondary" className="text-[10px] rounded-full">
                      {req.leave_types.name}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {req.status === 'approved' && req.approved_at && (
                    <span className="text-[10px] text-muted-foreground">Approved {fmt(req.approved_at)}</span>
                  )}
                  {req.status === 'pending' && (
                    <div className="flex items-center gap-1.5 text-[10px] text-warning">
                      <AlertCircle className="h-3 w-3" />
                      Awaiting HR approval
                    </div>
                  )}
                  <Badge variant={STATUS_VARIANT[req.status]} className="text-[10px] rounded-full">
                    {STATUS_LABEL[req.status]}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
          <strong className="text-foreground">How comp-off works:</strong> When you work on a declared holiday
          or your weekly-off day, HR generates a compensatory leave request. Once approved, the days are
          automatically credited to your comp-off leave balance with a validity window per your company policy.
        </div>
      </SectionCard>
    </PageContainer>
  )
}
