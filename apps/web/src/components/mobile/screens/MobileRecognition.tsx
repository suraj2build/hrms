import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Trophy, Gift, X, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { glossy } from '../glossy'

interface Badge { code: string; label: string; icon: string; description: string; points: number }
interface FeedItem { id: string; from_name?: string; to_name?: string; badge_code?: string; message: string; points: number; created_at: string }
interface MeSummary { received: number; given: number; points: number; recent: FeedItem[] }
interface LeaderRow { rank: number; employee_id: string; name: string; points: number; count: number }

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles,
}
const badgeIcon = (name?: string) => (name && ICONS[name]) || Award

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const s = Math.floor((Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function MobileRecognition({ base: _base }: { base: string }) {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data: meData } = useQuery<{ data: MeSummary }>({
    queryKey: ['mobile-recognition-me'], queryFn: () => api.get('/recognition/me'),
  })
  const { data: leaderData } = useQuery<{ data: LeaderRow[] }>({
    queryKey: ['mobile-recognition-leaderboard'], queryFn: () => api.get('/recognition/leaderboard'),
  })
  const { data: feedData, isLoading: feedLoading } = useQuery<{ data: FeedItem[] }>({
    queryKey: ['mobile-recognition-feed'], queryFn: () => api.get('/recognition/feed?limit=30'),
  })

  const me = meData?.data
  const leaders = (leaderData?.data ?? []).slice(0, 5)
  const feed = feedData?.data ?? []

  return (
    <div className="space-y-4">
      <p className="px-1 text-lg font-extrabold tracking-tight text-[#0F172A]">Recognition</p>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { v: me?.received ?? 0, l: 'Received', tint: '#15B8A6' },
          { v: me?.given ?? 0, l: 'Given', tint: '#2E6FE6' },
          { v: me?.points ?? 0, l: 'Points', tint: '#7C3AED' },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl bg-white p-3 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <p className="text-xl font-extrabold text-[#0F172A]">{s.v}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.tint }} />{s.l}
            </p>
          </div>
        ))}
      </div>

      {/* Give recognition */}
      <button
        onClick={() => setSheetOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white active:scale-[0.99] transition-transform"
        style={glossy('#2E6FE6', '#15B8A6')}
      >
        <Gift className="h-4 w-4" /> Give recognition
      </button>

      {/* Leaderboard */}
      {leaders.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold text-[#0F172A]">
            <Trophy className="h-3.5 w-3.5 text-[#B07B18]" /> Top recognized
          </p>
          <div className="space-y-2">
            {leaders.map((r) => (
              <div key={r.employee_id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold ${r.rank === 1 ? 'text-white' : 'text-[#1A4D8F] bg-[#2E6FE6]/10'}`}
                  style={r.rank === 1 ? glossy('#B07B18', '#D9A441') : undefined}>
                  {r.rank === 1 ? <Trophy className="h-3.5 w-3.5" /> : r.rank}
                </span>
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{r.name}</p>
                <span className="shrink-0 text-xs font-bold text-[#7C3AED]">{r.points} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feed */}
      <div>
        <p className="mb-2 px-1 text-xs font-bold text-[#0F172A]">Recent recognition</p>
        {feedLoading && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">Loading…</p>}
        {!feedLoading && feed.length === 0 && (
          <div className="rounded-2xl bg-white px-4 py-6 text-center shadow-sm">
            <span className="grid h-12 w-12 mx-auto place-items-center rounded-2xl text-white" style={glossy('#2E6FE6', '#15B8A6')}><Gift className="h-5 w-5" /></span>
            <p className="mt-2 text-sm font-semibold text-foreground">No recognition yet</p>
            <p className="text-[11px] text-muted-foreground">Be the first to appreciate a colleague.</p>
            <button onClick={() => setSheetOpen(true)} className="mt-3 rounded-lg px-4 py-2 text-xs font-bold text-white" style={glossy('#2E6FE6', '#15B8A6')}>Give the first one</button>
          </div>
        )}
        <div className="space-y-2">
          {feed.map((f) => {
            const Icon = badgeIcon(f.badge_code ? ICON_BY_BADGE[f.badge_code] : undefined)
            return (
              <div key={f.id} className="flex gap-3 rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={glossy('#7C3AED', '#A78BFA')}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">
                    <span className="font-bold">{f.from_name ?? 'Someone'}</span> recognized <span className="font-bold">{f.to_name ?? 'a colleague'}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-foreground/80">{f.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{timeAgo(f.created_at)}{f.points ? ` · +${f.points} pts` : ''}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {sheetOpen && <GiveSheet onClose={() => setSheetOpen(false)} onDone={() => {
        qc.invalidateQueries({ queryKey: ['mobile-recognition-feed'] })
        qc.invalidateQueries({ queryKey: ['mobile-recognition-me'] })
        qc.invalidateQueries({ queryKey: ['mobile-recognition-leaderboard'] })
      }} />}
    </div>
  )
}

// Feed items carry badge_code; map code → lucide icon name via the badge catalogue.
const ICON_BY_BADGE: Record<string, string> = {
  ownership_champion: 'Award', customer_hero: 'Heart', team_player: 'Users',
  innovator: 'Lightbulb', problem_solver: 'Wrench', culture_ambassador: 'Sparkles',
}

function GiveSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [toEmployee, setToEmployee] = useState('')
  const [badgeCode, setBadgeCode] = useState('')
  const [message, setMessage] = useState('')

  const { data: badgeData } = useQuery<{ data: Badge[] }>({
    queryKey: ['mobile-recognition-badges'], queryFn: () => api.get('/recognition/badges'),
  })
  const badges = badgeData?.data ?? []

  const give = useMutation({
    mutationFn: () => api.post('/recognition', { to_employee: toEmployee, badge_code: badgeCode || undefined, message: message.trim() }),
    onSuccess: () => { toast.success('Recognition sent 🎉'); onDone(); onClose() },
    onError: (e: Error) => toast.error('Could not send', { description: e.message }),
  })
  const canSubmit = !!toEmployee && message.trim().length > 0 && !give.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-t-3xl bg-[#EEF3FF] p-4 pb-6" onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15" />
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-[#0F172A]">Give recognition</p>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Colleague</p>
            <EmployeeSelector value={toEmployee} onChange={(v) => setToEmployee(Array.isArray(v) ? v[0] ?? '' : v)} placeholder="Search by name or code…" />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Badge (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              {badges.map((b) => {
                const Icon = badgeIcon(b.icon)
                const active = badgeCode === b.code
                return (
                  <button key={b.code} onClick={() => setBadgeCode(active ? '' : b.code)}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors ${active ? 'border-[#2E6FE6] bg-[#2E6FE6]/[0.06]' : 'border-transparent bg-white'}`}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white" style={glossy('#7C3AED', '#A78BFA')}><Icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-foreground">{b.label}</span>
                      <span className="block text-[9px] text-muted-foreground">+{b.points} pts</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Message</p>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500}
              placeholder="What did they do brilliantly?"
              className="w-full resize-none rounded-xl border border-border bg-white p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#2E6FE6] focus:outline-none" />
          </div>

          <button disabled={!canSubmit} onClick={() => give.mutate()}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
            style={glossy('#2E6FE6', '#15B8A6')}>
            <Send className="h-4 w-4" /> {give.isPending ? 'Sending…' : 'Send recognition'}
          </button>
        </div>
      </div>
    </div>
  )
}
