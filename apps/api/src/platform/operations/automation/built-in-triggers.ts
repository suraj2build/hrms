/**
 * Built-in automation triggers for Sprint 4.
 * These register side-effects on import — include in startup.
 * ALL actions are advisory only. None mutate operational data.
 */
import { triggerRegistry }    from './trigger-registry.js'

// Trigger 1: Compensation spike nudge
triggerRegistry.register({
  trigger_id:   'compensation-spike-nudge',
  name:         'Compensation Spike Notification',
  description:  'Nudge HR when a large compensation revision is approved',
  event_types:  ['compensation.revision.approved'],
  enabled:      true,
  safeguards:   ['Cannot alter compensation', 'Cannot reject the revision', 'Advisory only'],
  evaluate: (event) => {
    const deltaPct = (event.payload?.delta_pct as number) ?? 0
    if (deltaPct < 30) return null
    return {
      type:             'nudge',
      target_entity_id: event.entity_id,
      target_type:      'compensation_revision',
      message:          `Large compensation revision detected: +${deltaPct.toFixed(1)}% — HR review recommended`,
      severity:         deltaPct > 60 ? 'critical' : 'high',
      metadata:         { delta_pct: deltaPct },
    }
  },
})

// Trigger 2: Payroll run escalation
triggerRegistry.register({
  trigger_id:   'payroll-finalized-escalation',
  name:         'Payroll Finalization Notification',
  description:  'Notify governance layer when payroll is finalized',
  event_types:  ['payroll.run.finalized'],
  enabled:      true,
  safeguards:   ['Cannot alter payroll', 'Notification only'],
  evaluate: (event) => ({
    type:             'notification',
    target_entity_id: event.entity_id,
    target_type:      'payroll_run',
    message:          `Payroll run finalized — governance review window open`,
    severity:         'info',
    metadata:         { tenant_id: event.tenant_id },
  }),
})

// Trigger 3: Employee created trust reminder
triggerRegistry.register({
  trigger_id:   'employee-trust-reminder',
  name:         'New Employee Trust Evaluation Reminder',
  description:  'Remind HR to review trust evaluation for new employees',
  event_types:  ['employee.created'],
  enabled:      true,
  safeguards:   ['Cannot block onboarding', 'Advisory reminder only'],
  evaluate: (event) => ({
    type:             'reminder',
    target_entity_id: event.entity_id,
    target_type:      'employee',
    message:          `New employee onboarded — run trust evaluation to verify PAN, bank details, and identity`,
    severity:         'info',
    metadata:         { employee_id: event.entity_id },
  }),
})

// Trigger 4: Duplicate detected escalation
triggerRegistry.register({
  trigger_id:   'duplicate-detected-escalation',
  name:         'Duplicate Detection Escalation',
  description:  'Escalate when a duplicate PAN or bank account is detected',
  event_types:  ['duplicate.detected'],
  enabled:      true,
  safeguards:   ['Cannot reject employee', 'Cannot freeze payroll', 'Escalation notice only'],
  evaluate: (event) => ({
    type:             'escalation',
    target_entity_id: event.entity_id,
    target_type:      'employee',
    message:          `Duplicate ${event.payload?.duplicate_type ?? 'identifier'} detected — HR review required`,
    severity:         'high',
    metadata:         { duplicate_type: event.payload?.duplicate_type },
  }),
})
