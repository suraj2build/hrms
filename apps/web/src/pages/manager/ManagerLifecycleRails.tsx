/**
 * ManagerLifecycleRails — Program 6A · P6.2
 *
 * Additive intelligence rails for the existing Manager Dashboard. Surfaces the
 * lifecycle signals a manager would otherwise have to chase HR for: probation,
 * new joiners, trust risk, expiry risk and separation risk.
 *
 * Reads the SAME endpoint as the Team Lifecycle workspace (GET /manager/team/
 * lifecycle) — without readiness, so the dashboard stays light — and renders the
 * roll-up `summary`. Renders nothing when there are no signals. No new engine,
 * no duplicate calculation.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { UserCheck, UserPlus, ShieldAlert, CalendarClock, LogOut, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api/client'

interface LifecycleSummary {
  probation:   { on_probation: number; due_week: number; due_month: number; overdue: number }
  new_joiners: { count: number; pending_readiness: number; missing_documents: number }
  trust:       { high: number; critical: number }
  expiry:      { documents: number; contracts: number; visa: number; overdue: number }
  separation:  { active: number; pending_manager_clearance: number }
}

export function ManagerLifecycleRails() {
  const navigate = useNavigate()
  const { data } = useQuery<{ summary: LifecycleSummary }>({
    queryKey: ['manager-team-lifecycle', 'summary'],
    queryFn:  () => api.get('/manager/team/lifecycle'),
    staleTime: 5 * 60_000,
  })

  const s = data?.summary
  if (!s) return null

  const rails: Array<{
    key: string; icon: typeof UserCheck; label: string
    lines: Array<{ t: string; n: number; tone?: 'danger' | 'warn' }>
  }> = [
    {
      key: 'probation', icon: UserCheck, label: 'Probation',
      lines: [
        { t: 'Due this week', n: s.probation.due_week, tone: 'warn' },
        { t: 'Due this month', n: s.probation.due_month },
        { t: 'Overdue', n: s.probation.overdue, tone: 'danger' },
      ],
    },
    {
      key: 'joiners', icon: UserPlus, label: 'New Joiners',
      lines: [
        { t: 'Joined (90d)', n: s.new_joiners.count },
        { t: 'Pending readiness', n: s.new_joiners.pending_readiness, tone: 'warn' },
        { t: 'Missing documents', n: s.new_joiners.missing_documents, tone: 'warn' },
      ],
    },
    {
      key: 'trust', icon: ShieldAlert, label: 'Trust Risk',
      lines: [
        { t: 'Critical', n: s.trust.critical, tone: 'danger' },
        { t: 'High', n: s.trust.high, tone: 'warn' },
      ],
    },
    {
      key: 'expiry', icon: CalendarClock, label: 'Expiry Risk',
      lines: [
        { t: 'Documents', n: s.expiry.documents, tone: 'warn' },
        { t: 'Contracts', n: s.expiry.contracts, tone: 'warn' },
        { t: 'Visa/Passport', n: s.expiry.visa, tone: 'warn' },
      ],
    },
    {
      key: 'separation', icon: LogOut, label: 'Separation Risk',
      lines: [
        { t: 'Active notice', n: s.separation.active },
        { t: 'Pending your clearance', n: s.separation.pending_manager_clearance, tone: 'danger' },
      ],
    },
  ]

  // Hide entirely when every signal is zero — keeps the dashboard quiet on calm days.
  const hasSignal = rails.some(r => r.lines.some(l => l.n > 0))
  if (!hasSignal) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team Lifecycle Intelligence</p>
        <button
          onClick={() => navigate('/manager/team/lifecycle')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Open workspace <ChevronRight className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {rails.map(r => {
          const Icon = r.icon
          return (
            <div key={r.key} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-foreground">{r.label}</span>
              </div>
              <div className="space-y-1">
                {r.lines.map(l => (
                  <div key={l.t} className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{l.t}</span>
                    <span className={
                      l.n === 0 ? 'text-xs font-semibold tabular-nums text-muted-foreground'
                      : l.tone === 'danger' ? 'text-xs font-semibold tabular-nums text-destructive'
                      : l.tone === 'warn' ? 'text-xs font-semibold tabular-nums text-warning'
                      : 'text-xs font-semibold tabular-nums text-foreground'
                    }>{l.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ManagerLifecycleRails
