/**
 * DashboardShell — responsive grid wrapper for all dashboards.
 * NOT a visual element — purely a layout primitive.
 */
import { cn } from '@/lib/utils'

interface DashboardShellProps {
  children: React.ReactNode
  className?: string
}

export function DashboardShell({ children, className }: DashboardShellProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {children}
    </div>
  )
}

/**
 * Two-column grid: main (2/3) + rail (1/3). Stacks on tablet/mobile.
 */
export function DashboardGrid({ children, className }: DashboardShellProps) {
  return (
    <div className={cn('grid grid-cols-1 xl:grid-cols-3 gap-4', className)}>
      {children}
    </div>
  )
}

/** Primary content column: takes 2/3 width on xl */
export function DashboardMain({ children, className }: DashboardShellProps) {
  return (
    <div className={cn('xl:col-span-2 space-y-4', className)}>
      {children}
    </div>
  )
}

/** Secondary rail: takes 1/3 width on xl */
export function DashboardRail({ children, className }: DashboardShellProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {children}
    </div>
  )
}
