/**
 * ManagerTeamHelpdesk — P6.8
 *
 * Read-only visibility into helpdesk tickets raised by the manager's direct
 * reports. Shows status, priority, SLA risk. Managers cannot resolve tickets —
 * HR remains the ticket owner. Provides awareness so managers can follow up
 * with their team members if needed.
 *
 * Reuses: GET /manager/team/helpdesk (new P6.8 endpoint).
 */

import { useState, useMemo }  from 'react'
import { useQuery }            from '@tanstack/react-query'
import { LifeBuoy, RefreshCw, Loader2, Search, AlertTriangle } from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ticket {
  id:                string
  subject:           string
  category:          string
  priority:          string
  status:            string
  created_at:        string
  sla_due_at:        string | null
  sla_breached:      boolean
  resolved_at:       string | null
  closed_at:         string | null
  employee_name:     string | null
  employee_code:     string | null
}

interface HelpdeskResponse {
  data:    Ticket[]
  summary: { total: number; open: number; in_progress: number; awaiting_employee: number; resolved: number; breached: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-destructive/15 text-destructive',
  high:   'bg-accent-coral/15 text-accent-coral',
  medium: 'bg-warning/15 text-warning',
  low:    'bg-muted text-muted-foreground',
}

const STATUS_COLORS: Record<string, string> = {
  open:               'bg-info/15 text-info',
  in_progress:        'bg-warning/15 text-warning',
  awaiting_employee:  'bg-primary/15 text-primary',
  resolved:           'bg-success/15 text-success',
  closed:             'bg-muted text-muted-foreground',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerTeamHelpdesk() {
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [search, setSearch] = useState('')

  const { data, isFetching, refetch } = useQuery<HelpdeskResponse>({
    queryKey: ['manager-team-helpdesk', statusFilter],
    queryFn:  () => api.get(`/manager/team/helpdesk${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`),
    staleTime: 60_000,
  })

  const tickets = useMemo(() => data?.data ?? [], [data])
  const summary = data?.summary

  const filtered = useMemo(() => {
    if (!search.trim()) return tickets
    const q = search.toLowerCase()
    return tickets.filter(t =>
      t.subject.toLowerCase().includes(q) ||
      (t.employee_name ?? '').toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q),
    )
  }, [tickets, search])

  const STATUS_TABS = [
    { key: 'open',        label: 'Open' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'all',         label: 'All' },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Team Helpdesk"
        subtitle="Helpdesk tickets raised by your team. HR resolves tickets — this view is for awareness only."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* Summary tiles */}
      {summary && (
        <div className="mb-4">
          <MetricRow cols={4}>
            <MetricCard label="Open"        value={summary.open}        variant="info" />
            <MetricCard label="In Progress" value={summary.in_progress} variant="warning" />
            <MetricCard label="Resolved"    value={summary.resolved}    variant="success" />
            <MetricCard label="SLA Breach"  value={summary.breached}    variant="destructive" />
          </MetricRow>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-border overflow-hidden">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setStatusFilter(t.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                statusFilter === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm w-52"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <SectionCard>
        {isFetching && tickets.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <LifeBuoy className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No tickets found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left">
                  <th className="py-2 px-4">Employee</th>
                  <th className="py-2 px-3">Subject</th>
                  <th className="py-2 px-3">Category</th>
                  <th className="py-2 px-3">Priority</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">SLA</th>
                  <th className="py-2 px-3">Raised</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 px-4">
                      <p className="font-medium">{t.employee_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{t.employee_code}</p>
                    </td>
                    <td className="py-2.5 px-3 max-w-[200px] truncate">{t.subject}</td>
                    <td className="py-2.5 px-3 capitalize text-muted-foreground">{t.category.replace('_', ' ')}</td>
                    <td className="py-2.5 px-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize', PRIORITY_COLORS[t.priority] ?? '')}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_COLORS[t.status] ?? '')}>
                        {t.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {t.sla_breached ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Breached
                        </span>
                      ) : t.sla_due_at ? (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {new Date(t.sla_due_at).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground tabular-nums">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}

export default ManagerTeamHelpdesk
