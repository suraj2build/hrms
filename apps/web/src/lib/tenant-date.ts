/**
 * Tenant-local date helpers — mirrors the backend's getLocalDate()
 * (apps/api/src/lib/org-context.ts) so "today" on the client agrees with
 * "today" on the server for the same tenant, regardless of the browser's
 * own clock/timezone (UTC or device-local, both of which can disagree with
 * the tenant's configured business timezone near a day boundary).
 */

export function getTenantLocalDate(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
    }).formatToParts(date)
    const y = parts.find(p => p.type === 'year')?.value  ?? '2000'
    const m = parts.find(p => p.type === 'month')?.value ?? '01'
    const d = parts.find(p => p.type === 'day')?.value   ?? '01'
    return `${y}-${m}-${d}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function addTenantLocalDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
