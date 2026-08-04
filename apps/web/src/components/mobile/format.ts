/** Shared formatting helpers for the mobile ESS social surfaces. */
import { fmtDateShort } from '@/lib/utils'

/** Relative "time ago" label. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return fmtDateShort(iso)
}

/** Deterministic initials from a name. */
export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}
