/**
 * POST /attendance/process
 *
 * Triggers the attendance processor for a given date (or today by default).
 * Protected — requires hr_admin or super_admin.
 *
 * Locking strategy (two layers):
 *
 *  Layer 1 — PostgreSQL advisory lock (cross-instance, session-level)
 *    Acquired first via pg_try_advisory_lock RPC.  If false → 409.
 *    Released in finally.  Primary protection in multi-instance deployments
 *    without transaction-mode connection pooling.
 *
 *  Layer 2 — Table lock (attendance_processing_lock)
 *    Primary signal visible to all DB clients (dashboards, monitoring).
 *    Supports TTL-based takeover: if is_running=true and started_at is older
 *    than lock_ttl_seconds (default 900 s), the lock is considered stale
 *    (crashed job) and the current caller takes over.
 *
 * Both locks released unconditionally in the finally block.
 */
import type { FastifyInstance } from 'fastify'
import type { SupabaseClient }  from '@supabase/supabase-js'
import { z } from 'zod'
import { processAttendanceForDate, writeFailedAuditRun } from '../../lib/attendance-processor.js'
import { isMonthLocked, monthOf } from '../../lib/period-lock.js'

const bodySchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  force: z.boolean().optional().default(false),  // Step 2: bypass date-level guard
})

// ── Layer 1: Advisory lock ────────────────────────────────────────────────────

async function acquireAdvisoryLock(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data, error } = await supabase
    .rpc('acquire_attendance_advisory_lock', { p_tenant_id: tenantId })
  if (error) throw new Error(`Advisory lock RPC failed: ${error.message}`)
  return data === true
}

async function releaseAdvisoryLock(supabase: SupabaseClient, tenantId: string): Promise<void> {
  await supabase.rpc('release_attendance_advisory_lock', { p_tenant_id: tenantId })
}

// ── Ghost advisory lock detection ────────────────────────────────────────────
// When pg_try_advisory_lock returns false the lock is held by a PostgreSQL
// session.  In Supabase (PgBouncer transaction-mode), the release RPC runs on a
// DIFFERENT connection than the one that acquired the lock, so the release is a
// silent no-op — the lock stays on the original session until that connection is
// recycled by the pool.  This creates a "ghost" advisory lock that blocks all
// subsequent runs indefinitely.
//
// Recovery: read the table lock.  If it is NOT running, or IS running but past
// its TTL, the previous job is definitely gone and the advisory lock is a ghost.
// In that case we fall through to the table-lock layer, which handles TTL
// takeover itself.  Only reject 409 when the table lock shows an ACTIVE run
// still within its TTL — meaning a real concurrent process is genuinely running.

async function isAdvisoryLockGhost(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<boolean> {
  const { data: row } = await supabase
    .from('attendance_processing_lock')
    .select('is_running, started_at, lock_ttl_seconds')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!row || !row.is_running || !row.started_at) return true  // table says not running → ghost

  const ageMs = Date.now() - new Date(row.started_at).getTime()
  const ttlMs = (row.lock_ttl_seconds ?? 900) * 1_000
  return ageMs > ttlMs  // table lock stale → ghost
}

// ── Layer 2: Table lock with TTL takeover ─────────────────────────────────────

/**
 * Attempts to acquire the table-based processing lock.
 *
 * Normal path:  UPDATE WHERE is_running = false → succeeds (0→1 rows updated).
 * TTL takeover: if is_running = true but started_at < now() - lock_ttl_seconds,
 *               the previous job is considered crashed → force-update and log.
 *
 * Returns true if lock was acquired (normally or via takeover), false otherwise.
 */
