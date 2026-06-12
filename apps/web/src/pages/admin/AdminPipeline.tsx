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
  Building2, ChevronDown, Briefcase, Plus, ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
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

const SOURCE_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  naukri:   'bg-orange-100 text-orange-700',
  indeed:   'bg-indigo-100 text-indigo-700',
  referral: 'bg-purple-100 text-purple-700',
  portal:   'bg-teal-100 text-teal-700',
  agency:   'bg-pink-100 text-pink-700',
  direct:   'bg-gray-100 text-gray-600',
  other:    'bg-gray-100 text-gray-600',
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function scoreColor(s: number): string {
  if (s >= 8) return 'text-emerald-600'
  if (s >= 5) return 'text-amber-600'
  return 'text-red-500'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminPipeline() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [selectedReqId, setSelectedReqId] = useState<string>('all')
  const [draggedId,     setDraggedId]     = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

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
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Seed failed'),
  })

  // ── Move mutation ──────────────────────────────────────────────────────────

  const moveMut = useMutation({
    mutationFn: ({ appId, stageId }: { appId: string; stageId: string }) =>
      api.post(`/recruitment/applications/${appId}/move`, { stage_id: stageId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruitment', 'applications'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Move failed'),
  })

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, appId: string) {
    setDraggedId(appId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragEnd() {
    setDraggedId(null)
    setDragOverStage(null)
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
        className={cn(
          'bg-background rounded-lg border border-border p-3 cursor-grab active:cursor-grabbing select-none transition-all',
          isDragging ? 'opacity-40 scale-95' : 'hover:shadow-sm hover:border-primary/30',
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
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
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
    </PageContainer>
  )
}
