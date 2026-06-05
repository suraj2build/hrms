import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

// Empty/None selections arrive as '' or null from the form — coerce both to
// undefined so optional uuid fields validate instead of 400-ing the whole save.
const optUuid = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().uuid().optional(),
)
const optStr = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().optional(),
)

const createJobHistorySchema = z.object({
  department_id:     optUuid,
  designation_id:    optUuid,
  grade_id:          optUuid,
  work_location_id:  optUuid,
  cost_center_id:    optUuid,
  shift_id:          optUuid,
  manager_id:        optUuid,
  employment_type:   z.enum(['permanent','contract','intern','probation','consultant']),
  confirmation_date: optStr,
  effective_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason_for_change: optStr,
  is_current:        z.boolean().optional().default(true),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

/** Resolves caller employee_id from profiles (tenant-scoped). */
async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .single()
  return data?.employee_id ?? null
}

export default async function jobHistoryRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /employees/:id/job-info  → current job (latest is_current = true)
  // Employees may only view their own; HR admins see all.
  fastify.get('/employees/:id/job-info', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own job info' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('job_history')
      .select(`
        *,
        departments(id, name, code),
        designations(id, name),
        grades(id, name, code),
        work_locations(id, name, city),
        cost_centers(id, name, code),
        shifts(id, name, start_time, end_time),
        manager:manager_id(id, first_name, last_name, employee_code)
      `)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('is_current', true)
      .single()
    if (error && error.code !== 'PGRST116')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // GET /employees/:id/job-history  → full history
  // Employees may only view their own; HR admins see all.
  fastify.get('/employees/:id/job-history', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own job history' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('job_history')
      .select(`
        *,
        departments(id, name),
        designations(id, name),
        grades(id, name, code),
        work_locations(id, name),
        cost_centers(id, name),
        shifts(id, name),
        manager:manager_id(id, first_name, last_name, employee_code)
      `)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error) {
      // Embed failure (a FK column/relationship missing on a drifted DB) must not
      // break the whole profile. Fall back to the raw rows (no joined names) so
      // the page still loads; run migration 223 to restore the embeds.
      req.log.warn({ err: error, employeeId: req.params.id }, 'job-history embed failed — serving raw rows (run migration 223)')
      const { data: raw, error: rawErr } = await fastify.supabase
        .from('job_history')
        .select('*')
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .order('effective_from', { ascending: false })
      if (rawErr) return reply.code(500).send({ error: 'DB_ERROR', message: rawErr.message })
      return reply.send({ data: raw ?? [] })
    }
    return reply.send({ data })
  })

  // POST /employees/:id/job-history  → new job entry (trigger auto-closes previous)
  // HR admin only — creating job history entries changes reporting structures.
  fastify.post('/employees/:id/job-history', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = createJobHistorySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Supersede the prior current row BEFORE inserting. A DB trigger is supposed
    // to auto-close the previous current entry, but on drifted DBs it may be
    // absent — then the new is_current=true row collides with
    // uidx_job_history_one_current (500). Closing it here makes the insert safe
    // regardless of whether the trigger exists.
    if (parsed.data.is_current !== false) {
      await fastify.supabase
        .from('job_history')
        .update({ is_current: false })
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true)
    }

    // Insert + return the RAW row (no FK embeds). Embedding here previously made
    // "Add Position" 500 whenever a job_history FK relationship was missing on a
    // drifted DB — even though the row inserted fine. The client refetches the
    // full profile after success, so the embedded names aren't needed here.
    const { data, error } = await fastify.supabase
      .from('job_history')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        created_by:  req.userId,
      })
      .select('*')
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Sync employees.manager_id when a new current job row carries a manager_id.
    // This keeps the live reporting FK in sync with job_history automatically.
    if (parsed.data.is_current !== false && 'manager_id' in parsed.data) {
      await fastify.supabase
        .from('employees')
        .update({ manager_id: parsed.data.manager_id ?? null, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
    }

    return reply.code(201).send(data)
  })

  // DELETE /employees/:id/job-history/:rowId — HR admin only
  fastify.delete('/employees/:id/job-history/:rowId', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { error } = await fastify.supabase
      .from('job_history')
      .delete()
      .eq('id', req.params.rowId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
