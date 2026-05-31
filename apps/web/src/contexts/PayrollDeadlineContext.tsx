/**
 * PayrollDeadlineContext — tracks whether the system is in "Payroll Deadline Mode".
 *
 * A high-priority state triggered during payroll processing cycles that
 * compresses navigation and elevates critical tasks.
 *
 * Persists `isDeadlineMode` + `deadlineDate` to localStorage key `ux6_payroll_deadline`.
 * Recomputes `hoursUntilDeadline` every 5 minutes and auto-deactivates when deadline passes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type JSX,
} from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayrollDeadlineContextValue {
  isDeadlineMode: boolean
  deadlineDate?: string
  activateDeadline: (date?: string) => void
  deactivateDeadline: () => void
  hoursUntilDeadline?: number
}

interface PersistedDeadlineState {
  isDeadlineMode: boolean
  deadlineDate?: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ux6_payroll_deadline'
const RECOMPUTE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeHoursUntilDeadline(deadlineDate: string | undefined): number | undefined {
  if (!deadlineDate) return undefined
  return Math.max(0, Math.floor((new Date(deadlineDate).getTime() - Date.now()) / 3_600_000))
}

function loadPersistedState(): PersistedDeadlineState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { isDeadlineMode: false }
    return JSON.parse(raw) as PersistedDeadlineState
  } catch {
    return { isDeadlineMode: false }
  }
}

function savePersistedState(state: PersistedDeadlineState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

// ── Context ────────────────────────────────────────────────────────────────────

const PayrollDeadlineContext = createContext<PayrollDeadlineContextValue | null>(null)

// ── Provider ───────────────────────────────────────────────────────────────────

export function PayrollDeadlineProvider({
  children,
}: {
  children: React.ReactNode
}): JSX.Element {
  const persisted = loadPersistedState()

  const [isDeadlineMode, setIsDeadlineMode] = useState<boolean>(persisted.isDeadlineMode)
  const [deadlineDate, setDeadlineDate] = useState<string | undefined>(persisted.deadlineDate)
  const [hoursUntilDeadline, setHoursUntilDeadline] = useState<number | undefined>(
    () => computeHoursUntilDeadline(persisted.deadlineDate),
  )

  // Recompute every 5 minutes, auto-deactivate when deadline passes
  useEffect(() => {
    if (!isDeadlineMode) return

    const recompute = () => {
      const hours = computeHoursUntilDeadline(deadlineDate)
      setHoursUntilDeadline(hours)
      if (hours === 0) {
        setIsDeadlineMode(false)
        setDeadlineDate(undefined)
        savePersistedState({ isDeadlineMode: false })
      }
    }

    recompute() // run immediately on mount / when deps change
    const timer = setInterval(recompute, RECOMPUTE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isDeadlineMode, deadlineDate])

  const activateDeadline = useCallback((date?: string) => {
    setIsDeadlineMode(true)
    setDeadlineDate(date)
    setHoursUntilDeadline(computeHoursUntilDeadline(date))
    savePersistedState({ isDeadlineMode: true, deadlineDate: date })
  }, [])

  const deactivateDeadline = useCallback(() => {
    setIsDeadlineMode(false)
    setDeadlineDate(undefined)
    setHoursUntilDeadline(undefined)
    savePersistedState({ isDeadlineMode: false })
  }, [])

  return (
    <PayrollDeadlineContext.Provider
      value={{
        isDeadlineMode,
        deadlineDate,
        activateDeadline,
        deactivateDeadline,
        hoursUntilDeadline,
      }}
    >
      {children}
    </PayrollDeadlineContext.Provider>
  )
}

// ── Consumer hook ──────────────────────────────────────────────────────────────

export function usePayrollDeadline(): PayrollDeadlineContextValue {
  const ctx = useContext(PayrollDeadlineContext)
  if (!ctx) {
    throw new Error('usePayrollDeadline must be used within a PayrollDeadlineProvider')
  }
  return ctx
}
