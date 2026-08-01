/**
 * HRMS Event Bus — central typed event infrastructure.
 *
 * All platform subsystems emit and subscribe through this bus.
 * Designed to be:
 *   - Failure-safe: emit() never throws, handler errors are caught + logged
 *   - Correlation-traced: every event carries a correlationId
 *   - Audit-integrated: events can be persisted to audit_logs
 *   - Async-safe: handlers run in the background (non-blocking)
 *
 * Usage:
 *   import { eventBus } from './event-bus.js'
 *
 *   // Emit
 *   eventBus.emit({
 *     type: 'leave.approved',
 *     payload: { tenantId, employeeId, leaveId, approverId, days: 3 },
 *   })
 *
 *   // Subscribe
 *   eventBus.on('leave.approved', async (event) => {
 *     await sendNotification(event.payload)
 *   })
 */

import { EventEmitter } from 'node:events'
import { randomUUID }  from 'node:crypto'
import type { Logger } from 'pino'

// ── Event catalog ─────────────────────────────────────────────────────────────

export interface HrmsEventMap {
  // Attendance
  'attendance.recomputed': {
    tenantId:      string
    date:          string
    employeeCount: number
    runId:         string | null
    triggeredBy?:  string
  }
  'attendance.anomaly.detected': {
    tenantId:    string
    employeeId:  string
    date:        string
    anomalyType: string
    severity:    'low' | 'medium' | 'high'
  }
  'attendance.anomaly.resolved': {
    tenantId:    string
    employeeId:  string
    date:        string
    anomalyType: string
    anomalyId:   string
    resolvedBy:  string
  }
  'attendance.processing.started': {
    tenantId:    string
    date:        string
    startedBy:   string
    runId?:      string
  }
  'attendance.processing.completed': {
    tenantId:      string
    date:          string
    runId:         string
    processedCount: number
    skippedCount:  number
    durationMs:    number
  }
  'attendance.processing.failed': {
    tenantId:     string
    date:         string
    runId:        string | null
    errorMessage: string
  }

  // Leave
  'leave.applied': {
    tenantId:      string
    employeeId:    string
    leaveId:       string
    leaveTypeId:   string
    fromDate:      string
    toDate:        string
    days:          number
  }
  'leave.approved': {
    tenantId:     string
    employeeId:   string
    leaveId:      string
    approverId:   string
    leaveTypeId:  string
    fromDate:     string
    toDate:       string
    days:         number
    balanceAfter?: number
  }
  'leave.rejected': {
    tenantId:    string
    employeeId:  string
    leaveId:     string
    approverId:  string
    reason?:     string
  }
  'leave.balance.low': {
    tenantId:      string
    employeeId:    string
    leaveTypeId:   string
    currentBalance: number
    threshold:     number
  }

  // Corrections / Regularisation
  'correction.submitted': {
    tenantId:    string
    employeeId:  string
    correctionId: string
    date:        string
  }
  'correction.approved': {
    tenantId:     string
    employeeId:   string
    correctionId: string
    approverId:   string
    date:         string
  }
  'correction.rejected': {
    tenantId:     string
    employeeId:   string
    correctionId: string
    approverId:   string
    reason?:      string
  }

  // Payroll
  'payroll.run.started': {
    tenantId:  string
    runId:     string
    month:     string
    startedBy: string
  }
  'payroll.run.completed': {
    tenantId:       string
    runId:          string
    month:          string
    employeeCount:  number
    totalGross:     number
  }
  'payroll.run.failed': {
    tenantId:     string
    runId:        string
    errorMessage: string
  }
  'payroll.blocked': {
    tenantId:       string
    runId:          string
    blockerType:    string
    affectedCount:  number
    reason:         string
  }

  // Roster
  'roster.updated': {
    tenantId:          string
    month:             string
    affectedEmployees: number
    updatedBy:         string
  }
  'roster.coverage.gap': {
    tenantId:    string
    date:        string
    shiftId:     string
    gapType:     'understaffed' | 'uncovered'
    severity:    'low' | 'medium' | 'high'
  }

  // Policy
  'policy.changed': {
    tenantId:  string
    policyId:  string
    changeType: 'created' | 'updated' | 'archived'
    changedBy: string
  }
  'policy.applied': {
    tenantId:   string
    policyId:   string
    employeeId: string
    context:    string
  }

