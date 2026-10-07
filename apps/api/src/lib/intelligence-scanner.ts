/**
 * Intelligence Scanner — Phase 7 Operational Automation
 *
 * Proactively scans the workforce every 6 hours and emits Phase 4
 * operational intelligence events so event-bus-automation subscribers
 * can write audit logs and notify HR managers.
 *
 * Eighteen scan targets (each runs per-tenant):
 *   1.  Repeated late arrival patterns  → repeated.late.pattern.detected
 *   2.  Burnout risk (OT + no weekly-off) → burnout.risk.detected
 *   3.  Staffing shortages              → staffing.shortage.detected
 *   4.  Payroll blockers (upcoming run) → payroll.blocker.detected
 *   5.  Attendance risk score           → attendance.risk.detected
 *   6.  Compliance filing deadlines     → compliance.deadline.alert
 *   7.  Lifecycle expiry (contracts, docs, probation) → lifecycle.expiry.alert
 *   8.  Exit intent survey auto-trigger → HR inbox + survey_assignment
 *   9.  Auto polls (event-based: onboarding D30/60/90, post-transfer, post-appraisal)
 *   10. Mood theme alerts (3+ employees same store, same LLM theme, negative)
 *   11. Benefits enrolment open/close transitions
 *   12. New joiner mandatory policy assignment
 *   13. Onboarding surveys (D30/60/90 auto-assign)
 *   14. Post-appraisal surveys (3-day window)
 *   15. Post-transfer surveys (14-day window)
 *   16. Survey negative cluster detection
 *   17. Onboarding score degradation signal
 *   18. Succession candidate attrition risk cross-check
 *
 * Architecture:
 *   - Scans every SCAN_INTERVAL_MS (6 hours)
 *   - 10-minute warm-up delay at startup
 *   - All DB operations are bulk (no per-employee loops)
 *   - Errors per-tenant are caught and logged — one bad tenant cannot
 *     block scans for the rest
 *   - In-process deduplication per process lifetime (reset on restart)
 *
 * Registration:
 *   Call registerIntelligenceScanner(supabase) once at startup.
 *   Wrapped in safeRegisterModule by the caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows }       from './supabase-paginate.js'
import { eventBus }           from './event-bus.js'
import { computeUpcoming }    from './compliance-calendar.js'
import { computeLifecycleActionable, categoryLabel } from './lifecycle-expiry.js'
import { notifyHrAdmins }     from './notify.js'
import { durableQueue }       from './durable-queue.js'
import { fetchTenantTz }      from './attendance-engine.js'
import { getLocalDate }       from './org-context.js'
import { logger }             from './logger.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1_000       // 6 hours
const WARMUP_MS        = 10 * 60 * 1_000            // 10-minute startup delay

/** Number of calendar days to look back for pattern detection. */
const LOOKBACK_DAYS    = 30

/** Repeated-late threshold — min occurrences in window. */
const LATE_THRESHOLD   = 4

/** Burnout OT threshold — hours of overtime in the window. */
const BURNOUT_OT_HOURS = 20

/** Burnout weekly-off-worked threshold. */
const BURNOUT_WO_DAYS  = 2

/** Staffing shortage threshold — coverage below this % triggers an event. */
const SHORTAGE_PCT     = 70

/** High attendance risk threshold. */
const RISK_SCORE_HIGH  = 65

// ── In-process dedup ───────────────────────────────────────────────────────────
// Prevents re-emitting the same event for the same entity within one process lifetime.
//
// F47: a plain Set here never evicts. Several keys embed a month/day label
// (e.g. `repeated-late:${tenantId}:${empId}:${month}`), so this grows every
// scan cycle for every tenant/employee/event-type/period combination,
// forever — the worst of the two files with this bug class. A time-based
// clear would be wrong here too: these keys exist specifically to dedup
// "once per month" — periodically wiping the whole set would re-fire the
// same event every clear cycle instead of once a month. BoundedSet caps
// total size and evicts oldest-inserted first, which bounds memory without
// disturbing in-month dedup (a key only gets evicted once the set holds far
// more distinct period-keys than any tenant would produce in a scan cycle).
class BoundedSet<T> {
  private readonly set = new Set<T>()
  constructor(private readonly maxSize: number) {}
  has(v: T): boolean { return this.set.has(v) }
  add(v: T): void {
    this.set.add(v)
    if (this.set.size > this.maxSize) {
      const oldest = this.set.values().next().value
      if (oldest !== undefined) this.set.delete(oldest)
    }
  }
}

const emittedKeys = new BoundedSet<string>(100_000)

function shouldEmit(key: string): boolean {
  if (emittedKeys.has(key)) return false
  emittedKeys.add(key)
  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tenant-local "today" as YYYY-MM-DD. Scanners that match exact lifecycle
 * dates (joining_date, effective_date) against server-UTC "today" can miss
 * or double-fire around local midnight for non-UTC tenants (ISSUE-154 class).
 */
async function tenantTodayStr(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

/** Shift a YYYY-MM-DD date string by `deltaDays`, anchored at UTC noon to dodge DST. */
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + deltaDays, 12)).toISOString().slice(0, 10)
}

function lookbackFrom(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS)
  return d.toISOString().slice(0, 10)
}

async function fetchTenantIds(supabase: SupabaseClient): Promise<string[]> {
  const rows = await fetchAllRows<{ id: string }>((from, to) =>
    supabase.from('tenants').select('id').range(from, to),
  )
  return rows.map(t => t.id)
}

// ── Scanner 1 — Repeated Late Pattern ────────────────────────────────────────

async function scanRepeatedLate(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const from = lookbackFrom()
  const month = (await tenantTodayStr(supabase, tenantId)).slice(0, 7)

  const rows = await fetchAllRows((f, t) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, late_minutes')
      .eq('tenant_id', tenantId)
      .eq('status', 'late')
      .gte('date', from)
      .order('employee_id')
      .order('date')
      .range(f, t),
  )

  if (!rows?.length) return

  // Aggregate late counts per employee
  const byEmp = new Map<string, { count: number; totalMins: number }>()
  for (const r of rows) {
    const cur = byEmp.get(r.employee_id) ?? { count: 0, totalMins: 0 }
    cur.count++
    cur.totalMins += r.late_minutes ?? 0
    byEmp.set(r.employee_id, cur)
  }

  for (const [empId, stats] of byEmp) {
    if (stats.count < LATE_THRESHOLD) continue
    const key = `repeated-late:${tenantId}:${empId}:${month}`
    if (!shouldEmit(key)) continue

    const avgLateMins = Math.round(stats.totalMins / stats.count)
    const pattern =
      stats.count >= 20 ? 'daily' :
      stats.count >= 10 ? 'weekly' :
      'sporadic'

    eventBus.emit({
      type:          'repeated.late.pattern.detected',
      tenantId,
      correlationId: `intelligence-scanner-late-${empId}-${month}`,
      payload: {
        tenantId,
        employeeId:  empId,
        period:      month,
        lateCount:   stats.count,
        avgLateMins,
        pattern,
      },
    })
  }
}

