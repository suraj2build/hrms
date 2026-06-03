/**
 * ManagerInsights — compact team intelligence panel
 * Renders inside the existing Manager dashboard as an additive component.
 * Does NOT replace any existing functionality.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Loader2, Users, Clock, AlertTriangle } from 'lucide-react'

interface ManagerSummaryData {
  summary:                 string
  team_size:               number
  new_joiners_this_month:  number
  probation_due:           number
  pending_leave_approvals: number
  generated_at:            string
}

export function ManagerInsights() {
  const { data, isLoading, error } = useQuery<{ data: ManagerSummaryData }>({
    queryKey: ['intelligence-manager-summary'],
    queryFn:  () => api.get('/intelligence/manager-summary'),
    staleTime: 10 * 60_000,
  })
  const d = data?.data

  if (isLoading) return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Loading team insights…</span>
    </div>
  )
  if (error || !d) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team Intelligence</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-0.5">
          <p className="text-2xl font-bold text-foreground">{d.team_size}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" /> Team Size
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-2xl font-bold text-foreground">{d.new_joiners_this_month}</p>
          <p className="text-xs text-muted-foreground">New This Month</p>
        </div>
        <div className={d.probation_due > 0 ? 'text-orange-700 space-y-0.5' : 'space-y-0.5'}>
          <p className="text-2xl font-bold">{d.probation_due}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Probation Due
          </p>
        </div>
        <div className={d.pending_leave_approvals > 0 ? 'text-blue-700 space-y-0.5' : 'space-y-0.5'}>
          <p className="text-2xl font-bold">{d.pending_leave_approvals}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> Leave Pending
          </p>
        </div>
      </div>
      <div className="rounded-md bg-muted/40 px-3 py-2">
        <p className="text-xs leading-relaxed text-foreground">{d.summary}</p>
        <p className="text-[10px] text-muted-foreground mt-1">Source: employees · leave_requests</p>
      </div>
    </div>
  )
}

export default ManagerInsights
