import { type ReactNode } from 'react'
import { ChevronRight }   from 'lucide-react'
import { SeverityBadge }  from './SeverityBadge.js'
import { cn }             from '@/lib/utils'

interface MetaItem {
  label: string
  value: string | number | ReactNode
}

interface IntelligenceCardProps {
  title:     string
  subtitle?: string
  severity?: 'info' | 'warning' | 'high' | 'critical' | string
  score?:    number
  meta?:     MetaItem[]
  onClick?:  () => void
  className?: string
  children?:  ReactNode
}

export function IntelligenceCard({
  title,
  subtitle,
  severity,
  meta,
  onClick,
  className,
  children,
}: IntelligenceCardProps) {
  const isClickable = !!onClick

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground truncate flex-1">{title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {severity && <SeverityBadge severity={severity} />}
          {isClickable && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
          )}
        </div>
      </div>

      {subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      )}

      {meta && meta.length > 0 && (
        <dl className="mt-2 space-y-0.5">
          {meta.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <dt className="text-muted-foreground">{m.label}:</dt>
              <dd className="font-medium">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {children && <div className="mt-2">{children}</div>}
    </>
  )

  const baseClass = cn(
    'rounded-lg border p-3 transition-colors space-y-0.5',
    isClickable && 'cursor-pointer hover:bg-muted/40',
    className,
  )

  if (isClickable) {
    return (
      <button type="button" className={cn(baseClass, 'w-full text-left')} onClick={onClick}>
        {inner}
      </button>
    )
  }

  return <div className={baseClass}>{inner}</div>
}
