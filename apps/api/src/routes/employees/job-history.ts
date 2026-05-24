import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const createJobHistorySchema = z.object({
  department_id:     z.string().uuid().optional(),
  designation_id:    z.string().uuid().optional(),
  grade_id:          z.string().uuid().optional(),
  work_location_id:  z.string().uuid().optional(),
  cost_center_id:    z.string().uuid().optional(),
  shift_id:          z.string().uuid().optional(),
  manager_id:        z.string().uuid().optional(),
  employment_type:   z.enum(['permanent','contract','intern','probation','consultant']),
  confirmation_date: z.string().optional(),
  effective_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason_for_change: z.string().optional(),
  is_current:        z.boolean().optional().default(true),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function jobHistoryRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // GET /employees/:id/job-info  → current job (latest is_current = true)
  fastify.get('/employees/:id/job-info', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('job_history')
      .select(`
        *,
        departments(id, name, code),
        designations(id, name, level),
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
  fastify.get('/employees/:id/job-history', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
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
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /employees/:id/job-history  → new job entry (trigger auto-closes previous)
  fastify.post('/employees/:id/job-history', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = createJobHistorySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('job_history')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        created_by:  req.userId,
      })
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

  // DELETE /employees/:id/job-history/:rowId
  fastify.delete('/employees/:id/job-history/:rowId', auth, async (req: any, reply) => {
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
