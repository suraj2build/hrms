import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'

// ── Response shape ────────────────────────────────────────────────────────────

export interface PayrollCostDataset {
  meta: { month: string; department_id: string | null; generated_at: string }
  summary: {
    total_gross: number
    total_net: number
    total_deductions: number
    total_lop_amount: number
    total_ot_cost: number
    headcount: number
    avg_cost_per_employee: number
    finalized: boolean
    run_status: string | null
  }
  by_department: Array<{
    department_id: string | null
    name: string
    headcount: number
    gross: number
    net: number
    deductions: number
    cost_share_pct: number
  }>
  mom_variance: {
    prior_month: string
    prior_gross: number
    variance: number
    variance_pct: number
  } | null
  trends: Array<{ month: string; gross: number; net: number; headcount: number }> | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const STALE_TIME = 5 * 60 * 1000 // 5 min

export interface UsePayrollCostDatasetParams {
  month: string
  departmentId?: string
  includeTrends?: boolean
}

/**
 * Canonical dataset hook for payroll cost intelligence.
 * Cache key: ['dataset', 'payroll-cost', tenantId, month, departmentId, trendsFlag]
 */
export function usePayrollCostDataset(params: UsePayrollCostDatasetParams) {
  const tenantId = useAuthStore(s => s.tenant?.id ?? 'unknown')
  const { month, departmentId, includeTrends } = params

  return useQuery<PayrollCostDataset>({
    queryKey: [
      'dataset',
      'payroll-cost',
      tenantId,
      month,
      departmentId ?? 'all',
      includeTrends ? 'trends' : 'no-trends',
    ],
    queryFn: () => {
      const qs = new URLSearchParams({ month })
      if (departmentId) qs.set('department_id', departmentId)
      if (includeTrends !== undefined) qs.set('include_trends', String(includeTrends))
      return api.get<PayrollCostDataset>(`/datasets/payroll-cost?${qs.toString()}`)
    },
    staleTime: STALE_TIME,
    enabled: Boolean(month),
  })
}
