/**
 * ImportJobDetail — full detail page for a single import job.
 *
 * Route: /admin/imports/:jobId
 */

import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ImportJobCard }   from '@/components/imports/ImportJobCard'
import { ImportJobErrors } from '@/components/imports/ImportJobErrors'
import { Button }          from '@/components/ui/button'
import { importsApi }      from '@/lib/api/imports'

export default function ImportJobDetail() {
  const { jobId }      = useParams<{ jobId: string }>()
  const navigate       = useNavigate()
  const queryClient    = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: () => importsApi.retry(jobId!),
    onSuccess:  (res) => {
      queryClient.setQueryData(['import-job', jobId], res.job)
      // ImportHistory.tsx reads the job list under this separate key.
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] })
    },
    // Fresh audit finding: no onError here meant a 409 ("already retried or
    // status changed" — a real, reachable race per the backend's own
    // comment on this route) failed completely silently, leaving the user
    // staring at a button that visibly did nothing.
    onError: (e: Error) => toast.error('Failed to retry import job', { description: e.message }),
  })

  const cancelMutation = useMutation({
    mutationFn: () => importsApi.cancel(jobId!),
    onSuccess:  (res) => {
      queryClient.setQueryData(['import-job', jobId], res.job)
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] })
    },
    // Same fix as retryMutation above — a 409 ("already finished or status
    // changed") must surface, not fail silently.
    onError: (e: Error) => toast.error('Failed to cancel import job', { description: e.message }),
  })

  function handleCancel() {
    if (confirm('Cancel this import job? Any rows not yet processed will not be imported.')) {
      cancelMutation.mutate()
    }
  }

  if (!jobId) return null

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        ← Back
      </Button>

      <h1 className="text-xl font-semibold">Import Job</h1>

      {/* Live progress card */}
      <ImportJobCard
        jobId={jobId}
        onRetry={retryMutation.isPending ? undefined : () => retryMutation.mutate()}
        onCancel={cancelMutation.isPending ? undefined : handleCancel}
      />

      {/* Error table */}
      <ImportJobErrors jobId={jobId} tenantId="" />
    </div>
  )
}
