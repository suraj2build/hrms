import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RetryBannerProps {
  error: string | null
  onRetry?: () => void
  onDismiss?: () => void
  retrying?: boolean
  className?: string
}

export function RetryBanner({
  error,
  onRetry,
  onDismiss,
  retrying = false,
  className,
}: RetryBannerProps) {
  if (error === null) return null

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs',
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">Something went wrong</p>
        <p className="text-destructive/80 mt-0.5">{error}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="flex items-center gap-1 px-2 py-1 rounded border border-destructive/30 hover:bg-destructive/10 transition-colors font-medium disabled:opacity-50"
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Retry
          </button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="hover:opacity-70 transition-opacity">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