async function acquireTableLock(
  supabase:  SupabaseClient,
  tenantId:  string,
  startedBy: string,
  log:       { warn: (obj: object, msg: string) => void },
): Promise<boolean> {
  const now = new Date().toISOString()

  // Ensure lock row exists (seeded by migration; safe to re-upsert)
  await supabase
    .from('attendance_processing_lock')
    .upsert({ tenant_id: tenantId, is_running: false }, { onConflict: 'tenant_id', ignoreDuplicates: true })

  // 1. Try clean acquire (is_running = false)
  const { data: normal, error: normalErr } = await supabase
    .from('attendance_processing_lock')
    .update({ is_running: true, started_at: now, started_by: startedBy })
    .eq('tenant_id', tenantId)
    .eq('is_running', false)
    .select('tenant_id')

  if (normalErr) throw new Error(`Table lock acquire failed: ${normalErr.message}`)
  if (Array.isArray(normal) && normal.length > 0) return true   // clean acquire

  // 2. Lock is held — read the row and check TTL
  const { data: lockRow, error: readErr } = await supabase
    .from('attendance_processing_lock')
    .select('started_at, lock_ttl_seconds')
    .eq('tenant_id', tenantId)
    .single()

  if (readErr) throw new Error(`Table lock read failed: ${readErr.message}`)
  if (!lockRow?.started_at) return false   // no timestamp → held but no info, don't take over

  const ageMs = Date.now() - new Date(lockRow.started_at).getTime()
  const ttlMs = (lockRow.lock_ttl_seconds ?? 900) * 1_000

  if (ageMs <= ttlMs) return false   // still within TTL — genuinely in progress

  // 3. TTL expired → stale lock (crashed previous job) — force takeover
  log.warn(
    { tenant_id: tenantId, lock_age_ms: ageMs, ttl_ms: ttlMs },
    'stale processing lock detected (TTL expired) — taking over',
  )

  const { data: takeover, error: takeoverErr } = await supabase
    .from('attendance_processing_lock')
    .update({ is_running: true, started_at: now, started_by: startedBy })
    .eq('tenant_id', tenantId)
    .select('tenant_id')

  if (takeoverErr) throw new Error(`Table lock takeover failed: ${takeoverErr.message}`)
  return Array.isArray(takeover) && takeover.length > 0
}

