/**
 * Enterprise Event Governance API
 *
 * Provides full observability and operational control over the platform event log,
 * replay queue, and retention policy configuration.
 *
 * GET    /system/event-governance/log                     — paginated event log query
 * GET    /system/event-governance/log/:eventId            — single event detail
 * GET    /system/event-governance/timeline                — correlated event chain
 * POST   /system/event-governance/replay                  — enqueue event replay (super_admin)
 * GET    /system/event-governance/replay-queue            — inspect replay queue (admin)
 * PUT    /system/event-governance/replay-queue/:id/cancel — cancel pending replay (admin)
 * GET    /system/event-governance/retention-rules         — list retention policies
 * POST   /system/event-governance/retention-rules         — upsert retention rule (super_admin)
 * DELETE /system/event-governance/retention-rules/:id     — soft-delete rule (super_admin)
 * GET    /system/event-governance/stats                   — aggregate event metrics (admin)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

// ── Query / body schemas ──────────────────────────────────────────────────────

const logQuerySchema = z.object({
  event_type:     z.string().optional(),
  from:           z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/).optional(),
  to:             z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/).optional(),
  status:         z.string().optional(),
  correlation_id: z.string().uuid().optional(),
  limit:          z.coerce.number().int().min(1).max(500).default(100),
  offset:         z.coerce.number().int().min(0).default(0),
})

const timelineQuerySchema = z.object({
  correlation_id: z.string().uuid(),
})

const replayBodySchema = z.object({
  event_log_id: z.string().uuid(),
  reason:       z.string().min(1).max(1000),
})

const replayQueueQuerySchema = z.object({
  status: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
})

const retentionRuleBodySchema = z.object({
  event_type:        z.string().max(255).optional(),
  retention_days:    z.number().int().positive(),
  archive_after_days: z.number().int().positive().optional(),
})

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function eventGovernanceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /system/event-governance/log ───────────────────────────────────────
  // Paginated, filterable view of the event_log table with actor names resolved
  // from the profiles table.
  fastify.get('/system/event-governance/log', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = logQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { event_type, from, to, status, correlation_id, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('event_log')
      .select(
        `
        id,
        event_type,
        status,
        correlation_id,
        actor_id,
        payload,
        last_error,
        metadata,
        created_at,
        profiles!event_log_actor_id_fkey(id, full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (event_type)     q = q.eq('event_type', event_type)
    if (status)         q = q.eq('status', status)
    if (correlation_id) q = q.eq('correlation_id', correlation_id)
    if (from)           q = q.gte('created_at', from)
    if (to)             q = q.lte('created_at', to)

    let { data, error, count } = await q

    // Resilience: the embedded FK join (profiles!event_log_actor_id_fkey) or
    // optional columns may be absent on a drifted DB. Retry with a minimal
    // select before giving up, then degrade to an empty feed (never 500 the
    // Control Center over a non-critical audit widget).
    if (error) {
      const retry = await fastify.supabase
        .from('event_log')
        .select('id, event_type, status, correlation_id, actor_id, payload, created_at', { count: 'exact' })
        .eq('tenant_id', req.tenantId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (retry.error) {
        req.log.warn({ err: retry.error }, 'event_log query failed — returning empty feed')
        return reply.send({ data: [], total: 0, limit, offset })
      }
      data  = retry.data as any
      count = retry.count
    }

    const rows = (data ?? []).map((r: any) => ({
      id:             r.id,
      event_type:     r.event_type,
      status:         r.status,
      correlation_id: r.correlation_id,
      actor_id:       r.actor_id,
      actor_name:     r.profiles?.full_name ?? null,
      payload:        r.payload,
      error:          r.last_error ?? null,
      metadata:       r.metadata,
      created_at:     r.created_at,
    }))

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── GET /system/event-governance/log/:eventId ──────────────────────────────
  // Fetch the full detail of a single event_log row.
  fastify.get('/system/event-governance/log/:eventId', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { eventId } = req.params as { eventId: string }

    const { data, error } = await fastify.supabase
      .from('event_log')
      .select(
        `
        id,
        event_type,
        status,
        correlation_id,
        actor_id,
        payload,
        last_error,
        metadata,
        created_at,
        profiles!event_log_actor_id_fkey(id, full_name)
        `,
      )
      .eq('tenant_id', req.tenantId)
      .eq('id', eventId)
      .maybeSingle()

    if (error) {
      req.log.error({ err: error, eventId }, 'event_log single fetch failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch event' })
    }

    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Event '${eventId}' not found` })
    }

    const event = {
      id:             data.id,
      event_type:     (data as any).event_type,
      status:         (data as any).status,
      correlation_id: (data as any).correlation_id,
      actor_id:       (data as any).actor_id,
      actor_name:     (data as any).profiles?.full_name ?? null,
      payload:        (data as any).payload,
      error:          (data as any).last_error ?? null,
      metadata:       (data as any).metadata,
      created_at:     (data as any).created_at,
    }

    return reply.send({ data: event })
  })

  // ── GET /system/event-governance/timeline ──────────────────────────────────
  // Fetch the full ordered chain of events sharing a correlation_id. Useful for
  // tracing distributed workflows end-to-end.
  fastify.get('/system/event-governance/timeline', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = timelineQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'correlation_id (UUID) is required',
      })
    }

    const { correlation_id } = parsed.data

    const { data, error } = await fastify.supabase
      .from('event_log')
      .select(
        `
        id,
        event_type,
        status,
        actor_id,
        payload,
        last_error,
        metadata,
        created_at,
        profiles!event_log_actor_id_fkey(id, full_name)
        `,
      )
      .eq('tenant_id', req.tenantId)
      .eq('correlation_id', correlation_id)
      .order('created_at', { ascending: true })

    if (error) {
      req.log.error({ err: error, correlation_id }, 'event timeline query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch event timeline' })
    }

    const events = (data ?? []).map((r: any) => ({
      id:         r.id,
      event_type: r.event_type,
      status:     r.status,
      actor_id:   r.actor_id,
      actor_name: r.profiles?.full_name ?? null,
      payload:    r.payload,
      error:      r.last_error ?? null,
      metadata:   r.metadata,
      created_at: r.created_at,
    }))

    return reply.send({ correlation_id, events })
  })

  // ── POST /system/event-governance/replay ───────────────────────────────────
  // Enqueue an event for replay. Inserts a row into event_replay_queue so the
  // background worker can re-process it. Restricted to super_admin.
  fastify.post('/system/event-governance/replay', auth, async (req: any, reply) => {
    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
    }

    const parsed = replayBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { event_log_id, reason } = parsed.data

    // Verify the event exists and belongs to this tenant before enqueueing.
    const { data: eventRow, error: eventErr } = await fastify.supabase
      .from('event_log')
      .select('id, event_type, status')
      .eq('tenant_id', req.tenantId)
      .eq('id', event_log_id)
      .maybeSingle()

    if (eventErr) {
      req.log.error({ err: eventErr, event_log_id }, 'event lookup for replay failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to verify event' })
    }

    if (!eventRow) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Event '${event_log_id}' not found` })
    }

    const { data: replayRow, error: insertErr } = await fastify.supabase
      .from('event_replay_queue')
      .insert({
        tenant_id:    req.tenantId,
        event_log_id,
        requested_by: req.userId,
        reason,
        status:       'pending',
      })
      .select()
      .single()

    if (insertErr) {
      req.log.error({ err: insertErr, event_log_id }, 'event replay queue insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to enqueue replay request' })
    }

    req.log.info(
      { replayId: replayRow.id, event_log_id, requestedBy: req.userId },
      'event replay enqueued',
    )

    return reply.code(201).send({ data: replayRow })
  })

  // ── GET /system/event-governance/replay-queue ──────────────────────────────
  // View the current state of the event replay queue. Joins to event_log for
  // event context and profiles for the requesting actor's name.
  fastify.get('/system/event-governance/replay-queue', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = replayQueueQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { status, limit } = parsed.data

    let q = fastify.supabase
      .from('event_replay_queue')
      .select(
        `
        id,
        status,
        reason,
        requested_by,
        created_at,
        updated_at,
        event_log!event_replay_queue_event_log_id_fkey(
          id, event_type, status, created_at
        ),
        profiles!event_replay_queue_requested_by_fkey(id, full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) q = q.eq('status', status)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'replay queue query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch replay queue' })
    }

    const rows = (data ?? []).map((r: any) => ({
      id:              r.id,
      status:          r.status,
      reason:          r.reason,
      requested_by:    r.requested_by,
      requester_name:  r.profiles?.full_name ?? null,
      created_at:      r.created_at,
      updated_at:      r.updated_at,
      event: r.event_log
        ? {
            id:         r.event_log.id,
            event_type: r.event_log.event_type,
            status:     r.event_log.status,
            created_at: r.event_log.created_at,
          }
        : null,
    }))

    return reply.send({ data: rows, total: count ?? 0 })
  })

  // ── PUT /system/event-governance/replay-queue/:id/cancel ──────────────────
  // Cancel a pending replay request. Only pending replays may be cancelled;
  // replays already in-flight or completed are rejected.
  fastify.put('/system/event-governance/replay-queue/:id/cancel', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    // Fetch first to confirm it exists, belongs to tenant, and is cancellable.
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('event_replay_queue')
      .select('id, status')
      .eq('tenant_id', req.tenantId)
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) {
      req.log.error({ err: fetchErr, id }, 'replay queue fetch for cancel failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch replay request' })
    }

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Replay request '${id}' not found` })
    }

    if ((existing as any).status !== 'pending') {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: `Cannot cancel replay in status '${(existing as any).status}' — only pending replays may be cancelled`,
      })
    }

    const { data: updated, error: updateErr } = await fastify.supabase
      .from('event_replay_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('tenant_id', req.tenantId)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      req.log.error({ err: updateErr, id }, 'replay queue cancel update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to cancel replay request' })
    }

    req.log.info({ replayId: id, cancelledBy: req.userId }, 'event replay request cancelled')

    return reply.send({ data: updated })
  })

  // ── GET /system/event-governance/retention-rules ──────────────────────────
  // List all active event retention rules. Available to all authenticated admins.
  fastify.get('/system/event-governance/retention-rules', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { data, error } = await fastify.supabase
      .from('event_retention_rules')
      .select('id, event_type, retention_days, archive_after_days, is_active, created_at, updated_at')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .order('event_type', { ascending: true })

    if (error) {
      req.log.error({ err: error }, 'retention rules query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch retention rules' })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /system/event-governance/retention-rules ─────────────────────────
  // Upsert a retention rule. If a rule for the given event_type (or the
  // catch-all null event_type) already exists it is updated; otherwise a new
  // row is inserted. Restricted to super_admin.
  fastify.post('/system/event-governance/retention-rules', auth, async (req: any, reply) => {
    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
    }

    const parsed = retentionRuleBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { event_type, retention_days, archive_after_days } = parsed.data

    const upsertPayload: Record<string, unknown> = {
      tenant_id:      req.tenantId,
      retention_days,
      is_active:      true,
      updated_at:     new Date().toISOString(),
    }
    if (event_type !== undefined)        upsertPayload.event_type         = event_type
    if (archive_after_days !== undefined) upsertPayload.archive_after_days = archive_after_days

    const { data, error } = await fastify.supabase
      .from('event_retention_rules')
      .upsert(upsertPayload, { onConflict: 'tenant_id,event_type' })
      .select()
      .single()

    if (error) {
      req.log.error({ err: error }, 'retention rule upsert failed')
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to save retention rule' })
    }

    req.log.info(
      { ruleId: data.id, event_type: event_type ?? '(all)', retention_days, createdBy: req.userId },
      'event retention rule upserted',
    )

    return reply.code(201).send({ data })
  })

  // ── DELETE /system/event-governance/retention-rules/:id ───────────────────
  // Soft-delete a retention rule by setting is_active = false.
  // Hard deletes are intentionally avoided to preserve audit history.
  fastify.delete('/system/event-governance/retention-rules/:id', auth, async (req: any, reply) => {
    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('event_retention_rules')
      .select('id, is_active')
      .eq('tenant_id', req.tenantId)
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) {
      req.log.error({ err: fetchErr, id }, 'retention rule fetch for delete failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch retention rule' })
    }

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Retention rule '${id}' not found` })
    }

    const { error: updateErr } = await fastify.supabase
      .from('event_retention_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', req.tenantId)
      .eq('id', id)

    if (updateErr) {
      req.log.error({ err: updateErr, id }, 'retention rule soft-delete failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to deactivate retention rule' })
    }

    req.log.info({ ruleId: id, deletedBy: req.userId }, 'event retention rule soft-deleted')

    return reply.code(200).send({ message: `Retention rule '${id}' deactivated successfully` })
  })

  // ── GET /system/event-governance/stats ────────────────────────────────────
  // Returns three aggregated views over the event_log:
  //   • by_status     — total count per status value
  //   • by_type       — top 10 event_type by volume
  //   • daily_volume  — event count per calendar day for the last 7 days
  //
  // All aggregations are tenant-scoped. Relies on Supabase RPC or falling back
  // to in-process aggregation when raw SQL RPCs are unavailable.
  fastify.get('/system/event-governance/stats', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const tenantId = req.tenantId

    // Fetch all event_log rows for the last 7 days in one call, then aggregate
    // in-process. This avoids requiring custom DB functions and keeps the
    // approach consistent with the rest of the codebase.
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // event_log grows continuously and readily exceeds PostgREST's 1000-row
    // cap for any active tenant — a plain .select() here previously silently
    // truncated by_status/by_type to whatever the most recent 1000 rows were.
    let statusRows: any[], typeRows: any[], dailyRows: any[]
    try {
      ;[statusRows, typeRows, dailyRows] = await Promise.all([
        // Count by status — no date restriction, gives lifetime totals.
        fetchAllRows((from, to) =>
          fastify.supabase.from('event_log').select('status').eq('tenant_id', tenantId).range(from, to)),

        // Count by event_type — no date restriction, gives lifetime totals.
        fetchAllRows((from, to) =>
          fastify.supabase.from('event_log').select('event_type').eq('tenant_id', tenantId).range(from, to)),

        // Daily volume — last 7 days only.
        fetchAllRows((from, to) =>
          fastify.supabase.from('event_log').select('created_at').eq('tenant_id', tenantId).gte('created_at', since7d).range(from, to)),
      ]) as [any[], any[], any[]]
    } catch (err) {
      req.log.error({ err }, 'event governance stats query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to compute event stats' })
    }

    // by_status
    const statusCounts: Record<string, number> = {}
    for (const row of statusRows) {
      const s = (row as any).status ?? 'unknown'
      statusCounts[s] = (statusCounts[s] ?? 0) + 1
    }
    const by_status = Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // by_type — top 10
    const typeCounts: Record<string, number> = {}
    for (const row of typeRows) {
      const t = (row as any).event_type ?? 'unknown'
      typeCounts[t] = (typeCounts[t] ?? 0) + 1
    }
    const by_type = Object.entries(typeCounts)
      .map(([event_type, count]) => ({ event_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // daily_volume — build a map for the last 7 calendar days (UTC) so days
    // with zero events still appear in the result.
    const dayCounts: Record<string, number> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      dayCounts[d.toISOString().slice(0, 10)] = 0
    }
    for (const row of dailyRows) {
      const day = ((row as any).created_at as string).slice(0, 10)
      if (day in dayCounts) {
        dayCounts[day] += 1
      }
    }
    const daily_volume = Object.entries(dayCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return reply.send({ by_status, by_type, daily_volume })
  })
}
