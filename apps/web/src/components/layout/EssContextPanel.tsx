/**
 * EssContextPanel — right-side context rail for the ESS 2.0 desktop shell.
 *
 * Shown on xl+ screens only. Pulls from GET /ess/home and renders a stack of
 * uniformly-structured widget cards:
 *   · Pending approvals (managers/HR)
 *   · Birthdays & milestones — each row has a one-tap "Wish" that posts a
 *     celebratory message to the Community feed
 *   · Upcoming holidays
 *   · Recent kudos received
 *   · Recognise-a-teammate nudge
 *
 * Layout contract: every row is a 3-zone grid — [avatar] [text(min-w-0,truncate)]
 * [action(shrink-0)] — so nothing clips at the 264px rail width.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Cake, PartyPopper, Star, CalendarDays, Award, CheckSquare, Gift,
  ChevronRight, Loader2, Check, Send,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EssHomePayload {
  kpis:              { pending_approvals: number }
  upcoming_holidays: { id: string; name: string; date: string; days_until: number }[]
  recognition:       { total_received: number; recent: { id: string; from_name: string; badge_code: string; message?: string; points?: number; created_at: string }[] }
  birthdays:         { employee_id: string; name: string; days_until: number }[]
  anniversaries:     { employee_id: string; name: string; years: number; days_until: number }[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function dayLabel(n: number) {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `in ${n} days`
}

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  return isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${M[d.getUTCMonth()]}`
}

const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion',
  customer_hero:      'Customer Hero',
  team_player:        'Team Player',
  innovator:          'Innovator',
  problem_solver:     'Problem Solver',
  culture_ambassador: 'Culture Ambassador',
}

const firstNameOf = (full: string) => full.trim().split(/\s+/)[0] || full

// ── Widget shell ─────────────────────────────────────────────────────────────

function Widget({ title, icon: Icon, iconCls, children, action, onAction }: {
  title:     string
  icon:      React.ComponentType<{ className?: string }>
  iconCls:   string
  children:  React.ReactNode
  action?:   string
  onAction?: () => void
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', iconCls)} />
          <span className="truncate">{title}</span>
        </h3>
        {action && (
          <button onClick={onAction}
            className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors">
            {action}<ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-1 text-[11px] text-muted-foreground">{text}</p>
}

// ── Wish button — posts a celebratory message to the Community feed ──────────────

type WishKind = 'birthday' | 'anniversary'

function defaultWish(name: string, kind: WishKind, years?: number) {
  const who = firstNameOf(name)
  return kind === 'birthday'
    ? `🎂 Happy birthday, ${who}! Wishing you a fantastic year ahead. 🎉`
    : `🎉 Congratulations ${who} on ${years} year${years === 1 ? '' : 's'} with the team! Thank you for everything you do. 🙌`
}

function WishButton({ employeeId, name, kind, years }: { employeeId: string; name: string; kind: WishKind; years?: number }) {
  const qc = useQueryClient()
  const [done, setDone] = useState(false)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')

  // Open the composer with a pre-filled, editable message.
  function openComposer() {
    setMessage(defaultWish(name, kind, years))
    setOpen(true)
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/community/wish', { subject_employee_id: employeeId, kind, message: message.trim() }),
    onSuccess: () => {
      setDone(true)
      setOpen(false)
      toast.success('Wish posted to Community', { description: `${firstNameOf(name)} will see it in the feed.` })
      qc.invalidateQueries({ queryKey: ['community-feed'] })
    },
    onError: () => toast.error('Could not post your wish', { description: 'Please try again in a moment.' }),
  })

  return (
    <>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#15B8A6]/12 px-2 py-1 text-[10px] font-semibold text-[#15B8A6]">
          <Check className="h-3 w-3" />Wished
        </span>
      ) : (
        <button
          onClick={openComposer}
          className="flex shrink-0 items-center gap-1 rounded-full border border-[#15B8A6]/30 bg-[#15B8A6]/5 px-2.5 py-1 text-[10px] font-semibold text-[#15B8A6] hover:bg-[#15B8A6]/12 transition-colors"
        >
          <PartyPopper className="h-3 w-3" />Wish
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-lg">{kind === 'birthday' ? '🎂' : '🎉'}</span>
              Wish {firstNameOf(name)}
            </DialogTitle>
            <DialogDescription>
              Edit your message if you like — it'll post to the Community feed for everyone to see.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Write a warm message…"
            className="resize-none text-sm"
          />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || message.trim().length === 0}
              className="gap-1.5"
            >
              {mutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
              Post wish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Celebration row (birthday / anniversary) ────────────────────────────────────

function CelebrationRow({ employeeId, emoji, tint, name, sub, kind, years }: {
  employeeId: string; emoji: string; tint: string; name: string; sub: string; kind: WishKind; years?: number
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm" style={{ backgroundColor: tint }}>
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{name}</p>
        <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
      </div>
      <WishButton employeeId={employeeId} name={name} kind={kind} years={years} />
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function EssContextPanel() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const isManager = ['manager', 'hr_admin', 'super_admin'].includes(profile?.role ?? '')

  const { data, isLoading } = useQuery<EssHomePayload>({
    queryKey:  ['ess-home-panel'],
    queryFn:   () => api.get('/ess/home'),
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <aside className="hidden xl:flex w-[264px] shrink-0 flex-col border-l border-border/60 bg-muted/20">
        <div className="flex flex-col gap-3 p-4">
          {[1,2,3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/50" />)}
        </div>
      </aside>
    )
  }

  const birthdays     = data?.birthdays          ?? []
  const anniversaries = data?.anniversaries      ?? []
  const holidays      = data?.upcoming_holidays  ?? []
  const recognition   = data?.recognition?.recent ?? []
  const approvalsCnt  = data?.kpis?.pending_approvals ?? 0
  const hasCelebrations = birthdays.length > 0 || anniversaries.length > 0

  return (
    <aside className="hidden xl:flex w-[264px] shrink-0 flex-col overflow-y-auto border-l border-border/60 bg-muted/20">
      <div className="flex flex-col gap-4 p-4 pb-8">

        {/* Pending approvals — managers only */}
        {isManager && (
          <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
            <Widget title="Approvals" icon={CheckSquare} iconCls="text-primary"
              action="View" onAction={() => navigate('/ess/flowdesk')}>
              {approvalsCnt === 0 ? (
                <EmptyState text="Nothing waiting on you." />
              ) : (
                <button onClick={() => navigate('/ess/flowdesk')}
                  className="flex w-full items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 hover:bg-primary/10 transition-colors">
                  <span className="text-xs font-medium text-foreground">
                    {approvalsCnt} item{approvalsCnt !== 1 ? 's' : ''} pending
                  </span>
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {approvalsCnt > 99 ? '99+' : approvalsCnt}
                  </span>
                </button>
              )}
            </Widget>
          </div>
        )}

        {/* Birthdays & milestones — with one-tap Wish */}
        {hasCelebrations && (
          <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
            <Widget title="Birthdays & Milestones" icon={Cake} iconCls="text-[#B07B18]">
              <div className="space-y-2.5">
                {birthdays.map((b, i) => (
                  <CelebrationRow key={`b-${i}`} employeeId={b.employee_id} emoji="🎂" tint="rgba(176,123,24,0.10)"
                    name={b.name} sub={`Birthday · ${dayLabel(b.days_until)}`} kind="birthday" />
                ))}
                {anniversaries.map((a, i) => (
                  <CelebrationRow key={`a-${i}`} employeeId={a.employee_id} emoji="🎉" tint="rgba(21,184,166,0.10)"
                    name={a.name} sub={`${a.years}-yr anniversary · ${dayLabel(a.days_until)}`}
                    kind="anniversary" years={a.years} />
                ))}
              </div>
            </Widget>
          </div>
        )}

        {/* Upcoming holidays */}
        <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
          <Widget title="Upcoming Holidays" icon={CalendarDays} iconCls="text-[#1A4D8F]"
            action="All" onAction={() => navigate('/ess/company-holidays')}>
            {holidays.length === 0 ? (
              <EmptyState text="No holidays in the next 60 days." />
            ) : (
              <div className="space-y-2">
                {holidays.slice(0, 4).map((h) => (
                  <div key={h.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{h.name}</p>
                      <p className="text-[10px] text-muted-foreground">{dayLabel(h.days_until)}</p>
                    </div>
                    <span className="shrink-0 rounded-md bg-primary/8 px-2 py-1 text-[10px] font-semibold text-primary">
                      {fmtDate(h.date)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        </div>

        {/* Recent kudos */}
        <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
          <Widget title="Recent Kudos" icon={Award} iconCls="text-[#15B8A6]"
            action="All" onAction={() => navigate('/ess/recognition')}>
            {recognition.length === 0 ? (
              <div className="flex flex-col gap-1.5">
                <EmptyState text="No kudos yet." />
                <button onClick={() => navigate('/ess/recognition')}
                  className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/80">
                  <Gift className="h-3 w-3" />Give recognition
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {recognition.slice(0, 3).map((r) => (
                  <div key={r.id} className="rounded-lg border border-[#15B8A6]/20 bg-[#15B8A6]/5 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] font-semibold text-foreground">
                        {BADGE_LABELS[r.badge_code] ?? r.badge_code ?? 'Kudos'}
                      </p>
                      {r.points != null && (
                        <span className="shrink-0 text-[10px] font-bold text-[#15B8A6]">+{r.points}pts</span>
                      )}
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">from {r.from_name}</p>
                    {r.message && (
                      <p className="mt-0.5 line-clamp-2 text-[10px] italic text-foreground/70">"{r.message}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Widget>
        </div>

        {/* Recognise nudge */}
        <button onClick={() => navigate('/ess/recognition')}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-3 py-2.5 text-left hover:border-primary/50 hover:bg-primary/10 transition-colors">
          <Star className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-[11px] font-semibold text-primary">Recognise a teammate</span>
        </button>

      </div>
    </aside>
  )
}