  // SLA / Escalations
  'sla.breached': {
    tenantId:    string
    entityType:  'leave' | 'correction' | 'approval'
    entityId:    string
    slaHours:    number
    elapsedHours: number
    escalateTo?: string
  }

  // Notifications
  'notification.sent': {
    tenantId:    string
    recipientId: string
    channel:     string
    type:        string
  }
  'notification.failed': {
    tenantId:    string
    recipientId: string
    channel:     string
    error:       string
  }

  // ── Phase 4 — Operational Intelligence Events ─────────────────────────────

  /** Attendance risk pattern detected for an employee (repeated late, high absences, etc.) */
  'attendance.risk.detected': {
    tenantId:    string
    employeeId:  string
    riskType:    'repeated_late' | 'high_absence' | 'no_punch_streak' | 'excessive_hours'
    riskScore:   number             // 0–100
    period:      string             // e.g. "2025-04"
    detail:      string             // human-readable explanation
  }

  /** Staffing shortage detected for a shift/department on a date */
  'staffing.shortage.detected': {
    tenantId:    string
    date:        string
    shiftId?:    string
    departmentId?: string
    required:    number             // headcount needed
    available:   number             // headcount present
    severity:    'low' | 'medium' | 'high'
  }

  /** Payroll variance exceeds configured threshold */
  'payroll.variance.detected': {
    tenantId:       string
    runId:          string
    employeeId:     string
    month:          string
    netPayDiff:     number          // absolute difference in currency
    netPayPct:      number          // percentage change
    varianceReason: string
  }

  /** Burnout risk detected (OT streak, no weekly off, high hours) */
  'burnout.risk.detected': {
    tenantId:    string
    employeeId:  string
    period:      string
    otHours:     number
    consecutiveDays: number
    riskLevel:   'medium' | 'high' | 'critical'
  }

  /** Roster imbalance detected for a department/shift */
  'roster.imbalance.detected': {
    tenantId:      string
    month:         string
    shiftId?:      string
    departmentId?: string
    imbalanceType: 'weekend_overload' | 'night_shift_skew' | 'single_employee_dependency'
    affectedCount: number
  }

  /** Payroll blocker detected for an employee for an upcoming run */
  'payroll.blocker.detected': {
    tenantId:    string
    employeeId:  string
    month:       string
    blockerType: 'no_compensation' | 'no_attendance' | 'open_anomaly' | 'pending_correction'
    detail:      string
  }

  /** Repeated late arrival pattern detected */
  'repeated.late.pattern.detected': {
    tenantId:    string
    employeeId:  string
    period:      string
    lateCount:   number
    avgLateMins: number
    pattern:     'weekly' | 'monday_only' | 'daily' | 'sporadic'
  }

  // ── Phase 10 — Compensation Intelligence Events ───────────────────────────

  /**
   * Compensation revision approved and applied to the employee record.
   * Triggers: forecast refresh, payroll variance linkage, ledger entry.
   */
  'compensation.revised': {
    tenantId:       string
    employeeId:     string
    revisionId:     string
    revisionType:   'increment' | 'promotion' | 'revision' | 'correction' | 'restructure' | 'retro'
    effectiveDate:  string
    beforeCtcAnnual: number | null
    afterCtcAnnual:  number
    deltaPct:        number | null
    approvedBy:      string
  }

  /**
   * Compensation revision rejected — no change applied to the employee record.
   */
  'compensation.rejected': {
    tenantId:    string
    employeeId:  string
    revisionId:  string
    rejectedBy:  string
    reason?:     string
  }

  /**
   * Month-over-month payroll volatility exceeds threshold for an employee.
   * Threshold: |net_pay_change| / prior_net_pay > 0.10 (10%).
   */
  'payroll.volatility.detected': {
    tenantId:       string
    employeeId:     string
    month:          string
    priorMonth:     string
    priorNetPay:    number
    currentNetPay:  number
    volatilityPct:  number   // absolute percentage change
    reason:         string   // human-readable explanation
  }

