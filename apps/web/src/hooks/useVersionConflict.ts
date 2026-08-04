/**
 * useVersionConflict — shared optimistic-concurrency (CAS) round-trip for
 * PEND-105 mutations.
 *
 * The backend endpoints this pairs with (all PUT/PATCH masters + employee-
 * profile field-edit endpoints, see migration 428 + apps/api's PEND-105
 * Phase B commits) accept an OPTIONAL `expected_version` in the request body
 * and, when it's stale, return 409 `{ error: 'VERSION_CONFLICT', message }`
 * instead of silently overwriting a concurrent edit.
 *
 * Two small pieces, meant to be composed into an existing useMutation:
 *
 *   const versionConflict = useVersionConflict([['cost-centers']])
 *
 *   const updateMut = useMutation({
 *     mutationFn: (payload: FormValues) =>
 *       api.put(`/masters/cost-centers/${editing.id}`, withExpectedVersion(payload, editing)),
 *     onError: (e: Error) => {
 *       if (versionConflict(e)) return   // 409 already toasted + query invalidated
 *       toast.error('Failed to save', { description: e.message })
 *     },
 *   })
 *
 * `editing` is whatever local state already holds the record being edited
 * (the row clicked to open the edit form) — it just needs to carry the
 * `version` field the GET/list endpoint now returns.
 */
import { toast } from 'sonner'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'

/**
 * Returns a handler for a mutation's `onError`: if `error` is a 409
 * VERSION_CONFLICT, shows a toast and invalidates the given query key(s) so
 * the next fetch reads the current version, then returns `true` (handled).
 * Any other error returns `false` so the caller's own onError still runs —
 * this hook only owns the version-conflict case, not all mutation errors.
 */
export function useVersionConflict(queryKeysToInvalidate: QueryKey[]) {
  const qc = useQueryClient()

  return (error: unknown): boolean => {
    if (!(error instanceof ApiError) || error.statusCode !== 409 || error.error !== 'VERSION_CONFLICT') {
      return false
    }
    toast.error('This record was changed by someone else', {
      description: 'Reload to see the latest version, then try saving again.',
    })
    for (const key of queryKeysToInvalidate) {
      qc.invalidateQueries({ queryKey: key })
    }
    return true
  }
}

/**
 * Merges `expected_version` into a save payload from the record currently
 * held in local state. A no-op (returns `payload` unchanged) when the
 * record has no `version` yet — e.g. this endpoint's Phase B rollout hasn't
 * reached this screen's table, or the row was fetched before migration 428.
 * The backend's own `expected_version` field is optional for exactly this
 * reason, so omitting it here is always safe, never a hard failure.
 */
export function withExpectedVersion<T extends Record<string, unknown>>(
  payload: T,
  record: { version?: number | null } | null | undefined,
): T & { expected_version?: number } {
  if (record?.version == null) return payload
  return { ...payload, expected_version: record.version }
}
