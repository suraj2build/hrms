/**
 * Digest Scheduler — R9 Minimal
 *
 * Activates delivery of existing intelligence using existing infrastructure.
 * No preference tables, no subscription model, no channel settings.
 *
 * What it does:
 *   - Runs hourly; fires each digest type once per period (idempotency via
 *     digest_send_log UNIQUE constraint)
 *   - Delivers to ALL active HR admins + super admins in every tenant
 *   - In-app: inserts into notifications table (existing bell)
 *   - Email: sends via Resend using digestEmail() template
 *   - Audit: writes DIGEST_SENT / DIGEST_FAILED rows to audit_logs
 *
 * Delivery schedule (checked every hour, UTC):
 *   daily   → any day,    after 06:00 UTC
 *   weekly  → Monday,     after 06:00 UTC
 *   monthly → 1st of month, after 06:00 UTC
 *
 * Executive narrative → delivered monthly alongside the monthly digest,
 * pulling from the already-computed intelligence_digest table.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDigest, periodKey, type DigestFrequency } from './digest-builder.js'
import { sendEmail, digestEmail, APP_PUBLIC_URL } from './email-service.js'
import { durableQueue }       from './durable-queue.js'
import { fetchAllRows }       from './supabase-paginate.js'

const TICK_MS    = 60 * 60 * 1_000   // hourly
const WARMUP_MS  = 5 * 60 * 1_000    // 5-minute startup delay
const SEND_HOUR  = 6                  // don't fire before 06:00 UTC

const ALL_FREQ: DigestFrequency[] = ['daily', 'weekly', 'monthly']

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getHrAdmins(
  supabase: SupabaseClient, tenantId: string,
): Promise<{ id: string; email: string | null }[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['super_admin', 'hr_admin'])
    .eq('is_active', true)

  const admins = data ?? []
  const result: { id: string; email: string | null }[] = []

  for (const a of admins as any[]) {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(a.id)
      result.push({ id: a.id, email: u?.user?.email ?? null })
    } catch {
      result.push({ id: a.id, email: null })
    }
  }
  return result
}

/**
 * Reserve an idempotency slot. Returns { owned: true } if this call owns the
 * send. A unique-violation (23505) means another call already reserved this
 * slot — that's the expected dedup path, not a failure. Any other insert
 * error is a real failure and must NOT be silently treated as "already
 * sent" — it's surfaced via `error` so the caller can log and count it.
 */
async function reserve(
  supabase: SupabaseClient,
  tenantId: string, recipientId: string,
  frequency: DigestFrequency, channel: 'in_app' | 'email', pkey: string,
): Promise<{ owned: boolean; error?: { message: string } }> {
  const { error } = await supabase.from('digest_send_log').insert({
    tenant_id: tenantId, recipient_id: recipientId,
    frequency, channel, period_key: pkey, status: 'sent',
  })
  if (!error) return { owned: true }
  if ((error as { code?: string }).code === '23505') return { owned: false }  // already sent
  return { owned: false, error }
}

function writeAuditLog(
  supabase: SupabaseClient,
  tenantId: string,
  action: 'DIGEST_SENT' | 'DIGEST_FAILED',
  detail: Record<string, unknown>,
): void {
  // Fire-and-forget; audit log is best-effort — failures are non-fatal.
  supabase.from('audit_logs').insert({
    tenant_id:  tenantId,
    action,
    table_name: 'digest_send_log',
    record_id:  tenantId,
    new_data:   detail,
  }).then(null, () => {})
}

// ── Executive narrative (monthly only) ────────────────────────────────────────

async function getExecutiveNarrative(
  supabase: SupabaseClient, tenantId: string, monthLabel: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('intelligence_digest')
    .select('narrative')
    .eq('tenant_id', tenantId)
    .eq('period_type', 'monthly')
    .eq('period_start', `${monthLabel}-01`)
    .maybeSingle()
  return (data as any)?.narrative ?? null
}

// ── Per-tenant delivery ───────────────────────────────────────────────────────

export interface DigestRunResult {
  tenant_id:  string
  frequency:  DigestFrequency
  recipients: number
  in_app:     number
  email:      number
  failed:     number
}

