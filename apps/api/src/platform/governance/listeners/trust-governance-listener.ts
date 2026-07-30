/**
 * TrustGovernanceListener — passive trust observer.
 * Fires on employee.created events to run trust intelligence.
 * Also monitors compensation revision events for payroll trust signals.
 * NEVER blocks or mutates operational data.
 */
import { GovernanceListener }           from './governance-listener.js'
import type { ResolvedPlatformEvent }   from '../../events/types/platform-event.js'

export class TrustGovernanceListener extends GovernanceListener {
  readonly name    = 'TrustGovernanceListener'
  readonly handles = [
    'employee.created',
    'employee.updated',
    'compensation.revision.approved',
  ]

  async evaluate(event: ResolvedPlatformEvent): Promise<void> {
    if (event.event_type === 'employee.created' || event.event_type === 'employee.updated') {
      await this.handleEmployeeEvent(event)
    }
    // compensation.revision.approved: future sprint will check payroll trust signals
  }

  private async handleEmployeeEvent(event: ResolvedPlatformEvent): Promise<void> {
    // payload may contain pan, bank details (injected by route on fire-and-forget).
    // Defensive optional-chaining, matching every sibling rule file — payload
    // is typed as required, but a replayed/hand-constructed event could still
    // arrive with it null/undefined at runtime, bypassing the type contract.
    const payload = event.payload as Record<string, unknown> | undefined
    const pan            = payload?.pan_number as string | undefined
    const accountNumber  = payload?.account_number as string | undefined
    const ifscCode       = payload?.ifsc_code as string | undefined
    const phone          = payload?.phone as string | undefined

    // Need supabase — skip if not available in passive listener context
    // In Sprint 3, trust intelligence is exposed via REST routes instead
    // The listener logs intent; REST routes drive the actual evaluation
    console.info('[TrustGovernanceListener] employee event received', {
      event_type:  event.event_type,
      entity_id:   event.entity_id,
      has_pan:     !!pan,
      has_bank:    !!(accountNumber && ifscCode),
      has_phone:   !!phone,
    })
  }
}

export const trustGovernanceListener = new TrustGovernanceListener()
