/**
 * ErrorState — the single canonical error placeholder for sections/panels.
 *
 * Part of the one-state-system mandated by EXPERIENCE_CLOUD_UX_BLUEPRINT.md §12.
 * Pairs with EmptyState and LoadingState. Mirrors EmptyState's centred layout so
 * the three states are visually consistent. Honest, never alarming — a calm
 * message plus an optional Retry (Manifesto §IV.8: calm, never anxious).
 *
 * Usage:
 *   if (isError) return <ErrorState onRetry={refetch} />
 *   <ErrorState title="Couldn't load your timeline" description={err.message} onRetry={refetch} />
 */

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  /** Headline — defaults to a calm generic message. */
  title?: string
  /** Optional detail (e.g. the error message). */
  description?: string
  /** When provided, renders a Retry button wired to this handler. */
  onRetry?: () => void
  /** Label for the retry button. */
  retryLabel?: string
  /** Reduce vertical padding for inline use. */
  compact?: boolean
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this just now. Please try again.',
  onRetry,
  retryLabel = 'Try again',
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-14 px-6',
        className,
      )}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-5 w-5 text-destructive/70" />
      </div>
      <p className="text-sm font-medium text-foreground/70">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground max-w-[26rem]">{description}</p>
      )}
      {onRetry && (
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={onRetry}>{retryLabel}</Button>
        </div>
      )}
    </div>
  )
}
