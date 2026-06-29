/**
 * AdminSuccession — /admin/succession
 *
 * Succession Planning Foundation: manage per-position succession plans,
 * track candidate readiness, and monitor bench-strength coverage.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, TrendingUp, AlertTriangle, Shield,
  Plus, ChevronRight, Loader2, UserCheck, Clock, Target,
  Edit2, Trash2, X, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel      = 'critical' | 'high' | 'medium' | 'low'
type ReadinessLevel = 'ready_now' | 'ready_1_2_years' | 'ready_3_5_years'
type PlanStatus     = 'active' | 'archived'

interface IncumbentEmployee {
  id:            string
  first_name:    string
  last_name:     string
  employee_code: string
  designation?:  string
}

interface Plan {
  id:              string
  position_title:  string
  department:      string | null
  risk_level:      RiskLevel
  status:          PlanStatus
  notes:           string | null
  created_at:      string
  employees:       IncumbentEmployee | null
  candidate_count: number
}

interface CandidateEmployee {
  id:            string
  first_name:    string
  last_name:     string
  employee_code: string
  designation?:  string
  department?:   string
}

interface Candidate {
  id:               string
  readiness_level:  ReadinessLevel
  readiness_score:  number | null
  strengths:        string | null
  gaps:             string | null
  development_plan: string | null
  notes:            string | null
  created_at:       string
  employees:        CandidateEmployee | null
}

interface PlanDetail extends Omit<Plan, 'candidate_count'> {
  updated_at: string
  candidates: Candidate[]
}

interface Dashboard {
  total_plans:      number
  risk_breakdown:   { critical: number; high: number; medium: number; low: number }
  total_candidates: number
  ready_now:        number
  coverage_rate:    number
}

// ── Empty forms ───────────────────────────────────────────────────────────────

const emptyPlanForm = {
  position_title: '',
  department:     '',
  incumbent_id:   '',
  risk_level:     'medium' as RiskLevel,
  notes:          '',
}

const emptyCandidateForm = {
  employee_id:     '',
  readiness_level: 'ready_3_5_years' as ReadinessLevel,
  readiness_score: '',
  strengths:       '',
  gaps:            '',
  development_plan: '',
  notes:           '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_ORDER: RiskLevel[] = ['critical', 'high', 'medium', 'low']

function riskLabel(r: RiskLevel): string {
  switch (r) {
    case 'critical': return 'Critical'
    case 'high':     return 'High'
    case 'medium':   return 'Medium'
    case 'low':      return 'Low'
  }
}

function riskBadgeClass(r: RiskLevel): string {
  switch (r) {
    case 'critical': return 'bg-destructive/10 text-destructive border-destructive/30'
    case 'high':     return 'bg-orange-500/10 text-orange-600 border-orange-500/30'
    case 'medium':   return 'bg-warning/10 text-warning border-warning/30'
    case 'low':      return 'bg-success/10 text-success border-success/30'
  }
}

function readinessLabel(r: ReadinessLevel): string {
  switch (r) {
    case 'ready_now':       return 'Ready Now'
    case 'ready_1_2_years': return '1–2 Years'
    case 'ready_3_5_years': return '3–5 Years'
  }
}

function ReadinessBadge({ level }: { level: ReadinessLevel }) {
  switch (level) {
    case 'ready_now':
      return <Badge variant="success" className="text-[10px]">Ready Now</Badge>
    case 'ready_1_2_years':
      return <Badge variant="outline" className="text-[10px] text-warning border-warning/40">1–2 Years</Badge>
    case 'ready_3_5_years':
      return <Badge variant="outline" className="text-[10px]">3–5 Years</Badge>
  }
}

function fmtName(emp: { first_name: string; last_name: string } | null | undefined): string {
  if (!emp) return '—'
  return `${emp.first_name} ${emp.last_name}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminSuccession() {
  const qc = useQueryClient()

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [planForm, setPlanForm]     = useState(emptyPlanForm)
  const [editOpen, setEditOpen]     = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editForm, setEditForm]     = useState(emptyPlanForm)

  // Plan detail dialog
  const [detailId, setDetailId]     = useState<string | null>(null)
  const [addCandOpen, setAddCandOpen] = useState(false)
  const [candForm, setCandForm]     = useState(emptyCandidateForm)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: dashboard } = useQuery<Dashboard>({
    queryKey: ['succession-dashboard'],
    queryFn:  () => api.get<{ data: Dashboard }>('/succession/dashboard').then(r => r.data),
    staleTime: 30_000,
  })

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ['succession-plans'],
    queryFn:  () => api.get<{ data: Plan[] }>('/succession/plans').then(r => r.data ?? []),
  })

  const { data: planDetail, isLoading: detailLoading } = useQuery<PlanDetail>({
    queryKey: ['succession-plan', detailId],
    queryFn:  () => api.get<{ data: PlanDetail }>(`/succession/plans/${detailId}`).then(r => r.data),
    enabled:  !!detailId,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['succession-plans'] })
    qc.invalidateQueries({ queryKey: ['succession-dashboard'] })
  }

  const createPlan = useMutation({
    mutationFn: (body: typeof emptyPlanForm) => api.post('/succession/plans', {
      ...body,
      department:   body.department   || undefined,
      incumbent_id: body.incumbent_id || undefined,
      notes:        body.notes        || undefined,
    }),
    onSuccess: () => {
      invalidateAll()
      setCreateOpen(false)
      setPlanForm(emptyPlanForm)
      toast.success('Succession plan created')
    },
    onError: (e: Error) => toast.error('Failed to create plan', { description: e.message }),
  })

  const updatePlan = useMutation({
    mutationFn: ({ id, body }: { id: string; body: typeof emptyPlanForm }) =>
      api.put(`/succession/plans/${id}`, {
        ...body,
        department:   body.department   || undefined,
        incumbent_id: body.incumbent_id || undefined,
        notes:        body.notes        || undefined,
      }),
    onSuccess: (_data, { id }) => {
      invalidateAll()
      qc.invalidateQueries({ queryKey: ['succession-plan', id] })
      setEditOpen(false)
      setEditingId(null)
      setEditForm(emptyPlanForm)
      toast.success('Plan updated')
    },
    onError: (e: Error) => toast.error('Failed to update plan', { description: e.message }),
  })

  const archivePlan = useMutation({
    mutationFn: (id: string) => api.post(`/succession/plans/${id}/archive`, {}),
    onSuccess: (_data, id) => {
      invalidateAll()
      if (detailId === id) setDetailId(null)
      toast.success('Plan archived')
    },
    onError: (e: Error) => toast.error('Failed to archive', { description: e.message }),
  })

  const addCandidate = useMutation({
    mutationFn: (body: typeof emptyCandidateForm) =>
      api.post(`/succession/plans/${detailId}/candidates`, {
        ...body,
        readiness_score:  body.readiness_score ? Number(body.readiness_score) : undefined,
        strengths:        body.strengths        || undefined,
        gaps:             body.gaps             || undefined,
        development_plan: body.development_plan || undefined,
        notes:            body.notes            || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['succession-plan', detailId] })
      invalidateAll()
      setAddCandOpen(false)
      setCandForm(emptyCandidateForm)
      toast.success('Candidate added')
    },
    onError: (e: Error) => toast.error('Failed to add candidate', { description: e.message }),
  })

  const removeCandidate = useMutation({
    mutationFn: ({ planId, cid }: { planId: string; cid: string }) =>
      api.delete(`/succession/plans/${planId}/candidates/${cid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['succession-plan', detailId] })
      invalidateAll()
      toast.success('Candidate removed')
    },
    onError: (e: Error) => toast.error('Failed to remove candidate', { description: e.message }),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleCreatePlan = () => {
    if (!planForm.position_title.trim()) { toast.error('Position title is required'); return }
    createPlan.mutate(planForm)
  }

  const openEdit = (plan: Plan) => {
    setEditingId(plan.id)
    setEditForm({
      position_title: plan.position_title,
      department:     plan.department ?? '',
      incumbent_id:   plan.employees?.id ?? '',
      risk_level:     plan.risk_level,
      notes:          plan.notes ?? '',
    })
    setEditOpen(true)
  }

  const handleUpdatePlan = () => {
    if (!editForm.position_title.trim()) { toast.error('Position title is required'); return }
    if (!editingId) return
    updatePlan.mutate({ id: editingId, body: editForm })
  }

  const handleAddCandidate = () => {
    if (!candForm.employee_id.trim()) { toast.error('Employee ID is required'); return }
    addCandidate.mutate(candForm)
  }

  // ── Grouped plans by risk ──────────────────────────────────────────────────

  const plansByRisk = RISK_ORDER.reduce<Record<RiskLevel, Plan[]>>((acc, r) => {
    acc[r] = plans.filter(p => p.risk_level === r)
    return acc
  }, { critical: [], high: [], medium: [], low: [] })

  const hasPlans = plans.length > 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Succession Planning"
        subtitle="Identify key positions, assess succession risk, and build your leadership pipeline"
        actions={
          <Button size="sm" onClick={() => { setPlanForm(emptyPlanForm); setCreateOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" />New Plan
          </Button>
        }
      />

      {/* ── Dashboard stat cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Total Plans</p>
          </div>
          <p className="text-xl font-semibold">{dashboard?.total_plans ?? plans.length}</p>
        </div>

        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-xs text-muted-foreground">Critical Risk</p>
          </div>
          <p className="text-xl font-semibold text-destructive">
            {dashboard?.risk_breakdown.critical ?? plansByRisk.critical.length}
          </p>
        </div>

        <div className="rounded-lg border border-success/20 bg-success/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className="h-4 w-4 text-success" />
            <p className="text-xs text-muted-foreground">Ready Now</p>
          </div>
          <p className="text-xl font-semibold text-success">{dashboard?.ready_now ?? 0}</p>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Coverage Rate</p>
          </div>
          <p className="text-xl font-semibold">{dashboard?.coverage_rate ?? 0}%</p>
        </div>
      </div>

      {/* ── Plans list ──────────────────────────────────────────────────────── */}
      <SectionCard
        title="Succession Plans"
        description="Organised by risk level — click a plan to view details and manage candidates"
      >
        {plansLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasPlans ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <TrendingUp className="h-8 w-8" />
            <p className="text-sm">No succession plans yet.</p>
            <p className="text-xs">Create the first plan to start building your leadership pipeline.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {RISK_ORDER.map(risk => {
              const group = plansByRisk[risk]
              if (group.length === 0) return null
              return (
                <div key={risk}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn(
                      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      riskBadgeClass(risk),
                    )}>
                      {riskLabel(risk)} Risk
                    </span>
                    <span className="text-xs text-muted-foreground">{group.length} plan{group.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="rounded-md border border-border overflow-hidden">
                    {group.map((plan, idx) => (
                      <button
                        key={plan.id}
                        onClick={() => setDetailId(plan.id)}
                        className={cn(
                          'w-full text-left flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors',
                          idx < group.length - 1 && 'border-b border-border/50',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium truncate">{plan.position_title}</span>
                            {plan.department && (
                              <span className="text-xs text-muted-foreground shrink-0">· {plan.department}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {plan.employees && (
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {fmtName(plan.employees)}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <UserCheck className="h-3 w-3" />
                              {plan.candidate_count} candidate{plan.candidate_count !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 ml-4 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={e => { e.stopPropagation(); openEdit(plan) }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit plan"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                if (window.confirm(`Archive "${plan.position_title}"? This cannot be undone.`)) {
                                  archivePlan.mutate(plan.id)
                                }
                              }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                              title="Archive plan"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Create Plan Dialog ──────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setCreateOpen(false); setPlanForm(emptyPlanForm) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Succession Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Position Title *</label>
              <input
                value={planForm.position_title}
                onChange={e => setPlanForm(f => ({ ...f, position_title: e.target.value }))}
                placeholder="e.g. Chief Financial Officer"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Department</label>
                <input
                  value={planForm.department}
                  onChange={e => setPlanForm(f => ({ ...f, department: e.target.value }))}
                  placeholder="e.g. Finance"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Risk Level</label>
                <select
                  value={planForm.risk_level}
                  onChange={e => setPlanForm(f => ({ ...f, risk_level: e.target.value as RiskLevel }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Incumbent Employee ID</label>
              <input
                value={planForm.incumbent_id}
                onChange={e => setPlanForm(f => ({ ...f, incumbent_id: e.target.value }))}
                placeholder="Employee UUID (optional)"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <textarea
                value={planForm.notes}
                onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Context, urgency, or special considerations…"
                rows={3}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setCreateOpen(false); setPlanForm(emptyPlanForm) }}>
                Cancel
              </Button>
              <Button onClick={handleCreatePlan} disabled={createPlan.isPending}>
                {createPlan.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Create Plan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Plan Dialog ────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={o => { if (!o) { setEditOpen(false); setEditingId(null); setEditForm(emptyPlanForm) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Succession Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Position Title *</label>
              <input
                value={editForm.position_title}
                onChange={e => setEditForm(f => ({ ...f, position_title: e.target.value }))}
                placeholder="e.g. Chief Financial Officer"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Department</label>
                <input
                  value={editForm.department}
                  onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))}
                  placeholder="e.g. Finance"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Risk Level</label>
                <select
                  value={editForm.risk_level}
                  onChange={e => setEditForm(f => ({ ...f, risk_level: e.target.value as RiskLevel }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Incumbent Employee ID</label>
              <input
                value={editForm.incumbent_id}
                onChange={e => setEditForm(f => ({ ...f, incumbent_id: e.target.value }))}
                placeholder="Employee UUID (optional)"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Context, urgency, or special considerations…"
                rows={3}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setEditOpen(false); setEditingId(null); setEditForm(emptyPlanForm) }}>
                Cancel
              </Button>
              <Button onClick={handleUpdatePlan} disabled={updatePlan.isPending}>
                {updatePlan.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Plan Detail Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!detailId} onOpenChange={o => { if (!o) setDetailId(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailLoading || !planDetail ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span>{planDetail.position_title}</span>
                  <span className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    riskBadgeClass(planDetail.risk_level),
                  )}>
                    {riskLabel(planDetail.risk_level)} Risk
                  </span>
                </DialogTitle>
              </DialogHeader>

              {/* Plan meta */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Department</p>
                  <p className="text-sm">{planDetail.department ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Incumbent</p>
                  <p className="text-sm">
                    {planDetail.employees ? (
                      <>
                        {fmtName(planDetail.employees)}
                        <span className="text-xs text-muted-foreground ml-1">({planDetail.employees.employee_code})</span>
                      </>
                    ) : '—'}
                  </p>
                </div>
                {planDetail.notes && (
                  <div className="col-span-2 rounded-lg bg-muted/30 p-3">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-sm text-muted-foreground">{planDetail.notes}</p>
                  </div>
                )}
              </div>

              {/* Plan actions */}
              <div className="flex gap-2 mt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDetailId(null)
                    openEdit({
                      ...planDetail,
                      candidate_count: planDetail.candidates.length,
                    })
                  }}
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1" />Edit Plan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={archivePlan.isPending}
                  onClick={() => {
                    if (window.confirm(`Archive "${planDetail.position_title}"?`)) {
                      archivePlan.mutate(planDetail.id)
                    }
                  }}
                >
                  Archive Plan
                </Button>
              </div>

              {/* Candidates section */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">
                    Candidates
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({planDetail.candidates.length})
                    </span>
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setCandForm(emptyCandidateForm); setAddCandOpen(true) }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />Add Candidate
                  </Button>
                </div>

                {planDetail.candidates.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground rounded-lg border border-dashed border-border">
                    <Users className="h-6 w-6" />
                    <p className="text-sm">No candidates yet.</p>
                    <p className="text-xs">Add employees to the succession pool for this position.</p>
                  </div>
                ) : (
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                          <th className="text-left py-2 px-3 text-xs font-medium">Employee</th>
                          <th className="text-left py-2 px-3 text-xs font-medium">Readiness</th>
                          <th className="text-left py-2 px-3 text-xs font-medium">Score</th>
                          <th className="text-left py-2 px-3 text-xs font-medium">Strengths</th>
                          <th className="text-left py-2 px-3 text-xs font-medium">Gaps</th>
                          <th className="py-2 px-3 text-xs font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {planDetail.candidates.map(c => (
                          <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <td className="py-2 px-3">
                              <p className="text-xs font-medium">{fmtName(c.employees)}</p>
                              {c.employees && (
                                <p className="text-[10px] text-muted-foreground">
                                  {c.employees.employee_code}
                                  {c.employees.designation && ` · ${c.employees.designation}`}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <ReadinessBadge level={c.readiness_level} />
                            </td>
                            <td className="py-2 px-3">
                              {c.readiness_score != null ? (
                                <div className="flex items-center gap-1.5">
                                  <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={cn('h-full rounded-full transition-all', c.readiness_score >= 70 ? 'bg-success' : c.readiness_score >= 40 ? 'bg-warning' : 'bg-destructive')}
                                      style={{ width: `${c.readiness_score}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-muted-foreground">{c.readiness_score}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground max-w-[120px]">
                              <p className="truncate" title={c.strengths ?? undefined}>{c.strengths ?? '—'}</p>
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground max-w-[120px]">
                              <p className="truncate" title={c.gaps ?? undefined}>{c.gaps ?? '—'}</p>
                            </td>
                            <td className="py-2 px-3">
                              <button
                                onClick={() => {
                                  if (window.confirm('Remove this candidate from the succession pool?')) {
                                    removeCandidate.mutate({ planId: planDetail.id, cid: c.id })
                                  }
                                }}
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                                title="Remove candidate"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add Candidate Dialog ────────────────────────────────────────────── */}
      <Dialog open={addCandOpen} onOpenChange={o => { if (!o) { setAddCandOpen(false); setCandForm(emptyCandidateForm) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Succession Candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Employee ID *</label>
              <input
                value={candForm.employee_id}
                onChange={e => setCandForm(f => ({ ...f, employee_id: e.target.value }))}
                placeholder="Employee UUID"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Readiness Level</label>
                <select
                  value={candForm.readiness_level}
                  onChange={e => setCandForm(f => ({ ...f, readiness_level: e.target.value as ReadinessLevel }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                >
                  <option value="ready_now">Ready Now</option>
                  <option value="ready_1_2_years">1–2 Years</option>
                  <option value="ready_3_5_years">3–5 Years</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Readiness Score (0–100)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={candForm.readiness_score}
                  onChange={e => setCandForm(f => ({ ...f, readiness_score: e.target.value }))}
                  placeholder="e.g. 75"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Strengths</label>
              <textarea
                value={candForm.strengths}
                onChange={e => setCandForm(f => ({ ...f, strengths: e.target.value }))}
                placeholder="Key strengths relevant to this role…"
                rows={2}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Gaps</label>
              <textarea
                value={candForm.gaps}
                onChange={e => setCandForm(f => ({ ...f, gaps: e.target.value }))}
                placeholder="Development areas and skill gaps…"
                rows={2}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Development Plan</label>
              <textarea
                value={candForm.development_plan}
                onChange={e => setCandForm(f => ({ ...f, development_plan: e.target.value }))}
                placeholder="Actions, milestones, and timelines to close gaps…"
                rows={2}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setAddCandOpen(false); setCandForm(emptyCandidateForm) }}>
                Cancel
              </Button>
              <Button onClick={handleAddCandidate} disabled={addCandidate.isPending}>
                {addCandidate.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Add Candidate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
