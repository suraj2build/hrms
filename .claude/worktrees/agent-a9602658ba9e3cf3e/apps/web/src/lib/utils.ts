import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
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
    .split(' ')
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
