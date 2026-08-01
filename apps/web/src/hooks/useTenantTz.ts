/**
 * useTenantTz — the tenant's configured IANA timezone, for computing a
 * tenant-local "today" instead of the browser's UTC or device-local zone.
 *
 * Backed by GET /workspace/company (open to all authenticated roles, no
 * admin gate), the same `tenants.timezone` column the backend's own
 * fetchTenantTz()/getLocalDate() combo (attendance-engine.ts/org-context.ts)
 * reads from. Falls back to 'UTC' while loading or on error, matching the
 * backend helper's own fallback.
 */

import { useQuery } from '@tanstack/react-query'
import { api }      from '@/lib/api/client'

export function useTenantTz(): string {
  const { data } = useQuery<{ data: { timezone?: string } }>({
    // Same key as Settings.tsx's own /workspace/company query so both share
    // one cached fetch instead of duplicating the request across the app.
    queryKey: ['workspace-company'],
    queryFn:  () => api.get('/workspace/company'),
    staleTime: 30 * 60_000, // tenant timezone changes essentially never
  })
  return data?.data?.timezone ?? 'UTC'
}
