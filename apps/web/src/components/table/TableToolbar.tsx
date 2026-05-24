/**
 * TableToolbar — standard toolbar above operational tables.
 *
 * Layout:
 *   [left elements ───────────────] [right elements]
 *   [chip chip chip] [clear all]     ← only if chips exist
 *
 * Usage:
 *   <TableToolbar
 *     left={<Input placeholder="Search…" />}
 *     right={<Button size="sm">+ Add</Button>}
 *     filterChips={[{ key: 'status', label: 'Status: Pending' }]}
 *     onRemoveChip={(key) => removeFilter(key)}
 *     onClearAllChips={() => clearAllFilters()}
 *   />
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { FilterChip } from './FilterChip'

export interface FilterChipItem {
  key:   string
  label: string
}

export interface TableToolbarProps {
  /** Left slot: search input, filter selects, date pickers */
  left?: React.ReactNode
  /** Right slot: export, create buttons, utility icons */
  right?: React.ReactNode
  /** Active filter chips shown below the left/right row */
  filterChips?: FilterChipItem[]
  onRemoveChip?: (key: string) => void
  /** When provided, adds a "Clear all" chip at the end */
  onClearAllChips?: () => void
  className?: string
}

export function TableToolbar({
  left,
  right,
  filterChips,
  onRemoveChip,
  onClearAllChips,
  className,
}: TableToolbarProps) {
  const hasChips = filterChips && filterChips.length > 0

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Main row */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
        {/* Left: search + filters */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {left}
        </div>

        {/* Right: actions */}
        {right && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            {right}
          </div>
        )}
      </div>

      {/* Chip row — only rendered when chips are present */}
      {hasChips && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 border-b border-border/40">
          {filterChips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              onRemove={() => onRemoveChip?.(chip.key)}
            />
          ))}
          {onClearAllChips && (
            <button
              type="button"
              onClick={onClearAllChips}
              className="inline-flex items-center h-5 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
