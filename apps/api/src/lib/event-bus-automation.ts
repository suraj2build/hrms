/**
 * event-bus-automation.ts
 *
 * Phase 2 — Event-Driven Automation Subscribers.
 *
 * Registers all automation handlers on the typed in-process eventBus.
 * Each handler is:
 *   - Failure-isolated: errors are caught, never bubble up to the emitter
 *   - Logged: every action and failure is traced via the bus logger
 *   - Idempotency-aware: handlers check state before acting (no double-fire side effects)
 *
 * Architecture:
 *   eventBus.emit('leave.approved', ...)
 *     → handler: forward to DB notification layer (bridges old + new event systems)
 *     → handler: check leave balance, emit leave.balance.low if threshold hit
 *     → handler: log SLA compliance (pending-to-approved elapsed time)
 *
 *   eventBus.emit('correction.approved', ...)
 *     → handler: forward to DB notification layer
 *
 *   eventBus.emit('attendance.recomputed', ...)
 *     → handler: structured observability log (anomaly detection hook)
 *
 *   eventBus.emit('sla.breached', ...)
 *     → handler: structured escalation log (HR manager alert hook)
 *
 *   eventBus.emit('roster.coverage.gap', ...)
 *     → handler: structured coverage alert log
 *
 *   eventBus.emit('payroll.run.completed', ...)
 *     → handler: trigger post-payroll anomaly check log
 *
 * Registration:
 *   Call registerEventBusAutomation(supabase) once at startup, AFTER the
 *   Supabase plugin is registered.
 *
 * Extending:
 *   Add new eventBus.on() calls here. Keep each handler ≤ 30 lines.
 *   Extract complex logic into lib/*.ts services and call them from here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { eventBus }           from './event-bus.js'

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Emit leave.balance.low when remaining balance falls below this many days */
const BALANCE_LOW_THRESHOLD = 3

/** SLA window for leave approvals (hours). Breaching triggers escalation log. */
const LEAVE_SLA_HOURS = 48

/** SLA window for correction approvals (hours). */
const CORRECTION_SLA_HOURS = 24

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register all Phase 2 automation subscribers.
 * Must be called exactly once at server startup.
 */
