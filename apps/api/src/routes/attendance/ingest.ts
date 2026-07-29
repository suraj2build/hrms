/**
 * POST /attendance/ingest
 *
 * Public endpoint — authenticated by device api_key in the request body,
 * NOT by JWT. Register BEFORE authPlugin in index.ts.
 *
 * Accepts a batch of raw punch events from a biometric device and inserts
 * them into attendance_raw_logs. No processing — fast insert only.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const logSchema = z.object({
  employee_code: z.string().min(1).max(50),
  timestamp:     z.string().datetime({ offset: true }),
  direction:     z.enum(['in', 'out']),
})

const bodySchema = z.object({
  api_key: z.string().min(1),
  logs:    z.array(logSchema).min(1).max(1000),
})

export default async function ingestRoute(fastify: FastifyInstance) {
  fastify.post('/attendance/ingest', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { api_key, logs } = parsed.data

    // ── 1. Validate device ──────────────────────────────────────────────────
    const { data: device, error: deviceError } = await fastify.supabase
      .from('attendance_devices')
      .select('id, tenant_id')
      .eq('api_key', api_key)
      .eq('is_active', true)
      .single()

    if (deviceError || !device) {
      req.log.warn({ module: 'attendance', route: 'ingest' }, 'unknown or inactive device')
      return reply.code(401).send({
        error: 'INVALID_DEVICE',
        message: 'Unknown or inactive device',
      })
    }

    // ── 2. Bulk insert raw logs ─────────────────────────────────────────────
    const rows = logs.map((log) => ({
      tenant_id:     device.tenant_id,
      device_id:     device.id,
      employee_code: log.employee_code,
      timestamp:     log.timestamp,
      direction:     log.direction,
    }))

    // Upsert (not insert) so a re-POSTed device batch — network retry or device
    // replay — does not duplicate raw punches and inflate computed hours/OT.
    // Dedupe key matches uidx_raw_logs_dedup (migration 284).
    // `.select('id')` is required to get the true inserted count — with
    // ignoreDuplicates, Postgres's RETURNING only reports rows actually
    // written, never the ones skipped by ON CONFLICT DO NOTHING. Without it,
    // the response/log previously reported rows.length (the submitted batch
    // size) even when most of the batch was a duplicate replay, hiding
    // exactly the dedup outcome this endpoint exists to report accurately.
    const { data: insertedRows, error: insertError } = await fastify.supabase
      .from('attendance_raw_logs')
      .upsert(rows, { onConflict: 'tenant_id,employee_code,timestamp,direction', ignoreDuplicates: true })
      .select('id')

    if (insertError) {
      req.log.error(
        { err: insertError, module: 'attendance', route: 'ingest', count: rows.length },
        'raw log insert failed',
      )
      return reply.code(500).send({
        error: 'INSERT_FAILED',
        message: 'Failed to store attendance logs',
      })
    }

    const insertedCount = insertedRows?.length ?? 0

    req.log.info(
      { module: 'attendance', route: 'ingest', tenant_id: device.tenant_id, received: rows.length, inserted: insertedCount },
      'raw logs ingested',
    )

    return reply.code(201).send({ received: rows.length, inserted: insertedCount })
  })
}
