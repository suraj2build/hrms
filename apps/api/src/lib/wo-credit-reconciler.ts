/**
 * Weekly-Off Credit Reconciler — Phase 1
 *
 * For employees on a roster tagged with a wo_credit_structure, this derives
 * their floating weekly-offs from worked days and auto-applies the current
 * month's credit to their off-days (FIFO), relabelling those attendance_daily
 * rows as WEEKLY_OFF (computed_source='wo_credit', protected from the engine).
 *
 * Idempotent: recomputes the whole open month from current attendance each run,
 * so a missed-punch day that gets regularised mid-month automatically re-flows.
 *
 * Grace window: an absent day is NOT settled until its regularisation window
 * (regularisation_policy.submission_window_days) has closed — that's the period
 * in which a missed punch can be corrected before it's treated as a genuine off.
 *
 * Phase 1 covers: earn ladder + Sunday cap + worked-holiday reward + FIFO
 * auto-apply + grace window + monthly snapshot. Carry-over balance, manual
 * redemption and LOP finalisation are Phase 2.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const RECON_INTERVAL_MS = 6 * 60 * 60 * 1_000   // every 6h (daily-grain; cheap + idempotent)
const WARMUP_MS         = 7 * 60 * 1_000
const DEFAULT_GRACE_DAYS = 7

// ── Date helpers ────────────────────────────────────────────────────────────
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()        // month is 1-based here
}
export function sundaysInMonth(year: number, month: number): number {
  let n = 0
  const dim = daysInMonth(year, month)
  for (let d = 1; d <= dim; d++) {
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 0) n++
  }
  return n
}
const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

// ── Types ───────────────────────────────────────────────────────────────────
export interface WoStructure {
  id:                   string
  name:                 string
  monthly_cap:          'sundays' | 'none'
  rollover_expiry_days: number
  holiday_work_reward:  'wo_credit' | 'extra_pay'
  overflow_terminal:    'lop'
}
interface LadderRow { present_days: number; wo_credit: number }

export interface WoReconcileResult {
  employee_id:         string
  worked_days:         number
  earned_credit:       number
  auto_applied:        number
  pending_absent_days: number
  carried_out:         number
  extra_pay_days:      number
}

/** Highest ladder credit whose present_days threshold is met. */
function ladderCredit(ladder: LadderRow[], workedDays: number): number {
  let credit = 0
  for (const row of ladder) {
    if (workedDays >= row.present_days && row.wo_credit > credit) credit = row.wo_credit
  }
  return credit
}

// ── Applicability: which employees follow a WO structure ────────────────────
interface EmployeeWo { employeeId: string; structure: WoStructure; ladder: LadderRow[] }

