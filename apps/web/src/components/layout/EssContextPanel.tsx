/**
 * EssContextPanel — right-side Context Rail for ESS desktop shell.
 * Shown on xl+ screens only. Hidden on /ess/home (home has its own right column).
 *
 * Design principle: every section must answer "does this genuinely help the
 * employee with what they're doing right now?" If not, it doesn't belong here.
 *
 * ── FROZEN — RC1 approved ────────────────────────────────────────────────────
 * The Context Rail is feature-frozen as of RC1. Do NOT add new sections, cards,
 * CTAs, or data sources without explicit product approval.
 *
 * Current sections (and why each earns its place):
 *   • Approvals      — managers only; directly actionable work waiting on them
 *   • Birthdays & Milestones — time-sensitive human signal; hidden when empty
 *   • Upcoming Holidays     — always a valid planning signal
 *   • Recent Kudos          — positive reinforcement; hidden when empty
 *
 * What was intentionally removed (do not re-add):
 *   • "Recognise a teammate" CTA — promotional, not contextual; sidebar covers it
 *   • Kudos empty state — "No kudos yet" is noise, not signal
 *
 * Remaining P2 items (wish persistence, page-aware content, dynamic cards) are
 * deferred until real employee behavior is observed post-launch. They require
 * product approval before implementation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useRef, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Cake, PartyPopper, CalendarDays, Award, CheckSquare, Check, Send, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { invalidateCommunityFeeds } from '@/lib/community-feed-cache'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion',
  customer_hero:      'Customer Hero',
  team_player:        'Team Player',
  innovator:          'Innovator',
  problem_solver:     'Problem Solver',
  culture_ambassador: 'Culture Ambassador',
}

// P0: humanise unknown badge codes (e.g. "best_buddy" → "Best Buddy")
// rather than showing raw snake_case to the user.
function humaniseBadge(code: string): string {
  return BADGE_LABELS[code]
    ?? code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const firstNameOf = (full: string) => full.trim().split(/\s+/)[0] || full

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ label, icon: Icon, action, onAction }: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </h3>
      {action && (
        <button onClick={onAction}
          className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-primary transition-colors hover:text-primary/80">
          {action}
        </button>
      )}
    </div>
  )
}

// ── Wish button ───────────────────────────────────────────────────────────────

type WishKind = 'birthday' | 'anniversary'

function defaultWish(name: string, kind: WishKind, years?: number) {
  const who = firstNameOf(name)
  return kind === 'birthday'
    ? `Happy birthday, ${who}! Wishing you a fantastic year ahead.`
    : `Congratulations ${who} on ${years} year${years === 1 ? '' : 's'} with the team!`
}

function WishButton({ employeeId, name, kind, years }: {
  employeeId: string; name: string; kind: WishKind; years?: number
}) {
  const qc = useQueryClient()
  const [done, setDone] = useState(false)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  // Stable per-mount UUID sent as Idempotency-Key — a dropped/retried response
  // would otherwise post the same wish twice. Rotated after success.
  const wishKey = useRef(crypto.randomUUID())

  const mutation = useMutation({
    mutationFn: () =>
      api.post(
        '/community/wish',
        { subject_employee_id: employeeId, kind, message: message.trim() },
        { headers: { 'Idempotency-Key': wishKey.current } },
      ),
    onSuccess: () => {
      wishKey.current = crypto.randomUUID()
      setDone(true); setOpen(false)
      toast.success('Wish posted to Community', { description: `${firstNameOf(name)} will see it in the feed.` })
      invalidateCommunityFeeds(qc)
    },
    onError: () => toast.error('Could not post your wish', { description: 'Please try again in a moment.' }),
  })

  return (
    <>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#15B8A6]/15 px-2 py-0.5 text-[10px] font-semibold text-[#15B8A6]">
          <Check className="h-3 w-3" />Wished
        </span>
      ) : (
        <button
          onClick={() => { setMessage(defaultWish(name, kind, years)); setOpen(true) }}
          className="flex shrink-0 items-center gap-1 rounded-full border border-[#15B8A6]/25 bg-[#15B8A6]/8 px-2 py-0.5 text-[10px] font-semibold text-[#15B8A6] transition-colors hover:bg-[#15B8A6]/15"
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
              Edit your message — it'll post to the Community feed for everyone to see.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)}
            rows={4} maxLength={2000} placeholder="Write a warm message…" className="resize-none text-sm" />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || message.trim().length === 0} className="gap-1.5">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post wish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Scroll fade — bottom gradient when the rail overflows ─────────────────────

function useScrollFade(ref: React.RefObject<HTMLElement | null>) {
  const [faded, setFaded] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Show fade only while unscrolled content remains below the viewport
    function check() {
      if (!el) return
      setFaded(el.scrollHeight - el.scrollTop - el.clientHeight > 16)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [ref])
  return faded
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function EssContextPanel() {
  const navigate  = useNavigate()
  const { profile } = useAuthStore()
  const { activeRole } = useUIStore()

  // P0: respect activeRole so managers in employee-mode don't see the Approvals block
  const hasManagerRole = ['manager', 'hr_admin', 'super_admin'].includes(profile?.role ?? '')
  const isManager = hasManagerRole && activeRole !== 'employee'

  // P0: use the shared ['ess-home'] cache key — same key as EssHome / Arrival /
  // MobileEssShell so the Rail reuses the already-cached response instead of
  // firing a second request with a different key.
  const { data, isLoading } = useQuery<EssHomePayload>({
    queryKey:  ['ess-home'],
    queryFn:   () => api.get('/ess/home'),
    staleTime: 2 * 60_000,
  })

  // P0: scroll fade indicator
  const scrollRef = useRef<HTMLElement>(null)
  const showFade  = useScrollFade(scrollRef as React.RefObject<HTMLElement>)

  // P1: width is 260px (was 280px) — saves 20px of content area
  const skeletonAside = (
    <aside className="hidden xl:flex w-[260px] shrink-0 flex-col border-l border-border/50 bg-card">
      <div className="flex flex-col gap-4 p-4 pt-5">
        {[80, 140, 60].map((h, i) => (
          <div key={i} style={{ height: h }} className="animate-pulse rounded-xl bg-muted/40" />
        ))}
      </div>
    </aside>
  )

  if (isLoading) return skeletonAside

  const birthdays      = data?.birthdays         ?? []
  const anniversaries  = data?.anniversaries     ?? []
  const holidays       = data?.upcoming_holidays ?? []
  const recognition    = data?.recognition?.recent ?? []
  const approvalsCnt   = data?.kpis?.pending_approvals ?? 0
  const hasCelebrations = birthdays.length > 0 || anniversaries.length > 0

  return (
    <aside
      ref={scrollRef as React.RefObject<HTMLDivElement>}
      className="relative hidden xl:flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-border/50 bg-card"
    >

      {/* Pending approvals — managers only */}
      {isManager && (
        <div className="border-b border-border/40 px-4 py-5">
          <SectionHead label="Approvals" icon={CheckSquare} action="View all" onAction={() => navigate('/ess/flowdesk')} />
          {approvalsCnt === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nothing waiting on you.</p>
          ) : (
            <button onClick={() => navigate('/ess/flowdesk')}
              className="flex w-full items-center justify-between rounded-xl border border-primary/20 bg-primary/8 px-3 py-2.5 transition-colors hover:bg-primary/12">
              <span className="text-xs font-medium text-foreground">
                {approvalsCnt} item{approvalsCnt !== 1 ? 's' : ''} pending
              </span>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {approvalsCnt > 99 ? '99+' : approvalsCnt}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Birthdays & milestones */}
      {hasCelebrations && (
        <div className="border-b border-border/40 px-4 py-5">
          <SectionHead label="Birthdays & Milestones" icon={Cake} />
          <div className="space-y-3">
            {birthdays.map((b, i) => (
              <div key={`b-${i}`} className="flex items-center gap-2.5">
                <PersonAvatar name={b.name} size="sm" className="shrink-0" decorative />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{b.name}</p>
                  <p className="text-[10px] text-muted-foreground">Birthday · {dayLabel(b.days_until)}</p>
                </div>
                <WishButton employeeId={b.employee_id} name={b.name} kind="birthday" />
              </div>
            ))}
            {anniversaries.map((a, i) => (
              <div key={`a-${i}`} className="flex items-center gap-2.5">
                <PersonAvatar name={a.name} size="sm" className="shrink-0" decorative />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground">{a.years}yr anniversary · {dayLabel(a.days_until)}</p>
                </div>
                <WishButton employeeId={a.employee_id} name={a.name} kind="anniversary" years={a.years} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming holidays */}
      <div className="border-b border-border/40 px-4 py-5">
        <SectionHead label="Upcoming Holidays" icon={CalendarDays} action="All" onAction={() => navigate('/ess/company-holidays')} />
        {holidays.length === 0 ? (
          // P0: removed hardcoded "60 days" — the window is an API detail, not a UI fact
          <p className="text-[11px] text-muted-foreground">No upcoming holidays.</p>
        ) : (
          <div className="space-y-2.5">
            {holidays.slice(0, 4).map((h) => (
              <div key={h.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{h.name}</p>
                  <p className="text-[10px] text-muted-foreground">{dayLabel(h.days_until)}</p>
                </div>
                <span className="shrink-0 rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {fmtDate(h.date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent kudos — P1: hidden entirely when empty; only shown when there's something to show */}
      {recognition.length > 0 && (
        <div className="border-b border-border/40 px-4 py-5">
          <SectionHead label="Recent Kudos" icon={Award} action="All" onAction={() => navigate('/ess/recognition')} />
          <div className="space-y-2">
            {recognition.slice(0, 3).map((r) => (
              <div key={r.id} className="rounded-xl border border-[#15B8A6]/15 bg-[#15B8A6]/5 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  {/* P0: humanise unknown badge codes instead of showing raw snake_case */}
                  <p className="min-w-0 truncate text-[11px] font-semibold text-foreground">
                    {humaniseBadge(r.badge_code ?? '')}
                  </p>
                  {r.points != null && (
                    <span className="shrink-0 text-[10px] font-bold text-[#15B8A6]">+{r.points}pts</span>
                  )}
                </div>
                <p className="truncate text-[10px] text-muted-foreground">from {r.from_name}</p>
                {r.message && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] italic text-foreground/60">"{r.message}"</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* P1: "Recognise a teammate" CTA removed — it was not contextual. The sidebar
          already provides a direct link to /ess/recognition. The Rail is not a
          marketing channel. */}

      {/* P0: bottom scroll fade — tells the user there's more content below */}
      {showFade && (
        <div className="pointer-events-none sticky bottom-0 h-8 w-full bg-gradient-to-t from-card to-transparent" />
      )}

    </aside>
  )
}
