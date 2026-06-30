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

    await this.supabase.from('insurance_outbox').insert({
      tenant_id:     this.tenantId,
      provider_name: process.env.INSURANCE_PROVIDER_NAME ?? 'GMC',
      event_type:    'enrolment_sync',
      payload,
      status:        'pending',
    })

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

      const { data: row } = await this.supabase
        .from('insurance_outbox')
        .select('id')
        .eq('tenant_id', this.tenantId)
        .eq('event_type', 'enrolment_sync')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (row?.id) {
        await this.supabase
          .from('insurance_outbox')
          .update({ status, sent_at: new Date().toISOString(), error_message: err })
          .eq('id', row.id)
      }
    } catch (err: unknown) {
      console.error('[insurance-provider] sync failed:', err)
    }
  }

  async syncUnenrolment(employeeId: string, planId: string): Promise<void> {
    const payload = { employee_id: employeeId, plan_id: planId }

    await this.supabase.from('insurance_outbox').insert({
      tenant_id:     this.tenantId,
      provider_name: process.env.INSURANCE_PROVIDER_NAME ?? 'GMC',
      event_type:    'unenrolment_sync',
      payload,
      status:        'pending',
    })

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

      const { data: row } = await this.supabase
        .from('insurance_outbox')
        .select('id')
        .eq('tenant_id', this.tenantId)
        .eq('event_type', 'unenrolment_sync')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (row?.id) {
        await this.supabase
          .from('insurance_outbox')
          .update({ status, sent_at: new Date().toISOString(), error_message: err })
          .eq('id', row.id)
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
