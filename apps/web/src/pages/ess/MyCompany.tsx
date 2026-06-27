/**
 * MyCompany — the My Company experience (People-FAR lens): "What's our shared
 * world — and where do I belong?"
 *
 * The belonging surface of the Employee OS. It reconciles the two existing
 * "what's happening across the company" streams — the community feed and the
 * public recognition stream — into ONE warm lens: faces over charts, moments
 * over metrics. It is NEVER a social network, an announcement board, a
 * dashboard, or an inbox (frozen boundary). No Need (action lives in My
 * Attention), no Progress (no company score). A quiet company day is SHORT and
 * warm, never padded, never a "be first to post" nag (silence-as-calm).
 *
 * Read-only over /ess/company, from shared experience primitives. The one-tap
 * Wish writes through the existing /community/wish module of record. Desktop +
 * mobile.
 */

import { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Award } from 'lucide-react'
import { api } from '@/lib/api/client'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
import { CelebrationCard } from '@/components/experience/CelebrationCard'
import { ActivityItem } from '@/components/experience/ActivityItem'
import { TimeGroup } from '@/components/experience/TimeGroup'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { PillarHero } from '@/components/experience/PillarHero'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

interface Celebrating { id: string; name: string; kind: 'birthday' | 'anniversary' | 'joined'; years?: number }
interface Recognition { id: string; title: string; person: string }
interface HappeningEvent { id: string; type: 'announcement' | 'lifecycle'; title: string; body?: string; at: string }
interface HappeningGroup { key: string; label: string; events: HappeningEvent[] }
interface CompanyPayload {
  focus:       { sentence: string }
  celebrating: Celebrating[]
  recognition: Recognition[]
  happening:   HappeningGroup[]
  reflection:  { insight: string | null }
}

export function MyCompany() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'
  const qc = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery<CompanyPayload>({
    queryKey: ['ess-company'], queryFn: () => api.get('/ess/company'), staleTime: 2 * 60_000,
  })

  // One-tap Wish — writes through the existing /community module of record.
  const [wished, setWished] = useState<Record<string, boolean>>({})
  const wish = useMutation({
    mutationFn: (c: Celebrating) =>
      api.post('/community/wish', {
        subject_employee_id: c.id,
        kind: c.kind === 'anniversary' ? 'anniversary' : 'birthday',
        message: c.kind === 'anniversary'
          ? `Congratulations on ${c.years ? `${c.years} years` : 'your work anniversary'} with us! 🎉`
          : `Happy birthday, ${c.name}! 🎂 Wishing you a wonderful year ahead.`,
      }),
    onSuccess: (_d, c) => {
      setWished(w => ({ ...w, [c.id]: true }))
      void qc.invalidateQueries({ queryKey: ['ess-company'] })
    },
  })

  if (isLoading) return (
    <>
      <PillarHero sky="sky-midday" eyebrow="belonging" title="My Company" />
      <div className="mx-auto max-w-[760px] py-8"><LoadingState rows={4} label="Looking across the company…" /></div>
    </>
  )
  if (isError) return <ErrorState title="Couldn't load your company" onRetry={() => refetch()} />

  const c = data!
  const hasCelebrating = c.celebrating.length > 0
  const hasRecognition = c.recognition.length > 0
  const hasHappening   = c.happening.some(g => g.events.length > 0)
  const empty = !hasCelebrating && !hasRecognition && !hasHappening

  const celebKind = (k: Celebrating['kind']): 'birthday' | 'anniversary' | 'milestone' =>
    k === 'birthday' ? 'birthday' : k === 'anniversary' ? 'anniversary' : 'milestone'
  const celebTitle = (p: Celebrating): string =>
    p.kind === 'birthday'    ? `It's ${p.name}'s birthday`
    : p.kind === 'anniversary' ? `${p.name} — ${p.years ?? ''}-year work anniversary`
    : `${p.name} joined us`
  const celebSubtitle = (p: Celebrating): string | undefined =>
    p.kind === 'joined' ? 'Welcome them to the company' : undefined

  return (
    <>
      <PillarHero sky="sky-midday" eyebrow="belonging" title="My Company" tagline={c.focus.sentence} />

    <div className="mx-auto max-w-[760px] space-y-8 py-8">
      <div className="flex">
        <button
          onClick={() => navigate(`${base}/community`)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          Share something →
        </button>
      </div>

      {/* A quiet company day is SHORT and warm — never padded. */}
      {empty && (
        <p className="py-14 text-center text-sm text-muted-foreground">
          A quiet day across the company. The celebrations, welcomes and shared moments will appear here.
        </p>
      )}

      {/* Celebrating today — faces, with a one-tap Wish (expression, not a task). */}
      {hasCelebrating && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Celebrating today</p>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="space-y-3">
              {c.celebrating.map(p => {
                const canWish = (p.kind === 'birthday' || p.kind === 'anniversary') && !wished[p.id]
                return (
                  <CelebrationCard
                    key={p.id}
                    kind={celebKind(p.kind)}
                    title={celebTitle(p)}
                    subtitle={celebSubtitle(p)}
                    action={canWish ? { label: wish.isPending ? 'Wishing...' : 'Wish', onClick: () => wish.mutate(p) } : undefined}
                  />
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* Worth celebrating — broad public recognition, as people lines (faces). */}
      {hasRecognition && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Worth celebrating</p>
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            {c.recognition.map(r => (
              <div key={r.id} className="flex items-center gap-3 border-b border-border/50 py-3 last:border-0">
                <PersonAvatar name={r.person} size="sm" />
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  <Award className="h-4 w-4 shrink-0 text-warning" /> {r.title}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Happening — the company feed, told as a time-grouped narrative (Story). */}
      {hasHappening && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Happening</p>
          <div className="rounded-2xl border border-border/40 bg-card/50 p-5">
            <div className="space-y-6">
              {c.happening.filter(g => g.events.length > 0).map(g => (
                <TimeGroup key={g.key} label={g.label}>
                  {g.events.map(ev => (
                    <ActivityItem
                      key={ev.id}
                      event={{ id: ev.id, type: ev.type, title: ev.title, body: ev.body, at: ev.at }}
                    />
                  ))}
                </TimeGroup>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Reflection — one belonging-aware line, or absent (insight === null). */}
      <ReflectionCard insight={c.reflection.insight} />

      {/* Closure — a light, warm finish; omitted on a quiet day (silence-as-calm). */}
      {!empty && <DoneForToday>A good place to be part of.</DoneForToday>}
    </div>
    </>
  )
}
