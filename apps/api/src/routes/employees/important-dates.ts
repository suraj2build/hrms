/**
 * Employee Important Dates Routes
 *
 * Manage per-employee important dates (birthday, anniversary, etc.).
 * These dates are used by the leave event-grant engine to automatically
 * credit event-triggered leave days.
 *
 * Routes (mounted under /employees/:employeeId):
 *   GET    /employees/employees/:employeeId/important-dates          — list all
 *   POST   /employees/employees/:employeeId/important-dates          — upsert a date for a type
 *   DELETE /employees/employees/:employeeId/important-dates/:dateId  — remove a specific date
 *
 * Protected:
 *   GET / POST / DELETE — hr_admin or super_admin only
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const upsertSchema = z.object({
  date_type_id: z.string().uuid('date_type_id must be a UUID'),
  event_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'event_date must be YYYY-MM-DD'),
  year_known:   z.boolean().default(true),
  notes:        z.string().max(500).optional().nullable(),
})

export default async function employeeImportantDatesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(
    req:   { userRole: string },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // Validate that the employee exists and belongs to this tenant.
  async function resolveEmployee(
    employeeId: string,
    tenantId:   string,
  ): Promise<boolean> {
    const { data } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return !!data
  }

  // ── GET /employees/employees/:employeeId/important-dates ─────────────────────────────
  fastify.get('/employees/:employeeId/important-dates', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { employeeId } = req.params as { employeeId: string }

    if (!(await resolveEmployee(employeeId, req.tenantId))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_important_dates')
      .select(`
        id,
        date_type_id,
        event_date,
        year_known,
        notes,
        updated_at,
        important_date_types!employee_important_dates_date_type_id_fkey (
          id,
          code,
          name,
          is_system
        )
      `)
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('event_date')

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch important dates')
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /employees/employees/:employeeId/important-dates ────────────────────────────
  // Upserts: if a record already exists for this employee + date_type, it is
  // updated in place (matching the UNIQUE constraint on the table).
  fastify.post('/employees/:employeeId/important-dates', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { employeeId } = req.params as { employeeId: string }

    if (!(await resolveEmployee(employeeId, req.tenantId))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const parsed = upsertSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { date_type_id, event_date, year_known, notes } = parsed.data

    // Verify date_type belongs to tenant
    const { data: dateType } = await fastify.supabase
      .from('important_date_types')
      .select('id, is_active')
      .eq('id', date_type_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!dateType) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Date type not found' })
    }

    const dt = dateType as { id: string; is_active: boolean }
    if (!dt.is_active) {
      return reply.code(409).send({
        error:   'DATE_TYPE_INACTIVE',
        message: 'This date type is currently disabled and cannot be assigned.',
      })
    }

    // Upsert — conflict on (tenant_id, employee_id, date_type_id)
    const { data, error } = await fastify.supabase
      .from('employee_important_dates')
      .upsert(
        {
          tenant_id:    req.tenantId,
          employee_id:  employeeId,
          date_type_id,
          event_date,
          year_known,
          notes:        notes ?? null,
        },
        { onConflict: 'tenant_id,employee_id,date_type_id' },
      )
      .select(`
        id,
        date_type_id,
        event_date,
        year_known,
        notes,
        updated_at,
        important_date_types!employee_important_dates_date_type_id_fkey (
          id,
          code,
          name
        )
      `)
      .single()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save important date')
    }

    return reply.code(201).send({ data })
  })

  // ── DELETE /employees/employees/:employeeId/important-dates/:dateId ─────────────────
  fastify.delete('/employees/:employeeId/important-dates/:dateId', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { employeeId, dateId } = req.params as { employeeId: string; dateId: string }

    if (!(await resolveEmployee(employeeId, req.tenantId))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_important_dates')
      .delete()
      .eq('id', dateId)
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .select('id')

    if (error) {
      return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete important date')
    }
    if (!data?.length) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Important date not found' })
    }

    return reply.code(204).send()
  })
}
