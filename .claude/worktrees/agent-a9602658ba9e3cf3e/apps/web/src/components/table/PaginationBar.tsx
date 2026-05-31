import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PaginationBarProps {
  total:             number
  page:              number    // 1-indexed
  pageSize:          number
  onPageChange:      (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?:  number[]  // default [25, 50, 100]
  className?: string
}

function buildPageList(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: (number | '...')[] = [1]

  const rangeStart = Math.max(2, currentPage - 1)
  const rangeEnd   = Math.min(totalPages - 1, currentPage + 1)

  if (rangeStart > 2) pages.push('...')

  for (let p = rangeStart; p <= rangeEnd; p++) {
    pages.push(p)
  }

  if (rangeEnd < totalPages - 1) pages.push('...')

  pages.push(totalPages)
  return pages
}

export function PaginationBar({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  className,
}: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start      = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end        = Math.min(page * pageSize, total)

  const pageList = buildPageList(page, totalPages)

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground',
        className,
      )}
    >
      {/* Left: result count */}
      <span>
        {total === 0
          ? 'No results'
          : `Showing ${start}–${end} of ${total}`}
      </span>

      {/* Right: page-size selector + navigation */}
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className={cn(
                'h-6 rounded border border-border bg-background px-1 text-xs text-foreground',
                'focus:outline-none focus:ring-1 focus:ring-ring',
              )}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}

        {/* Page navigation */}
        <div className="flex items-center gap-0.5">
          {/* Previous */}
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className={cn(
              'h-6 w-6 rounded flex items-center justify-center text-xs transition-colors',
              'hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {/* Page buttons */}
          {pageList.map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="h-6 w-6 flex items-center justify-center text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p as number)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? 'page' : undefined}
                className={cn(
                  'h-6 w-6 rounded flex items-center justify-center text-xs transition-colors',
                  p === page
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-muted text-foreground',
                )}
              >
                {p}
              </button>
            ),
          )}

          {/* Next */}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            className={cn(
              'h-6 w-6 rounded flex items-center justify-center text-xs transition-colors',
              'hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
