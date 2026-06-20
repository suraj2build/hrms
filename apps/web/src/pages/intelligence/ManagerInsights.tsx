/**
 * ManagerInsights — compact team intelligence panel
 * Renders inside the existing Manager dashboard as an additive component.
 * Does NOT replace any existing functionality.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Loader2, Sparkles } from 'lucide-react'

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

  // Headline stats (team size, pending, probation, joiners) live in the identity
  // header, the attendance strip and the lifecycle rails — so this panel is now a
  // single AI-style insight line, not a repeated stat grid.
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Team Intelligence</p>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground">{d.summary}</p>
      </div>
    </div>
  )
}

export default ManagerInsights