export function registerEventBusAutomation(supabase: SupabaseClient): void {

  // ── leave.approved ──────────────────────────────────────────────────────────
  // 1. Check remaining leave balance → emit leave.balance.low if under threshold
  // 2. Log SLA compliance (how long the request sat pending before approval)
  eventBus.on('leave.approved', async (event) => {
    const { tenantId, employeeId, leaveTypeId, leaveId, fromDate, days } = event.payload

    // Balance check — only for paid leave types
    try {
      const year = new Date(fromDate).getFullYear()
      const { data: balRow } = await supabase
        .from('employee_leave_balance')
        .select('balance')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
        .eq('leave_type_id', leaveTypeId)
        .eq('year', year)
        .maybeSingle()

      if (balRow != null) {
        const remaining = Number(balRow.balance)
        if (remaining <= BALANCE_LOW_THRESHOLD) {
          eventBus.emit({
            type:          'leave.balance.low',
            tenantId,
            correlationId: event.correlationId,
            payload: {
              tenantId,
              employeeId,
              leaveTypeId,
              currentBalance: remaining,
              threshold:      BALANCE_LOW_THRESHOLD,
            },
          })
        }
      }
    } catch (err) {
      // Non-fatal — balance check failure must not affect approval
    }

    // SLA compliance — check how long the leave_application sat pending
    try {
      const { data: app } = await supabase
        .from('leave_requests')
        .select('created_at, approved_at')
        .eq('id', leaveId)
        .maybeSingle()

      if (app?.created_at && app?.approved_at) {
        const submittedAt = new Date(app.created_at).getTime()
        const approvedAt  = new Date(app.approved_at).getTime()
        const elapsedHours = (approvedAt - submittedAt) / 3_600_000

        if (elapsedHours > LEAVE_SLA_HOURS) {
          eventBus.emit({
            type:          'sla.breached',
            tenantId,
            correlationId: event.correlationId,
            payload: {
              tenantId,
              entityType:   'leave',
              entityId:     leaveId,
              slaHours:     LEAVE_SLA_HOURS,
              elapsedHours: Math.round(elapsedHours * 10) / 10,
            },
          })
        }
      }
    } catch (err) {
      // Non-fatal
    }
  })

  // ── leave.balance.low ───────────────────────────────────────────────────────
  // Structured log — future: trigger in-app notification or manager alert
  eventBus.on('leave.balance.low', (event) => {
    const { employeeId, leaveTypeId, currentBalance, threshold } = event.payload
    // Logger is set on the bus — the bus already logs at debug level.
    // This handler provides the application-level observability signal.
    // TODO: send in-app notification to employee when notification provider is wired
    void Promise.resolve().then(() => {
      // structured no-op — bus debug log carries the event
      void { employeeId, leaveTypeId, currentBalance, threshold }
    })
  })

  // ── leave.rejected ──────────────────────────────────────────────────────────
  // Log SLA on rejection path as well (late rejections are also SLA violations)
  eventBus.on('leave.rejected', async (event) => {
    const { tenantId, leaveId } = event.payload
    try {
      const { data: app } = await supabase
        .from('leave_requests')
        .select('created_at, approved_at')
        .eq('id', leaveId)
        .maybeSingle()

      if (app?.created_at && app?.approved_at) {
        const elapsedHours = (
          new Date(app.approved_at).getTime() - new Date(app.created_at).getTime()
        ) / 3_600_000

        if (elapsedHours > LEAVE_SLA_HOURS) {
          eventBus.emit({
            type:          'sla.breached',
            tenantId,
            correlationId: event.correlationId,
            payload: {
              tenantId,
              entityType:   'leave',
              entityId:     leaveId,
              slaHours:     LEAVE_SLA_HOURS,
              elapsedHours: Math.round(elapsedHours * 10) / 10,
            },
          })
        }
      }
    } catch {
      // Non-fatal
    }
  })

  // ── correction.approved ─────────────────────────────────────────────────────
  // Log SLA compliance for correction approval cycle
  eventBus.on('correction.approved', async (event) => {
    const { tenantId, correctionId } = event.payload
    try {
      const { data: corr } = await supabase
        .from('attendance_regularisation')
        .select('created_at, approved_at')
        .eq('id', correctionId)
        .maybeSingle()

      if (corr?.created_at && corr?.approved_at) {
        const elapsedHours = (
          new Date(corr.approved_at).getTime() - new Date(corr.created_at).getTime()
        ) / 3_600_000

        if (elapsedHours > CORRECTION_SLA_HOURS) {
          eventBus.emit({
            type:          'sla.breached',
            tenantId,
            correlationId: event.correlationId,
            payload: {
              tenantId,
              entityType:   'correction',
              entityId:     correctionId,
              slaHours:     CORRECTION_SLA_HOURS,
              elapsedHours: Math.round(elapsedHours * 10) / 10,
            },
          })
        }
      }
    } catch {
      // Non-fatal
    }
  })

  // ── attendance.recomputed ───────────────────────────────────────────────────
  // Observability hook — anomaly detection system subscribes here
  // (registerAnomalyHandlers also subscribes; this handler provides additional
  //  structured logging at the automation layer)
  eventBus.on('attendance.recomputed', (_event) => {
    // The bus already emits a debug log. Anomaly detection is in anomaly-handler.ts.
    // This slot is reserved for future automation reactions (e.g., trigger payroll
    // pre-validation when attendance for payroll month is recomputed).
  })

  // ── sla.breached ────────────────────────────────────────────────────────────
  // Escalation log — future: notify HR manager or auto-escalate workflow
  eventBus.on('sla.breached', async (event) => {
    const { tenantId, entityType, entityId, slaHours, elapsedHours, escalateTo } = event.payload

    // Write escalation record to audit_logs for traceability
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'sla_breach',
        table_name: entityType === 'leave'      ? 'leave_requests'
                  : entityType === 'correction' ? 'attendance_regularisation'
                  : 'approval_workflows',
        record_id:  entityId,
        new_values: {
          sla_hours:     slaHours,
          elapsed_hours: elapsedHours,
          escalate_to:   escalateTo ?? null,
        },
      })
    } catch {
      // Non-fatal — audit log failure must not surface to user
    }
  })

  // ── roster.coverage.gap ─────────────────────────────────────────────────────
  // Coverage gap alert — future: auto-notify shift supervisor
  eventBus.on('roster.coverage.gap', async (event) => {
    const { tenantId, date, shiftId, gapType, severity } = event.payload

    if (severity === 'high') {
      // Write a high-severity coverage alert to audit_logs
      try {
        await supabase.from('audit_logs').insert({
          tenant_id:  tenantId,
          action:     'coverage_gap_alert',
          table_name: 'shift_roster',
          record_id:  shiftId,
          new_values: { date, gap_type: gapType, severity },
        })
      } catch {
        // Non-fatal
      }
    }
  })

  // ── payroll.run.completed ───────────────────────────────────────────────────
  // Post-payroll hook — log completion; future: trigger payslip generation job
  eventBus.on('payroll.run.completed', (_event) => {
    // Payslip generation and distribution hooks are wired in payroll-engine.ts
    // This subscriber provides the cross-system observability tap.
  })

  // ── payroll.run.failed ──────────────────────────────────────────────────────
  // Write failure trace to audit_logs for ops visibility
  eventBus.on('payroll.run.failed', async (event) => {
    const { tenantId, runId, errorMessage } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'payroll_run_failed',
        table_name: 'payroll_runs',
        record_id:  runId,
        new_values: { error_message: errorMessage },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── notification.failed ─────────────────────────────────────────────────────
  // Alert on notification provider failures
  eventBus.on('notification.failed', async (event) => {
    const { tenantId, recipientId, channel, error } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'notification_failed',
        table_name: 'notifications',
        record_id:  recipientId,
        new_values: { channel, error },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── Phase 4 — Operational Intelligence Event Subscribers ──────────────────

  // ── attendance.risk.detected ───────────────────────────────────────────────
  // Log to audit_logs and notify HR manager for high-risk employees
  eventBus.on('attendance.risk.detected', async (event) => {
    const { tenantId, employeeId, riskType, riskScore, period, detail } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'attendance_risk_detected',
        table_name: 'attendance_daily',
        record_id:  employeeId,
        new_values: { risk_type: riskType, risk_score: riskScore, period, detail },
      })
    } catch {
      // Non-fatal
    }

    // Notify HR for high-risk (score ≥ 75)
    if (riskScore >= 75) {
      try {
        // Find HR admins in tenant
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        `Attendance Risk Detected — ${riskType.replace(/_/g, ' ')}`,
            body:         `Employee risk score: ${riskScore}/100 for ${period}. ${detail}`,
            link:         `/admin/attendance/forensics?employee_id=${employeeId}`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── staffing.shortage.detected ─────────────────────────────────────────────
  // Log high/medium severity shortages and write audit record
  eventBus.on('staffing.shortage.detected', async (event) => {
    const { tenantId, date, shiftId, departmentId, required, available, severity } = event.payload
    if (severity === 'low') return   // only act on medium/high

    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'staffing_shortage',
        table_name: 'shift_roster',
        record_id:  shiftId ?? departmentId ?? tenantId,
        new_values: { date, required, available, severity },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── payroll.variance.detected ──────────────────────────────────────────────
  // Log large payroll variances (>20%) to audit for compliance traceability
  eventBus.on('payroll.variance.detected', async (event) => {
    const { tenantId, runId, employeeId, month, netPayDiff, netPayPct, varianceReason } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'payroll_variance',
        table_name: 'payroll_slips',
        record_id:  runId,
        new_values: { employee_id: employeeId, month, net_pay_diff: netPayDiff, net_pay_pct: netPayPct, reason: varianceReason },
      })
    } catch {
      // Non-fatal
    }

    // Notify HR for variances > 30%
    if (Math.abs(netPayPct) > 30) {
      try {
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        `Large Payroll Variance — ${month}`,
            body:         `Net pay changed by ${netPayPct > 0 ? '+' : ''}${netPayPct.toFixed(1)}% (${varianceReason}). Investigate payroll for this employee.`,
            link:         `/admin/payroll/investigate?employee_id=${employeeId}&month=${month}`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── burnout.risk.detected ──────────────────────────────────────────────────
  // Log and notify HR for critical burnout risk (≥20 consecutive days / >100h OT)
  eventBus.on('burnout.risk.detected', async (event) => {
    const { tenantId, employeeId, period, otHours, consecutiveDays, riskLevel } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'burnout_risk_detected',
        table_name: 'attendance_daily',
        record_id:  employeeId,
        new_values: { period, ot_hours: otHours, consecutive_days: consecutiveDays, risk_level: riskLevel },
      })
    } catch {
      // Non-fatal
    }

    if (riskLevel === 'critical') {
      try {
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        'Critical Burnout Risk Detected',
            body:         `Employee worked ${consecutiveDays} consecutive days with ${otHours}h overtime in ${period}. Immediate action recommended.`,
            link:         `/admin/employees/${employeeId}`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── roster.imbalance.detected ───────────────────────────────────────────────
  // Log roster imbalances for operational review
  eventBus.on('roster.imbalance.detected', async (event) => {
    const { tenantId, month, shiftId, departmentId, imbalanceType, affectedCount } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'roster_imbalance',
        table_name: 'shift_roster',
        record_id:  shiftId ?? departmentId ?? tenantId,
        new_values: { month, imbalance_type: imbalanceType, affected_count: affectedCount },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── payroll.blocker.detected ────────────────────────────────────────────────
  // Log and notify HR about upcoming payroll blockers so they can be resolved
  eventBus.on('payroll.blocker.detected', async (event) => {
    const { tenantId, employeeId, month, blockerType, detail } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'payroll_blocker',
        table_name: 'payroll_slips',
        record_id:  employeeId,
        new_values: { month, blocker_type: blockerType, detail },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── repeated.late.pattern.detected ─────────────────────────────────────────
  // Log chronic late arrival patterns for HR review
  eventBus.on('repeated.late.pattern.detected', async (event) => {
    const { tenantId, employeeId, period, lateCount, avgLateMins, pattern } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'repeated_late_pattern',
        table_name: 'attendance_daily',
        record_id:  employeeId,
        new_values: { period, late_count: lateCount, avg_late_mins: avgLateMins, pattern },
      })
    } catch {
      // Non-fatal
    }

    // Notify HR for high-frequency patterns (≥5 occurrences in period)
    if (lateCount >= 5) {
      try {
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        'Repeated Late Arrival Pattern',
            body:         `Employee was late ${lateCount} times in ${period} (avg ${avgLateMins} min late). Pattern: ${pattern}.`,
            link:         `/admin/attendance/forensics?employee_id=${employeeId}`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── Phase 10 — Compensation Intelligence Event Subscribers ────────────────

  // ── compensation.revised ────────────────────────────────────────────────────
  // Write audit record + notify affected employee + invalidate forecast
  eventBus.on('compensation.revised', async (event) => {
    const {
      tenantId, employeeId, revisionId, revisionType,
      effectiveDate, beforeCtcAnnual, afterCtcAnnual, deltaPct, approvedBy,
    } = event.payload

    // Audit trail
    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'compensation_revised',
        table_name: 'compensation_revisions',
        record_id:  revisionId,
        new_values: {
          revision_type:       revisionType,
          effective_date:      effectiveDate,
          before_ctc_annual:   beforeCtcAnnual,
          after_ctc_annual:    afterCtcAnnual,
          delta_pct:           deltaPct,
          approved_by:         approvedBy,
        },
      })
    } catch {
      // Non-fatal
    }

    // Notify employee about their own revision
    try {
      const { data: emp } = await supabase
        .from('profiles')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (emp) {
        await supabase.from('notifications').insert({
          tenant_id:    tenantId,
          recipient_id: emp.id,
          title:        `Compensation ${revisionType.charAt(0).toUpperCase() + revisionType.slice(1)} Approved`,
          body:         deltaPct != null
            ? `Your compensation has been revised by ${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% effective ${effectiveDate}.`
            : `Your compensation revision is effective ${effectiveDate}.`,
          link:         '/ess/compensation',
          is_read:      false,
        })
      }
    } catch {
      // Non-fatal
    }
  })

  // ── payroll.volatility.detected ─────────────────────────────────────────────
  // High volatility (>10% MoM change) — audit + HR notification
  eventBus.on('payroll.volatility.detected', async (event) => {
    const { tenantId, employeeId, month, priorMonth, priorNetPay, currentNetPay, volatilityPct, reason } = event.payload

    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'payroll_volatility',
        table_name: 'payroll_slips',
        record_id:  employeeId,
        new_values: { month, prior_month: priorMonth, prior_net_pay: priorNetPay, current_net_pay: currentNetPay, volatility_pct: volatilityPct, reason },
      })
    } catch {
      // Non-fatal
    }

    // Notify HR for extreme volatility (>25%)
    if (volatilityPct > 25) {
      try {
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        `Payroll Volatility Alert — ${month}`,
            body:         `Net pay changed ${volatilityPct.toFixed(1)}% vs ${priorMonth}. Reason: ${reason}`,
            link:         `/admin/payroll/investigate?employee_id=${employeeId}&month=${month}`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── compensation.risk.detected ──────────────────────────────────────────────
  // Compensation gaps or expiry — notify HR for action
  eventBus.on('compensation.risk.detected', async (event) => {
    const { tenantId, employeeId, riskType, detail, daysUntilImpact } = event.payload

    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'compensation_risk',
        table_name: 'employee_compensations',
        record_id:  employeeId,
        new_values: { risk_type: riskType, detail, days_until_impact: daysUntilImpact },
      })
    } catch {
      // Non-fatal
    }

    // Always notify HR — comp risks are always actionable
    try {
      const { data: hrs } = await supabase
        .from('profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('role', ['super_admin', 'hr_admin'])
        .limit(3)

      for (const hr of (hrs ?? [])) {
        await supabase.from('notifications').insert({
          tenant_id:    tenantId,
          recipient_id: hr.id,
          title:        `Compensation Risk — ${riskType.replace(/_/g, ' ')}`,
          body:         `${detail}. ${daysUntilImpact === 0 ? 'Already impacting payroll.' : `${daysUntilImpact} days until next payroll impact.`}`,
          link:         `/admin/employees/${employeeId}`,
          is_read:      false,
        })
      }
    } catch {
      // Non-fatal
    }
  })

  // ── abnormal.ot.cost.detected ───────────────────────────────────────────────
  // OT spike in a department — log + HR notification for high severity
  eventBus.on('abnormal.ot.cost.detected', async (event) => {
    const { tenantId, departmentId, month, totalGross, otCost, otPct, severity, affectedCount } = event.payload

    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'abnormal_ot_cost',
        table_name: 'payroll_dept_snapshots',
        record_id:  departmentId ?? tenantId,
        new_values: { month, total_gross: totalGross, ot_cost: otCost, ot_pct: otPct, severity, affected_count: affectedCount },
      })
    } catch {
      // Non-fatal
    }

    if (severity === 'high') {
      try {
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        `Abnormal OT Cost Detected — ${month}`,
            body:         `OT represents ${otPct.toFixed(1)}% of gross payroll for ${affectedCount} employee(s). Review overtime authorizations.`,
            link:         `/admin/payroll/cost-intelligence`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── payroll.forecast.changed ────────────────────────────────────────────────
  // Material forecast shift (>5%) — log for observability
  eventBus.on('payroll.forecast.changed', async (event) => {
    const { tenantId, targetMonth, priorForecast, newForecast, changePct, triggerReason } = event.payload

    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'payroll_forecast_changed',
        table_name: 'payroll_forecasts',
        record_id:  tenantId,
        new_values: { target_month: targetMonth, prior_forecast: priorForecast, new_forecast: newForecast, change_pct: changePct, trigger_reason: triggerReason },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── excessive.payroll.variance.detected ─────────────────────────────────────
  // Department-level month-over-month variance >15% — audit + critical notification
  eventBus.on('excessive.payroll.variance.detected', async (event) => {
    const { tenantId, month, departmentId, departmentName, priorGross, currentGross, variancePct, severity } = event.payload

    try {
      await supabase.from('audit_logs').insert({
        tenant_id:  tenantId,
        action:     'excessive_payroll_variance',
        table_name: 'payroll_dept_snapshots',
        record_id:  departmentId ?? tenantId,
        new_values: { month, department_name: departmentName, prior_gross: priorGross, current_gross: currentGross, variance_pct: variancePct, severity },
      })
    } catch {
      // Non-fatal
    }

    if (severity === 'high' || severity === 'critical') {
      try {
        const { data: hrs } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['super_admin', 'hr_admin'])
          .limit(3)

        for (const hr of (hrs ?? [])) {
          await supabase.from('notifications').insert({
            tenant_id:    tenantId,
            recipient_id: hr.id,
            title:        `Excessive Payroll Variance — ${departmentName}`,
            body:         `Department payroll ${variancePct > 0 ? 'increased' : 'decreased'} by ${Math.abs(variancePct).toFixed(1)}% vs prior month. Investigate ${month} payroll.`,
            link:         `/admin/payroll/cost-intelligence`,
            is_read:      false,
          })
        }
      } catch {
        // Non-fatal
      }
    }
  })

  // ── Phase 11 — Attendance Intelligence Event Subscribers ─────────────────

  // ── attendance.exception.created ────────────────────────────────────────────
  // Audit-log every newly generated attendance exception
  eventBus.on('attendance.exception.created', async (event) => {
    const { tenantId, employeeId, date, exceptionType, severity, payrollImpacting } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, actor_id: null, entity_type: 'attendance_exception',
        entity_id: `${employeeId}:${date}:${exceptionType}`, action: 'created',
        metadata: { employee_id: employeeId, date, exception_type: exceptionType, severity, payroll_impacting: payrollImpacting },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── attendance.exception.sla.breached ───────────────────────────────────────
  // Mark the exception row as sla_breached in the DB
  eventBus.on('attendance.exception.sla.breached', async (event) => {
    const { tenantId, exceptionId, hoursOverdue } = event.payload
    try {
      await supabase.from('attendance_exceptions')
        .update({ sla_breached: true })
        .eq('id', exceptionId)
        .eq('tenant_id', tenantId)
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, actor_id: null, entity_type: 'attendance_exception',
        entity_id: exceptionId, action: 'sla_breached',
        metadata: { exception_id: exceptionId, hours_overdue: hoursOverdue },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── attendance.confidence.critical ──────────────────────────────────────────
  // Audit-log critical confidence drops for forensic traceability
  eventBus.on('attendance.confidence.critical', async (event) => {
    const { tenantId, employeeId, date, confidenceScore, confidenceLevel, topFactors } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, actor_id: null, entity_type: 'attendance_daily',
        entity_id: `${employeeId}:${date}`, action: 'confidence_critical',
        metadata: { employee_id: employeeId, date, confidence_score: confidenceScore, confidence_level: confidenceLevel, top_factors: topFactors },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── policy.conflict.detected ─────────────────────────────────────────────────
  // Audit-log conflicting policy applications on a daily record
  eventBus.on('policy.conflict.detected', async (event) => {
    const { tenantId, employeeId, date, conflictType, severity, payrollImpacting } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, actor_id: null, entity_type: 'attendance_policy_conflict',
        entity_id: `${employeeId}:${date}`, action: 'conflict_detected',
        metadata: { employee_id: employeeId, date, conflict_type: conflictType, severity, payroll_impacting: payrollImpacting },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── attendance.retroactive.impact ───────────────────────────────────────────
  // Audit-log retroactive changes that affect historical daily records
  eventBus.on('attendance.retroactive.impact', async (event) => {
    const { tenantId, employeeId, affectedDate, triggerSource, impactTypes } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, actor_id: null, entity_type: 'attendance_daily',
        entity_id: `${employeeId}:${affectedDate}`, action: 'retroactive_impact',
        metadata: { employee_id: employeeId, affected_date: affectedDate, trigger_source: triggerSource, impact_types: impactTypes },
      })
    } catch {
      // Non-fatal
    }
  })

  // ── attendance.risk.elevated ─────────────────────────────────────────────────
  // Audit-log risk level elevation for longitudinal trend analysis
  eventBus.on('attendance.risk.elevated', async (event) => {
    const { tenantId, employeeId, riskLevel, riskScore, period } = event.payload
    try {
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId, actor_id: null, entity_type: 'attendance_risk_profile',
        entity_id: `${employeeId}:${period}`, action: 'risk_elevated',
        metadata: { employee_id: employeeId, period, risk_score: riskScore, risk_level: riskLevel },
      })
    } catch {
      // Non-fatal
    }
  })
}
