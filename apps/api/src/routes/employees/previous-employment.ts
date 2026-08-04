import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  company_name:       z.string().min(1, 'Company name is required'),
  designation:        z.string().optional(),
  department:         z.string().optional(),
  from_date:          z.string().optional(),
  to_date:            z.string().optional(),
  reason_for_leaving: z.string().optional(),
  last_ctc:           z.number().positive().optional(),
  reference_name:     z.string().optional(),
  reference_contact:  z.string().optional(),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function previousEmploymentRoutes(fastify: FastifyInstance) {
  // Previous-employment data (past salary, references) is HR-managed in the
  // employee master and not consumed by ESS — gate all CRUD to HR admin so no
  // authenticated user can read/write another employee's history.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/previous-employment', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('previous_employment')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('to_date', { ascending: false })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch previous employment records')
    return reply.send({ data })
  })

  fastify.post('/employees/:id/previous-employment', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('previous_employment')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create previous employment record')
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/previous-employment/:prevId', hrAdminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { expected_version, ...fields } = parsed.data
    // .maybeSingle() (not .single()) — a wrong/foreign prevId must fall
    // through to the 404 below, not surface as a PGRST116 500.
    let query = fastify.supabase
      .from('previous_employment')
      .update(fields)
      .eq('id', req.params.prevId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)
    const { data, error } = await query.select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update previous employment record')
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('previous_employment')
          .select('id')
          .eq('id', req.params.prevId)
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'Previous employment record was changed by someone else. Reload and try again.')
        }
      }
      return notFound(reply, 'NOT_FOUND', 'Record not found')
    }
    return reply.send(data)
  })

  fastify.delete('/employees/:id/previous-employment/:prevId', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('previous_employment')
      .delete()
      .eq('id', req.params.prevId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete previous employment record')
    if (!data || data.length === 0) return notFound(reply, 'NOT_FOUND', 'Record not found')
    return reply.code(204).send()
  })
}
