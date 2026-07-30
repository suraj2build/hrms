/**
 * usePeriodLock(month: string)
 * Fetches the lock state for a given YYYY-MM period.
 * Returns { isLocked, state, isLoading } where isLocked = state !== 'OPEN'
 */
import { useQuery } from '@tanstack/react-query'
import { api }      from '@/lib/api/client'

type PeriodState = 'OPEN' | 'LOCKED' | 'PAYROLL_PROCESSING' | 'PAYROLL_FINALIZED'

interface PeriodLockData {
  period_month: string
  state:        PeriodState
  locked_at?:   string | null
  locked_by?:   string | null
}

interface UsePeriodLockResult {
  state:     PeriodState
  isLocked:  boolean
  isLoading: boolean
  lockedAt:  string | null
  lockedBy:  string | null
}

export function usePeriodLock(month: string): UsePeriodLockResult {
  const { data, isLoading } = useQuery<{ data: PeriodLockData }>({
    queryKey:  ['period-lock', month],
    queryFn:   () => api.get(`/attendance/period-locks/${month}`),
    staleTime: 60_000,
    // Return synthesized OPEN state on error
    retry: false,
  })

  const state    = data?.data?.state ?? 'OPEN'
  const isLocked = state !== 'OPEN'

  return { state, isLocked, isLoading, lockedAt: data?.data?.locked_at ?? null, lockedBy: data?.data?.locked_by ?? null }
}