// ── Scanner 2 — Burnout Risk ──────────────────────────────────────────────────

async function scanBurnout(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const from  = lookbackFrom()
  const month = (await tenantTodayStr(supabase, tenantId)).slice(0, 7)

  const rows = await fetchAllRows((f, t) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, overtime_minutes, worked_on_weekly_off')
      .eq('tenant_id', tenantId)
      .gte('date', from)
      .order('employee_id')
      .order('date')
      .range(f, t),
  )

  if (!rows?.length) return

  const byEmp = new Map<string, { otMins: number; woDays: number; totalDays: number }>()
  for (const r of rows) {
    const cur = byEmp.get(r.employee_id) ?? { otMins: 0, woDays: 0, totalDays: 0 }
    cur.otMins    += r.overtime_minutes ?? 0
    cur.woDays    += r.worked_on_weekly_off ? 1 : 0
    cur.totalDays += 1
    byEmp.set(r.employee_id, cur)
  }

  for (const [empId, stats] of byEmp) {
    const otHours = Math.round(stats.otMins / 60)
    if (otHours < BURNOUT_OT_HOURS && stats.woDays < BURNOUT_WO_DAYS) continue

    const key = `burnout:${tenantId}:${empId}:${month}`
    if (!shouldEmit(key)) continue

    const riskLevel: 'medium' | 'high' | 'critical' =
      (otHours > 40 || stats.woDays > 4) ? 'critical' :
      (otHours > 25 || stats.woDays > 2) ? 'high' :
      'medium'

    eventBus.emit({
      type:          'burnout.risk.detected',
      tenantId,
      correlationId: `intelligence-scanner-burnout-${empId}-${month}`,
      payload: {
        tenantId,
        employeeId:      empId,
        period:          month,
        otHours,
        consecutiveDays: stats.totalDays,
        riskLevel,
      },
    })
  }
}

// ── Scanner 3 — Staffing Shortages ────────────────────────────────────────────

async function scanStaffingShortages(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const from = lookbackFrom()

  // Look at the last 7 days of roster coverage
  const recentFrom = new Date()
  recentFrom.setUTCDate(recentFrom.getUTCDate() - 7)
  const recentFromStr = recentFrom.toISOString().slice(0, 10)

  // Fetch shift roster assignments grouped by date+shift
  const rosterRows = await fetchAllRows((f, t) =>
    supabase
      .from('shift_roster')
      .select('date, shift_id, employee_id')
      .eq('tenant_id', tenantId)
      .gte('date', recentFromStr)
      .order('employee_id')
      .order('date')
      .range(f, t),
  )

  if (!rosterRows?.length) return

  // Build scheduled headcount per date+shift
  const scheduled = new Map<string, Set<string>>()
  for (const r of rosterRows) {
    const key = `${r.date}:${r.shift_id}`
    const set = scheduled.get(key) ?? new Set<string>()
    set.add(r.employee_id)
    scheduled.set(key, set)
  }

  // Fetch actual presence
  const presenceRows = await fetchAllRows((f, t) =>
    supabase
      .from('attendance_daily')
      .select('date, employee_id, status')
      .eq('tenant_id', tenantId)
      .gte('date', recentFromStr)
      .in('status', ['present', 'late'])
      .order('employee_id')
      .order('date')
      .range(f, t),
  )

  const present = new Map<string, Set<string>>()
  for (const r of presenceRows) {
    const empScheduled = [...scheduled.entries()]
      .find(([k, emps]) => k.startsWith(r.date) && emps.has(r.employee_id))
    if (!empScheduled) continue
    const [key] = empScheduled
    const set = present.get(key) ?? new Set<string>()
    set.add(r.employee_id)
    present.set(key, set)
  }

  for (const [key, scheduledEmps] of scheduled) {
    const [date, shiftId] = key.split(':')
    const presentEmps     = present.get(key)?.size ?? 0
    const totalScheduled  = scheduledEmps.size
    if (totalScheduled === 0) continue

    const coveragePct = Math.round((presentEmps / totalScheduled) * 100)
    if (coveragePct >= SHORTAGE_PCT) continue

    const emitKey = `shortage:${tenantId}:${date}:${shiftId}`
    if (!shouldEmit(emitKey)) continue

    const severity: 'low' | 'medium' | 'high' =
      coveragePct < 40 ? 'high' : coveragePct < 60 ? 'medium' : 'low'

    // Only emit medium/high (low shortages are noise)
    if (severity === 'low') continue

    eventBus.emit({
      type:          'staffing.shortage.detected',
      tenantId,
      correlationId: `intelligence-scanner-shortage-${date}-${shiftId}`,
      payload: {
        tenantId,
        date,
        shiftId,
        required:  totalScheduled,
        available: presentEmps,
        severity,
      },
    })
  }
}

// ── Scanner 4 — Payroll Blockers ──────────────────────────────────────────────

async function scanPayrollBlockers(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const month = (await tenantTodayStr(supabase, tenantId)).slice(0, 7)

  // Get active employees without compensation records
  const employees = await fetchAllRows((f, t) =>
    supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('id')
      .range(f, t),
  )

  if (!employees?.length) return

  const compensations = await fetchAllRows((f, t) =>
    supabase
      .from('employee_compensations')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('employee_id')
      .range(f, t),
  )

  const compensatedIds = new Set(compensations.map((c: any) => c.employee_id))

  // Check for pending corrections
  const { data: pendingCorrections } = await supabase
    .from('attendance_regularisation')
    .select('employee_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')

  const pendingCorrEmpIds = new Set((pendingCorrections ?? []).map((c: any) => c.employee_id))

  for (const emp of employees) {
    const empId = emp.id

    // Blocker 1: no compensation configured
    if (!compensatedIds.has(empId)) {
      const key = `blocker-comp:${tenantId}:${empId}:${month}`
      if (shouldEmit(key)) {
        eventBus.emit({
          type:          'payroll.blocker.detected',
          tenantId,
          correlationId: `intelligence-scanner-blocker-${empId}-${month}`,
          payload: {
            tenantId,
            employeeId:  empId,
            month,
            blockerType: 'no_compensation',
            detail:      'Employee has no active compensation structure. Payroll cannot compute gross pay.',
          },
        })
      }
    }

    // Blocker 2: pending attendance correction
    if (pendingCorrEmpIds.has(empId)) {
      const key = `blocker-correction:${tenantId}:${empId}:${month}`
      if (shouldEmit(key)) {
        eventBus.emit({
          type:          'payroll.blocker.detected',
          tenantId,
          correlationId: `intelligence-scanner-blocker-corr-${empId}-${month}`,
          payload: {
            tenantId,
            employeeId:  empId,
            month,
            blockerType: 'pending_correction',
            detail:      'Employee has one or more pending attendance corrections that may affect payable days.',
          },
        })
      }
    }
  }
}

