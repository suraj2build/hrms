/**
 * SubTabs — the canonical in-page sub-tab bar (underline style).
 *
 * One consistent look for every page's secondary tabs: 13px label, optional
 * lucide icon, optional count badge, brand-primary underline + text on the
 * active tab. Replaces the various hand-rolled tab bars (text-xs vs text-sm,
 * pill vs underline, icon vs no-icon) so they all match.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SubTab<T extends string> {
  id: T
  label: string
  icon?: React.ElementType
  badge?: number
}

export function SubTabs<T extends string>({
  tabs, value, onChange, className,
}: {
  tabs: ReadonlyArray<SubTab<T>>
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-0.5 overflow-x-auto border-b border-border scrollbar-none', className)}>
      {tabs.map(tab => {
        const Icon = tab.icon
        const active = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap border-b-2 -mb-px px-3.5 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/60',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
            {tab.label}
            {typeof tab.badge === 'number' && tab.badge > 0 && (
              <span className={cn(
                'ml-0.5 rounded-full px-1.5 py-0 text-[10px] font-semibold leading-[1.6] tabular-nums',
                active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              )}>
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
