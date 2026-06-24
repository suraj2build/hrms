/**
 * AdminPipeline — /admin/recruitment/pipeline  (RCT-03)
 *
 * Visual Kanban board: applications grouped by pipeline stage.
 * Filter by requisition. Drag cards between stages to move them.
 * Stage columns show count and accept drops via native HTML5 DnD.
 *
 * Access: hr_admin / super_admin.
 */

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Kanban, RefreshCw, Star, GripVertical, UserCircle2,
  Building2, Briefcase, Plus, ArrowRight, Mail, CalendarDays,
  Clock, GitBranch, MessagesSquare, Phone, FileText, Linkedin,
  StickyNote, Award, Hourglass, CheckCircle2, Circle, ThumbsUp, ThumbsDown,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Button }        from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stage {
  id:          string
  name:        string
  color:       string
  stage_order: number
  stage_type:  string
}

interface Application {
  id:             string
  requisition_id: string
  status:         string
  stage_id:       string | null
  overall_score:  number | null
  created_at:     string
  candidates: {
    id:               string
    first_name:       string
    last_name:        string
    email:            string
    phone:            string | null
    resume_url:       string | null
    linkedin_url:     string | null
    notes:            string | null
    current_company:  string | null
    current_title:    string | null
    source:           string
    total_experience: number | null
  }
  job_requisitions: { id: string; title: string } | null
  recruitment_pipeline_stages: Stage | null
}

interface Requisition {
  id:     string
  title:  string
  status: string
}

interface TimelineRound {
  id:            string
  round_number:  number
  round_type?:   string | null
  status?:       string | null
  scheduled_at?: string | null
  interview_panel?:  Array<{ profiles?: { full_name?: string | null } | null }> | null
  interview_scores?: Array<{ overall_score?: number | null; recommendation?: string | null }> | null
}

interface TimelineActivity {
  id:          string
  activity_type?: string | null
  note?:       string | null
  created_at:  string
  from_stage?: { name?: string | null; color?: string | null } | null
  to_stage?:   { name?: string | null; color?: string | null } | null
  actor?:      { full_name?: string | null } | null
}

