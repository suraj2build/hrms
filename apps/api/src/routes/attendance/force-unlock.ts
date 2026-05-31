/**
 * POST /attendance/process/force-unlock
 *
 * Emergency escape hatch for a stuck processing lock.
 *
 * When should you use this?
 *   The processing lock gets "stuck" when a job crashed (API restart, OOM,
 *   timeout) WITHOUT running the finally-block release.  The table lock row
 *   stays is_running=true indefinitely because the TTL takeover only fires
 *   on the NEXT run attempt — which itself is blocked by the stuck lock.
 *
 * What it does:
 *   1. Force-resets the table lock (attendance_processing_lock.is_running = false).
 *   2. Attempts to release the advisory lock via the standard RPC — this only
 *      works if the RPC lands on the same PostgreSQL session that originally
 *      acquired the lock.  In PgBouncer transaction-mode this is not guaranteed,
 *      so the advisory lock may remain until that session is recycled by the
 *      pool (typically a few minutes).  The ghost advisory lock is now handled
 *      automatically by the ghost-detection logic in POST /attendance/process.
 *
 * Access: super_admin and hr_admin only.
 * Audit:  the action is written to the server log with the acting user's id.
 */

import type { FastifyInstance } from 'fastify'
import type { SupabaseClient }  from '@supabase/supabase-js'

async function resetTableLock(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('attendance_processing_lock')
    .update({ is_running: false, started_at: null, started_by: null })
    .eq('tenant_id', tenantId)
    .select('tenant_id')

  if (error) throw new Error(`Table lock reset failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

async function tryReleaseAdvisoryLock(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  try {
    await supabase.rpc('release_attendance_advisory_lock', { p_tenant_id: tenantId })
    return true
  } catch {
    return false  // non-fatal — ghost detection in process.ts handles residual lock
  }
}

export default async function forceUnlockRoute(fastify: FastifyInstance) {
  fastify.post(
    '/attendance/process/force-unlock',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
      }

      const tenantId = req.tenantId
      const userId   = req.userId

      req.log.warn(
        { tenantId, userId, module: 'attendance', route: 'force-unlock' },
        'force-unlock requested — clearing stuck processing lock',
      )

      // 1. Read current lock state for the response summary
      const { data: lockBefore } = await fastify.supabase
        .from('attendance_processing_lock')
        .select('is_running, started_at, started_by, lock_ttl_seconds')
        .eq('tenant_id', tenantId)
        .maybeSingle()

      // 2. Force-reset table lock
      const tableReset = await resetTableLock(fastify.supabase, tenantId).catch((e: Error) => {
        req.log.error({ err: e, module: 'attendance', route: 'force-unlock' }, 'table lock reset failed')
        return false
      })

      // 3. Best-effort advisory lock release (may be no-op under PgBouncer)
      const advisoryReleased = await tryReleaseAdvisoryLock(fastify.supabase, tenantId)

      req.log.warn(
        { tenantId, userId, tableReset, advisoryReleased, module: 'attendance', route: 'force-unlock' },
        'force-unlock completed',
      )

      return reply.send({
        success:           tableReset,
        table_lock_reset:  tableReset,
        advisory_released: advisoryReleased,
        advisory_note: advisoryReleased
          ? 'Advisory lock released on this connection.'
          : 'Advisory lock release sent but may be a no-op under PgBouncer transaction-mode. ' +
            'The ghost-lock detection in the processor will bypass it automatically on the next run.',
        previous_lock: lockBefore ?? null,
      })
    },
  )
}
