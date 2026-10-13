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
 */
import type { FastifyReply } from 'fastify'

export const ErrorCode_PILOT_RESTRICTED = 'PILOT_TENANT_RESTRICTED'

/**
 * Returns true and sends a 403 if this tenant is a pilot tenant — caller
 * should `return` immediately after a true result. Returns false (no
 * response sent) for every other tenant, including a query failure (fails
 * open on lookup error, since this is a restriction, not a security
 * boundary — the real safety requirement is "never block a real tenant's
 * real payroll action because of a transient DB error").
 */
export async function blockIfPilotTenant(
  supabase: any,
  tenantId: string,
  reply: FastifyReply,
  action: string,
): Promise<boolean> {
  let isPilot = false
  try {
    const result = await supabase
      .from('tenants')
      .select('is_pilot')
      .eq('id', tenantId)
      .maybeSingle()
    if (result.error || !result.data) return false
    isPilot = !!(result.data as { is_pilot: boolean }).is_pilot
  } catch {
    // Fails open — a lookup failure (including a test double that doesn't
    // stub the 'tenants' table) must never crash or block a real tenant's
    // real payroll action.
    return false
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
