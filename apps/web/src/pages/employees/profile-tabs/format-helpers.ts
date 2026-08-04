/**
 * Non-component formatting helpers used across EmployeeProfile tab files.
 * Split out of shared.tsx so that file only exports components (Vite Fast
 * Refresh requires component-only files to hot-reload correctly).
 */

import { formatCurrency } from '@/lib/utils'

export function fmt(val?: string | null) { return val ?? '—' }

// Re-exported so existing `./format-helpers` imports across the profile tabs
// keep working without touching every call site.
export { fmtDate, formatCurrency } from '@/lib/utils'

export function fmtMoney(n?: number | null) {
  if (n == null) return '—'
  return formatCurrency(n)
}

export const STATUS_VARIANT: Record<string, 'success' | 'secondary' | 'warning' | 'destructive'> = {
  active: 'success', inactive: 'secondary', on_notice: 'warning', separated: 'destructive',
}
