import { useState }                         from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare }                    from 'lucide-react'
import { toast }                            from 'sonner'
import { api }                              from '@/lib/api/client'

const MOODS = [
  { score: 1, emoji: '😔', label: 'Rough day' },
  { score: 2, emoji: '😕', label: 'Not great' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' },
  { score: 5, emoji: '😄', label: 'Great day!' },
]

interface TodayPayload {
  checkin: { mood: number; note: string | null; checkin_date: string } | null
  pulse:   { id: string; question: string; options: string[] | null; responded: boolean } | null
}

export function MoodCheckinWidget() {
  const qc       = useQueryClient()
  const [hover, setHover]         = useState<number | null>(null)
  const [pulseInput, setPulseInput] = useState('')

  const { data, isLoading } = useQuery<TodayPayload>({
    queryKey: ['mood-today'],
    queryFn:  () => api.get<{ data: TodayPayload }>('/mood/today').then(r => r.data),
    staleTime: 60_000,
  })

  const checkinMut = useMutation({
    mutationFn: (mood: number) => api.post('/mood/checkin', { mood }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['mood-today'] }),
    onError:    () => toast.error('Could not save your mood'),
  })

  const pulseMut = useMutation({
    mutationFn: ({ questionId, response }: { questionId: string; response: string }) =>
      api.post(`/mood/pulse/${questionId}/respond`, { response }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood-today'] })
      setPulseInput('')
    },
    onError: () => toast.error('Could not save response'),
  })

  // Don't flash a skeleton in the home page right column — just render nothing while loading
  if (isLoading) return null

  const checkin = data?.checkin
  const pulse   = data?.pulse

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">

      {/* Mood check-in */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">
          How are you today?
        </p>

        {checkin ? (
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{MOODS[checkin.mood - 1]?.emoji}</span>
            <div>
              <p className="text-sm font-medium text-foreground">{MOODS[checkin.mood - 1]?.label}</p>
              <p className="text-[11px] text-muted-foreground">Checked in today</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {MOODS.map(m => (
              <button
                key={m.score}
                disabled={checkinMut.isPending}
                onClick={() => checkinMut.mutate(m.score)}
                onMouseEnter={() => setHover(m.score)}
                onMouseLeave={() => setHover(null)}
                title={m.label}
                className="flex flex-col items-center rounded-lg px-2 py-1.5 transition-all hover:bg-muted disabled:opacity-50"
              >
                <span
                  className="text-xl transition-transform duration-100"
                  style={{ transform: hover === m.score ? 'scale(1.3)' : 'scale(1)' }}
                >
                  {m.emoji}
                </span>
              </button>
            ))}
            {hover && (
              <span className="ml-1 text-xs text-muted-foreground whitespace-nowrap">
                {MOODS.find(m => m.score === hover)?.label}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pulse question (unanswered) */}
      {pulse && !pulse.responded && (
        <div className="border-t border-border/40 pt-4">
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare className="h-3 w-3 text-primary" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Pulse
            </p>
          </div>
          <p className="text-sm font-medium text-foreground mb-3">{pulse.question}</p>

          {pulse.options ? (
            <div className="flex flex-wrap gap-2">
              {pulse.options.map(opt => (
                <button
                  key={opt}
                  disabled={pulseMut.isPending}
                  onClick={() => pulseMut.mutate({ questionId: pulse.id, response: opt })}
                  className="rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary disabled:opacity-50"
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={pulseInput}
                onChange={e => setPulseInput(e.target.value)}
                placeholder="Your thoughts…"
                className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                onKeyDown={e => {
                  if (e.key === 'Enter' && pulseInput.trim()) {
                    pulseMut.mutate({ questionId: pulse.id, response: pulseInput.trim() })
                  }
                }}
              />
              <button
                disabled={!pulseInput.trim() || pulseMut.isPending}
                onClick={() => pulseMut.mutate({ questionId: pulse.id, response: pulseInput.trim() })}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pulse answered */}
      {pulse?.responded && (
        <div className="border-t border-border/40 pt-3">
          <p className="text-[11px] text-muted-foreground">Pulse response recorded — thank you!</p>
        </div>
      )}
    </div>
  )
}
