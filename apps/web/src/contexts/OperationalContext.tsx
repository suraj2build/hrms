/**
 * OperationalContext — central shared context provider for cross-module
 * operational state: selections, active months, live counts, and workspace tracking.
 *
 * Persists selection/period/workspace to sessionStorage key `ux3_op_context`.
 * Polls GET /operational/counts every 60 s for live badge counts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkspaceContext =
  | 'attendance'
  | 'roster'
  | 'payroll'
  | 'workforce'
  | 'compliance'
  | 'leave'
  | 'system'
  | null

export interface OperationalContextValue {
  // ── Selection state ──────────────────────────────────
  selectedEmployeeId:   string | null
  selectedEmployeeName: string | null
  selectedSiteId:       string | null
  selectedSiteName:     string | null

  // ── Period state ─────────────────────────────────────
  activePayrollMonth:     string
  activeRosterMonth:      string
  activeAttendanceMonth:  string

  // ── Live operational counts ──────────────────────────
  pendingApprovalsCount:    number
  unresolvedAnomaliesCount: number
  payrollBlockersCount:     number
  missingPunchesCount:      number

  // ── Workspace tracking ───────────────────────────────
  currentWorkspace: WorkspaceContext

  // ── Actions ──────────────────────────────────────────
  setSelectedEmployee:      (id: string | null, name?: string) => void
  setSelectedSite:          (id: string | null, name?: string) => void
  setActivePayrollMonth:    (month: string) => void
  setActiveRosterMonth:     (month: string) => void
  setActiveAttendanceMonth: (month: string) => void
  setCurrentWorkspace:      (ws: WorkspaceContext) => void
  refreshCounts:            () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ux3_op_context'
const COUNTS_QUERY_KEY = ['op-counts'] as const

function currentYearMonth(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

interface PersistedState {
  selectedEmployeeId:   string | null
  selectedEmployeeName: string | null
  selectedSiteId:       string | null
  selectedSiteName:     string | null
  activePayrollMonth:   string
  activeRosterMonth:    string
  activeAttendanceMonth: string
  currentWorkspace:     WorkspaceContext
}

function isWorkspaceContext(value: unknown): value is WorkspaceContext {
  return (
    value === null ||
    value === 'attendance' ||
    value === 'roster' ||
    value === 'payroll' ||
    value === 'workforce' ||
    value === 'compliance' ||
    value === 'leave' ||
    value === 'system'
  )
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const p = parsed as Record<string, unknown>
    return {
      selectedEmployeeId:   typeof p.selectedEmployeeId   === 'string' ? p.selectedEmployeeId   : null,
      selectedEmployeeName: typeof p.selectedEmployeeName === 'string' ? p.selectedEmployeeName : null,
      selectedSiteId:       typeof p.selectedSiteId       === 'string' ? p.selectedSiteId       : null,
      selectedSiteName:     typeof p.selectedSiteName     === 'string' ? p.selectedSiteName     : null,
      activePayrollMonth:   typeof p.activePayrollMonth   === 'string' ? p.activePayrollMonth   : undefined,
      activeRosterMonth:    typeof p.activeRosterMonth    === 'string' ? p.activeRosterMonth    : undefined,
      activeAttendanceMonth: typeof p.activeAttendanceMonth === 'string' ? p.activeAttendanceMonth : undefined,
      currentWorkspace:     isWorkspaceContext(p.currentWorkspace) ? p.currentWorkspace : null,
    }
  } catch {
    return {}
  }
}

interface CountsResponse {
  data: {
    pending_approvals:    number
    unresolved_anomalies: number
    payroll_blockers:     number
    missing_punches:      number
  }
}

function detectWorkspace(pathname: string): WorkspaceContext {
  if (pathname.includes('/payroll'))                                         return 'payroll'
  if (pathname.includes('/roster'))                                          return 'roster'
  if (pathname.includes('/attendance') || pathname.includes('/shift'))       return 'attendance'
  if (pathname.includes('/leave'))                                           return 'leave'
  if (pathname.includes('/employees') || pathname.includes('/workforce'))    return 'workforce'
  if (pathname.includes('/compliance') || pathname.includes('/governance'))  return 'compliance'
  if (pathname.includes('/system') || pathname.includes('/settings'))        return 'system'
  return null
}

// ── Context ────────────────────────────────────────────────────────────────────

const now = currentYearMonth()
const persisted = loadPersistedState()

const defaultContextValue: OperationalContextValue = {
  selectedEmployeeId:      null,
  selectedEmployeeName:    null,
  selectedSiteId:          null,
  selectedSiteName:        null,
  activePayrollMonth:      now,
  activeRosterMonth:       now,
  activeAttendanceMonth:   now,
  pendingApprovalsCount:   0,
  unresolvedAnomaliesCount: 0,
  payrollBlockersCount:    0,
  missingPunchesCount:     0,
  currentWorkspace:        null,
  setSelectedEmployee:     () => undefined,
  setSelectedSite:         () => undefined,
  setActivePayrollMonth:   () => undefined,
  setActiveRosterMonth:    () => undefined,
  setActiveAttendanceMonth: () => undefined,
  setCurrentWorkspace:     () => undefined,
  refreshCounts:           () => undefined,
}

export const OperationalContext =
  createContext<OperationalContextValue>(defaultContextValue)

// ── Provider ───────────────────────────────────────────────────────────────────

export function OperationalContextProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const location    = useLocation()

  // ── State — initialise from sessionStorage ─────────────────────────────────
  const [selectedEmployeeId, setSelectedEmployeeIdState] =
    useState<string | null>(persisted.selectedEmployeeId ?? null)
  const [selectedEmployeeName, setSelectedEmployeeName] =
    useState<string | null>(persisted.selectedEmployeeName ?? null)
  const [selectedSiteId, setSelectedSiteIdState] =
    useState<string | null>(persisted.selectedSiteId ?? null)
  const [selectedSiteName, setSelectedSiteName] =
    useState<string | null>(persisted.selectedSiteName ?? null)

  const [activePayrollMonth, setActivePayrollMonthState] =
    useState<string>(persisted.activePayrollMonth ?? now)
  const [activeRosterMonth, setActiveRosterMonthState] =
    useState<string>(persisted.activeRosterMonth ?? now)
  const [activeAttendanceMonth, setActiveAttendanceMonthState] =
    useState<string>(persisted.activeAttendanceMonth ?? now)

  const [currentWorkspace, setCurrentWorkspaceState] =
    useState<WorkspaceContext>(persisted.currentWorkspace ?? null)

  // ── Persist to sessionStorage whenever state changes ──────────────────────
  useEffect(() => {
    const state: PersistedState = {
      selectedEmployeeId,
      selectedEmployeeName,
      selectedSiteId,
      selectedSiteName,
      activePayrollMonth,
      activeRosterMonth,
      activeAttendanceMonth,
      currentWorkspace,
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // storage quota exceeded — silently ignore
    }
  }, [
    selectedEmployeeId,
    selectedEmployeeName,
    selectedSiteId,
    selectedSiteName,
    activePayrollMonth,
    activeRosterMonth,
    activeAttendanceMonth,
    currentWorkspace,
  ])

  // ── Auto-detect workspace from route ──────────────────────────────────────
  useEffect(() => {
    const detected = detectWorkspace(location.pathname)
    setCurrentWorkspaceState(detected)
  }, [location.pathname])

  // ── Live counts — poll every 60 s ─────────────────────────────────────────
  const { data: countsData } = useQuery<CountsResponse, Error>({
    queryKey: COUNTS_QUERY_KEY,
    queryFn:  () => api.get<CountsResponse>('/operational/counts'),
    refetchInterval: 60_000,
    staleTime:       55_000,
    retry:           false,
    // On error keep previous data — React Query does this by default
  })

  const pendingApprovalsCount    = countsData?.data?.pending_approvals    ?? 0
  const unresolvedAnomaliesCount = countsData?.data?.unresolved_anomalies ?? 0
  const payrollBlockersCount     = countsData?.data?.payroll_blockers     ?? 0
  const missingPunchesCount      = countsData?.data?.missing_punches      ?? 0

  // ── Action callbacks ───────────────────────────────────────────────────────
  const setSelectedEmployee = useCallback(
    (id: string | null, name?: string) => {
      setSelectedEmployeeIdState(id)
      setSelectedEmployeeName(name ?? null)
    },
    [],
  )

  const setSelectedSite = useCallback(
    (id: string | null, name?: string) => {
      setSelectedSiteIdState(id)
      setSelectedSiteName(name ?? null)
    },
    [],
  )

  const setActivePayrollMonth = useCallback((month: string) => {
    setActivePayrollMonthState(month)
  }, [])

  const setActiveRosterMonth = useCallback((month: string) => {
    setActiveRosterMonthState(month)
  }, [])

  const setActiveAttendanceMonth = useCallback((month: string) => {
    setActiveAttendanceMonthState(month)
  }, [])

  const setCurrentWorkspace = useCallback((ws: WorkspaceContext) => {
    setCurrentWorkspaceState(ws)
  }, [])

  const refreshCounts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY })
  }, [queryClient])

  // ── Memoised context value ─────────────────────────────────────────────────
  const value = useMemo<OperationalContextValue>(
    () => ({
      selectedEmployeeId,
      selectedEmployeeName,
      selectedSiteId,
      selectedSiteName,
      activePayrollMonth,
      activeRosterMonth,
      activeAttendanceMonth,
      pendingApprovalsCount,
      unresolvedAnomaliesCount,
      payrollBlockersCount,
      missingPunchesCount,
      currentWorkspace,
      setSelectedEmployee,
      setSelectedSite,
      setActivePayrollMonth,
      setActiveRosterMonth,
      setActiveAttendanceMonth,
      setCurrentWorkspace,
      refreshCounts,
    }),
    [
      selectedEmployeeId,
      selectedEmployeeName,
      selectedSiteId,
      selectedSiteName,
      activePayrollMonth,
      activeRosterMonth,
      activeAttendanceMonth,
      pendingApprovalsCount,
      unresolvedAnomaliesCount,
      payrollBlockersCount,
      missingPunchesCount,
      currentWorkspace,
      setSelectedEmployee,
      setSelectedSite,
      setActivePayrollMonth,
      setActiveRosterMonth,
      setActiveAttendanceMonth,
      setCurrentWorkspace,
      refreshCounts,
    ],
  )

  return (
    <OperationalContext.Provider value={value}>
      {children}
    </OperationalContext.Provider>
  )
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useOperationalContext(): OperationalContextValue {
  return useContext(OperationalContext)
}
