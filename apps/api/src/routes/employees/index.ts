import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// NOTE: After migration 016 (lean employees), the following columns were removed
// from the employees table and relocated to dedicated sub-tables:
//   pan_number, aadhaar_last4, uan_number → employee_bank_statutory
//   gender, dob → employee_personal_info
//   department_id, designation_id, grade_id, employment_type → job_history
//
// POST /employees only writes the lean core identity fields.
// All other data should be written via the dedicated sub-module routes
// (e.g. POST /employees/:id/bank-statutory, PUT /employees/:id/personal-info).
const createEmployeeSchema = z.object({
  first_name:      z.string().min(1),
  last_name:       z.string().min(1),
  email:           z.string().email(),
  phone:           z.string().optional(),
  joining_date:    z.string(),
})

export default async function employeeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // GET /employees
  fastify.get('/employees', auth, async (request, reply) => {
    const { status, page = '1', limit = '20' } = request.query as Record<string, string>
    const offset = (parseInt(page) - 1) * parseInt(limit)

    // Lean select — only columns that exist after migration 016.
    // employment_type, profile_photo, department_id, designation_id are now
    // in job_history / employee_personal_info; the list page uses what's available here.
    let query = fastify.supabase
      .from('employees')
      .select(
        'id, employee_code, first_name, last_name, email, phone, status, joining_date',
        { count: 'exact' },
      )
      .eq('tenant_id', request.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data, total: count ?? 0 })
  })

  // GET /employees/:id
  fastify.get('/employees/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Lean select — FK columns department_id, designation_id, grade_id, manager_id
    // were moved to job_history by migration 016. Use /employees/:id/full-profile
    // for the complete enriched view.
    const { data, error } = await fastify.supabase
      .from('employees')
      .select('id, tenant_id, employee_code, first_name, last_name, email, phone, joining_date, status, created_by, created_at, updated_at')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (error) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    return reply.send(data)
  })

  // POST /employees
  fastify.post('/employees', auth, async (request, reply) => {
    const parsed = createEmployeeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    // Generate employee code
    const { count } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', request.tenantId)

    const code = `EMP-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data, error } = await fastify.supabase
      .from('employees')
      .insert({ ...parsed.data, tenant_id: request.tenantId, employee_code: code })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.code(201).send(data)
  })

  // PUT /employees/:id
  fastify.put('/employees/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Validate: employee exists and belongs to this tenant before touching it
    const { data: existing, error: findError } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (findError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Strip fields the caller must never overwrite
    const {
      id: _id,
      tenant_id: _tenant,
      employee_code: _code,
      created_at: _created,
      created_by: _createdBy,
      ...safeUpdates
    } = request.body as Record<string, unknown>

    const { data, error } = await fastify.supabase
      .from('employees')
      .update({ ...safeUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send(data)
  })

  // DELETE /employees/:id — soft delete only (status = separated, row is never removed)
  fastify.delete('/employees/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Confirm the employee exists and belongs to this tenant before modifying
    const { data: existing, error: findError } = await fastify.supabase
      .from('employees')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (findError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    if (existing.status === 'separated') {
      return reply.code(409).send({ error: 'CONFLICT', message: 'Employee is already separated' })
    }

    const { error } = await fastify.supabase
      .from('employees')
      .update({ status: 'separated', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', request.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ message: 'Employee separated successfully' })
  })
}
