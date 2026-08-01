/**
 * WhatsApp Provider — abstraction layer for WhatsApp Business Cloud API.
 *
 * Behaviour:
 *   - Always logs to whatsapp_outbox (audit trail, idempotent retry)
 *   - Makes real HTTP delivery ONLY when WHATSAPP_API_TOKEN +
 *     WHATSAPP_PHONE_NUMBER_ID env vars are present
 *   - Never throws — delivery failure is logged; callers are not interrupted
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from './logger.js'

const WA_API_VERSION = 'v18.0'

// Template body previews (for readable logs before real API is connected)
const TEMPLATE_PREVIEWS: Record<string, (v: Record<string, string>) => string> = {
  mood_poll_weekly:      (v) => `Hi ${v.name ?? ''}! How are you feeling at work this week? Reply 1 (Great) / 2 (OK) / 3 (Not Good)`,
  ticket_acknowledgement:(v) => `Your query has been received. Ticket ${v.ticket_number ?? ''} — expected resolution within ${v.sla_hours ?? ''}h.`,
  policy_published:      (v) => `New HR Policy: ${v.title ?? ''}. Please read and acknowledge.`,
  peer_recognition:      (v) => `${v.giver_name ?? ''} appreciated you! "${v.message ?? ''}"`,
  formal_award_won:      (v) => `Congratulations! You are the winner of ${v.award_name ?? ''}.`,
  new_joiner_policies:   (v) => `Welcome to CognixHR, ${v.name ?? ''}! Please acknowledge your mandatory policies.`,
}

export class WhatsAppProvider {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Returns whether the message was actually delivered (outbox status 'sent').
   * This method never throws — a caller relying on promise rejection to detect
   * failure (Promise.allSettled reading 'fulfilled') will incorrectly treat
   * every call as a success; check the resolved boolean instead.
   */
  async sendTemplate(
    tenantId: string,
    phone: string,
    template: string,
    variables: Record<string, string>,
  ): Promise<boolean> {
    const preview = (TEMPLATE_PREVIEWS[template] ?? (() => template))(variables)

    // Always log to outbox
    const { data: outboxRow, error: insertError } = await this.supabase
      .from('whatsapp_outbox')
      .insert({
        tenant_id:     tenantId,
        to_phone:      phone,
        template_name: template,
        variables,
        body_preview:  preview,
        status:        'pending',
      })
      .select('id')
      .single()

    if (insertError) {
      logger.error({ err: insertError }, '[WhatsApp] outbox insert failed')
      return false
    }

    const apiToken    = process.env.WHATSAPP_API_TOKEN
    const phoneNumId  = process.env.WHATSAPP_PHONE_NUMBER_ID
    const outboxId    = outboxRow?.id

    if (!apiToken || !phoneNumId) {
      // Logged to outbox; no live delivery until credentials are set
      return false
    }

    try {
      // Build component parameters from variables object
      const components = Object.keys(variables).length
        ? [{
            type: 'body',
            parameters: Object.values(variables).map((v) => ({ type: 'text', text: v })),
          }]
        : []

      const res = await fetch(
        `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumId}/messages`,
        {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to:                phone,
            type:              'template',
            template: {
              name:       template,
              language:   { code: 'en' },
              components,
            },
          }),
        },
      )

      if (res.ok) {
        await this.supabase
          .from('whatsapp_outbox')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', outboxId)
        return true
      } else {
        const body = await res.text()
        await this.supabase
          .from('whatsapp_outbox')
          .update({ status: 'failed', error_message: body.slice(0, 500) })
          .eq('id', outboxId)
        return false
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.supabase
        .from('whatsapp_outbox')
        .update({ status: 'failed', error_message: msg.slice(0, 500) })
        .eq('id', outboxId)
      return false
    }
  }

  /**
   * Send a free-form text message (utility for inbound reply acknowledgement).
   * Returns whether delivery actually succeeded — callers must not assume
   * promise fulfillment means the message was sent (mirrors sendTemplate()).
   */
  async sendText(
    tenantId: string,
    phone: string,
    text: string,
  ): Promise<boolean> {
    const { data: outboxRow, error: insertError } = await this.supabase
      .from('whatsapp_outbox')
      .insert({
        tenant_id:     tenantId,
        to_phone:      phone,
        template_name: '_text',
        variables:     { text },
        body_preview:  text.slice(0, 200),
        status:        'pending',
      })
      .select('id')
      .single()

    if (insertError) {
      logger.error({ err: insertError }, '[WhatsApp] outbox insert failed')
      return false
    }

    const apiToken   = process.env.WHATSAPP_API_TOKEN
    const phoneNumId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const outboxId   = outboxRow?.id

    if (!apiToken || !phoneNumId) {
      // Logged to outbox; no live delivery until credentials are set
      return false
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumId}/messages`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to:    phone,
            type:  'text',
            text:  { body: text },
          }),
        },
      )

      if (res.ok) {
        await this.supabase
          .from('whatsapp_outbox')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', outboxId)
        return true
      } else {
        const body = await res.text()
        await this.supabase
          .from('whatsapp_outbox')
          .update({ status: 'failed', error_message: body.slice(0, 500) })
          .eq('id', outboxId)
        return false
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.supabase
        .from('whatsapp_outbox')
        .update({ status: 'failed', error_message: msg.slice(0, 500) })
        .eq('id', outboxId)
      return false
    }
  }
}