async function releaseTableLock(supabase: SupabaseClient, tenantId: string): Promise<void> {
  await supabase
    .from('attendance_processing_lock')
    .update({ is_running: false, started_at: null, started_by: null })
    .eq('tenant_id', tenantId)
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function processRoute(fastify: FastifyInstance) {
  fastify.post(
    '/attendance/process',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
      }

      const parsed = bodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      const date     = parsed.data.date  ?? new Date().toISOString().slice(0, 10)
      const force    = parsed.data.force ?? false
      const tenantId = req.tenantId
      const userId   = req.userId

      // ── Period protection ─────────────────────────────────────────────────────
      // A locked/finalized month must not be re-processed — that would overwrite
      // the attendance the payroll run was built on.
      if (await isMonthLocked(fastify.supabase, tenantId, monthOf(date))) {
        return reply.code(409).send({
          error:   'PERIOD_LOCKED',
          message: `Attendance period ${monthOf(date)} is locked for payroll — no changes allowed.`,
        })
      }

      // ── Step 2: Date-level guard ──────────────────────────────────────────────
      // Block accidental repeated runs for the same date unless force=true.
      if (!force) {
        const { data: existingRun } = await fastify.supabase
          .from('attendance_processing_runs')
          .select('id, completed_at, error_message')
          .eq('tenant_id', tenantId)
          .eq('date', date)
          .not('completed_at', 'is', null)   // only completed runs count
          .is('error_message', null)          // ignore failed runs — allow retry
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existingRun) {
          return reply.code(409).send({
            error:        'ALREADY_PROCESSED',
            message:      `Attendance for ${date} was already processed successfully. Send force=true to override.`,
            existing_run: existingRun.id,
            completed_at: existingRun.completed_at,
          })
        }
      }

      // Track which locks were acquired so finally only releases what it holds
      let advisoryAcquired  = false
      let advisoryRpcFailed = false   // RPC infrastructure failure vs. lock genuinely held
      let tableAcquired     = false

      // ── Layer 1: Advisory lock ──────────────────────────────────────────────
      // acquireAdvisoryLock returns false when the lock IS held (another instance running).
      // It throws when the RPC itself fails (DB connection, function missing, etc.).
      // These two cases must be treated differently:
      //   false → 409 ALREADY_RUNNING (another job is genuinely running)
      //   throw → fall through to table lock (infrastructure error, not a running job)
      try {
        advisoryAcquired = await acquireAdvisoryLock(fastify.supabase, tenantId)
      } catch (err) {
        req.log.error(
          { err, module: 'attendance', route: 'process' },
          'advisory lock RPC error — advisory lock unavailable, falling through to table lock',
        )
        advisoryRpcFailed = true
      }

      // Lock held by another instance — but check for ghost before rejecting.
      // PgBouncer transaction-mode sends the release RPC to a different session,
      // so pg_advisory_unlock is a no-op and the lock lingers on the dead session.
      // Ghost check: if the table lock is stale or not running, the advisory lock
      // belongs to a crashed job → fall through to table-lock TTL takeover.
      if (!advisoryAcquired && !advisoryRpcFailed) {
        const ghost = await isAdvisoryLockGhost(fastify.supabase, tenantId).catch(() => false)
        if (!ghost) {
          return reply.code(409).send({
            error:   'ALREADY_RUNNING',
            message: 'Attendance processing is already running for this tenant. Try again shortly.',
          })
        }
        req.log.warn(
          { tenantId, module: 'attendance', route: 'process' },
          'ghost advisory lock detected (PgBouncer session leak) — table lock stale, falling through to TTL takeover',
        )
        // advisoryAcquired stays false — finally block skips advisory release (correct)
      }

      // ── Layer 2: Table lock (with TTL takeover) ─────────────────────────────
      try {
        tableAcquired = await acquireTableLock(
          fastify.supabase, tenantId, userId,
          { warn: (obj, msg) => req.log.warn({ ...obj, module: 'attendance', route: 'process' }, msg) },
        )
      } catch (err) {
        req.log.error({ err, module: 'attendance', route: 'process' }, 'table lock acquire error')
        // Release advisory lock we already hold before returning
        if (advisoryAcquired) await releaseAdvisoryLock(fastify.supabase, tenantId).catch(() => undefined)
        return reply.code(500).send({ error: 'LOCK_ERROR', message: 'Could not acquire processing lock' })
      }

      if (!tableAcquired) {
        if (advisoryAcquired) await releaseAdvisoryLock(fastify.supabase, tenantId).catch(() => undefined)
        return reply.code(409).send({
          error:   'ALREADY_RUNNING',
          message: 'Attendance processing is already running for this tenant. Try again shortly.',
        })
      }

      // ── Process ─────────────────────────────────────────────────────────────
      const processStart = Date.now()
      try {
        const result = await processAttendanceForDate(
          fastify.supabase,
          tenantId,
          date,
          req.log,
          userId,
        )
        return reply.send(result)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Attendance processing failed'
        req.log.error({ err, module: 'attendance', route: 'process', date }, 'processing failed')

        // Step 3: write a failure audit row so every run is traceable
        await writeFailedAuditRun(
          fastify.supabase, tenantId, date,
          errMsg, Date.now() - processStart,
          userId, req.log,
        ).catch(() => undefined)  // non-fatal

        return reply.code(500).send({ error: 'PROCESS_FAILED', message: errMsg })
      } finally {
        // ── Release both locks — always, even on error ──────────────────────
        if (tableAcquired) {
          await releaseTableLock(fastify.supabase, tenantId).catch((e) =>
            req.log.error({ err: e, module: 'attendance' }, 'table lock release failed')
          )
        }
        if (advisoryAcquired) {
          await releaseAdvisoryLock(fastify.supabase, tenantId).catch((e) =>
            req.log.error({ err: e, module: 'attendance' }, 'advisory lock release failed')
          )
        }
      }
    },
  )
}
