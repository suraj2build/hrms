import { cn } from '@/lib/utils'

export interface TableSkeletonProps {
  columns:      number
  rows?:        number   // default 6
  hasCheckbox?: boolean
}

// Cycle through widths for visual variety
const WIDTH_CYCLE = ['w-24', 'w-32', 'w-16', 'w-28'] as const

export function TableSkeleton({ columns, rows = 6, hasCheckbox = false }: TableSkeletonProps) {
  const bodyRows = Array.from({ length: rows })
  const cols     = Array.from({ length: columns })

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border">
          {hasCheckbox && (
            <th className="py-2.5 px-3 w-9">
              <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            </th>
          )}
          {cols.map((_, ci) => (
            <th key={ci} className="py-2.5 px-3">
              <div className={cn('h-3 rounded bg-muted animate-pulse', WIDTH_CYCLE[ci % WIDTH_CYCLE.length])} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bodyRows.map((_, ri) => (
          <tr key={ri} className="border-b border-border/50">
            {hasCheckbox && (
              <td className="py-2.5 px-3 w-9">
                <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
              </td>
            )}
            {cols.map((_, ci) => (
              <td key={ci} className="py-2.5 px-3">
                <div
                  className={cn(
                    'h-3 rounded bg-muted animate-pulse',
                    // Offset by row index so adjacent rows don't share the same width
                    WIDTH_CYCLE[(ci + ri) % WIDTH_CYCLE.length],
                  )}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
