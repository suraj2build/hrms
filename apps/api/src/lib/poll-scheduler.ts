/**
 * Poll Scheduler — dispatches weekly Monday mood polls via WhatsApp.
 *
 * Runs every 60 minutes. On Monday between 09:00–09:59 server time:
 *   1. Checks if a weekly pulse question was already created today (dedup)
 *   2. Creates a pulse_questions row for the tenant
 *   3. Sends WhatsApp mood poll to all active employees who haven't received it
 *      (C5a: chunked parallel sends; C5b: per-employee dedup via pulse_send_log)
 *
 * Register once at startup via registerPollScheduler(supabase).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { WhatsAppProvider }    from './whatsapp-provider.js'
import { durableQueue }        from './durable-queue.js'

const POLL_INTERVAL_MS = 60 * 60 * 1_000  // 1 hour

/** Concurrent WhatsApp sends per chunk. Keeps per-tenant API pressure manageable. */
const SEND_CHUNK_SIZE = 25

/** Run the Monday 09:00 poll tick — no-op outside that window. */
export async function runPollTick(supabase: SupabaseClient): Promise<void> {
  const now = new Date()
  // Monday = 1 (getDay()), 09:00–09:59
  if (now.getDay() !== 1 || now.getHours() !== 9) return

  try {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id')
      .in('status', ['active', 'trial'])

    for (const tenant of (tenants ?? []) as { id: string }[]) {
      await dispatchWeeklyPoll(supabase, tenant.id)
    }
  } catch (err) {
    console.error('[poll-scheduler] error:', err)
  }
}

export function registerPollScheduler(supabase: SupabaseClient): void {
  const enqueue = () => {
    const key = `send-pulse-poll:${new Date().toISOString().slice(0, 13)}`
    durableQueue.enqueue('send-pulse-poll', {}, { idempotencyKey: key }).catch(
      e => console.error('[poll-scheduler] enqueue error:', (e as Error).message),
    )
  }

  setInterval(enqueue, POLL_INTERVAL_MS)
  // also enqueue once shortly after startup in case server started during the window
  setTimeout(enqueue, 5_000)
}

async function dispatchWeeklyPoll(supabase: SupabaseClient, tenantId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)

  // Dedup: already created a weekly pulse today?
  const { data: existing } = await supabase
    .from('pulse_questions')
    .select('id')
    .eq('tenant_id', tenantId)
    .gte('created_at', `${today}T00:00:00Z`)
    .like('question', '%How are you feeling at work%')
    .maybeSingle()

  if (existing) return  // already dispatched today

  // Create the weekly pulse question
  const { data: pq, error: pqErr } = await supabase
    .from('pulse_questions')
    .insert({
      tenant_id: tenantId,
      question:  'How are you feeling at work this week?',
      options:   ['1 - Great', '2 - OK', '3 - Not Good'],
      status:    'active',
      starts_at: new Date().toISOString(),
      ends_at:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    })
    .select('id')
    .single()

  if (pqErr || !pq) {
    console.error('[poll-scheduler] failed to create pulse question:', pqErr?.message)
    return
  }

  await sendPollToEmployees(supabase, tenantId, pq.id as string)
}

/**
 * C5a + C5b: send the poll to all employees who haven't received it yet.
 *
 * Fetches pulse_send_log to skip already-sent employees (dedup on retry).
 * Sends in SEND_CHUNK_SIZE parallel chunks so 5,000 employees don't
 * serialize into a single sequential loop that exceeds any practical timeout.
 * Records each successful send in pulse_send_log so retries are safe.
 */
async function sendPollToEmployees(
  supabase:         SupabaseClient,
  tenantId:         string,
  pulseQuestionId:  string,
): Promise<void> {
  // Fetch all active employees with phone numbers
  const { data: employees } = await supabase
    .from('employees')
    .select('id, first_name, phone')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .not('phone', 'is', null)

  if (!employees?.length) return

  // C5b: exclude employees who already received this question (retry safety)
  const { data: alreadySent } = await supabase
    .from('pulse_send_log')
    .select('employee_id')
    .eq('tenant_id', tenantId)
    .eq('pulse_question_id', pulseQuestionId)

  const sentSet = new Set((alreadySent ?? []).map((r: { employee_id: string }) => r.employee_id))
  const pending = (employees as { id: string; first_name: string; phone: string }[])
    .filter(e => !sentSet.has(e.id))

  if (!pending.length) {
    console.log(`[poll-scheduler] pulse ${pulseQuestionId} already sent to all employees (tenant ${tenantId})`)
    return
  }

  const wa = new WhatsAppProvider(supabase)
  let sent = 0
  let failed = 0

  // C5a: send in parallel chunks
  for (let i = 0; i < pending.length; i += SEND_CHUNK_SIZE) {
    const chunk = pending.slice(i, i + SEND_CHUNK_SIZE)
    const results = await Promise.allSettled(
      chunk.map(emp =>
        wa.sendTemplate(tenantId, emp.phone, 'mood_poll_weekly', {
          name: emp.first_name ?? 'there',
        }).then(() => emp.id),
      ),
    )

    // C5b: record successful sends for dedup on retry
    const successIds = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map(r => r.value)

    if (successIds.length > 0) {
      await supabase
        .from('pulse_send_log')
        .upsert(
          successIds.map(employeeId => ({ tenant_id: tenantId, pulse_question_id: pulseQuestionId, employee_id: employeeId })),
          { onConflict: 'pulse_question_id,employee_id', ignoreDuplicates: true },
        )
    }

    sent   += successIds.length
    failed += results.filter(r => r.status === 'rejected').length
  }

  console.log(`[poll-scheduler] dispatched weekly mood poll tenant=${tenantId} sent=${sent} failed=${failed} skipped=${sentSet.size}`)
}
