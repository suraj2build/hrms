/**
 * ImportHistory — paginated list of all import jobs for the tenant.
 *
 * Route: /admin/imports
 */

import { useState }           from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate }        from 'react-router-dom'
import { Badge }              from '@/components/ui/badge'
import { Button }             from '@/components/ui/button'
import { importsApi, ImportJob } from '@/lib/api/imports'

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':                     return 'default'
    case 'partial_failed': case 'failed': return 'destructive'
    case 'cancelled':                     return 'outline'
    default:                              return 'secondary'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

// ── Component ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

export default function ImportHistory() {
  const navigate  = useNavigate()
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['import-jobs', offset],
    queryFn:  () => importsApi.list({ limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData, // ISSUE-155 — keep rows visible during page transitions
  })

  const jobs  = data?.jobs  ?? []
  const total = data?.total ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)
  const page  = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import History</h1>
        <p className="text-sm text-muted-foreground">{total} jobs total</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No import jobs yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">File</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Module</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Rows</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Errors</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((job: ImportJob) => (
                <tr
                  key={job.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/admin/imports/${job.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium truncate max-w-xs">{job.file_name}</p>
                    {job.current_stage && (
                      <p className="text-xs text-muted-foreground mt-0.5">{job.current_stage}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {job.module ?? '—'}
                    {job.import_type ? ` / ${job.import_type}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(job.status)} className="capitalize">
                      {job.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {job.total_rows > 0 ? job.total_rows.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {job.failed_rows > 0 ? (
                      <span className="text-destructive">{job.failed_rows.toLocaleString()}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                    {formatDate(job.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {pages}</span>
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
