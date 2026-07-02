/**
 * Poll Scheduler — dispatches weekly Monday mood polls via WhatsApp.
 *
 * Runs every 60 minutes. On Monday between 09:00–09:59 server time:
 *   1. Checks if a weekly pulse question was already created today (dedup)
 *   2. Creates a pulse_questions row for the tenant
 *   3. Sends WhatsApp mood poll to all active employees
 *
 * Register once at startup via registerPollScheduler(supabase).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { WhatsAppProvider }    from './whatsapp-provider.js'
import { durableQueue }        from './durable-queue.js'

const POLL_INTERVAL_MS = 60 * 60 * 1_000  // 1 hour

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

  // Fetch all active employees with phone numbers
  const { data: employees } = await supabase
    .from('employees')
    .select('id, first_name, phone')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .not('phone', 'is', null)

  if (!employees?.length) return

  const wa = new WhatsAppProvider(supabase)

  // Send in batches to avoid overwhelming the API
  for (const emp of employees as { id: string; first_name: string; phone: string }[]) {
    await wa.sendTemplate(tenantId, emp.phone, 'mood_poll_weekly', {
      name: emp.first_name ?? 'there',
    })
  }

  console.log(`[poll-scheduler] dispatched weekly mood poll to ${employees.length} employees (tenant ${tenantId})`)
}
