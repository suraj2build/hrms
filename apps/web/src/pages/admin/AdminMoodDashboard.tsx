import { useState }                             from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  SmilePlus, MessageSquare, BarChart2,
  Plus, Check, X, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast }              from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button }             from '@/components/ui/button'
import { api }                from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

const MOOD_CONFIG = [
  { score: 1, emoji: '😔', label: 'Rough',     color: '#ef4444' },
  { score: 2, emoji: '😕', label: 'Not great', color: '#f97316' },
  { score: 3, emoji: '😐', label: 'Okay',      color: '#eab308' },
  { score: 4, emoji: '😊', label: 'Good',      color: '#22c55e' },
  { score: 5, emoji: '😄', label: 'Great',     color: '#15B8A6' },
]

interface TrendPoint {
  date:  string
  avg:   number | null
  count: number
}

interface DashboardData {
  trend:              TrendPoint[]
  distribution:       Record<string, number>
  total_checkins_7d:  number
  active_pulse:       { id: string; question: string; options: string[] | null; status: string; response_count: number; created_at: string }[]
}

interface PulseQuestion {
  id:         string
  question:   string
  options:    string[] | null
  status:     'draft' | 'active' | 'closed'
  created_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    draft:  'bg-muted text-muted-foreground',
    active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    closed: 'bg-destructive/10 text-destructive',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls[status] ?? cls.draft}`}>
      {status}
    </span>
  )
}

function shortDate(d: string) {
  const [, month, day] = d.split('-')
  return `${parseInt(day)}/${parseInt(month)}`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminMoodDashboard() {
  const qc = useQueryClient()

  const [createOpen, setCreateOpen]   = useState(false)
  const [newQuestion, setNewQuestion] = useState('')
  const [newOptions, setNewOptions]   = useState('')
  const [optionType, setOptionType]   = useState<'choices' | 'freetext'>('choices')
  const [expandedQ, setExpandedQ]     = useState<string | null>(null)

  const { data: dashData, isLoading } = useQuery<DashboardData>({
    queryKey: ['mood-admin-dashboard'],
    queryFn:  () => api.get<{ data: DashboardData }>('/mood/admin/dashboard').then(r => r.data),
    staleTime: 2 * 60_000,
  })

  const { data: allQuestions } = useQuery<PulseQuestion[]>({
    queryKey: ['mood-admin-pulse'],
    queryFn:  () => api.get<{ data: PulseQuestion[] }>('/mood/admin/pulse').then(r => r.data),
    staleTime: 60_000,
  })

  const { data: responsesData, isLoading: responsesLoading } = useQuery<{ response: string; created_at: string }[]>({
    queryKey: ['mood-pulse-responses', expandedQ],
    queryFn:  () => api.get<{ data: { response: string; created_at: string }[] }>(`/mood/admin/pulse/${expandedQ}/responses`).then(r => r.data),
    enabled:  !!expandedQ,
    staleTime: 30_000,
  })

  const createMut = useMutation({
    mutationFn: (body: { question: string; options: string[] | null }) =>
      api.post('/mood/admin/pulse', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood-admin-pulse'] })
      qc.invalidateQueries({ queryKey: ['mood-admin-dashboard'] })
      setCreateOpen(false)
      setNewQuestion('')
      setNewOptions('')
      toast.success('Pulse question created (draft)')
    },
    onError: () => toast.error('Could not create question'),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/mood/admin/pulse/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood-admin-pulse'] })
      qc.invalidateQueries({ queryKey: ['mood-admin-dashboard'] })
    },
    onError: () => toast.error('Could not update question'),
  })

  const dash      = dashData
  const questions = allQuestions ?? []

  const avg7d = (() => {
    if (!dash?.trend) return null
    const valid = dash.trend.filter(t => t.avg !== null)
    if (!valid.length) return null
    return Math.round(valid.reduce((s, t) => s + (t.avg ?? 0), 0) / valid.length * 10) / 10
  })()

  function handleCreate() {
    if (!newQuestion.trim()) return
    const opts = optionType === 'choices'
      ? newOptions.split('\n').map(s => s.trim()).filter(Boolean)
      : null
    createMut.mutate({
      question: newQuestion.trim(),
      options:  opts?.length ? opts : null,
    })
  }

  const maxDist = Math.max(...MOOD_CONFIG.map(m => Number(dash?.distribution[m.score] ?? 0)), 1)

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Mood & Pulse</h1>
          <p className="mt-1 text-sm text-muted-foreground">Employee sentiment, check-ins and pulse questions</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Pulse Question
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Check-ins (7d)',           value: dash?.total_checkins_7d ?? '—', icon: SmilePlus },
          { label: 'Avg Mood (7d)',             value: avg7d !== null ? `${avg7d} / 5` : '—', icon: BarChart2 },
          { label: 'Active Pulse Questions',    value: dash?.active_pulse?.length ?? 0,  icon: MessageSquare },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <s.icon className="h-4 w-4" />
              <span className="text-xs font-medium">{s.label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      {/* 7-day trend */}
      <div className="rounded-2xl border border-border/60 bg-card p-6">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          7-Day Mood Trend
        </p>
        {!isLoading && dash?.trend ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dash.trend} barSize={30} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis domain={[0, 5]} hide />
              <Tooltip
                formatter={(v: number) => [v !== null ? `${v}` : '—', 'Avg Mood']}
                labelFormatter={shortDate}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {dash.trend.map((entry, i) => (
                  <Cell key={i} fill={entry.avg === null ? '#e5e7eb' : '#15B8A6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
        )}
      </div>

      {/* Mood distribution */}
      <div className="rounded-2xl border border-border/60 bg-card p-6">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Mood Distribution — Last 7 Days
        </p>
        <div className="flex items-end gap-4">
          {MOOD_CONFIG.map(m => {
            const count = Number(dash?.distribution[m.score] ?? 0)
            const pct   = Math.round((count / maxDist) * 100)
            return (
              <div key={m.score} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-foreground">{count}</span>
                <div className="flex w-full flex-col justify-end" style={{ height: 80 }}>
                  <div
                    className="w-full rounded-t-md transition-all duration-500"
                    style={{
                      height:    `${pct}%`,
                      minHeight: count > 0 ? 4 : 0,
                      background: m.color,
                    }}
                  />
                </div>
                <span className="text-xl">{m.emoji}</span>
                <span className="text-center text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pulse questions */}
      <div className="rounded-2xl border border-border/60 bg-card p-6">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Pulse Questions
        </p>

        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pulse questions yet. Create one to start collecting feedback.
          </p>
        ) : (
          <div className="space-y-2">
            {questions.map(q => (
              <div key={q.id} className="rounded-xl border border-border/40 bg-muted/30">
                {/* Question row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{q.question}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {q.options
                        ? `Choices: ${(q.options as string[]).join(' · ')}`
                        : 'Free text'}
                    </p>
                  </div>

                  <StatusBadge status={q.status} />

                  <div className="flex items-center gap-1.5">
                    {q.status === 'draft' && (
                      <button
                        onClick={() => patchMut.mutate({ id: q.id, status: 'active' })}
                        disabled={patchMut.isPending}
                        className="flex items-center gap-1 rounded-lg bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" /> Activate
                      </button>
                    )}
                    {q.status === 'active' && (
                      <button
                        onClick={() => patchMut.mutate({ id: q.id, status: 'closed' })}
                        disabled={patchMut.isPending}
                        className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" /> Close
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors"
                      title="View responses"
                    >
                      {expandedQ === q.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Responses panel */}
                {expandedQ === q.id && (
                  <div className="border-t border-border/40 px-4 pb-4 pt-3">
                    {responsesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading responses…</p>
                    ) : !responsesData?.length ? (
                      <p className="text-xs text-muted-foreground">No responses yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {responsesData.map((r, i) => (
                          <div key={i} className="rounded-lg bg-background px-3 py-2">
                            <p className="text-sm text-foreground">"{r.response}"</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {new Date(r.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Pulse Question</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Question</label>
              <textarea
                value={newQuestion}
                onChange={e => setNewQuestion(e.target.value)}
                placeholder="e.g. How would you rate team collaboration this week?"
                rows={2}
                className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Answer type</label>
              <div className="flex gap-2">
                {(['choices', 'freetext'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setOptionType(t)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      optionType === t
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/60 text-foreground hover:bg-muted'
                    }`}
                  >
                    {t === 'choices' ? 'Multiple choice' : 'Free text'}
                  </button>
                ))}
              </div>
            </div>

            {optionType === 'choices' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Options <span className="text-muted-foreground">(one per line)</span>
                </label>
                <textarea
                  value={newOptions}
                  onChange={e => setNewOptions(e.target.value)}
                  placeholder={"Strongly agree\nAgree\nNeutral\nDisagree"}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newQuestion.trim() || createMut.isPending}
            >
              Create (Draft)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
