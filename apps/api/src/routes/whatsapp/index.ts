/**
 * WhatsApp Inbound Webhook Handler
 *
 * Routes inbound WhatsApp messages:
 *   "1" | "2" | "3"       → mood check-in from weekly poll (maps to 5, 3, 1)
 *   "ACK {policyId}"      → policy acknowledgement
 *   free text after mood  → save as note on the mood check-in
 *   other text            → forward to AI Copilot assistant
 *
 * Verification endpoint (GET) uses WHATSAPP_WEBHOOK_SECRET env var.
 */

import type { FastifyPluginAsync } from 'fastify'
import crypto                     from 'node:crypto'
import { createClient }           from '@supabase/supabase-js'
import { WhatsAppProvider }       from '../../lib/whatsapp-provider.js'

// Mood score mapping from WhatsApp reply to 1-5 scale
const MOOD_MAP: Record<string, number> = { '1': 5, '2': 3, '3': 1 }

const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /whatsapp/webhook — verification ─────────────────────────────────────
  fastify.get('/whatsapp/webhook', async (req, reply) => {
    const query   = req.query as Record<string, string>
    const mode    = query['hub.mode']
    const token   = query['hub.verify_token']
    const challenge = query['hub.challenge']

    const secret = process.env.WHATSAPP_WEBHOOK_SECRET
    if (mode === 'subscribe' && token === secret) {
      return reply.code(200).send(challenge)
    }
    return reply.code(403).send('Forbidden')
  })

  // ── POST /whatsapp/webhook — inbound messages ─────────────────────────────────
  fastify.post('/whatsapp/webhook', { config: { rawBody: true } }, async (req, reply) => {
    // Verify Meta HMAC-SHA256 signature before processing the payload.
    // Header: X-Hub-Signature-256: sha256=<hex digest of HMAC-SHA256(appSecret, rawBody)>
    const appSecret = process.env.WHATSAPP_APP_SECRET
    if (appSecret) {
      const sig = (req.headers['x-hub-signature-256'] as string | undefined) ?? ''
      const raw = (req as any).rawBody as string | Buffer | undefined
      if (!sig || !raw) return reply.code(403).send({ error: 'MISSING_SIGNATURE' })
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex')
      const ok = expected.length === sig.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
      if (!ok) return reply.code(403).send({ error: 'INVALID_SIGNATURE' })
    }

    const body = req.body as Record<string, unknown>

    try {
      const entry    = (body?.entry as unknown[])?.[0] as Record<string, unknown>
      const changes  = (entry?.changes as unknown[])?.[0] as Record<string, unknown>
      const value    = changes?.value as Record<string, unknown>
      const messages = value?.messages as unknown[]

      if (!messages?.length) return reply.code(200).send('ok')

      const msg = messages[0] as Record<string, unknown>
      const from = msg.from as string     // sender phone number
      const text = ((msg.text as Record<string, string>)?.body ?? '').trim()

      if (!from || !text) return reply.code(200).send('ok')

      // Look up employee by phone across all tenants
      const supabase = fastify.supabase
      const { data: employees } = await supabase
        .from('employees')
        .select('id, tenant_id, first_name')
        .eq('phone', from)
        .eq('status', 'active')
        .limit(1)

      const employee = (employees as { id: string; tenant_id: string; first_name: string }[] | null)?.[0]
      if (!employee) return reply.code(200).send('ok')

      const { id: employeeId, tenant_id: tenantId } = employee
      const wa = new WhatsAppProvider(supabase)

      // ── Mood poll response (1, 2, 3) ─────────────────────────────────────────
      if (MOOD_MAP[text] !== undefined) {
        const mood = MOOD_MAP[text]
        const today = new Date().toISOString().slice(0, 10)

        await supabase.from('mood_checkins').upsert(
          {
            tenant_id:    tenantId,
            employee_id:  employeeId,
            mood,
            checkin_date: today,
          },
          { onConflict: 'tenant_id,employee_id,checkin_date' },
        )

        await wa.sendText(tenantId, from, `Thank you! Your mood has been recorded. Take care! 😊`)
        return reply.code(200).send('ok')
      }

      // ── Policy acknowledgement (ACK <policyId>) ───────────────────────────────
      const ackMatch = text.match(/^ACK\s+([0-9a-f-]{36})/i)
      if (ackMatch) {
        const policyId = ackMatch[1]
        await supabase.from('policy_acknowledgements').upsert(
          {
            tenant_id:    tenantId,
            policy_id:    policyId,
            employee_id:  employeeId,
            acknowledged_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,policy_id,employee_id' },
        )

        await wa.sendText(tenantId, from, `Policy acknowledged. Thank you!`)
        return reply.code(200).send('ok')
      }

      // ── Free text → update note on today's check-in if exists ────────────────
      if (text.length > 0) {
        const today = new Date().toISOString().slice(0, 10)
        const { data: existing } = await supabase
          .from('mood_checkins')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('employee_id', employeeId)
          .eq('checkin_date', today)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('mood_checkins')
            .update({ note: text.slice(0, 1000) })
            .eq('id', (existing as { id: string }).id)

          await wa.sendText(tenantId, from, `Your note has been saved. Thank you!`)
        } else {
          await wa.sendText(tenantId, from, `Hi! To log your mood, reply with 1 (Great), 2 (OK), or 3 (Not Good).`)
        }
      }

    } catch (err) {
      console.error('[whatsapp-webhook] error:', err)
    }

    return reply.code(200).send('ok')
  })
}

export default whatsappRoutes