  /**
   * Compensation risk detected: an employee has no active compensation,
   * or their compensation is about to expire with no renewal.
   */
  'compensation.risk.detected': {
    tenantId:    string
    employeeId:  string
    riskType:    'no_active_compensation' | 'expiring_compensation' | 'missing_structure'
    detail:      string
    daysUntilImpact: number   // 0 = already impacting, N = days until next payroll
  }

  /**
   * Department or team is accumulating abnormal overtime costs.
   * Threshold: OT cost > 15% of total gross for the month.
   */
  'abnormal.ot.cost.detected': {
    tenantId:      string
    departmentId:  string | null
    month:         string
    totalGross:    number
    otCost:        number
    otPct:         number    // otCost / totalGross * 100
    severity:      'medium' | 'high'
    affectedCount: number    // employees with OT
  }

  /**
   * Payroll forecast has materially changed vs the previously generated forecast.
   * Emitted when auto-regeneration detects a > 5% shift.
   */
  'payroll.forecast.changed': {
    tenantId:       string
    targetMonth:    string
    priorForecast:  number
    newForecast:    number
    changePct:      number
    triggerReason:  string   // e.g. 'compensation_revision', 'headcount_change', 'ot_trend'
  }

  /**
   * Payroll variance between consecutive months exceeds enterprise threshold.
   * Threshold: dept-level gross variance > 15% vs prior month.
   */
  'excessive.payroll.variance.detected': {
    tenantId:       string
    month:          string
    departmentId:   string | null
    departmentName: string
    priorGross:     number
    currentGross:   number
    variancePct:    number
    severity:       'medium' | 'high' | 'critical'
  }

  // ── Phase 11 — Attendance Exception & Confidence Intelligence ─────────────

  /** A new structured exception was created for an attendance record */
  'attendance.exception.created': {
    tenantId:         string
    employeeId:       string
    date:             string
    exceptionType:    string
    category:         string
    severity:         'low' | 'medium' | 'high' | 'critical'
    payrollImpacting: boolean
    slaHours:         number
  }

  /** An exception SLA has been breached */
  'attendance.exception.sla.breached': {
    tenantId:      string
    exceptionId:   string
    employeeId:    string
    date:          string
    exceptionType: string
    severity:      'low' | 'medium' | 'high' | 'critical'
    hoursOverdue:  number
  }

  /** Attendance confidence score drops to low/critical */
  'attendance.confidence.critical': {
    tenantId:        string
    employeeId:      string
    date:            string
    confidenceScore: number    // 0-100
    confidenceLevel: 'low' | 'critical'
    topFactors:      string[]  // human-readable factor names
  }

  /** Retroactive attendance change detected — triggers re-propagation */
  'attendance.retroactive.impact': {
    tenantId:      string
    employeeId:    string
    affectedDate:  string
    triggerSource: string
    impactTypes:   string[]
    payrollImpact: boolean
  }

  /** Employee attendance risk level elevated */
  'attendance.risk.elevated': {
    tenantId:   string
    employeeId: string
    riskLevel:  'medium' | 'high' | 'critical'
    riskScore:  number
    topFactors: string[]
    period:     string  // 'YYYY-MM-DD:YYYY-MM-DD'
  }

  /** Attendance inference recorded — confidence penalty applied */
  'attendance.inference.created': {
    tenantId:          string
    employeeId:        string
    date:              string
    inferenceType:     string
    confidencePenalty: number
    explanation:       string
  }

  // ── Separation Lifecycle Events ───────────────────────────────────────────

  /** Separation request approved by HR — moves to notice period */
  'separation.approved': {
    tenantId:     string
    employeeId:   string
    separationId: string
    approvedBy:   string
  }

  /** Separation lifecycle stage advanced */
  'separation.stage.changed': {
    tenantId:     string
    employeeId:   string
    separationId: string
    fromStage:    string
    toStage:      string
  }

  /** Employee relieved — clearance + F&F complete */
  'separation.relieved': {
    tenantId:        string
    employeeId:      string
    separationId:    string
    lastWorkingDate: string | null
  }

  /** Separation record archived */
  'separation.archived': {
    tenantId:     string
    employeeId:   string
    separationId: string
  }

  // ── Asset Management Events ───────────────────────────────────────────────

  /** Asset assigned to an employee */
  'asset.assigned': {
    tenantId:   string
    assetId:    string
    employeeId: string
    assetCode:  string
  }

