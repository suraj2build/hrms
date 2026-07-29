/**
 * RegularisationService — shared submission logic for attendance regularisation
 * requests, used by both the ESS route (POST /attendance/regularisation) and
 * the AI assistant's regularize_attendance tool.
 *
 * Enforces (in order): submission window, frequency limit (period + per-type),
 * payroll period lock, and computes the SLA deadline used by the SLA-breach
 * scanner. A caller that hand-rolls the insert instead of going through this
 * service silently bypasses all of the above.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate }  from './org-context.js'

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Bounds of the configurable limit period containing `now`.
 * Returns [start, end) as YYYY-MM-DD strings, comparable against created_at.
 */
function limitPeriodBounds(period: string, now: Date): { start: string; end: string; label: string } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  if (period === 'week') {
    const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay()   // Mon=1 … Sun=7
    const monday = new Date(Date.UTC(y, m, d - (dow - 1)))
    const next   = new Date(Date.UTC(y, m, d - (dow - 1) + 7))
    return { start: isoDate(monday), end: isoDate(next), label: 'week' }
  }
  if (period === 'quarter') {
    const qStart = Math.floor(m / 3) * 3
    return { start: isoDate(new Date(Date.UTC(y, qStart, 1))), end: isoDate(new Date(Date.UTC(y, qStart + 3, 1))), label: 'quarter' }
  }
  if (period === 'year') {
    return { start: `${y}-01-01`, end: `${y + 1}-01-01`, label: 'year' }
  }
  // month (default)
  return { start: isoDate(new Date(Date.UTC(y, m, 1))), end: isoDate(new Date(Date.UTC(y, m + 1, 1))), label: 'month' }
}

export interface SubmitRegularisationOpts {
  tenantId:             string
  employeeId:           string
  date:                 string   // YYYY-MM-DD
  regularization_type?: string
  requested_check_in?:  string | null
  requested_check_out?: string | null
  reason:               string
}

export interface RegularisationRow {
  id:                  string
  date:                string
  status:              string
  regularization_type: string | null
  reason:              string
  sla_deadline:        string | null
  created_at:          string
}

export type RegularisationError =
  | { type: 'SUBMISSION_WINDOW_CLOSED';  message: string }
  | { type: 'FUTURE_DATE';               message: string }
  | { type: 'FREQUENCY_LIMIT_EXCEEDED';  message: string }
  | { type: 'TYPE_LIMIT_EXCEEDED';       message: string }
  | { type: 'PERIOD_LOCKED';             message: string }
  | { type: 'DB_ERROR';                  message: string }

export type RegularisationResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: RegularisationError }

export async function submitRegularisation(
  supabase: SupabaseClient,
  opts:     SubmitRegularisationOpts,
): Promise<RegularisationResult<RegularisationRow>> {
  const { tenantId, employeeId, date, regularization_type, requested_check_in, requested_check_out, reason } = opts

  const { data: policy, error: policyErr } = await supabase
    .from('regularisation_policy')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (policyErr) return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to load regularisation policy' } }

  const windowDays      = policy?.submission_window_days ?? 7
  const maxPerPeriod    = policy?.max_per_month ?? 5
  const slaHours        = policy?.sla_hours ?? 48
  const limitPeriod     = policy?.limit_period ?? 'month'
  const excludeRejected = policy?.exclude_rejected ?? true
  const perTypeLimits   = (policy?.per_type_limits ?? {}) as Record<string, number>

  // "today" is resolved in the tenant's own timezone, not the server's (UTC)
  // clock — otherwise the window-closed cutoff and the frequency-limit period
  // boundary below shift by up to a day near the tenant's local midnight.
  const tenantTz  = await fetchTenantTz(supabase, tenantId)
  const todayStr  = getLocalDate(new Date().toISOString(), tenantTz)
  const attendanceDate = new Date(`${date}T12:00:00.000Z`)
  const today = new Date(`${todayStr}T12:00:00.000Z`)
  const diffDays = Math.floor((today.getTime() - attendanceDate.getTime()) / 86_400_000)

  if (diffDays > windowDays) {
    return {
      ok: false,
      error: {
        type:    'SUBMISSION_WINDOW_CLOSED',
        message: `Regularisation must be submitted within ${windowDays} days of the attendance date. This date is ${diffDays} days ago.`,
      },
    }
  }

  if (diffDays < 0) {
    return { ok: false, error: { type: 'FUTURE_DATE', message: 'Regularisation cannot be submitted for a future date.' } }
  }

  const countedStatuses = excludeRejected
    ? ['pending', 'approved']
    : ['pending', 'approved', 'rejected']

  const { start: periodStart, end: periodEnd, label: periodLabel } = limitPeriodBounds(limitPeriod, today)

  const { count: periodCount, error: periodCountErr } = await supabase
    .from('attendance_regularisation')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .in('status', countedStatuses)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd)
  // Fail closed — a query error must not silently read as "0 requests this
  // period" and skip the frequency cap.
  if (periodCountErr) return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to check regularisation frequency' } }

  if ((periodCount ?? 0) >= maxPerPeriod) {
    return {
      ok: false,
      error: {
        type:    'FREQUENCY_LIMIT_EXCEEDED',
        message: `You have reached the maximum of ${maxPerPeriod} regularisation requests for this ${periodLabel}.`,
      },
    }
  }

  const typeCap = regularization_type ? Number(perTypeLimits[regularization_type]) : NaN
  if (regularization_type && Number.isFinite(typeCap) && typeCap > 0) {
    const { count: typeCount, error: typeCountErr } = await supabase
      .from('attendance_regularisation')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('regularization_type', regularization_type)
      .in('status', countedStatuses)
      .gte('created_at', periodStart)
      .lt('created_at', periodEnd)
    if (typeCountErr) return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to check regularisation type frequency' } }

    if ((typeCount ?? 0) >= typeCap) {
      return {
        ok: false,
        error: {
          type:    'TYPE_LIMIT_EXCEEDED',
          message: `You have reached the maximum of ${typeCap} "${regularization_type.replace(/_/g, ' ')}" requests for this ${periodLabel}.`,
        },
      }
    }
  }

  const { data: periodLock, error: periodLockErr } = await supabase
    .from('attendance_period_locks')
    .select('state')
    .eq('tenant_id', tenantId)
    .eq('period_month', date.slice(0, 7))
    .maybeSingle()
  // Must not silently skip this check — this is the only backstop against
  // new regularisation requests for a month HR has already frozen/finalized
  // for payroll (no DB-level trigger enforces it for this table).
  if (periodLockErr) return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to check payroll period lock' } }

  if (periodLock && periodLock.state !== 'OPEN') {
    return { ok: false, error: { type: 'PERIOD_LOCKED', message: 'Regularisation submissions are closed for this pay period.' } }
  }

  const slaDeadline = new Date(Date.now() + slaHours * 3_600_000).toISOString()

  const { data, error } = await supabase
    .from('attendance_regularisation')
    .insert({
      tenant_id:           tenantId,
      employee_id:         employeeId,
      date,
      regularization_type: regularization_type ?? null,
      requested_check_in:  requested_check_in  ?? null,
      requested_check_out: requested_check_out ?? null,
      reason,
      sla_deadline:        slaDeadline,
    })
    .select('id, date, status, regularization_type, reason, sla_deadline, created_at')
    .single()

  if (error) return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to submit request' } }
  return { ok: true, value: data as RegularisationRow }
}
