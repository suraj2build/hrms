import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'

// ── Response shape ────────────────────────────────────────────────────────────

export interface AttendanceDataset {
  meta: { month: string; generated_at: string }
  summary: {
    total_employees: number
    avg_attendance_rate: number
    total_present_days: number
    total_absent_days: number
    total_lop_days: number
    total_half_days: number
    avg_lop_days_per_employee: number
  }
  by_employee: Array<{
    employee_id: string
    employee_code: string
    name: string
    department: string
    present_days: number
    absent_days: number
    half_days: number
    leave_days: number
    lop_days: number
    attendance_rate: number
  }>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const STALE_TIME = 5 * 60 * 1000 // 5 min

export interface UseAttendanceDatasetParams {
  month: string
  departmentId?: string
}

/**
 * Canonical dataset hook for attendance.
 * Cache key: ['dataset', 'attendance', tenantId, month, departmentId]
 */
export function useAttendanceDataset(params: UseAttendanceDatasetParams) {
  const tenantId = useAuthStore(s => s.tenant?.id ?? 'unknown')
  const { month, departmentId } = params

  return useQuery<AttendanceDataset>({
    queryKey: [
      'dataset',
      'attendance',
      tenantId,
      month,
      departmentId ?? 'all',
    ],
    queryFn: () => {
      const qs = new URLSearchParams({ month })
      if (departmentId) qs.set('department_id', departmentId)
      return api.get<AttendanceDataset>(`/datasets/attendance?${qs.toString()}`)
    },
    staleTime: STALE_TIME,
    enabled: Boolean(month),
  })
}
