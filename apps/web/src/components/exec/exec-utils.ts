/**
 * exec-utils — shared non-component helpers for the Executive Insight Hub.
 * Split out from ExecShell so that file only exports components (react-refresh).
 */

// ── BI canvas palette (shared by every Executive tab) ───────────────────────────
export const C = {
  blue: '#2E6FE6', teal: '#15B8A6', violet: '#7C5CFC', amber: '#E0A53B',
  cyan: '#22B8CF', rose: '#E5564B', green: '#1FA968', slate: '#64748B',
}
export const CAT = [C.blue, C.teal, C.violet, C.amber, C.cyan, C.rose, C.green, C.slate]
export const GRID = 'var(--border)'
export const AXIS = { fontSize: 10, fill: 'var(--muted-foreground)' } as const

// ── Period slicer (windows trend series) ────────────────────────────────────────
export type Period = '30D' | 'QTD' | 'YTD' | '12M'
export const PERIODS: Period[] = ['30D', 'QTD', 'YTD', '12M']
export function periodMonths(p: Period): number {
  // 30D ≈ latest month (min 2 points for a chart); YTD = months elapsed this year.
  return p === '30D' ? 2 : p === 'QTD' ? 3 : p === 'YTD' ? Math.max(2, new Date().getMonth() + 1) : 12
}
export function slicePeriod<T>(arr: T[], p: Period): T[] {
  return arr.slice(-periodMonths(p))
}

export function genderColor(k: string): string {
  const x = k.toLowerCase()
  if (/female|^f$/.test(x)) return C.teal
  if (/male|^m$/.test(x)) return C.blue
  return C.violet
}
export const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

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
