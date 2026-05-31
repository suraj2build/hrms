import { cn } from '@/lib/utils'

export interface UnreadBadgeProps {
  count: number
  max?: number
  className?: string
}

export function UnreadBadge({ count, max = 9, className }: UnreadBadgeProps) {
  if (count === 0) return null

  const label = count > max ? `${max}+` : String(count)

  return (
    <span
      className={cn(
        'absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] text-white font-bold flex items-center justify-center leading-none',
        className,
      )}
    >
      {label}
    </span>
  )
}