export async function runDigestForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  frequency: DigestFrequency,
  companyName?: string,
): Promise<DigestRunResult> {
  const result: DigestRunResult = { tenant_id: tenantId, frequency, recipients: 0, in_app: 0, email: 0, failed: 0 }

  const admins = await getHrAdmins(supabase, tenantId)
  if (!admins.length) return result
  result.recipients = admins.length

  const digest = await buildDigest(supabase, tenantId, frequency)
  const pkey   = periodKey(frequency)

  // For monthly: also grab the executive narrative (may be null if not yet generated)
  let execNarrative: string | null = null
  if (frequency === 'monthly') {
    execNarrative = await getExecutiveNarrative(supabase, tenantId, digest.period_label)
  }

  for (const admin of admins) {
    // ── In-app ──────────────────────────────────────────────────────────────
    const inAppSlot = await reserve(supabase, tenantId, admin.id, frequency, 'in_app', pkey)
    if (inAppSlot.error) {
      result.failed++
      await writeAuditLog(supabase, tenantId, 'DIGEST_FAILED', {
        frequency, channel: 'in_app', period_key: pkey,
        recipient_id: admin.id, error: inAppSlot.error.message, stage: 'reserve',
      })
    } else if (inAppSlot.owned) {
      const { error } = await supabase.from('notifications').insert({
        tenant_id:    tenantId,
        recipient_id: admin.id,
        title:        `${digest.period.charAt(0).toUpperCase() + digest.period.slice(1)} workforce digest`,
        body:         digest.summary_text,
        link:         '/admin/insights',
        event_id:     `digest:${frequency}:${pkey}`,
      })
      if (error) {
        result.failed++
        await writeAuditLog(supabase, tenantId, 'DIGEST_FAILED', {
          frequency, channel: 'in_app', period_key: pkey,
          recipient_id: admin.id, error: error.message,
        })
      } else {
        result.in_app++
      }
    }

    // ── Email ────────────────────────────────────────────────────────────────
    if (admin.email) {
      const emailSlot = await reserve(supabase, tenantId, admin.id, frequency, 'email', pkey)
      if (emailSlot.error) {
        result.failed++
        await writeAuditLog(supabase, tenantId, 'DIGEST_FAILED', {
          frequency, channel: 'email', period_key: pkey,
          recipient_id: admin.id, error: emailSlot.error.message, stage: 'reserve',
        })
      } else if (emailSlot.owned) {
        const { subject, html } = digestEmail({
          frequency,
          periodLabel:  digest.period_label,
          summaryText:  execNarrative ?? digest.summary_text,
          metrics:      digest.metrics,
          companyName,
          appUrl:       APP_PUBLIC_URL,
        })
        const sent = await sendEmail({ to: admin.email, subject, html })
        if (sent.sent) {
          result.email++
          await writeAuditLog(supabase, tenantId, 'DIGEST_SENT', {
            frequency, channel: 'email', period_key: pkey,
            recipient_id: admin.id, resend_id: sent.id ?? null,
          })
        } else {
          result.failed++
          await writeAuditLog(supabase, tenantId, 'DIGEST_FAILED', {
            frequency, channel: 'email', period_key: pkey,
            recipient_id: admin.id, error: sent.error ?? 'send failed',
          })
        }
      }
    }
  }

  return result
}

// ── Scheduler tick ────────────────────────────────────────────────────────────

function isDue(frequency: DigestFrequency, now: Date): boolean {
  if (now.getUTCHours() < SEND_HOUR) return false
  if (frequency === 'daily')   return true
  if (frequency === 'weekly')  return now.getUTCDay() === 1   // Monday
  return now.getUTCDate() === 1                                // 1st of month
}

export async function tick(supabase: SupabaseClient): Promise<void> {
  const now = new Date()
  const due = ALL_FREQ.filter(f => isDue(f, now))
  if (!due.length) return

  const tenants = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    supabase.from('tenants').select('id, name').range(from, to),
  )
  for (const t of tenants) {
    for (const f of due) {
      try {
        const r = await runDigestForTenant(supabase, t.id, f, t.name)
        if (r.in_app + r.email > 0) {
          console.log(`[digest] ${f} tenant=${t.id} → ${r.in_app} in-app, ${r.email} email, ${r.failed} failed`)
        }
      } catch (e) {
        console.error(`[digest] ${f} tenant=${t.id} error:`, (e as Error).message)
      }
    }
  }
}

/**
 * Register the R9-minimal digest scheduler.
 * Call once at startup after the Supabase plugin is registered.
 */
export function registerDigestScheduler(supabase: SupabaseClient): void {
  const enqueue = () => {
    const key = `send-digest:${new Date().toISOString().slice(0, 13)}`
    durableQueue.enqueue('send-digest', {}, { idempotencyKey: key }).catch(
      e => console.error('[digest] enqueue error:', (e as Error).message),
    )
  }
  setTimeout(() => {
    enqueue()
    setInterval(enqueue, TICK_MS)
    console.log('📬 Digest scheduler active (R9-minimal) — daily/weekly/monthly to all HR admins')
  }, WARMUP_MS)
}
