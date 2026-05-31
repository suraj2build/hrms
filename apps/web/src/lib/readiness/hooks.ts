/**
 * Readiness Hooks
 *
 * Each hook fires its required queries (all with staleTime so they share
 * TanStack Query cache with the rest of the app), runs the evaluator,
 * and returns a DomainReadiness object.
 *
 * Consumption pattern:
 *   const org = useOrgReadiness()
 *   const all = useAllDomainReadiness()    // fires all hooks in parallel
 */
import { useMemo }          from 'react'
import { useQuery }         from '@tanstack/react-query'
import { api }              from '@/lib/api/client'
import { computeDomainReadiness } from './utils'
import { evaluateOrganization }   from './evaluators/organization'
import { evaluateWorkforce }      from './evaluators/workforce'
import { evaluatePayroll }        from './evaluators/payroll'
import { evaluateAttendance }     from './evaluators/attendance'
import type { DomainReadiness }   from './types'

// ── Shared query options ──────────────────────────────────────────────────────

const STALE = {
  org:      120_000,   // 2 min — org structure is slow-changing
  workforce: 60_000,   // 1 min — employee data changes more often
  payroll:  180_000,   // 3 min — payroll config rarely changes
  attendance: 60_000,  // 1 min
} as const

// ── Minimal response shapes (only fields evaluators need) ─────────────────────

interface SiteItem     { id: string; code: string | null }
interface LocItem      { id: string; site_id: string | null; is_active: boolean }
interface DeptItem     { id: string }
interface CCItem       { id: string }
interface EmpItem      {
  id: string; status?: string
  work_location?: { id: string } | null
  department?:    { id: string; name: string } | null
  designation?:   { id: string; name: string } | null
}
interface StructureItem { id: string; name: string; is_active?: boolean }
interface ComponentItem { id: string; component_type: string }
interface ShiftItem     { id: string; is_active?: boolean }
interface RosterItem    { id: string; is_active?: boolean }
interface RunItem       { id: string; status: string; created_at: string }

// ── useOrgReadiness ───────────────────────────────────────────────────────────

export function useOrgReadiness(): DomainReadiness {
  const { data: sitesData, isLoading: sl } = useQuery<{ data: SiteItem[] }>({
    queryKey: ['sites'],
    queryFn:  () => api.get('/masters/sites'),
    staleTime: STALE.org,
  })
  const { data: locsData, isLoading: ll } = useQuery<{ data: LocItem[] }>({
    queryKey: ['work-locations'],
    queryFn:  () => api.get('/masters/work-locations'),
    staleTime: STALE.org,
  })
  const { data: deptsData, isLoading: dl } = useQuery<{ data: DeptItem[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
    staleTime: STALE.org,
  })
  const { data: ccData, isLoading: cl } = useQuery<{ data: CCItem[] }>({
    queryKey: ['cost-centers'],
    queryFn:  () => api.get('/masters/cost-centers'),
    staleTime: STALE.org,
  })
  const { data: empData, isLoading: el } = useQuery<{ data: EmpItem[] }>({
    queryKey: ['employees'],
    queryFn:  () => api.get('/employees'),
    staleTime: STALE.workforce,
  })

  const isLoading = sl || ll || dl || cl || el

  return useMemo(() => {
    if (isLoading) return computeDomainReadiness('organization', [], true)
    const checks = evaluateOrganization({
      sites:       sitesData?.data   ?? [],
      locations:   locsData?.data    ?? [],
      departments: deptsData?.data   ?? [],
      costCenters: ccData?.data      ?? [],
      employees:   empData?.data     ?? [],
    })
    return computeDomainReadiness('organization', checks)
  }, [sitesData, locsData, deptsData, ccData, empData, isLoading])
}

// ── useWorkforceReadiness ─────────────────────────────────────────────────────

export function useWorkforceReadiness(): DomainReadiness {
  const { data: empData, isLoading: el } = useQuery<{ data: EmpItem[] }>({
    queryKey: ['employees'],
    queryFn:  () => api.get('/employees'),
    staleTime: STALE.workforce,
  })
  const { data: structData, isLoading: sl } = useQuery<{ data: StructureItem[] }>({
    queryKey: ['salary-structures'],
    queryFn:  () => api.get('/masters/salary-structures'),
    staleTime: STALE.payroll,
  })

  const isLoading = el || sl

  return useMemo(() => {
    if (isLoading) return computeDomainReadiness('workforce', [], true)
    const checks = evaluateWorkforce(
      empData?.data ?? [],
      structData ? { salaryStructures: structData.data } : undefined,
    )
    return computeDomainReadiness('workforce', checks)
  }, [empData, structData, isLoading])
}

