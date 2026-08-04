import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import type { DecisionInsight } from '@/lib/intelligence/types'
import { CONFIDENCE_META } from '@/lib/intelligence/types'

export interface ImpactPreviewDialogProps {
  insight:    DecisionInsight | null
  onClose:    () => void
  onConfirm:  (insight: DecisionInsight) => void
  onSuccess?: (insight: DecisionInsight) => void
}

type Step = 'preview' | 'executing' | 'done' | 'error'

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function RiskBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-semibold capitalize',
        level === 'high'   ? 'text-destructive bg-destructive/10 border-destructive/30' :
        level === 'medium' ? 'text-warning bg-warning/10 border-warning/30'       :
                             'text-info bg-info/10 border-info/30',
      )}
    >
      {level}
    </Badge>
  )
}

export function ImpactPreviewDialog({
  insight,
  onClose,
  onConfirm,
  onSuccess,
}: ImpactPreviewDialogProps) {
  const [step, setStep]     = useState<Step>('preview')
  const [result, setResult] = useState<{ successCount: number; failureCount: number } | null>(null)

  // Reset step whenever insight changes
  useEffect(() => {
    setStep('preview')
    setResult(null)
  }, [insight?.id])

  const executeMutation = useMutation({
    mutationFn: (ins: DecisionInsight) =>
      // Bulk-action endpoints don't share one response shape — regularisation's
      // bulk-approve/bulk-reject return { summary: { approved, failed } },
      // anomalies' bulk-resolve returns { resolved_count, recompute_failed }.
      // Falling back to affectedEntities.length (as this used to do
      // unconditionally) reports a fabricated full success even when the
      // backend only partially applied the batch.
      api.post<{
        success?: boolean
        count?: number
        summary?: { approved: number; failed: number; total: number }
        resolved_count?: number
        recompute_failed?: number
      }>(ins.actionEndpoint, ins.actionBody),
    onSuccess: (data, ins) => {
      let successCount: number
      let failureCount: number
      if (data?.summary) {
        successCount = data.summary.approved
        failureCount = data.summary.failed
      } else if (data?.resolved_count !== undefined) {
        successCount = data.resolved_count
        failureCount = data.recompute_failed ?? Math.max(0, ins.affectedEntities.length - data.resolved_count)
      } else {
        successCount = data?.count ?? ins.affectedEntities.length
        failureCount = 0
      }
      setStep(failureCount > 0 && successCount === 0 ? 'error' : 'done')
      setResult({ successCount, failureCount })
      onSuccess?.(ins)
      if (failureCount > 0) {
        toast.warning(
          `${ins.actionLabel}: ${successCount} succeeded, ${failureCount} failed`,
        )
      } else {
        toast.success(
          `${ins.actionLabel} completed — ${successCount} records updated`,
        )
      }
    },
    onError: () => {
      setStep('error')
      toast.error('Action failed — no changes were made')
    },
  })

  function handleConfirm() {
    if (!insight) return
    setStep('executing')
    onConfirm(insight)
    executeMutation.mutate(insight)
  }

  function handleRetry() {
    if (!insight) return
    setStep('executing')
    executeMutation.mutate(insight)
  }

  const isOpen = insight !== null

  if (!isOpen) return null

  const confidenceMeta = CONFIDENCE_META[insight.confidenceLevel]
  const { impactEstimate } = insight
  const displayEntities  = insight.affectedEntities.slice(0, 10)
  const hiddenCount      = insight.affectedEntities.length - displayEntities.length

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl w-full">

        {/* ── Step: executing ── */}
        {step === 'executing' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Executing action…</p>
          </div>
        )}

        {/* ── Step: done ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <p className="text-base font-semibold">Action Complete</p>
            <p className="text-sm text-muted-foreground">
              {result?.successCount ?? 0} records updated successfully
              {(result?.failureCount ?? 0) > 0 && ` · ${result?.failureCount} failed`}
            </p>
            <DialogClose asChild>
              <Button className="mt-2" onClick={onClose}>Close</Button>
            </DialogClose>
          </div>
        )}

        {/* ── Step: error ── */}
        {step === 'error' && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <XCircle className="h-12 w-12 text-destructive" />
            <p className="text-base font-semibold">Action Failed</p>
            <p className="text-sm text-muted-foreground">
              No changes were made. Please try again.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={handleRetry}>Retry</Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        )}

        {/* ── Step: preview ── */}
        {step === 'preview' && (
          <>
            <DialogHeader>
              <DialogTitle className="leading-snug">{insight.title}</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                {insight.explanation}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">

              {/* Two-column grid: affected employees + impact breakdown */}
              <div className="grid lg:grid-cols-2 gap-4">

                {/* Left: affected employees */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Affected Employees
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {displayEntities.map((entity) => (
                      <div key={entity.id} className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-[10px] font-bold text-primary flex-shrink-0">
                          {initials(entity.name)}
                        </span>
                        <span className="text-xs truncate">{entity.name}</span>
                      </div>
                    ))}
                    {hiddenCount > 0 && (
                      <p className="text-[11px] text-muted-foreground pt-1">
                        …and {hiddenCount} more employees
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: impact breakdown */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Impact Breakdown
                  </p>
                  <div className="space-y-2">
                    <ImpactRow label="Employees affected">
                      <span className="text-xs font-semibold">{impactEstimate.affectedCount}</span>
                    </ImpactRow>

                    <ImpactRow label="Payroll impact">
                      {impactEstimate.payrollImpact !== undefined
                        ? <span className="text-xs font-semibold">{formatCurrency(impactEstimate.payrollImpact)}</span>
                        : <span className="text-xs text-muted-foreground">None estimated</span>}
                    </ImpactRow>

                    <ImpactRow label="Compliance risk">
                      {impactEstimate.complianceRisk
                        ? <RiskBadge level={impactEstimate.complianceRisk} />
                        : <span className="text-xs text-muted-foreground">None</span>}
                    </ImpactRow>

                    <ImpactRow label="Fatigue impact">
                      {impactEstimate.fatigueImpact
                        ? <RiskBadge level={impactEstimate.fatigueImpact} />
                        : <span className="text-xs text-muted-foreground">None</span>}
                    </ImpactRow>

                    <ImpactRow label="Rollback possible">
                      {impactEstimate.rollbackPossible ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-success">
                          <RotateCcw className="h-3 w-3" />
                          Yes
                          {impactEstimate.rollbackWindowHours != null &&
                            ` (${impactEstimate.rollbackWindowHours}h window)`}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </ImpactRow>
                  </div>
                </div>
              </div>

              {/* Confidence section */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Confidence
                </p>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', confidenceMeta.bg.replace('/10', '/60'))}
                      style={{ width: `${insight.confidence}%` }}
                    />
                  </div>
                  <span className={cn('text-xs font-bold tabular-nums', confidenceMeta.color)}>
                    {insight.confidence}%
                  </span>
                </div>
                {insight.factors.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Based on:{' '}
                    {insight.factors
                      .slice(0, 3)
                      .map((f) => f.label)
                      .join(', ')}
                  </p>
                )}
              </div>

              {/* Applied rules */}
              {insight.explainability.appliedRules.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Applied Rules
                  </p>
                  <ul className="space-y-0.5">
                    {insight.explainability.appliedRules.map((rule) => (
                      <li key={rule} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <span className="mt-1 h-1 w-1 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleConfirm}>
                {insight.actionLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* Utility row for impact table */
function ImpactRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/30 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
