/**
 * Insurance Provider — stub for GMC/insurer API integration.
 *
 * Behaviour:
 *   - Always logs to insurance_outbox
 *   - Makes real HTTP calls ONLY when INSURANCE_API_KEY + INSURANCE_API_URL
 *     env vars are set
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface Claim {
  claim_id:    string
  status:      string
  amount:      number
  submitted_at: string
}

export class InsuranceProvider {
  constructor(private supabase: SupabaseClient, private tenantId: string) {}

  async syncEnrolment(
    employeeId:   string,
    planId:       string,
    dependentIds: string[],
  ): Promise<void> {
    const payload = { employee_id: employeeId, plan_id: planId, dependent_ids: dependentIds }

    const { data: outboxRow } = await this.supabase
      .from('insurance_outbox')
      .insert({
        tenant_id:     this.tenantId,
        provider_name: process.env.INSURANCE_PROVIDER_NAME ?? 'GMC',
        event_type:    'enrolment_sync',
        payload,
        status:        'pending',
      })
      .select('id')
      .single()

    const apiKey = process.env.INSURANCE_API_KEY
    const apiUrl = process.env.INSURANCE_API_URL
    if (!apiKey || !apiUrl) return

    try {
      const res = await fetch(`${apiUrl}/enrolments`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const status = res.ok ? 'sent' : 'failed'
      const err    = res.ok ? undefined : (await res.text()).slice(0, 500)

      // Update by the id captured from this insert, not a "most recent row
      // of this event_type" re-query — two concurrent enrolments racing
      // would otherwise let the second insert's lookup return the FIRST
      // request's row, stamping employee A's send-status onto employee B's
      // outbox record (and vice versa), corrupting the insurance sync audit
      // trail ops relies on to know whether an enrolment actually reached
      // the insurer.
      if (outboxRow?.id) {
        await this.supabase
          .from('insurance_outbox')
          .update({ status, sent_at: new Date().toISOString(), error_message: err })
          .eq('id', outboxRow.id)
      }
    } catch (err: unknown) {
      console.error('[insurance-provider] sync failed:', err)
    }
  }

  async syncUnenrolment(employeeId: string, planId: string): Promise<void> {
    const payload = { employee_id: employeeId, plan_id: planId }

    // Fresh audit finding: 'unenrolment_sync' is not in insurance_outbox's
    // event_type CHECK constraint (only 'enrolment_sync', 'dependent_update',
    // 'unenrolment' are allowed) — this insert has always failed the CHECK,
    // and its error was never checked, so no unenrolment has ever actually
    // been logged to the outbox (the real-world unenrolment API call below
    // still fires regardless, since it doesn't depend on this insert
    // succeeding — only the audit trail was silently missing).
    const { data: outboxRow, error: insertErr } = await this.supabase
      .from('insurance_outbox')
      .insert({
        tenant_id:     this.tenantId,
        provider_name: process.env.INSURANCE_PROVIDER_NAME ?? 'GMC',
        event_type:    'unenrolment',
        payload,
        status:        'pending',
      })
      .select('id')
      .single()
    if (insertErr) console.error('[insurance-provider] outbox insert failed:', insertErr)

    const apiKey = process.env.INSURANCE_API_KEY
    const apiUrl = process.env.INSURANCE_API_URL
    if (!apiKey || !apiUrl) return

    try {
      const res = await fetch(`${apiUrl}/unenrolments`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const status = res.ok ? 'sent' : 'failed'
      const err    = res.ok ? undefined : (await res.text()).slice(0, 500)

      // Update by the id captured from this insert — see syncEnrolment above
      // for why a "most recent row of this event_type" re-query is unsafe
      // under concurrent requests.
      if (outboxRow?.id) {
        await this.supabase
          .from('insurance_outbox')
          .update({ status, sent_at: new Date().toISOString(), error_message: err })
          .eq('id', outboxRow.id)
      }
    } catch (err: unknown) {
      console.error('[insurance-provider] unenrolment sync failed:', err)
    }
  }

  async getClaimStatus(employeeId: string): Promise<{ claims: Claim[] }> {
    const apiKey = process.env.INSURANCE_API_KEY
    const apiUrl = process.env.INSURANCE_API_URL
    if (!apiKey || !apiUrl) return { claims: [] }

    try {
      const res = await fetch(`${apiUrl}/claims?employee_id=${employeeId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return { claims: [] }
      return res.json() as Promise<{ claims: Claim[] }>
    } catch {
      return { claims: [] }
    }
  }
}