// ── Scanner 5 — Attendance Risk Score ────────────────────────────────────────

async function scanAttendanceRisk(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const from  = lookbackFrom()
  const month = (await tenantTodayStr(supabase, tenantId)).slice(0, 7)

  const rows = await fetchAllRows((f, t) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, status, late_minutes, work_hours')
      .eq('tenant_id', tenantId)
      .gte('date', from)
      .order('employee_id')
      .order('date')
      .range(f, t),
  )

  if (!rows?.length) return

  const byEmp = new Map<string, {
    total: number; absent: number; late: number;
    lateMins: number; excessiveHours: number
  }>()

  for (const r of rows) {
    const cur = byEmp.get(r.employee_id) ?? {
      total: 0, absent: 0, late: 0, lateMins: 0, excessiveHours: 0,
    }
    cur.total++
    if (r.status === 'absent')          cur.absent++
    if (r.status === 'late')            { cur.late++; cur.lateMins += r.late_minutes ?? 0 }
    if ((r.work_hours ?? 0) > 11)       cur.excessiveHours++
    byEmp.set(r.employee_id, cur)
  }

  for (const [empId, stats] of byEmp) {
    if (stats.total < 5) continue  // not enough data

    const absenceRate = stats.absent / stats.total
    const lateRate    = stats.late   / stats.total

    // Simple weighted risk score (0–100)
    let score = Math.round(
      absenceRate * 60 +
      lateRate    * 25 +
      Math.min(stats.excessiveHours / stats.total * 15, 15),
    )
    score = Math.min(score, 100)

    if (score < RISK_SCORE_HIGH) continue

    const key = `att-risk:${tenantId}:${empId}:${month}`
    if (!shouldEmit(key)) continue

    const riskType: 'repeated_late' | 'high_absence' | 'no_punch_streak' | 'excessive_hours' =
      absenceRate > 0.3 ? 'high_absence' :
      lateRate    > 0.4 ? 'repeated_late' :
      stats.excessiveHours > 5 ? 'excessive_hours' :
      'high_absence'

    const detail = [
      stats.absent > 0      && `${stats.absent} absent days`,
      stats.late > 0        && `${stats.late} late arrivals`,
      stats.excessiveHours > 0 && `${stats.excessiveHours} days with >11h`,
    ].filter(Boolean).join(', ')

    eventBus.emit({
      type:          'attendance.risk.detected',
      tenantId,
      correlationId: `intelligence-scanner-risk-${empId}-${month}`,
      payload: {
        tenantId,
        employeeId: empId,
        riskType,
        riskScore:  score,
        period:     month,
        detail:     detail || 'Multiple attendance risk factors detected',
      },
    })
  }
}

// ── Scanner 6 — Compliance filing deadlines ──────────────────────────────────
// Reuses ComplianceCalendarService (single deadline source) + notifyHrAdmins
// (existing inbox). Notifies HR only for overdue + due-within-7-days, once per
// (deadline, status) so an item alerts when it becomes due-soon and again when
// it tips into overdue — no spam.

async function scanComplianceDeadlines(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const upcoming = await computeUpcoming(supabase, tenantId, 7).catch(() => [])
  for (const d of upcoming) {
    if (d.status !== 'overdue' && d.status !== 'due_soon') continue
    const key = `compliance-deadline:${tenantId}:${d.id}:${d.status}`
    if (!shouldEmit(key)) continue

    const overdue  = d.status === 'overdue'
    const critical = overdue && Math.abs(d.days_to_due) > 15
    await notifyHrAdmins(supabase, {
      tenantId,
      item_type:    'compliance_alert',
      severity:     critical ? 'critical' : overdue ? 'error' : 'warning',
      title:        overdue
        ? `Overdue: ${d.label} (${Math.abs(d.days_to_due)}d late)`
        : `Due in ${d.days_to_due}d: ${d.label}`,
      summary:      `${d.compliance_type} filing for ${d.jurisdiction} — due ${d.due_date}. ${overdue ? 'File immediately to avoid penalties.' : 'Prepare and file before the due date.'}`,
      entity_type:  'compliance_filing',
      entity_id:    d.id,
      action_route: '/admin/payroll/compliance-calendar',
      action_label: 'Open Compliance Calendar',
      metadata:     { compliance_type: d.compliance_type, jurisdiction: d.jurisdiction, period: d.period, due_date: d.due_date, days_to_due: d.days_to_due, category: 'compliance' },
    })

    eventBus.emit({
      type: 'compliance.deadline.alert',
      tenantId,
      payload: { tenantId, deadlineId: d.id, complianceType: d.compliance_type, status: d.status, dueDate: d.due_date, daysToDue: d.days_to_due },
    } as any)
  }
}

// ── Scanner 7 — Lifecycle expiry (Program 3A) ────────────────────────────────
// Reuses the single lifecycle-expiry source + notifyHrAdmins (existing inbox).
// Notifies HR for overdue + due-within-7-days only, once per (item, bucket) so an
// item alerts when it tips into due-soon and again when it becomes overdue — no
// spam. Also self-heals contract status (active → expired) once a contract's
// end_date has passed, using the same scan pass (no new workflow engine).

