/**
 * Pilot-tenant guard — blocks real-money/statutory actions for an
 * invite-only friends pilot (tenants.is_pilot, migration 456).
 *
 * Deliberately narrow and opt-in per route — unlike the global write-gate
 * in plugins/auth.ts (which blocks ALL writes for a suspended/expired
 * tenant), a pilot tenant must still be able to write attendance, leave,
 * and payroll PREVIEW (dry_run) data normally. Only the specific actions
 * named in the pilot brief are blocked: payroll finalize/rollback,
 * statutory filing-pack generation/export, and payout-obligation
 * generation.
 *
 * FAIL-CLOSED on an unverifiable lookup (round 12 correction — this
 * previously failed OPEN, which is backwards for a financial-action gate:
 * "can't verify the tenant's pilot status" must never be treated as
 * equivalent to "verified not a pilot". If the lookup itself fails or
 * throws, the honest answer is "don't know, try again" — a temporary 503,
 * not a silent allow and not a permanent 403. No financial write may ever
 * happen on an unverified status.
 */
import type { FastifyReply } from 'fastify'

export const ErrorCode_PILOT_RESTRICTED = 'PILOT_TENANT_RESTRICTED'
export const ErrorCode_PILOT_CHECK_UNAVAILABLE = 'PILOT_STATUS_CHECK_UNAVAILABLE'

/**
 * Returns true and sends a response (403 if verified pilot, 503 if the
 * tenant's pilot status could not be verified) when the caller must stop
 * and perform no write — `return` immediately after a true result. Returns
 * false (no response sent) only once the tenant is confirmed NOT a pilot
 * tenant, by a successful lookup that found a row with is_pilot=false.
 */
export async function blockIfPilotTenant(
  supabase: any,
  tenantId: string,
  reply: FastifyReply,
  action: string,
): Promise<boolean> {
  const failClosed = () => {
    reply.code(503).send({
      error:   ErrorCode_PILOT_CHECK_UNAVAILABLE,
      message: `Could not verify this tenant's pilot status, so "${action}" was not performed. Please try again.`,
    })
    return true
  }

  let isPilot: boolean
  try {
    const result = await supabase
      .from('tenants')
      .select('is_pilot')
      .eq('id', tenantId)
      .maybeSingle()
    if (result.error || !result.data) return failClosed()

    // SYSTEM_AUDIT_2026-10-14 follow-up: `!!value` silently coerced ANY
    // non-boolean value into a verdict — `null`/`undefined` (a column that
    // exists but was never backfilled) read as "verified not a pilot" and
    // ALLOWED the restricted action; the non-empty string `"false"` would
    // have read as truthy and WRONGLY BLOCKED a real tenant. Neither is a
    // verification — only the literal boolean `false` may permit a
    // restricted action, and only the literal boolean `true` may block
    // one. Anything else (missing, null, or the wrong type entirely) is
    // exactly the "can't verify" case this function exists to fail closed
    // on, not a value to coerce into either outcome.
    const rawIsPilot = (result.data as { is_pilot: unknown }).is_pilot
    if (typeof rawIsPilot !== 'boolean') return failClosed()
    isPilot = rawIsPilot
  } catch {
    // Same fail-closed response for a thrown exception (e.g. a network
    // timeout) as for a clean {error} result above.
    return failClosed()
  }

  if (isPilot) {
    reply.code(403).send({
      error:   ErrorCode_PILOT_RESTRICTED,
      message: `${action} is disabled in this pilot environment. This is a test environment — no real payment, statutory filing, or production export is performed here.`,
    })
    return true
  }
  return false
}
