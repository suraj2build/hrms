/**
 * ImportJobErrors — paginated error table for an import job.
 *
 * Shows row number, stage, code, and message.
 * Provides a "Download CSV" button that hits the export endpoint directly.
 */

import { useState }    from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { toast }       from 'sonner'
import { Button }      from '@/components/ui/button'
import { api }          from '@/lib/api/client'
import { importsApi }  from '@/lib/api/imports'

interface Props {
  jobId:    string
  tenantId: string
}

const PAGE_SIZE = 100

export function ImportJobErrors({ jobId }: Props) {
  const [offset, setOffset] = useState(0)
  const [isDownloading, setIsDownloading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['import-job-errors', jobId, offset],
    queryFn:  () => importsApi.listErrors(jobId, { limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData, // ISSUE-155 — keep rows visible during page transitions
  })

  const errors = data?.errors ?? []
  const total  = data?.total  ?? 0
  const pages  = Math.ceil(total / PAGE_SIZE)
  const page   = Math.floor(offset / PAGE_SIZE) + 1

  // Fresh audit finding: this was a plain `<a href={...} download>` pointing
  // straight at the protected /imports/:jobId/errors/export endpoint. This
  // app authenticates via a Bearer token attached by the api client's fetch
  // wrapper (apps/web/src/lib/api/client.ts), never a cookie — a native
  // anchor navigation carries no such header, so the request always 401s
  // (and in production, where VITE_API_URL points at a separate API origin,
  // a bare relative href also resolves against the wrong origin entirely).
  // ImportWorkspace.tsx's template download already established the correct
  // pattern for a protected file download: api.getRaw + blob + object URL.
  async function handleDownloadCsv() {
    setIsDownloading(true)
    try {
      const response = await api.getRaw(importsApi.exportErrorsCsvUrl(jobId))
      const blob = await response.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `import_job_${jobId}_errors.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Failed to download error CSV', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Row errors{total > 0 ? ` (${total.toLocaleString()})` : ''}
        </p>
        {total > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={isDownloading}
            onClick={handleDownloadCsv}
            className="h-auto px-3 py-1.5 text-xs font-medium"
          >
            {isDownloading ? 'Downloading…' : 'Download CSV'}
          </Button>
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
