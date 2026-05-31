/**
 * FabricOrchestrationListener — Sprint 5 fabric event observer.
 * Records key operational events into the decision graph.
 * Wires fabric-level orchestration intelligence into the event backbone.
 * PASSIVE ONLY — append-only, never mutates operational data.
 */
import { GovernanceListener }          from './governance-listener.js'
import type { ResolvedPlatformEvent }  from '../../events/types/platform-event.js'
import { decisionGraphService }        from '../../fabric/decision-graph/decision-graph.service.js'
import type { DecisionNodeType }       from '../../fabric/types/fabric-types.js'
import type { SupabaseClient }         from '@supabase/supabase-js'

export class FabricOrchestrationListener extends GovernanceListener {
  readonly name    = 'FabricOrchestrationListener'
  readonly handles = [
    'compensation.revision.approved',
    'payroll.run.finalized',
    'leave.approved',
    'employee.created',
    'governance.rule.triggered',
    'duplicate.detected',
    'sla.breach.detected',
    'automation.triggered',
  ]

  private supabase: SupabaseClient | null = null

  setSupabase(supabase: SupabaseClient): void {
    this.supabase = supabase
  }

  async evaluate(event: ResolvedPlatformEvent): Promise<void> {
    if (!this.supabase) return

    try {
      const nodeType = this.mapEventToNodeType(event.event_type)
      if (!nodeType) return

      await decisionGraphService.recordFromEvent(this.supabase, {
        org_id:      event.org_id,
        entity_id:   event.entity_id,
        entity_type: event.entity_type,
        node_type:   nodeType,
        description: this.describeEvent(event),
        actor_id:    event.actor_id,
        metadata:    { event_type: event.event_type, module: event.module, severity: event.severity },
      })
    } catch { /* non-fatal */ }
  }

  private mapEventToNodeType(eventType: string): DecisionNodeType | null {
    if (eventType === 'compensation.revision.approved') return 'approval'
    if (eventType === 'leave.approved')                 return 'approval'
    if (eventType === 'payroll.run.finalized')          return 'system'
    if (eventType === 'employee.created')               return 'system'
    if (eventType === 'governance.rule.triggered')      return 'governance_eval'
    if (eventType === 'duplicate.detected')             return 'trust_decision'
    if (eventType === 'sla.breach.detected')            return 'escalation'
    if (eventType === 'automation.triggered')           return 'automation_action'
    return null
  }

  private describeEvent(event: ResolvedPlatformEvent): string {
    const short = event.event_type.replace(/\./g, ' ')
    return `${short} — ${event.entity_type} ${event.entity_id.slice(0, 8)}`
  }
}

export const fabricOrchestrationListener = new FabricOrchestrationListener()
