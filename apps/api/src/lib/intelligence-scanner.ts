/**
 * Intelligence Scanner — Phase 7 Operational Automation
 *
 * Proactively scans the workforce every 6 hours and emits Phase 4
 * operational intelligence events so event-bus-automation subscribers
 * can write audit logs and notify HR managers.
 *
 * Five scan targets (each runs per-tenant, per-active-employee):
 *   1. Repeated late arrival patterns  → repeated.late.pattern.detected
 *   2. Burnout risk (OT + no weekly-off) → burnout.risk.detected
 *   3. Staffing shortages              → staffing.shortage.detected
 *   4. Payroll blockers (upcoming run) → payroll.blocker.detected
 *   5. Attendance risk score           → attendance.risk.detected
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
import { eventBus }           from './event-bus.js'
import { computeUpcoming }    from './compliance-calendar.js'
import { notifyHrAdmins }     from './notify.js'

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

const emittedKeys = new Set<string>()

function shouldEmit(key: string): boolean {
  if (emittedKeys.has(key)) return false
  emittedKeys.add(key)
  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function lookbackFrom(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS)
  return d.toISOString().slice(0, 10)
}

async function fetchTenantIds(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from('tenants').select('id')
  return (data ?? []).map((t: { id: string }) => t.id)
}

// ── Scanner 1 — Repeated Late Pattern ────────────────────────────────────────

async function scanRepeatedLate(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const from = lookbackFrom()
  const month = currentMonth()

  const { data: rows } = await supabase
    .from('attendance_daily')
    .select('employee_id, late_minutes')
    .eq('tenant_id', tenantId)
    .eq('status', 'late')
    .gte('date', from)

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
  const month = currentMonth()

  const { data: rows } = await supabase
    .from('attendance_daily')
    .select('employee_id, overtime_minutes, worked_on_weekly_off')
    .eq('tenant_id', tenantId)
    .gte('date', from)

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
  const { data: rosterRows } = await supabase
    .from('shift_roster')
    .select('date, shift_id, employee_id')
    .eq('tenant_id', tenantId)
    .gte('date', recentFromStr)

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
  const { data: presenceRows } = await supabase
    .from('attendance_daily')
    .select('date, employee_id, status')
    .eq('tenant_id', tenantId)
    .gte('date', recentFromStr)
    .in('status', ['present', 'late'])

  const present = new Map<string, Set<string>>()
  for (const r of presenceRows ?? []) {
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
  const month = currentMonth()

  // Get active employees without compensation records
  const { data: employees } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  if (!employees?.length) return

  const { data: compensations } = await supabase
    .from('employee_compensations')
    .select('employee_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  const compensatedIds = new Set((compensations ?? []).map((c: any) => c.employee_id))

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
  const month = currentMonth()

  const { data: rows } = await supabase
    .from('attendance_daily')
    .select('employee_id, status, late_minutes, work_hours')
    .eq('tenant_id', tenantId)
    .gte('date', from)

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

// ── Main scan orchestrator ─────────────────────────────────────────────────────

async function runAllScans(supabase: SupabaseClient): Promise<void> {
  const tenantIds = await fetchTenantIds(supabase).catch(() => [] as string[])
  if (!tenantIds.length) return

  for (const tenantId of tenantIds) {
    await Promise.allSettled([
      scanRepeatedLate(supabase, tenantId),
      scanBurnout(supabase, tenantId),
      scanStaffingShortages(supabase, tenantId),
      scanPayrollBlockers(supabase, tenantId),
      scanAttendanceRisk(supabase, tenantId),
      scanComplianceDeadlines(supabase, tenantId),
    ])
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the intelligence scanner with the given Supabase client.
 * Call once at server startup, wrapped in safeRegisterModule.
 */
export function registerIntelligenceScanner(supabase: SupabaseClient): void {
  setTimeout(() => {
    runAllScans(supabase).catch(e =>
      console.error('[intelligence-scanner] initial scan error:', (e as Error).message),
    )
    setInterval(
      () => runAllScans(supabase).catch(e =>
        console.error('[intelligence-scanner] scan error:', (e as Error).message),
      ),
      SCAN_INTERVAL_MS,
    )
    console.log(
      `🧠 Intelligence scanner active — scanning every ${SCAN_INTERVAL_MS / 3_600_000}h`,
    )
  }, WARMUP_MS)
}
