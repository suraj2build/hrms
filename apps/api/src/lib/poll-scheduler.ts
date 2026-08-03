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
import { fetchAllRows }        from './supabase-paginate.js'
import { fetchTenantTz }       from './attendance-engine.js'
import { getLocalDate, getLocalDayOfWeek, getLocalTimeMinutes } from './org-context.js'
import { logger }              from './logger.js'

const POLL_INTERVAL_MS = 60 * 60 * 1_000  // 1 hour

/** Concurrent WhatsApp sends per chunk. Keeps per-tenant API pressure manageable. */
const SEND_CHUNK_SIZE = 25

/**
 * Run the poll tick — fires hourly. Each tenant is gated on its OWN local
 * Monday 09:00 hour, not the server's (UTC) clock — a single server-time gate
 * would fire the poll at the wrong local hour for every non-UTC tenant.
 */
export async function runPollTick(supabase: SupabaseClient): Promise<void> {
  let tenants: { id: string }[]
  try {
    tenants = await fetchAllRows<{ id: string }>((from, to) =>
      supabase.from('tenants').select('id').in('status', ['active', 'trial']).range(from, to),
    )
  } catch (err) {
    logger.error({ err }, '[poll-scheduler] failed to fetch tenants')
    return
  }

  const nowIso = new Date().toISOString()
  for (const tenant of tenants) {
    try {
      const tz = await fetchTenantTz(supabase, tenant.id)
      const localDate = getLocalDate(nowIso, tz)
      const localMinutes = getLocalTimeMinutes(nowIso, tz)
      const isMonday9am = getLocalDayOfWeek(localDate, tz) === 1 && localMinutes >= 9 * 60 && localMinutes < 10 * 60
      if (!isMonday9am) continue
      await dispatchWeeklyPoll(supabase, tenant.id, localDate)
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, `[poll-scheduler] tenant=${tenant.id} error`)
    }
  }
}

export function registerPollScheduler(supabase: SupabaseClient): void {
  const enqueue = () => {
    const key = `send-pulse-poll:${new Date().toISOString().slice(0, 13)}`
    // Explicit timeoutMs (fresh audit finding) — this fans out sequential
    // chunked WhatsApp sends across every active tenant's employees and can
    // exceed the queue's 120s default at real scale, and a timed-out (but
    // still-running) execution racing a re-enqueued retry is exactly the
    // TOCTOU window that produces a duplicate WhatsApp send.
    durableQueue.enqueue('send-pulse-poll', {}, { idempotencyKey: key, timeoutMs: 10 * 60 * 1_000 }).catch(
      e => logger.error({ err: e }, '[poll-scheduler] enqueue error'),
    )
  }

  setInterval(enqueue, POLL_INTERVAL_MS)
  // also enqueue once shortly after startup in case server started during the window
  setTimeout(enqueue, 5_000)
}

async function dispatchWeeklyPoll(supabase: SupabaseClient, tenantId: string, todayLocal: string): Promise<void> {
  // Dedup: already created a weekly pulse today (tenant-local calendar day,
  // not UTC — otherwise the "already sent today" boundary can be off by
  // several hours relative to what the tenant considers "today").
  const { data: existing } = await supabase
    .from('pulse_questions')
    .select('id')
    .eq('tenant_id', tenantId)
    .gte('created_at', `${todayLocal}T00:00:00Z`)
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
    logger.error({ err: pqErr }, '[poll-scheduler] failed to create pulse question')
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
  const employees = await fetchAllRows((from, to) =>
    supabase
      .from('employees')
      .select('id, first_name, phone')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .not('phone', 'is', null)
      .order('id')
      .range(from, to),
  )

  if (!employees?.length) return

  // C5b: exclude employees who already received this question (retry safety).
  // pulse_send_log grows without bound (one row per employee per question ever sent).
  const alreadySent = await fetchAllRows((from, to) =>
    supabase
      .from('pulse_send_log')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('pulse_question_id', pulseQuestionId)
      .order('employee_id')
      .range(from, to),
  )

  const sentSet = new Set(alreadySent.map((r: { employee_id: string }) => r.employee_id))
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
    // sendTemplate never throws (delivery failure is recorded in whatsapp_outbox,
    // not surfaced as a rejection) — so Promise.allSettled's 'fulfilled' status
    // said nothing about actual delivery. Read the resolved boolean instead;
    // otherwise a genuinely-failed send got written to pulse_send_log anyway
    // and would never be retried.
    const results = await Promise.allSettled(
      chunk.map(emp =>
        wa.sendTemplate(tenantId, emp.phone, 'mood_poll_weekly', {
          name: emp.first_name ?? 'there',
        }).then(delivered => ({ id: emp.id, delivered })),
      ),
    )

    // C5b: record successful sends for dedup on retry
    const successIds = results
      .filter((r): r is PromiseFulfilledResult<{ id: string; delivered: boolean }> => r.status === 'fulfilled' && r.value.delivered)
      .map(r => r.value.id)

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
