/**
 * Attendance API Sources
 *
 * Manage external API connectors that supply attendance punch data.
 * The scheduler polls active sources; HR admins manage them here.
 *
 * GET    /attendance/api-sources              — list sources for tenant
 * POST   /attendance/api-sources              — create source
 * GET    /attendance/api-sources/:id          — single source
 * PUT    /attendance/api-sources/:id          — update source
 * DELETE /attendance/api-sources/:id          — soft-disable (is_active=false)
 * POST   /attendance/api-sources/test         — test an ad-hoc connection (no save)
 * POST   /attendance/api-sources/:id/test     — test a saved source
 * POST   /attendance/api-sources/:id/fetch    — manually trigger a fetch & ingest
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { ssrfCheck }            from '../../lib/ssrf-guard.js'

// ── Shared schemas ────────────────────────────────────────────────────────────

const AUTH_TYPES = ['none','api_key','bearer','basic','hmac','oauth2'] as const
const HTTP_METHODS = ['GET','POST'] as const

const sourceBodySchema = z.object({
  name:                 z.string().min(1).max(255),
  description:          z.string().optional(),
  endpoint_url:         z.string().url({ message: 'endpoint_url must be a valid URL' }),
  http_method:          z.enum(HTTP_METHODS).default('GET'),
  request_body:         z.record(z.unknown()).optional(),
  extra_headers:        z.record(z.string()).optional(),
  auth_type:            z.enum(AUTH_TYPES).default('none'),
  auth_config:          z.record(z.unknown()).optional(),
  response_path:        z.string().optional(),
  field_employee_code:  z.string().min(1).default('employee_code'),
  field_timestamp:      z.string().min(1).default('timestamp'),
  field_direction:      z.string().min(1).default('direction'),
  poll_interval_min:    z.coerce.number().int().min(0).max(10080).default(60),
  is_active:            z.boolean().default(true),
})

// For the ad-hoc test endpoint (no name required)
const testBodySchema = z.object({
  endpoint_url:   z.string().url({ message: 'endpoint_url must be a valid URL' }),
  http_method:    z.enum(HTTP_METHODS).default('GET'),
  request_body:   z.record(z.unknown()).optional(),
  extra_headers:  z.record(z.string()).optional(),
  auth_type:      z.enum(AUTH_TYPES).default('none'),
  auth_config:    z.record(z.unknown()).optional(),
  response_path:  z.string().optional(),
})

// ── Auth header builder ───────────────────────────────────────────────────────

function buildAuthHeaders(
  authType:   typeof AUTH_TYPES[number],
  authConfig: Record<string, unknown>,
): Record<string, string> {
  switch (authType) {
    case 'api_key': {
      const header = (authConfig.header as string) || 'X-Api-Key'
      const key    = (authConfig.key    as string) || ''
      return key ? { [header]: key } : {}
    }
    case 'bearer': {
      const token = (authConfig.token as string) || ''
      return token ? { Authorization: `Bearer ${token}` } : {}
    }
    case 'basic': {
      const username = (authConfig.username as string) || ''
      const password = (authConfig.password as string) || ''
      if (!username) return {}
      const encoded = Buffer.from(`${username}:${password}`).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }
    default:
      return {}
  }
}

// ── Response path resolver ────────────────────────────────────────────────────

/** Resolve a dot-path like "data.records" from an arbitrary JSON value. */
function resolvePath(obj: unknown, path?: string | null): unknown {
  if (!path) return obj
  const parts = path.replace(/^\$\.?/, '').split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

// ── Core fetch helper (shared by test + scheduled fetch) ─────────────────────

interface FetchSourceResult {
  ok:         boolean
  status:     number
  latency_ms: number
  sample:     unknown[]    // first 3 records
  total:      number       // total records in response
  raw:        unknown      // full parsed response (or partial)
  error?:     string
}

export async function fetchSourceData(source: {
  endpoint_url:  string
  http_method:   string
  request_body?: Record<string, unknown> | null
  extra_headers: Record<string, string>
  auth_type:     string
  auth_config:   Record<string, unknown>
  response_path?: string | null
}): Promise<FetchSourceResult> {
  const ssrfReason = ssrfCheck(source.endpoint_url)
  if (ssrfReason) {
    return { ok: false, status: 0, latency_ms: 0, sample: [], total: 0, raw: null, error: `Blocked: ${ssrfReason}` }
  }

  const authHeaders = buildAuthHeaders(
    source.auth_type as typeof AUTH_TYPES[number],
    source.auth_config as Record<string, unknown>,
  )

  const headers: Record<string, string> = {
    'User-Agent': 'CognixHR-AttendanceConnector/1.0',
    Accept:       'application/json',
    ...source.extra_headers,
    ...authHeaders,
  }

  const method = source.http_method || 'GET'
  const body   = (method === 'POST' && source.request_body)
    ? JSON.stringify(source.request_body)
    : undefined

  if (body) headers['Content-Type'] = 'application/json'

  const startedAt = Date.now()
  let raw: unknown = null
  let httpStatus   = 0

  try {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), 15_000)

    const resp = await fetch(source.endpoint_url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal:   controller.signal,
    }).finally(() => clearTimeout(timer))

    httpStatus        = resp.status
    const latency_ms  = Date.now() - startedAt

    if (!resp.ok) {
      return { ok: false, status: httpStatus, latency_ms, sample: [], total: 0, raw: null, error: `HTTP ${httpStatus}` }
    }

    const text = await resp.text()
    try { raw = JSON.parse(text) } catch { raw = text }

    const records = resolvePath(raw, source.response_path)
    const arr = Array.isArray(records) ? records : (records != null ? [records] : [])

    return {
      ok:         true,
      status:     httpStatus,
      latency_ms,
      sample:     arr.slice(0, 3),
      total:      arr.length,
      raw,
    }
  } catch (err: any) {
    return {
      ok:         false,
      status:     httpStatus,
      latency_ms: Date.now() - startedAt,
      sample:     [],
      total:      0,
      raw:        null,
      error:      err?.message ?? 'Unknown error',
    }
  }
}

