/**
 * AdminInterviewAnalytics — /admin/recruitment/interview-analytics  (INT-06 depth)
 *
 * Builds on the S15 recruitment dashboard with two depth views the audit
 * flagged as missing:
 *   • Per-criterion effectiveness — which scoring criteria actually separate
 *     hired candidates from rejected ones (predictive "lift").
 *   • Interviewer / panel calibration — leniency vs. cohort, consistency,
 *     decision accuracy against final outcome, and inter-rater agreement.
 *
 * All metrics derive from existing interview_scores correlated with the final
 * application outcome — no new data capture required.
 */

import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { Target, Users, Gauge, Loader2, AlertCircle, TrendingUp, Scale } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { api } from '@/lib/api/client'
import { cn }  from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface InterviewerRow {
  interviewer_id: string
  name: string
  scored_count: number
  avg_overall: number | null
  leniency: number | null
  consistency: number | null
  positive_rate: number | null
  recommendations: Record<string, number>
  hire_accuracy: number | null
  reject_accuracy: number | null
  decisions_with_outcome: number
}
interface CriterionRow {
  criterion: string
  avg_hired: number | null
  avg_rejected: number | null
  lift: number | null
  sample_hired: number
  sample_rejected: number
}
interface DepthData {
  cohort_avg_overall: number | null
  total_scores: number
  interviewers: InterviewerRow[]
  criteria: CriterionRow[]
  agreement: { multi_scorer_rounds: number; avg_score_spread: number | null; unanimous_rate: number | null }
}

const CRIT_LABEL: Record<string, string> = { technical: 'Technical', communication: 'Communication', culture: 'Culture', overall: 'Overall' }

