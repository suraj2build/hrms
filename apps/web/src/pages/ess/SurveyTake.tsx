import { useState }                   from 'react'
import { useParams, useNavigate }     from 'react-router-dom'
import { useQuery, useMutation }      from '@tanstack/react-query'
import { CheckCircle2, ArrowLeft }    from 'lucide-react'
import { toast }                      from 'sonner'
import { Button }                     from '@/components/ui/button'
import { api }                        from '@/lib/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Question {
  id:            string
  order_idx:     number
  question_text: string
  question_type: 'text' | 'rating' | 'single' | 'multi'
  options:       string[] | null
  required:      boolean
}

interface SurveyDetail {
  id:            string
  title:         string
  description:   string | null
  assignment_id: string
  completed:     boolean
  questions:     Question[]
}

// ── Question renderers ─────────────────────────────────────────────────────────

function TextQuestion({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={3}
      placeholder="Your answer…"
      className="w-full resize-none rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
    />
  )
}

function RatingQuestion({
  value, onChange,
}: { value: number | null; onChange: (v: number) => void }) {
  const stars = [1, 2, 3, 4, 5]
  return (
    <div className="flex items-center gap-2">
      {stars.map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-semibold transition-all ${
            value !== null && n <= value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 text-muted-foreground hover:border-primary hover:text-foreground'
          }`}
        >
          {n}
        </button>
      ))}
      {value !== null && (
        <span className="ml-1 text-xs text-muted-foreground">out of 5</span>
      )}
    </div>
  )
}

function SingleQuestion({
  options, value, onChange,
}: { options: string[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            value === opt
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 text-foreground hover:border-primary/50 hover:bg-muted'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function MultiQuestion({
  options, value, onChange,
}: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            value.includes(opt)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 text-foreground hover:border-primary/50 hover:bg-muted'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SurveyTake() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitted, setSubmitted] = useState(false)

  const { data: survey, isLoading, error } = useQuery<SurveyDetail>({
    queryKey: ['survey-take', id],
    queryFn:  () => api.get<{ data: SurveyDetail }>(`/surveys/${id}`).then(r => r.data),
    enabled:  !!id,
  })

  const submitMut = useMutation({
    mutationFn: () => {
      const responses = (survey?.questions ?? []).map(q => ({
        question_id: q.id,
        response:    answers[q.id] ?? null,
      }))
      return api.post(`/surveys/${id}/submit`, { responses })
    },
    onSuccess: () => setSubmitted(true),
    onError:   () => toast.error('Could not submit survey — please try again'),
  })

  function setAnswer(qid: string, value: unknown) {
    setAnswers(prev => ({ ...prev, [qid]: value }))
  }

  function canSubmit() {
    if (!survey) return false
    return survey.questions.every(q => {
      if (!q.required) return true
      const a = answers[q.id]
      if (q.question_type === 'text')   return typeof a === 'string' && (a as string).trim().length > 0
      if (q.question_type === 'rating') return typeof a === 'number'
      if (q.question_type === 'single') return typeof a === 'string'
      if (q.question_type === 'multi')  return Array.isArray(a) && (a as string[]).length > 0
      return false
    })
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-2xl">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted/40" />
        {[1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/40" />)}
      </div>
    )
  }

  if (error || !survey) {
    return (
      <div className="p-6 text-sm text-destructive">
        Survey not found or not accessible.
      </div>
    )
  }

  if (submitted || survey.completed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-6">
        <CheckCircle2 className="h-12 w-12 text-success mb-4" />
        <h2 className="text-xl font-semibold text-foreground">Response Submitted!</h2>
        <p className="mt-2 text-sm text-muted-foreground">Thank you for completing the survey.</p>
        <Button className="mt-6" onClick={() => navigate('/ess/surveys')}>
          Back to Surveys
        </Button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/ess/surveys')}
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to surveys
        </button>
        <h1 className="text-2xl font-semibold text-foreground">{survey.title}</h1>
        {survey.description && (
          <p className="mt-1 text-sm text-muted-foreground">{survey.description}</p>
        )}
      </div>

      {/* Questions */}
      <div className="space-y-5">
        {survey.questions.map((q, idx) => (
          <div key={q.id} className="rounded-2xl border border-border/60 bg-card p-5">
            <p className="mb-3 text-sm font-medium text-foreground">
              <span className="mr-2 text-muted-foreground">{idx + 1}.</span>
              {q.question_text}
              {q.required && <span className="ml-1 text-destructive">*</span>}
            </p>

            {q.question_type === 'text' && (
              <TextQuestion
                value={(answers[q.id] as string) ?? ''}
                onChange={v => setAnswer(q.id, v)}
              />
            )}
            {q.question_type === 'rating' && (
              <RatingQuestion
                value={(answers[q.id] as number) ?? null}
                onChange={v => setAnswer(q.id, v)}
              />
            )}
            {q.question_type === 'single' && q.options && (
              <SingleQuestion
                options={q.options}
                value={(answers[q.id] as string) ?? null}
                onChange={v => setAnswer(q.id, v)}
              />
            )}
            {q.question_type === 'multi' && q.options && (
              <MultiQuestion
                options={q.options}
                value={(answers[q.id] as string[]) ?? []}
                onChange={v => setAnswer(q.id, v)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="outline" onClick={() => navigate('/ess/surveys')}>
          Cancel
        </Button>
        <Button
          onClick={() => submitMut.mutate()}
          disabled={!canSubmit() || submitMut.isPending}
        >
          {submitMut.isPending ? 'Submitting…' : 'Submit Survey'}
        </Button>
      </div>
    </div>
  )
}
