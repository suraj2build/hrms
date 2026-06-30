import { useState }    from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, CheckCircle2, Clock, ChevronRight, Users2, Loader2, RefreshCw } from 'lucide-react'
import { toast }       from 'sonner'
import { api }         from '@/lib/api/client'
import { Button }      from '@/components/ui/button'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'

interface Assignment {
  id:           string
  assigned_at:  string
  completed_at: string | null
  survey: {
    id:          string
    title:       string
    description: string | null
    due_date:    string | null
    status:      string
  }
}

interface NominationRound {
  id:            string
  survey_id:     string
  peer_count:    number
  deadline_at:   string | null
  status:        string
  survey:        { title: string } | null
  my_nominations?: string[]
}

function DueBadge({ date }: { date: string | null }) {
  if (!date) return null
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
  const cls  = days < 0 ? 'text-destructive' : days <= 2 ? 'text-orange-500' : 'text-muted-foreground'
  const label = days < 0 ? 'Overdue' : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days}d`
  return <span className={`text-[11px] font-medium ${cls}`}>{label}</span>
}

export function EssSurveys() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [nominations, setNominations] = useState<Record<string, string[]>>({})

  const { data, isLoading } = useQuery<Assignment[]>({
    queryKey:  ['my-surveys'],
    queryFn:   () => api.get<{ data: Assignment[] }>('/surveys/my').then(r => r.data),
    staleTime: 60_000,
  })

  const { data: rounds = [] } = useQuery<NominationRound[]>({
    queryKey: ['my-360-nominations'],
    queryFn:  () => api.get<{ data: NominationRound[] }>('/surveys/my/360/nominations').then(r => r.data ?? []),
    staleTime: 60_000,
  })

  const nominateMut = useMutation({
    mutationFn: ({ roundId, employeeIds }: { roundId: string; employeeIds: string[] }) =>
      api.post(`/surveys/my/360/${roundId}/nominate`, { employee_ids: employeeIds }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['my-360-nominations'] })
      toast.success('Peer nominations submitted')
      setNominations(prev => ({ ...prev, [vars.roundId]: [] }))
    },
    onError: (e: Error) => toast.error('Failed to submit nominations', { description: e.message }),
  })

  const pending   = (data ?? []).filter(a => !a.completed_at && a.survey?.status === 'active')
  const completed = (data ?? []).filter(a => !!a.completed_at)
  const inactive  = (data ?? []).filter(a => !a.completed_at && a.survey?.status !== 'active')

  if (isLoading) {
    return (
      <div className="p-6 space-y-3 max-w-2xl">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted/40" />
        ))}
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ClipboardList className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">No surveys assigned to you yet.</p>
      </div>
    )
  }

  function SurveyCard({ a, canTake }: { a: Assignment; canTake: boolean }) {
    return (
      <div
        role={canTake ? 'button' : undefined}
        onClick={() => canTake && navigate(`/ess/surveys/${a.survey.id}`)}
        className={`flex items-center gap-4 rounded-2xl border border-border/60 bg-card px-5 py-4 transition-colors ${
          canTake ? 'cursor-pointer hover:border-primary/40 hover:bg-primary/5' : ''
        }`}
      >
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          a.completed_at ? 'bg-green-100 dark:bg-green-900/30' : 'bg-primary/10'
        }`}>
          {a.completed_at
            ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            : <Clock className="h-4 w-4 text-primary" />
          }
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{a.survey.title}</p>
          <div className="mt-0.5 flex items-center gap-2">
            {a.completed_at
              ? <span className="text-[11px] text-muted-foreground">Completed {new Date(a.completed_at).toLocaleDateString()}</span>
              : <DueBadge date={a.survey.due_date} />
            }
          </div>
        </div>

        {canTake && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Surveys</h1>
        <p className="mt-1 text-sm text-muted-foreground">Surveys assigned to you by HR</p>
      </div>

      {pending.length > 0 && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Pending ({pending.length})
          </p>
          <div className="space-y-2">
            {pending.map(a => <SurveyCard key={a.id} a={a} canTake />)}
          </div>
        </section>
      )}

      {inactive.length > 0 && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Not Available
          </p>
          <div className="space-y-2">
            {inactive.map(a => <SurveyCard key={a.id} a={a} canTake={false} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Completed ({completed.length})
          </p>
          <div className="space-y-2">
            {completed.map(a => <SurveyCard key={a.id} a={a} canTake={false} />)}
          </div>
        </section>
      )}

      {/* 360° Peer Nomination */}
      {rounds.length > 0 && (
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> 360° Peer Nominations
          </p>
          <div className="space-y-4">
            {rounds.map(round => {
              const picked = nominations[round.id] ?? round.my_nominations ?? []
              const needed = round.peer_count
              return (
                <div key={round.id} className="rounded-2xl border border-border/60 bg-card px-5 py-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{round.survey?.title ?? 'Survey'}</p>
                      <p className="text-xs text-muted-foreground">Nominate {needed} peer{needed !== 1 ? 's' : ''} for your 360° review</p>
                    </div>
                    {round.deadline_at && (
                      <span className="text-[11px] text-muted-foreground">
                        Due {new Date(round.deadline_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <EmployeeSelector
                    value={picked[0] ?? null}
                    onChange={empId => {
                      if (!empId || picked.includes(empId)) return
                      if (picked.length >= needed) {
                        toast.error(`You can nominate at most ${needed} peer${needed !== 1 ? 's' : ''}`)
                        return
                      }
                      setNominations(prev => ({ ...prev, [round.id]: [...picked, empId] }))
                    }}
                    placeholder="Search and add a peer…"
                  />

                  {picked.length > 0 && (
                    <div className="space-y-1.5">
                      {picked.map((eid, i) => (
                        <div key={eid} className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs text-foreground">Peer #{i + 1} — {eid}</span>
                          </div>
                          <button
                            onClick={() => setNominations(prev => ({ ...prev, [round.id]: picked.filter((_, j) => j !== i) }))}
                            className="text-[10px] text-muted-foreground hover:text-destructive"
                          >Remove</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm"
                    disabled={picked.length < needed || nominateMut.isPending}
                    onClick={() => nominateMut.mutate({ roundId: round.id, employeeIds: picked })}
                    className="w-full"
                  >
                    {nominateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Submit {picked.length}/{needed} Nomination{needed !== 1 ? 's' : ''}
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