function leniencyBadge(l: number | null) {
  if (l === null) return { label: '—', cls: 'text-muted-foreground' }
  if (l >= 0.5)  return { label: `+${l.toFixed(2)} lenient`, cls: 'text-amber-600 bg-amber-50 border-amber-200' }
  if (l <= -0.5) return { label: `${l.toFixed(2)} strict`,   cls: 'text-blue-600 bg-blue-50 border-blue-200' }
  return { label: `${l > 0 ? '+' : ''}${l.toFixed(2)} balanced`, cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' }
}

export function AdminInterviewAnalytics() {
  const { data: res, isLoading, isError } = useQuery<{ data: DepthData }>({
    queryKey: ['recruitment', 'interview-analytics'],
    queryFn:  () => api.get('/recruitment/analytics/interviewers'),
    staleTime: 60_000,
  })
  const d = res?.data

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Interview Analytics" subtitle="Interviewer calibration & criterion effectiveness" />
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Crunching scorecards…
        </div>
      </PageContainer>
    )
  }
  if (isError || !d) {
    return (
      <PageContainer>
        <PageHeader title="Interview Analytics" subtitle="Interviewer calibration & criterion effectiveness" />
        <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
          <AlertCircle className="h-7 w-7" /><p className="text-sm">Couldn't load analytics.</p>
        </div>
      </PageContainer>
    )
  }

  const criteriaChart = d.criteria
    .filter(c => c.lift !== null)
    .map(c => ({ name: CRIT_LABEL[c.criterion] ?? c.criterion, lift: c.lift as number }))

  const noOutcomeYet = d.criteria.every(c => c.sample_hired === 0 && c.sample_rejected === 0)

  return (
    <PageContainer>
      <PageHeader title="Interview Analytics" subtitle="Interviewer calibration & criterion effectiveness (INT-06)" />

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat icon={Scale}    label="Cohort avg score" value={d.cohort_avg_overall != null ? d.cohort_avg_overall.toFixed(2) : '—'} sub="/ 5 overall" />
        <Stat icon={Users}    label="Scorecards" value={d.total_scores} sub="submitted" />
        <Stat icon={Gauge}    label="Panel agreement" value={d.agreement.unanimous_rate != null ? `${d.agreement.unanimous_rate}%` : '—'} sub={`${d.agreement.multi_scorer_rounds} multi-rater rounds`} />
        <Stat icon={TrendingUp} label="Avg score spread" value={d.agreement.avg_score_spread != null ? d.agreement.avg_score_spread.toFixed(2) : '—'} sub="across panel (lower = aligned)" />
      </div>

      {/* Per-criterion effectiveness */}
      <SectionCard title="Criterion effectiveness" icon={<Target className="h-4 w-4 text-muted-foreground" />}>
        <p className="text-xs text-muted-foreground mb-3">
          How strongly each criterion separates <span className="text-emerald-600 font-medium">hired</span> from{' '}
          <span className="text-red-600 font-medium">rejected</span> candidates. Higher lift ⇒ the criterion is more predictive of a good hire.
        </p>
        {noOutcomeYet ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Not enough closed outcomes yet — effectiveness appears once candidates are hired/rejected after scoring.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={criteriaChart} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ fontSize: 12 }} formatter={(v: any) => [`${v} lift`, 'Hired − Rejected']} />
                <ReferenceLine x={0} stroke="hsl(var(--border))" />
                <Bar dataKey="lift" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {criteriaChart.map((c, i) => <Cell key={i} fill={c.lift >= 0 ? '#10b981' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="overflow-x-auto rounded-md border border-border self-start">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 text-xs font-medium">Criterion</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Hired avg</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Rejected avg</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Lift</th>
                  </tr>
                </thead>
                <tbody>
                  {d.criteria.map(c => (
                    <tr key={c.criterion} className="border-b border-border/50">
                      <td className="py-2 px-3 text-xs font-medium">{CRIT_LABEL[c.criterion] ?? c.criterion}</td>
                      <td className="py-2 px-3 text-xs text-right text-emerald-600">{c.avg_hired ?? '—'}</td>
                      <td className="py-2 px-3 text-xs text-right text-red-600">{c.avg_rejected ?? '—'}</td>
                      <td className={cn('py-2 px-3 text-xs text-right font-semibold', (c.lift ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {c.lift != null ? (c.lift > 0 ? `+${c.lift}` : c.lift) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Interviewer calibration */}
      <SectionCard title="Interviewer calibration" icon={<Gauge className="h-4 w-4 text-muted-foreground" />}>
        <p className="text-xs text-muted-foreground mb-3">
          Leniency is each interviewer's average overall score vs. the cohort. Accuracy compares their recommendations against final outcomes (only counts decisions with a closed outcome).
        </p>
        {d.interviewers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No scorecards submitted yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="text-left py-2 px-3 text-xs font-medium">Interviewer</th>
                  <th className="text-right py-2 px-3 text-xs font-medium">Scored</th>
                  <th className="text-right py-2 px-3 text-xs font-medium">Avg</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Calibration</th>
                  <th className="text-right py-2 px-3 text-xs font-medium">Consistency</th>
                  <th className="text-right py-2 px-3 text-xs font-medium">Positive %</th>
                  <th className="text-right py-2 px-3 text-xs font-medium">Hire acc.</th>
                  <th className="text-right py-2 px-3 text-xs font-medium">Reject acc.</th>
                </tr>
              </thead>
              <tbody>
                {d.interviewers.map(iv => {
                  const lb = leniencyBadge(iv.leniency)
                  return (
                    <tr key={iv.interviewer_id} className="border-b border-border/50">
                      <td className="py-2 px-3 text-xs font-medium">{iv.name}</td>
                      <td className="py-2 px-3 text-xs text-right">{iv.scored_count}</td>
                      <td className="py-2 px-3 text-xs text-right">{iv.avg_overall ?? '—'}</td>
                      <td className="py-2 px-3"><Badge variant="outline" className={cn('text-[10px]', lb.cls)}>{lb.label}</Badge></td>
                      <td className="py-2 px-3 text-xs text-right" title="Std-dev of overall scores (lower = more consistent)">{iv.consistency ?? '—'}</td>
                      <td className="py-2 px-3 text-xs text-right">{iv.positive_rate != null ? `${iv.positive_rate}%` : '—'}</td>
                      <td className="py-2 px-3 text-xs text-right">{iv.hire_accuracy != null ? `${iv.hire_accuracy}%` : <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="py-2 px-3 text-xs text-right">{iv.reject_accuracy != null ? `${iv.reject_accuracy}%` : <span className="text-muted-foreground/50">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}

function Stat({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="text-xl font-semibold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
