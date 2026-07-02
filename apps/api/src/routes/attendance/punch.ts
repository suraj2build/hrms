/**
 * POST /attendance/punch
 *
 * Ingest a single attendance punch (IN or OUT) into attendance_punch_logs.
 * After the insert, asynchronously triggers an AttendanceEngine recompute for
 * the punched date so attendance_daily stays up to date in near-real-time.
 *
 * Auth:
 *   - Any authenticated user may punch on behalf of themselves (employee_id
 *     resolved from their profile; the body employee_id is ignored for non-admins).
 *   - HR admins may punch on behalf of any employee (pass employee_id in body).
 *
 * Body:
 *   {
 *     employee_id?: string   // UUID — HR admin only; ignored for regular users
 *     punched_at?:  string   // ISO 8601 datetime; defaults to now()
 *     direction:    "IN" | "OUT"
 *     source?:      "manual" | "web" | "mobile" | "kiosk"  // defaults to "web"
 *     device_id?:   string
 *     notes?:       string
 *   }
 *
 * Response (201):
 *   { data: { id, employee_id, punched_at, direction, source } }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recomputeRange, utcToLocalDate } from '../../lib/attendance-engine.js'
import { isMonthLocked, monthOf } from '../../lib/period-lock.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const bodySchema = z.object({
  employee_id: z.string().uuid().optional(),
  punched_at:  z.string().datetime({ offset: true }).optional(),
  direction:   z.enum(['IN', 'OUT']),
  source:      z.enum(['manual', 'web', 'mobile', 'kiosk']).default('web'),
  device_id:   z.string().max(100).optional(),
  notes:       z.string().max(500).optional(),
})

export default async function attendancePunchRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.post('/attendance/punch', auth, async (req: any, reply) => {

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { direction, source, device_id, notes } = parsed.data
    const punchedAt = parsed.data.punched_at ?? new Date().toISOString()
    const isAdmin   = HR_ADMIN_ROLES.includes(req.userRole)

    // Resolve employee_id
    let employeeId: string | null = null

    if (isAdmin && parsed.data.employee_id) {
      // Admin punching for another employee — validate they belong to this tenant
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', parsed.data.employee_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }
      employeeId = parsed.data.employee_id
    } else {
      // Regular user — punch for themselves
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (!profile?.employee_id) {
        return reply.code(400).send({
          error:   'NO_EMPLOYEE_LINK',
          message: 'Your profile is not linked to an employee record',
        })
      }
      employeeId = profile.employee_id
    }

    // The engine keys attendance by the tenant-LOCAL calendar date. punched_at is
    // a UTC instant, so derive the local date via the tenant timezone — otherwise
    // a punch near local midnight (e.g. 04:00 IST = 22:30Z prior day) is filed to
    // the wrong day, recomputes the wrong day, and can mis-target the lock check.
    const { data: tzRow } = await fastify.supabase
      .from('tenants')
      .select('timezone')
      .eq('id', req.tenantId)
      .maybeSingle()
    const tenantTz: string = (tzRow as { timezone?: string } | null)?.timezone ?? 'UTC'
    const punchedDate = utcToLocalDate(new Date(punchedAt), tenantTz)

    // Period protection (F4) — a punch (especially a backdated manual one) must
    // not land in a month that is locked/finalized for payroll, since it triggers
    // a recompute that would rewrite sealed attendance. Block it cleanly here;
    // the engine's recomputeRange is invoked directly below, bypassing the
    // route-level period guards, so this is the only gate on this path.
    const punchMonth = monthOf(punchedDate)
    if (await isMonthLocked(fastify.supabase, req.tenantId, punchMonth)) {
      return reply.code(409).send({
        error:   'PERIOD_LOCKED',
        message: `Attendance period ${punchMonth} is locked for payroll — punches cannot be recorded for it.`,
      })
    }

    // Upsert the punch log.
    // Step 3: migration 044 added UNIQUE (tenant_id, employee_id, punched_at, direction).
    // Using ignoreDuplicates=true means a duplicate punch returns no row instead of
    // erroring — we then fetch the pre-existing record and return it as-is.
    const { data: upsertResult, error: insertErr } = await fastify.supabase
      .from('attendance_punch_logs')
      .upsert(
        {
          tenant_id:   req.tenantId,
          employee_id: employeeId,
          punched_at:  punchedAt,
          direction,
          source,
          device_id:   device_id ?? null,
          notes:       notes ?? null,
        },
        { onConflict: 'tenant_id,employee_id,punched_at,direction', ignoreDuplicates: true },
      )
      .select('id, employee_id, punched_at, direction, source')
      .maybeSingle()

    if (insertErr) {
      req.log.error({ err: insertErr, employee_id: employeeId }, 'punch_logs upsert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to record punch' })
    }

    // If upsertResult is null the row already existed (duplicate punch) — fetch the existing record.
    let punchRow = upsertResult
    if (!punchRow) {
      const { data: existing } = await fastify.supabase
        .from('attendance_punch_logs')
        .select('id, employee_id, punched_at, direction, source')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId!)
        .eq('punched_at', punchedAt)
        .eq('direction', direction)
        .maybeSingle()

      if (!existing) {
        req.log.error({ employee_id: employeeId, punched_at: punchedAt, direction }, 'punch_logs duplicate but fetch also failed')
        return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to record punch' })
      }
      punchRow = existing
    }

    // Fire-and-forget recompute for the punched date (tenant-local, computed above).
    setImmediate(async () => {
      try {
        await recomputeRange(fastify.supabase, {
          tenant_id:   req.tenantId,
          employee_id: employeeId!,
          from_date:   punchedDate,
          to_date:     punchedDate,
          changed_by:  req.userId,
        })
      } catch (engineErr) {
        fastify.log.warn({ err: engineErr, employee_id: employeeId, date: punchedDate },
          'punch recompute failed (fire-and-forget)')
      }
    })

    return reply.code(201).send({ data: punchRow })
  })
}
