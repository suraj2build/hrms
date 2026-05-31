import { cn } from '@/lib/utils'

interface IntelligenceLoadingSkeletonProps {
  rows?:       number
  cardHeight?: string
  className?:  string
}

export function IntelligenceLoadingSkeleton({
  rows       = 4,
  cardHeight = 'h-16',
  className,
}: IntelligenceLoadingSkeletonProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn('animate-pulse rounded-md bg-muted', cardHeight)}
        />
      ))}
    </div>
  )
}
