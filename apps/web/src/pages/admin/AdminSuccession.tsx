/**
 * AdminSuccession — /admin/succession
 *
 * Succession Planning Intelligence: manage per-position succession plans,
 * track candidate readiness, 9-Box Grid, AI Recommendations, IDP Actions.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, TrendingUp, AlertTriangle, Shield,
  Plus, ChevronRight, Loader2, UserCheck, Clock, Target,
  Edit2, Trash2, X, CheckCircle2, Brain, Award, Layers,
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
type ActionType     = 'course' | 'assignment' | 'mentoring' | 'certification' | 'coaching'

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
  id:                  string
  readiness_level:     ReadinessLevel
  readiness_score:     number | null
  strengths:           string | null
  gaps:                string | null
  development_plan:    string | null
  notes:               string | null
  created_at:          string
  nine_box_performance: number | null
  nine_box_potential:   number | null
  score_performance:    number | null
  score_skill_gap:      number | null
  score_leadership:     number | null
  score_mobility:       number | null
  score_tenure:         number | null
  score_attrition_risk: number | null
  attrition_risk_flag:  boolean
  employees:           CandidateEmployee | null
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

interface NineBoxData {
  grid:      Record<string, Candidate[]>
  ungrouped: Candidate[]
}

interface AIRecommendation {
  candidate:      Candidate
  employee:       CandidateEmployee | null
  weighted_score: number
  readiness_tier: string
}

interface AIRecommendationsData {
  plan:            Plan
  recommendations: AIRecommendation[]
}

interface IDPAction {
  id:           string
  action_type:  ActionType
  description:  string
  target_date:  string | null
  completed_at: string | null
  created_at:   string
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

const emptyScorecardForm = {
  nine_box_performance:  '' as string,
  nine_box_potential:    '' as string,
  score_performance:     '' as string,
  score_skill_gap:       '' as string,
  score_leadership:      '' as string,
  score_mobility:        '' as string,
  score_tenure:          '' as string,
  score_attrition_risk:  '' as string,
  attrition_risk_flag:   false,
}

const emptyIDPForm = {
  action_type:  'course' as ActionType,
  description:  '',
  target_date:  '',
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

function computeWeightedScore(c: Candidate): number {
  const {
    score_performance, score_skill_gap, score_leadership,
    score_mobility, score_tenure, score_attrition_risk, readiness_score,
  } = c
  if (
    score_performance != null && score_skill_gap != null && score_leadership != null &&
    score_mobility    != null && score_tenure    != null && score_attrition_risk != null
  ) {
    return (
      score_performance    * 0.25 +
      score_skill_gap      * 0.20 +
      score_leadership     * 0.20 +
      score_mobility       * 0.15 +
      score_tenure         * 0.10 +
      score_attrition_risk * 0.10
    )
  }
  return readiness_score != null ? readiness_score / 10 : 0
}

// 9-Box cell definitions: (performance, potential)
const NINE_BOX_LABELS: Record<string, { label: string; color: string; textColor: string }> = {
  '3,3': { label: 'Star',               color: 'bg-emerald-500/20 border-emerald-500/40', textColor: 'text-emerald-700 dark:text-emerald-400' },
  '3,2': { label: 'High Performer',     color: 'bg-green-500/15 border-green-500/30',     textColor: 'text-green-700 dark:text-green-400' },
  '2,3': { label: 'Rising Star',        color: 'bg-teal-500/15 border-teal-500/30',       textColor: 'text-teal-700 dark:text-teal-400' },
  '3,1': { label: 'Dependable Expert',  color: 'bg-blue-500/10 border-blue-500/30',       textColor: 'text-blue-700 dark:text-blue-400' },
  '2,2': { label: 'Key Player',         color: 'bg-sky-500/10 border-sky-500/30',         textColor: 'text-sky-700 dark:text-sky-400' },
  '1,3': { label: 'Rough Diamond',      color: 'bg-violet-500/10 border-violet-500/30',   textColor: 'text-violet-700 dark:text-violet-400' },
  '2,1': { label: 'Solid Contributor',  color: 'bg-yellow-500/10 border-yellow-500/30',   textColor: 'text-yellow-700 dark:text-yellow-400' },
  '1,2': { label: 'Core Player',        color: 'bg-orange-500/10 border-orange-500/30',   textColor: 'text-orange-700 dark:text-orange-400' },
  '1,1': { label: 'Underperformer',     color: 'bg-red-500/10 border-red-500/30',         textColor: 'text-red-700 dark:text-red-400' },
}

function tierBadgeClass(tier: string): string {
  switch (tier) {
    case 'Ready Now':          return 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400'
    case 'Ready in 12 Months': return 'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400'
    case 'Ready in 24 Months': return 'bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-400'
    default:                   return 'bg-muted text-muted-foreground border-border'
  }
}

function actionTypeLabel(t: ActionType): string {
  switch (t) {
    case 'course':        return 'Course'
    case 'assignment':    return 'Assignment'
    case 'mentoring':     return 'Mentoring'
    case 'certification': return 'Certification'
    case 'coaching':      return 'Coaching'
  }
}

function actionTypeBadgeClass(t: ActionType): string {
  switch (t) {
    case 'course':        return 'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400'
    case 'assignment':    return 'bg-purple-500/10 text-purple-700 border-purple-500/30 dark:text-purple-400'
    case 'mentoring':     return 'bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-400'
    case 'certification': return 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400'
    case 'coaching':      return 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-400'
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NineBoxGrid({ data }: { data: NineBoxData }) {
  // Rows: potential 3 (top) → 1 (bottom); Cols: performance 1 → 3
  const potentials  = [3, 2, 1]
  const performances = [1, 2, 3]
  const potentialLabels  = ['Low', 'Medium', 'High']
  const performanceLabels = ['Low', 'Medium', 'High']

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {/* Y-axis label */}
        <div className="flex flex-col items-center justify-center" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', minWidth: 24 }}>
          <span className="text-xs text-muted-foreground font-medium">Potential</span>
        </div>

        <div className="flex-1">
          {/* Grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {potentials.map(pot => (
              performances.map(perf => {
                const key = `${perf},${pot}`
                const cell = NINE_BOX_LABELS[key]
                const candidates = data.grid[key] ?? []
                return (
                  <div
                    key={key}
                    className={cn(
                      'rounded-lg border p-2.5 min-h-[90px]',
                      cell?.color ?? 'bg-muted/20 border-border',
                    )}
                  >
                    <p className={cn('text-[10px] font-semibold mb-1.5 uppercase tracking-wide', cell?.textColor ?? 'text-muted-foreground')}>
                      {cell?.label ?? key}
                    </p>
                    {candidates.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/60 italic">—</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {candidates.map(c => (
                          <span
                            key={c.id}
                            className="inline-flex items-center rounded-full bg-background/70 border border-border px-1.5 py-0.5 text-[9px] font-medium truncate max-w-[80px]"
                            title={fmtName(c.employees)}
                          >
                            {fmtName(c.employees)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            ))}
          </div>

          {/* X-axis labels */}
          <div className="grid grid-cols-3 gap-1.5 mt-1.5">
            {performanceLabels.map(l => (
              <div key={l} className="text-center text-[10px] text-muted-foreground">{l}</div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-1 font-medium">Performance</p>
        </div>
      </div>

      {/* Ungrouped note */}
      {data.ungrouped.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <Layers className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>{data.ungrouped.length}</strong> candidate{data.ungrouped.length !== 1 ? 's' : ''} not yet placed on the grid.
            Edit candidates to assign their performance &amp; potential ratings.
          </span>
        </div>
      )}
    </div>
  )
}