// ── usePayrollReadiness ───────────────────────────────────────────────────────

export function usePayrollReadiness(): DomainReadiness {
  const { data: structData, isLoading: sl } = useQuery<{ data: StructureItem[] }>({
    queryKey: ['salary-structures'],
    queryFn:  () => api.get('/masters/salary-structures'),
    staleTime: STALE.payroll,
  })
  const { data: compData, isLoading: cl } = useQuery<{ data: ComponentItem[] }>({
    queryKey: ['salary-components'],
    queryFn:  () => api.get('/masters/salary-components'),
    staleTime: STALE.payroll,
    retry: 1,
  })
  const { data: runsData, isLoading: rl } = useQuery<{ data: RunItem[] }>({
    queryKey: ['payroll-runs-recent'],
    queryFn:  () => api.get('/payroll/runs?limit=5&sort=desc'),
    staleTime: STALE.payroll,
    retry: 1,
  })
  const { data: empData } = useQuery<{ data: EmpItem[] }>({
    queryKey: ['employees'],
    queryFn:  () => api.get('/employees'),
    staleTime: STALE.workforce,
  })

  const isLoading = sl || cl || rl

  return useMemo(() => {
    if (isLoading) return computeDomainReadiness('payroll', [], true)
    const employeeCount = empData?.data.length ?? 0
    const checks = evaluatePayroll({
      salaryStructures: structData?.data  ?? [],
      salaryComponents: compData?.data    ?? [],
      recentRuns:       runsData?.data,
      employeeCount,
      // employeesWithBank: not derivable from list endpoint — marked unknown
    })
    return computeDomainReadiness('payroll', checks)
  }, [structData, compData, runsData, empData, isLoading])
}

// ── useAttendanceReadiness ────────────────────────────────────────────────────

export function useAttendanceReadiness(): DomainReadiness {
  const { data: shiftData, isLoading: sl } = useQuery<{ data: ShiftItem[] }>({
    queryKey: ['shifts'],
    queryFn:  () => api.get('/masters/shifts'),
    staleTime: STALE.attendance,
  })
  const { data: rosterData, isLoading: rl } = useQuery<{ data: RosterItem[] }>({
    queryKey: ['rosters-list'],
    queryFn:  () => api.get('/masters/rosters'),
    staleTime: STALE.attendance,
    retry: 1,
  })
  const { data: empData } = useQuery<{ data: EmpItem[] }>({
    queryKey: ['employees'],
    queryFn:  () => api.get('/employees'),
    staleTime: STALE.workforce,
  })
  const { data: periodsData, isLoading: pl } = useQuery<{ data: { id: string; status: string }[] }>({
    queryKey: ['attendance-periods-recent'],
    queryFn:  () => api.get('/attendance/period-locks?limit=3&sort=desc'),
    staleTime: STALE.attendance,
    retry: 1,
  })

  const isLoading = sl || rl || pl

  return useMemo(() => {
    if (isLoading) return computeDomainReadiness('attendance', [], true)
    const employeeCount = empData?.data.filter(e => e.status === 'active').length ?? 0
    const checks = evaluateAttendance({
      shifts:            shiftData?.data   ?? [],
      rosters:           rosterData?.data  ?? [],
      employeeCount,
      attendancePeriods: periodsData?.data,
    })
    return computeDomainReadiness('attendance', checks)
  }, [shiftData, rosterData, empData, periodsData, isLoading])
}

// ── useAllDomainReadiness ─────────────────────────────────────────────────────
// Fires all domain hooks in parallel and returns the full picture.

export function useAllDomainReadiness(): {
  org:        DomainReadiness
  workforce:  DomainReadiness
  payroll:    DomainReadiness
  attendance: DomainReadiness
  all:        DomainReadiness[]
  isLoading:  boolean
} {
  const org        = useOrgReadiness()
  const workforce  = useWorkforceReadiness()
  const payroll    = usePayrollReadiness()
  const attendance = useAttendanceReadiness()

  const all       = [org, workforce, attendance, payroll]
  const isLoading = all.some(d => d.isLoading)

  return { org, workforce, payroll, attendance, all, isLoading }
}
