/**
 * exec-utils — shared non-component helpers for the Executive Insight Hub.
 * Split out from ExecShell so that file only exports components (react-refresh).
 */

export const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
export const TIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } as const

// ── BI canvas palette (shared by every Executive tab) ───────────────────────────
export const C = {
  blue: '#2E6FE6', teal: '#15B8A6', violet: '#7C5CFC', amber: '#E0A53B',
  cyan: '#22B8CF', rose: '#E5564B', green: '#1FA968', slate: '#64748B',
}
export const CAT = [C.blue, C.teal, C.violet, C.amber, C.cyan, C.rose, C.green, C.slate]
export const GRID = 'var(--border)'
export const AXIS = { fontSize: 10, fill: 'var(--muted-foreground)' } as const

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