// ── Ingest helper — maps raw punch records into attendance_raw_logs ───────────

interface IngestResult {
  ingested:  number
  skipped:   number
  errors:    string[]
}

async function ingestRecords(
  fastify: FastifyInstance,
  tenantId: string,
  records: unknown[],
  source: {
    id: string
    field_employee_code: string
    field_timestamp:     string
    field_direction:     string
  },
): Promise<IngestResult> {
  const rows: Array<{
    tenant_id:     string
    source_id:     string
    employee_code: string
    timestamp:     string
    direction:     string
  }> = []
  const errors: string[] = []

  for (const rec of records) {
    if (typeof rec !== 'object' || rec == null) { errors.push('Non-object record skipped'); continue }
    const r = rec as Record<string, unknown>

    const empCode  = String(r[source.field_employee_code] ?? '').trim()
    const tsRaw    = r[source.field_timestamp]
    const dirRaw   = String(r[source.field_direction] ?? '').trim().toLowerCase()

    if (!empCode) { errors.push('Missing employee_code'); continue }
    if (!tsRaw)   { errors.push(`Missing timestamp for ${empCode}`); continue }

    const ts = new Date(tsRaw as string)
    if (isNaN(ts.getTime())) { errors.push(`Invalid timestamp for ${empCode}: ${tsRaw}`); continue }

    const direction: 'in' | 'out' | null =
      dirRaw === 'in' || dirRaw === '1' || dirRaw === 'entry'   ? 'in'
      : dirRaw === 'out' || dirRaw === '0' || dirRaw === 'exit' ? 'out'
      : null

    if (!direction) { errors.push(`Unknown direction for ${empCode}: ${dirRaw}`); continue }

    rows.push({
      tenant_id:     tenantId,
      source_id:     source.id,
      employee_code: empCode,
      timestamp:     ts.toISOString(),
      direction,
    })
  }

  if (rows.length === 0) return { ingested: 0, skipped: records.length, errors }

  // Insert in chunks of 500 to avoid payload limits
  let ingested = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await fastify.supabase
      .from('attendance_raw_logs')
      .upsert(chunk, { onConflict: 'tenant_id,employee_code,timestamp,direction', ignoreDuplicates: true })
    if (error) errors.push(`DB insert error: ${error.message}`)
    else ingested += chunk.length
  }

  return { ingested, skipped: records.length - ingested, errors }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function attendanceApiSourcesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function isAdmin(role: string) {
    return ['super_admin', 'hr_admin'].includes(role)
  }

  // ── GET /attendance/api-sources ───────────────────────────────────────────
  fastify.get('/attendance/api-sources', auth, async (req: any, reply) => {
    const { data, error, count } = await fastify.supabase
      .from('attendance_api_sources')
      .select(
        'id, name, description, endpoint_url, http_method, auth_type, response_path, ' +
        'field_employee_code, field_timestamp, field_direction, ' +
        'poll_interval_min, is_active, ' +
        'last_fetched_at, last_fetch_status, last_fetch_count, last_fetch_error, ' +
        'last_test_at, last_test_status, created_at, updated_at',
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      req.log.error({ err: error }, 'api-sources list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch API sources' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── POST /attendance/api-sources ──────────────────────────────────────────
  fastify.post('/attendance/api-sources', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = sourceBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { name, description, endpoint_url, http_method, request_body, extra_headers,
            auth_type, auth_config, response_path,
            field_employee_code, field_timestamp, field_direction,
            poll_interval_min, is_active } = parsed.data

    const { data, error } = await fastify.supabase
      .from('attendance_api_sources')
      .insert({
        tenant_id: req.tenantId,
        name, description: description ?? null,
        endpoint_url, http_method,
        request_body:        request_body    ?? null,
        extra_headers:       extra_headers   ?? {},
        auth_type,
        auth_config:         auth_config     ?? {},
        response_path:       response_path   ?? null,
        field_employee_code, field_timestamp, field_direction,
        poll_interval_min, is_active,
        last_fetch_status:   'never_run',
        created_by: req.userId,
      })
      .select('id, name, description, endpoint_url, http_method, auth_type, poll_interval_min, is_active, created_at')
      .single()

    if (error) {
      req.log.error({ err: error }, 'api-source insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create API source' })
    }

    return reply.code(201).send({ data })
  })

  // ── GET /attendance/api-sources/:id ───────────────────────────────────────
  fastify.get('/attendance/api-sources/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('attendance_api_sources')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'API source not found' })
    }

    // Strip sensitive auth values from response
    const safe = { ...data, auth_config: redactAuthConfig(data.auth_config) }
    return reply.send({ data: safe })
  })

  // ── PUT /attendance/api-sources/:id ───────────────────────────────────────
  fastify.put('/attendance/api-sources/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = sourceBodySchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'No fields to update' })
    }

    const { data, error } = await fastify.supabase
      .from('attendance_api_sources')
      .update({ ...parsed.data, updated_by: req.userId })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, endpoint_url, auth_type, poll_interval_min, is_active, updated_at')
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'API source not found' })
    }

    return reply.send({ data })
  })

  // ── DELETE /attendance/api-sources/:id ────────────────────────────────────
  fastify.delete('/attendance/api-sources/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('attendance_api_sources')
      .update({ is_active: false, updated_by: req.userId })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'API source not found' })
    }

    return reply.send({ message: 'API source disabled', id })
  })

  // ── POST /attendance/api-sources/test ─────────────────────────────────────
  // Ad-hoc test: provide config inline, get back sample data (nothing saved).
  fastify.post('/attendance/api-sources/test', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = testBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await fetchSourceData({
      ...parsed.data,
      extra_headers: parsed.data.extra_headers ?? {},
      auth_config:   (parsed.data.auth_config  ?? {}) as Record<string, unknown>,
      response_path: parsed.data.response_path,
    })

    return reply.send({
      success:    result.ok,
      status:     result.status,
      latency_ms: result.latency_ms,
      sample:     result.sample,
      total:      result.total,
      error:      result.error ?? null,
    })
  })

  // ── POST /attendance/api-sources/:id/test ─────────────────────────────────
  // Test a saved source and persist the result.
  fastify.post('/attendance/api-sources/:id/test', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data: source, error: fetchErr } = await fastify.supabase
      .from('attendance_api_sources')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !source) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'API source not found' })
    }

    const result = await fetchSourceData(source)

    // Persist test result
    await fastify.supabase
      .from('attendance_api_sources')
      .update({
        last_test_at:     new Date().toISOString(),
        last_test_status: result.ok ? 'success' : 'error',
        last_test_sample: result.sample.length > 0 ? result.sample : null,
      })
      .eq('id', id)

    return reply.send({
      success:    result.ok,
      status:     result.status,
      latency_ms: result.latency_ms,
      sample:     result.sample,
      total:      result.total,
      error:      result.error ?? null,
    })
  })

  // ── POST /attendance/api-sources/:id/fetch ────────────────────────────────
  // Manually trigger a fetch + ingest for a saved source.
  fastify.post('/attendance/api-sources/:id/fetch', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data: source, error: fetchErr } = await fastify.supabase
      .from('attendance_api_sources')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !source) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'API source not found' })
    }

    if (!source.is_active) {
      return reply.code(409).send({ error: 'SOURCE_INACTIVE', message: 'API source is disabled' })
    }

    // Mark as running
    await fastify.supabase
      .from('attendance_api_sources')
      .update({ last_fetch_status: 'running' })
      .eq('id', id)

    const result = await fetchSourceData(source)

    if (!result.ok) {
      await fastify.supabase
        .from('attendance_api_sources')
        .update({
          last_fetch_status: 'error',
          last_fetch_error:  result.error ?? `HTTP ${result.status}`,
          last_fetched_at:   new Date().toISOString(),
        })
        .eq('id', id)

      return reply.code(502).send({
        error:   'FETCH_FAILED',
        message: result.error ?? `Remote returned HTTP ${result.status}`,
        status:  result.status,
      })
    }

    // Ingest all records
    const allRecords = Array.isArray(resolvePath(result.raw, source.response_path))
      ? (resolvePath(result.raw, source.response_path) as unknown[])
      : [resolvePath(result.raw, source.response_path)].filter(Boolean)

    const ingest = await ingestRecords(fastify, req.tenantId, allRecords, source)

    await fastify.supabase
      .from('attendance_api_sources')
      .update({
        last_fetch_status: 'success',
        last_fetch_error:  null,
        last_fetch_count:  ingest.ingested,
        last_fetched_at:   new Date().toISOString(),
      })
      .eq('id', id)

    return reply.send({
      ingested:   ingest.ingested,
      skipped:    ingest.skipped,
      errors:     ingest.errors.slice(0, 10),
      latency_ms: result.latency_ms,
    })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function redactAuthConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  if (!cfg) return {}
  const redacted: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg)) {
    const lower = k.toLowerCase()
    if (lower.includes('key') || lower.includes('password') || lower.includes('secret') || lower.includes('token')) {
      redacted[k] = typeof v === 'string' && v.length > 4 ? `${v.slice(0, 2)}${'*'.repeat(Math.min(v.length - 4, 8))}${v.slice(-2)}` : '***'
    } else {
      redacted[k] = v
    }
  }
  return redacted
}
