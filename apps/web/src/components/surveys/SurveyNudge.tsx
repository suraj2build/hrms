import { useQuery }   from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { api }           from '@/lib/api/client'

interface Assignment {
  id:           string
  completed_at: string | null
  survey: { id: string; title: string; status: string }
}

export function SurveyNudge() {
  const navigate = useNavigate()

  const { data } = useQuery<Assignment[]>({
    queryKey:  ['my-surveys'],
    queryFn:   () => api.get<{ data: Assignment[] }>('/surveys/my').then(r => r.data),
    staleTime: 2 * 60_000,
  })

  const pending = (data ?? []).filter(
    a => !a.completed_at && a.survey?.status === 'active',
  )

  if (!pending.length) return null

  return (
    <div
      role="button"
      onClick={() => navigate('/ess/surveys')}
      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4 transition-colors hover:bg-primary/10"
    >
      <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {pending.length === 1
            ? '1 survey waiting for you'
            : `${pending.length} surveys waiting for you`}
        </p>
        <p className="text-[11px] text-muted-foreground">Tap to respond</p>
      </div>
    </div>
  )
}
