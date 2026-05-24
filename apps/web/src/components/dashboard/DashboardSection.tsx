import { cn } from '@/lib/utils'

interface DashboardSectionProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Removes outer card wrapper — use when you want bare section with just a title */
  bare?: boolean
}

export function DashboardSection({
  title, subtitle, action, children, className, bare,
}: DashboardSectionProps) {
  if (bare) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}
