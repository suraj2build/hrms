import { useState }                             from 'react'
import { useParams, useNavigate }               from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Users2, Check, X, BarChart2,
  ClipboardList, UserCheck, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast }   from 'sonner'
import { Button }  from '@/components/ui/button'
import { api }     from '@/lib/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Question {
  id:            string
  order_idx:     number
  question_text: string
  question_type: 'text' | 'rating' | 'single' | 'multi'
  options:       string[] | null
  required:      boolean
}

interface Assignment {
  id:           string
  assigned_at:  string
  completed_at: string | null
  employee: { id: string; first_name: string; last_name: string; employee_code: string }
}

interface SurveyDetail {
  id:          string
  title:       string
  description: string | null
  status:      'draft' | 'active' | 'closed'
  due_date:    string | null
  created_at:  string
  questions:   Question[]
  assignments: Assignment[]
}

interface QuestionResult {
  id:             string
  question_text:  string
  question_type:  string
  options:        string[] | null
  response_count: number
  summary: {
    // rating
    avg?: number | null
    count?: number
    distribution?: { score: number; count: number }[]
    // single/multi
    counts?: Record<string, number>
    total?: number
    // text
    answers?: string[]
  }
}

interface ResultsData {
  total_assigned:  number
  total_completed: number
  completion_rate: number
  questions:       QuestionResult[]
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

// ── Result renderers ──────────────────────────────────────────────────────────

function RatingResult({ q }: { q: QuestionResult }) {
  const dist = q.summary.distribution ?? []
  const max  = Math.max(...dist.map(d => d.count), 1)
  return (
    <div>
      <p className="mb-3 text-2xl font-bold text-foreground">
        {q.summary.avg !== null && q.summary.avg !== undefined
          ? `${q.summary.avg} / 5`
          : '—'}
        <span className="ml-2 text-sm font-normal text-muted-foreground">avg from {q.response_count} responses</span>
      </p>
      <div className="flex items-end gap-3">
        {dist.map(d => (
          <div key={d.score} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-medium text-foreground">{d.count}</span>
            <div className="flex w-full flex-col justify-end" style={{ height: 60 }}>
              <div
                className="w-full rounded-t-md bg-primary transition-all"
                style={{ height: max > 0 ? `${Math.round(d.count / max * 100)}%` : '0%', minHeight: d.count > 0 ? 4 : 0 }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">{d.score}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChoiceResult({ q }: { q: QuestionResult }) {
  const counts = q.summary.counts ?? {}
  const total  = q.summary.total ?? 0
  const all    = q.options ?? Object.keys(counts)
  const max    = Math.max(...Object.values(counts), 1)
  return (
    <div className="space-y-2">
      {all.map(opt => {
        const n = counts[opt] ?? 0
        const pct = total > 0 ? Math.round(n / total * 100) : 0
        return (
          <div key={opt} className="space-y-1">
            <div className="flex justify-between text-xs text-foreground">
              <span>{opt}</span>
              <span className="text-muted-foreground">{n} ({pct}%)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(n / max * 100)}%` }}
              />
            </div>
          </div>
        )
      })}
      <p className="text-[11px] text-muted-foreground">{total} total selections from {q.response_count} responses</p>
    </div>
  )
}

function TextResult({ q }: { q: QuestionResult }) {
  const [expanded, setExpanded] = useState(false)
  const answers = q.summary.answers ?? []
  const shown   = expanded ? answers : answers.slice(0, 3)
  if (!answers.length) return <p className="text-xs text-muted-foreground">No responses yet.</p>
  return (
    <div className="space-y-1.5">
      {shown.map((a, i) => (
        <div key={i} className="rounded-lg bg-background px-3 py-2 text-sm text-foreground">"{a}"</div>
      ))}
      {answers.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show all {answers.length}</>}
        </button>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'assignments' | 'results'

export function AdminSurveyDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const [tab, setTab] = useState<Tab>('overview')

  const { data: survey, isLoading } = useQuery<SurveyDetail>({
    queryKey:  ['admin-survey', id],
    queryFn:   () => api.get<{ data: SurveyDetail }>(`/surveys/admin/${id}`).then(r => r.data),
    enabled:   !!id,
    staleTime: 30_000,
  })

  const { data: results, isLoading: resultsLoading } = useQuery<ResultsData>({
    queryKey:  ['admin-survey-results', id],
    queryFn:   () => api.get<{ data: ResultsData }>(`/surveys/admin/${id}/results`).then(r => r.data),
    enabled:   !!id && tab === 'results',
    staleTime: 30_000,
  })

  const patchMut = useMutation({
    mutationFn: (status: string) => api.patch(`/surveys/admin/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-survey', id] })
      qc.invalidateQueries({ queryKey: ['admin-surveys'] })
    },
    onError: () => toast.error('Could not update survey'),
  })

  const assignMut = useMutation({
    mutationFn: () => api.post(`/surveys/admin/${id}/assign`, { assign_all: true }),
    onSuccess: (_, __, ___) => {
      qc.invalidateQueries({ queryKey: ['admin-survey', id] })
      toast.success('Survey assigned to all active employees')
    },
    onError: () => toast.error('Could not assign survey'),
  })

  if (isLoading || !survey) {
    return (
      <div className="p-6 space-y-4 max-w-4xl">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted/40" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted/40" />
      </div>
    )
  }

  const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'overview',    label: 'Questions',   icon: ClipboardList },
    { key: 'assignments', label: 'Assignments', icon: UserCheck },
    { key: 'results',     label: 'Results',     icon: BarChart2 },
  ]

  const completedCount = survey.assignments.filter(a => a.completed_at).length

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/admin/surveys')}
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to surveys
        </button>

        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-foreground">{survey.title}</h1>
              <StatusBadge status={survey.status} />
            </div>
            {survey.description && (
              <p className="mt-1 text-sm text-muted-foreground">{survey.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {survey.status === 'draft' && (
              <>
                <Button
                  size="sm"
                  onClick={() => assignMut.mutate()}
                  disabled={assignMut.isPending}
                  variant="outline"
                >
                  <Users2 className="mr-1.5 h-3.5 w-3.5" />
                  Assign to All
                </Button>
                <Button
                  size="sm"
                  onClick={() => patchMut.mutate('active')}
                  disabled={patchMut.isPending}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Activate
                </Button>
              </>
            )}
            {survey.status === 'active' && (
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => patchMut.mutate('closed')}
                disabled={patchMut.isPending}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Close Survey
              </Button>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
          <span>{survey.questions.length} questions</span>
          <span>·</span>
          <span>{survey.assignments.length} assigned</span>
          <span>·</span>
          <span>{completedCount} completed</span>
          {survey.due_date && (
            <>
              <span>·</span>
              <span>Due {new Date(survey.due_date).toLocaleDateString()}</span>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/40">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Questions */}
      {tab === 'overview' && (
        <div className="space-y-3">
          {survey.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions in this survey.</p>
          ) : survey.questions.map((q, i) => (
            <div key={q.id} className="rounded-2xl border border-border/60 bg-card px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-sm font-semibold text-muted-foreground">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{q.question_text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                      {q.question_type === 'text' ? 'Free text'
                        : q.question_type === 'rating' ? 'Rating 1-5'
                        : q.question_type === 'single' ? 'Single choice'
                        : 'Multi choice'}
                    </span>
                    {q.required && (
                      <span className="text-[10px] text-destructive">Required</span>
                    )}
                    {q.options && (
                      <span className="text-[10px] text-muted-foreground">
                        {q.options.join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Assignments */}
      {tab === 'assignments' && (
        <div>
          {survey.status === 'draft' && (
            <div className="mb-4 flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => assignMut.mutate()}
                disabled={assignMut.isPending}
              >
                <Users2 className="mr-1.5 h-3.5 w-3.5" />
                {assignMut.isPending ? 'Assigning…' : 'Assign to All Active Employees'}
              </Button>
            </div>
          )}

          {survey.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No employees assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {survey.assignments.map(a => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {a.employee.first_name} {a.employee.last_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{a.employee.employee_code}</p>
                  </div>
                  {a.completed_at ? (
                    <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                      <Check className="h-3 w-3" /> Completed
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Pending</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Results */}
      {tab === 'results' && (
        <div className="space-y-6">
          {resultsLoading ? (
            <div className="h-48 animate-pulse rounded-2xl bg-muted/40" />
          ) : !results ? (
            <p className="text-sm text-muted-foreground">No results yet.</p>
          ) : (
            <>
              {/* Completion summary */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Assigned',     value: results.total_assigned },
                  { label: 'Completed',    value: results.total_completed },
                  { label: 'Response rate', value: `${results.completion_rate}%` },
                ].map(s => (
                  <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-5">
                    <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                    <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Per-question results */}
              {results.questions.map((q, i) => (
                <div key={q.id} className="rounded-2xl border border-border/60 bg-card p-6">
                  <p className="mb-1 text-sm font-semibold text-foreground">
                    <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                    {q.question_text}
                  </p>
                  <p className="mb-4 text-[11px] text-muted-foreground">
                    {q.response_count} response{q.response_count !== 1 ? 's' : ''}
                  </p>

                  {q.question_type === 'rating'  && <RatingResult q={q} />}
                  {(q.question_type === 'single' || q.question_type === 'multi') && <ChoiceResult q={q} />}
                  {q.question_type === 'text'    && <TextResult q={q} />}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
