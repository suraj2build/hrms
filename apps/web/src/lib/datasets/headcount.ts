import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'

// ── Response shape ────────────────────────────────────────────────────────────

export interface HeadcountDataset {
  meta: { month: string; generated_at: string }
  snapshot: {
    active: number
    joiners: number
    exits: number
    attrition_rate: number
  }
  by_department: Array<{ department_id: string | null; name: string; count: number }>
  by_employment_type: Array<{ type: string; count: number }>
  monthly_trend: Array<{ month: string; active: number; joiners: number; exits: number }> | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const STALE_TIME = 5 * 60 * 1000 // 5 min

export interface UseHeadcountDatasetParams {
  month: string
  departmentId?: string
  includeTrends?: boolean
}

/**
 * Canonical dataset hook for headcount.
 * Cache key: ['dataset', 'headcount', tenantId, month, departmentId, trendsFlag]
 */
export function useHeadcountDataset(params: UseHeadcountDatasetParams) {
  const tenantId = useAuthStore(s => s.tenant?.id ?? 'unknown')
  const { month, departmentId, includeTrends } = params

  return useQuery<HeadcountDataset>({
    queryKey: [
      'dataset',
      'headcount',
      tenantId,
      month,
      departmentId ?? 'all',
      includeTrends ? 'trends' : 'no-trends',
    ],
    queryFn: () => {
      const qs = new URLSearchParams({ month })
      if (departmentId) qs.set('department_id', departmentId)
      if (includeTrends !== undefined) qs.set('include_trends', String(includeTrends))
      return api.get<HeadcountDataset>(`/datasets/headcount?${qs.toString()}`)
    },
    staleTime: STALE_TIME,
    enabled: Boolean(month),
  })
}