const SOURCE_COLORS: Record<string, string> = {
  linkedin: 'bg-info/15 text-info',
  naukri:   'bg-accent-coral/15 text-accent-coral',
  indeed:   'bg-primary/15 text-primary',
  referral: 'bg-primary/15 text-primary',
  portal:   'bg-accent-teal/15 text-accent-teal',
  agency:   'bg-accent-magenta/15 text-accent-magenta',
  direct:   'bg-muted text-muted-foreground',
  other:    'bg-muted text-muted-foreground',
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function scoreColor(s: number): string {
  if (s >= 8) return 'text-success'
  if (s >= 5) return 'text-warning'
  return 'text-destructive'
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(first: string, last: string): string {
  return `${(first?.[0] ?? '').toUpperCase()}${(last?.[0] ?? '').toUpperCase()}` || '?'
}

function StatCell({ icon: Icon, label, value, tint }: {
  icon: React.ElementType; label: string; value: string; tint: string
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 text-center">
      <Icon className={cn('h-4 w-4 mx-auto mb-1', tint)} />
      <p className="text-lg font-bold leading-none tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">{label}</p>
    </div>
  )
}

// ── Candidate detail popup ────────────────────────────────────────────────────

function PipelineCandidateDialog({ app, stages, onClose }: {
  app: Application | null; stages: Stage[]; onClose: () => void
}) {
  const { data, isLoading } = useQuery<{ rounds: TimelineRound[]; activity: TimelineActivity[] }>({
    queryKey: ['recruitment', 'timeline', app?.id],
    queryFn:  () => api.get(`/recruitment/applications/${app!.id}/timeline`),
    enabled:  !!app,
  })
  const rounds   = data?.rounds ?? []
  const activity = data?.activity ?? []

  if (!app) return null
  const c = app.candidates
  const stage = app.recruitment_pipeline_stages
  const accent = stage?.color ?? '#2E6FE6'
  const currentIdx = stages.findIndex(s => s.id === app.stage_id)
  const daysInPipe = daysSince(app.created_at)

  return (
    <Dialog open={!!app} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        {/* ── Banner header ─────────────────────────────────────────────── */}
        <div className="relative px-5 pt-5 pb-4" style={{ background: `linear-gradient(135deg, ${accent}14, transparent 70%)` }}>
          <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
          <DialogHeader className="space-y-0">
            <DialogTitle className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0 shadow-sm"
                style={{ backgroundColor: accent }}
              >
                {initials(c.first_name, c.last_name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base">{c.first_name} {c.last_name}</p>
                <p className="text-xs font-normal text-muted-foreground truncate">
                  {c.current_title || '—'}{c.current_company ? ` · ${c.current_company}` : ''}
                </p>
              </div>
            </DialogTitle>
          </DialogHeader>

          {/* Stage + source chips */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {stage && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 text-white" style={{ backgroundColor: accent }}>
                {stage.name}
              </span>
            )}
            <span className={cn('text-[11px] font-medium rounded-full px-2 py-0.5', SOURCE_COLORS[c.source] ?? SOURCE_COLORS.other)}>{c.source}</span>
            {app.job_requisitions && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                <Briefcase className="h-3 w-3" />{app.job_requisitions.title}
              </span>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 hover:border-primary/40 hover:text-primary transition-colors">
              <Mail className="h-3.5 w-3.5" />Email
            </a>
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 hover:border-primary/40 hover:text-primary transition-colors">
                <Phone className="h-3.5 w-3.5" />{c.phone}
              </a>
            )}
            {c.resume_url && (
              <a href={c.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 hover:border-primary/40 hover:text-primary transition-colors">
                <FileText className="h-3.5 w-3.5" />Résumé
              </a>
            )}
            {c.linkedin_url && (
              <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 hover:border-primary/40 hover:text-primary transition-colors">
                <Linkedin className="h-3.5 w-3.5" />LinkedIn
              </a>
            )}
          </div>
        </div>

        <div className="px-5 pb-5 space-y-5">
          {/* ── Stats grid ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-2">
            <StatCell icon={Award}      label="Experience" value={c.total_experience != null ? `${c.total_experience}y` : '—'} tint="text-accent-violet" />
            <StatCell icon={Star}       label="Score"      value={app.overall_score != null ? `${app.overall_score}` : '—'} tint={app.overall_score != null ? scoreColor(app.overall_score) : 'text-muted-foreground'} />
            <StatCell icon={MessagesSquare} label="Rounds" value={`${rounds.length}`} tint="text-info" />
            <StatCell icon={Hourglass}  label="In Pipeline" value={`${daysInPipe}d`} tint="text-warning" />
          </div>

          {/* ── Stage progress stepper ──────────────────────────────────── */}
          {stages.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Pipeline Progress</p>
              <div className="flex items-center">
                {stages.map((s, i) => {
                  const done    = currentIdx >= 0 && i < currentIdx
                  const current = i === currentIdx
                  return (
                    <div key={s.id} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-1">
                        {current ? (
                          <CheckCircle2 className="h-5 w-5" style={{ color: s.color }} fill="none" />
                        ) : done ? (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground/30" />
                        )}
                        <span className={cn('text-[9px] text-center leading-tight max-w-[52px]', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                          {s.name}
                        </span>
                      </div>
                      {i < stages.length - 1 && (
                        <div className={cn('h-0.5 flex-1 mx-1 mb-4 rounded-full', done ? 'bg-success' : 'bg-muted')} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Recruiter notes ─────────────────────────────────────────── */}
          {c.notes && (
            <div className="rounded-xl border border-border bg-warning/5 dark:bg-warning/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <StickyNote className="h-3.5 w-3.5" />Notes
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{c.notes}</p>
            </div>
          )}

          {/* ── Interview rounds ────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-2">
              <MessagesSquare className="h-3.5 w-3.5" />Interview Rounds
            </p>
            {isLoading ? (
              <div className="flex justify-center py-3"><RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : rounds.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">No interviews scheduled yet.</p>
            ) : (
              <div className="space-y-2">
                {rounds.map(r => {
                  const scores = r.interview_scores ?? []
                  const avg = scores.length ? (scores.reduce((a, s) => a + (s.overall_score ?? 0), 0) / scores.length) : null
                  const panel = (r.interview_panel ?? []).map(p => p.profiles?.full_name).filter(Boolean).join(', ')
                  const recs = scores.map(s => s.recommendation).filter(Boolean)
                  const positive = recs.filter(r => /hire|yes|strong|advance/i.test(r ?? '')).length
                  return (
                    <div key={r.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">Round {r.round_number}{r.round_type ? ` · ${r.round_type}` : ''}</span>
                        <div className="flex items-center gap-1.5">
                          {avg != null && (
                            <span className={cn('text-xs font-bold inline-flex items-center gap-0.5', scoreColor(avg))}>
                              <Star className="h-3 w-3 fill-current" />{avg.toFixed(1)}
                            </span>
                          )}
                          {r.status && <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground capitalize">{r.status}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        {r.scheduled_at && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(r.scheduled_at)}</span>}
                        {panel && <span className="inline-flex items-center gap-1 truncate"><UserCircle2 className="h-3 w-3" />{panel}</span>}
                        {recs.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            {positive >= recs.length - positive
                              ? <ThumbsUp className="h-3 w-3 text-success" />
                              : <ThumbsDown className="h-3 w-3 text-destructive" />}
                            {positive}/{recs.length} recommend
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Stage history timeline ──────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-2">
              <GitBranch className="h-3.5 w-3.5" />Activity History
            </p>
            {isLoading ? (
              <div className="flex justify-center py-3"><RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">
                Applied {fmtDate(app.created_at)} — no further activity recorded.
              </p>
            ) : (
              <ol className="relative border-l border-border ml-1.5 space-y-3 pl-4">
                {activity.map(a => (
                  <li key={a.id} className="relative">
                    <span
                      className="absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background"
                      style={{ backgroundColor: a.to_stage?.color ?? accent }}
                    />
                    <p className="text-sm text-foreground">
                      {a.from_stage?.name ? <span className="text-muted-foreground">{a.from_stage.name} → </span> : ''}
                      <span className="font-medium">{a.to_stage?.name ?? a.activity_type ?? 'Updated'}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(a.created_at)}{a.actor?.full_name ? ` · ${a.actor.full_name}` : ''}
                    </p>
                    {a.note && <p className="text-xs text-foreground/80 mt-0.5">{a.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminPipeline() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [selectedReqId, setSelectedReqId] = useState<string>('all')
  const [draggedId,     setDraggedId]     = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [detailApp,     setDetailApp]     = useState<Application | null>(null)
  // Suppress the click that fires after a drag-and-drop so dropping a card
  // never accidentally opens the detail popup.
  const didDragRef = useRef(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: stagesData, isFetching: stagesFetching } = useQuery<{ data: Stage[] }>({
    queryKey: ['recruitment', 'stages'],
    queryFn:  () => api.get('/recruitment/pipeline/stages'),
    enabled:  isAdmin,
  })
  const stages = (stagesData?.data ?? []).sort((a, b) => a.stage_order - b.stage_order)

  const { data: reqData } = useQuery<{ data: Requisition[] }>({
    queryKey: ['recruitment', 'requisitions', 'open'],
    queryFn:  () => api.get('/recruitment/requisitions?limit=100'),
    enabled:  isAdmin,
  })
  const requisitions = reqData?.data ?? []

  const appParams = new URLSearchParams()
  appParams.set('limit', '200')
  if (selectedReqId !== 'all') appParams.set('requisition_id', selectedReqId)

  const { data: appData, isLoading, refetch } = useQuery<{ data: Application[] }>({
    queryKey: ['recruitment', 'applications', selectedReqId],
    queryFn:  () => api.get(`/recruitment/applications?${appParams}`),
    enabled:  isAdmin,
  })
  const applications = appData?.data ?? []

  // ── Seeding check: if no stages, prompt seed ───────────────────────────────

  const seedMut = useMutation({
    mutationFn: () => api.post('/recruitment/pipeline/stages/seed', {}),
    onSuccess:  () => { toast.success('Default pipeline stages created'); qc.invalidateQueries({ queryKey: ['recruitment', 'stages'] }) },
    onError:    (e: unknown) => toast.error(e instanceof Error ? e.message : 'Seed failed'),
  })

  // ── Move mutation ──────────────────────────────────────────────────────────

  const moveMut = useMutation({
    mutationFn: ({ appId, stageId }: { appId: string; stageId: string }) =>
      api.post(`/recruitment/applications/${appId}/move`, { stage_id: stageId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruitment', 'applications'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Move failed'),
  })

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, appId: string) {
    didDragRef.current = true
    setDraggedId(appId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragEnd() {
    setDraggedId(null)
    setDragOverStage(null)
    // Reset on the next tick so the trailing click (if any) is still suppressed.
    setTimeout(() => { didDragRef.current = false }, 0)
  }

  function onDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stageId)
  }

  function onDragLeave(e: React.DragEvent) {
    // Only clear if leaving the column entirely
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragOverStage(null)
    }
  }

  function onDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    setDragOverStage(null)
    if (!draggedId) return
    const app = applications.find(a => a.id === draggedId)
    if (!app || app.stage_id === stageId) return
    moveMut.mutate({ appId: draggedId, stageId })
  }

  // ── Group apps by stage ────────────────────────────────────────────────────

  const byStage: Record<string, Application[]> = {}
  for (const stage of stages) byStage[stage.id] = []
  const unassigned: Application[] = []

  for (const app of applications) {
    if (app.stage_id && byStage[app.stage_id]) {
      byStage[app.stage_id].push(app)
    } else {
      unassigned.push(app)
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function AppCard({ app }: { app: Application }) {
    const days = daysSince(app.created_at)
    const isDragging = draggedId === app.id
    const c = app.candidates

    return (
      <div
        draggable
        onDragStart={e => onDragStart(e, app.id)}
        onDragEnd={onDragEnd}
        onClick={() => { if (!didDragRef.current) setDetailApp(app) }}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailApp(app) } }}
        title="Click for details · drag to move stage"
        className={cn(
          'bg-background rounded-lg border border-border p-3 cursor-grab active:cursor-grabbing select-none transition-all',
          isDragging ? 'opacity-40 scale-95' : 'hover:shadow-sm hover:border-primary/40 hover:ring-1 hover:ring-primary/20',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <UserCircle2 className="h-7 w-7 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{c.first_name} {c.last_name}</p>
              {c.current_title && (
                <p className="text-[11px] text-muted-foreground truncate">{c.current_title}</p>
              )}
            </div>
          </div>
          <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
        </div>

        {c.current_company && (
          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
            <Building2 className="h-3 w-3" />{c.current_company}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', SOURCE_COLORS[c.source] ?? SOURCE_COLORS.other)}>
            {c.source}
          </span>
          {c.total_experience != null && (
            <span className="text-[10px] text-muted-foreground">{c.total_experience}y exp</span>
          )}
          {app.overall_score != null && (
            <span className={cn('text-[10px] font-bold flex items-center gap-0.5', scoreColor(app.overall_score))}>
              <Star className="h-2.5 w-2.5 fill-current" />{app.overall_score}/10
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          {app.job_requisitions && (
            <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">
              {app.job_requisitions.title}
            </p>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{days}d ago</span>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <Kanban className="h-8 w-8" />
          <p className="text-sm">Recruitment pipeline is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Recruitment Pipeline"
        subtitle="Drag candidates across stages to move them through the hiring process"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-1', stagesFetching && 'animate-spin')} />Refresh
            </Button>
          </div>
        }
      />

      {/* Requisition selector */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Requisition:</span>
        </div>
        <Select value={selectedReqId} onValueChange={setSelectedReqId}>
          <SelectTrigger className="h-8 text-sm w-[260px]">
            <SelectValue placeholder="All requisitions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All requisitions</SelectItem>
            {requisitions.map(r => (
              <SelectItem key={r.id} value={r.id}>
                {r.title}
                {r.status !== 'open' && <span className="ml-1 text-muted-foreground">({r.status})</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{applications.length} applicants</span>
      </div>

      {/* No stages → seed prompt */}
      {!isLoading && stages.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Kanban className="h-10 w-10" />
          <p className="text-sm">No pipeline stages configured yet.</p>
          <Button size="sm" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {seedMut.isPending ? 'Creating…' : 'Create default stages'}
          </Button>
        </div>
      )}

      {/* Kanban board */}
      {stages.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]" style={{ alignItems: 'flex-start' }}>
          {/* Unassigned column (only show if there are unassigned apps) */}
          {unassigned.length > 0 && (
            <div
              className={cn(
                'flex-shrink-0 w-64 rounded-xl border border-dashed border-border bg-muted/20 transition-colors',
                dragOverStage === '__unassigned' && 'ring-2 ring-primary/40 bg-primary/5',
              )}
              onDragOver={e => onDragOver(e, '__unassigned')}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, '__unassigned')}
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-dashed border-border">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">Unassigned</span>
                </div>
                <span className="text-xs text-muted-foreground font-medium">{unassigned.length}</span>
              </div>
              <div className="p-2 space-y-2">
                {isLoading
                  ? <div className="flex justify-center py-4"><RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  : unassigned.map(app => <AppCard key={app.id} app={app} />)
                }
              </div>
            </div>
          )}

          {stages.map(stage => {
            const stageApps = byStage[stage.id] ?? []
            const isOver = dragOverStage === stage.id

            return (
              <div
                key={stage.id}
                className={cn(
                  'flex-shrink-0 w-64 rounded-xl border border-border bg-muted/10 transition-colors',
                  isOver && 'ring-2 ring-primary/40 bg-primary/5',
                )}
                onDragOver={e => onDragOver(e, stage.id)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, stage.id)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="text-xs font-semibold">{stage.name}</span>
                  </div>
                  <span
                    className="text-[11px] font-semibold rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground"
                  >
                    {stageApps.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="p-2 space-y-2 min-h-[120px]">
                  {isLoading ? (
                    <div className="flex justify-center py-4">
                      <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : stageApps.length === 0 ? (
                    <div className={cn(
                      'flex items-center justify-center h-16 rounded-lg border border-dashed border-border/60 text-muted-foreground/40',
                      isOver && 'border-primary/40 bg-primary/5',
                    )}>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  ) : (
                    stageApps.map(app => <AppCard key={app.id} app={app} />)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <PipelineCandidateDialog app={detailApp} stages={stages} onClose={() => setDetailApp(null)} />
    </PageContainer>
  )
}
