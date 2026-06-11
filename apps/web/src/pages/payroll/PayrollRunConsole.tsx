/**
 * PayrollRunConsole — /admin/payroll/run-console
 *
 * Operational payroll run visibility console.
 * Shows payroll run status, exceptions, and impact metrics so payroll teams
 * can manage runs operationally.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState }                    from 'react'
import { useQuery }                           from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Circle, Activity } from 'lucide-react'
import { PageContainer }                      from '@/components/layout/PageContainer'
import { PageHeader }                         from '@/components/layout/PageHeader'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge }                              from '@/components/ui/badge'
import { api }                                from '@/lib/api/client'
import { cn }                                 from '@/lib/utils'
import {
  SeverityBadge,
  IntelligenceEmptyState,
  IntelligenceLoadingSkeleton,
  OperationalSummary,
} from '@/components/ui/intelligence/index.js'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayrollRun {
  id:               string
  month:            string
  status:           'draft' | 'partial_failed' | 'processing' | 'finalized' | 'failed' | 'frozen' | 'reopened'
  employee_count:   number
  total_gross:      number
  total_deductions: number
  total_net:        number
  total_lop_amount: number
  held_count:       number
  warning_count:    number
  error_message:    string | null
  failure_summary:  any | null
  notes:            string | null
  created_at:       string
  finalized_at:     string | null
  approved_by_name: string | null
  created_by_name:  string | null
  frozen_at:        string | null
  frozen_by_name:   string | null
  reopened_at:      string | null
  reopened_by_name: string | null
  reopen_reason:    string | null
}

interface PayrollSlip {
  slip_id:       string
  employee_id:   string
  employee_name: string | null
  employee_code: string | null
  held_reason:   string | null
  warning:       string | null
  status:        'draft' | 'finalized' | 'held'
}

interface SlipListResponse {
  data:   PayrollSlip[]
  total:  number
  limit:  number
  offset: number
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style:                'currency',
    currency:             'INR',
    maximumFractionDigits: 0,
  }).format(n)

const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

const fmtMonth = (s: string) => {
  const d = new Date(s.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Status badge helper ────────────────────────────────────────────────────────

type RunStatus = PayrollRun['status']


const STATUS_LABELS: Record<RunStatus, string> = {
  finalized:      'Finalized',
  frozen:         'Frozen',
  processing:     'Processing',
  draft:          'Draft',
  failed:         'Failed',
  partial_failed: 'Partial Failed',
  reopened:       'Reopened',
}

function StatusBadge({ status }: { status: RunStatus }) {
  // SeverityBadge renders run.severity as its label — we map status to severity string
  // so we pass the human label as the severity value and override display via className
  return (
    <Badge
      variant={(() => {
        switch (status) {
          case 'finalized':
          case 'frozen':
          case 'processing':  return 'outline'
          case 'draft':       return 'secondary'
          case 'failed':
          case 'partial_failed': return 'destructive'
          case 'reopened':    return 'secondary'
          default:            return 'outline'
        }
      })()}
      className={cn(
        'text-[10px] font-medium',
        status === 'finalized'      && 'border-green-300  bg-green-50  text-green-800  dark:bg-green-900/20 dark:text-green-300',
        status === 'frozen'         && 'border-blue-300   bg-blue-50   text-blue-800   dark:bg-blue-900/20 dark:text-blue-300',
        status === 'processing'     && 'border-blue-300   bg-blue-50   text-blue-800   dark:bg-blue-900/20 dark:text-blue-300',
        status === 'reopened'       && 'border-amber-300  bg-amber-50  text-amber-800  dark:bg-amber-900/20 dark:text-amber-300',
      )}
    >
      {STATUS_LABELS[status]}
    </Badge>
  )
}

// ── Status timeline ────────────────────────────────────────────────────────────

const STAGES: { key: string; label: string }[] = [
  { key: 'draft',      label: 'Draft'      },
  { key: 'processing', label: 'Processing' },
  { key: 'finalized',  label: 'Finalized'  },
  { key: 'frozen',     label: 'Frozen'     },
]

function stageIndex(status: RunStatus): number {
  if (status === 'failed' || status === 'partial_failed') return 1
  if (status === 'reopened') return 3
  const idx = STAGES.findIndex(s => s.key === status)
  return idx >= 0 ? idx : 0
}

function StatusTimeline({ run }: { run: PayrollRun }) {
  const currentIdx = stageIndex(run.status)
  const timestamps: Record<string, string | null> = {
    draft:      run.created_at,
    processing: run.status === 'processing' ? run.created_at : null,
    finalized:  run.finalized_at,
    frozen:     run.frozen_at,
  }

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2">
      {STAGES.map((stage, i) => {
        const done    = i <= currentIdx
        const current = i === currentIdx
        const ts      = timestamps[stage.key]
        return (
          <React.Fragment key={stage.key}>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={cn(
                'h-5 w-5 rounded-full border-2 flex items-center justify-center',
                done
                  ? current
                    ? 'border-primary bg-primary'
                    : 'border-primary bg-primary/20'
                  : 'border-muted bg-transparent',
              )}>
                {done && !current && <CheckCircle2 className="h-3 w-3 text-primary" />}
                {current && <Circle className="h-2 w-2 fill-primary-foreground text-primary-foreground" />}
              </div>
              <span className={cn(
                'text-[10px] whitespace-nowrap',
                current ? 'text-foreground font-semibold' : done ? 'text-muted-foreground' : 'text-muted-foreground/50',
              )}>
                {stage.label}
              </span>
              {ts && (
                <span className="text-[9px] text-muted-foreground/60 whitespace-nowrap">{fmtDate(ts)}</span>
              )}
            </div>
            {i < STAGES.length - 1 && (
              <div className={cn(
                'h-px flex-1 min-w-[2rem] mx-1 mb-4',
                i < currentIdx ? 'bg-primary/40' : 'bg-muted',
              )} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── Risk indicators ────────────────────────────────────────────────────────────

interface RiskPill {
  label:    string
  severity: 'warning' | 'high' | 'critical'
}

function deriveRisks(run: PayrollRun): RiskPill[] {
  const risks: RiskPill[] = []
  if (run.held_count > 0)
    risks.push({ label: `${run.held_count} held slip${run.held_count !== 1 ? 's' : ''}`, severity: 'high' })
  if (run.warning_count > 0)
    risks.push({ label: `${run.warning_count} warning${run.warning_count !== 1 ? 's' : ''}`, severity: 'warning' })
  if (run.status === 'partial_failed')
    risks.push({ label: 'Partial run failure', severity: 'high' })
  if (run.failure_summary && typeof run.failure_summary === 'object' && 'total_failed' in run.failure_summary)
    risks.push({ label: `${(run.failure_summary as { total_failed: number }).total_failed} employees failed`, severity: 'critical' })
  return risks
}

const PILL_CLASSES: Record<RiskPill['severity'], string> = {
  warning:  'bg-amber-50  text-amber-800  border border-amber-200  dark:bg-amber-900/20 dark:text-amber-300',
  high:     'bg-orange-50 text-orange-800 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-300',
  critical: 'bg-red-50    text-red-800    border border-red-200    dark:bg-red-900/20 dark:text-red-300',
}

function RiskPills({ run }: { run: PayrollRun }) {
  const risks = deriveRisks(run)
  if (!risks.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {risks.map((r, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
            PILL_CLASSES[r.severity],
          )}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {r.label}
        </span>
      ))}
    </div>
  )
}

// ── PayrollExceptionsDrawer ────────────────────────────────────────────────────

interface PayrollExceptionsDrawerProps {
  run:     PayrollRun | null
  onClose: () => void
}

function PayrollExceptionsDrawer({ run, onClose }: PayrollExceptionsDrawerProps) {
  const [tab, setTab] = useState<'held' | 'warnings'>('held')

  const { data, isLoading } = useQuery<SlipListResponse>({
    queryKey: ['payroll-slips-held', run?.id],
    queryFn:  () => api.get<SlipListResponse>(`/payroll/runs/${run!.id}/slips?status=held&limit=50`),
    enabled:  !!run && (run.held_count > 0 || run.warning_count > 0),
  })

  const heldSlips    = data?.data?.filter(s => s.status === 'held')     ?? []
  const warningSlips = data?.data?.filter(s => s.status !== 'held' && s.warning) ?? []

  return (
    <Dialog open={!!run} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Run Exceptions — {run ? fmtMonth(run.month) : ''}
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-2 border-b pb-2 shrink-0">
          <button
            onClick={() => setTab('held')}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium transition-colors',
              tab === 'held'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Held Slips {run && run.held_count > 0 && (
              <Badge variant="destructive" className="ml-1 text-[9px] px-1 py-0 h-4">
                {run.held_count}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setTab('warnings')}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium transition-colors',
              tab === 'warnings'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Warnings {run && run.warning_count > 0 && (
              <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4">
                {run.warning_count}
              </Badge>
            )}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {isLoading && <IntelligenceLoadingSkeleton rows={5} />}

          {!isLoading && tab === 'held' && (
            heldSlips.length === 0
              ? <IntelligenceEmptyState
                  title="No held slips"
                  description="All slips processed normally."
                />
              : <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-1.5 pr-3 font-medium">Code</th>
                      <th className="text-left py-1.5 pr-3 font-medium">Employee</th>
                      <th className="text-left py-1.5 font-medium">Held Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heldSlips.map(slip => (
                      <tr key={slip.slip_id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground">{slip.employee_code ?? '—'}</td>
                        <td className="py-1.5 pr-3">{slip.employee_name ?? '—'}</td>
                        <td className="py-1.5 flex items-center gap-1.5">
                          <SeverityBadge severity="high" />
                          <span className="text-xs text-muted-foreground">
                            {slip.held_reason ?? 'No reason given'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}

          {!isLoading && tab === 'warnings' && (
            warningSlips.length === 0
              ? <IntelligenceEmptyState
                  title="No warnings"
                  description="No slip warnings for this run."
                />
              : <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-1.5 pr-3 font-medium">Code</th>
                      <th className="text-left py-1.5 pr-3 font-medium">Employee</th>
                      <th className="text-left py-1.5 font-medium">Warning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warningSlips.map(slip => (
                      <tr key={slip.slip_id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-1.5 pr-3 font-mono text-muted-foreground">{slip.employee_code ?? '—'}</td>
                        <td className="py-1.5 pr-3">{slip.employee_name ?? '—'}</td>
                        <td className="py-1.5 text-amber-700 dark:text-amber-400">{slip.warning ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Run Detail Panel ───────────────────────────────────────────────────────────

function RunDetailPanel({ run }: { run: PayrollRun }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Lazy: held slips for exceptions section
  const { data: heldSlipsData, isLoading: heldLoading } = useQuery<SlipListResponse>({
    queryKey: ['payroll-held-preview', run.id],
    queryFn:  () => api.get<SlipListResponse>(`/payroll/runs/${run.id}/slips?status=held&limit=20`),
    enabled:  run.held_count > 0,
  })

  const heldSlips = heldSlipsData?.data ?? []

  return (
    <div className="space-y-4">
      {/* A. Status Timeline */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Run Progress
        </p>
        <StatusTimeline run={run} />
      </div>

      {/* B. Impact Summary */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Impact Summary
        </p>
        <OperationalSummary
          items={[
            { label: 'Gross Payout',      value: fmtMoney(run.total_gross),      severity: undefined },
            { label: 'Net Payout',        value: fmtMoney(run.total_net),        severity: undefined },
            { label: 'Total Deductions',  value: fmtMoney(run.total_deductions), severity: undefined },
            {
              label:    'Held / Errors',
              value:    run.held_count,
              severity: run.held_count > 0 ? 'high' : undefined,
            },
          ]}
        />
      </div>

      {/* C. Risk Indicators */}
      {deriveRisks(run).length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Risk Indicators
          </p>
          <RiskPills run={run} />
        </div>
      )}

      {/* D. Exceptions Section */}
      {run.held_count > 0 && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold flex items-center gap-2">
              Held Slips
              <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">
                {run.held_count}
              </Badge>
            </p>
            <button
              onClick={() => setDrawerOpen(true)}
              className="text-[10px] text-primary hover:underline"
            >
              View all exceptions
            </button>
          </div>

          {heldLoading && <IntelligenceLoadingSkeleton rows={3} />}
          {!heldLoading && heldSlips.length === 0 && (
            <p className="text-xs text-muted-foreground">No held slip details available.</p>
          )}
          {!heldLoading && heldSlips.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1 pr-3 font-medium">Code</th>
                  <th className="text-left py-1 pr-3 font-medium">Employee</th>
                  <th className="text-left py-1 font-medium">Held Reason</th>
                </tr>
              </thead>
              <tbody>
                {heldSlips.map(slip => (
                  <tr key={slip.slip_id} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono text-muted-foreground">{slip.employee_code ?? '—'}</td>
                    <td className="py-1 pr-3">{slip.employee_name ?? '—'}</td>
                    <td className="py-1 text-red-700 dark:text-red-400 text-[10px]">
                      {slip.held_reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* E. Operational Notes */}
      {run.notes && (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Notes</p>
          <p className="text-xs">{run.notes}</p>
        </div>
      )}
      {run.error_message && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="text-[10px] text-destructive uppercase tracking-wide font-medium mb-0.5">Run Error</p>
          <p className="text-xs text-destructive">{run.error_message}</p>
        </div>
      )}

      {/* Exceptions Drawer */}
      {drawerOpen && (
        <PayrollExceptionsDrawer
          run={run}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PayrollRunConsole() {
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null)

  const { data, isLoading } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-console'],
    queryFn:  () => api.get<{ data: PayrollRun[] }>('/payroll/runs'),
  })

  const runs     = data?.data ?? []
  const mostRecent = runs[0] ?? null

  // SLA signal: most recent run stuck in draft/processing for > 48 hours
  const slaAlert = (() => {
    if (!mostRecent) return null
    if (mostRecent.status !== 'draft' && mostRecent.status !== 'processing') return null
    const created  = new Date(mostRecent.created_at).getTime()
    const hoursAgo = Math.floor((Date.now() - created) / (1000 * 60 * 60))
    if (hoursAgo <= 48) return null
    return hoursAgo
  })()

  return (
    <>
      <PageHeader
        title="Payroll Run Console"
        subtitle="Operational payroll run management"
      />
      <PageContainer>
        <div className="space-y-4">
          {/* SLA Signal Banner */}
          {slaAlert !== null && (
            <div className="rounded-md border border-amber-300/40 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2 flex items-center gap-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <span className="text-amber-800 dark:text-amber-300">
                Payroll run in progress for {slaAlert} hours — review pending
              </span>
            </div>
          )}

          {/* Two-column layout: run list + detail */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 items-start">
            {/* Left: Run List */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">Payroll Runs</p>
                {runs.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
                )}
              </div>

              {isLoading && (
                <div className="p-4">
                  <IntelligenceLoadingSkeleton rows={6} />
                </div>
              )}

              {!isLoading && runs.length === 0 && (
                <IntelligenceEmptyState
                  icon={<Activity className="h-8 w-8" />}
                  title="No runs found"
                  description="Trigger a payroll run from the Payroll Runs page to see it here."
                />
              )}

              {!isLoading && runs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30 text-muted-foreground">
                        <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Period</th>
                        <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Status</th>
                        <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Employees</th>
                        <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Gross</th>
                        <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Held</th>
                        <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Warnings</th>
                        <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Run By</th>
                        <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Finalized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(run => (
                        <tr
                          key={run.id}
                          onClick={() => setSelectedRun(run)}
                          className={cn(
                            'border-b last:border-0 cursor-pointer transition-colors',
                            selectedRun?.id === run.id
                              ? 'bg-primary/5'
                              : 'hover:bg-muted/30',
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium whitespace-nowrap">
                            {fmtMonth(run.month)}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{run.employee_count}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {fmtMoney(run.total_gross)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {run.held_count > 0 ? (
                              <span className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                {run.held_count}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {run.warning_count > 0 ? (
                              <span className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                {run.warning_count}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                            {run.created_by_name ?? '—'}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                            {fmtDate(run.finalized_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right: Detail Panel */}
            {selectedRun ? (
              <div className="rounded-lg border bg-card p-4 space-y-1">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold">{fmtMonth(selectedRun.month)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {selectedRun.employee_count} employees · Run by {selectedRun.created_by_name ?? 'Unknown'}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedRun(null)}
                    className="text-muted-foreground hover:text-foreground text-[10px] transition-colors"
                  >
                    ✕
                  </button>
                </div>
                <RunDetailPanel run={selectedRun} />
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/20 flex items-center justify-center min-h-[200px]">
                <p className="text-xs text-muted-foreground">Select a run to view details</p>
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </>
  )
}
