/**
 * DataTable — enterprise-grade shared table primitive.
 *
 * Features:
 *   - sticky headers (overflow-x-auto container with sticky thead)
 *   - compact density (py-2.5 rows)
 *   - hover states
 *   - row selection (checkbox column, optional)
 *   - loading skeleton (TableSkeleton)
 *   - empty state (EmptyTableState or custom ReactNode)
 *   - column sorting (optional per-column)
 *   - horizontal overflow
 *   - keyboard accessible checkboxes
 */

import * as React from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TableSkeleton } from './TableSkeleton'
import { EmptyTableState } from './EmptyTableState'

export interface DataTableColumn<T> {
  id:         string
  header:     string
  cell:       (row: T, index: number) => React.ReactNode
  className?: string    // applied to both th and td
  sortable?:  boolean
  minWidth?:  string    // e.g. "120px"
}

export interface DataTableProps<T> {
  columns:   DataTableColumn<T>[]
  data:      T[]
  getRowKey: (row: T) => string
  loading?:       boolean
  skeletonRows?:  number            // default 6
  emptyState?:    React.ReactNode   // if omitted, shows default EmptyTableState
  onRowClick?:    (row: T) => void
  /** Row selection */
  selectable?:          boolean
  selectedIds?:         Set<string>
  onSelectionChange?:   (ids: Set<string>) => void
  getRowId?:            (row: T) => string  // required when selectable=true
  /** Sort state */
  sortColumn?:    string
  sortDirection?: 'asc' | 'desc'
  onSortChange?:  (column: string, direction: 'asc' | 'desc') => void
  className?: string
  /** Extra row content — renders as full-width <tr> below the row */
  renderRowExpansion?: (row: T) => React.ReactNode | null
}

// ─── Sort icon ───────────────────────────────────────────────────────────────

interface SortIconProps {
  active:    boolean
  direction: 'asc' | 'desc' | undefined
}

function SortIcon({ active, direction }: SortIconProps) {
  if (active && direction === 'asc') {
    return <ChevronUp className="h-3 w-3 text-primary" />
  }
  if (active && direction === 'desc') {
    return <ChevronDown className="h-3 w-3 text-primary" />
  }
  // Inactive — show on hover via group-hover
  return (
    <ChevronUp className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />
  )
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  loading      = false,
  skeletonRows = 6,
  emptyState,
  onRowClick,
  selectable          = false,
  selectedIds         = new Set<string>(),
  onSelectionChange,
  getRowId,
  sortColumn,
  sortDirection,
  onSortChange,
  className,
  renderRowExpansion,
}: DataTableProps<T>) {
  // Total column span (data cols + optional checkbox col)
  const totalCols = columns.length + (selectable ? 1 : 0)

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allIds: string[] = React.useMemo(() => {
    if (!selectable || !getRowId) return []
    return data.map(getRowId)
  }, [data, selectable, getRowId])

  const allSelected  = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))
  const someSelected = !allSelected && allIds.some((id) => selectedIds.has(id))

  function handleSelectAll(checked: boolean) {
    if (!onSelectionChange) return
    if (checked) {
      onSelectionChange(new Set(allIds))
    } else {
      onSelectionChange(new Set())
    }
  }

  function handleSelectRow(id: string, checked: boolean) {
    if (!onSelectionChange) return
    const next = new Set(selectedIds)
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
    onSelectionChange(next)
  }

  // ── Sort helper ────────────────────────────────────────────────────────────
  function handleSort(colId: string) {
    if (!onSortChange) return
    if (sortColumn === colId) {
      onSortChange(colId, sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(colId, 'asc')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm border-separate border-spacing-0">
        {/* ── Header ── */}
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {/* Checkbox column */}
            {selectable && (
              <th className="w-9 pr-0 py-2.5 px-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  aria-label="Select all rows"
                  className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                />
              </th>
            )}

            {/* Data column headers */}
            {columns.map((col) => {
              const isSorted = sortColumn === col.id
              const isSortable = col.sortable && !!onSortChange

              return (
                <th
                  key={col.id}
                  className={cn(
                    'text-left text-xs font-semibold text-muted-foreground py-2.5 px-3 whitespace-nowrap',
                    col.className,
                    isSortable && 'cursor-pointer select-none group',
                  )}
                  style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                  onClick={isSortable ? () => handleSort(col.id) : undefined}
                  aria-sort={
                    isSorted
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {isSortable && (
                      <SortIcon active={isSorted} direction={isSorted ? sortDirection : undefined} />
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>

        {/* ── Body ── */}
        <tbody>
          {/* Loading skeleton */}
          {loading ? (
            <tr>
              <td colSpan={totalCols} className="p-0">
                <TableSkeleton
                  columns={columns.length}
                  rows={skeletonRows}
                  hasCheckbox={selectable}
                />
              </td>
            </tr>
          ) : data.length === 0 ? (
            /* Empty state */
            <tr>
              <td colSpan={totalCols}>
                {emptyState ?? <EmptyTableState />}
              </td>
            </tr>
          ) : (
            /* Data rows */
            data.map((row, rowIndex) => {
              const rowKey = getRowKey(row)
              const rowId  = selectable && getRowId ? getRowId(row) : rowKey
              const isSelected = selectable && selectedIds.has(rowId)
              const expansion  = renderRowExpansion ? renderRowExpansion(row) : null

              return (
                <React.Fragment key={rowKey}>
                  <tr
                    className={cn(
                      'hover:bg-muted/30 transition-colors',
                      onRowClick && 'cursor-pointer',
                      isSelected && 'bg-primary/5',
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {/* Row checkbox */}
                    {selectable && (
                      <td className="w-9 pr-0 py-2.5 px-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            // Prevent row-click from also firing
                            e.stopPropagation()
                            handleSelectRow(rowId, e.target.checked)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select row ${rowId}`}
                          className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                        />
                      </td>
                    )}

                    {/* Data cells */}
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn('py-2.5 px-3', col.className)}
                        style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                      >
                        {col.cell(row, rowIndex)}
                      </td>
                    ))}
                  </tr>

                  {/* Row expansion */}
                  {expansion != null && (
                    <tr>
                      <td colSpan={totalCols} className="p-0">
                        {expansion}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
