/**
 * Attendance Period Protection — shared lock helpers (AHI-2).
 *
 * Single source of truth for "is this month writable?". Used by every
 * attendance write path (recompute, process, comp-off, overtime,
 * WO-credit reconciler) so the policy lives in one place rather than
 * being re-implemented (and forgotten) per route.
 *
 * A month is considered LOCKED when its attendance_period_locks row
 * exists and is in any non-OPEN state
 * (LOCKED / PAYROLL_PROCESSING / PAYROLL_FINALIZED).
 *
 * Defence in depth: these guards give callers a clean 409/early-skip,
 * while migration 262's DB trigger is the hard backstop that no path
 * can bypass.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Thrown by the assert* helpers when a write targets a locked month. */
export class PeriodLockedError extends Error {
  readonly month: string
  constructor(month: string) {
    super(`Attendance period ${month} is locked for payroll — no changes allowed.`)
    this.name = 'PeriodLockedError'
    this.month = month
  }
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** Enumerate the 'YYYY-MM' months spanned by an inclusive date range. */
export function monthsInRange(fromDate: string, toDate: string): string[] {
  const months: string[] = []
  let y = Number(fromDate.slice(0, 4))
  let m = Number(fromDate.slice(5, 7))
  const endY = Number(toDate.slice(0, 4))
  const endM = Number(toDate.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

/** Return the subset of the given months that are locked (non-OPEN). */
export async function getLockedMonths(
  supabase: SupabaseClient,
  tenantId: string,
  months: string[],
): Promise<Set<string>> {
  const unique = [...new Set(months)]
  if (!unique.length) return new Set()
  const { data } = await supabase
    .from('attendance_period_locks')
    .select('period_month')
    .eq('tenant_id', tenantId)
    .in('period_month', unique)
    .neq('state', 'OPEN')
  return new Set((data ?? []).map((r: any) => r.period_month as string))
}

/** True if the given single month is locked. */
export async function isMonthLocked(
  supabase: SupabaseClient,
  tenantId: string,
  month: string,
): Promise<boolean> {
  return (await getLockedMonths(supabase, tenantId, [month])).has(month)
}

/** Throw PeriodLockedError if the month containing `date` is locked. */
export async function assertDateOpen(
  supabase: SupabaseClient,
  tenantId: string,
  date: string,
): Promise<void> {
  const month = monthOf(date)
  if (await isMonthLocked(supabase, tenantId, month)) {
    throw new PeriodLockedError(month)
  }
}

/** Throw PeriodLockedError if ANY month in [fromDate, toDate] is locked. */
export async function assertRangeOpen(
  supabase: SupabaseClient,
  tenantId: string,
  fromDate: string,
  toDate: string,
): Promise<void> {
  const locked = await getLockedMonths(supabase, tenantId, monthsInRange(fromDate, toDate))
  if (locked.size) {
    throw new PeriodLockedError([...locked].sort()[0])
  }
}
