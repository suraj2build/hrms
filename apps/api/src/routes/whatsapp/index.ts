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
  fastify.post('/whatsapp/webhook', { config: { rawBody: true, rateLimit: { max: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT ?? 300), timeWindow: '1 minute' } } }, async (req, reply) => {
    // Verify Meta HMAC-SHA256 signature before processing the payload.
    // Header: X-Hub-Signature-256: sha256=<hex digest of HMAC-SHA256(appSecret, rawBody)>
    const appSecret = process.env.WHATSAPP_APP_SECRET
    if (!appSecret) {
      req.log.error('[whatsapp] WHATSAPP_APP_SECRET is not configured — rejecting inbound webhook')
      return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' })
    }
    const sig = (req.headers['x-hub-signature-256'] as string | undefined) ?? ''
    const raw = (req as any).rawBody as string | Buffer | undefined
    if (!sig || !raw) return reply.code(403).send({ error: 'MISSING_SIGNATURE' })
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex')
    const ok = expected.length === sig.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
    if (!ok) return reply.code(403).send({ error: 'INVALID_SIGNATURE' })

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

      // Look up employee by phone across all tenants. `employees.phone` has
      // no unique constraint and no dedicated WhatsApp opt-in mapping exists
      // — a recycled mobile number (routine in India within ~90 days of
      // going inactive) can genuinely match more than one active employee
      // across tenants. Fetch 2 so a collision can be detected instead of
      // `.limit(1)` silently picking an arbitrary row and writing this
      // message's mood/note/ack against the wrong employee and tenant.
      const supabase = fastify.supabase
      const { data: employees } = await supabase
        .from('employees')
        .select('id, tenant_id, first_name')
        .eq('phone', from)
        .eq('status', 'active')
        .limit(2)

      const matches = (employees as { id: string; tenant_id: string; first_name: string }[] | null) ?? []
      if (matches.length > 1) {
        req.log.error({ from, tenantIds: matches.map(m => m.tenant_id) }, '[whatsapp] ambiguous phone number matches multiple active employees — dropping message')
        return reply.code(200).send('ok')
      }
      const employee = matches[0]
      if (!employee) return reply.code(200).send('ok')

      const { id: employeeId, tenant_id: tenantId } = employee
      const wa = new WhatsAppProvider(supabase)

      // ── Mood poll response (1, 2, 3) ─────────────────────────────────────────
      if (MOOD_MAP[text] !== undefined) {
        const mood = MOOD_MAP[text]
        const today = new Date().toISOString().slice(0, 10)

        const { error: moodErr } = await supabase.from('mood_checkins').upsert(
          {
            tenant_id:    tenantId,
            employee_id:  employeeId,
            mood,
            checkin_date: today,
          },
          { onConflict: 'tenant_id,employee_id,checkin_date' },
        )

        if (moodErr) {
          req.log.error({ err: moodErr, tenantId, employeeId }, '[whatsapp] mood check-in upsert failed')
          await wa.sendText(tenantId, from, `Sorry, something went wrong recording your mood. Please try again later.`)
          return reply.code(200).send('ok')
        }

        await wa.sendText(tenantId, from, `Thank you! Your mood has been recorded. Take care! 😊`)
        return reply.code(200).send('ok')
      }

      // ── Policy acknowledgement (ACK <policyId>) ───────────────────────────────
      const ackMatch = text.match(/^ACK\s+([0-9a-f-]{36})/i)
      if (ackMatch) {
        const policyId = ackMatch[1]

        // policy_acknowledgements.policy_id only has a bare FK to hr_policies(id)
        // (no composite FK on tenant_id) and fastify.supabase runs with the
        // service-role key, bypassing RLS — without this lookup, a UUID typed
        // into the free-text message body (guessed, enumerated, or leaked from
        // another tenant) would be upserted verbatim, corrupting this tenant's
        // ack register with a reference to a policy that isn't even theirs.
        const { data: policy } = await supabase
          .from('hr_policies')
          .select('id')
          .eq('id', policyId)
          .eq('tenant_id', tenantId)
          .eq('status', 'published')
          .maybeSingle()

        if (!policy) {
          await wa.sendText(tenantId, from, `Sorry, we couldn't find that policy. Please check the link and try again.`)
          return reply.code(200).send('ok')
        }

        const { error: ackErr } = await supabase.from('policy_acknowledgements').upsert(
          {
            tenant_id:    tenantId,
            policy_id:    policyId,
            employee_id:  employeeId,
            acknowledged_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,policy_id,employee_id' },
        )

        if (ackErr) {
          req.log.error({ err: ackErr, tenantId, employeeId, policyId }, '[whatsapp] policy acknowledgement upsert failed')
          await wa.sendText(tenantId, from, `Sorry, something went wrong acknowledging the policy. Please try again later.`)
          return reply.code(200).send('ok')
        }

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
          const { error: noteErr } = await supabase
            .from('mood_checkins')
            .update({ note: text.slice(0, 1000) })
            .eq('id', (existing as { id: string }).id)

          if (noteErr) {
            req.log.error({ err: noteErr, tenantId, employeeId }, '[whatsapp] mood check-in note update failed')
            await wa.sendText(tenantId, from, `Sorry, something went wrong saving your note. Please try again later.`)
          } else {
            await wa.sendText(tenantId, from, `Your note has been saved. Thank you!`)
          }
        } else {
          await wa.sendText(tenantId, from, `Hi! To log your mood, reply with 1 (Great), 2 (OK), or 3 (Not Good).`)
        }
      }

    } catch (err) {
      req.log.error({ err }, '[whatsapp-webhook] error')
    }

    return reply.code(200).send('ok')
  })
}

export default whatsappRoutes
