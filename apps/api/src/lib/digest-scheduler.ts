/**
 * Digest Scheduler (R9) — the last-mile delivery the audit found missing.
 *
 * Pushes the daily/weekly/monthly workforce digest to each tenant's HR admins
 * on a cadence, honouring per-user preferences and de-duplicating via
 * digest_send_log. Reuses the already-audited, tenant-safe primitives:
 *   - per-tenant loop (SELECT id FROM tenants → per-tenant build)
 *   - tenant-scoped HR recipient resolution (profiles role in super_admin/hr_admin)
 *   - notifications insert (in-app)  +  sendEmail (email)
 *
 * Multi-tenant safety: every query carries tenant_id; recipients and digests are
 * resolved within one tenant before any delivery. A send is reserved in
 * digest_send_log BEFORE delivery so concurrent ticks / instances cannot
 * double-send (UNIQUE(tenant, recipient, frequency, channel, period_key)).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDigest, periodKey, type DigestFrequency } from './digest-builder.js'
import { sendEmail, digestEmail } from './email-service.js'

const TICK_MS       = 60 * 60 * 1000   // hourly — period_key dedup makes precise timing unnecessary
const WARMUP_MS     = 6 * 60 * 1000    // 6-minute warm-up after startup
const SEND_HOUR_UTC = 6                // don't push before 06:00 UTC

// Default subscription when a user has no explicit preference row.
// Weekly + monthly land in-app by default; daily and all email are opt-in.
const DEFAULT_PREFS: Record<DigestFrequency, { in_app: boolean; email: boolean }> = {
  daily:   { in_app: false, email: false },
  weekly:  { in_app: true,  email: false },
  monthly: { in_app: true,  email: false },
}

const ALL_FREQ: DigestFrequency[] = ['daily', 'weekly', 'monthly']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface RecipientPref { in_app: boolean; email: boolean }

async function effectivePrefs(
  supabase: SupabaseClient, tenantId: string, userIds: string[], frequency: DigestFrequency,
): Promise<Record<string, RecipientPref>> {
  const out: Record<string, RecipientPref> = {}
  for (const id of userIds) out[id] = { ...DEFAULT_PREFS[frequency] }
  const { data } = await supabase
    .from('user_notification_preferences')
    .select('user_id, channel, enabled')
    .eq('tenant_id', tenantId)
    .eq('frequency', frequency)
    .in('user_id', userIds)
  for (const r of (data ?? []) as any[]) {
    if (!out[r.user_id]) continue
    if (r.channel === 'in_app') out[r.user_id].in_app = r.enabled
    if (r.channel === 'email')  out[r.user_id].email  = r.enabled
  }
  return out
}

/** Reserve a send slot. Returns true if THIS call won the slot (so it must deliver). */
async function reserve(
  supabase: SupabaseClient, tenantId: string, recipientId: string,
  frequency: DigestFrequency, channel: 'in_app' | 'email', pkey: string, force: boolean,
): Promise<boolean> {
  const key = force ? `${pkey}:force:${Date.now().toString(36)}` : pkey
  const { error } = await supabase.from('digest_send_log').insert({
    tenant_id: tenantId, recipient_id: recipientId, frequency, channel, period_key: key, status: 'sent',
  })
  // Unique-violation (23505) → already sent this period → not our slot.
  return !error
}

export interface DigestRunResult { recipients: number; in_app: number; email: number; skipped: number }

/**
 * Build the digest for one tenant + frequency and deliver it to each HR admin
 * per their effective preferences. Idempotent per period unless force=true.
 */
export async function runDigestForTenant(
  supabase: SupabaseClient, tenantId: string, frequency: DigestFrequency,
  opts: { force?: boolean; companyName?: string } = {},
): Promise<DigestRunResult> {
  const result: DigestRunResult = { recipients: 0, in_app: 0, email: 0, skipped: 0 }

  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['super_admin', 'hr_admin'])
    .eq('is_active', true)
  const adminIds = (admins ?? []).map((a: any) => a.id)
  if (!adminIds.length) return result
  result.recipients = adminIds.length

  const prefs  = await effectivePrefs(supabase, tenantId, adminIds, frequency)
  const pkey   = periodKey(frequency)
  const digest = await buildDigest(supabase, tenantId, frequency)
  const force  = opts.force === true

  for (const uid of adminIds) {
    const p = prefs[uid]

    // ── In-app ──
    if (p.in_app) {
      if (await reserve(supabase, tenantId, uid, frequency, 'in_app', pkey, force)) {
        const { error } = await supabase.from('notifications').insert({
          tenant_id:    tenantId,
          recipient_id: uid,
          title:        `${cap(frequency)} workforce digest`,
          body:         digest.summary_text,
          link:         '/admin/insights',
          event_id:     `digest:${frequency}:${pkey}`,
        })
        if (error) result.skipped++; else result.in_app++
      } else { result.skipped++ }
    }

    // ── Email ──
    if (p.email) {
      if (await reserve(supabase, tenantId, uid, frequency, 'email', pkey, force)) {
        try {
          const { data: u } = await supabase.auth.admin.getUserById(uid)
          const email = u?.user?.email
          if (email) {
            const { subject, html } = digestEmail({
              frequency, periodLabel: digest.period_label,
              summaryText: digest.summary_text, metrics: digest.metrics,
              companyName: opts.companyName,
            })
            const res = await sendEmail({ to: email, subject, html })
            if (res.sent) result.email++; else result.skipped++
          } else { result.skipped++ }
        } catch { result.skipped++ }
      } else { result.skipped++ }
    }
  }

  return result
}

function isDue(frequency: DigestFrequency, now: Date): boolean {
  if (now.getUTCHours() < SEND_HOUR_UTC) return false
  if (frequency === 'daily')   return true
  if (frequency === 'weekly')  return now.getUTCDay() === 1   // Monday
  return now.getUTCDate() === 1                                // monthly: 1st
}

async function tick(supabase: SupabaseClient): Promise<void> {
  const now = new Date()
  const due = ALL_FREQ.filter(f => isDue(f, now))
  if (!due.length) return

  const { data: tenants } = await supabase.from('tenants').select('id, name')
  for (const t of (tenants ?? []) as any[]) {
    for (const f of due) {
      try {
        await runDigestForTenant(supabase, t.id, f, { companyName: t.name })
      } catch (e) {
        console.error(`[digest-scheduler] ${f} tenant=${t.id} error:`, (e as Error).message)
      }
    }
  }
}

/**
 * Register the digest scheduler. Call once at startup after the Supabase plugin
 * is registered. Wrapped in safeRegisterModule by the caller — must not throw.
 */
export function registerDigestScheduler(supabase: SupabaseClient): void {
  setTimeout(() => {
    tick(supabase).catch(e => console.error('[digest-scheduler] initial tick error:', (e as Error).message))
    setInterval(
      () => tick(supabase).catch(e => console.error('[digest-scheduler] tick error:', (e as Error).message)),
      TICK_MS,
    )
    console.log('📬 Digest scheduler active — daily/weekly/monthly push to HR admins')
  }, WARMUP_MS)
}
