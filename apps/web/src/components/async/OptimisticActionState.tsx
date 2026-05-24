import React from 'react'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ActionPhase = 'idle' | 'pending' | 'confirmed' | 'failed'

export interface OptimisticActionStateProps {
  phase: ActionPhase
  pendingLabel?: string
  confirmedLabel?: string
  failedLabel?: string
  children: React.ReactNode
  className?: string
}

export function OptimisticActionState({
  phase,
  pendingLabel = 'Applying…',
  confirmedLabel = 'Applied',
  failedLabel = 'Failed',
  children,
  className,
}: OptimisticActionStateProps) {
  if (phase === 'idle') {
    return <>{children}</>
  }

  return (
    <div className={cn('relative inline-flex items-center gap-2', className)}>
      {children}
      <span
        className={cn(
          'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
          phase === 'pending' && 'bg-muted text-muted-foreground',
          phase === 'confirmed' && 'bg-success/15 text-success',
          phase === 'failed' && 'bg-destructive/15 text-destructive',
        )}
      >
        {phase === 'pending' && (
          <>
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {pendingLabel}
          </>
        )}
        {phase === 'confirmed' && (
          <>
            <CheckCircle2 className="h-2.5 w-2.5" />
            {confirmedLabel}
          </>
        )}
        {phase === 'failed' && (
          <>
            <XCircle className="h-2.5 w-2.5" />
            {failedLabel}
          </>
        )}
      </span>
    </div>
  )
}
