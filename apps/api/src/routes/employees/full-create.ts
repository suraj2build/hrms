import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { fetchFullProfile } from '../../lib/employee-profile.js'
import { SLOW_THRESHOLD_MS } from '../../lib/constants.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { notify } from '../../lib/notify.js'

// ── Request schema ─────────────────────────────────────────────────────────────
const fullCreateSchema = z.object({
  first_name:   z.string().min(1, 'first_name is required'),
  last_name:    z.string().min(1, 'last_name is required'),
  email:        z.string().email('Enter a valid email'),
  phone:        z.string().optional(),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'joining_date must be YYYY-MM-DD'),
  employment_type:  z.enum(['permanent', 'contract', 'intern', 'probation', 'consultant']),
  effective_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  department_id:    z.string().uuid().optional(),
  designation_id:   z.string().uuid().optional(),
  grade_id:         z.string().uuid().optional(),
  work_location_id: z.string().uuid().optional(),
  cost_center_id:   z.string().uuid().optional(),
  shift_id:         z.string().uuid().optional(),
  manager_id:       z.string().uuid().optional(),
  site_id:          z.string().uuid().optional(),
  roster_id:        z.string().uuid().optional(),
})

type FullCreateBody = z.infer<typeof fullCreateSchema>

export default async function fullCreateRoute(fastify: FastifyInstance) {
  // Creating an employee + job history is HR-admin only (mirrors POST /employees).
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  /**
   * POST /employees/full-create
   *
   * ── Tracing ───────────────────────────────────────────────────────────────
   * A UUID request_id is generated at entry and attached to:
   *   - every structured log line (request_id field)
   *   - the response header X-Request-Id
   * This lets you correlate all log lines for one request across systems.
   *
   * ── Slow-request detection ────────────────────────────────────────────────
   * If total duration_ms > 500 the exit log is emitted at WARN level.
   * All other successful exits use INFO level.
   *
   * ── Idempotency ───────────────────────────────────────────────────────────
   * Optional header  Idempotency-Key: <uuid>
   * First successful 201 is cached and replayed verbatim on retries.
   * Keys are scoped to the caller's tenant.
   *
   * ── Response ──────────────────────────────────────────────────────────────
   * Returns the full-profile shape (same as GET /employees/:id/full-profile)
   * so the frontend can hydrate its cache without a second round-trip.
   *
   * Status codes:
   *   201 – created (or replayed)
   *   400 – validation error
   *   409 – duplicate email
   *   500 – unexpected DB error
   */
  fastify.post('/employees/full-create', auth, async (request, reply) => {
    const startMs        = Date.now()
    const requestId      = randomUUID()
    const tenantId       = request.tenantId
    const userId         = request.userId
    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined)?.trim() || null

    // Attach request_id to every response regardless of outcome
    reply.header('X-Request-Id', requestId)

    // ── Shared log context — spread into every fastify.log call ────────────
    // request_id is always present so any log line can be traced back to this
    // exact request. email starts null and is set after validation succeeds.
    const ctx = {
      module:          'employee',
      route:           'employees/full-create',
      event:           'full_create',
      request_id:      requestId,
      tenant_id:       tenantId,
      idempotency_key: idempotencyKey,
      email:           null as string | null,
    }

    // ── Helper: level-aware exit logger ────────────────────────────────────
    // Emits WARN when the request took longer than SLOW_THRESHOLD_MS so slow
    // DB queries or cold connections are surfaced immediately in log tooling.
    function logExit(extra: Record<string, unknown>, msg: string) {
      const duration_ms = Date.now() - startMs
      const payload     = { ...ctx, ...extra, duration_ms }
      if (duration_ms > SLOW_THRESHOLD_MS) {
        fastify.log.warn({ ...payload, slow_request: true }, `SLOW — ${msg}`)
      } else {
        fastify.log.info(payload, msg)
      }
    }

    fastify.log.info(ctx, 'POST /employees/full-create received')

    // ── 1. Idempotency check ────────────────────────────────────────────────
    if (idempotencyKey) {
      const { data: cached } = await fastify.supabase
        .from('idempotency_keys')
        .select('status_code, response')
        .eq('tenant_id', tenantId)
        .eq('key', idempotencyKey)
        .maybeSingle()

      if (cached) {
        // Generate a fresh request_id for the replay — the stored body does NOT
        // contain request_id so we inject one here, making each replay uniquely
        // traceable even though the payload is otherwise identical.
        const replayId = randomUUID()
        reply.header('X-Request-Id', replayId)
        logExit(
          { outcome: 'idempotency_hit' },
          'POST /employees/full-create — idempotency key hit, replaying cached response',
        )
        return reply
          .code(cached.status_code)
          .header('Idempotency-Replayed', 'true')
          .send({ request_id: replayId, ...cached.response })
      }
    }

    // ── 2. Validate payload ─────────────────────────────────────────────────
    const parsed = fullCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      logExit(
        {
          outcome:          'validation_error',
          validation_field: issue.path[0] ?? null,
          validation_msg:   issue.message,
        },
        'POST /employees/full-create — request validation failed',
      )
      return reply.code(400).send({
        error:   'VALIDATION',
        message: issue.message,
        field:   issue.path[0] ?? null,
      })
    }

    const b: FullCreateBody = parsed.data
    ctx.email = b.email  // safe to log now that validation passed

    // ── 2b. Validate optional FK references belong to this tenant ───────────
    if (b.site_id) {
      const { data: site } = await fastify.supabase
        .from('sites')
        .select('id')
        .eq('id', b.site_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!site) {
        logExit(
          { outcome: 'validation_error', validation_field: 'site_id' },
          'POST /employees/full-create — site_id not found for tenant',
        )
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Site not found in your organisation',
          field:   'site_id',
        })
      }
    }

    if (b.roster_id) {
      const { data: roster } = await fastify.supabase
        .from('rosters')
        .select('id')
        .eq('id', b.roster_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!roster) {
        logExit(
          { outcome: 'validation_error', validation_field: 'roster_id' },
          'POST /employees/full-create — roster_id not found for tenant',
        )
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Roster not found in your organisation',
          field:   'roster_id',
        })
      }
    }

    // ── 3. Atomic creation via PG function ──────────────────────────────────
    const { data: rpcData, error: rpcError } = await fastify.supabase
      .rpc('create_employee_with_job', {
        p_tenant_id:        tenantId,
        p_created_by:       userId,
        p_first_name:       b.first_name,
        p_last_name:        b.last_name,
        p_email:            b.email,
        p_phone:            b.phone            ?? null,
        p_joining_date:     b.joining_date,
        p_employment_type:  b.employment_type,
        p_effective_from:   b.effective_from   ?? null,
        p_department_id:    b.department_id    ?? null,
        p_designation_id:   b.designation_id   ?? null,
        p_grade_id:         b.grade_id         ?? null,
        p_work_location_id: b.work_location_id ?? null,
        p_cost_center_id:   b.cost_center_id   ?? null,
        p_shift_id:         b.shift_id         ?? null,
        p_manager_id:       b.manager_id       ?? null,
        p_site_id:          b.site_id          ?? null,
        p_roster_id:        b.roster_id        ?? null,
      })

    if (rpcError) {
      if (rpcError.code === '23505') {
        logExit(
          { outcome: 'duplicate_email', pg_code: rpcError.code },
          'POST /employees/full-create — duplicate email rejected',
        )
        return reply.code(409).send({
          error:   'CONFLICT',
          message: 'An employee with this email already exists in your organisation',
        })
      }
      logExit(
        { outcome: 'rpc_error', pg_code: rpcError.code, pg_message: rpcError.message },
        'POST /employees/full-create — create_employee_with_job RPC failed',
      )
      return reply.code(500).send({ error: 'DB_ERROR', message: rpcError.message })
    }

    // ── 4. Fetch full profile ───────────────────────────────────────────────
    const newEmployeeId: string = (rpcData as any).employee.id
    const profileResult = await fetchFullProfile(fastify.supabase, newEmployeeId, tenantId)

    // Strip _timing from the wire body; log timing at debug level regardless.
    let responseBody: Record<string, unknown>
    if (profileResult) {
      const { _timing, ...profileData } = profileResult
      fastify.log.debug(
        { ...ctx, _timing, employee_id: newEmployeeId },
        'POST /employees/full-create — fetchFullProfile timing',
      )
      responseBody = profileData
    } else {
      responseBody = rpcData as Record<string, unknown>
    }

    // ── 4b. Auto-notify new joiner about mandatory published policies ───────
    // Fire-and-forget: fetch the new profile, then send one notification per
    // published mandatory policy. Does not block or fail the 201 response.
    void (async () => {
      try {
        const { data: newProfile } = await fastify.supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('employee_id', newEmployeeId)
          .maybeSingle()
        if (!newProfile?.id) return

        const { data: mandatoryPolicies } = await fastify.supabase
          .from('hr_policies')
          .select('id, title')
          .eq('tenant_id', tenantId)
          .eq('status', 'published')
          .eq('requires_acknowledgement', true)
        if (!mandatoryPolicies || mandatoryPolicies.length === 0) return

        for (const policy of mandatoryPolicies as Array<{ id: string; title: string }>) {
          await notify(fastify.supabase, {
            tenantId,
            recipientId:  newProfile.id,
            item_type:    'general',
            title:        'Policy Acknowledgement Required',
            summary:      `Please read and acknowledge: ${policy.title}`,
            severity:     'info',
            entity_type:  'hr_policy',
            entity_id:    policy.id,
            action_route: `/ess/policies?policy=${policy.id}`,
            action_label: 'View & Acknowledge',
          })
        }
      } catch (e: any) {
        fastify.log.warn({ err: e?.message, employee_id: newEmployeeId }, 'policy auto-notify for new joiner failed')
      }
    })()

    // ── 5. Persist idempotency key (fire-and-forget) ────────────────────────
    // Store responseBody WITHOUT request_id so each replay gets a fresh ID.
    if (idempotencyKey) {
      fastify.supabase
        .from('idempotency_keys')
        .insert({ key: idempotencyKey, tenant_id: tenantId, status_code: 201, response: responseBody })
        .then(({ error }) => {
          if (error && error.code !== '23505') {
            fastify.log.warn(
              { ...ctx, outcome: 'idempotency_store_failed', pg_code: error.code },
              'POST /employees/full-create — failed to persist idempotency key',
            )
          }
        })
    }

    // ── 6. Log exit (slow-aware) and respond ───────────────────────────────
    // Inject request_id into the wire body so the frontend can correlate
    // errors without reading response headers.
    logExit(
      { outcome: 'created', employee_id: newEmployeeId },
      'POST /employees/full-create — employee created successfully',
    )

    return reply.code(201).send({ request_id: requestId, ...responseBody })
  })
}
