/**
 * WorkflowSequence — Operational step-sequence display.
 *
 * Renders a compact numbered workflow with status per step,
 * blockers, and navigation links.
 *
 * Enterprise style: dense, monochrome-first, no illustrations.
 *
 * Usage:
 *   <WorkflowSequence
 *     title="Payroll Workflow"
 *     steps={payrollWorkflowSteps}
 *   />
 */
import { useNavigate }        from 'react-router-dom'
import {
  CheckCircle2, Circle, AlertTriangle,
  Lock, ChevronRight, ArrowRight,
} from 'lucide-react'
import { Button }             from '@/components/ui/button'
import { cn }                 from '@/lib/utils'
import type { WorkflowStep }  from '@/lib/readiness/types'

// ── Step icon ─────────────────────────────────────────────────────────────────

function StepIcon({
  step,
  index,
}: {
  step:  WorkflowStep
  index: number
}) {
  if (step.status === 'complete') {
    return <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
  }
  if (step.status === 'blocked') {
    return <Lock className="h-5 w-5 text-muted-foreground/40 shrink-0" />
  }
  if (step.status === 'in_progress') {
    return (
      <div className="h-5 w-5 rounded-full border-2 border-primary bg-primary/10 flex items-center justify-center shrink-0">
        <span className="text-[9px] font-bold text-primary">{index + 1}</span>
      </div>
    )
  }
  // pending
  return (
    <div className="h-5 w-5 rounded-full border border-border/60 bg-muted/30 flex items-center justify-center shrink-0">
      <span className="text-[9px] font-medium text-muted-foreground/60">{index + 1}</span>
    </div>
  )
}

// ── WorkflowSequence ──────────────────────────────────────────────────────────

interface WorkflowSequenceProps {
  title?:     string
  steps:      WorkflowStep[]
  compact?:   boolean
  className?: string
}

export function WorkflowSequence({
  title,
  steps,
  compact = false,
  className,
}: WorkflowSequenceProps) {
  const navigate = useNavigate()

  if (steps.length === 0) return null

  return (
    <div className={cn('space-y-0', className)}>
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
          {title}
        </p>
      )}

      {steps.map((step, idx) => {
        const isLast     = idx === steps.length - 1
        const isActive   = step.status === 'in_progress'
        const isComplete = step.status === 'complete'
        const isBlocked  = step.status === 'blocked'

        return (
          <div key={step.id} className="flex items-stretch gap-0">
            {/* Left: icon + connector line */}
            <div className="flex flex-col items-center shrink-0 w-7">
              <StepIcon step={step} index={idx} />
              {!isLast && (
                <div className={cn(
                  'w-px flex-1 my-0.5',
                  isComplete ? 'bg-success/40' : 'bg-border/40',
                )} />
              )}
            </div>

            {/* Right: content */}
            <div className={cn(
              'flex-1 min-w-0 pb-4 pl-3',
              isLast && 'pb-0',
            )}>
              <div className={cn(
                'flex items-start justify-between gap-2 rounded-md transition-colors',
                isActive  && !compact ? 'bg-primary/5 border border-primary/20 px-3 py-2 -ml-1' : '',
              )}>
                <div className="min-w-0">
                  <p className={cn(
                    'text-xs font-medium leading-snug',
                    isComplete ? 'text-success'
                    : isActive  ? 'text-primary'
                    : isBlocked ? 'text-muted-foreground/40'
                    :             'text-foreground/80',
                  )}>
                    {step.label}
                  </p>

                  {step.description && !compact && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {step.description}
                    </p>
                  )}

                  {step.blockers && step.blockers.length > 0 && !compact && (
                    <div className="mt-1 space-y-0.5">
                      {step.blockers.slice(0, 2).map((b, i) => (
                        <div key={i} className="flex items-center gap-1 text-[10px] text-warning">
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* CTA */}
                {step.actionPath && !isComplete && !isBlocked && (
                  <Button
                    size="sm"
                    variant={isActive ? 'default' : 'ghost'}
                    className={cn(
                      'h-6 px-2 text-[10px] shrink-0',
                      !isActive && 'text-muted-foreground',
                    )}
                    onClick={() => navigate(step.actionPath!)}
                  >
                    {step.actionLabel ?? 'Go'}
                    <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Horizontal compact sequence (for dashboard headers) ───────────────────────

export function WorkflowStepChips({
  steps,
  className,
}: {
  steps:      WorkflowStep[]
  className?: string
}) {
  const navigate = useNavigate()

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center gap-1">
          <button
            onClick={() => step.actionPath && navigate(step.actionPath)}
            disabled={!step.actionPath || step.status === 'blocked'}
            className={cn(
              'flex items-center gap-1 text-[10px] rounded px-2 py-1 border transition-colors',
              step.status === 'complete'    && 'border-success/40 bg-success/8 text-success',
              step.status === 'in_progress' && 'border-primary/40 bg-primary/10 text-primary font-medium',
              step.status === 'blocked'     && 'border-border/40 bg-muted/20 text-muted-foreground/40 cursor-not-allowed',
              step.status === 'pending'     && 'border-border/40 bg-card text-muted-foreground/60 hover:bg-muted/20',
            )}
          >
            {step.status === 'complete'    && <CheckCircle2  className="h-2.5 w-2.5" />}
            {step.status === 'in_progress' && <Circle        className="h-2.5 w-2.5 fill-primary" />}
            {step.status === 'blocked'     && <Lock          className="h-2.5 w-2.5" />}
            {step.status === 'pending'     && <span className="text-[9px] font-medium">{idx + 1}</span>}
            <span>{step.label}</span>
          </button>
          {idx < steps.length - 1 && (
            <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />
          )}
        </div>
      ))}
    </div>
  )
}