async function scanLifecycleExpiry(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const items = await computeLifecycleActionable(supabase, tenantId).catch(() => [])

  for (const it of items) {
    const key = `lifecycle:${tenantId}:${it.id}:${it.bucket}`
    if (!shouldEmit(key)) continue

    const overdue = it.bucket === 'overdue'
    await notifyHrAdmins(supabase, {
      tenantId,
      item_type:    'compliance_alert',
      severity:     overdue ? 'error' : 'warning',
      title:        overdue
        ? `Expired: ${it.label} — ${it.employee_name} (${Math.abs(it.days_to_due)}d ago)`
        : `Expiring in ${it.days_to_due}d: ${it.label} — ${it.employee_name}`,
      summary:      `${categoryLabel(it.category)} · ${it.employee_name}${it.employee_code ? ` (${it.employee_code})` : ''}${it.department_name ? ` · ${it.department_name}` : ''} — ${overdue ? 'has expired' : 'expires'} on ${it.due_date}. ${it.category === 'probation' ? 'Confirm or extend probation.' : 'Renew the document before expiry to stay compliant.'}`,
      entity_type:  it.source_table,
      entity_id:    it.source_id,
      action_route: '/admin/workforce/expiry-management',
      action_label: 'Open Expiry Management',
      metadata:     { category: it.category, lifecycle: true, employee_id: it.employee_id, due_date: it.due_date, days_to_due: it.days_to_due, bucket: it.bucket },
    })

    eventBus.emit({
      type: 'lifecycle.expiry.alert',
      tenantId,
      payload: { tenantId, category: it.category, sourceTable: it.source_table, sourceId: it.source_id, employeeId: it.employee_id, dueDate: it.due_date, daysToDue: it.days_to_due, bucket: it.bucket },
    } as any)
  }

  // Self-heal: mark active contracts expired once their end_date is in the past.
  const todayIso = await tenantTodayStr(supabase, tenantId)
  const { data: lapsed } = await supabase
    .from('employee_contracts')
    .select('id')
    .eq('tenant_id', tenantId).eq('status', 'active')
    .not('end_date', 'is', null).lt('end_date', todayIso)
  for (const c of (lapsed ?? []) as any[]) {
    const { error: expireErr } = await supabase.from('employee_contracts').update({ status: 'expired' }).eq('id', c.id).eq('tenant_id', tenantId)
    if (expireErr) {
      // Don't emit contract.expired if the state transition didn't actually
      // happen — otherwise the scanner re-detects the same lapsed contract
      // (still 'active' in the DB) and re-emits the event every cycle.
      console.warn('[intelligence-scanner] failed to mark contract expired:', c.id, expireErr.message)
      continue
    }
    eventBus.emit({ type: 'contract.expired', tenantId, payload: { tenantId, contractId: c.id } } as any)
  }
}

// ── Scanner 8 — Exit Intent Survey Auto-Trigger ───────────────────────────────
// Employees with persistently low mood (avg ≤ 2.5/5) in 2+ of the last 3 full
// calendar months are auto-enrolled in the tenant's active exit_intent survey.
// If no active survey exists the scanner creates one from the system template.
// Each employee is enrolled at most once every 90 days.

const EXIT_MOOD_THRESHOLD   = 2.5   // avg mood score ≤ this → at-risk month
const EXIT_MONTHS_REQUIRED  = 2     // must be at-risk in this many of the last 3 months
const EXIT_COOLDOWN_DAYS    = 90    // do not re-assign sooner than this

async function scanExitIntentSurveys(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const now = new Date()

  // Last 3 full calendar month strings: ['2026-04', '2026-05', '2026-06']
  const months: string[] = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const fromDate = `${months[0]}-01`

  // Fetch all mood check-ins in the 3-month window for this tenant.
  // fetchAllRows(): tenant-wide, no employee filter — a plain query would
  // silently under-report for a tenant with >1,000 check-ins in the window.
  const checkins = await fetchAllRows((from, to) =>
    supabase
      .from('mood_checkins')
      .select('employee_id, mood, checkin_date')
      .eq('tenant_id', tenantId)
      .gte('checkin_date', fromDate)
      .order('id')
      .range(from, to),
  )

  if (!checkins.length) return

  // Aggregate per employee per month: { empId → { 'YYYY-MM' → { sum, count } } }
  const byEmpMonth = new Map<string, Map<string, { sum: number; count: number }>>()
  for (const row of checkins) {
    const month = (row.checkin_date as string).slice(0, 7)
    if (!months.includes(month)) continue
    let empMap = byEmpMonth.get(row.employee_id)
    if (!empMap) { empMap = new Map(); byEmpMonth.set(row.employee_id, empMap) }
    const cur = empMap.get(month) ?? { sum: 0, count: 0 }
    cur.sum   += row.mood as number
    cur.count += 1
    empMap.set(month, cur)
  }

  // Find employees at-risk (low avg mood) in 2+ months; require ≥ 3 check-ins per month
  const atRiskEmployees: string[] = []
  for (const [empId, empMap] of byEmpMonth) {
    let riskMonths = 0
    for (const month of months) {
      const m = empMap.get(month)
      if (m && m.count >= 3 && m.sum / m.count <= EXIT_MOOD_THRESHOLD) riskMonths++
    }
    if (riskMonths >= EXIT_MONTHS_REQUIRED) atRiskEmployees.push(empId)
  }
  if (!atRiskEmployees.length) return

  // ── Find or create the tenant's active exit_intent survey ──────────────────

  const { data: activeSurveys } = await supabase
    .from('surveys')
    .select('id, title')
    .eq('tenant_id', tenantId)
    .eq('survey_type', 'exit_intent')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)

  let surveyId   = activeSurveys?.[0]?.id   ?? null
  let surveyTitle = activeSurveys?.[0]?.title ?? 'Exit Intent Survey'

  if (!surveyId) {
    // Try to auto-create from the system template
    const { data: tmpl } = await supabase
      .from('survey_templates')
      .select('name, description, questions')
      .eq('survey_type', 'exit_intent')
      .maybeSingle()

    if (!tmpl) return   // no template — cannot proceed

    const due = new Date(now)
    due.setDate(due.getDate() + 14)
    const dueDate = due.toISOString().slice(0, 10)

    const { data: newSurvey } = await supabase
      .from('surveys')
      .insert({
        tenant_id:    tenantId,
        title:        tmpl.name,
        description:  tmpl.description,
        status:       'active',
        survey_type:  'exit_intent',
        is_anonymous: true,
        due_date:     dueDate,
      })
      .select('id')
      .single()

    if (!newSurvey) return

    surveyId    = newSurvey.id
    surveyTitle = tmpl.name

    const qRows = ((tmpl.questions as any[]) ?? []).map(q => ({
      ...q,
      survey_id: newSurvey.id,
      tenant_id: tenantId,
    }))
    if (qRows.length) await supabase.from('survey_questions').insert(qRows)
  }

  // ── Skip employees assigned to any exit_intent survey in the last 90 days ──

  const cooldownFrom = new Date(now)
  cooldownFrom.setDate(cooldownFrom.getDate() - EXIT_COOLDOWN_DAYS)
  const cooldownStr = cooldownFrom.toISOString()

  const { data: allExitSurveys } = await supabase
    .from('surveys')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('survey_type', 'exit_intent')

  const exitSurveyIds = (allExitSurveys ?? []).map((s: any) => s.id as string)

  const recentlyAssigned = new Set<string>()
  if (exitSurveyIds.length) {
    const { data: recent } = await supabase
      .from('survey_assignments')
      .select('employee_id')
      .in('survey_id', exitSurveyIds)
      .in('employee_id', atRiskEmployees)
      .gte('assigned_at', cooldownStr)

    for (const a of recent ?? []) recentlyAssigned.add(a.employee_id)
  }

  const toAssign = atRiskEmployees.filter(id => !recentlyAssigned.has(id))
  if (!toAssign.length) return

  // ── Dedup: emit only once per (surveyId, tenantId) batch per process lifetime

  const scanKey = `exit-intent-survey:${tenantId}:${surveyId}:${months[2]}`
  if (!shouldEmit(scanKey)) return

  // ── Assign survey ──────────────────────────────────────────────────────────

  const assignRows = toAssign.map(empId => ({
    survey_id:       surveyId as string,
    employee_id:     empId,
    tenant_id:       tenantId,
    respondent_type: 'self',
  }))

  const { error } = await supabase
    .from('survey_assignments')
    .upsert(assignRows, { onConflict: 'survey_id,employee_id', ignoreDuplicates: true })

  if (error) return   // don't block the loop on a DB error

  // ── Notify HR admins ───────────────────────────────────────────────────────

  const { data: emps } = await supabase
    .from('employees')
    .select('first_name, last_name, employee_code')
    .in('id', toAssign)
    .eq('tenant_id', tenantId)

  const nameList = (emps ?? [])
    .map((e: any) => `${e.first_name} ${e.last_name} (${e.employee_code})`)
    .join(', ')

  await notifyHrAdmins(supabase, {
    tenantId,
    item_type:    'general',
    severity:     'warning',
    title:        `Exit Intent Survey auto-assigned to ${toAssign.length} employee${toAssign.length > 1 ? 's' : ''}`,
    summary:      `AI detected persistently low mood (2+ of the last 3 months) for: ${nameList}. The "${surveyTitle}" survey has been auto-assigned for retention insight.`,
    entity_type:  'survey',
    entity_id:    surveyId,
    action_route: '/admin/surveys',
    action_label: 'View Surveys',
    metadata:     { category: 'exit_intent', auto_triggered: true, employee_count: toAssign.length },
  })
}

