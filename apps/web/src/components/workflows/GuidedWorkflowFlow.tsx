import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface WorkflowStep {
  id: string
  title: string
  description: string
  status: 'completed' | 'active' | 'pending' | 'skipped'
  route?: string
  ctaLabel?: string
  icon?: React.ComponentType<{ className?: string }>
  prerequisite?: string[]
  optional?: boolean
}

export interface GuidedWorkflowFlowProps {
  id: string
  title: string
  description?: string
  steps: WorkflowStep[]
  onComplete?: () => void
  compact?: boolean
  className?: string
}

function storageKey(id: string): string {
  return `ux3_wf_${id}`
}

function loadCompleted(id: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(id))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed as string[])
  } catch {
    // ignore
  }
  return new Set()
}

function saveCompleted(id: string, completed: Set<string>): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(Array.from(completed)))
  } catch {
    // ignore
  }
}

// ─── Step indicator sub-component ───────────────────────────────────────────

interface StepIndicatorProps {
  status: WorkflowStep['status']
  index: number
}

function StepIndicator({ status, index }: StepIndicatorProps) {
  if (status === 'completed') {
    return (
      <CheckCircle2 className="h-5 w-5 text-success shrink-0" aria-hidden="true" />
    )
  }
  if (status === 'active') {
    return (
      <div
        className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 text-[10px] font-bold"
        aria-hidden="true"
      >
        {index + 1}
      </div>
    )
  }
  if (status === 'skipped') {
    return (
      <Minus className="h-5 w-5 text-muted-foreground/50 shrink-0" aria-hidden="true" />
    )
  }
  // pending
  return (
    <div
      className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center shrink-0 text-[10px] text-muted-foreground/50"
      aria-hidden="true"
    >
      {index + 1}
    </div>
  )
}

// ─── Connector line ──────────────────────────────────────────────────────────

interface ConnectorProps {
  bothCompleted: boolean
}

function Connector({ bothCompleted }: ConnectorProps) {
  return (
    <div
      className={cn(
        'w-px h-4 mx-auto',
        bothCompleted ? 'bg-success' : 'bg-border'
      )}
      aria-hidden="true"
    />
  )
}

// ─── Main component (full mode) ──────────────────────────────────────────────

