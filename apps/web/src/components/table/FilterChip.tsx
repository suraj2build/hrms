import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FilterChipProps {
  label:    string
  onRemove: () => void
  variant?: 'default' | 'info' | 'warning' | 'success'
  className?: string
}

const variantClasses: Record<NonNullable<FilterChipProps['variant']>, string> = {
  default: 'bg-muted border-border text-foreground',
  info:    'bg-info/10 border-info/30 text-info',
  warning: 'bg-warning/10 border-warning/30 text-warning',
  success: 'bg-success/10 border-success/30 text-success',
}

export function FilterChip({ label, onRemove, variant = 'default', className }: FilterChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-medium border',
        variantClasses[variant],
        className,
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="ml-0.5 hover:text-foreground/70 transition-colors"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  )
}