// ── Helpers for survey auto-trigger ──────────────────────────────────────────

/** Find or create an active survey of the given type from the system template. */
async function findOrCreateSurvey(
  supabase: SupabaseClient, tenantId: string, surveyType: string,
): Promise<string | null> {
  const { data: active } = await supabase
    .from('surveys').select('id')
    .eq('tenant_id', tenantId).eq('survey_type', surveyType).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1)

  if (active?.[0]?.id) return active[0].id

  const { data: tmpl } = await supabase
    .from('survey_templates').select('name, description, questions')
    .eq('survey_type', surveyType).maybeSingle()
  if (!tmpl) return null

  const due = new Date(); due.setDate(due.getDate() + 14)
  const { data: newS } = await supabase.from('surveys').insert({
    tenant_id: tenantId, title: tmpl.name, description: tmpl.description,
    status: 'active', survey_type: surveyType, is_anonymous: false,
    due_date: due.toISOString().slice(0, 10),
  }).select('id').single()
  if (!newS) return null

  const qRows = ((tmpl.questions as any[]) ?? []).map((q: any) => ({
    ...q, survey_id: newS.id, tenant_id: tenantId,
  }))
  if (qRows.length) await supabase.from('survey_questions').insert(qRows)
  return newS.id
}

/** Auto-assign a survey to employees, honouring cooldownDays. */
async function autoAssignSurvey(
  supabase: SupabaseClient, tenantId: string, surveyId: string,
  employeeIds: string[], surveyType: string, cooldownDays: number,
): Promise<string[]> {
  if (!employeeIds.length) return []

  const cooldownFrom = new Date(); cooldownFrom.setDate(cooldownFrom.getDate() - cooldownDays)

  const { data: allSurveys } = await supabase.from('surveys').select('id')
    .eq('tenant_id', tenantId).eq('survey_type', surveyType)
  const surveyIds = (allSurveys ?? []).map((s: any) => s.id as string)

  const alreadyAssigned = new Set<string>()
  if (surveyIds.length) {
    const { data: recent } = await supabase.from('survey_assignments').select('employee_id')
      .in('survey_id', surveyIds).in('employee_id', employeeIds)
      .gte('assigned_at', cooldownFrom.toISOString())
    for (const a of (recent ?? []) as any[]) alreadyAssigned.add(a.employee_id)
  }

  const toAssign = employeeIds.filter(id => !alreadyAssigned.has(id))
  if (!toAssign.length) return []

  await supabase.from('survey_assignments').upsert(
    toAssign.map(empId => ({ survey_id: surveyId, employee_id: empId, tenant_id: tenantId, respondent_type: 'self' })),
    { onConflict: 'survey_id,employee_id', ignoreDuplicates: true },
  )
  return toAssign
}

// ── Scanner 9 — Auto polls (event-based) ─────────────────────────────────────

async function scanAutoPolls(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const today = await tenantTodayStr(supabase, tenantId)

  // Post-appraisal polls (3 days after completion)
  const appraisalDateStr = shiftDateStr(today, -3)
  const { data: appraisals } = await supabase
    .from('performance_appraisals').select('employee_id')
    .eq('tenant_id', tenantId).eq('status', 'completed')
    .gte('completed_at', `${appraisalDateStr}T00:00:00Z`)
    .lte('completed_at', `${appraisalDateStr}T23:59:59Z`)
  if (appraisals?.length) {
    const key = `auto-poll:post_appraisal:${tenantId}:${today}`
    if (shouldEmit(key)) {
      const empIds = (appraisals as any[]).map((a: any) => a.employee_id as string)
      const surveyId = await findOrCreateSurvey(supabase, tenantId, 'post_appraisal')
      if (surveyId) await autoAssignSurvey(supabase, tenantId, surveyId, empIds, 'post_appraisal', 90)
    }
  }

  // Post-transfer polls (14 days after transfer)
  const { data: transfers } = await supabase
    .from('employee_transfers').select('employee_id')
    .eq('tenant_id', tenantId)
    .eq('effective_date', shiftDateStr(today, -14))
  if (transfers?.length) {
    const key = `auto-poll:post_transfer:${tenantId}:${today}`
    if (shouldEmit(key)) {
      const empIds = (transfers as any[]).map((t: any) => t.employee_id as string)
      const surveyId = await findOrCreateSurvey(supabase, tenantId, 'post_transfer')
      if (surveyId) await autoAssignSurvey(supabase, tenantId, surveyId, empIds, 'post_transfer', 90)
    }
  }
}

// ── Scanner 10 — Mood theme alerts ───────────────────────────────────────────