export async function resolveWoEmployees(
  supabase: SupabaseClient, tenantId: string,
): Promise<EmployeeWo[]> {
  // Rosters tagged with a structure
  const { data: rosters } = await supabase
    .from('rosters')
    .select('id, wo_credit_structure_id')
    .eq('tenant_id', tenantId)
    .not('wo_credit_structure_id', 'is', null)
  const rosterToStruct = new Map<string, string>()
  for (const r of (rosters ?? []) as any[]) rosterToStruct.set(r.id, r.wo_credit_structure_id)
  if (!rosterToStruct.size) return []

  // Structures + ladders
  const structIds = [...new Set(rosterToStruct.values())]
  const { data: structRows } = await supabase
    .from('wo_credit_structure')
    .select('id, name, monthly_cap, rollover_expiry_days, holiday_work_reward, overflow_terminal, is_active')
    .eq('tenant_id', tenantId)
    .in('id', structIds)
  const structById = new Map<string, WoStructure>()
  for (const s of (structRows ?? []) as any[]) {
    if (s.is_active) structById.set(s.id, s)
  }
  if (!structById.size) return []

  const { data: ladderRows } = await supabase
    .from('wo_credit_ladder')
    .select('structure_id, present_days, wo_credit')
    .in('structure_id', [...structById.keys()])
  const ladderByStruct = new Map<string, LadderRow[]>()
  for (const l of (ladderRows ?? []) as any[]) {
    const arr = ladderByStruct.get(l.structure_id) ?? []
    arr.push({ present_days: l.present_days, wo_credit: l.wo_credit })
    ladderByStruct.set(l.structure_id, arr)
  }

  // Active employees + effective roster (employees.roster_id > site default_roster_id)
  const { data: emps } = await supabase
    .from('employees')
    .select('id, roster_id, site_id, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
  const empRows = (emps ?? []) as any[]

  const siteIds = [...new Set(empRows.map(e => e.site_id).filter(Boolean))]
  const siteDefaultRoster = new Map<string, string | null>()
  if (siteIds.length) {
    const { data: sites } = await supabase
      .from('sites').select('id, default_roster_id').eq('tenant_id', tenantId).in('id', siteIds)
    for (const s of (sites ?? []) as any[]) siteDefaultRoster.set(s.id, s.default_roster_id ?? null)
  }

  const out: EmployeeWo[] = []
  for (const e of empRows) {
    const effRoster = e.roster_id ?? (e.site_id ? siteDefaultRoster.get(e.site_id) : null)
    if (!effRoster) continue
    const structId = rosterToStruct.get(effRoster)
    if (!structId) continue
    const structure = structById.get(structId)
    if (!structure) continue
    out.push({ employeeId: e.id, structure, ladder: ladderByStruct.get(structId) ?? [] })
  }
  return out
}

async function getGraceDays(supabase: SupabaseClient, tenantId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from('regularisation_policy')
      .select('submission_window_days')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return (data as any)?.submission_window_days ?? DEFAULT_GRACE_DAYS
  } catch { return DEFAULT_GRACE_DAYS }
}

