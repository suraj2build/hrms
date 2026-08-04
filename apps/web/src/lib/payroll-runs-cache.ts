/**
 * Shared cache-invalidation helper for payroll run state changes.
 *
 * Every other Payroll Center page independently queries the same underlying
 * /payroll/runs list under its own query key rather than sharing ['payroll-runs'].
 * A mutation that changes run state (trigger/finalize/freeze/reopen) must
 * invalidate all of them, or a sibling page already mounted in the session keeps
 * showing pre-mutation data — most consequential for freeze/reopen, which gate
 * statutory filing and bank payout.
 */
import type { QueryClient } from '@tanstack/react-query'

export const PAYROLL_RUNS_SIBLING_KEYS = [
  'payroll-runs-forensics',
  'payroll-runs-accounting',
  'payroll-runs-payout-recon',
  'payroll-runs-statutory',
  'payroll-runs-variance-list',
  'payroll-runs-history',
  'payroll-runs-console',
  'payroll-recent-runs-for-blockers',
  'payroll-runs-recent',
  'payroll-runs-finalize',
] as const

export function invalidateAllPayrollRunViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['payroll-runs'] })
  for (const key of PAYROLL_RUNS_SIBLING_KEYS) qc.invalidateQueries({ queryKey: [key] })
}
