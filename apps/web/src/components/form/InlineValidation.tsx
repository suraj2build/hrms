import { Loader2, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ValidationState = 'idle' | 'error' | 'warning' | 'success' | 'validating'

export interface InlineValidationProps {
  state: ValidationState
  message?: string
  className?: string
}

export function InlineValidation({ state, message, className }: InlineValidationProps) {
  if (state === 'idle') {
    return null
  }

  if (state === 'validating') {
    return (
      <p className={cn('flex items-center gap-1 text-xs mt-1 text-muted-foreground', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking…
      </p>
    )
  }

  if (state === 'error') {
    return (
      <p className={cn('flex items-center gap-1 text-xs mt-1 text-destructive', className)}>
        <XCircle className="h-3 w-3 shrink-0" />
        {message}
      </p>
    )
  }

  if (state === 'warning') {
    return (
      <p className={cn('flex items-center gap-1 text-xs mt-1 text-warning', className)}>
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {message}
      </p>
    )
  }

  if (state === 'success') {
    return (
      <p className={cn('flex items-center gap-1 text-xs mt-1 text-success', className)}>
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        {message}
      </p>
    )
  }

  return null
}
