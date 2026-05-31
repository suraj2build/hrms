import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MoreHorizontal,
  Columns,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  id: string
  header: string
  accessorKey?: keyof T
  cell?: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
  hidden?: boolean
  align?: 'left' | 'center' | 'right'
}

export interface WorkspaceTableProps<T extends { id: string }> {
  data: T[]
  columns: ColumnDef<T>[]
  loading?: boolean
  emptyTitle?: string
  emptyDesc?: string
  totalCount?: number
  page?: number
  pageSize?: number
  onPageChange?: (page: number) => void
  searchable?: boolean
  searchPlaceholder?: string
  onSearch?: (q: string) => void
  columnVisibility?: boolean
  selectable?: boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  rowActions?: (row: T) => Array<{
    label: string
    icon?: React.ReactNode
    onClick: (row: T) => void
    variant?: 'default' | 'destructive'
  }>
  exportable?: boolean
  onExport?: () => void
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string, dir: 'asc' | 'desc') => void
  stickyHeader?: boolean
  maxHeight?: string
  className?: string
  rowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
}

// ── Skeleton widths ──────────────────────────────────────────────────────────

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-16', 'w-20', 'w-28'] as const

// ── Row Actions Menu ─────────────────────────────────────────────────────────

interface RowActionsMenuProps<T extends { id: string }> {
  row: T
  actions: Array<{
    label: string
    icon?: React.ReactNode
    onClick: (row: T) => void
    variant?: 'default' | 'destructive'
  }>
}

function RowActionsMenu<T extends { id: string }>({ row, actions }: RowActionsMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Row actions"
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p) }}
        className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg min-w-[160px] overflow-hidden py-1">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                action.onClick(row)
                setOpen(false)
              }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors',
                action.variant === 'destructive'
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              {action.icon && <span className="w-4 h-4 flex items-center">{action.icon}</span>}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Column Visibility Toggle ─────────────────────────────────────────────────

interface ColumnVisibilityToggleProps<T> {
  columns: ColumnDef<T>[]
  visibility: Record<string, boolean>
  onToggle: (id: string) => void
}