function GuidedWorkflowFlowImpl({
  id,
  title,
  description,
  steps,
  onComplete,
  compact = false,
  className,
}: GuidedWorkflowFlowProps) {
  const navigate = useNavigate()
  const [completed, setCompleted] = useState<Set<string>>(() => loadCompleted(id))
  const [activeStepId, setActiveStepId] = useState<string | null>(null)

  // Derive resolved steps: overlay persisted completion onto step list
  const resolvedSteps = useMemo<WorkflowStep[]>(() => {
    return steps.map((step) => {
      if (completed.has(step.id)) return { ...step, status: 'completed' as const }
      if (step.id === activeStepId) return { ...step, status: 'active' as const }
      return step
    })
  }, [steps, completed, activeStepId])

  const completedCount = completed.size
  const totalCount = steps.length

  // Fire onComplete when all steps are done
  useEffect(() => {
    if (completedCount === totalCount && totalCount > 0) {
      onComplete?.()
    }
  }, [completedCount, totalCount, onComplete])

  const isPrerequisiteMet = useCallback(
    (step: WorkflowStep): boolean => {
      if (!step.prerequisite || step.prerequisite.length === 0) return true
      return step.prerequisite.every((prereqId) => completed.has(prereqId))
    },
    [completed]
  )

  const handleStart = useCallback(
    (step: WorkflowStep) => {
      setActiveStepId(step.id)
      if (step.route) {
        navigate(step.route)
      }
    },
    [navigate]
  )

  const handleMarkComplete = useCallback(
    (stepId: string) => {
      setCompleted((prev) => {
        const next = new Set(prev)
        next.add(stepId)
        saveCompleted(id, next)
        return next
      })
      setActiveStepId(null)
    },
    [id]
  )

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(id))
    } catch {
      // ignore
    }
    setCompleted(new Set())
    setActiveStepId(null)
  }, [id])

  // ── Compact mode ────────────────────────────────────────────────────────────
  if (compact) {
    const firstIncomplete = resolvedSteps.find((s) => s.status !== 'completed')
    return (
      <div className={cn('flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2', className)}>
        {/* Pill strip */}
        <div className="flex items-center gap-1">
          {resolvedSteps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'h-1.5 w-6 rounded-full',
                step.status === 'completed' ? 'bg-success' : 'bg-muted'
              )}
              aria-hidden="true"
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {completedCount}/{totalCount} steps
        </span>
        {firstIncomplete && (
          <Button
            size="sm"
            className="ml-auto h-6 text-xs"
            onClick={() => handleStart(firstIncomplete)}
            aria-label={`Continue workflow: ${firstIncomplete.title}`}
          >
            Continue
          </Button>
        )}
      </div>
    )
  }

  // ── Full mode ────────────────────────────────────────────────────────────────
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className={cn('rounded-xl border border-border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount} steps
          </span>
          <button
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Reset workflow progress"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Steps */}
      <div className="px-5 py-3">
        {resolvedSteps.map((step, index) => {
          const isLast = index === resolvedSteps.length - 1
          const nextStep = !isLast ? resolvedSteps[index + 1] : null
          const isCurrentCompleted = step.status === 'completed'
          const isNextCompleted = nextStep?.status === 'completed'
          const isActive = step.status === 'active'
          const canStart = isPrerequisiteMet(step) && step.status !== 'completed'
          const StepIcon = step.icon

          return (
            <div key={step.id}>
              <div className="flex items-start gap-3 py-2.5">
                {/* Left: step indicator column */}
                <div className="flex flex-col items-center pt-0.5">
                  <StepIndicator status={step.status} index={index} />
                  {!isLast && (
                    <Connector bothCompleted={isCurrentCompleted && !!isNextCompleted} />
                  )}
                </div>

                {/* Right: content */}
                <div className="flex flex-1 items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {StepIcon && (
                        <StepIcon className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                      )}
                      <span
                        className={cn(
                          'text-sm font-medium',
                          step.status === 'completed'
                            ? 'text-muted-foreground line-through'
                            : 'text-foreground'
                        )}
                      >
                        {step.title}
                        {step.optional && (
                          <span className="ml-1 text-xs text-muted-foreground font-normal">
                            (optional)
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                      {step.description}
                    </p>
                    {/* Mark complete button for active step */}
                    {isActive && (
                      <button
                        onClick={() => handleMarkComplete(step.id)}
                        className="mt-1.5 text-xs text-success font-medium hover:underline"
                        aria-label={`Mark step "${step.title}" as complete`}
                      >
                        Mark complete
                      </button>
                    )}
                  </div>

                  {/* Right-side CTA or status */}
                  <div className="shrink-0 pt-0.5">
                    {step.status === 'completed' ? (
                      <span className="flex items-center gap-1 text-xs text-success font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Done
                      </span>
                    ) : canStart ? (
                      <Button
                        size="sm"
                        variant={isActive ? 'outline' : 'default'}
                        className="h-7 text-xs"
                        onClick={() => handleStart(step)}
                        aria-label={`${step.ctaLabel ?? 'Start'} – ${step.title}`}
                      >
                        {step.ctaLabel ?? 'Start'} →
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">Pending</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress bar footer */}
      <div className="border-t border-border px-5 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">
            {completedCount} / {totalCount} steps complete
          </span>
          <span className="text-xs font-medium text-foreground">{progressPercent}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Workflow completion progress"
          />
        </div>
      </div>
    </div>
  )
}

export const GuidedWorkflowFlow = React.memo(GuidedWorkflowFlowImpl)
