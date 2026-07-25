/**
 * ImportJobErrors — paginated error table for an import job.
 *
 * Shows row number, stage, code, and message.
 * Provides a "Download CSV" button that hits the export endpoint directly.
 */

import { useState }    from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Button }      from '@/components/ui/button'
import { importsApi }  from '@/lib/api/imports'

interface Props {
  jobId:    string
  tenantId: string
}

const PAGE_SIZE = 100

export function ImportJobErrors({ jobId }: Props) {
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['import-job-errors', jobId, offset],
    queryFn:  () => importsApi.listErrors(jobId, { limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData, // ISSUE-155 — keep rows visible during page transitions
  })

  const errors = data?.errors ?? []
  const total  = data?.total  ?? 0
  const pages  = Math.ceil(total / PAGE_SIZE)
  const page   = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Row errors{total > 0 ? ` (${total.toLocaleString()})` : ''}
        </p>
        {total > 0 && (
          <a
            href={importsApi.exportErrorsCsvUrl(jobId)}
            download
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            Download CSV
          </a>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : errors.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No errors recorded.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Row</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Row key</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Stage</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Code</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {errors.map(e => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-mono tabular-nums">{e.row_number}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.row_key ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded px-1.5 py-0.5 bg-muted font-mono">{e.error_stage}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{e.error_code ?? '—'}</td>
                  <td className="px-3 py-2 text-destructive">{e.error_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
