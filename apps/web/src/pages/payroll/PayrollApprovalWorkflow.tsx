/**
 * PayrollApprovalWorkflow — /admin/payroll/approvals
 *
 * Multi-stage payroll approval governance:
 * draft → HR review → Finance review → Compliance review → Approved → Payout
 *
 * Shows maker-checker log, readiness score, and inline approve/reject.
 * Role-based: hr_admin sees HR stage; finance sees finance stage; super_admin sees all.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GitMerge, CheckCircle2, XCircle, Clock, AlertTriangle,
  RefreshCw, Loader2, ChevronDown, ChevronRight,
  ShieldCheck, DollarSign, Scale, BadgeCheck,
  ArrowRight, Users,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'
import { invalidateAllPayrollRunViews } from './PayrollRuns'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MakerCheckerEntry {
  id:           string
  entity_type:  string
  entity_id:    string
  action:       string
  status:       'pending' | 'approved' | 'rejected' | 'auto_approved'
  maker_data:   Record<string, unknown>
  checker_notes: string | null
  submitted_at: string
  reviewed_at:  string | null
  sla_hours:    number | null
  is_escalated: boolean
  maker:        { full_name: string } | null
  checker:      { full_name: string } | null
}

interface ReadinessScore {
  score:  number
  max:    number
  grade:  string
  ready:  boolean
  month:  string
  frozen: boolean
  checks: Array<{
    key:    string
    label:  string
    score:  number
    max:    number
    detail: string
    pass:   boolean
  }>
  run: { id: string; status: string; month: string } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(s: string) {
  const iso = s
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

// ── Approval Pipeline Stages ───────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'draft',      label: 'Draft',            icon: <Clock className="h-3.5 w-3.5" /> },
  { key: 'hr_review',  label: 'HR Review',         icon: <Users className="h-3.5 w-3.5" /> },
  { key: 'finance',    label: 'Finance Review',    icon: <DollarSign className="h-3.5 w-3.5" /> },
  { key: 'compliance', label: 'Compliance',        icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { key: 'approved',   label: 'Approved',          icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { key: 'payout',     label: 'Payout',            icon: <BadgeCheck className="h-3.5 w-3.5" /> },
]

function deriveStage(score: ReadinessScore | null | undefined): string {
  if (!score) return 'draft'
  if (score.score >= 90) return 'approved'
  if (score.score >= 75) return 'compliance'
  if (score.score >= 60) return 'finance'
  if (score.score >= 40) return 'hr_review'
  return 'draft'
}

function PipelineStrip({ currentStage }: { currentStage: string }) {
  const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === currentStage)
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {PIPELINE_STAGES.map((stage, idx) => {
        const isComplete = idx < currentIdx
        const isCurrent  = idx === currentIdx
        return (
          <div key={stage.key} className="flex items-center flex-shrink-0">
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap',
              isComplete ? 'bg-success/15 border-success/30 text-success' :
              isCurrent  ? 'bg-primary/10 border-primary/30 text-primary' :
                           'bg-muted/20 border-border text-muted-foreground',
            )}>
              {stage.icon}
              <span>{stage.label}</span>
              {isComplete && <CheckCircle2 className="h-3 w-3" />}
            </div>
            {idx < PIPELINE_STAGES.length - 1 && (
              <ArrowRight className={cn('h-3.5 w-3.5 mx-1', idx < currentIdx ? 'text-success' : 'text-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Readiness Gauge ────────────────────────────────────────────────────────────

function ReadinessGauge({ score }: { score: ReadinessScore }) {
  const pct   = Math.round((score.score / score.max) * 100)
  const color = score.score >= 80 ? 'text-success' : score.score >= 60 ? 'text-warning' : 'text-destructive'
  const barColor = score.score >= 80 ? 'bg-success' : score.score >= 60 ? 'bg-warning' : 'bg-destructive'

  return (
    <div className="p-4 rounded-xl border border-border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Payroll Readiness</p>
          <p className="text-xs text-muted-foreground mt-0.5">{score.month} · Grade {score.grade}</p>
        </div>
        <div className="text-right">
          <p className={cn('text-3xl font-bold tabular-nums', color)}>{score.score}</p>
          <p className="text-xs text-muted-foreground">/ {score.max}</p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1.5">
        {score.checks.map(check => (
          <div key={check.key} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              {check.pass
                ? <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                : <XCircle className="h-3 w-3 text-destructive flex-shrink-0" />
              }
              <span className={check.pass ? 'text-foreground' : 'text-destructive'}>{check.label}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className={cn('font-medium', check.pass ? 'text-success' : 'text-destructive')}>
                {check.score}/{check.max}
              </span>
            </div>
          </div>
        ))}
      </div>
      {score.ready && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-success/10 border border-success/20">
          <BadgeCheck className="h-3.5 w-3.5 text-success" />
          <span className="text-xs text-success font-medium">Ready for approval</span>
        </div>
      )}
    </div>
  )
}

// ── Maker-Checker Entry Row ────────────────────────────────────────────────────

function MCRow({ entry, onApprove, onReject }: {
  entry:     MakerCheckerEntry
  onApprove: (id: string, notes: string) => void
  onReject:  (id: string, notes: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes]       = useState('')
  const isPending = entry.status === 'pending'
  const isOverdue = isPending && entry.sla_hours != null && entry.is_escalated

  return (
    <div className={cn('border-b border-border/50 last:border-0', isOverdue && 'bg-warning/5')}>
      <button
        className="w-full flex items-start justify-between px-4 py-3 hover:bg-muted/20 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 p-1.5 rounded-full',
            entry.status === 'pending'      ? 'bg-warning/15 text-warning' :
            entry.status === 'approved'     ? 'bg-success/15 text-success' :
            entry.status === 'rejected'     ? 'bg-destructive/15 text-destructive' :
                                              'bg-muted text-muted-foreground',
          )}>
            {entry.status === 'pending'   ? <Clock className="h-3 w-3" /> :
             entry.status === 'approved'  ? <CheckCircle2 className="h-3 w-3" /> :
             entry.status === 'rejected'  ? <XCircle className="h-3 w-3" /> :
                                            <BadgeCheck className="h-3 w-3" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium capitalize">{entry.action.replace(/_/g, ' ')}</span>
              <Badge variant="outline" className="text-[9px] rounded-full capitalize">{entry.entity_type.replace(/_/g, ' ')}</Badge>
              {isOverdue && <Badge variant="warning" className="text-[9px] rounded-full gap-1"><AlertTriangle className="h-2.5 w-2.5" />Escalated</Badge>}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Submitted by <span className="font-medium">{entry.maker?.full_name ?? 'Unknown'}</span> · {fmtDateTime(entry.submitted_at)}
            </div>
            {entry.reviewed_at && (
              <div className="text-xs text-muted-foreground">
                Reviewed by <span className="font-medium">{entry.checker?.full_name ?? 'Unknown'}</span> · {fmtDateTime(entry.reviewed_at)}
                {entry.checker_notes && <span className="italic ml-1">"{entry.checker_notes}"</span>}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={
            entry.status === 'pending'      ? 'warning' :
            entry.status === 'approved'     ? 'success' :
            entry.status === 'rejected'     ? 'destructive' :
                                              'secondary'
          } className="rounded-full text-[9px] capitalize">
            {entry.status}
          </Badge>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Payload preview */}
          {entry.maker_data && Object.keys(entry.maker_data).length > 0 && (
            <div className="rounded-md bg-muted/20 border border-border/50 p-2">
              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Data</p>
              <pre className="text-[10px] text-muted-foreground overflow-x-auto">
                {JSON.stringify(entry.maker_data, null, 2)}
              </pre>
            </div>
          )}
          {/* Approve/Reject actions for pending */}
          {isPending && (
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 h-7 text-xs"
                placeholder="Notes (optional)…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <Button size="sm" className="h-7 text-xs px-3 gap-1 bg-success text-success-foreground hover:bg-success/90"
                onClick={() => { onApprove(entry.id, notes); setNotes('') }}>
                <CheckCircle2 className="h-3 w-3" />Approve
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs px-3 gap-1"
                onClick={() => { onReject(entry.id, notes); setNotes('') }}>
                <XCircle className="h-3 w-3" />Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollApprovalWorkflow() {
  const queryClient  = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Readiness score
  const { data: readinessRaw, isLoading: readinessLoading } = useQuery<{ data: ReadinessScore }>({
    queryKey: ['payroll-readiness-score'],
    queryFn:  () => api.get('/payroll/readiness-score'),
    staleTime: 30_000,
  })
  const readiness = readinessRaw?.data ?? null

  // Maker-checker log
  const { data: stagesRaw, isLoading: stagesLoading, refetch } = useQuery<{ data: MakerCheckerEntry[] }>({
    queryKey: ['approval-stages', statusFilter],
    queryFn:  () => {
      const params = new URLSearchParams({ entity_type: 'payroll_run' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      return api.get(`/payroll/approval-stages?${params}`)
    },
    staleTime: 30_000,
  })
  const entries = stagesRaw?.data ?? []

  const approveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.post(`/payroll/approval-stages/${id}/approve`, { notes: notes || undefined }),
    onSuccess: () => {
      toast.success('Entry approved')
      queryClient.invalidateQueries({ queryKey: ['approval-stages'] })
      // Approval can change a payroll run's status/stats — keep ops pages in sync.
      invalidateAllPayrollRunViews(queryClient)
    },
    // Surface the backend's message (e.g. the payroll-finalize redirect guidance)
    // instead of a generic string that would hide it.
    onError: (e: unknown) => toast.error('Approval failed', {
      description: e instanceof Error ? e.message : undefined,
    }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.post(`/payroll/approval-stages/${id}/reject`, { notes: notes || undefined }),
    onSuccess: () => {
      toast.success('Entry rejected')
      queryClient.invalidateQueries({ queryKey: ['approval-stages'] })
    },
    onError: () => toast.error('Rejection failed'),
  })

  const currentStage = deriveStage(readiness)
  const pendingCount = entries.filter(e => e.status === 'pending').length

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Approval Workflow"
        subtitle="Multi-stage governance: draft → HR review → Finance → Compliance → Approved → Payout"
        actions={
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={stagesLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', stagesLoading && 'animate-spin')} />Refresh
          </Button>
        }
      />

      {/* Pipeline Strip */}
      <div className="mb-4">
        <PipelineStrip currentStage={currentStage} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Approval Queue */}
        <div className="lg:col-span-2 space-y-4">

          {/* Status filter */}
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { key: 'all',      label: `All (${entries.length})` },
              { key: 'pending',  label: `Pending (${pendingCount})` },
              { key: 'approved', label: 'Approved' },
              { key: 'rejected', label: 'Rejected' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors',
                  statusFilter === f.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <SectionCard
            title="Maker-Checker Approval Queue"
            icon={<GitMerge className="h-4 w-4" />}
            description={pendingCount > 0 ? `${pendingCount} pending review` : 'All reviews up to date'}
          >
            {stagesLoading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />Loading approval queue…
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-muted-foreground">
                <GitMerge className="h-8 w-8 opacity-30" />
                <p className="text-sm">No approval entries found</p>
                <p className="text-xs opacity-70">Governance actions (freeze, finalize, compensation) will appear here</p>
              </div>
            ) : (
              <div>
                {entries.map(entry => (
                  <MCRow
                    key={entry.id}
                    entry={entry}
                    onApprove={(id, notes) => approveMutation.mutate({ id, notes })}
                    onReject={(id, notes) => rejectMutation.mutate({ id, notes })}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right: Readiness Score */}
        <div className="space-y-4">
          {readinessLoading ? (
            <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : readiness ? (
            <ReadinessGauge score={readiness} />
          ) : null}

          {/* Governance rules */}
          <SectionCard title="Governance Rules" icon={<Scale className="h-4 w-4" />}>
            <div className="p-4 space-y-2.5 text-xs">
              {[
                { icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />, text: 'Finalization requires readiness score ≥ 80' },
                { icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />, text: 'Freeze action requires maker-checker approval' },
                { icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />, text: 'Super-admin can override all stages' },
                { icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />, text: 'All overrides are audit-logged' },
                { icon: <AlertTriangle className="h-3.5 w-3.5 text-warning" />, text: 'Unfreeze requires super_admin role' },
                { icon: <AlertTriangle className="h-3.5 w-3.5 text-warning" />, text: 'Rollback of finalized run requires super_admin' },
              ].map((rule, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 mt-0.5">{rule.icon}</span>
                  <span className="text-muted-foreground">{rule.text}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  )
}