async function scanMoodThemeAlerts(supabase: SupabaseClient, tenantId: string): Promise<void> {
  // F48: was server-local (new Date()) for both the lookback window and the
  // dedup week label — derive both from tenant-local "today" instead, same
  // fix pattern as currentMonth() above.
  const today       = await tenantTodayStr(supabase, tenantId)
  const sevenDaysAgo = shiftDateStr(today, -7)
  const [yStr, , dStr] = today.split('-')
  const week = `${yStr}-W${String(Math.ceil(Number(dStr) / 7)).padStart(2, '0')}`

  // fetchAllRows(): tenant-wide, no employee filter — a plain query would
  // silently under-report for a tenant with >1,000 qualifying check-ins.
  const checkins = await fetchAllRows((from, to) =>
    supabase
      .from('mood_checkins').select('employee_id, sentiment_category, employees!inner(work_location_id, tenant_id)')
      .eq('tenant_id', tenantId).eq('sentiment_label', 'negative')
      .gte('checkin_date', sevenDaysAgo)
      .not('sentiment_category', 'is', null)
      .order('id')
      .range(from, to),
  )

  if (!checkins.length) return

  // Group by location + category
  const groups = new Map<string, { locationId: string; category: string; employees: Set<string> }>()
  for (const c of checkins as any[]) {
    const locationId = c.employees?.work_location_id
    const category   = c.sentiment_category
    if (!locationId || !category) continue
    const key = `${locationId}:${category}`
    if (!groups.has(key)) groups.set(key, { locationId, category, employees: new Set() })
    groups.get(key)!.employees.add(c.employee_id)
  }

  for (const [, grp] of groups) {
    if (grp.employees.size < 3) continue
    const dedupKey = `mood-theme:${tenantId}:${grp.locationId}:${grp.category}:${week}`
    if (!shouldEmit(dedupKey)) continue

    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'warning',
      title:    `3+ employees in same location reported ${grp.category} concerns`,
      summary:  `${grp.employees.size} employees at location ${grp.locationId} logged negative mood with theme "${grp.category}" in the past 7 days.`,
      entity_type: 'work_location', entity_id: grp.locationId,
      action_route: '/admin/mood', action_label: 'View Mood Dashboard',
      metadata: { category: grp.category, employee_count: grp.employees.size, location_id: grp.locationId },
    })
  }
}

// ── Scanner 11 — Benefits enrolment open/close ────────────────────────────────

async function scanBenefitsEnrolment(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const now = new Date().toISOString()

  // Plans that should open
  const { data: toOpen } = await supabase.from('benefit_plans')
    .select('id, name').eq('tenant_id', tenantId).neq('status', 'open')
    .lte('enrollment_opens_at', now).not('enrollment_opens_at', 'is', null)
  for (const plan of (toOpen ?? []) as any[]) {
    const key = `benefits-enrolment-open:${tenantId}:${plan.id}`
    if (!shouldEmit(key)) continue
    const { error: openErr } = await supabase.from('benefit_plans').update({ status: 'open' }).eq('id', plan.id).eq('tenant_id', tenantId)
    if (openErr) {
      // Don't tell HR/employees enrolment opened if the status write failed —
      // the portal's actual enrolment gate never changed.
      console.warn('[intelligence-scanner] failed to open benefit plan enrolment:', plan.id, openErr.message)
      continue
    }
    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'info',
      title:    `Benefits enrolment opened: ${plan.name}`,
      summary:  `The enrolment window for "${plan.name}" is now open. Notify employees to update their coverage.`,
      entity_type: 'benefit_plan', entity_id: plan.id,
      action_route: '/admin/benefits', action_label: 'View Benefits',
    })
  }

  // Plans that should close
  const { data: toClose } = await supabase.from('benefit_plans')
    .select('id, name').eq('tenant_id', tenantId).eq('status', 'open')
    .lte('enrollment_closes_at', now).not('enrollment_closes_at', 'is', null)
  for (const plan of (toClose ?? []) as any[]) {
    const key = `benefits-enrolment-close:${tenantId}:${plan.id}`
    if (!shouldEmit(key)) continue
    const { error: closeErr } = await supabase.from('benefit_plans').update({ status: 'active' }).eq('id', plan.id).eq('tenant_id', tenantId)
    if (closeErr) {
      // Same reasoning as the open branch above — don't send a misleading
      // "enrolment closed" notification if the status write failed.
      console.warn('[intelligence-scanner] failed to close benefit plan enrolment:', plan.id, closeErr.message)
      continue
    }
    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'info',
      title:    `Benefits enrolment closed: ${plan.name}`,
      summary:  `The enrolment window for "${plan.name}" has closed.`,
      entity_type: 'benefit_plan', entity_id: plan.id,
      action_route: '/admin/benefits', action_label: 'View Benefits',
    })
  }
}

// ── Scanner 12 — New joiner mandatory policy assignment ───────────────────────

async function scanNewJoinerPolicyAssignment(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const today = await tenantTodayStr(supabase, tenantId)

  const { data: newJoiners } = await supabase.from('employees')
    .select('id, first_name, last_name, phone').eq('tenant_id', tenantId)
    .eq('status', 'active').eq('joining_date', today)
  if (!newJoiners?.length) return

  const { data: mandatoryPolicies } = await supabase.from('hr_policies')
    .select('id').eq('tenant_id', tenantId).eq('is_mandatory', true).eq('status', 'published')
  if (!mandatoryPolicies?.length) return

  const key = `new-joiner-policies:${tenantId}:${today}`
  if (!shouldEmit(key)) return

  // Track actual write success — HR must not be told policies were assigned
  // if every upsert failed (fabricated-success).
  let assignedCount = 0
  for (const emp of newJoiners as any[]) {
    for (const policy of mandatoryPolicies as any[]) {
      const { error: upsertErr } = await supabase.from('policy_acknowledgements').upsert(
        { tenant_id: tenantId, policy_id: policy.id, employee_id: emp.id },
        { onConflict: 'tenant_id,policy_id,employee_id', ignoreDuplicates: true },
      )
      if (upsertErr) {
        console.warn('[intelligence-scanner] failed to assign policy ack:', emp.id, policy.id, upsertErr.message)
        continue
      }
      assignedCount++
    }
  }
  if (!assignedCount) return

  await notifyHrAdmins(supabase, {
    tenantId, item_type: 'general', severity: 'info',
    title:    `${newJoiners.length} new joiner(s) — mandatory policies assigned`,
    summary:  `${assignedCount} mandatory policy assignment${assignedCount === 1 ? '' : 's'} auto-created for today's joiners.`,
    entity_type: 'employee', action_route: '/admin/policies', action_label: 'View Policies',
  })
}

// ── Scanner 13 — Onboarding surveys (D30/60/90) ───────────────────────────────

