import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AsyncStatus = 'idle' | 'processing' | 'success' | 'failed' | 'retrying'

export interface AsyncStatusIndicatorProps {
  status: AsyncStatus
  labels?: Partial<Record<AsyncStatus, string>>
  className?: string
  size?: 'sm' | 'md'
}

const DEFAULT_LABELS: Record<AsyncStatus, string> = {
  idle: '',
  processing: 'Processing…',
  success: 'Saved',
  failed: 'Failed',
  retrying: 'Retrying…',
}

const SIZE_ICON: Record<'sm' | 'md', string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
}

const SIZE_TEXT: Record<'sm' | 'md', string> = {
  sm: 'text-xs',
  md: 'text-sm',
}

const STATUS_COLOR: Record<AsyncStatus, string> = {
  idle: '',
  processing: 'text-muted-foreground',
  success: 'text-success',
  failed: 'text-destructive',
  retrying: 'text-warning',
}

export function AsyncStatusIndicator({
  status,
  labels,
  className,
  size = 'sm',
}: AsyncStatusIndicatorProps) {
  if (status === 'idle') return null

  const resolvedLabels = { ...DEFAULT_LABELS, ...labels }
  const label = resolvedLabels[status]
  const iconSize = SIZE_ICON[size]
  const textSize = SIZE_TEXT[size]
  const colorClass = STATUS_COLOR[status]

  let Icon: React.ReactNode = null
  if (status === 'processing') {
    Icon = <Loader2 className={cn(iconSize, 'animate-spin')} />
  } else if (status === 'success') {
    Icon = <CheckCircle2 className={iconSize} />
  } else if (status === 'failed') {
    Icon = <XCircle className={iconSize} />
  } else if (status === 'retrying') {
    Icon = <RefreshCw className={cn(iconSize, 'animate-spin')} />
  }

  return (
    <div className={cn('flex items-center gap-1.5', colorClass, textSize, className)}>
      {Icon}
      <span>{label}</span>
    </div>
  )
}