// ── Per-employee month reconciliation ───────────────────────────────────────
export async function reconcileEmployeeMonth(
  supabase: SupabaseClient,
  tenantId: string,
  emp: EmployeeWo,
  year: number,
  month: number,
  graceDays: number,
): Promise<WoReconcileResult> {
  const { employeeId, structure, ladder } = emp
  const monthStart = iso(year, month, 1)
  const monthEnd   = iso(year, month, daysInMonth(year, month))
  const todayIso   = new Date().toISOString().slice(0, 10)
  const graceCutoff = new Date(Date.now() - graceDays * 86_400_000).toISOString().slice(0, 10)

  const { data: rows } = await supabase
    .from('attendance_daily')
    .select('date, status, work_hours, worked_on_holiday, computed_source')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', monthStart)
    .lte('date', monthEnd)
  const days = (rows ?? []) as any[]

  // Worked-day tally (present-equivalents + worked holidays count as present)
  const workedSet = new Set<string>()
  let holidayWorkedDays = 0
  for (const d of days) {
    const worked = (d.work_hours ?? 0) > 0
      || ['present', 'late', 'half_day'].includes(d.status)
      || d.worked_on_holiday === true
    if (worked) workedSet.add(d.date)
    if (d.worked_on_holiday === true) holidayWorkedDays++
  }
  const workedDays = workedSet.size

  // Earn: ladder, capped at Sundays, + worked-holiday reward
  const cap = structure.monthly_cap === 'sundays' ? sundaysInMonth(year, month) : Number.POSITIVE_INFINITY
  const earnedRatio  = Math.min(ladderCredit(ladder, workedDays), cap)
  const holidayBonus = structure.holiday_work_reward === 'wo_credit' ? holidayWorkedDays : 0
  const extraPayDays = structure.holiday_work_reward === 'extra_pay' ? holidayWorkedDays : 0
  const earned = earnedRatio + holidayBonus

  // Off-candidates: no-work, non-holiday days that are either plain absent or a
  // previously reconciler-applied weekly-off (re-evaluated each run).
  const candidates = days.filter(d =>
    (d.work_hours ?? 0) === 0
    && d.worked_on_holiday !== true
    && d.date <= todayIso
    && (
      (d.status === 'absent'     && (d.computed_source ?? 'engine') === 'engine')
      || (d.status === 'weekly_off' && d.computed_source === 'wo_credit')
    ),
  )
  // Only settle candidates whose regularisation window has closed.
  const settled = candidates
    .filter(d => d.date < graceCutoff)
    .sort((a, b) => a.date.localeCompare(b.date))   // FIFO

  const applyCount  = Math.min(earned, settled.length)
  const appliedDates = settled.slice(0, applyCount).map(d => d.date)
  const appliedSet   = new Set(appliedDates)

  // Rows previously applied that are no longer in the applied set → release.
  const releaseRows = days.filter(d => d.computed_source === 'wo_credit' && !appliedSet.has(d.date))

  // ── Apply WO credit ──
  if (appliedDates.length) {
    await supabase
      .from('attendance_daily')
      .update({ status: 'weekly_off', computed_source: 'wo_credit', day_fraction: 1, is_payable: true })
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .in('date', appliedDates)
  }
  // ── Release (hand back to engine) ──
  for (const r of releaseRows) {
    const worked = (r.work_hours ?? 0) > 0
    await supabase
      .from('attendance_daily')
      .update({
        status: worked ? 'present' : 'absent',
        computed_source: 'engine',
        is_payable: worked,
      })
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('date', r.date)
  }

  const pendingAbsentDays = settled.length - applyCount
  const carriedOut = Math.max(earned - applyCount, 0)
  const leaveAppliedDays = days.filter(d => d.status === 'leave').length

  // ── Snapshot ──
  await supabase
    .from('wo_credit_monthly')
    .upsert({
      tenant_id: tenantId,
      employee_id: employeeId,
      structure_id: structure.id,
      year, month,
      worked_days: workedDays,
      holiday_worked_days: holidayWorkedDays,
      sundays_in_month: sundaysInMonth(year, month),
      earned_credit: earned,
      auto_applied: applyCount,
      pending_absent_days: pendingAbsentDays,
      leave_applied_days: leaveAppliedDays,
      extra_pay_days: extraPayDays,
      carried_out: carriedOut,
      status: 'open',
      reconciled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,employee_id,year,month' })

  return {
    employee_id: employeeId,
    worked_days: workedDays,
    earned_credit: earned,
    auto_applied: applyCount,
    pending_absent_days: pendingAbsentDays,
    carried_out: carriedOut,
    extra_pay_days: extraPayDays,
  }
}

// ── Tenant-level reconciliation for a month ─────────────────────────────────
export async function reconcileTenantMonth(
  supabase: SupabaseClient, tenantId: string, year: number, month: number,
): Promise<WoReconcileResult[]> {
  const employees = await resolveWoEmployees(supabase, tenantId)
  if (!employees.length) return []
  const graceDays = await getGraceDays(supabase, tenantId)
  const results: WoReconcileResult[] = []
  for (const emp of employees) {
    try {
      results.push(await reconcileEmployeeMonth(supabase, tenantId, emp, year, month, graceDays))
    } catch (e) {
      console.error(`[wo-credit] employee=${emp.employeeId} error:`, (e as Error).message)
    }
  }
  return results
}

// ── Scheduler ───────────────────────────────────────────────────────────────
async function tick(supabase: SupabaseClient): Promise<void> {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const { data: tenants } = await supabase.from('tenants').select('id')
  for (const t of (tenants ?? []) as any[]) {
    try {
      const res = await reconcileTenantMonth(supabase, t.id, year, month)
      const applied = res.reduce((s, r) => s + r.auto_applied, 0)
      if (applied > 0) console.log(`[wo-credit] tenant=${t.id} applied ${applied} weekly-off(s) across ${res.length} employees`)
    } catch (e) {
      console.error(`[wo-credit] tenant=${t.id} error:`, (e as Error).message)
    }
  }
}

export function registerWoCreditScheduler(supabase: SupabaseClient): void {
  setTimeout(() => {
    tick(supabase).catch(e => console.error('[wo-credit] initial tick error:', (e as Error).message))
    setInterval(
      () => tick(supabase).catch(e => console.error('[wo-credit] tick error:', (e as Error).message)),
      RECON_INTERVAL_MS,
    )
    console.log('🗓️  WO-credit reconciler active — daily floating weekly-off accounting')
  }, WARMUP_MS)
}
