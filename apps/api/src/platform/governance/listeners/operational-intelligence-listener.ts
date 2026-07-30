/**
 * OperationalIntelligenceListener — Sprint 4 passive operational observer.
 * Wires automation evaluation, SLA tracking, security intelligence, and heatmap updates.
 * Handles all events. Runs asynchronously after governance and trust listeners.
 * NEVER blocks or mutates operational data.
 */
import { GovernanceListener }           from './governance-listener.js'
import type { ResolvedPlatformEvent }   from '../../events/types/platform-event.js'
import { automationExecutor }           from '../../operations/automation/automation-executor.js'
import { securityIntelligenceService }  from '../../operations/security-intelligence/security-intelligence.service.js'
import { slaService }                   from '../../operations/sla/sla.service.js'

export class OperationalIntelligenceListener extends GovernanceListener {
  readonly name    = 'OperationalIntelligenceListener'
  readonly handles = ['*']

  // supabase is not injected in listeners — automation executor will receive it from routes
  // For passive listener context, we use a deferred supabase reference set at startup
  private supabase: import('@supabase/supabase-js').SupabaseClient | null = null

  setSupabase(supabase: import('@supabase/supabase-js').SupabaseClient): void {
    this.supabase = supabase
  }

  async evaluate(event: ResolvedPlatformEvent): Promise<void> {
    // 1. Security intelligence (in-memory, no supabase needed)
    try {
      const securitySignal = securityIntelligenceService.analyse(event)
      if (securitySignal) {
        console.info('[OperationalIntelligenceListener] security signal', {
          signal_type: securitySignal.signal_type,
          severity:    securitySignal.severity,
        })
      }
    } catch (err) {
      console.warn('[OperationalIntelligenceListener] security intelligence step failed', { tenant_id: event.tenant_id, event_type: event.event_type, err })
    }

    // 2. SLA tracking for leave/approval events
    try {
      if (event.event_type === 'leave.requested') {
        slaService.track('approval-pending', event.entity_id, 'leave_request', event.tenant_id, event.timestamp)
      }
      if (event.event_type === 'leave.approved' || event.event_type === 'leave.rejected' || event.event_type === 'leave.cancelled') {
        slaService.resolve('approval-pending', event.entity_id)
      }
    } catch (err) {
      console.warn('[OperationalIntelligenceListener] SLA tracking step failed', { tenant_id: event.tenant_id, event_type: event.event_type, err })
    }

    // 3. Automation execution (needs supabase for audit log)
    if (this.supabase) {
      try {
        automationExecutor.execute(this.supabase, event)
      } catch (err) {
        console.warn('[OperationalIntelligenceListener] automation execution step failed', { tenant_id: event.tenant_id, event_type: event.event_type, err })
      }
    }
  }
}

export const operationalIntelligenceListener = new OperationalIntelligenceListener()
