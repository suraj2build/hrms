/**
 * TriggerRegistry — registry of safe automation triggers.
 * All triggers are read-only nudges — NEVER mutate operational data.
 * Every action type is constrained to: notification | escalation | reminder | task_creation | nudge | sla_alert | incident_creation
 */
import type { AutomationTrigger, AutomationAction } from '../types/operations-types.js'
import type { ResolvedPlatformEvent }               from '../../events/types/platform-event.js'

export class TriggerRegistry {
  private triggers: AutomationTrigger[] = []

  register(trigger: AutomationTrigger): this {
    this.triggers.push(trigger)
    return this
  }

  evaluate(event: ResolvedPlatformEvent): AutomationAction[] {
    const actions: AutomationAction[] = []
    for (const trigger of this.triggers) {
      if (!trigger.enabled) continue
      if (!trigger.event_types.includes('*') && !trigger.event_types.includes(event.event_type)) continue
      try {
        const action = trigger.evaluate(event)
        if (action) actions.push(action)
      } catch (err) {
        console.warn('[TriggerRegistry] trigger error', { trigger: trigger.trigger_id, error: err })
      }
    }
    return actions
  }

  listTriggers(): AutomationTrigger[] { return [...this.triggers] }
}

export const triggerRegistry = new TriggerRegistry()