function AIRecommendationsPanel({ data }: { data: AIRecommendationsData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
        <Brain className="h-8 w-8" />
        <p className="text-sm">No active plans yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {data.map(({ plan, recommendations }) => (
        <div key={plan.id} className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="text-sm font-semibold flex-1 truncate">{plan.position_title}</h3>
            {plan.department && (
              <span className="text-xs text-muted-foreground">{plan.department}</span>
            )}
            <span className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
              riskBadgeClass(plan.risk_level),
            )}>
              {riskLabel(plan.risk_level)}
            </span>
          </div>

          {recommendations.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">No candidates with readiness scores assigned.</p>
          ) : (
            <div className="space-y-2">
              {recommendations.map((rec, idx) => (
                <div key={rec.candidate.id} className="flex items-center gap-3 rounded-md bg-muted/20 border border-border/50 px-3 py-2">
                  <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium truncate">{fmtName(rec.employee)}</span>
                      {rec.employee?.designation && (
                        <span className="text-[10px] text-muted-foreground shrink-0 truncate max-w-[120px]">{rec.employee.designation}</span>
                      )}
                      {rec.candidate.attrition_risk_flag && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30 px-1.5 py-0.5 text-[9px] font-medium shrink-0">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Attrition Risk
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            rec.readiness_tier === 'Ready Now'          ? 'bg-green-500' :
                            rec.readiness_tier === 'Ready in 12 Months' ? 'bg-blue-500'  :
                            rec.readiness_tier === 'Ready in 24 Months' ? 'bg-orange-500':
                            'bg-muted-foreground/40',
                          )}
                          style={{ width: `${(rec.weighted_score / 10) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground shrink-0">{rec.weighted_score}/10</span>
                    </div>
                  </div>
                  <span className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0',
                    tierBadgeClass(rec.readiness_tier),
                  )}>
                    {rec.readiness_tier}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── IDP Actions section (shown inside plan detail dialog per candidate) ────────

function IDPSection({
  planId,
  candidate,
}: {
  planId: string
  candidate: Candidate
}) {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [idpForm, setIdpForm] = useState(emptyIDPForm)

  const { data: actions = [], isLoading } = useQuery<IDPAction[]>({
    queryKey: ['succession-idp', planId, candidate.id],
    queryFn:  () =>
      api.get<{ data: IDPAction[] }>(`/succession/plans/${planId}/candidates/${candidate.id}/idp`)
        .then(r => r.data ?? []),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['succession-idp', planId, candidate.id] })

  const addAction = useMutation({
    mutationFn: (body: typeof emptyIDPForm) =>
      api.post(`/succession/plans/${planId}/candidates/${candidate.id}/idp`, {
        ...body,
        target_date: body.target_date || undefined,
      }),
    onSuccess: () => { invalidate(); setAddOpen(false); setIdpForm(emptyIDPForm); toast.success('IDP action added') },
    onError:   (e: Error) => toast.error('Failed to add action', { description: e.message }),
  })

  const markComplete = useMutation({
    mutationFn: (aid: string) =>
      api.patch(`/succession/plans/${planId}/candidates/${candidate.id}/idp/${aid}`, {
        completed_at: new Date().toISOString(),
      }),
    onSuccess: () => { invalidate(); toast.success('Marked complete') },
    onError:   (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const deleteAction = useMutation({
    mutationFn: (aid: string) =>
      api.delete(`/succession/plans/${planId}/candidates/${candidate.id}/idp/${aid}`),
    onSuccess: () => { invalidate(); toast.success('Action deleted') },
    onError:   (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <div className="mt-3 rounded-lg border border-border/50 bg-muted/10">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
          IDP Actions
          {actions.length > 0 && (
            <span className="text-[10px] font-normal text-muted-foreground">({actions.length})</span>
          )}
        </span>
        <button
          onClick={() => setAddOpen(v => !v)}
          className="text-[10px] text-primary hover:underline"
        >
          + Add
        </button>
      </div>

      {addOpen && (
        <div className="px-3 py-2 border-b border-border/40 space-y-2 bg-muted/20">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Type</label>
              <select
                value={idpForm.action_type}
                onChange={e => setIdpForm(f => ({ ...f, action_type: e.target.value as ActionType }))}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
              >
                <option value="course">Course</option>
                <option value="assignment">Assignment</option>
                <option value="mentoring">Mentoring</option>
                <option value="certification">Certification</option>
                <option value="coaching">Coaching</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Target Date</label>
              <input
                type="date"
                value={idpForm.target_date}
                onChange={e => setIdpForm(f => ({ ...f, target_date: e.target.value }))}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Description *</label>
            <input
              value={idpForm.description}
              onChange={e => setIdpForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the development action…"
              className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => { setAddOpen(false); setIdpForm(emptyIDPForm) }}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => addAction.mutate(idpForm)} disabled={addAction.isPending}>
              {addAction.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </div>
      ) : actions.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic px-3 py-2">No IDP actions yet.</p>
      ) : (
        <div className="divide-y divide-border/30">
          {actions.map(a => (
            <div key={a.id} className="flex items-start gap-2 px-3 py-2">
              <span className={cn(
                'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium shrink-0 mt-0.5',
                actionTypeBadgeClass(a.action_type as ActionType),
              )}>
                {actionTypeLabel(a.action_type as ActionType)}
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn('text-[11px]', a.completed_at ? 'line-through text-muted-foreground' : '')}>
                  {a.description}
                </p>
                {a.target_date && (
                  <p className="text-[9px] text-muted-foreground mt-0.5">
                    Target: {new Date(a.target_date).toLocaleDateString()}
                    {a.completed_at && ` · Completed: ${new Date(a.completed_at).toLocaleDateString()}`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!a.completed_at && (
                  <button
                    onClick={() => markComplete.mutate(a.id)}
                    title="Mark complete"
                    className="p-0.5 rounded hover:bg-success/10 text-muted-foreground hover:text-success transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => {
                    if (window.confirm('Delete this IDP action?')) deleteAction.mutate(a.id)
                  }}
                  title="Delete"
                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Scorecard section (inside candidate edit dialog) ──────────────────────────

function ScorecardSection({
  form,
  onChange,
}: {
  form: typeof emptyScorecardForm
  onChange: (f: typeof emptyScorecardForm) => void
}) {
  const DIMENSIONS = [
    { key: 'score_performance',    label: 'Performance Track Record', weight: '25%' },
    { key: 'score_skill_gap',      label: 'Skill Gap to Target Role',  weight: '20%' },
    { key: 'score_leadership',     label: 'Leadership Competency',     weight: '20%' },
    { key: 'score_mobility',       label: 'Mobility / Transfer Willingness', weight: '15%' },
    { key: 'score_tenure',         label: 'Tenure & Experience',       weight: '10%' },
    { key: 'score_attrition_risk', label: 'Attrition Risk Score',      weight: '10%' },
  ] as const

  const weighted = (() => {
    const weights = [0.25, 0.20, 0.20, 0.15, 0.10, 0.10]
    const scores  = DIMENSIONS.map(d => parseFloat(form[d.key] as string))
    if (scores.some(s => isNaN(s))) return null
    return scores.reduce((acc, s, i) => acc + s * weights[i], 0).toFixed(1)
  })()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Readiness Scorecard</p>
        {weighted != null && (
          <span className="text-xs font-medium">
            Weighted Score: <strong className="text-foreground">{weighted}/10</strong>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {DIMENSIONS.map(dim => (
          <div key={dim.key}>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">
              {dim.label} <span className="text-primary/70">({dim.weight})</span>
            </label>
            <input
              type="number"
              min={0}
              max={10}
              value={form[dim.key]}
              onChange={e => onChange({ ...form, [dim.key]: e.target.value })}
              placeholder="0–10"
              className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
            />
          </div>
        ))}
      </div>

      {/* 9-Box selects */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Performance Rating</label>
          <select
            value={form.nine_box_performance}
            onChange={e => onChange({ ...form, nine_box_performance: e.target.value })}
            className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">— Not set —</option>
            <option value="1">1 – Low</option>
            <option value="2">2 – Medium</option>
            <option value="3">3 – High</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Potential Rating</label>
          <select
            value={form.nine_box_potential}
            onChange={e => onChange({ ...form, nine_box_potential: e.target.value })}
            className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">— Not set —</option>
            <option value="1">1 – Low</option>
            <option value="2">2 – Medium</option>
            <option value="3">3 – High</option>
          </select>
        </div>
      </div>

      {/* Attrition risk flag */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.attrition_risk_flag}
          onChange={e => onChange({ ...form, attrition_risk_flag: e.target.checked })}
          className="rounded"
        />
        <span className="text-xs text-muted-foreground">
          Attrition risk — candidate may leave within 12 months
        </span>
      </label>
    </div>
  )
}

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = 'plans' | 'nine-box' | 'ai-recommendations'

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminSuccession() {
  const qc = useQueryClient()

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>('plans')

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

  // Candidate scorecard edit dialog
  const [scorecardCand, setScorecardCand]   = useState<Candidate | null>(null)
  const [scorecardPlanId, setScorecardPlanId] = useState<string | null>(null)
  const [scorecardForm, setScorecardForm]   = useState(emptyScorecardForm)

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

  const { data: nineBoxRaw, isLoading: nineBoxLoading } = useQuery<NineBoxData>({
    queryKey: ['succession-nine-box'],
    queryFn:  () => api.get<{ data: NineBoxData }>('/succession/nine-box').then(r => r.data),
    enabled:  activeTab === 'nine-box',
  })

  const { data: aiRecs = [], isLoading: aiLoading } = useQuery<AIRecommendationsData[]>({
    queryKey: ['succession-ai-recommendations'],
    queryFn:  () => api.get<{ data: AIRecommendationsData[] }>('/succession/ai-recommendations').then(r => r.data ?? []),
    enabled:  activeTab === 'ai-recommendations',
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['succession-plans'] })
    qc.invalidateQueries({ queryKey: ['succession-dashboard'] })
    qc.invalidateQueries({ queryKey: ['succession-nine-box'] })
    qc.invalidateQueries({ queryKey: ['succession-ai-recommendations'] })
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

  const updateScorecard = useMutation({
    mutationFn: ({ planId, cid, body }: { planId: string; cid: string; body: Record<string, unknown> }) =>
      api.put(`/succession/plans/${planId}/candidates/${cid}`, body),
    onSuccess: (_data, { planId }) => {
      qc.invalidateQueries({ queryKey: ['succession-plan', planId] })
      invalidateAll()
      setScorecardCand(null)
      setScorecardPlanId(null)
      setScorecardForm(emptyScorecardForm)
      toast.success('Scorecard updated')
    },
    onError: (e: Error) => toast.error('Failed to update scorecard', { description: e.message }),
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

  const openScorecard = (c: Candidate, planId: string) => {
    setScorecardCand(c)
    setScorecardPlanId(planId)
    setScorecardForm({
      nine_box_performance:  c.nine_box_performance?.toString()  ?? '',
      nine_box_potential:    c.nine_box_potential?.toString()    ?? '',
      score_performance:     c.score_performance?.toString()     ?? '',
      score_skill_gap:       c.score_skill_gap?.toString()       ?? '',
      score_leadership:      c.score_leadership?.toString()      ?? '',
      score_mobility:        c.score_mobility?.toString()        ?? '',
      score_tenure:          c.score_tenure?.toString()          ?? '',
      score_attrition_risk:  c.score_attrition_risk?.toString()  ?? '',
      attrition_risk_flag:   c.attrition_risk_flag,
    })
  }

  const handleSaveScorecard = () => {
    if (!scorecardCand || !scorecardPlanId) return
    const toNum = (v: string) => v !== '' ? Number(v) : undefined
    const body: Record<string, unknown> = {
      nine_box_performance: toNum(scorecardForm.nine_box_performance),
      nine_box_potential:   toNum(scorecardForm.nine_box_potential),
      score_performance:    toNum(scorecardForm.score_performance),
      score_skill_gap:      toNum(scorecardForm.score_skill_gap),
      score_leadership:     toNum(scorecardForm.score_leadership),
      score_mobility:       toNum(scorecardForm.score_mobility),
      score_tenure:         toNum(scorecardForm.score_tenure),
      score_attrition_risk: toNum(scorecardForm.score_attrition_risk),
      attrition_risk_flag:  scorecardForm.attrition_risk_flag,
    }
    // Remove undefined
    Object.keys(body).forEach(k => body[k] === undefined && delete body[k])
    updateScorecard.mutate({ planId: scorecardPlanId, cid: scorecardCand.id, body })
  }

  // ── Grouped plans by risk ──────────────────────────────────────────────────

  const plansByRisk = RISK_ORDER.reduce<Record<RiskLevel, Plan[]>>((acc, r) => {
    acc[r] = plans.filter(p => p.risk_level === r)
    return acc
  }, { critical: [], high: [], medium: [], low: [] })

  const hasPlans = plans.length > 0

  // ── Tab bar ────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'plans',            label: 'Plans',             icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { id: 'nine-box',         label: '9-Box Grid',        icon: <Layers className="h-3.5 w-3.5" /> },
    { id: 'ai-recommendations', label: 'AI Recommendations', icon: <Brain className="h-3.5 w-3.5" /> },
  ]

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

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border mb-5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Plans tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'plans' && (
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
      )}

      {/* ── 9-Box Grid tab ──────────────────────────────────────────────────── */}
      {activeTab === 'nine-box' && (
        <SectionCard
          title="9-Box Grid"
          description="Performance vs Potential matrix — place candidates to identify Stars, Rising Stars, and development priorities"
        >
          {nineBoxLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !nineBoxRaw ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data available.</p>
          ) : (
            <NineBoxGrid data={nineBoxRaw} />
          )}
        </SectionCard>
      )}

      {/* ── AI Recommendations tab ──────────────────────────────────────────── */}
      {activeTab === 'ai-recommendations' && (
        <SectionCard
          title="AI Recommendations"
          description="Top 3 succession candidates per plan ranked by weighted readiness score"
        >
          {aiLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <AIRecommendationsPanel data={aiRecs} />
          )}
        </SectionCard>
      )}

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
                  <div className="space-y-3">
                    {planDetail.candidates.map(c => {
                      const ws = computeWeightedScore(c)
                      return (
                        <div key={c.id} className="rounded-lg border border-border overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium">{fmtName(c.employees)}</span>
                                  {c.employees?.designation && (
                                    <span className="text-[10px] text-muted-foreground truncate">{c.employees.designation}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <ReadinessBadge level={c.readiness_level} />
                                  {c.readiness_score != null && (
                                    <span className="text-[10px] text-muted-foreground">Score: {c.readiness_score}</span>
                                  )}
                                  {ws > 0 && (
                                    <span className="text-[10px] text-muted-foreground">Weighted: {ws.toFixed(1)}/10</span>
                                  )}
                                  {c.attrition_risk_flag && (
                                    <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30 px-1.5 py-0.5 text-[9px] font-medium">
                                      <AlertTriangle className="h-2.5 w-2.5" />
                                      Attrition Risk
                                    </span>
                                  )}
                                  {c.nine_box_performance != null && c.nine_box_potential != null && (
                                    <span className={cn(
                                      'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
                                      NINE_BOX_LABELS[`${c.nine_box_performance},${c.nine_box_potential}`]?.color ?? 'bg-muted border-border',
                                      NINE_BOX_LABELS[`${c.nine_box_performance},${c.nine_box_potential}`]?.textColor ?? 'text-muted-foreground',
                                    )}>
                                      {NINE_BOX_LABELS[`${c.nine_box_performance},${c.nine_box_potential}`]?.label ?? 'Grid'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <button
                                onClick={() => openScorecard(c, planDetail.id)}
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                                title="Edit scorecard"
                              >
                                <TrendingUp className="h-3.5 w-3.5" />
                              </button>
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
                            </div>
                          </div>

                          {/* Candidate detail rows */}
                          {(c.strengths || c.gaps) && (
                            <div className="grid grid-cols-2 divide-x divide-border/40 border-t border-border/40">
                              {c.strengths && (
                                <div className="px-3 py-1.5">
                                  <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Strengths</p>
                                  <p className="text-[11px]">{c.strengths}</p>
                                </div>
                              )}
                              {c.gaps && (
                                <div className="px-3 py-1.5">
                                  <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Gaps</p>
                                  <p className="text-[11px]">{c.gaps}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* IDP Actions */}
                          <div className="border-t border-border/40">
                            <IDPSection planId={planDetail.id} candidate={c} />
                          </div>
                        </div>
                      )
                    })}
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

      {/* ── Scorecard Edit Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!scorecardCand} onOpenChange={o => { if (!o) { setScorecardCand(null); setScorecardPlanId(null); setScorecardForm(emptyScorecardForm) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Readiness Scorecard — {fmtName(scorecardCand?.employees)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <ScorecardSection form={scorecardForm} onChange={setScorecardForm} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setScorecardCand(null); setScorecardPlanId(null); setScorecardForm(emptyScorecardForm) }}>
                Cancel
              </Button>
              <Button onClick={handleSaveScorecard} disabled={updateScorecard.isPending}>
                {updateScorecard.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Scorecard
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
