/**
 * Shift Override Routes — /masters/employee-shifts
 *
 * Exception-only shift assignments (migration 154: "Shift Overrides").
 *
 * Primary shift scheduling flows through:
 *   Roster Policy → Rotation Policy → Shift Master
 *
 * These routes are used ONLY for:
 *   · Temporary or emergency shift reassignments
 *   · Special-case standing exceptions that override rotation policy resolution
 *   · Employees who need a different shift than their site's governance policies provide
 *
 * Routes:
 *   GET    /masters/employee-shifts         — all active employees with current override (if any)
 *   POST   /masters/employee-shifts/assign  — apply override to an employee (auto-closes previous)
 *   GET    /masters/employee-shifts/:id/history — override history for one employee
 *   DELETE /masters/employee-shifts/:id    — remove a specific override record
 *
 * The employee_shifts table has an auto-close trigger (fn_close_previous_employee_shift):
 * inserting a new row with is_current=true automatically sets is_current=false on the prior row.
 *
 * Protected:
 *   GET /               — hr_admin or super_admin only (admin console list)
 *   GET /:id/history     — self-or-hr_admin (ESS reads its own shift schedule too)
 *   POST / DELETE        — hr_admin or super_admin only
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { resolveCallerEmployeeId } from '../../lib/manager-scope.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const assignSchema = z.object({
  employee_id:    z.string().uuid('employee_id must be a UUID'),
  shift_id:       z.string().uuid('shift_id must be a UUID'),
  effective_from: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be YYYY-MM-DD'),
})

export default async function employeeShiftsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(
    req: { userRole: string },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/employee-shifts ──────────────────────────────────────────────
  // Returns all active employees, each decorated with their current standing shift
  // (null when no shift has been assigned yet) and their current work location.
  fastify.get('/', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    // employees is paginated — an unbounded .select() truncates at
    // PostgREST's 1,000-row ceiling for a large tenant, silently dropping
    // employees from the shift-override list.
    let empError: unknown = null
    const employeesPromise = fetchAllRows((from, to) =>
      fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active')
        .order('employee_code')
        .range(from, to),
    ).catch((err) => { empError = err; return [] })

    const [
      employees,
      { data: assignments, error: assignError },
      { data: jobRows, error: jobError },
    ] = await Promise.all([
      employeesPromise,

      fastify.supabase
        .from('employee_shifts')
        .select('id, employee_id, effective_from, shifts(id, name, code, start_time, end_time, grace_minutes)')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),

      fastify.supabase
        .from('job_history')
        .select('employee_id, work_location_id, work_locations(id, name)')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),
    ])

    if (empError || assignError || jobError) {
      const err = empError ?? assignError ?? jobError
      req.log.error({ err }, 'employee-shifts list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employee shifts' })
    }

    // Build lookup: employee_id → assignment row
    const assignMap = new Map(
      (assignments ?? []).map((a: Record<string, unknown>) => [a.employee_id as string, a])
    )
    // Build lookup: employee_id → work_location { id, name }
    const jobMap = new Map(
      (jobRows ?? []).map((j: any) => [j.employee_id as string, j.work_locations ?? null])
    )

    const rows = (employees ?? []).map((e: { id: string; first_name: string; last_name: string; employee_code: string }) => {
      const a = assignMap.get(e.id) as Record<string, unknown> | undefined
      return {
        employee_id:    e.id,
        employee_code:  e.employee_code,
        name:           `${e.first_name} ${e.last_name}`,
        assignment_id:  a?.id            ?? null,
        effective_from: a?.effective_from ?? null,
        shift:          a?.shifts         ?? null,
        work_location:  jobMap.get(e.id)  ?? null,
      }
    })

    return reply.send({ data: rows })
  })

  // ── POST /masters/employee-shifts/assign ──────────────────────────────────────
  // Insert a new employee_shifts row with is_current=true.
  // The DB trigger fn_close_previous_employee_shift auto-sets is_current=false
  // on any prior assignment for the same employee.
  fastify.post('/assign', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = assignSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, shift_id, effective_from } = parsed.data

    // Verify the employee belongs to this tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Verify the shift belongs to this tenant
    const { data: shift } = await fastify.supabase
      .from('shifts')
      .select('id')
      .eq('id', shift_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!shift) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Shift not found' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_shifts')
      .insert({
        tenant_id:      req.tenantId,
        employee_id,
        shift_id,
        effective_from,
        is_current:     true,
      })
      .select('id, employee_id, shift_id, effective_from, is_current')
      .single()

    if (error) {
      req.log.error({ err: error }, 'employee shift assign failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to assign shift' })
    }

    return reply.code(201).send({ data })
  })

  // ── GET /masters/employee-shifts/:employeeId/history ─────────────────────────
  // Returns all shift assignments for one employee in reverse chronological order.
  // Must be registered BEFORE /:id to avoid route shadowing.
  fastify.get('/:employeeId/history', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    // Self-or-HR-admin — MyAttendance.tsx (ESS) reads this for the caller's
    // own upcoming shift, and the admin console reads it for any employee.
    // Was previously any authenticated user with no ownership check.
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own shift history' })
      }
    }

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_shifts')
      .select('id, effective_from, is_current, shifts(id, name, code, start_time, end_time)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false })

    if (error) {
      req.log.error({ err: error }, 'employee shift history query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch shift history' })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── DELETE /masters/employee-shifts/:id ───────────────────────────────────────
  // Remove a specific assignment row. The employee will have no standing shift
  // until a new one is assigned.
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { error } = await fastify.supabase
      .from('employee_shifts')
      .delete()
      .eq('id', (req.params as { id: string }).id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      req.log.error({ err: error }, 'employee shift delete failed')
      return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to remove assignment' })
    }

    return reply.code(204).send()
  })
}