async function scanOnboardingSurveys(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const todayStr = await tenantTodayStr(supabase, tenantId)

  for (const [days, type] of [[30, 'onboarding_d30'], [60, 'onboarding_d60'], [90, 'onboarding_d90']] as [number, string][]) {
    const targetDate = shiftDateStr(todayStr, -days)

    const { data: emps } = await supabase.from('employees')
      .select('id').eq('tenant_id', tenantId).eq('status', 'active').eq('joining_date', targetDate)
    if (!emps?.length) continue

    const key = `onboarding-survey:${type}:${tenantId}:${todayStr}`
    if (!shouldEmit(key)) continue

    const surveyId = await findOrCreateSurvey(supabase, tenantId, type)
    if (!surveyId) continue

    const empIds = (emps as any[]).map((e: any) => e.id as string)
    const assigned = await autoAssignSurvey(supabase, tenantId, surveyId, empIds, type, 30)
    if (!assigned.length) continue

    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'info',
      title:    `Onboarding Day-${days} survey assigned to ${assigned.length} employee(s)`,
      summary:  `Auto-triggered ${type.replace('_', ' ').toUpperCase()} for ${assigned.length} employee(s) who joined ${days} days ago.`,
      entity_type: 'survey', entity_id: surveyId,
      action_route: '/admin/surveys', action_label: 'View Surveys',
    })
  }
}

// ── Scanner 14 — Post-appraisal surveys ──────────────────────────────────────

async function scanPostAppraisalSurveys(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const todayStr = await tenantTodayStr(supabase, tenantId)
  const dateStr  = shiftDateStr(todayStr, -3)

  const { data: appraisals } = await supabase.from('performance_appraisals')
    .select('employee_id').eq('tenant_id', tenantId).eq('status', 'completed')
    .gte('completed_at', `${dateStr}T00:00:00Z`).lte('completed_at', `${dateStr}T23:59:59Z`)
  if (!appraisals?.length) return

  const key = `post-appraisal-survey:${tenantId}:${todayStr}`
  if (!shouldEmit(key)) return

  const surveyId = await findOrCreateSurvey(supabase, tenantId, 'post_appraisal')
  if (!surveyId) return

  const empIds = [...new Set((appraisals as any[]).map((a: any) => a.employee_id as string))]
  await autoAssignSurvey(supabase, tenantId, surveyId, empIds, 'post_appraisal', 90)
}

// ── Scanner 15 — Post-transfer surveys ───────────────────────────────────────

async function scanPostTransferSurveys(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const todayStr = await tenantTodayStr(supabase, tenantId)

  const { data: transfers } = await supabase.from('employee_transfers')
    .select('employee_id').eq('tenant_id', tenantId)
    .eq('effective_date', shiftDateStr(todayStr, -14))
  if (!transfers?.length) return

  const key = `post-transfer-survey:${tenantId}:${todayStr}`
  if (!shouldEmit(key)) return

  const surveyId = await findOrCreateSurvey(supabase, tenantId, 'post_transfer')
  if (!surveyId) return

  const empIds = [...new Set((transfers as any[]).map((t: any) => t.employee_id as string))]
  await autoAssignSurvey(supabase, tenantId, surveyId, empIds, 'post_transfer', 90)
}

// ── Scanner 16 — Survey negative cluster detection ────────────────────────────

async function scanSurveyNegativeClusters(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30)

  // Fresh audit finding: survey_response_analysis.response_id has no real FK
  // constraint (just NOT NULL UNIQUE) and the table has no tenant_id column
  // of its own — tenant scoping only exists via RLS (joining through
  // survey_responses → survey_assignments → surveys.tenant_id). Since this
  // codebase's service-role Supabase client bypasses RLS, a plain
  // .eq('sentiment', ...) query with no join pulled EVERY tenant's negative/
  // high-urgency survey analyses on every iteration of the per-tenant scan
  // loop, and notifyHrAdmins() then alerted tenant A's HR admins using data
  // built from tenant B/C/etc.'s confidential employee sentiment. Resolve
  // this tenant's own response_ids first (survey_responses does have a real
  // tenant_id column) and scope the analysis query to that set.
  const responseRows = await fetchAllRows<{ id: string }>((from, to) =>
    supabase.from('survey_responses').select('id').eq('tenant_id', tenantId).range(from, to),
  )
  if (!responseRows.length) return
  const responseIds = responseRows.map(r => r.id)

  const analyses = await fetchAllRows<{ id: string; themes: string[]; response_id: string }>((from, to) =>
    supabase
      .from('survey_response_analysis').select('id, themes, response_id')
      .eq('sentiment', 'negative').eq('urgency', 'high')
      .gte('analyzed_at', thirtyAgo.toISOString())
      .in('response_id', responseIds)
      .range(from, to),
  )
  if (!analyses.length) return

  const week = `W${String(Math.ceil(new Date().getDate() / 7)).padStart(2, '0')}`

  // Group by location + theme
  const groups = new Map<string, { locationId: string; theme: string; count: number }>()
  for (const a of analyses as any[]) {
    // This is a simplified approach; full version would join through assignments/employees
    for (const theme of (a.themes ?? []) as string[]) {
      const groupKey = `${theme}`
      const existing = groups.get(groupKey) ?? { locationId: 'global', theme, count: 0 }
      existing.count++
      groups.set(groupKey, existing)
    }
  }

  for (const [, grp] of groups) {
    if (grp.count < 3) continue
    const dedupKey = `survey-negative-cluster:${tenantId}:${grp.theme}:${week}`
    if (!shouldEmit(dedupKey)) continue

    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'critical',
      title:    `Negative survey theme cluster: "${grp.theme}"`,
      summary:  `${grp.count} high-urgency negative responses mentioning "${grp.theme}" in the last 30 days. Review survey results for patterns.`,
      entity_type: 'survey', action_route: '/admin/surveys', action_label: 'View Survey Results',
      metadata: { theme: grp.theme, count: grp.count },
    })
  }
}

// ── Scanner 17 — Onboarding score degradation ─────────────────────────────────

