/**
 * exec-utils — shared non-component helpers for the Executive Insight Hub.
 * Split out from ExecShell so that file only exports components (react-refresh).
 */

export const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
export const TIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } as const

export function cr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`
  return `₹${Math.round(n).toLocaleString()}`
}
export function fmtMonth(ym: string): string {
  try { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1).toLocaleString('default', { month: 'short' }) }
  catch { return ym }
}
export const fmtNum = (n: number | undefined | null) => (n ?? 0).toLocaleString()
