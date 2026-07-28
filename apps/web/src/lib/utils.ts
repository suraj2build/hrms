import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Shared date helpers ────────────────────────────────────────────────────────
// All public display dates use DD-MMM-YYYY (e.g. 01-Jan-2024).
// Use UTC accessors for YYYY-MM-DD string inputs to avoid timezone off-by-one.

const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function _d(s: string | Date): Date {
  if (s instanceof Date) return s
  // Plain date strings (YYYY-MM-DD): anchor to noon UTC so no tz shift
  return new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
}

/** 01-Jan-2024 */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = _d(d)
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${_M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

/** 01-Jan  (no year — for tight spaces) */
export function fmtDateShort(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = _d(d)
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${_M[dt.getUTCMonth()]}`
}

/** Jan-2024  (month + year, e.g. payroll periods) */
export function fmtMonthYear(d: string | Date | null | undefined): string {
  if (!d) return '—'
  // Accept 'YYYY-MM' or 'YYYY-MM-DD'
  const s = typeof d === 'string' ? d : d.toISOString().slice(0,7)
  const dt = new Date(s.slice(0,7) + '-01T12:00:00Z')
  if (isNaN(dt.getTime())) return '—'
  return `${_M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

/** 01-Jan-2024 10:30  (local wall-clock time + date) */
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return '—'
  const hr = String(dt.getHours()).padStart(2,'0')
  const mn = String(dt.getMinutes()).padStart(2,'0')
  return `${String(dt.getDate()).padStart(2,'0')}-${_M[dt.getMonth()]}-${dt.getFullYear()} ${hr}:${mn}`
}

/** @deprecated use fmtDate */
export function formatDate(date: string | Date | null | undefined): string {
  return fmtDate(date)
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function generateEmployeeCode(index: number): string {
  return `EMP-${String(index).padStart(4, '0')}`
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    active:    'bg-success/20 text-success border-success/30',
    inactive:  'bg-muted text-muted-foreground border-border',
    on_notice: 'bg-warning/20 text-warning border-warning/30',
    separated: 'bg-destructive/20 text-destructive border-destructive/30',
  }
  return map[status] ?? 'bg-muted text-muted-foreground border-border'
}

export function getEmploymentTypeColor(type: string): string {
  const map: Record<string, string> = {
    permanent: 'bg-info/20 text-info border-info/30',
    contract:  'bg-accent-violet/20 text-accent-violet border-accent-violet/30',
    intern:    'bg-accent-coral/20 text-accent-coral border-accent-coral/30',
    probation: 'bg-warning/20 text-warning border-warning/30',
  }
  return map[type] ?? 'bg-muted text-muted-foreground border-border'
}

export function truncate(str: string, length: number): string {
  return str.length > length ? str.substring(0, length) + '…' : str
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