async function scanOnboardingDegradation(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const month = (await tenantTodayStr(supabase, tenantId)).slice(0, 7)

  // Find employees who have completed both D30 and D60 surveys
  const d30Results = await fetchAllRows<{ employee_id: string }>((from, to) =>
    supabase
      .from('survey_assignments').select('employee_id, surveys!inner(survey_type, tenant_id)')
      .eq('surveys.tenant_id', tenantId).eq('surveys.survey_type', 'onboarding_d30')
      .not('completed_at', 'is', null)
      .range(from, to),
  )

  const d60Results = await fetchAllRows<{ employee_id: string }>((from, to) =>
    supabase
      .from('survey_assignments').select('employee_id, surveys!inner(survey_type, tenant_id)')
      .eq('surveys.tenant_id', tenantId).eq('surveys.survey_type', 'onboarding_d60')
      .not('completed_at', 'is', null)
      .range(from, to),
  )

  if (!d30Results.length || !d60Results.length) return

  const d60EmpIds = new Set(d60Results.map(r => r.employee_id))
  const bothIds   = d30Results
    .filter(r => d60EmpIds.has(r.employee_id))
    .map(r => r.employee_id)

  if (!bothIds.length) return

  // For each employee, fetch average scores from both surveys
  for (const empId of bothIds) {
    const key = `onboarding-degradation:${tenantId}:${empId}:${month}`
    if (!shouldEmit(key)) continue

    // Get avg scores from survey_responses via assignments
    const { data: d30Responses } = await supabase
      .from('survey_responses').select('response_value')
      .eq('tenant_id', tenantId).eq('employee_id', empId).eq('response_type', 'rating')
      .in('survey_type', ['onboarding_d30'])
    const { data: d60Responses } = await supabase
      .from('survey_responses').select('response_value')
      .eq('tenant_id', tenantId).eq('employee_id', empId).eq('response_type', 'rating')
      .in('survey_type', ['onboarding_d60'])

    if (!d30Responses?.length || !d60Responses?.length) continue

    const d30Avg = (d30Responses as any[]).reduce((s: number, r: any) => s + Number(r.response_value ?? 0), 0) / d30Responses.length
    const d60Avg = (d60Responses as any[]).reduce((s: number, r: any) => s + Number(r.response_value ?? 0), 0) / d60Responses.length

    if (d30Avg - d60Avg < 1.0) continue  // no significant drop

    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'warning',
      title:    `Onboarding score dropped for employee ${empId}`,
      summary:  `Day-30 avg score was ${d30Avg.toFixed(1)} but Day-60 dropped to ${d60Avg.toFixed(1)} — possible early attrition risk.`,
      entity_type: 'employee', entity_id: empId,
      action_route: '/admin/surveys', action_label: 'View Surveys',
      metadata: { d30_avg: d30Avg, d60_avg: d60Avg, drop: d30Avg - d60Avg },
    })
  }
}

// ── Scanner 18 — Succession candidate attrition risk ─────────────────────────

async function scanSuccessionAttritionRisk(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const month = (await tenantTodayStr(supabase, tenantId)).slice(0, 7)

  const { data: candidates } = await supabase.from('succession_candidates')
    .select('id, employee_id, plan_id')
    .eq('tenant_id', tenantId)
    .in('readiness_level', ['ready_now', 'ready_1_2_years'])
  if (!candidates?.length) return

  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  for (const candidate of candidates as any[]) {
    const key = `succession-attrition:${tenantId}:${candidate.id}:${month}`
    if (!shouldEmit(key)) continue

    const { data: checkins } = await supabase.from('mood_checkins')
      .select('mood').eq('tenant_id', tenantId).eq('employee_id', candidate.employee_id)
      .gte('checkin_date', threeMonthsAgo.toISOString().slice(0, 10))
    if (!checkins?.length || checkins.length < 3) continue

    const avg = (checkins as any[]).reduce((s: number, c: any) => s + Number(c.mood ?? 3), 0) / checkins.length
    if (avg > 2.5) continue  // not at risk

    // Set attrition_risk_flag
    await supabase.from('succession_candidates')
      .update({ attrition_risk_flag: true }).eq('id', candidate.id).eq('tenant_id', tenantId)

    await notifyHrAdmins(supabase, {
      tenantId, item_type: 'general', severity: 'warning',
      title:    `Succession Risk: candidate shows high attrition risk`,
      summary:  `Candidate ${candidate.employee_id} (succession plan ${candidate.plan_id}) has mood avg of ${avg.toFixed(1)}/5 over last 3 months — at risk of leaving.`,
      entity_type: 'succession_candidate', entity_id: candidate.id,
      action_route: '/admin/succession', action_label: 'View Succession Plans',
      metadata: { employee_id: candidate.employee_id, mood_avg: avg, plan_id: candidate.plan_id },
    })
  }
}

// ── Main scan orchestrator ─────────────────────────────────────────────────────

export async function runAllScans(supabase: SupabaseClient): Promise<void> {
  const tenantIds = await fetchTenantIds(supabase).catch(() => [] as string[])
  if (!tenantIds.length) return

  // F43: named alongside each scan so a rejection can be attributed to the
  // scan that threw — Promise.allSettled's result order matches this array's.
  const SCANS: [string, (supabase: SupabaseClient, tenantId: string) => Promise<void>][] = [
    ['scanRepeatedLate', scanRepeatedLate],
    ['scanBurnout', scanBurnout],
    ['scanStaffingShortages', scanStaffingShortages],
    ['scanPayrollBlockers', scanPayrollBlockers],
    ['scanAttendanceRisk', scanAttendanceRisk],
    ['scanComplianceDeadlines', scanComplianceDeadlines],
    ['scanLifecycleExpiry', scanLifecycleExpiry],
    ['scanExitIntentSurveys', scanExitIntentSurveys],
    ['scanAutoPolls', scanAutoPolls],
    ['scanMoodThemeAlerts', scanMoodThemeAlerts],
    ['scanBenefitsEnrolment', scanBenefitsEnrolment],
    ['scanNewJoinerPolicyAssignment', scanNewJoinerPolicyAssignment],
    ['scanOnboardingSurveys', scanOnboardingSurveys],
    ['scanPostAppraisalSurveys', scanPostAppraisalSurveys],
    ['scanPostTransferSurveys', scanPostTransferSurveys],
    ['scanSurveyNegativeClusters', scanSurveyNegativeClusters],
    ['scanOnboardingDegradation', scanOnboardingDegradation],
    ['scanSuccessionAttritionRisk', scanSuccessionAttritionRisk],
  ]

  for (const tenantId of tenantIds) {
    const results = await Promise.allSettled(SCANS.map(([, fn]) => fn(supabase, tenantId)))
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error({ tenantId, scan: SCANS[i][0], err: r.reason }, '[intelligence-scanner] scan failed')
      }
    })
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the intelligence scanner with the given Supabase client.
 * Call once at server startup, wrapped in safeRegisterModule.
 */
export function registerIntelligenceScanner(supabase: SupabaseClient): void {
  setTimeout(() => {
    const enqueue = () => {
      // 6-hour bucket: slice to 'YYYY-MM-DDTHH' then round to nearest 6h
      const now = new Date()
      const bucket = `${now.toISOString().slice(0, 10)}-${Math.floor(now.getUTCHours() / 6) * 6}`
      durableQueue.enqueue('intelligence-scan', {}, { idempotencyKey: `intelligence-scan:${bucket}` }).catch(
        e => logger.error({ err: e }, '[intelligence-scanner] enqueue error'),
      )
    }
    enqueue()
    setInterval(enqueue, SCAN_INTERVAL_MS)
    console.log(
      `🧠 Intelligence scanner active — scanning every ${SCAN_INTERVAL_MS / 3_600_000}h`,
    )
  }, WARMUP_MS)
}
