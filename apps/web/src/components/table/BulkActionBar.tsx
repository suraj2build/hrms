import * as React from 'react'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BulkAction {
  id:       string
  label:    string
  icon?:    React.ComponentType<{ className?: string }>
  variant?: 'default' | 'destructive' | 'warning'
  onClick:  () => void
  loading?: boolean
  disabled?: boolean
}

export interface BulkActionBarProps {
  selectedCount:    number
  actions:          BulkAction[]
  onClearSelection: () => void
  className?: string
}

const actionVariantClasses: Record<NonNullable<BulkAction['variant']>, string> = {
  default:     'border-border text-foreground hover:bg-muted/50',
  destructive: 'border-destructive/30 text-destructive hover:bg-destructive/10',
  warning:     'border-warning/30 text-warning hover:bg-warning/10',
}

export function BulkActionBar({
  selectedCount,
  actions,
  onClearSelection,
  className,
}: BulkActionBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2 bg-primary/5 border border-primary/20 rounded-md mx-4 mb-2',
        className,
      )}
    >
      {/* Selected count */}
      <span className="text-xs font-semibold text-primary whitespace-nowrap">
        {selectedCount} selected
      </span>

      {/* Divider */}
      <div className="h-4 w-px bg-border" />

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 flex-1 flex-wrap">
        {actions.map((action) => {
          const Icon = action.icon
          const variantCls = actionVariantClasses[action.variant ?? 'default']

          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-xs font-medium transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                variantCls,
              )}
            >
              {action.loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : Icon ? (
                <Icon className="h-3 w-3" />
              ) : null}
              {action.label}
            </button>
          )
        })}
      </div>

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClearSelection}
        className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
      >
        <X className="h-3 w-3" />
        Clear
      </button>
    </div>
  )
}
