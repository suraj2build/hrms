/**
 * Integration Registry API
 *
 * Manages third-party integrations registered in the platform.
 * All write operations are restricted to super_admin / hr_admin.
 *
 * GET    /system/integrations                       — list integrations
 * GET    /system/integrations/:id                   — single integration + last 20 audit entries
 * POST   /system/integrations                       — register new integration (admin)
 * PUT    /system/integrations/:id                   — update integration config (admin)
 * DELETE /system/integrations/:id                   — set status = 'inactive' (admin)
 * GET    /system/integrations/:id/audit             — paginated audit log for integration
 * POST   /system/integrations/:id/health-check      — probe endpoint and record health status
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

// ── Validation schemas ────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status:           z.enum(['active', 'inactive', 'error', 'unknown']).optional(),
  integration_type: z.string().optional(),
})

const createBodySchema = z.object({
  name:             z.string().min(1).max(255),
  integration_type: z.string().min(1).max(100),
  endpoint_url:     z.string().url({ message: 'endpoint_url must be a valid URL' }).optional(),
  auth_type:        z.enum(['none', 'api_key', 'oauth2', 'basic', 'bearer']).optional(),
  config:           z.record(z.unknown()).optional(),
  description:      z.string().optional(),
})

const updateBodySchema = createBodySchema.partial()

const auditQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// ── Helper ────────────────────────────────────────────────────────────────────

function isAdmin(role: string): boolean {
  return ['super_admin', 'hr_admin'].includes(role)
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function integrationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /system/integrations ──────────────────────────────────────────────
  fastify.get('/system/integrations', auth, async (req: any, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { status, integration_type } = parsed.data

    let q = fastify.supabase
      .from('integration_registry')
      .select('*', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (status)           q = q.eq('status', status)
    if (integration_type) q = q.eq('integration_type', integration_type)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'integrations list query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch integrations' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── GET /system/integrations/:id ──────────────────────────────────────────
  fastify.get('/system/integrations/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: integration, error: integrationError } = await fastify.supabase
      .from('integration_registry')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (integrationError || !integration) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Integration not found' })
    }

    const { data: auditLog, error: auditError } = await fastify.supabase
      .from('integration_audit_log')
      .select('*')
      .eq('integration_id', id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (auditError) {
      req.log.error({ err: auditError }, 'integration audit log fetch failed')
    }

    return reply.send({
      data: {
        ...integration,
        recent_audit: auditLog ?? [],
      },
    })
  })

  // ── POST /system/integrations ─────────────────────────────────────────────
  fastify.post('/system/integrations', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = createBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { name, integration_type, endpoint_url, auth_type, config, description } = parsed.data

    const { data, error } = await fastify.supabase
      .from('integration_registry')
      .insert({
        tenant_id:        req.tenantId,
        name,
        integration_type,
        endpoint_url:     endpoint_url  ?? null,
        auth_type:        auth_type     ?? 'none',
        config:           config        ?? null,
        description:      description   ?? null,
        status:           'active',
        health_status:    'unknown',
        created_by:       req.userId,
      })
      .select()
      .single()

    if (error) {
      req.log.error({ err: error }, 'integration insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create integration' })
    }

    // Audit log entry
    await fastify.supabase
      .from('integration_audit_log')
      .insert({
        integration_id: data.id,
        tenant_id:      req.tenantId,
        action:         'created',
        performed_by:   req.userId,
        metadata:       { name, integration_type },
        created_at:     new Date().toISOString(),
      })

    return reply.code(201).send({ data })
  })

  // ── PUT /system/integrations/:id ──────────────────────────────────────────
  fastify.put('/system/integrations/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'No fields provided for update' })
    }

    const { data, error } = await fastify.supabase
      .from('integration_registry')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) {
      req.log.error({ err: error }, 'integration update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update integration' })
    }

    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Integration not found' })
    }

    // Audit log entry
    await fastify.supabase
      .from('integration_audit_log')
      .insert({
        integration_id: id,
        tenant_id:      req.tenantId,
        action:         'updated',
        performed_by:   req.userId,
        metadata:       parsed.data,
        created_at:     new Date().toISOString(),
      })

    return reply.send({ data })
  })

  // ── DELETE /system/integrations/:id ──────────────────────────────────────
  fastify.delete('/system/integrations/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('integration_registry')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Integration not found' })
    }

    // Audit log entry
    await fastify.supabase
      .from('integration_audit_log')
      .insert({
        integration_id: id,
        tenant_id:      req.tenantId,
        action:         'deactivated',
        performed_by:   req.userId,
        metadata:       {},
        created_at:     new Date().toISOString(),
      })

    return reply.send({ message: 'Integration set to inactive', id })
  })

  // ── GET /system/integrations/:id/audit ───────────────────────────────────
  fastify.get('/system/integrations/:id/audit', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const parsed = auditQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { limit, offset } = parsed.data

    // Confirm integration belongs to tenant
    const { data: integration } = await fastify.supabase
      .from('integration_registry')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!integration) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Integration not found' })
    }

    const { data, error, count } = await fastify.supabase
      .from('integration_audit_log')
      .select('*', { count: 'exact' })
      .eq('integration_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      req.log.error({ err: error }, 'integration audit log query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch audit log' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── POST /system/integrations/:id/health-check ────────────────────────────
  fastify.post('/system/integrations/:id/health-check', auth, async (req: any, reply) => {
    // Probes the stored endpoint (outbound fetch) and mutates registry stats —
    // admin-only like every other mutation in this file.
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }
    const { id } = req.params as { id: string }

    const { data: integration, error: fetchError } = await fastify.supabase
      .from('integration_registry')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !integration) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Integration not found' })
    }

    let health_status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'unknown'
    let latency_ms: number | null = null

    if (integration.endpoint_url) {
      // Validate URL before probing
      let parsedUrl: URL
      try {
        parsedUrl = new URL(integration.endpoint_url)
      } catch {
        await fastify.supabase
          .from('integration_registry')
          .update({
            health_status:         'unhealthy',
            last_health_check_at:  new Date().toISOString(),
          })
          .eq('id', id)

        return reply.send({ health_status: 'unhealthy', latency_ms: null, error: 'Invalid endpoint URL' })
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        health_status = 'unhealthy'
      } else {
        const startedAt  = Date.now()
        let httpStatus   = 0

        try {
          const controller = new AbortController()
          const timer      = setTimeout(() => controller.abort(), 10_000)

          const response = await fetch(integration.endpoint_url, {
            method:  'GET',
            headers: { 'User-Agent': 'HRMS-HealthCheck/1.0' },
            signal:  controller.signal,
          }).finally(() => clearTimeout(timer))

          httpStatus = response.status
          latency_ms = Date.now() - startedAt

          if (response.ok) {
            health_status = latency_ms > 5_000 ? 'degraded' : 'healthy'
          } else if (httpStatus >= 500) {
            health_status = 'unhealthy'
          } else {
            // 4xx etc — reachable but returns errors; treat as degraded
            health_status = 'degraded'
          }
        } catch (err: any) {
          latency_ms    = Date.now() - startedAt
          health_status = 'unhealthy'
          req.log.warn({ err, integrationId: id }, 'health-check probe failed')
        }
      }
    }

    // Read current stats for rolling average computation
    const { data: currentStats } = await fastify.supabase
      .from('integration_registry')
      .select('total_calls, avg_latency_ms, error_rate_pct')
      .eq('id', id)
      .single()

    const prevCalls      = currentStats?.total_calls     ?? 0
    const prevAvgLatency = currentStats?.avg_latency_ms   ?? 0
    const prevErrorPct   = Number(currentStats?.error_rate_pct ?? 0)

    const newCalls      = prevCalls + 1
    const newAvgLatency = latency_ms != null
      ? Math.round((prevAvgLatency * prevCalls + latency_ms) / newCalls)
      : prevAvgLatency

    // Rolling error rate: (prevErrorPct * prevCalls + isError * 100) / newCalls
    const isError       = health_status === 'unhealthy' || health_status === 'degraded'
    const newErrorPct   = Math.round(((prevErrorPct * prevCalls) + (isError ? 100 : 0)) / newCalls * 10) / 10

    // Persist health status, timestamp, and updated stats
    await fastify.supabase
      .from('integration_registry')
      .update({
        health_status,
        last_health_check_at: new Date().toISOString(),
        total_calls:          newCalls,
        avg_latency_ms:       newAvgLatency,
        error_rate_pct:       newErrorPct,
      })
      .eq('id', id)

    // Audit log entry
    await fastify.supabase
      .from('integration_audit_log')
      .insert({
        integration_id: id,
        tenant_id:      req.tenantId,
        action:         'health_check',
        performed_by:   req.userId,
        metadata:       { health_status, latency_ms },
        created_at:     new Date().toISOString(),
      })

    return reply.send({ health_status, latency_ms })
  })
}
