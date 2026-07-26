/**
 * user-account-service.ts
 *
 * revokeEmployeeAuth() closes AF-001 (ARCHITECTURE_FINDINGS.md): employee
 * lifecycle (`employees.status`) and authentication state (`profiles.is_active`
 * + Supabase Auth) are independent state machines with no automatic sync, so
 * a separated employee kept full HRMS login access indefinitely unless someone
 * separately, manually deactivated their account.
 *
 * Of the 5 code paths that set `employees.status = 'separated'`, only the
 * `relieve` step in separation-workflow.ts implemented revocation — inline,
 * not shared. This extracts that exact logic so the other 4 call the same
 * implementation: separation.ts (initiate + update), employees/index.ts
 * (soft-delete), and absconding-engine.ts (auto-separation).
 *
 * This is a consistency fix, not a new product decision: it applies the
 * revocation behavior already shipped for the relieve path to every other
 * place that reaches the same terminal `status = 'separated'` state, at the
 * same point in the flow. Open product questions the ARCHITECTURE_FINDINGS.md
 * plan raised (grace period, per-reason treatment) are unaffected — none of
 * the 5 paths has ever implemented a grace period; this brings the other 4
 * up to the relieve path's existing (immediate) behavior, not further.
 *
 * Takes a plain SupabaseClient (not FastifyInstance) so lib-layer callers
 * like absconding-engine.ts — which only ever receive a SupabaseClient, not
 * the fastify instance — can call it without threading fastify through.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

interface MinimalLogger {
  warn: (obj: unknown, msg?: string) => void
}

export async function revokeEmployeeAuth(
  supabase:   SupabaseClient,
  employeeId: string,
  tenantId:   string,
  log:        MinimalLogger = console,
): Promise<void> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!profile) return

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ is_active: false })
    .eq('id', profile.id)
    .eq('tenant_id', tenantId)
  if (profileErr) {
    log.warn(
      { err: profileErr, employeeId },
      'revokeEmployeeAuth: profile deactivation failed — is_active still true, auth ban attempted regardless',
    )
  }

  const { error: authErr } = await supabase.auth.admin.updateUserById(profile.id, {
    ban_duration: '876000h',
  })
  if (authErr) {
    log.warn(
      { err: authErr, employeeId },
      'revokeEmployeeAuth: auth ban failed — profile deactivated but JWT not immediately revoked',
    )
  }
}
