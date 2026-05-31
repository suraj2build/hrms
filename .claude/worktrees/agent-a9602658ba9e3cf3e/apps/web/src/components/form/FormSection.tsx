import React from 'react'
import { cn } from '@/lib/utils'

export interface FormSectionProps {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  divider?: boolean
  className?: string
}

export function FormSection({
  title,
  subtitle,
  action,
  children,
  divider = false,
  className,
}: FormSectionProps) {
  const hasHeader = title || subtitle || action

  return (
    <div className={cn('space-y-4', className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
      {divider && <div className="border-b border-border" />}
    </div>
  )
}