  /** Asset returned by an employee (or marked damaged/lost on return) */
  'asset.returned': {
    tenantId:   string
    assetId:    string
    employeeId: string
    condition:  string
  }

  /** Policy conflict detected during attendance processing */
  'policy.conflict.detected': {
    tenantId:          string
    employeeId:        string
    date:              string
    conflictType:      string
    severity:          'low' | 'medium' | 'high'
    payrollImpacting:  boolean
    appliedPrecedence: string
  }

  // ── Onboarding Lifecycle Events (Phase O1) ────────────────────────────────

  /** New onboarding session created by HR */
  'onboarding.session.created': {
    tenantId:       string
    sessionId:      string
    candidateName?: string
    createdBy:      string
  }

  /** A document was uploaded to an onboarding session */
  'onboarding.document.uploaded': {
    tenantId:     string
    sessionId:    string
    documentId:   string
    documentType: string
    uploadedBy:   string
  }

  /** A document passed identity/extraction and is verified */
  'onboarding.document.verified': {
    tenantId:     string
    sessionId:    string
    documentId:   string
    documentType: string
  }

  /** A document was rejected (identity mismatch / extraction failure) */
  'onboarding.document.rejected': {
    tenantId:     string
    sessionId:    string
    documentId:   string
    documentType: string
    reason:       string
  }

  /** AI extraction complete — draft profile ready for HR review */
  'onboarding.session.extraction_complete': {
    tenantId:  string
    sessionId: string
    draftId:   string
    docCount:  number
  }

  /** HR approved the draft — employee record created */
  'onboarding.session.approved': {
    tenantId:      string
    sessionId:     string
    draftId:       string
    employeeId:    string
    employeeCode:  string
    approvedBy:    string
    exceptionPass: boolean
  }

  /** HR rejected the draft — onboarding will not proceed */
  'onboarding.session.rejected': {
    tenantId:   string
    sessionId:  string
    draftId:    string
    rejectedBy: string
    reason:     string
  }

  /** Joining finalised — the employee record (joining) is created and ready */
  'onboarding.joining.completed': {
    tenantId:     string
    sessionId:    string
    employeeId:   string
    employeeCode: string
    joiningDate:  string | null
  }

  /** All mandatory onboarding checklist tasks completed */
  'onboarding.checklist.completed': {
    tenantId:    string
    employeeId:  string
    checklistId: string
  }

  // ── Trust events ─────────────────────────────────────────────────────────────

  /** Trust score (re)computed for an employee or onboarding session */
  'trust.score.computed': {
    tenantId:   string
    entityId:   string          // employee UUID or session UUID
    entityType: 'employee' | 'onboarding_session'
    score:      number          // 0–100
    severity:   'low' | 'medium' | 'high' | 'critical'
    factorCount: number
  }

  /** Identity / document / bank verification succeeded */
  'trust.verification.completed': {
    tenantId:         string
    entityId:         string
    entityType:       string
    verificationType: string    // 'pan' | 'aadhaar' | 'bank_account' | etc.
    score:            number
    flags:            string[]
  }

  /** Identity / document / bank verification failed or came back inconclusive */
  'trust.verification.failed': {
    tenantId:         string
    entityId:         string
    entityType:       string
    verificationType: string
    status:           string    // 'failed' | 'inconclusive'
    flags:            string[]
  }

  /** A risk signal was raised against an employee */
  'trust.risk.raised': {
    tenantId:   string
    entityId:   string
    entityType: string
    riskType:   string          // e.g. 'duplicate_pan', 'name_mismatch'
    severity:   'low' | 'medium' | 'high' | 'critical'
    detail?:    string
  }

  /** A previously raised risk signal has been cleared / resolved */
  'trust.risk.cleared': {
    tenantId:   string
    entityId:   string
    entityType: string
    riskType:   string
    clearedBy:  string          // user ID who cleared it
    reason?:    string
  }

  /** Duplicate identity value detected across two or more employees */
  'trust.duplicate.detected': {
    tenantId:           string
    entityId:           string
    duplicateType:      string   // 'pan' | 'bank_account' | 'phone' | etc.
    matchingEntityIds:  string[]
    severity:           'low' | 'medium' | 'high' | 'critical'
    valueHash:          string   // SHA-256 of the duplicated value (no PII)
  }
}

