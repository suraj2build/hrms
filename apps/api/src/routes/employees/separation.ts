import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { revokeEmployeeAuth } from '../../lib/user-account-service.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  separation_type:      z.enum(['resignation','termination','retirement','end_of_contract','absconding','deceased','mutual_separation']),
  initiated_by:         z.enum(['employee','employer']),
  notice_date:          z.string().optional(),
  last_working_date:    z.string().optional(),
  exit_reason:          z.string().optional(),
  exit_interview_done:  z.boolean().optional().default(false),
  exit_interview_date:  z.string().optional(),
  clearance_done:       z.boolean().optional().default(false),
  remarks:              z.string().optional(),
  notice_period_days_override: z.number().int().min(0).max(365).optional().nullable(),
  notice_waived:        z.boolean().optional(),
  // optional so this stays backward-compatible with a frontend that hasn't
  // been updated to send it yet — the CAS check on PUT only runs when a
  // caller actually provides it (PEND-105 follow-up wave).
  expected_version:     z.number().int().positive().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id, status').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return data
}

export default async function separationRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/separation', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error && error.code !== 'PGRST116')
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch separation record')
    return reply.send({ data: data ?? null })
  })

  // POST: initiate separation (also updates employee.status) — HR admin only
  fastify.post('/employees/:id/separation', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    if (employee.status === 'separated')
      return reply.code(409).send({ error: 'ALREADY_SEPARATED', message: 'Employee is already separated' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Insert separation record
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        created_by:  req.userId,
      })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to initiate separation')

    // Update employee status based on last_working_date
    const lwd = parsed.data.last_working_date
    const newStatus = lwd && new Date(lwd) <= new Date() ? 'separated' : 'on_notice'
    const { error: statusErr } = await fastify.supabase
      .from('employees')
      .update({ status: newStatus })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (statusErr) fastify.log.error({ err: statusErr, employeeId: req.params.id }, 'separation/initiate: failed to update employee status')

    // AF-001: revoke auth access — this path can reach 'separated' directly
    // (a past-dated last_working_date at initiation time), not only via the
    // relieve workflow step.
    if (newStatus === 'separated') {
      const revoked = await revokeEmployeeAuth(fastify.supabase, req.params.id, req.tenantId, fastify.log)
      if (!revoked) fastify.log.error({ employeeId: req.params.id, tenantId: req.tenantId }, 'separation/initiate: auth revocation did not fully succeed — employee may retain live access')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_separation',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { ...parsed.data, employee_status: newStatus },
    })

    return reply.code(201).send(data)
  })

  // PUT: update separation details (e.g. clearance, exit interview) — HR admin only
  fastify.put('/employees/:id/separation', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // expected_version is a CAS control field, not a DB column.
    const { expected_version, ...updateFields } = parsed.data

    let updateQuery = fastify.supabase
      .from('employee_separation')
      .update(updateFields)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (expected_version !== undefined)
      updateQuery = updateQuery.eq('version', expected_version)

    const { data, error } = await updateQuery.select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update separation record')
    if (!data) {
      if (expected_version !== undefined) {
        const { data: stillExists } = await fastify.supabase
          .from('employee_separation')
          .select('id')
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (stillExists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This separation record was changed by someone else. Reload and try again.')
        }
      }
      return notFound(reply, 'NOT_FOUND', 'Separation record not found')
    }

    // If last_working_date updated and now in past, mark as separated
    if (parsed.data.last_working_date && new Date(parsed.data.last_working_date) <= new Date()) {
      const { error: statusErr } = await fastify.supabase
        .from('employees')
        .update({ status: 'separated' })
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
      if (statusErr) fastify.log.error({ err: statusErr, employeeId: req.params.id }, 'separation/update: failed to update employee status')

      // AF-001: revoke auth access.
      const revoked = await revokeEmployeeAuth(fastify.supabase, req.params.id, req.tenantId, fastify.log)
      if (!revoked) fastify.log.error({ employeeId: req.params.id, tenantId: req.tenantId }, 'separation/update: auth revocation did not fully succeed — employee may retain live access')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_separation',
      recordId:    (data as any).id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send(data)
  })
}
