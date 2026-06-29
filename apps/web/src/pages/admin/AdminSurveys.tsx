import { useState }                             from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate }                           from 'react-router-dom'
import { Plus, ClipboardList, ChevronRight, Users2 } from 'lucide-react'
import { toast }                                 from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button }                                from '@/components/ui/button'
import { api }                                   from '@/lib/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Survey {
  id:               string
  title:            string
  description:      string | null
  status:           'draft' | 'active' | 'closed'
  due_date:         string | null
  created_at:       string
  total_assigned:   number
  total_completed:  number
}

type QType = 'text' | 'rating' | 'single' | 'multi'

interface DraftQuestion {
  question_text: string
  question_type: QType
  options:       string
  required:      boolean
  order_idx:     number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const BLANK_Q: DraftQuestion = {
  question_text: '',
  question_type: 'text',
  options:       '',
  required:      true,
  order_idx:     0,
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminSurveys() {
  const qc       = useQueryClient()
  const navigate = useNavigate()

  const [open, setOpen]       = useState(false)
  const [title, setTitle]     = useState('')
  const [desc, setDesc]       = useState('')
  const [dueDate, setDueDate] = useState('')
  const [qs, setQs]           = useState<DraftQuestion[]>([{ ...BLANK_Q }])

  const { data, isLoading } = useQuery<Survey[]>({
    queryKey:  ['admin-surveys'],
    queryFn:   () => api.get<{ data: Survey[] }>('/surveys/admin').then(r => r.data),
    staleTime: 60_000,
  })

  const createMut = useMutation({
    mutationFn: () => {
      const questions = qs
        .filter(q => q.question_text.trim())
        .map((q, i) => ({
          question_text: q.question_text.trim(),
          question_type: q.question_type,
          options: (q.question_type === 'single' || q.question_type === 'multi')
            ? q.options.split('\n').map(s => s.trim()).filter(Boolean)
            : null,
          required:  q.required,
          order_idx: i,
        }))
      return api.post('/surveys/admin', {
        title:       title.trim(),
        description: desc.trim() || null,
        due_date:    dueDate || null,
        questions,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-surveys'] })
      setOpen(false)
      resetForm()
      toast.success('Survey created (draft)')
    },
    onError: () => toast.error('Could not create survey'),
  })

  function resetForm() {
    setTitle('')
    setDesc('')
    setDueDate('')
    setQs([{ ...BLANK_Q }])
  }

  function addQ() {
    setQs(prev => [...prev, { ...BLANK_Q, order_idx: prev.length }])
  }

  function removeQ(i: number) {
    setQs(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateQ(i: number, patch: Partial<DraftQuestion>) {
    setQs(prev => prev.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  }

  const surveys = data ?? []

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Surveys</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create and manage employee surveys</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Survey
        </Button>
      </div>

      {/* Survey list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted/40" />)}
        </div>
      ) : surveys.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-card py-16 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No surveys yet. Create your first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {surveys.map(s => {
            const pct = s.total_assigned
              ? Math.round(s.total_completed / s.total_assigned * 100)
              : 0
            return (
              <div
                key={s.id}
                role="button"
                onClick={() => navigate(`/admin/surveys/${s.id}`)}
                className="flex cursor-pointer items-center gap-4 rounded-2xl border border-border/60 bg-card px-5 py-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    <StatusBadge status={s.status} />
                  </div>
                  {s.description && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{s.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Users2 className="h-3 w-3" />
                      {s.total_assigned} assigned · {s.total_completed} completed
                    </span>
                    {s.total_assigned > 0 && (
                      <span className="text-[11px] text-muted-foreground">{pct}% response rate</span>
                    )}
                    {s.due_date && (
                      <span className="text-[11px] text-muted-foreground">
                        Due {new Date(s.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Survey</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Q3 Employee Engagement Survey"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                rows={2}
                placeholder="Brief context for employees…"
                className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* Due date */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Due date <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* Questions */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Questions</label>
                <button onClick={addQ} className="text-xs text-primary hover:underline">+ Add question</button>
              </div>

              <div className="space-y-4">
                {qs.map((q, i) => (
                  <div key={i} className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Q{i + 1}</span>
                      {qs.length > 1 && (
                        <button onClick={() => removeQ(i)} className="text-xs text-destructive hover:underline">Remove</button>
                      )}
                    </div>

                    <input
                      type="text"
                      value={q.question_text}
                      onChange={e => updateQ(i, { question_text: e.target.value })}
                      placeholder="Question text…"
                      className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />

                    <div className="flex flex-wrap gap-2">
                      {(['text', 'rating', 'single', 'multi'] as QType[]).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => updateQ(i, { question_type: t })}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            q.question_type === t
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border/60 text-foreground hover:bg-muted'
                          }`}
                        >
                          {t === 'text' ? 'Free text' : t === 'rating' ? 'Rating (1-5)' : t === 'single' ? 'Single choice' : 'Multi choice'}
                        </button>
                      ))}
                    </div>

                    {(q.question_type === 'single' || q.question_type === 'multi') && (
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Options (one per line)</label>
                        <textarea
                          value={q.options}
                          onChange={e => updateQ(i, { options: e.target.value })}
                          rows={3}
                          placeholder={"Option A\nOption B\nOption C"}
                          className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={e => updateQ(i, { required: e.target.checked })}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      Required
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!title.trim() || qs.every(q => !q.question_text.trim()) || createMut.isPending}
            >
              Create Survey (Draft)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
