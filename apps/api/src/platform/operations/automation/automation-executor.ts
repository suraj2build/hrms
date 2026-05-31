/**
 * AutomationExecutor — executes approved automation actions and writes audit logs.
 * All actions must be in the allowed set. Execution is fire-and-forget.
 * Every execution produces an audit record.
 */
import type { SupabaseClient }           from '@supabase/supabase-js'
import type { AutomationAction, AutomationActivityRecord } from '../types/operations-types.js'
import type { ResolvedPlatformEvent }    from '../../events/types/platform-event.js'
import { triggerRegistry }               from './trigger-registry.js'
import { explainabilityService }         from '../../ai/services/explainability.service.js'

export class AutomationExecutor {
  /**
   * Evaluate all triggers for an event and execute resulting actions.
   * Fire-and-forget — never blocks the event pipeline.
   */
  execute(supabase: SupabaseClient, event: ResolvedPlatformEvent): void {
    Promise.resolve()
      .then(async () => {
        const actions = triggerRegistry.evaluate(event)
        for (const action of actions) {
          await this.executeAction(supabase, action, event)
        }
      })
      .catch(err => console.warn('[AutomationExecutor] error', err))
  }

  private async executeAction(supabase: SupabaseClient, action: AutomationAction, event: ResolvedPlatformEvent): Promise<void> {
    const record: AutomationActivityRecord = {
      trigger_id:    'system',
      trigger_name:  action.type,
      action_type:   action.type,
      entity_id:     action.target_entity_id,
      entity_type:   action.target_type,
      org_id:        event.org_id,
      message:       action.message,
      severity:      action.severity,
      fired_at:      new Date().toISOString(),
      explainability: explainabilityService.explain({
        event_type:  event.event_type,
        entity_type: action.target_type,
        entity_id:   action.target_entity_id,
        payload:     { action_type: action.type, message: action.message },
        severity:    action.severity,
      }),
    }

    // Persist audit log
    const insertResult = supabase
      .from('automation_activity_logs')
      .insert({
        org_id:        record.org_id,
        action_type:   record.action_type,
        entity_id:     record.entity_id,
        entity_type:   record.entity_type,
        message:       record.message,
        severity:      record.severity,
        fired_at:      record.fired_at,
        explainability: record.explainability,
        metadata:      action.metadata ?? null,
      })
    await insertResult.then(
      () => {},
      (err: unknown) => console.warn('[AutomationExecutor] audit log failed', err),
    )
  }
}

export const automationExecutor = new AutomationExecutor()
