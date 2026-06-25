/**
 * EssContextPanel — right-side context panel for the ESS 2.0 desktop shell.
 *
 * Shown on xl+ screens only (hidden on laptop/tablet). Pulls from GET /ess/home
 * and renders compact widgets:
 *   · Birthdays this week
 *   · Work anniversaries this week
 *   · Upcoming holidays
 *   · Recent kudos received
 *   · Pending approvals badge (managers/HR)
 *
 * Design: narrow (260px), scrollable, no chrome — just content cards separated
 * by a subtle divider. Uses the same design-token contract as the rest of ESS.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Cake, Star, CalendarDays, Award, CheckSquare, Gift, ChevronRight,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EssHomePayload {
  kpis:              { pending_approvals: number }
  upcoming_holidays: { id: string; name: string; date: string; days_until: number }[]
  recognition:       { total_received: number; recent: { id: string; from_name: string; badge_code: string; message?: string; points?: number; created_at: string }[] }
  birthdays:         { name: string; days_until: number }[]
  anniversaries:     { name: string; years: number; days_until: number }[]
}

// ── Shared widget layout ───────────────────────────────────────────────────────

function Widget({ title, icon: Icon, iconCls, children, action, onAction }: {
  title:    string
  icon:     React.ComponentType<{ className?: string }>
  iconCls:  string
  children: React.ReactNode
  action?:  string
  onAction?: () => void
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className={cn('h-3 w-3', iconCls)} />{title}
        </h3>
        {action && (
          <button onClick={onAction}
            className="flex items-center gap-0.5 text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors">
            {action}<ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-[11px] text-muted-foreground py-1">{text}</p>
}

// ── Day label helper ───────────────────────────────────────────────────────────

function dayLabel(n: number) {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `in ${n}d`
}

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  return isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${M[d.getUTCMonth()]}`
}

// ── Badge code → readable label ────────────────────────────────────────────────

const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion',
  customer_hero:      'Customer Hero',
  team_player:        'Team Player',
  innovator:          'Innovator',
  problem_solver:     'Problem Solver',
  culture_ambassador: 'Culture Ambassador',
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function EssContextPanel() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const isManager = ['manager', 'hr_admin', 'super_admin'].includes(profile?.role ?? '')

  const { data, isLoading } = useQuery<EssHomePayload>({
    queryKey: ['ess-home-panel'],
    queryFn:  () => api.get('/ess/home'),
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <aside className="hidden xl:flex w-[260px] shrink-0 flex-col border-l border-border/60 bg-background/50">
        <div className="flex flex-col gap-3 p-4">
          {[1,2,3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      </aside>
    )
  }

  const birthdays    = data?.birthdays    ?? []
  const anniversaries = data?.anniversaries ?? []
  const holidays     = data?.upcoming_holidays ?? []
  const recognition  = data?.recognition?.recent ?? []
  const approvalsCnt = data?.kpis?.pending_approvals ?? 0

  return (
    <aside className="hidden xl:flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-border/60 bg-background/50">
      <div className="flex flex-col gap-5 p-4 pb-8">

        {/* Pending approvals — managers only */}
        {isManager && (
          <Widget title="Approvals" icon={CheckSquare} iconCls="text-primary"
            action="View all" onAction={() => navigate('/ess/flowdesk')}>
            {approvalsCnt === 0 ? (
              <EmptyState text="Nothing waiting on you." />
            ) : (
              <button onClick={() => navigate('/ess/flowdesk')}
                className="flex w-full items-center justify-between rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 hover:bg-primary/10 transition-colors">
                <span className="text-xs font-medium text-foreground">
                  {approvalsCnt} item{approvalsCnt !== 1 ? 's' : ''} pending
                </span>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {approvalsCnt > 99 ? '99+' : approvalsCnt}
                </span>
              </button>
            )}
          </Widget>
        )}

        {/* Birthdays this week */}
        {(birthdays.length > 0 || anniversaries.length > 0) && (
          <Widget title="Birthdays & Milestones" icon={Cake} iconCls="text-[#B07B18]">
            <div className="space-y-2">
              {birthdays.map((b, i) => (
                <div key={`b-${i}`} className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#B07B18]/10 text-sm">
                    🎂
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-foreground">{b.name}</p>
                    <p className="text-[10px] text-muted-foreground">Birthday · {dayLabel(b.days_until)}</p>
                  </div>
                </div>
              ))}
              {anniversaries.map((a, i) => (
                <div key={`a-${i}`} className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1A8050]/10 text-sm">
                    🎉
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-foreground">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">{a.years}yr work anniversary · {dayLabel(a.days_until)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Widget>
        )}

        {/* Upcoming holidays */}
        <Widget title="Upcoming Holidays" icon={CalendarDays} iconCls="text-[#1A4D8F]"
          action="All holidays" onAction={() => navigate('/ess/company-holidays')}>
          {holidays.length === 0 ? (
            <EmptyState text="No holidays in the next 60 days." />
          ) : (
            <div className="space-y-1.5">
              {holidays.slice(0, 4).map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{h.name}</p>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-[10px] font-semibold text-primary">{fmtDate(h.date)}</span>
                    <span className="text-[9px] text-muted-foreground">{dayLabel(h.days_until)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>

        {/* Recent recognition received */}
        <Widget title="Recent Kudos" icon={Award} iconCls="text-[#15B8A6]"
          action="Recognition" onAction={() => navigate('/ess/recognition')}>
          {recognition.length === 0 ? (
            <div className="flex flex-col gap-1">
              <EmptyState text="No kudos yet — you'll be the first to know!" />
              <button onClick={() => navigate('/ess/recognition')}
                className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/80">
                <Gift className="h-3 w-3" />Give recognition
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recognition.slice(0, 3).map((r) => (
                <div key={r.id} className="rounded-lg bg-[#15B8A6]/5 border border-[#15B8A6]/20 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[11px] font-semibold text-foreground">
                      {BADGE_LABELS[r.badge_code] ?? r.badge_code ?? 'Kudos'}
                    </p>
                    {r.points != null && (
                      <span className="text-[10px] font-bold text-[#15B8A6]">+{r.points}pts</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">from {r.from_name}</p>
                  {r.message && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] italic text-foreground/70">"{r.message}"</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Widget>

        {/* Star recognition nudge */}
        <button onClick={() => navigate('/ess/recognition')}
          className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/3 px-3 py-2.5 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors">
          <Star className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-[11px] font-medium text-foreground/70">Recognise a teammate →</span>
        </button>

      </div>
    </aside>
  )
}
