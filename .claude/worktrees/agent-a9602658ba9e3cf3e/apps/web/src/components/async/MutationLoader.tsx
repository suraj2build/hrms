import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MutationLoaderVariant = 'overlay' | 'inline' | 'bar'

export interface MutationLoaderProps {
  loading: boolean
  variant?: MutationLoaderVariant
  label?: string
  className?: string
}

export function MutationLoader({
  loading,
  variant = 'inline',
  label = 'Saving…',
  className,
}: MutationLoaderProps) {
  if (variant === 'overlay') {
    if (!loading) return null
    return (
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] z-20 flex items-center justify-center rounded-md">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        {label && <span className="ml-2 text-sm text-muted-foreground">{label}</span>}
      </div>
    )
  }

  if (variant === 'bar') {
    return (
      <div className={cn('h-0.5 w-full bg-muted overflow-hidden rounded-full', className)}>
        <div
          className={cn(
            'h-full bg-primary transition-all duration-300',
            loading ? 'animate-pulse w-3/4' : 'w-0',
          )}
        />
      </div>
    )
  }

  // inline (default)
  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      {loading && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{label}</span>
        </>
      )}
    </div>
  )
}
