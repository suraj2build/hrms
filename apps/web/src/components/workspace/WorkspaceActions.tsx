/**
 * WorkspaceActions — right-side action bar for workspace toolbars.
 *
 * Provides standard refresh, export, filter, and add buttons with consistent
 * h-8 sizing. Bulk actions appear only when selectedCount > 0.
 */

import * as React from 'react'
import {
  RefreshCw,
  Download,
  SlidersHorizontal,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BulkAction {
  label:    string
  icon?:    React.ReactNode
  onClick:  () => void
  variant?: 'default' | 'destructive'
}

export interface WorkspaceActionsProps {
  onRefresh?:     () => void
  refreshing?:    boolean
  onExport?:      () => void
  exporting?:     boolean
  onFilter?:      () => void
  filterActive?:  boolean
  onAdd?:         () => void
  addLabel?:      string
  bulkActions?:   BulkAction[]
  selectedCount?: number
  extra?:         React.ReactNode
  className?:     string
}

// ── Component ──────────────────────────────────────────────────────────────────

export const WorkspaceActions = React.memo(function WorkspaceActions({
  onRefresh,
  refreshing    = false,
  onExport,
  exporting     = false,
  onFilter,
  filterActive  = false,
  onAdd,
  addLabel      = 'Add',
  bulkActions,
  selectedCount = 0,
  extra,
  className,
}: WorkspaceActionsProps) {
  const hasBulk    = selectedCount > 0 && bulkActions && bulkActions.length > 0
  const hasActions = onRefresh || onExport || onFilter || onAdd || extra || hasBulk

  if (!hasActions) return null

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      role="toolbar"
      aria-label="Workspace actions"
    >
      {/* Selected count indicator */}
      {selectedCount > 0 && (
        <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
          {selectedCount} selected
        </span>
      )}

      {/* Bulk actions — only shown when items are selected */}
      {hasBulk &&
        bulkActions!.map((action, index) => (
          <Button
            key={index}
            size="sm"
            variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
            onClick={action.onClick}
            aria-label={action.label}
            className="h-8"
          >
            {action.icon && (
              <span
                aria-hidden="true"
                className="[&_svg]:h-3.5 [&_svg]:w-3.5"
              >
                {action.icon}
              </span>
            )}
            {action.label}
          </Button>
        ))}

      {/* Separator between bulk and standard actions */}
      {hasBulk && (onRefresh || onExport || onFilter || onAdd || extra) && (
        <div aria-hidden="true" className="h-4 w-px bg-border" />
      )}

      {/* Extra slot */}
      {extra}

      {/* Filter */}
      {onFilter && (
        <Button
          size="sm"
          variant="outline"
          onClick={onFilter}
          aria-label="Toggle filters"
          aria-pressed={filterActive}
          className={cn(
            'h-8',
            filterActive && 'border-primary text-primary',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only sm:ml-1">Filter</span>
        </Button>
      )}

      {/* Export */}
      {onExport && (
        <Button
          size="sm"
          variant="outline"
          onClick={onExport}
          disabled={exporting}
          aria-label={exporting ? 'Exporting…' : 'Export'}
          className="h-8"
        >
          <Download
            className={cn('h-3.5 w-3.5', exporting && 'opacity-50')}
            aria-hidden="true"
          />
          <span className="sr-only sm:not-sr-only sm:ml-1">Export</span>
        </Button>
      )}

      {/* Refresh */}
      {onRefresh && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? 'Refreshing…' : 'Refresh'}
          className="h-8"
        >
          <RefreshCw
            className={cn(
              'h-3.5 w-3.5',
              refreshing && 'animate-spin',
            )}
            aria-hidden="true"
          />
          <span className="sr-only">Refresh</span>
        </Button>
      )}

      {/* Add */}
      {onAdd && (
        <Button
          size="sm"
          variant="default"
          onClick={onAdd}
          aria-label={addLabel}
          className="h-8"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1">{addLabel}</span>
        </Button>
      )}
    </div>
  )
})

WorkspaceActions.displayName = 'WorkspaceActions'