function ColumnVisibilityToggle<T>({ columns, visibility, onToggle }: ColumnVisibilityToggleProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-label="Toggle column visibility"
        onClick={() => setOpen((p) => !p)}
        className="gap-1.5"
      >
        <Columns className="w-3.5 h-3.5" />
        Columns
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg min-w-[180px] overflow-hidden py-2">
          <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Toggle columns
          </p>
          {columns.map((col) => (
            <label
              key={col.id}
              className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors"
            >
              <input
                type="checkbox"
                checked={visibility[col.id] ?? true}
                onChange={() => onToggle(col.id)}
                className="w-3.5 h-3.5 rounded border-border accent-primary"
              />
              <span className="text-foreground">{col.header}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export function WorkspaceTable<T extends { id: string }>({
  data,
  columns,
  loading = false,
  emptyTitle = 'No data',
  emptyDesc,
  totalCount,
  page = 1,
  pageSize = 25,
  onPageChange,
  searchable = false,
  searchPlaceholder = 'Search…',
  onSearch,
  columnVisibility: showColumnVisibility = false,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  rowActions,
  exportable = false,
  onExport,
  sortKey,
  sortDir,
  onSort,
  stickyHeader = true,
  maxHeight,
  className,
  rowClassName,
  onRowClick,
}: WorkspaceTableProps<T>) {
  // ── Local sort state (client-side) ─────────────────────────────────────────
  const [localSortKey, setLocalSortKey] = useState<string | undefined>(sortKey)
  const [localSortDir, setLocalSortDir] = useState<'asc' | 'desc' | undefined>(sortDir)

  // ── Search state ───────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')

  // ── Local page state (client-side) ─────────────────────────────────────────
  const [localPage, setLocalPage] = useState(page)

  // ── Column visibility ──────────────────────────────────────────────────────
  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const col of columns) {
      init[col.id] = col.hidden !== true
    }
    return init
  })

  const handleToggleColumn = useCallback((id: string) => {
    setColVisibility((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const visibleColumns = useMemo(
    () => columns.filter((col) => colVisibility[col.id] !== false),
    [columns, colVisibility],
  )

  // ── Sort handler ───────────────────────────────────────────────────────────
  const handleSort = useCallback(
    (colId: string) => {
      if (onSort) {
        const nextDir =
          sortKey === colId
            ? sortDir === 'asc' ? 'desc' : 'asc'
            : 'asc'
        onSort(colId, nextDir)
      } else {
        setLocalSortKey((prev) => {
          if (prev !== colId) { setLocalSortDir('asc'); return colId }
          setLocalSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? undefined : 'asc'))
          return colId
        })
      }
    },
    [onSort, sortKey, sortDir],
  )

  // ── Effective sort key/dir ─────────────────────────────────────────────────
  const effectiveSortKey = onSort ? sortKey : localSortKey
  const effectiveSortDir = onSort ? sortDir : localSortDir

  // ── Client-side search ─────────────────────────────────────────────────────
  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q)
      setLocalPage(1)
      if (onSearch) onSearch(q)
    },
    [onSearch],
  )

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (onSearch || !searchQuery.trim()) return data
    const q = searchQuery.toLowerCase()
    return data.filter((row) =>
      Object.values(row as Record<string, unknown>).some(
        (v) => typeof v === 'string' && v.toLowerCase().includes(q),
      ),
    )
  }, [data, searchQuery, onSearch])

  // ── Client-side sort ───────────────────────────────────────────────────────
  const sortedData = useMemo(() => {
    if (!effectiveSortKey || !effectiveSortDir || onSort) return filteredData
    const col = columns.find((c) => c.id === effectiveSortKey)
    if (!col?.accessorKey) return filteredData
    const key = col.accessorKey
    return [...filteredData].sort((a, b) => {
      const av = String(a[key] ?? '')
      const bv = String(b[key] ?? '')
      const cmp = av.localeCompare(bv, undefined, { numeric: true })
      return effectiveSortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredData, effectiveSortKey, effectiveSortDir, columns, onSort])

  // ── Pagination ─────────────────────────────────────────────────────────────
  const isServerPaginated = !!totalCount && !!onPageChange
  const effectivePage = isServerPaginated ? page : localPage
  const effectiveTotal = totalCount ?? filteredData.length

  const pagedData = useMemo(() => {
    if (isServerPaginated) return sortedData
    const start = (effectivePage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [isServerPaginated, sortedData, effectivePage, pageSize])

  const totalPages = Math.ceil(effectiveTotal / pageSize)
  const showFrom = (effectivePage - 1) * pageSize + 1
  const showTo = Math.min(effectivePage * pageSize, effectiveTotal)

  const goToPage = useCallback(
    (p: number) => {
      if (isServerPaginated) onPageChange?.(p)
      else setLocalPage(p)
    },
    [isServerPaginated, onPageChange],
  )

  // ── Selection ──────────────────────────────────────────────────────────────
  const visibleIds = pagedData.map((r) => r.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const someSelected = visibleIds.some((id) => selectedIds.includes(id))

  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(selectedIds.filter((id) => !visibleIds.includes(id)))
    } else {
      const merged = Array.from(new Set([...selectedIds, ...visibleIds]))
      onSelectionChange(merged)
    }
  }, [allSelected, visibleIds, selectedIds, onSelectionChange])

  const handleSelectRow = useCallback(
    (id: string) => {
      if (!onSelectionChange) return
      if (selectedIds.includes(id)) {
        onSelectionChange(selectedIds.filter((s) => s !== id))
      } else {
        onSelectionChange([...selectedIds, id])
      }
    },
    [selectedIds, onSelectionChange],
  )

  // ── Align class map ────────────────────────────────────────────────────────
  const alignClass = (align?: 'left' | 'center' | 'right') => {
    if (align === 'center') return 'text-center'
    if (align === 'right') return 'text-right'
    return 'text-left'
  }

  const showToolbar = searchable || showColumnVisibility || exportable
  const showPagination = effectiveTotal > pageSize

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden', className)}>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {showToolbar && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card">
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8 h-8 text-sm"
                aria-label="Search table"
              />
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {showColumnVisibility && (
              <ColumnVisibilityToggle
                columns={columns}
                visibility={colVisibility}
                onToggle={handleToggleColumn}
              />
            )}
            {exportable && (
              <Button
                variant="outline"
                size="sm"
                aria-label="Export data"
                onClick={onExport}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Table container ──────────────────────────────────────────────── */}
      <div
        className={cn(
          'overflow-auto',
          maxHeight ?? 'max-h-[560px]',
          stickyHeader && 'relative',
        )}
      >
        <table className="w-full text-sm border-collapse">
          <thead
            className={cn(
              stickyHeader && 'sticky top-0 z-10 bg-muted/80 backdrop-blur-sm',
            )}
          >
            <tr className="border-b border-border">
              {selectable && (
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={handleSelectAll}
                    className="w-3.5 h-3.5 rounded border-border accent-primary"
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    'px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide',
                    alignClass(col.align),
                    col.width,
                    col.sortable && 'cursor-pointer select-none hover:text-foreground transition-colors',
                  )}
                  onClick={col.sortable ? () => handleSort(col.id) : undefined}
                  aria-sort={
                    effectiveSortKey === col.id
                      ? effectiveSortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <span className="text-muted-foreground/60">
                        {effectiveSortKey === col.id ? (
                          effectiveSortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              ))}
              {rowActions && <th className="w-12" aria-label="Actions" />}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, ri) => (
                <tr key={ri} className="border-b border-border last:border-0">
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <div className="h-3.5 w-3.5 bg-muted rounded animate-pulse" />
                    </td>
                  )}
                  {visibleColumns.map((col, ci) => (
                    <td key={col.id} className="px-3 py-2.5">
                      <div
                        className={cn(
                          'h-4 bg-muted rounded animate-pulse',
                          SKELETON_WIDTHS[(ri * visibleColumns.length + ci) % SKELETON_WIDTHS.length],
                        )}
                      />
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-3 py-2.5">
                      <div className="h-4 w-4 bg-muted rounded animate-pulse mx-auto" />
                    </td>
                  )}
                </tr>
              ))
            ) : pagedData.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    visibleColumns.length +
                    (selectable ? 1 : 0) +
                    (rowActions ? 1 : 0)
                  }
                  className="px-3 py-16 text-center"
                >
                  <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                  {emptyDesc && (
                    <p className="text-xs text-muted-foreground mt-1">{emptyDesc}</p>
                  )}
                </td>
              </tr>
            ) : (
              pagedData.map((row, ri) => {
                const isSelected = selectedIds.includes(row.id)
                return (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-b border-border last:border-0 transition-colors',
                      'even:bg-muted/20',
                      'hover:bg-muted/40',
                      isSelected && 'bg-primary/5',
                      onRowClick && 'cursor-pointer',
                      rowClassName?.(row),
                    )}
                    aria-selected={selectable ? isSelected : undefined}
                  >
                    {selectable && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select row ${ri + 1}`}
                          checked={isSelected}
                          onChange={(e) => { e.stopPropagation(); handleSelectRow(row.id) }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 rounded border-border accent-primary"
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.id}
                        className={cn('px-3 py-2.5 text-sm text-foreground', alignClass(col.align))}
                      >
                        {col.cell
                          ? col.cell(row)
                          : col.accessorKey !== undefined
                          ? String(row[col.accessorKey] ?? '')
                          : null}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-3 py-2.5 text-right">
                        <RowActionsMenu row={row} actions={rowActions(row)} />
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {showPagination && (
        <div className="flex items-center justify-between gap-4 px-3 py-2.5 border-t border-border bg-card text-xs text-muted-foreground">
          <span>
            Showing {showFrom}–{showTo} of {effectiveTotal}
          </span>
          <div className="flex items-center gap-1.5">
            {!isServerPaginated && (
              <select
                aria-label="Page size"
                value={pageSize}
                className="h-7 rounded border border-border bg-background px-1.5 text-xs text-foreground"
                onChange={() => {
                  // page size is controlled by parent; reset to page 1
                  goToPage(1)
                }}
              >
                {[10, 25, 50, 100].map((s) => (
                  <option key={s} value={s}>{s} / page</option>
                ))}
              </select>
            )}
            <button
              aria-label="Previous page"
              disabled={effectivePage <= 1}
              onClick={() => goToPage(effectivePage - 1)}
              className="flex items-center justify-center w-7 h-7 rounded border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 py-1 rounded border border-border bg-background text-foreground font-medium min-w-[60px] text-center">
              {effectivePage} / {totalPages}
            </span>
            <button
              aria-label="Next page"
              disabled={effectivePage >= totalPages}
              onClick={() => goToPage(effectivePage + 1)}
              className="flex items-center justify-center w-7 h-7 rounded border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