export type HrmsEventType = keyof HrmsEventMap

// ── Wrapped event (adds metadata to every emission) ───────────────────────────

export interface HrmsEvent<T extends HrmsEventType = HrmsEventType> {
  id:            string        // unique event UUID
  type:          T
  payload:       HrmsEventMap[T]
  correlationId: string        // request trace ID (if available)
  timestamp:     string        // ISO-8601
  tenantId:      string        // always present for tenant isolation
}

// ── Subscriber types ──────────────────────────────────────────────────────────

export type EventHandler<T extends HrmsEventType> = (
  event: HrmsEvent<T>,
) => void | Promise<void>

// ── EventBus ──────────────────────────────────────────────────────────────────

class HrmsEventBus {
  private readonly emitter = new EventEmitter()
  private log: Logger | null = null
  private metrics: Map<HrmsEventType, { emitted: number; failed: number }> = new Map()

  setLogger(logger: Logger) {
    this.log = logger
  }

  /**
   * Emit an event. Never throws — handler errors are caught and logged.
   * The correlationId should be forwarded from req.correlationId when available.
   */
  emit<T extends HrmsEventType>(
    event: Omit<HrmsEvent<T>, 'id' | 'timestamp'> & { correlationId?: string },
  ): void {
    const fullEvent: HrmsEvent<T> = {
      ...event,
      id:            randomUUID(),
      timestamp:     new Date().toISOString(),
      correlationId: event.correlationId ?? 'internal',
    } as HrmsEvent<T>

    // Update metrics
    const m = this.metrics.get(event.type) ?? { emitted: 0, failed: 0 }
    m.emitted++
    this.metrics.set(event.type, m)

    this.log?.debug(
      { eventId: fullEvent.id, type: fullEvent.type, tenantId: fullEvent.tenantId },
      'event emitted',
    )

    // Run all handlers asynchronously — never block the caller
    setImmediate(() => {
      const handlers = this.emitter.listeners(event.type) as EventHandler<T>[]
      for (const handler of handlers) {
        Promise.resolve()
          .then(() => handler(fullEvent))
          .catch((err: Error) => {
            const m2 = this.metrics.get(event.type) ?? { emitted: 0, failed: 0 }
            m2.failed++
            this.metrics.set(event.type, m2)
            this.log?.error(
              { eventId: fullEvent.id, type: fullEvent.type, err: err.message },
              'event handler failed',
            )
          })
      }
    })
  }

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on<T extends HrmsEventType>(type: T, handler: EventHandler<T>): () => void {
    this.emitter.on(type, handler as (...args: unknown[]) => void)
    this.log?.debug({ type }, 'event handler registered')
    return () => this.emitter.off(type, handler as (...args: unknown[]) => void)
  }

  /**
   * Subscribe to multiple event types with a single handler.
   */
  onMany<T extends HrmsEventType>(types: T[], handler: EventHandler<T>): () => void {
    const unsubs = types.map(t => this.on(t, handler))
    return () => unsubs.forEach(u => u())
  }

  /**
   * Returns current emission metrics (for observability).
   */
  getMetrics(): Record<string, { emitted: number; failed: number }> {
    return Object.fromEntries(this.metrics)
  }

  /**
   * Returns total registered handler count (for health checks).
   */
  getHandlerCount(): number {
    return this.emitter.eventNames().reduce(
      (sum, name) => sum + this.emitter.listenerCount(name as string),
      0,
    )
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const eventBus = new HrmsEventBus()

// ── SLA escalation helper ─────────────────────────────────────────────────────

/**
 * Emit a sla.breached event when an entity has exceeded its SLA window.
 * Called by the SLA monitor job.
 */
export function emitSlaBreached(opts: {
  tenantId:     string
  entityType:   'leave' | 'correction' | 'approval'
  entityId:     string
  slaHours:     number
  elapsedHours: number
  escalateTo?:  string
  correlationId?: string
}) {
  eventBus.emit({
    type:          'sla.breached',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:     opts.tenantId,
      entityType:   opts.entityType,
      entityId:     opts.entityId,
      slaHours:     opts.slaHours,
      elapsedHours: opts.elapsedHours,
      escalateTo:   opts.escalateTo,
    },
  })
}
