/**
 * Shared exit-interview UI — used by ESS (employee self-fill) and the HR
 * Separation Workflow (fill on behalf / view responses). Plus an analytics card.
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Question {
  id: string
  category: string
  question_text: string
  response_type: 'rating' | 'text' | 'single_choice' | 'boolean'
  options: string[]
  is_required: boolean
  display_order: number
}
interface RespRow { question_id: string; rating: number | null; response_text: string | null; choice: string | null }
interface EIData {
  separation_id: string
  status: string
  overall_comments: string | null
  would_recommend: boolean | null
  submitted: boolean
  submitted_date: string | null
  questions: Question[]
  responses: RespRow[]
}

export const EXIT_CATEGORY_LABEL: Record<string, string> = {
  job_role: 'Role & Responsibilities', manager: 'Manager', culture: 'Culture',
  compensation: 'Compensation', growth: 'Growth & Learning', work_life: 'Work–Life Balance',
  reason: 'Reason for Leaving', other: 'Other',
}

type Answer = { rating?: number; response_text?: string; choice?: string }

export function ExitInterviewForm({ employeeId }: { employeeId: string }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ data: EIData }>({
    queryKey: ['exit-interview', employeeId],
    queryFn: () => api.get(`/employees/${employeeId}/exit-interview`),
    enabled: !!employeeId,
  })
  const ei = data?.data
  const submitted = ei?.status === 'submitted'

  const [ans, setAns] = useState<Record<string, Answer>>({})
  const [overall, setOverall] = useState('')
  const [wouldRec, setWouldRec] = useState<boolean | null>(null)

  useEffect(() => {
    if (!ei) return
    const seed: Record<string, Answer> = {}
    for (const r of ei.responses) {
      seed[r.question_id] = {
        rating: r.rating ?? undefined,
        response_text: r.response_text ?? undefined,
        choice: r.choice ?? undefined,
      }
    }
    setAns(seed)
    setOverall(ei.overall_comments ?? '')
    setWouldRec(ei.would_recommend ?? null)
  }, [ei])

  function payload() {
    return {
      responses: (ei?.questions ?? []).map(q => ({
        question_id: q.id,
        rating: ans[q.id]?.rating ?? null,
        response_text: ans[q.id]?.response_text ?? null,
        choice: ans[q.id]?.choice ?? null,
      })),
      overall_comments: overall || null,
      would_recommend: wouldRec,
    }
  }

  const saveMut = useMutation({
    mutationFn: () => api.post(`/employees/${employeeId}/exit-interview`, payload()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exit-interview', employeeId] }); toast.success('Draft saved') },
    onError: (e: Error) => toast.error('Failed to save', { description: e.message }),
  })
  const submitMut = useMutation({
    mutationFn: () => api.post(`/employees/${employeeId}/exit-interview/submit`, payload()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exit-interview', employeeId] }); toast.success('Exit interview submitted') },
    onError: (e: Error) => toast.error('Could not submit', { description: e.message }),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground py-2">Loading…</p>
  if (!ei) return null

  if (submitted) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
          Exit interview submitted{ei.submitted_date ? ` on ${ei.submitted_date}` : ''}.
        </div>
        {ei.questions.map(q => {
          const r = ei.responses.find(x => x.question_id === q.id)
          const val = q.response_type === 'rating'
            ? (r?.rating ? `${r.rating}/5` : '—')
            : (r?.choice ?? r?.response_text ?? '—')
          return (
            <div key={q.id}>
              <p className="text-xs text-muted-foreground">{q.question_text}</p>
              <p className="text-sm font-medium">{val}</p>
            </div>
          )
        })}
        {ei.would_recommend != null && (
          <div>
            <p className="text-xs text-muted-foreground">Would recommend as a place to work</p>
            <p className="text-sm font-medium">{ei.would_recommend ? 'Yes' : 'No'}</p>
          </div>
        )}
        {ei.overall_comments && (
          <div>
            <p className="text-xs text-muted-foreground">Additional comments</p>
            <p className="text-sm">{ei.overall_comments}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {ei.questions.map(q => (
        <div key={q.id} className="space-y-1.5">
          <p className="text-sm font-medium">
            {q.question_text}{q.is_required && <span className="text-destructive ml-0.5">*</span>}
          </p>
          {q.response_type === 'rating' && (
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button"
                  onClick={() => setAns(p => ({ ...p, [q.id]: { ...p[q.id], rating: n } }))}
                  className={cn('h-8 w-8 rounded-md border text-xs font-semibold transition-colors',
                    ans[q.id]?.rating === n ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted')}>
                  {n}
                </button>
              ))}
              <span className="self-center text-[10px] text-muted-foreground ml-1">1 = poor · 5 = excellent</span>
            </div>
          )}
          {q.response_type === 'single_choice' && (
            <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={ans[q.id]?.choice ?? ''}
              onChange={e => setAns(p => ({ ...p, [q.id]: { ...p[q.id], choice: e.target.value } }))}>
              <option value="">Select…</option>
              {q.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {q.response_type === 'boolean' && (
            <div className="flex gap-2">
              {['Yes', 'No'].map(v => (
                <button key={v} type="button"
                  onClick={() => setAns(p => ({ ...p, [q.id]: { ...p[q.id], choice: v } }))}
                  className={cn('h-8 px-4 rounded-md border text-sm transition-colors',
                    ans[q.id]?.choice === v ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted')}>
                  {v}
                </button>
              ))}
            </div>
          )}
          {q.response_type === 'text' && (
            <textarea rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              value={ans[q.id]?.response_text ?? ''}
              onChange={e => setAns(p => ({ ...p, [q.id]: { ...p[q.id], response_text: e.target.value } }))} />
          )}
        </div>
      ))}

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Would you recommend us as a place to work?</p>
        <div className="flex gap-2">
          {([['Yes', true], ['No', false]] as const).map(([label, val]) => (
            <button key={label} type="button" onClick={() => setWouldRec(val)}
              className={cn('h-8 px-4 rounded-md border text-sm transition-colors',
                wouldRec === val ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Anything else you'd like to share?</p>
        <textarea rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
          value={overall} onChange={e => setOverall(e.target.value)} />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || submitMut.isPending}>
          Save draft
        </Button>
        <Button size="sm" onClick={() => submitMut.mutate()} disabled={saveMut.isPending || submitMut.isPending}>
          {submitMut.isPending ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </div>
  )
}

// ── Analytics card (HR) ────────────────────────────────────────────────────────

interface ExitAnalytics {
  total: number
  would_recommend_pct: number | null
  by_category: { category: string; avg_rating: number; responses: number }[]
  top_reasons: { reason: string; count: number }[]
}

export function ExitAnalyticsCard() {
  const { data } = useQuery<{ data: ExitAnalytics }>({
    queryKey: ['exit-analytics'],
    queryFn: () => api.get('/separations/exit-analytics'),
    staleTime: 60_000,
  })
  const a = data?.data
  if (!a || a.total === 0) {
    return <p className="text-xs text-muted-foreground">No submitted exit interviews yet.</p>
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Completed</p>
          <p className="text-xl font-bold tabular-nums">{a.total}</p>
        </div>
        {a.would_recommend_pct != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Would recommend</p>
            <p className="text-xl font-bold tabular-nums text-success">{a.would_recommend_pct}%</p>
          </div>
        )}
      </div>

      {a.by_category.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Average rating by area</p>
          <div className="space-y-1.5">
            {a.by_category.map(c => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-xs text-muted-foreground">{EXIT_CATEGORY_LABEL[c.category] ?? c.category}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn('h-full rounded-full', c.avg_rating >= 3.5 ? 'bg-success' : c.avg_rating >= 2.5 ? 'bg-warning' : 'bg-destructive')}
                    style={{ width: `${(c.avg_rating / 5) * 100}%` }} />
                </div>
                <span className="w-10 text-right text-xs font-medium tabular-nums">{c.avg_rating}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {a.top_reasons.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Top reasons for leaving</p>
          <div className="flex flex-wrap gap-1.5">
            {a.top_reasons.map(r => (
              <span key={r.reason} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                {r.reason} <span className="text-muted-foreground">· {r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
