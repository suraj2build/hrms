/**
 * ImportJobCard — live-polling card showing import job status and progress.
 *
 * Polls every 2s while the job is in a non-terminal state.
 * Stops polling once status is completed, failed, partial_failed, or cancelled.
 */

import { useState }    from 'react'
import { useQuery }    from '@tanstack/react-query'
import { toast }       from 'sonner'
import { Badge }       from '@/components/ui/badge'
import { Button }      from '@/components/ui/button'
import { api }         from '@/lib/api/client'
import { importsApi, ImportJob } from '@/lib/api/imports'

// ── Helpers ────────────────────────────────────────────────────────────────────

const TERMINAL = new Set(['completed', 'failed', 'partial_failed', 'cancelled'])

function isTerminal(status: string) {
  return TERMINAL.has(status)
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':     return 'default'
    case 'partial_failed':
    case 'failed':        return 'destructive'
    case 'cancelled':     return 'outline'
    default:              return 'secondary'
  }
}

function progressPercent(job: ImportJob): number {
  if (job.total_rows === 0) return 0
  return Math.round((job.processed_rows / job.total_rows) * 100)
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  jobId:       string
  onRetry?:    () => void
  onCancel?:   () => void
  initialJob?: ImportJob
}

export function ImportJobCard({ jobId, onRetry, onCancel, initialJob }: Props) {
  const [isDownloading, setIsDownloading] = useState(false)

  // Fresh audit finding: see ImportJobErrors.tsx — this was a plain
  // `<a href={...} download>` pointing at the protected errors/export
  // endpoint, which this Bearer-token-authenticated app can never satisfy
  // via a native anchor navigation (and which resolves against the wrong
  // origin in production, where the API is a separate domain).
  async function handleDownloadCsv(jobId: string) {
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

  const { data, isLoading } = useQuery({
    queryKey:       ['import-job', jobId],
    queryFn:        () => importsApi.get(jobId).then(r => r.job),
    initialData:    initialJob,
    refetchInterval: (query) => {
      const job = query.state.data
      if (!job || isTerminal(job.status)) return false
      return 2000
    },
  })

  if (isLoading && !data) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
    )
  }

  if (!data) return null

  const job     = data
  const pct     = progressPercent(job)
  const done    = isTerminal(job.status)
  const hasErr  = job.failed_rows > 0

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{job.file_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {job.module ?? '—'} · {job.import_type ?? '—'} · {formatBytes(job.file_size_bytes)}
          </p>
        </div>
        <Badge variant={statusVariant(job.status)} className="shrink-0 capitalize">
          {job.status.replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Stage label */}
      {job.current_stage && (
        <p className="text-xs text-muted-foreground">{job.current_stage}</p>
      )}

      {/* Progress bar */}
      {job.total_rows > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{job.processed_rows.toLocaleString()} / {job.total_rows.toLocaleString()} rows</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Counters */}
      {(job.success_rows > 0 || job.failed_rows > 0) && (
        <div className="flex gap-4 text-xs">
          {job.success_rows > 0 && (
            <span className="text-success">
              ✓ {job.success_rows.toLocaleString()} succeeded
            </span>
          )}
          {hasErr && (
            <span className="text-destructive">
              ✗ {job.failed_rows.toLocaleString()} failed
            </span>
          )}
          {job.skipped_rows > 0 && (
            <span className="text-muted-foreground">
              — {job.skipped_rows.toLocaleString()} skipped
            </span>
          )}
        </div>
      )}

      {/* Chunk progress */}
      {job.total_chunks != null && job.current_chunk != null && (
        <p className="text-xs text-muted-foreground">
          Chunk {job.current_chunk} of {job.total_chunks}
        </p>
      )}

      {/* Actions */}
      {done && (
        <div className="flex gap-2 pt-1">
          {(job.status === 'failed' || job.status === 'partial_failed') && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
          {/* Fresh audit finding: this rendered a "Cancel" button for every
              terminal status except 'completed'/'cancelled' — i.e. also for
              'failed' and 'partial_failed', which are already-finished jobs.
              The backend's CANCELLABLE set (routes/imports/index.ts) never
              includes those statuses, so clicking it always 409s; cancel is
              only ever meaningful for an in-flight job, already covered by
              the `!done && onCancel` branch below. */}
          {hasErr && (
            <Button size="sm" variant="outline" disabled={isDownloading} onClick={() => handleDownloadCsv(job.id)}>
              {isDownloading ? 'Downloading…' : 'Download errors CSV'}
            </Button>
          )}
        </div>
      )}
      {!done && onCancel && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
