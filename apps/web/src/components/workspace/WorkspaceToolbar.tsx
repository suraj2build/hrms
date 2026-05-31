/**
 * WorkspaceToolbar — standardized top-of-workspace toolbar row.
 *
 * Provides a search input, filter slot, export button, refresh button,
 * primary action slot, and a general extra-actions slot.
 * All controls share a consistent h-8 height.
 */

import * as React from 'react'
import { Search, Download, RefreshCw, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceToolbarProps {
  /** Search input props */
  searchValue?:       string
  onSearchChange?:    (v: string) => void
  searchPlaceholder?: string
  /** Filter slot — any React content (dropdowns, selects) */
  filters?:           React.ReactNode
  /** Export handler */
  onExport?:          () => void
  exportLabel?:       string
  /** Refresh */
  onRefresh?:         () => void
  isRefreshing?:      boolean
  /** Primary action (Create button, etc.) */
  primaryAction?:     React.ReactNode
  /** Extra actions slot */
  actions?:           React.ReactNode
  className?:         string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkspaceToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  onExport,
  exportLabel = 'Export',
  onRefresh,
  isRefreshing = false,
  primaryAction,
  actions,
  className,
}: WorkspaceToolbarProps) {
  const hasSearch  = onSearchChange !== undefined
  const hasExport  = onExport !== undefined
  const hasRefresh = onRefresh !== undefined

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>

      {/* Search input */}
      {hasSearch && (
        <div className="relative max-w-[220px] flex-shrink-0">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchValue ?? ''}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pl-7 pr-3 text-sm"
            aria-label="Search"
          />
        </div>
      )}

      {/* Filter slot */}
      {filters && (
        <div className="flex items-center gap-2">
          {filters}
        </div>
      )}

      {/* Spacer — push right-side controls to the end */}
      <div className="flex-1" />

      {/* Extra actions */}
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}

      {/* Refresh button */}
      {hasRefresh && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh"
        >
          {isRefreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      )}

      {/* Export button */}
      {hasExport && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={onExport}
        >
          <Download className="h-3.5 w-3.5" />
          {exportLabel}
        </Button>
      )}

      {/* Primary action */}
      {primaryAction}
    </div>
  )
}
