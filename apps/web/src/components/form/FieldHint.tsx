import React from 'react'
import { AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FieldHintVariant = 'default' | 'warning' | 'error' | 'success'

export interface FieldHintProps {
  message: string
  variant?: FieldHintVariant
  icon?: boolean
  className?: string
}

const variantConfig: Record<
  FieldHintVariant,
  {
    className: string
    Icon: React.ComponentType<{ className?: string }> | null
    showIconByDefault: boolean
  }
> = {
  default: {
    className: 'text-muted-foreground',
    Icon: null,
    showIconByDefault: false,
  },
  warning: {
    className: 'text-warning',
    Icon: AlertTriangle,
    showIconByDefault: true,
  },
  error: {
    className: 'text-destructive',
    Icon: XCircle,
    showIconByDefault: true,
  },
  success: {
    className: 'text-success',
    Icon: CheckCircle2,
    showIconByDefault: true,
  },
}

export function FieldHint({
  message,
  variant = 'default',
  icon,
  className,
}: FieldHintProps) {
  const config = variantConfig[variant]
  const showIcon = icon !== undefined ? icon : config.showIconByDefault
  const Icon = config.Icon

  return (
    <p className={cn('flex items-center gap-1 text-xs mt-1', config.className, className)}>
      {showIcon && Icon && <Icon className="h-3 w-3 shrink-0" />}
      {message}
    </p>
  )
}
