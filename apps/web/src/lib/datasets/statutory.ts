import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'

// ── Response shape ────────────────────────────────────────────────────────────

export interface StatutoryDataset {
  meta: { month: string; generated_at: string }
  coverage: {
    epf: { enrolled: number; missing_uan: number; registration_number: string | null; has_registration: boolean }
    esi: { eligible: number; registration_number: string | null; has_registration: boolean }
    ptax: { enrolled: number; states: string[]; missing_registrations: string[] }
    tds: { employees_with_tds: number; missing_pan: number }
    payroll: { finalized: number; total: number; all_finalized: boolean }
  }
  totals: {
    epf: {
      employee_contribution: number
      employer_pf: number
      employer_eps: number
      edli: number
      admin_charges: number
      total_remittance: number
    }
    esi: { employee_contribution: number; employer_contribution: number; total_remittance: number }
    ptax: { amount: number; by_state: Array<{ state_code: string; amount: number }> }
    tds: { total_deducted: number }
    grand_total: number
  }
  readiness: {
    overall: boolean
    epf_ready: boolean
    esi_ready: boolean
    ptax_ready: boolean
    tds_ready: boolean
    payroll_ready: boolean
    issues: string[]
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const STALE_TIME = 5 * 60 * 1000 // 5 min

export interface UseStatutoryDatasetParams {
  month: string
}

/**
 * Canonical dataset hook for statutory compliance.
 * Cache key: ['dataset', 'statutory', tenantId, month]
 */
export function useStatutoryDataset(params: UseStatutoryDatasetParams) {
  const tenantId = useAuthStore(s => s.tenant?.id ?? 'unknown')
  const { month } = params

  return useQuery<StatutoryDataset>({
    queryKey: [
      'dataset',
      'statutory',
      tenantId,
      month,
    ],
    queryFn: () => {
      const qs = new URLSearchParams({ month })
      return api.get<StatutoryDataset>(`/datasets/statutory?${qs.toString()}`)
    },
    staleTime: STALE_TIME,
    enabled: Boolean(month),
  })
}
